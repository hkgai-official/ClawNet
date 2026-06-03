"""
WebSocket 连接管理器

管理用户和 Agent 的 WebSocket 连接，支持实时消息推送。
"""

import uuid
import json
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Optional
from fastapi import WebSocket

from src.utils.security import decode_token

logger = logging.getLogger(__name__)


class ConnectionManager:
    """WebSocket connection manager for real-time messaging.
    
    支持：
    - 用户前端 WebSocket 连接
    - Agent 状态通知
    - Agent 对话会话事件广播
    """

    def __init__(self):
        # user_id -> set of WebSocket connections
        self.active_connections: dict[str, set[WebSocket]] = {}
        # agent_id -> set of owner WebSocket connections (for notifications)
        self.agent_subscriptions: dict[str, set[str]] = {}
        self._lock = asyncio.Lock()
        # nodeId → (user_id, WebSocket) — which client registered this proxy node
        self.proxy_node_registry: dict[str, tuple[str, WebSocket]] = {}
        # WebSocket → set of nodeIds — for cleanup on disconnect (keyed by id(websocket))
        self.ws_proxy_nodes: dict[int, set[str]] = {}
        # Pending node invoke metadata for audit logging
        # Maps invoke_id -> {user_id, command, params_json, node_id, forwarded_at_mono}
        self.pending_invokes: dict[str, dict[str, Any]] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        await self.register(websocket, user_id)

    async def register(self, websocket: WebSocket, user_id: str):
        """Register an already-accepted WebSocket, closing stale connections for the same user."""
        async with self._lock:
            if user_id in self.active_connections:
                old_connections = list(self.active_connections[user_id])
                self.active_connections[user_id] = set()
                for old_ws in old_connections:
                    try:
                        await old_ws.close(code=4001, reason="new_connection")
                    except Exception:
                        pass
                if old_connections:
                    logger.info(
                        f"[WS] Closed {len(old_connections)} stale connection(s) "
                        f"for user {user_id}"
                    )
            else:
                self.active_connections[user_id] = set()
            self.active_connections[user_id].add(websocket)

    async def disconnect(self, websocket: WebSocket, user_id: str):
        async with self._lock:
            if user_id in self.active_connections:
                self.active_connections[user_id].discard(websocket)
                if not self.active_connections[user_id]:
                    del self.active_connections[user_id]

    def is_online(self, user_id: str) -> bool:
        return user_id in self.active_connections

    # 不需要频繁打印日志的消息类型
    _QUIET_MESSAGE_TYPES = {"pong", "message.stream_delta"}

    async def send_to_user(self, user_id: str, message: dict):
        """Send a message to all connections of a user."""
        msg_type = message.get("type", "")
        is_quiet = msg_type in self._QUIET_MESSAGE_TYPES

        if not is_quiet:
            logger.debug("send_to_user: user_id=%s..., type=%s", user_id[:8], msg_type)

        if user_id in self.active_connections:
            disconnected = set()
            for ws in self.active_connections[user_id]:
                try:
                    await ws.send_json(message)
                except Exception as e:
                    logger.warning("Failed to send to user %s...: %s", user_id[:8], e)
                    disconnected.add(ws)
            for ws in disconnected:
                self.active_connections[user_id].discard(ws)
        elif not is_quiet:
            logger.debug("User %s... not in active_connections", user_id[:8])

    async def send_to_users(self, user_ids: list[str], message: dict):
        """Send a message to multiple users."""
        for user_id in user_ids:
            await self.send_to_user(user_id, message)

    async def broadcast_message(self, conversation_participant_ids: list[str], message: dict, exclude_sender: str | None = None) -> list[str]:
        """Broadcast a message to all participants of a conversation.

        Returns:
            list of user_ids that failed to receive the message.
        """
        logger.debug("broadcast_message: participants=%d, exclude=%s", len(conversation_participant_ids), exclude_sender)
        failed: list[str] = []
        for pid in conversation_participant_ids:
            if pid != exclude_sender:
                try:
                    await self.send_to_user(pid, message)
                except Exception as e:
                    logger.warning("broadcast_message failed for %s...: %s", pid[:8], e)
                    failed.append(pid)
        return failed

    # ============ Streaming Response Events ============

    async def send_message_stream_start(
        self,
        participant_ids: list[str],
        message_id: str,
        conversation_id: str,
        sender: dict,
    ):
        """发送流式消息开始事件
        
        通知前端一条新的流式消息即将开始。
        """
        await self.broadcast_message(
            participant_ids,
            {
                "type": "message.stream_start",
                "data": {
                    "message_id": message_id,
                    "conversation_id": conversation_id,
                    "sender": sender,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            },
        )

    async def send_message_stream_delta(
        self,
        participant_ids: list[str],
        message_id: str,
        conversation_id: str,
        delta: str,
        full_text: str,
    ):
        """发送流式消息增量更新
        
        发送新增的文本片段。
        """
        await self.broadcast_message(
            participant_ids,
            {
                "type": "message.stream_delta",
                "data": {
                    "message_id": message_id,
                    "conversation_id": conversation_id,
                    "delta": delta,
                    "full_text": full_text,
                },
            },
        )

    async def send_message_stream_end(
        self,
        participant_ids: list[str],
        message_id: str,
        conversation_id: str,
        final_text: str,
    ):
        """发送流式消息结束事件
        
        通知前端流式消息已完成，提供最终文本。
        """
        await self.broadcast_message(
            participant_ids,
            {
                "type": "message.stream_end",
                "data": {
                    "message_id": message_id,
                    "conversation_id": conversation_id,
                    "final_text": final_text,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            },
        )

    async def send_task_progress(self, user_id: str, task_id: str, conversation_id: str, stage: str, progress: int, details: dict = None):
        """Send task progress update to user."""
        await self.send_to_user(user_id, {
            "type": "task.progress",
            "data": {
                "task_id": task_id,
                "conversation_id": conversation_id,
                "stage": stage,
                "progress": progress,
                "details": details or {},
            },
        })

    async def send_task_completed(self, user_id: str, task_id: str, conversation_id: str, success: bool, summary: str):
        """Send task completion notification to user."""
        await self.send_to_user(user_id, {
            "type": "task.completed",
            "data": {
                "task_id": task_id,
                "conversation_id": conversation_id,
                "success": success,
                "summary": summary,
            },
        })

    async def send_approval_request(self, user_id: str, approval_data: dict):
        """Send approval request to user."""
        await self.send_to_user(user_id, {
            "type": "approval.requested",
            "data": approval_data,
        })

    async def send_typing_indicator(self, conversation_participant_ids: list[str], user_id: str, typing: bool):
        """Send typing indicator to conversation participants."""
        event_type = "typing.start" if typing else "typing.stop"
        await self.broadcast_message(
            conversation_participant_ids,
            {"type": event_type, "data": {"user_id": user_id}},
            exclude_sender=user_id,
        )

    # ============ Agent Dialog Session Events ============

    async def send_dialog_approval_request(
        self,
        owner_id: str,
        session_id: str,
        topic: str,
        initiator_agent: dict,
        initiator_owner: dict,
        responder_agent: dict,
        created_at: datetime,
    ):
        """发送对话授权请求给 Owner
        
        当其他用户的 Agent 想要与当前用户的 Agent 对话时发送。
        """
        await self.send_to_user(owner_id, {
            "type": "dialog.approval_request",
            "data": {
                "session_id": session_id,
                "topic": topic,
                "initiator_agent": initiator_agent,
                "initiator_owner": initiator_owner,
                "responder_agent": responder_agent,
                "created_at": created_at.isoformat(),
            },
        })

    async def send_dialog_status_change(
        self,
        user_ids: list[str],
        session_id: str,
        conversation_id: str,
        old_status: str,
        new_status: str,
        reason: Optional[str] = None,
    ):
        """发送对话状态变更通知
        
        通知参与方 Owner 对话状态变更。
        """
        await self.send_to_users(user_ids, {
            "type": "dialog.status_change",
            "data": {
                "session_id": session_id,
                "conversation_id": conversation_id,
                "old_status": old_status,
                "new_status": new_status,
                "reason": reason,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        })

    async def send_dialog_round_complete(
        self,
        user_ids: list[str],
        session_id: str,
        conversation_id: str,
        current_round: int,
        max_rounds: int,
        speaker_agent_id: str,
        dialog_status: Optional[str] = None,
    ):
        """发送对话轮次完成通知
        
        让 Owner 知道当前对话进展。
        """
        await self.send_to_users(user_ids, {
            "type": "dialog.round_complete",
            "data": {
                "session_id": session_id,
                "conversation_id": conversation_id,
                "current_round": current_round,
                "max_rounds": max_rounds,
                "speaker_agent_id": speaker_agent_id,
                "dialog_status": dialog_status,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        })

    async def send_dialog_terminated(
        self,
        user_ids: list[str],
        session_id: str,
        conversation_id: str,
        termination_reason: str,
        final_round: int,
    ):
        """发送对话终止通知"""
        await self.send_to_users(user_ids, {
            "type": "dialog.terminated",
            "data": {
                "session_id": session_id,
                "conversation_id": conversation_id,
                "termination_reason": termination_reason,
                "final_round": final_round,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        })

    async def send_dialog_completed(
        self,
        user_ids: list[str],
        session_id: str,
        conversation_id: str,
        termination_reason: str,
        final_round: int,
    ):
        """发送对话正常完成通知（区别于异常终止）"""
        await self.send_to_users(user_ids, {
            "type": "dialog.completed",
            "data": {
                "session_id": session_id,
                "conversation_id": conversation_id,
                "termination_reason": termination_reason,
                "final_round": final_round,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        })

    async def send_dialog_paused(
        self,
        user_ids: list[str],
        session_id: str,
        conversation_id: str,
        reason: str,
        current_round: int,
        max_rounds: int,
    ):
        """发送对话暂停通知
        
        当达到轮数上限或检测到死锁时，通知 Owner 决定是否继续。
        """
        await self.send_to_users(user_ids, {
            "type": "dialog.paused",
            "data": {
                "session_id": session_id,
                "conversation_id": conversation_id,
                "reason": reason,
                "current_round": current_round,
                "max_rounds": max_rounds,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "options": ["terminate", "extend"],  # 可选操作
            },
        })

    # ============ Agent Status Events ============

    async def send_agent_status_change(
        self,
        owner_id: str,
        agent_id: str,
        status: str,
        reason: Optional[str] = None,
    ):
        """发送 Agent 状态变更通知给 Owner"""
        await self.send_to_user(owner_id, {
            "type": "agent.status_change",
            "data": {
                "agent_id": agent_id,
                "status": status,
                "reason": reason,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        })

    async def send_agent_connection_status(
        self,
        owner_id: str,
        agent_id: str,
        connected: bool,
        error: Optional[str] = None,
    ):
        """发送 Agent 连接状态通知给 Owner"""
        await self.send_to_user(owner_id, {
            "type": "agent.connection_status",
            "data": {
                "agent_id": agent_id,
                "connected": connected,
                "error": error,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        })


    # ============ Proxy Node Management ============

    def register_proxy_node(self, node_id: str, user_id: str, websocket: WebSocket):
        """Track a proxy node → websocket mapping."""
        self.proxy_node_registry[node_id] = (user_id, websocket)
        ws_key = id(websocket)
        if ws_key not in self.ws_proxy_nodes:
            self.ws_proxy_nodes[ws_key] = set()
        self.ws_proxy_nodes[ws_key].add(node_id)

    def unregister_proxy_node(self, node_id: str):
        """Remove tracking for a single proxy node."""
        entry = self.proxy_node_registry.pop(node_id, None)
        if entry:
            _, ws = entry
            ws_key = id(ws)
            node_set = self.ws_proxy_nodes.get(ws_key)
            if node_set:
                node_set.discard(node_id)
                if not node_set:
                    del self.ws_proxy_nodes[ws_key]

    def get_proxy_node_websocket(self, node_id: str) -> tuple[str, WebSocket] | None:
        """Find the (user_id, websocket) for a proxy nodeId."""
        return self.proxy_node_registry.get(node_id)

    def get_ws_proxy_nodes(self, websocket: WebSocket) -> set[str]:
        """Get all nodeIds registered by a websocket."""
        return self.ws_proxy_nodes.get(id(websocket), set())

    def cleanup_proxy_nodes(self, websocket: WebSocket) -> set[str]:
        """Remove all proxy nodes for a websocket. Returns nodeIds to unregister."""
        ws_key = id(websocket)
        node_ids = self.ws_proxy_nodes.pop(ws_key, set())
        for node_id in node_ids:
            self.proxy_node_registry.pop(node_id, None)
        return node_ids

    def cache_invoke(self, invoke_id: str, metadata: dict[str, Any]) -> None:
        """Cache invoke metadata for audit when result arrives."""
        self.pending_invokes[invoke_id] = metadata

    def pop_invoke(self, invoke_id: str) -> dict[str, Any] | None:
        """Pop cached invoke metadata (returns None if not found or expired)."""
        return self.pending_invokes.pop(invoke_id, None)

    def cleanup_stale_invokes(self, max_age_seconds: int = 300) -> int:
        """Remove pending invoke entries older than max_age_seconds. Returns count removed."""
        import time
        cutoff = time.monotonic() - max_age_seconds
        stale = [k for k, v in self.pending_invokes.items() if v.get("forwarded_at_mono", 0) < cutoff]
        for k in stale:
            del self.pending_invokes[k]
        return len(stale)


# Singleton
ws_manager = ConnectionManager()
