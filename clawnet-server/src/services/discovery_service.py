"""
Discovery Service

多用户发现任务的编排器。在 AgentDialogSession 之上管理多个 A2A 对话的生命周期，
实现链式发现和多目标并行询问。
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import async_session
from src.models.agent import Agent
from src.models.agent_dialog_session import AgentDialogSession
from src.models.conversation import Conversation, ConversationParticipant
from src.models.discovery_task import DiscoveryTask, DiscoveryTaskStatus
from src.models.user import User
from src.schemas.agent_dialog import CreateDialogSessionRequest
from src.websocket.manager import ws_manager

logger = logging.getLogger("clawnet.discovery")


class DiscoveryOrchestrator:
    """多用户发现任务编排器"""

    def __init__(self):
        self._processing_locks: dict[str, asyncio.Lock] = {}

    def _get_lock(self, task_id: str) -> asyncio.Lock:
        if task_id not in self._processing_locks:
            self._processing_locks[task_id] = asyncio.Lock()
        return self._processing_locks[task_id]

    async def create_task(
        self,
        db: AsyncSession,
        source_conversation_id: str,
        initiator_agent_id: str,
        initiator_owner_id: str,
        original_intent: str,
        queries: list[dict],
        max_hops: int = 5,
        max_concurrent: int = 2,
    ) -> DiscoveryTask:
        """创建发现任务

        Args:
            db: 数据库会话
            source_conversation_id: 原始会话 ID
            initiator_agent_id: 发起方 Agent ID
            initiator_owner_id: 发起方用户 ID
            original_intent: 原始用户意图描述
            queries: 待询问列表 [{target_owner, topic}]
            max_hops: 最大联系人数
            max_concurrent: 最大并发 A2A 数

        Returns:
            DiscoveryTask 对象
        """
        # 去重查询
        seen = set()
        deduped_queries = []
        for q in queries:
            key = q.get("target_owner", "").strip()
            if key and key not in seen:
                seen.add(key)
                deduped_queries.append({
                    "target_owner": key,
                    "topic": q.get("topic", "").strip(),
                    "priority": q.get("priority", 0),
                })

        task = DiscoveryTask(
            source_conversation_id=uuid.UUID(source_conversation_id),
            initiator_agent_id=uuid.UUID(initiator_agent_id),
            initiator_owner_id=uuid.UUID(initiator_owner_id),
            original_intent=original_intent,
            pending_queries=deduped_queries,
            max_hops=min(max_hops, 10),
            max_concurrent=min(max_concurrent, 5),
        )
        db.add(task)
        await db.flush()

        logger.info(
            f"[Discovery:{str(task.id)[:8]}] Created with {len(deduped_queries)} queries, "
            f"max_hops={task.max_hops}"
        )

        # 通过 WS 通知用户发现任务已创建
        await self._notify_created(task)

        return task

    async def start_task(self, task_id: str) -> None:
        """启动发现任务（开始处理队列）

        在后台异步执行，不阻塞当前请求。
        """
        asyncio.create_task(self._process_queue_safe(task_id))

    async def confirm_task(
        self,
        db: AsyncSession,
        task_id: uuid.UUID,
        user_id: uuid.UUID,
        edited_queries: Optional[list[dict]] = None,
    ) -> DiscoveryTask:
        """用户确认执行发现任务（可编辑计划）"""
        task = await db.get(DiscoveryTask, task_id)
        if not task:
            raise ValueError(f"Discovery task {task_id} not found")
        if task.initiator_owner_id != user_id:
            raise ValueError("Only the initiator can confirm the task")
        if task.status != DiscoveryTaskStatus.PENDING.value:
            raise ValueError(f"Task status is {task.status}, cannot confirm")

        if edited_queries is not None:
            # 用户编辑了查询计划
            task.pending_queries = edited_queries

        task.status = DiscoveryTaskStatus.RUNNING.value
        task.version += 1
        await db.flush()

        # 启动处理
        await self.start_task(str(task.id))
        return task

    async def cancel_task(
        self,
        db: AsyncSession,
        task_id: uuid.UUID,
        user_id: uuid.UUID,
        reason: Optional[str] = None,
    ) -> DiscoveryTask:
        """取消发现任务"""
        task = await db.get(DiscoveryTask, task_id)
        if not task:
            raise ValueError(f"Discovery task {task_id} not found")
        if task.initiator_owner_id != user_id:
            raise ValueError("Only the initiator can cancel the task")
        if task.status in (DiscoveryTaskStatus.COMPLETED.value, DiscoveryTaskStatus.CANCELLED.value):
            raise ValueError(f"Task already {task.status}")

        log_prefix = f"[Discovery:{str(task_id)[:8]}]"
        source_conv_id = task.source_conversation_id

        # 终止所有活跃的 A2A 会话
        for active in (task.active_sessions or []):
            session_id = active.get("session_id")
            if session_id:
                await self._terminate_session(db, session_id, "discovery_cancelled")

        task.status = DiscoveryTaskStatus.CANCELLED.value
        task.completed_at = datetime.now(timezone.utc)
        task.version += 1
        await db.commit()

        await self._notify_completed(task)

        # 如果是嵌套任务，恢复父对话并注入取消通知
        parent_session = await self._find_parent_dialog_session(
            db, source_conv_id, str(task_id)
        )
        if parent_session:
            logger.info(
                f"{log_prefix} Found parent dialog {str(parent_session.id)[:8]}, "
                f"resuming with cancellation notice"
            )
            await self._resume_parent_dialog(
                task, parent_session, db,
                cancelled=True, cancel_reason=reason or "user_cancelled",
            )
        else:
            logger.debug(f"{log_prefix} No parent dialog found, cancellation complete")

        return task

    async def get_task(
        self,
        db: AsyncSession,
        task_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> Optional[DiscoveryTask]:
        """获取发现任务详情"""
        task = await db.get(DiscoveryTask, task_id)
        if not task:
            return None
        if task.initiator_owner_id != user_id:
            raise ValueError("Not authorized to view this task")
        return task

    async def list_tasks(
        self,
        db: AsyncSession,
        user_id: uuid.UUID,
        status: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[DiscoveryTask], int]:
        """列出用户的发现任务"""
        query = select(DiscoveryTask).where(
            DiscoveryTask.initiator_owner_id == user_id
        )
        if status:
            query = query.where(DiscoveryTask.status == status)

        # 总数
        from sqlalchemy import func
        count_query = select(func.count()).select_from(query.subquery())
        total = (await db.execute(count_query)).scalar() or 0

        # 分页
        query = query.order_by(DiscoveryTask.created_at.desc()).offset(offset).limit(limit)
        result = await db.execute(query)
        tasks = list(result.scalars().all())

        return tasks, total

    async def get_task_by_conversation(
        self,
        db: AsyncSession,
        conversation_id: uuid.UUID,
    ) -> Optional[DiscoveryTask]:
        """根据会话 ID 查找关联的活跃发现任务"""
        result = await db.execute(
            select(DiscoveryTask).where(
                DiscoveryTask.source_conversation_id == conversation_id,
                DiscoveryTask.status.in_([
                    DiscoveryTaskStatus.PENDING.value,
                    DiscoveryTaskStatus.RUNNING.value,
                    DiscoveryTaskStatus.COMPLETING.value,
                ]),
            ).order_by(DiscoveryTask.created_at.desc()).limit(1)
        )
        return result.scalar_one_or_none()

    async def on_dialog_completed(
        self,
        session: AgentDialogSession,
        db: AsyncSession,
    ) -> bool:
        """A2A 对话完成回调

        当一个 A2A 对话完成时由 agent_dialog_service 调用。
        如果该对话属于某个发现任务，更新任务状态并继续处理队列。

        Returns:
            True 如果该对话属于发现任务（不需要直接回传结果），
            False 表示非发现任务对话（保持原有行为）。
        """
        metadata = session.metadata_ or {}
        discovery_task_id = metadata.get("discovery_task_id")

        if not discovery_task_id:
            return False

        task = await db.get(DiscoveryTask, uuid.UUID(discovery_task_id))
        if not task:
            logger.warning(f"Discovery task {discovery_task_id} not found for completed dialog")
            return False

        session_id_str = str(session.id)
        log_prefix = f"[Discovery:{str(task.id)[:8]}]"

        # 从 active_sessions 移除
        active = list(task.active_sessions or [])
        task.active_sessions = [a for a in active if a.get("session_id") != session_id_str]

        # 构建摘要
        from src.services.agent_dialog_service import agent_dialog_orchestrator
        summary = await agent_dialog_orchestrator._build_dialog_summary(session, db)

        # 获取对方 owner 名称
        from src.services.prompt_templates import get_unknown_user, get_user_lang
        responder_owner = await db.get(User, session.responder_owner_id)
        initiator_owner = await db.get(User, task.initiator_owner_id)
        lang = get_user_lang(initiator_owner)
        responder_name = responder_owner.display_name if responder_owner else get_unknown_user(lang)

        # 添加到 completed_results
        completed = list(task.completed_results or [])
        completed.append({
            "target_owner": responder_name,
            "topic": session.topic,
            "summary": summary,
            "session_id": session_id_str,
            "status": session.termination_reason or "completed",
        })
        task.completed_results = completed

        task.version += 1
        await db.commit()

        logger.info(
            f"{log_prefix} Dialog {session_id_str[:8]} completed with {responder_name}, "
            f"results={len(completed)}/{task.current_hop_count}"
        )

        # 将单次结果回传给 Agent（让 Agent 基于已知信息做后续决策）
        # 但如果是嵌套对话子任务，跳过回传——父对话已暂停，
        # 结果将在 _finalize_task → _resume_parent_dialog 中统一注入
        parent = await self._find_parent_dialog_session(
            db, task.source_conversation_id, str(task.id)
        )
        if not parent:
            await self._feedback_single_result(task, session, summary, responder_name, db)

        # 通知前端进度更新
        await self._notify_progress(task)

        # 如果还有待处理的查询或者 Agent 可能发现新目标，继续处理
        # 等待 Agent 回复后可能产生新的 intents（由 _check_dialog_intent 追加）
        # 使用延迟调度，给 Agent 回复时间
        asyncio.create_task(self._delayed_check_completion(str(task.id), delay=10.0))

        return True

    async def add_queries_to_task(
        self,
        db: AsyncSession,
        task_id: str,
        new_queries: list[dict],
    ) -> None:
        """向运行中的发现任务追加新查询（链式发现）"""
        task = await db.get(DiscoveryTask, uuid.UUID(task_id))
        if not task or task.status not in (
            DiscoveryTaskStatus.RUNNING.value,
            DiscoveryTaskStatus.COMPLETING.value,
        ):
            return

        # 去重：不重复联系已经问过的人
        existing_targets = set()
        for r in (task.completed_results or []):
            existing_targets.add(r.get("target_owner", ""))
        for a in (task.active_sessions or []):
            existing_targets.add(a.get("target_owner", ""))
        for p in (task.pending_queries or []):
            existing_targets.add(p.get("target_owner", ""))

        added = []
        for q in new_queries:
            target = q.get("target_owner", "").strip()
            if target and target not in existing_targets and task.can_add_hop():
                added.append({
                    "target_owner": target,
                    "topic": q.get("topic", "").strip(),
                    "priority": q.get("priority", 0),
                })
                existing_targets.add(target)

        if not added:
            return

        pending = list(task.pending_queries or [])
        pending.extend(added)
        task.pending_queries = pending
        # 如果任务在 completing 状态，回到 running
        if task.status == DiscoveryTaskStatus.COMPLETING.value:
            task.status = DiscoveryTaskStatus.RUNNING.value
        task.version += 1
        await db.flush()

        logger.info(
            f"[Discovery:{str(task.id)[:8]}] Added {len(added)} new queries via chain discovery"
        )

        # 继续处理队列
        await self.start_task(str(task.id))

    # ============ 内部方法 ============

    async def _process_queue_safe(self, task_id: str) -> None:
        """安全处理队列（带锁防止并发）"""
        lock = self._get_lock(task_id)
        if lock.locked():
            return  # 已有处理器在运行
        async with lock:
            try:
                await self._process_queue(task_id)
            except Exception as e:
                logger.error(f"[Discovery:{task_id[:8]}] Queue processing error: {e}")

    async def _process_queue(self, task_id: str) -> None:
        """处理待询问队列：取出查询，创建 A2A 对话"""
        async with async_session() as db:
            task = await db.get(DiscoveryTask, uuid.UUID(task_id))
            if not task or task.status not in (
                DiscoveryTaskStatus.RUNNING.value,
            ):
                return

            from src.services.prompt_templates import get_contact_failed_summary, get_user_lang
            initiator_owner = await db.get(User, task.initiator_owner_id)
            lang = get_user_lang(initiator_owner)

            while task.has_pending_queries() and task.can_add_hop():
                # 检查并发限制
                active_count = len(task.active_sessions or [])
                if active_count >= task.max_concurrent:
                    logger.info(
                        f"[Discovery:{task_id[:8]}] Concurrent limit reached "
                        f"({active_count}/{task.max_concurrent}), waiting"
                    )
                    break

                # 取出一个查询
                pending = list(task.pending_queries)
                query = pending.pop(0)
                task.pending_queries = pending

                target_owner = query.get("target_owner", "")
                topic = query.get("topic", "")
                nesting_depth = query.get("nesting_depth", 0)

                if not target_owner or not topic:
                    continue

                # 创建 A2A 对话
                success = await self._create_a2a_session(
                    db, task, target_owner, topic, nesting_depth=nesting_depth
                )

                if not success:
                    # 记录失败
                    completed = list(task.completed_results or [])
                    completed.append({
                        "target_owner": target_owner,
                        "topic": topic,
                        "summary": get_contact_failed_summary(lang),
                        "session_id": None,
                        "status": "failed",
                    })
                    task.completed_results = completed

                task.version += 1
                await db.commit()
                await db.refresh(task)

                # 通知进度
                await self._notify_progress(task)

            # 检查是否全部完成
            if task.is_all_done() and task.status == DiscoveryTaskStatus.RUNNING.value:
                await self._finalize_task(task, db)

    async def _create_a2a_session(
        self,
        db: AsyncSession,
        task: DiscoveryTask,
        target_owner: str,
        topic: str,
        nesting_depth: int = 0,
    ) -> bool:
        """为发现任务创建一个 A2A 对话"""
        log_prefix = f"[Discovery:{str(task.id)[:8]}]"

        try:
            # 查找目标用户
            result = await db.execute(
                select(User).where(User.display_name == target_owner)
            )
            target_user = result.scalar_one_or_none()

            if not target_user:
                # 模糊匹配
                result = await db.execute(
                    select(User).where(User.display_name.ilike(f'%{target_owner}%'))
                )
                target_user = result.scalar_one_or_none()

            if not target_user:
                logger.warning(f"{log_prefix} User not found: {target_owner}")
                return False

            # 排除自己：不能联系发起者自己
            if target_user.id == task.initiator_owner_id:
                logger.info(f"{log_prefix} Skipping self-contact: {target_owner}")
                return False

            # 查找在线 Agent
            result = await db.execute(
                select(Agent).where(
                    Agent.owner_id == target_user.id,
                    Agent.status == "online",
                ).order_by(Agent.created_at.desc()).limit(1)
            )
            target_agent = result.scalar_one_or_none()

            if not target_agent:
                logger.warning(f"{log_prefix} No online agent for: {target_owner}")
                return False

            # 创建 A2A 对话
            from src.services.agent_dialog_service import agent_dialog_orchestrator

            req = CreateDialogSessionRequest(
                initiator_agent_id=task.initiator_agent_id,
                responder_agent_id=target_agent.id,
                topic=topic,
                max_rounds=10,
                idle_timeout_seconds=settings.AGENT_DIALOG_DEFAULT_IDLE_TIMEOUT,
                metadata={
                    "source_conversation_id": str(task.source_conversation_id),
                    "source_user_id": str(task.initiator_owner_id),
                    "discovery_task_id": str(task.id),
                    "nesting_depth": nesting_depth,
                },
            )

            session = await agent_dialog_orchestrator.create_session(
                db, req, task.initiator_owner_id
            )

            # 更新 active_sessions 和 hop_count
            active = list(task.active_sessions or [])
            active.append({
                "session_id": str(session.id),
                "target_owner": target_owner,
                "topic": topic,
            })
            task.active_sessions = active
            task.current_hop_count += 1

            logger.info(
                f"{log_prefix} A2A session created: {str(session.id)[:8]} -> {target_owner}"
            )
            return True

        except Exception as e:
            logger.error(f"{log_prefix} Failed to create A2A session for {target_owner}: {e}")
            return False

    async def _feedback_single_result(
        self,
        task: DiscoveryTask,
        session: AgentDialogSession,
        summary: str,
        responder_name: str,
        db: AsyncSession,
    ) -> None:
        """将单次 A2A 对话结果回传给 Agent（实时回传策略）"""
        from src.services.prompt_templates import build_dialog_result_prompt_i18n, get_user_lang
        from src.services.openclaw_service import openclaw_service
        from src.services.session_key_service import upsert_session_key

        source_conv_id = str(task.source_conversation_id)

        try:
            initiator_agent = await db.get(Agent, task.initiator_agent_id)
            if not initiator_agent:
                return

            # 获取发起方语言偏好
            initiator_owner = await db.get(User, task.initiator_owner_id)
            lang = get_user_lang(initiator_owner)

            # 获取原始会话参与者
            result = await db.execute(
                select(ConversationParticipant.participant_id).where(
                    ConversationParticipant.conversation_id == task.source_conversation_id
                )
            )
            participant_ids = [str(row[0]) for row in result.all()]

            # 构造带发现上下文的结果 prompt
            discovery_context = {
                "contacted_count": task.current_hop_count,
                "max_hops": task.max_hops,
                "original_intent": task.original_intent,
                "pending_count": len(task.pending_queries or []),
            }

            result_prompt = build_dialog_result_prompt_i18n(
                topic=session.topic,
                responder_owner_name=responder_name,
                summary=summary,
                discovery_context=discovery_context,
                lang=lang,
            )

            session_key = f"clawnet:{source_conv_id}"
            effective_user_id = str(task.initiator_owner_id)

            await upsert_session_key(
                db,
                conversation_id=source_conv_id,
                user_id=effective_user_id,
                agent_id=str(initiator_agent.id),
                session_key=session_key,
            )

            await openclaw_service.send_chat(
                conversation_id=source_conv_id,
                user_id=effective_user_id,
                participant_ids=participant_ids,
                agent_id=str(initiator_agent.id),
                session_key=session_key,
                message=result_prompt,
                idempotency_key=f"discovery-result-{task.id}-{session.id}",
            )

            logger.info(
                f"[Discovery:{str(task.id)[:8]}] Feedback sent for {responder_name}"
            )

        except Exception as e:
            logger.error(
                f"[Discovery:{str(task.id)[:8]}] Failed to feedback result: {e}"
            )

    async def _delayed_check_completion(self, task_id: str, delay: float = 10.0) -> None:
        """延迟检查任务是否完成（给 Agent 时间回复并可能发现新目标）"""
        await asyncio.sleep(delay)

        async with async_session() as db:
            task = await db.get(DiscoveryTask, uuid.UUID(task_id))
            if not task:
                return
            if task.status not in (DiscoveryTaskStatus.RUNNING.value,):
                return

            if task.is_all_done():
                await self._finalize_task(task, db)
            elif task.has_pending_queries():
                # 还有待处理的查询，继续处理
                await self.start_task(task_id)

    async def _finalize_task(self, task: DiscoveryTask, db: AsyncSession) -> None:
        """最终汇总阶段：所有子对话完成后生成汇总

        如果 DiscoveryTask 是由嵌套对话触发的（source_conversation 有 PAUSED
        + NESTED_DIALOG 的 AgentDialogSession），则恢复父对话而非直接注入会话。
        """
        log_prefix = f"[Discovery:{str(task.id)[:8]}]"

        task.status = DiscoveryTaskStatus.COMPLETING.value
        task.version += 1
        await db.commit()
        await db.refresh(task)

        logger.info(f"{log_prefix} Entering finalization phase")

        try:
            # 检查是否是嵌套对话产生的子任务
            parent_session = await self._find_parent_dialog_session(
                db, task.source_conversation_id, str(task.id)
            )

            if parent_session:
                await self._resume_parent_dialog(task, parent_session, db)
            else:
                await self._finalize_to_source_conversation(task, db)

            # 标记完成
            task.status = DiscoveryTaskStatus.COMPLETED.value
            task.completed_at = datetime.now(timezone.utc)
            task.version += 1
            await db.commit()

            logger.info(f"{log_prefix} Finalized successfully")
            await self._notify_completed(task)

        except Exception as e:
            logger.error(f"{log_prefix} Finalization failed: {e}")
            task.status = DiscoveryTaskStatus.FAILED.value
            task.version += 1
            await db.commit()

    async def _finalize_to_source_conversation(
        self, task: DiscoveryTask, db: AsyncSession
    ) -> None:
        """将汇总结果注入回原始会话（非嵌套场景的原有逻辑）"""
        from src.services.openclaw_service import openclaw_service
        from src.services.session_key_service import upsert_session_key
        from src.services.prompt_templates import build_final_summary_prompt_i18n, get_user_lang

        initiator_owner = await db.get(User, task.initiator_owner_id)
        lang = get_user_lang(initiator_owner)
        summary_prompt = build_final_summary_prompt_i18n(
            completed_results=task.completed_results or [],
            original_intent=task.original_intent,
            lang=lang,
        )
        source_conv_id = str(task.source_conversation_id)
        initiator_agent = await db.get(Agent, task.initiator_agent_id)
        if not initiator_agent:
            return

        result = await db.execute(
            select(ConversationParticipant.participant_id).where(
                ConversationParticipant.conversation_id == task.source_conversation_id
            )
        )
        participant_ids = [str(row[0]) for row in result.all()]

        session_key = f"clawnet:{source_conv_id}"
        effective_user_id = str(task.initiator_owner_id)

        await upsert_session_key(
            db,
            conversation_id=source_conv_id,
            user_id=effective_user_id,
            agent_id=str(initiator_agent.id),
            session_key=session_key,
        )

        await openclaw_service.send_chat(
            conversation_id=source_conv_id,
            user_id=effective_user_id,
            participant_ids=participant_ids,
            agent_id=str(initiator_agent.id),
            session_key=session_key,
            message=summary_prompt,
            idempotency_key=f"discovery-final-{task.id}",
        )

    async def _find_parent_dialog_session(
        self,
        db: AsyncSession,
        conversation_id: uuid.UUID,
        task_id: str,
    ) -> Optional[AgentDialogSession]:
        """查找因嵌套对话而暂停的父 AgentDialogSession"""
        from src.models.agent_dialog_session import TerminationReason

        result = await db.execute(
            select(AgentDialogSession).where(
                AgentDialogSession.conversation_id == conversation_id,
                AgentDialogSession.status == "paused",
                AgentDialogSession.termination_reason == TerminationReason.NESTED_DIALOG.value,
            )
        )
        candidates = result.scalars().all()

        for session in candidates:
            metadata = session.metadata_ or {}
            if metadata.get("nested_discovery_task_id") == task_id:
                return session

        return None

    async def _resume_parent_dialog(
        self,
        task: DiscoveryTask,
        parent_session: AgentDialogSession,
        db: AsyncSession,
        cancelled: bool = False,
        cancel_reason: Optional[str] = None,
    ) -> None:
        """恢复因嵌套对话而暂停的父 A2A 对话

        Args:
            cancelled: True 表示子任务被取消（而非正常完成）
            cancel_reason: 取消原因（cancelled=True 时使用）
        """
        from src.models.agent_dialog_session import TerminationReason
        from src.services.agent_dialog_service import agent_dialog_orchestrator

        session_id_str = str(parent_session.id)
        log_prefix = f"[Discovery:{str(task.id)[:8]}]"

        # 乐观锁：PAUSED → ACTIVE
        result = await db.execute(
            update(AgentDialogSession)
            .where(
                AgentDialogSession.id == parent_session.id,
                AgentDialogSession.version == parent_session.version,
                AgentDialogSession.status == "paused",
            )
            .values(
                status="active",
                termination_reason=None,
                version=parent_session.version + 1,
            )
        )
        if result.rowcount == 0:
            logger.warning(
                f"{log_prefix} Failed to resume parent session {session_id_str[:8]} "
                f"(version conflict or status change)"
            )
            return

        await db.commit()
        await db.refresh(parent_session)

        # 确定哪个 Agent 发起了嵌套对话（从 metadata 恢复）
        metadata = parent_session.metadata_ or {}
        nested_agent_id_str = metadata.get("nested_initiator_agent_id")

        if nested_agent_id_str:
            responder_agent = await db.get(Agent, uuid.UUID(nested_agent_id_str))
        else:
            responder_agent = await db.get(Agent, task.initiator_agent_id)

        if not responder_agent:
            logger.error(f"{log_prefix} Cannot find agent to resume dialog")
            return

        # 根据场景构造不同的 prompt
        from src.services.prompt_templates import build_resume_prompt_i18n, get_user_lang
        initiator_owner = await db.get(User, task.initiator_owner_id)
        lang = get_user_lang(initiator_owner)
        resume_prompt = build_resume_prompt_i18n(
            completed_results=task.completed_results or [],
            cancelled=cancelled,
            cancel_reason=cancel_reason,
            lang=lang,
        )

        # 发送给 Agent 继续对话
        await agent_dialog_orchestrator._send_to_agent(
            session=parent_session,
            agent=responder_agent,
            message=resume_prompt,
            db=db,
        )

        # 发送结构化对话状态消息通知 Owner
        if cancelled:
            resume_reason = "nested_cancelled"
            resume_params = {"cancel_reason": cancel_reason or "user_cancelled"}
        else:
            resume_reason = "nested_completed"
            resume_params = None

        await agent_dialog_orchestrator._send_dialog_status(
            db,
            parent_session.conversation_id,
            action="resumed",
            reason=resume_reason,
            params=resume_params,
            owner_ids=[parent_session.initiator_owner_id, parent_session.responder_owner_id],
        )
        await db.commit()

        # WebSocket 通知状态变更
        try:
            owner_ids = [
                str(parent_session.initiator_owner_id),
                str(parent_session.responder_owner_id),
            ]
            ws_reason = "nested_cancelled" if cancelled else "nested_completed"
            await ws_manager.broadcast_message(
                owner_ids,
                {
                    "type": "dialog.status_change",
                    "data": {
                        "session_id": session_id_str,
                        "conversation_id": str(parent_session.conversation_id),
                        "old_status": "paused",
                        "new_status": "active",
                        "reason": ws_reason,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                },
            )
        except Exception as e:
            logger.warning(
                f"{log_prefix} Failed to notify dialog resume: {e}"
            )

        status_label = "cancelled" if cancelled else "completed"
        results = task.completed_results or []
        logger.info(
            f"{log_prefix} Resumed parent session {session_id_str[:8]} ({status_label}), "
            f"injected {len(results)} results to agent {str(responder_agent.id)[:8]}"
        )

    async def _terminate_session(
        self,
        db: AsyncSession,
        session_id: str,
        reason: str,
    ) -> None:
        """终止一个 A2A 对话（由 cancel_task 调用，跳过 discovery feedback 防止冲突）"""
        try:
            from src.services.agent_dialog_service import agent_dialog_orchestrator
            session = await db.get(AgentDialogSession, uuid.UUID(session_id))
            if session and session.status in ("active", "pending_approval", "paused"):
                await agent_dialog_orchestrator.terminate_session(
                    db, uuid.UUID(session_id),
                    session.initiator_owner_id,
                    reason,
                    skip_discovery_feedback=True,
                )
        except Exception as e:
            logger.warning(f"Failed to terminate session {session_id[:8]}: {e}")

    async def _notify_created(self, task: DiscoveryTask) -> None:
        """通知前端发现任务已创建"""
        try:
            await ws_manager.broadcast_message(
                conversation_participant_ids=[str(task.initiator_owner_id)],
                message={
                    "type": "discovery.created",
                    "data": {
                        "task_id": str(task.id),
                        "source_conversation_id": str(task.source_conversation_id),
                        "original_intent": task.original_intent,
                        "pending_queries": task.pending_queries,
                        "max_hops": task.max_hops,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                },
            )
        except Exception as e:
            logger.warning(f"Failed to notify discovery.created: {e}")

    async def _notify_progress(self, task: DiscoveryTask) -> None:
        """通知前端发现任务进度更新"""
        try:
            await ws_manager.broadcast_message(
                conversation_participant_ids=[str(task.initiator_owner_id)],
                message={
                    "type": "discovery.progress",
                    "data": {
                        "task_id": str(task.id),
                        "source_conversation_id": str(task.source_conversation_id),
                        "status": task.status,
                        "current_hop_count": task.current_hop_count,
                        "max_hops": task.max_hops,
                        "pending_queries": task.pending_queries,
                        "active_sessions": task.active_sessions,
                        "completed_results": task.completed_results,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                },
            )
        except Exception as e:
            logger.warning(f"Failed to notify discovery.progress: {e}")

    async def _notify_completed(self, task: DiscoveryTask) -> None:
        """通知前端发现任务已完成"""
        try:
            await ws_manager.broadcast_message(
                conversation_participant_ids=[str(task.initiator_owner_id)],
                message={
                    "type": "discovery.completed",
                    "data": {
                        "task_id": str(task.id),
                        "source_conversation_id": str(task.source_conversation_id),
                        "status": task.status,
                        "completed_results": task.completed_results,
                        "total_contacted": task.current_hop_count,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                },
            )
        except Exception as e:
            logger.warning(f"Failed to notify discovery.completed: {e}")

    def _cleanup_lock(self, task_id: str) -> None:
        """清理处理锁"""
        self._processing_locks.pop(task_id, None)


# 单例
discovery_orchestrator = DiscoveryOrchestrator()
