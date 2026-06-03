"""
Session Cleanup Task

定时任务：检测并处理超时的 Agent 对话会话。
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, and_, update
from sqlalchemy.orm import selectinload

from src.database import async_session
from src.models.agent_dialog_session import (
    AgentDialogSession,
    DialogSessionStatus,
    TerminationReason,
)
from src.models.conversation import Conversation, ConversationParticipant
from src.models.message import Message
from src.services.openclaw_service import agent_connection_manager
from src.websocket.manager import ws_manager

logger = logging.getLogger("clawnet.tasks.session_cleanup")

SYSTEM_SENDER_ID = uuid.UUID("00000000-0000-0000-0000-000000000000")


class SessionCleanupTask:
    """Agent 对话会话清理定时任务
    
    功能：
    1. 检测超时的活跃会话
    2. 检测长时间等待授权的会话
    3. 清理已完成/终止的会话的内存状态
    """

    def __init__(self, check_interval: int = 60):
        """
        Args:
            check_interval: 检查间隔（秒），默认 60 秒
        """
        self.check_interval = check_interval
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

    def start(self):
        """启动定时任务"""
        if self._task and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_forever())
        logger.info("Session cleanup task started")

    async def stop(self):
        """停止定时任务"""
        self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Session cleanup task stopped")

    async def _run_forever(self):
        """主循环"""
        while not self._stop_event.is_set():
            try:
                await asyncio.sleep(self.check_interval)
                await self._check_timeouts()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Session cleanup error: {e}", exc_info=True)

    async def _check_timeouts(self):
        """检查所有超时情况"""
        async with async_session() as db:
            now = datetime.now(timezone.utc)
            
            # 1. 检查活跃会话的空闲超时
            await self._check_active_session_timeouts(db, now)
            
            # 2. 检查等待授权的会话（超过 24 小时未响应）
            await self._check_pending_session_timeouts(db, now)
            
            await db.commit()

    async def _check_active_session_timeouts(self, db, now: datetime):
        """检查活跃会话的空闲超时"""
        # 获取所有活跃会话
        result = await db.execute(
            select(AgentDialogSession).where(
                AgentDialogSession.status == DialogSessionStatus.ACTIVE.value
            )
        )
        sessions = result.scalars().all()
        
        for session in sessions:
            if not session.last_message_at:
                continue
            
            # 二次检查：刷新会话状态，防止竞态条件导致的重复终止
            await db.refresh(session)
            if session.status != DialogSessionStatus.ACTIVE.value:
                logger.debug(
                    f"[Session:{str(session.id)[:8]}] Status changed to {session.status}, "
                    f"skipping idle timeout check"
                )
                continue
            
            idle_seconds = (now - session.last_message_at).total_seconds()
            if idle_seconds > session.idle_timeout_seconds:
                # Layer 2 防护：检查 Agent 是否有活跃的 Gateway run
                # 防止 cleanup 在 agent 正在处理（思考/工具/流式输出）时误杀会话
                agent_ids = [
                    str(session.initiator_agent_id),
                    str(session.responder_agent_id),
                ]
                if agent_connection_manager.has_active_dialog_run(
                    str(session.id), agent_ids
                ):
                    logger.info(
                        f"[Session:{str(session.id)[:8]}] Idle timeout triggered "
                        f"({idle_seconds:.0f}s > {session.idle_timeout_seconds}s) "
                        f"but agent run still active, skipping"
                    )
                    continue

                logger.info(
                    f"[Session:{str(session.id)[:8]}] Idle timeout "
                    f"({idle_seconds:.0f}s > {session.idle_timeout_seconds}s)"
                )
                await self._terminate_session(
                    db, session, TerminationReason.TIMEOUT, "idle_timeout"
                )

    async def _check_pending_session_timeouts(self, db, now: datetime):
        """检查等待授权的会话超时（5分钟）"""
        pending_timeout = timedelta(minutes=30)
        
        result = await db.execute(
            select(AgentDialogSession).where(
                and_(
                    AgentDialogSession.status == DialogSessionStatus.PENDING_APPROVAL.value,
                    AgentDialogSession.created_at < now - pending_timeout
                )
            )
        )
        sessions = result.scalars().all()
        
        for session in sessions:
            logger.info(
                f"[Session:{str(session.id)[:8]}] Pending approval timeout "
                f"(created at {session.created_at.isoformat()})"
            )
            await self._terminate_session(
                db, session, TerminationReason.TIMEOUT, "approval_timeout"
            )

    async def _terminate_session(
        self,
        db,
        session: AgentDialogSession,
        reason: TerminationReason,
        reason_text: str,
    ):
        """终止会话（完整版：乐观锁更新 + 系统消息 + 未读计数 + WebSocket 通知）"""
        now = datetime.now(timezone.utc)

        # 乐观锁：原子更新状态，防止与 orchestrator 重复终止
        # 仅在 termination_reason 为空时设置（保留暂停时记录的原始原因，如 DEADLOCK）
        effective_reason = reason.value if not session.termination_reason else session.termination_reason
        result = await db.execute(
            update(AgentDialogSession)
            .where(
                AgentDialogSession.id == session.id,
                AgentDialogSession.version == session.version,
                AgentDialogSession.status.notin_([
                    DialogSessionStatus.COMPLETED.value,
                    DialogSessionStatus.TERMINATED.value,
                ]),
            )
            .values(
                status=DialogSessionStatus.TERMINATED.value,
                termination_reason=effective_reason,
                completed_at=now,
                version=session.version + 1,
            )
        )
        if result.rowcount == 0:
            logger.debug(
                f"[Session:{str(session.id)[:8]}] Already terminated or version conflict, "
                f"skipping cleanup termination"
            )
            return

        # 刷新获取更新后的状态
        await db.refresh(session)

        owner_ids = [session.initiator_owner_id, session.responder_owner_id]

        # ---- 更新卡片消息状态为 rejected/cancelled ----
        try:
            from src.services.agent_dialog_service import agent_dialog_orchestrator
            await agent_dialog_orchestrator._update_card_messages_status(
                db, session.conversation_id, str(session.id), "rejected",
            )
        except Exception as e:
            logger.warning(f"[Session:{str(session.id)[:8]}] Failed to update card status: {e}")

        # ---- 创建结构化对话状态消息 ----
        _REASON_FALLBACK = {
            "idle_timeout": "Idle timeout",
            "approval_timeout": "Approval request timed out",
            "timeout": "Timeout",
        }
        fallback = _REASON_FALLBACK.get(reason_text, reason_text)
        msg = Message(
            conversation_id=session.conversation_id,
            sender_id=SYSTEM_SENDER_ID,
            sender_type="system",
            content_type="dialog_status",
            content={
                "action": "terminated",
                "reason": reason_text,
                "text": f"Dialog terminated. Reason: {fallback}",
            },
        )
        db.add(msg)
        await db.flush()  # 获取 msg.id / msg.created_at

        # ---- 更新 conversation 未读计数和预览 ----
        conversation = await db.get(Conversation, session.conversation_id)
        if conversation:
            conversation.last_message_preview = f"[System] Dialog terminated. Reason: {fallback}"
            conversation.last_message_at = now
            conversation.updated_at = now

            # 给双方 owner 增加未读
            result = await db.execute(
                select(ConversationParticipant).where(
                    and_(
                        ConversationParticipant.conversation_id == session.conversation_id,
                        ConversationParticipant.participant_type == "human",
                        ConversationParticipant.participant_id.in_(owner_ids),
                    )
                )
            )
            for participant in result.scalars().all():
                participant.unread_count = (participant.unread_count or 0) + 1

        await db.flush()

        # ---- WebSocket: 通知消息 + 终止事件 ----
        # 用 try/except 包裹，确保 WS 通知失败不影响 DB 提交
        try:
            owner_id_strs = [str(oid) for oid in owner_ids]

            # 发送 message.new 让前端知道有新的系统消息
            await ws_manager.broadcast_message(
                owner_id_strs,
                {
                    "type": "message.new",
                    "data": {
                        "id": str(msg.id),
                        "conversation_id": str(session.conversation_id),
                        "sender": {
                            "id": str(SYSTEM_SENDER_ID),
                            "type": "system",
                            "name": "System",
                        },
                        "content_type": "dialog_status",
                        "content": msg.content,
                        "timestamp": msg.created_at.isoformat(),
                    },
                },
            )

            # 发送终止事件（用于更新卡片状态等）
            await ws_manager.send_dialog_terminated(
                user_ids=owner_id_strs,
                session_id=str(session.id),
                conversation_id=str(session.conversation_id),
                termination_reason=reason.value,
                final_round=session.current_round,
            )
        except Exception as ws_err:
            logger.warning(
                f"[Session:{str(session.id)[:8]}] WS notification failed: {ws_err}"
            )

        # ---- 中止 Gateway 上正在进行的 run + 清理内存缓存 ----
        try:
            from src.services.agent_dialog_service import agent_dialog_orchestrator
            await agent_dialog_orchestrator._abort_active_runs(session)
            agent_dialog_orchestrator._cleanup_memory_state(str(session.id))
        except Exception as abort_err:
            logger.warning(
                f"[Session:{str(session.id)[:8]}] abort/cleanup failed: {abort_err}"
            )

        # 广播 message.stop 给前端清理流式消息
        try:
            await ws_manager.broadcast_message(
                owner_id_strs,
                {
                    "type": "message.stop",
                    "data": {"conversation_id": str(session.conversation_id)},
                },
            )
        except Exception:
            pass

        logger.info(
            f"[Session:{str(session.id)[:8]}] Terminated by cleanup task: {reason_text}"
        )


# 全局实例（每 30 秒检查一次，确保超时响应及时）
session_cleanup_task = SessionCleanupTask(check_interval=30)
