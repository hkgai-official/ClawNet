"""
Tests for intent_parser.py

验证单标记和多标记提取、去重、清理逻辑。
"""

import pytest
from src.services.intent_parser import (
    extract_dialog_intent,
    extract_dialog_intents,
    build_capability_prompt,
    build_dialog_result_prompt,
    AgentDialogIntent,
)


class TestExtractDialogIntent:
    """向后兼容：单标记提取"""

    def test_no_marker(self):
        text = "这是一段普通的回复文字"
        cleaned, intent = extract_dialog_intent(text)
        assert cleaned == text
        assert intent is None

    def test_single_marker(self):
        text = (
            "好的，我这就去联系张三。\n"
            "<<NEED_AGENT_DIALOG:target_owner=张三,topic=你最近在忙什么？>>"
        )
        cleaned, intent = extract_dialog_intent(text)
        assert "<<NEED_AGENT_DIALOG" not in cleaned
        assert "张三" not in cleaned or "联系张三" in cleaned
        assert intent is not None
        assert intent.target_owner == "张三"
        assert intent.topic == "你最近在忙什么？"

    def test_marker_with_content_after(self):
        text = (
            "我来帮你问问。\n"
            "<<NEED_AGENT_DIALOG:target_owner=李四,topic=周五有空吗？>>\n"
            "请稍等。"
        )
        cleaned, intent = extract_dialog_intent(text)
        assert intent is not None
        assert intent.target_owner == "李四"
        assert "请稍等" in cleaned

    def test_empty_response(self):
        cleaned, intent = extract_dialog_intent("")
        assert cleaned == ""
        assert intent is None


class TestExtractDialogIntents:
    """多标记提取"""

    def test_no_markers(self):
        cleaned, intents = extract_dialog_intents("普通文字")
        assert cleaned == "普通文字"
        assert intents == []

    def test_single_marker(self):
        text = (
            "好的\n"
            "<<NEED_AGENT_DIALOG:target_owner=张三,topic=问题>>"
        )
        cleaned, intents = extract_dialog_intents(text)
        assert len(intents) == 1
        assert intents[0].target_owner == "张三"
        assert intents[0].topic == "问题"
        assert "<<NEED_AGENT_DIALOG" not in cleaned

    def test_multiple_markers(self):
        text = (
            "我来帮你分别联系他们。\n"
            "<<NEED_AGENT_DIALOG:target_owner=张三,topic=你周五有空吗？>>\n"
            "<<NEED_AGENT_DIALOG:target_owner=李四,topic=你能推荐餐厅吗？>>"
        )
        cleaned, intents = extract_dialog_intents(text)
        assert len(intents) == 2
        assert intents[0].target_owner == "张三"
        assert intents[0].topic == "你周五有空吗？"
        assert intents[1].target_owner == "李四"
        assert intents[1].topic == "你能推荐餐厅吗？"
        assert "<<NEED_AGENT_DIALOG" not in cleaned
        assert "联系他们" in cleaned

    def test_dedup_same_target(self):
        text = (
            "<<NEED_AGENT_DIALOG:target_owner=张三,topic=问题1>>\n"
            "<<NEED_AGENT_DIALOG:target_owner=张三,topic=问题2>>"
        )
        cleaned, intents = extract_dialog_intents(text)
        assert len(intents) == 1
        assert intents[0].target_owner == "张三"
        assert intents[0].topic == "问题1"  # 保留第一个

    def test_three_markers(self):
        text = (
            "<<NEED_AGENT_DIALOG:target_owner=A,topic=问1>>\n"
            "<<NEED_AGENT_DIALOG:target_owner=B,topic=问2>>\n"
            "<<NEED_AGENT_DIALOG:target_owner=C,topic=问3>>"
        )
        cleaned, intents = extract_dialog_intents(text)
        assert len(intents) == 3
        names = [i.target_owner for i in intents]
        assert names == ["A", "B", "C"]

    def test_alt_pattern(self):
        # 备用模式：关键字周围有空格但 << >> 不含空格
        text = (
            "<<NEED_AGENT_DIALOG : target_owner = \"张三\" , topic = \"你好\" >>"
        )
        cleaned, intents = extract_dialog_intents(text)
        assert len(intents) == 1
        assert intents[0].target_owner == "张三"


class TestBuildCapabilityPrompt:
    def test_empty_contacts(self):
        assert build_capability_prompt([]) == ""

    def test_single_contact(self):
        contacts = [{"owner_name": "张三", "description": "工程", "status": "online"}]
        prompt = build_capability_prompt(contacts)
        assert "张三" in prompt
        assert "在线" in prompt
        assert "多人联系" in prompt  # 新增的多人说明

    def test_multiple_contacts(self):
        contacts = [
            {"owner_name": "张三", "description": "工程", "status": "online"},
            {"owner_name": "李四", "description": "管理", "status": "offline"},
        ]
        prompt = build_capability_prompt(contacts)
        assert "张三" in prompt
        assert "李四" in prompt
        assert "最多可联系 5 个人" in prompt


class TestBuildDialogResultPrompt:
    def test_basic_result(self):
        prompt = build_dialog_result_prompt(
            topic="周五有空吗",
            responder_owner_name="张三",
            summary="张三说周五有空",
        )
        assert "DIALOG_RESULT" in prompt
        assert "张三" in prompt
        assert "周五有空" in prompt

    def test_with_discovery_context(self):
        context = {
            "contacted_count": 2,
            "max_hops": 5,
            "original_intent": "组织团建",
            "pending_count": 1,
        }
        prompt = build_dialog_result_prompt(
            topic="周五有空吗",
            responder_owner_name="张三",
            summary="张三说可以",
            discovery_context=context,
        )
        assert "2/5" in prompt
        assert "组织团建" in prompt
        assert "还有 1 个待处理查询" in prompt

    def test_with_discovery_context_no_pending(self):
        context = {
            "contacted_count": 3,
            "max_hops": 5,
            "original_intent": "协调事务",
            "pending_count": 0,
        }
        prompt = build_dialog_result_prompt(
            topic="问题",
            responder_owner_name="李四",
            summary="回复内容",
            discovery_context=context,
        )
        assert "3/5" in prompt
        assert "待处理" not in prompt
