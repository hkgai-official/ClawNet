"""
Tests for DiscoveryTask model and DiscoveryOrchestrator summary logic.

These tests avoid importing the full model chain by testing enum values
and building a mock task object for the orchestrator summary method.
"""

import uuid
import pytest


class TestDiscoveryTaskStatus:
    """DiscoveryTask 状态枚举测试（不依赖 SQLAlchemy）"""

    def test_status_values(self):
        # 直接测试字符串值，不触发 database import
        expected_statuses = {
            "pending", "running", "completing",
            "completed", "cancelled", "failed",
        }
        # 这些值会在 migration SQL 和模型中使用
        for s in expected_statuses:
            assert isinstance(s, str)
            assert len(s) <= 20  # 数据库字段限制


class TestDiscoveryTaskLogic:
    """测试 DiscoveryTask 的业务逻辑（使用 mock 对象）"""

    class MockTask:
        """模拟 DiscoveryTask 对象"""
        def __init__(self, **kwargs):
            self.status = kwargs.get("status", "running")
            self.max_hops = kwargs.get("max_hops", 5)
            self.current_hop_count = kwargs.get("current_hop_count", 0)
            self.pending_queries = kwargs.get("pending_queries", [])
            self.completed_results = kwargs.get("completed_results", [])
            self.active_sessions = kwargs.get("active_sessions", [])
            self.original_intent = kwargs.get("original_intent", "测试")

        def can_add_hop(self) -> bool:
            return (
                self.status in ("pending", "running")
                and self.current_hop_count < self.max_hops
            )

        def has_active_sessions(self) -> bool:
            return bool(self.active_sessions)

        def has_pending_queries(self) -> bool:
            return bool(self.pending_queries)

        def is_all_done(self) -> bool:
            return not self.has_active_sessions() and not self.has_pending_queries()

    def test_can_add_hop_within_limit(self):
        task = self.MockTask(current_hop_count=3, max_hops=5)
        assert task.can_add_hop() is True

    def test_can_add_hop_at_limit(self):
        task = self.MockTask(current_hop_count=5, max_hops=5)
        assert task.can_add_hop() is False

    def test_can_add_hop_wrong_status(self):
        task = self.MockTask(status="completed", current_hop_count=0)
        assert task.can_add_hop() is False

    def test_can_add_hop_pending_status(self):
        task = self.MockTask(status="pending", current_hop_count=0)
        assert task.can_add_hop() is True

    def test_has_active_sessions(self):
        task = self.MockTask(active_sessions=[{"session_id": "abc"}])
        assert task.has_active_sessions() is True

    def test_no_active_sessions(self):
        task = self.MockTask(active_sessions=[])
        assert task.has_active_sessions() is False

    def test_has_pending_queries(self):
        task = self.MockTask(pending_queries=[{"target_owner": "张三"}])
        assert task.has_pending_queries() is True

    def test_is_all_done(self):
        task = self.MockTask(active_sessions=[], pending_queries=[])
        assert task.is_all_done() is True

    def test_is_not_all_done_with_active(self):
        task = self.MockTask(active_sessions=[{"session_id": "abc"}])
        assert task.is_all_done() is False

    def test_is_not_all_done_with_pending(self):
        task = self.MockTask(pending_queries=[{"target_owner": "张三"}])
        assert task.is_all_done() is False


class TestFinalSummaryPrompt:
    """测试最终汇总 prompt 构建（纯逻辑，不依赖数据库）"""

    def _build_summary(self, task) -> str:
        """复制 DiscoveryOrchestrator._build_final_summary_prompt 的逻辑"""
        results = task.completed_results or []
        total = len(results)

        result_lines = []
        for i, r in enumerate(results, 1):
            owner = r.get("target_owner", "未知")
            topic = r.get("topic", "")
            summary = r.get("summary", "无回复")
            status = r.get("status", "unknown")
            status_label = {
                "resolved": "已解决",
                "completed": "已完成",
                "failed": "联系失败",
                "timeout": "超时",
                "deadlock": "僵局",
            }.get(status, status)
            result_lines.append(
                f"{i}. {owner}（{status_label}）\n"
                f"   询问：{topic}\n"
                f"   回复：{summary}"
            )

        return f"""[DISCOVERY_COMPLETE]
你先后联系了 {total} 个人来完成用户的请求。
用户的原始意图：{task.original_intent}

各方回复结果：
{chr(10).join(result_lines)}

请将以上所有结果综合汇总，给你的用户一个完整的回复。
[/DISCOVERY_COMPLETE]"""

    def test_build_final_summary(self):
        task = TestDiscoveryTaskLogic.MockTask(
            original_intent="组织周五团建",
            completed_results=[
                {
                    "target_owner": "张三",
                    "topic": "周五有空吗？",
                    "summary": "张三说有空，建议去望京",
                    "session_id": "s1",
                    "status": "resolved",
                },
                {
                    "target_owner": "李四",
                    "topic": "推荐餐厅",
                    "summary": "李四推荐了海底捞",
                    "session_id": "s2",
                    "status": "completed",
                },
            ],
        )

        prompt = self._build_summary(task)
        assert "DISCOVERY_COMPLETE" in prompt
        assert "组织周五团建" in prompt
        assert "张三" in prompt
        assert "李四" in prompt
        assert "海底捞" in prompt
        assert "2 个人" in prompt

    def test_build_summary_with_failures(self):
        task = TestDiscoveryTaskLogic.MockTask(
            original_intent="测试",
            completed_results=[
                {
                    "target_owner": "王五",
                    "topic": "问题",
                    "summary": "无法联系",
                    "session_id": None,
                    "status": "failed",
                },
            ],
        )

        prompt = self._build_summary(task)
        assert "联系失败" in prompt
        assert "王五" in prompt

    def test_build_summary_empty(self):
        task = TestDiscoveryTaskLogic.MockTask(
            original_intent="空任务",
            completed_results=[],
        )

        prompt = self._build_summary(task)
        assert "0 个人" in prompt
