"""
OpenClaw Gateway 连接池服务

为每个用户/Agent 维护独立的 WebSocket 连接到对应的 OpenClaw Gateway。
支持：
- 按需创建连接（首次发消息时）
- 连接复用
- 自动重连（指数退避）
- 用户连接：空闲超时断开
- Agent 连接：跟随 agent 生命周期（无空闲超时）
- 重连期间消息缓冲
"""

import asyncio
import json
import logging
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Optional

import websockets

from src.config import (
    GatewayConfig, 
    get_gateway_config, 
    get_agent_gateway_config,
    settings,
)
from src.database import async_session
from src.schemas.message import SendMessageRequest
from src.services.message_service import send_message as save_message
from src.websocket.manager import ws_manager

logger = logging.getLogger("clawnet.openclaw")


async def _validate_tag_acl_for_node_op(
    user_id: str,
    conversation_id: str,
    command: str,
    params_json: str | None,
) -> tuple[bool, str]:
    """Validate a node operation's file paths against the conversation's resolved tag ACL.

    Returns (allowed, reason).
    When access is denied, writes an AuditLog and pushes an audit event to the user.
    """
    import json
    from src.services import tag_service
    from src.database import AsyncSessionLocal
    from src.models.agent import Agent
    from src.models.audit import AuditLog
    from src.models.conversation import ConversationParticipant
    from src.services.event_service import EventCollector
    from sqlalchemy import select
    import uuid as _uuid

    # Only validate file operations (including new file management commands)
    FILE_COMMANDS = (
        "file.read", "file.write", "file.list", "file.search", "file.stat",
        "file.move", "file.rename", "file.copy", "file.mkdir", "file.trash",
    )
    if command not in FILE_COMMANDS:
        return True, "non-file command"

    # Extract paths from params
    try:
        params = json.loads(params_json) if params_json else {}
    except (json.JSONDecodeError, TypeError):
        params = {}

    path = params.get("path", "")
    paths = params.get("paths", [])
    source = params.get("source", "")
    destination = params.get("destination", "")
    all_paths = (
        ([path] if path else [])
        + (paths if isinstance(paths, list) else [])
        + ([source] if source else [])
        + ([destination] if destination else [])
    )

    if not all_paths:
        return True, "no paths to validate"

    async with AsyncSessionLocal() as db:
        uid = _uuid.UUID(user_id)
        cid = _uuid.UUID(conversation_id)

        # Get conversation participants
        result = await db.execute(
            select(ConversationParticipant)
            .where(ConversationParticipant.conversation_id == cid)
        )
        participants = result.scalars().all()

        # Find tag context: look for the user's own agent or the other party
        other_owner_id = None
        agent_for_audit = None  # Track agent for audit logging
        for p in participants:
            if p.participant_type == "agent":
                agent_result = await db.execute(select(Agent).where(Agent.id == p.participant_id))
                agent = agent_result.scalar_one_or_none()
                if agent and agent.owner_id == uid and agent.tag_id:
                    agent_for_audit = agent
                    tag = await tag_service.resolve_tag_for_agent(db, agent)
                    for file_path in all_paths:
                        allowed, reason = tag_service.validate_node_acl(tag, file_path)
                        if not allowed:
                            deny_reason = f"path '{file_path}': {reason}"
                            await _record_access_denied(
                                db, uid, agent, command, file_path, reason,
                            )
                            return False, deny_reason
                    return True, "all paths allowed by tag ACL"
                elif agent and agent.owner_id != uid:
                    other_owner_id = agent.owner_id
                    agent_for_audit = agent
            elif p.participant_type == "human" and p.participant_id != uid:
                other_owner_id = p.participant_id

        if other_owner_id:
            tag = await tag_service.resolve_tag_for_contact(db, uid, other_owner_id)
            for file_path in all_paths:
                allowed, reason = tag_service.validate_node_acl(tag, file_path)
                if not allowed:
                    deny_reason = f"path '{file_path}': {reason}"
                    await _record_access_denied(
                        db, uid, agent_for_audit, command, file_path, reason,
                    )
                    return False, deny_reason
            return True, "all paths allowed by tag ACL"

    # No tag context — allow (e.g., user chatting with own agent without tag)
    return True, "no tag constraint"


async def _record_boundary_violation(
    user_id: str,
    agent_id: str | None,
    agent_name: str | None,
    tag_name: str | None,
    tag_workspace_id: str | None,
    violation_type: str,
    boundary: str,
    attempted_path: str,
    detail: str,
) -> None:
    """Write an AuditLog entry and push a real-time event for gateway boundary violations."""
    from src.models.audit import AuditLog
    from src.services.event_service import EventCollector

    async with async_session() as db:
        audit = AuditLog(
            agent_id=uuid.UUID(agent_id) if agent_id else None,
            user_id=uuid.UUID(user_id),
            operation_type="boundary_violation",
            operation_details={
                "violation_type": violation_type,
                "boundary": boundary,
                "attempted_path": attempted_path,
                "detail": detail,
                "agent_name": agent_name,
                "tag_name": tag_name,
                "tag_workspace_id": tag_workspace_id,
            },
            result="denied",
        )
        db.add(audit)

        events = EventCollector()
        events.add(db, user_id, "audit.boundary_violation", {
            "audit_id": str(audit.id),
            "agent_id": agent_id,
            "agent_name": agent_name,
            "tag_name": tag_name,
            "violation_type": violation_type,
            "boundary": boundary,
            "attempted_path": attempted_path,
            "detail": detail,
        })

        try:
            await db.commit()
            await events.deliver()
        except Exception as e:
            logger.warning("Failed to record boundary violation audit: %s", e)


async def _record_access_denied(
    db,
    user_id,
    agent,
    command: str,
    file_path: str,
    reason: str,
) -> None:
    """Write an AuditLog entry and push a real-time event when file access is denied."""
    from src.models.audit import AuditLog
    from src.services.event_service import EventCollector

    agent_id = agent.id if agent else None
    agent_name = agent.display_name if agent else "unknown"
    tag_role = agent.tag_role if agent else None

    audit = AuditLog(
        agent_id=agent_id,
        user_id=user_id,
        operation_type="file_access",
        operation_details={
            "command": command,
            "path": file_path,
            "agent_name": agent_name,
            "tag_role": tag_role,
        },
        result="denied",
    )
    db.add(audit)

    events = EventCollector()
    events.add(db, str(user_id), "audit.access_denied", {
        "audit_id": str(audit.id),
        "agent_id": str(agent_id) if agent_id else None,
        "agent_name": agent_name,
        "tag_role": tag_role,
        "command": command,
        "path": file_path,
        "reason": reason,
    })

    try:
        await db.commit()
        await events.deliver()
    except Exception as e:
        logger.warning("Failed to record access denied audit: %s", e)


async def _record_file_operation(
    user_id: str,
    agent_id: str | None,
    command: str,
    params_json: str | None,
    ok: bool,
    error_message: str | None = None,
) -> None:
    """Record a file operation audit log entry (success or failure)."""
    import json
    from src.database import async_session
    from src.models.audit import AuditLog
    from src.services.event_service import EventCollector

    _FILE_COMMANDS = (
        "file.read", "file.write", "file.list", "file.search", "file.stat",
        "file.move", "file.rename", "file.copy", "file.mkdir", "file.trash",
    )
    if command not in _FILE_COMMANDS:
        return

    try:
        params = json.loads(params_json) if params_json else {}
    except (json.JSONDecodeError, TypeError):
        params = {}

    path = params.get("path") or params.get("source") or ""

    try:
        async with async_session() as db:
            import uuid as _uuid
            audit = AuditLog(
                agent_id=_uuid.UUID(agent_id) if agent_id else None,
                user_id=_uuid.UUID(user_id),
                operation_type="file_operation",
                operation_details={
                    "command": command,
                    "path": path,
                    "params": params,
                },
                result="success" if ok else "failed",
            )
            db.add(audit)

            events = EventCollector()
            events.add(db, user_id, "audit.file_operation", {
                "audit_id": str(audit.id),
                "agent_id": agent_id,
                "command": command,
                "path": path,
                "result": "success" if ok else "failed",
                "error": error_message,
            })

            await db.commit()
            await events.deliver()
    except Exception as e:
        logger.warning("Failed to record file operation audit: %s", e)


# 用户连接空闲超时（秒）
# 提高到 10 分钟，因为客户端每 25 秒发 ping 会刷新活跃时间，
# 只有客户端真正离线时才会触发此超时。
USER_IDLE_TIMEOUT = 600


def _ensure_gatewaytoken_query(url: str, token: str) -> str:
    """确保 URL 中包含 gatewaytoken 参数"""
    from urllib.parse import urlencode, urlsplit, urlunsplit
    parts = urlsplit(url)
    query = parts.query or ""
    if "gatewaytoken=" in query:
        return url
    items: dict[str, str] = {}
    if query:
        for item in query.split("&"):
            if not item:
                continue
            if "=" in item:
                k, v = item.split("=", 1)
                items[k] = v
            else:
                items[item] = ""
    items["gatewaytoken"] = token
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(items), parts.fragment))


def _extract_text_from_chat_payload(payload: dict[str, Any]) -> str:
    """从 chat 事件负载中提取文本内容"""
    message = payload.get("message")
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, list):
        texts: list[str] = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                text = part.get("text")
                if isinstance(text, str):
                    texts.append(text)
        return "".join(texts)
    return ""


class ConnectionType(str, Enum):
    """连接类型"""
    USER = "user"
    AGENT = "agent"


class ConnectionStatus(str, Enum):
    """连接状态"""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"


@dataclass
class _RunContext:
    """正在进行的聊天请求上下文"""
    conversation_id: str
    session_key: str
    user_id: str
    participant_ids: list[str]
    agent_id: str
    buffer: str = ""
    created_at: float = field(default_factory=lambda: asyncio.get_event_loop().time())
    # Agent 对话相关
    dialog_session_id: Optional[str] = None
    on_complete: Optional[Callable[[str, str, Optional[str]], None]] = None  # callback(run_id, final_text, streaming_message_id)
    # 流式响应相关
    streaming_message_id: Optional[str] = None  # 流式消息的临时 ID
    stream_started: bool = False  # 是否已发送 stream_start
    last_stream_time: float = 0  # 上次发送流式更新的时间
    last_clean_buffer: str = ""  # 上次广播的清洗后内容（用于计算增量）
    pending_suspect: str = ""  # 疑似特殊标记的悬挂缓冲区


@dataclass
class BufferedMessage:
    """重连期间缓冲的消息"""
    request: dict[str, Any]
    context: _RunContext
    timestamp: float = field(default_factory=lambda: asyncio.get_event_loop().time())


class GatewayConnection:
    """OpenClaw Gateway 连接（支持用户和 Agent）
    
    重构自 UserGatewayConnection，新增：
    - 连接类型区分（user/agent）
    - Agent 连接无空闲超时
    - 指数退避重连
    - 重连期间消息缓冲
    """

    def __init__(
        self, 
        entity_id: str, 
        config: GatewayConfig, 
        connection_type: ConnectionType = ConnectionType.USER
    ):
        self.entity_id = entity_id  # user_id 或 agent_id
        self.config = config
        self.connection_type = connection_type
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()
        self._connected = asyncio.Event()
        self._send_lock = asyncio.Lock()
        self._last_activity = asyncio.get_event_loop().time()
        self._last_error: Optional[str] = None
        self._last_connected_at: Optional[datetime] = None
        self._status = ConnectionStatus.DISCONNECTED
        self._reconnect_attempts = 0

        # 请求和响应追踪
        self._pending_responses: dict[str, asyncio.Future] = {}
        self._pending_chat_requests: dict[str, _RunContext] = {}
        self._runs: dict[str, _RunContext] = {}
        # 当前连接希望接收 chat 事件的会话集合（用于 heartbeat proactive）
        self._subscribed_sessions: set[str] = set()
        # node.event(chat.subscribe) 在 operator 角色下会被 gateway 拒绝，探测一次后禁用。
        self._node_event_supported = True
        # 已注册的 proxy nodes（用于重连后自动重新注册）
        self._registered_proxy_nodes: dict[str, dict[str, Any]] = {}  # nodeId -> {commands, displayName, ...}
        
        # 消息缓冲（重连期间）
        self._message_buffer: deque[BufferedMessage] = deque(
            maxlen=settings.AGENT_DIALOG_MESSAGE_BUFFER_SIZE
        )

        # Pending dialog intent authorizations (awaiting user approval before A2A)
        # Maps authorization_id -> context dict
        self._pending_intent_auths: dict[str, dict[str, Any]] = {}

    @property
    def connected(self) -> bool:
        return self._connected.is_set()

    @property
    def status(self) -> ConnectionStatus:
        return self._status

    @property
    def last_error(self) -> Optional[str]:
        return self._last_error

    @property
    def last_connected_at(self) -> Optional[datetime]:
        return self._last_connected_at

    @property
    def idle_seconds(self) -> float:
        return asyncio.get_event_loop().time() - self._last_activity

    @property
    def is_agent_connection(self) -> bool:
        return self.connection_type == ConnectionType.AGENT

    def _log_prefix(self) -> str:
        type_str = "Agent" if self.is_agent_connection else "User"
        return f"[{type_str}:{self.entity_id[:8]}]"

    def has_active_run_for_session(self, session_key: str) -> bool:
        """检查指定 session_key 是否有正在进行的 Gateway run"""
        for ctx in self._runs.values():
            if ctx.session_key == session_key:
                return True
        return False

    def touch(self):
        """更新最后活动时间"""
        self._last_activity = asyncio.get_event_loop().time()

    def start(self):
        """启动连接"""
        if self._task and not self._task.done():
            return
        self._stop_event.clear()
        self._status = ConnectionStatus.CONNECTING
        self._task = asyncio.create_task(self._run_forever())

    async def stop(self):
        """停止连接"""
        self._stop_event.set()
        self._connected.clear()
        self._status = ConnectionStatus.DISCONNECTED

        # Deny all pending intent authorizations (connection going away)
        pending = list(self._pending_intent_auths.items())
        self._pending_intent_auths.clear()
        for auth_id, ctx in pending:
            try:
                await self._handle_intent_auth_denied(ctx, reason="connection_closed")
            except Exception:
                pass

        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run_forever(self):
        """保持连接的主循环，支持指数退避重连"""
        backoff = 1.0
        max_backoff = settings.AGENT_DIALOG_RECONNECT_BACKOFF_CAP
        max_attempts = settings.AGENT_DIALOG_MAX_RECONNECT_ATTEMPTS

        while not self._stop_event.is_set():
            try:
                logger.info(f"{self._log_prefix()} Connecting to OpenClaw Gateway...")
                self._status = ConnectionStatus.CONNECTING if self._reconnect_attempts == 0 else ConnectionStatus.RECONNECTING
                
                await self._connect_and_listen()
                
                # 连接成功，重置重连计数
                backoff = 1.0
                self._reconnect_attempts = 0
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                self._connected.clear()
                self._last_error = str(e)
                self._reconnect_attempts += 1
                self._status = ConnectionStatus.RECONNECTING
                
                logger.warning(
                    f"{self._log_prefix()} Gateway disconnected: {e}, "
                    f"attempt {self._reconnect_attempts}/{max_attempts}"
                )
                
                # Agent 连接：超过重连次数上限则走下线流程
                if self.is_agent_connection and self._reconnect_attempts >= max_attempts:
                    logger.error(
                        f"{self._log_prefix()} Max reconnect attempts reached, "
                        "marking agent as offline"
                    )
                    self._status = ConnectionStatus.DISCONNECTED
                    # 通知调用方（通过回调或事件）
                    break
                
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, max_backoff)

    async def _connect_and_listen(self):
        """连接并监听消息"""
        url = _ensure_gatewaytoken_query(self.config.ws_url, self.config.token)
        logger.info(f"{self._log_prefix()} Gateway URL: {url}")

        from urllib.parse import urlparse
        parsed = urlparse(self.config.ws_url)
        origin_scheme = "https" if parsed.scheme == "wss" else "http"
        ws_origin = f"{origin_scheme}://{parsed.netloc}"

        async with websockets.connect(url, open_timeout=8, ping_interval=20, origin=ws_origin) as ws:
            self._ws = ws
            await self._handshake(ws)
            self._connected.set()
            self._last_error = None
            self._last_connected_at = datetime.now(timezone.utc)
            self._status = ConnectionStatus.CONNECTED
            self.touch()
            logger.info(f"{self._log_prefix()} Gateway connected and handshake OK.")

            # 重连后先恢复 chat 订阅，避免 proactive 消息丢失。
            await self._resubscribe_chat_sessions()

            # 重连后重新注册 proxy nodes
            await self._reregister_proxy_nodes()

            # 重连后发送缓冲的消息
            await self._flush_message_buffer()

            while not self._stop_event.is_set():
                raw = await ws.recv()
                if not isinstance(raw, str):
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                await self._handle_gateway_message(msg)

    async def _handshake(self, ws):
        """执行连接握手"""
        # Wait for challenge
        challenge = None
        deadline = asyncio.get_event_loop().time() + 8
        while asyncio.get_event_loop().time() < deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=2)
            if not isinstance(raw, str):
                continue
            obj = json.loads(raw)
            if obj.get("type") == "event" and obj.get("event") == "connect.challenge":
                challenge = obj
                break
        if not challenge:
            raise RuntimeError("Handshake failed: no connect.challenge")

        req_id = f"connect-{uuid.uuid4()}"
        connect_req = {
            "type": "req",
            "id": req_id,
            "method": "connect",
            "params": {
                "minProtocol": 3,
                "maxProtocol": 3,
                "client": {
                    "id": self.config.client_id,
                    "version": "0.1.0",
                    "platform": "web",
                    "mode": "webchat",
                },
                "role": "operator",
                "scopes": ["operator.admin", "operator.write"],
                "caps": [],
                "commands": [],
                "permissions": {},
                "auth": {"token": self.config.token},
                "locale": "zh-CN",
                "userAgent": "clawnet-backend/0.1.0",
            },
        }
        await ws.send(json.dumps(connect_req, ensure_ascii=False))

        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=8)
            if not isinstance(raw, str):
                continue
            obj = json.loads(raw)
            if obj.get("type") == "res" and obj.get("id") == req_id:
                if obj.get("ok") is True:
                    return
                err = obj.get("error") or {}
                raise RuntimeError(f"Connect rejected: {err.get('code')} {err.get('message')}")

    async def _handle_gateway_message(self, msg: dict[str, Any]):
        """处理 Gateway 消息"""
        msg_type = msg.get("type")

        if msg_type == "res":
            req_id = msg.get("id")
            if isinstance(req_id, str):
                fut = self._pending_responses.pop(req_id, None)
                if fut and not fut.done():
                    fut.set_result(msg)
                # chat.send ack 返回 runId，绑定请求上下文
                payload = msg.get("payload") or {}
                run_id = payload.get("runId")
                if isinstance(run_id, str):
                    ctx = self._pending_chat_requests.pop(req_id, None)
                    if ctx:
                        self._runs[run_id] = ctx
            return

        if msg_type != "event":
            return

        event = msg.get("event")
        payload = msg.get("payload") or {}

        # 聚合 agent 事件中的助手流式输出
        if event == "agent":
            run_id = payload.get("runId")
            stream = payload.get("stream")
            data = payload.get("data") or {}
            if isinstance(run_id, str) and stream == "assistant" and isinstance(data, dict):
                delta = data.get("delta")
                if isinstance(delta, str):
                    ctx = self._runs.get(run_id)
                    if ctx:
                        old_buffer = ctx.buffer
                        ctx.buffer += delta
                        # 流式广播（根据场景判断是否启用）
                        if self._should_stream(ctx):
                            await self._broadcast_stream_delta(ctx, run_id, delta, old_buffer)
            if isinstance(run_id, str) and stream == "lifecycle" and isinstance(data, dict):
                if data.get("phase") == "end":
                    await self._finalize_run(run_id)
            return

        # chat 事件是最终状态的权威来源
        if event == "chat":
            run_id = payload.get("runId")
            if not isinstance(run_id, str):
                return
            state = payload.get("state")
            text = _extract_text_from_chat_payload(payload)

            if str(run_id).startswith("hb-"):
                logger.info(
                    "[OPENCLAW] Chat event runId=hb-* (proactive): run_id=%s state=%s session_key=%s",
                    run_id[:30],
                    state,
                    (payload.get("sessionKey") or "")[-50:],
                )

            ctx = self._runs.get(run_id)
            if not ctx:
                if state == "final" and text and str(run_id).startswith("hb-"):
                    session_key = payload.get("sessionKey")
                    if isinstance(session_key, str) and "clawnet:" in session_key:
                        logger.info(
                            "[OPENCLAW] Proactive chat received: run_id=%s session_key=%s text_len=%s",
                            run_id[:24], session_key[-40:], len(text),
                        )
                        await self._handle_proactive_chat(
                            session_key=session_key,
                            text=text,
                            run_id=run_id,
                        )
                    elif isinstance(session_key, str):
                        logger.info(
                            "[OPENCLAW] Proactive chat skipped: sessionKey missing 'clawnet:', key=%s",
                            session_key[:80],
                        )
                return

            if state == "delta" and text:
                if len(text) > len(ctx.buffer):
                    old_buffer = ctx.buffer
                    ctx.buffer = text
                    # 流式广播
                    if self._should_stream(ctx):
                        delta_text = text[len(old_buffer):]
                        if delta_text:
                            await self._broadcast_stream_delta(ctx, run_id, delta_text, old_buffer)
            elif state in {"final", "aborted", "error"}:
                if text:
                    ctx.buffer = text
                await self._finalize_run(run_id)
            return

        if event == "node.invoke.request":
            # Forward node.invoke.request to the macOS app that registered this proxy node
            invoke_id = payload.get("id")
            node_id = payload.get("nodeId")
            command = payload.get("command")
            params_json = payload.get("paramsJSON")
            timeout_ms = payload.get("timeoutMs")

            logger.info(f"{self._log_prefix()} node.invoke.request: id={invoke_id} node={node_id} cmd={command}")

            # Tag ACL enforcement: find active run context for conversation
            _FILE_ACL_COMMANDS = (
                "file.read", "file.write", "file.list", "file.search", "file.stat",
                "file.move", "file.rename", "file.copy", "file.mkdir", "file.trash",
            )
            if command in _FILE_ACL_COMMANDS:
                # Find any active run to get conversation context
                active_ctx = next(iter(self._runs.values()), None) if self._runs else None
                if active_ctx:
                    try:
                        allowed, reason = await _validate_tag_acl_for_node_op(
                            user_id=active_ctx.user_id,
                            conversation_id=active_ctx.conversation_id,
                            command=command,
                            params_json=params_json,
                        )
                        if not allowed:
                            logger.warning(f"{self._log_prefix()} Tag ACL denied node invoke: {reason}")
                            try:
                                await self.send_node_invoke_result(
                                    invoke_id=invoke_id, node_id=node_id, ok=False,
                                    error={"code": "TAG_ACL_DENIED", "message": f"Tag ACL denied: {reason}"}
                                )
                            except Exception:
                                pass
                            return
                    except Exception as e:
                        logger.warning(f"{self._log_prefix()} Tag ACL check failed (allowing): {e}")

            target = ws_manager.get_proxy_node_websocket(node_id)
            if not target:
                logger.warning(f"{self._log_prefix()} No client found for proxy node {node_id}")
                try:
                    await self.send_node_invoke_result(
                        invoke_id=invoke_id, node_id=node_id, ok=False,
                        error={"code": "NODE_CLIENT_OFFLINE", "message": "Proxy node client disconnected"}
                    )
                except Exception:
                    pass
                return

            target_user_id, target_ws = target

            blob_endpoint = self._build_blob_endpoint_for_client(target_user_id)

            # Resolve tag ACL for the macOS client's defense-in-depth check
            workspace_root = None
            tag_acl = None
            active_ctx = next(iter(self._runs.values()), None) if self._runs else None
            if active_ctx:
                try:
                    from src.services import tag_service as _ts
                    from src.database import AsyncSessionLocal as _ASL
                    import uuid as _uid
                    async with _ASL() as _db:
                        _tctx = await _ts.resolve_conversation_context(
                            _db, _uid.UUID(active_ctx.user_id), _uid.UUID(active_ctx.conversation_id)
                        )
                        tag_acl = _tctx.get("node_acl")
                        # Resolve workspace root path for .clawnet creation (host-visible path)
                        from src.models.user import User as _User
                        _user = await _db.get(_User, _uid.UUID(active_ctx.user_id))
                        if _user:
                            from src.services.provision_service import get_workspace_host_path
                            workspace_root = get_workspace_host_path(_user)
                except Exception:
                    pass

            invoke_data: dict[str, Any] = {
                "id": invoke_id,
                "nodeId": node_id,
                "command": command,
                "paramsJSON": params_json,
                "timeoutMs": timeout_ms,
                "blobEndpoint": blob_endpoint,
            }
            if tag_acl:
                invoke_data["tagNodeAcl"] = tag_acl
            if workspace_root:
                invoke_data["workspaceRoot"] = workspace_root

            # Cache invoke metadata for audit recording when result arrives (file ops only)
            import time
            if command in _FILE_ACL_COMMANDS:
                ws_manager.cache_invoke(invoke_id, {
                    "user_id": active_ctx.user_id if active_ctx else target_user_id,
                    "agent_id": active_ctx.agent_id if active_ctx else None,
                    "conversation_id": active_ctx.conversation_id if active_ctx else None,
                    "command": command,
                    "params_json": params_json,
                    "node_id": node_id,
                    "forwarded_at_mono": time.monotonic(),
                })

            try:
                await target_ws.send_json({
                    "type": "node.invoke.request",
                    "data": invoke_data,
                })
            except Exception as e:
                logger.warning(f"{self._log_prefix()} Failed to forward invoke to client: {e}")
                try:
                    await self.send_node_invoke_result(
                        invoke_id=invoke_id, node_id=node_id, ok=False,
                        error={"code": "FORWARD_FAILED", "message": str(e)}
                    )
                except Exception:
                    pass
            return

        if event == "audit":
            await self._handle_audit_event(payload)
            return

    async def _handle_audit_event(self, payload: dict[str, Any]) -> None:
        """Handle boundary violation audit events from the gateway."""
        violation_type = payload.get("violationType")
        if not violation_type:
            return

        session_key = payload.get("sessionKey")
        tag_name = payload.get("tagName") or payload.get("tagWorkspaceId") or "unresolved"
        tag_workspace_id = payload.get("tagWorkspaceId")
        boundary = payload.get("boundary", "")
        attempted_path = payload.get("attemptedPath", "")
        detail = payload.get("detail", "")

        # Resolve user_id and agent info from active run contexts.
        user_id: str | None = None
        agent_id: str | None = None
        agent_name: str | None = None

        if session_key:
            for ctx in self._runs.values():
                if ctx.session_key == session_key:
                    user_id = ctx.user_id
                    agent_id = ctx.agent_id
                    break
            # If session_key was provided but not found in this connection's runs,
            # skip — the correct connection (where the agent is actually running)
            # will handle it. This prevents cross-user audit event leaks in A2A
            # caused by gateway global broadcast.
            if not user_id:
                return

        # Fall back to entity_id (connection owner) only when no session_key.
        if not user_id:
            user_id = self.entity_id

        if not user_id:
            logger.warning("audit event with no resolvable user_id, skipping")
            return

        # Resolve agent display name from DB if possible.
        if agent_id and not agent_name:
            try:
                from sqlalchemy import select
                from src.models.agent import Agent
                async with async_session() as db:
                    result = await db.execute(
                        select(Agent.display_name).where(Agent.id == uuid.UUID(agent_id))
                    )
                    agent_name = result.scalar_one_or_none()
            except Exception:
                pass

        logger.info(
            "%s audit boundary_violation: type=%s tag=%s path=%s",
            self._log_prefix(), violation_type, tag_name, attempted_path[:100],
        )

        try:
            await _record_boundary_violation(
                user_id=user_id,
                agent_id=agent_id,
                agent_name=agent_name,
                tag_name=tag_name,
                tag_workspace_id=tag_workspace_id,
                violation_type=violation_type,
                boundary=boundary,
                attempted_path=attempted_path,
                detail=detail,
            )
        except Exception as e:
            logger.warning("Failed to record boundary violation: %s", e)

    def _gateway_blob_http_base(self) -> str:
        """Derive the Gateway HTTP base URL from the WebSocket URL (internal use only)."""
        from urllib.parse import urlparse
        parsed = urlparse(self.config.ws_url)
        scheme = "https" if parsed.scheme == "wss" else "http"
        return f"{scheme}://{parsed.netloc}"

    def _build_blob_endpoint_for_client(self, user_id: str) -> dict:
        """Build blobEndpoint dict for forwarding to App clients.

        Points to the server's own blob proxy (/api/v1/gateway/blobs)
        with a short-lived JWT token for the user.
        """
        from src.config import settings
        from src.utils.security import create_access_token
        from datetime import timedelta

        base_url = settings.SERVER_EXTERNAL_URL.rstrip("/") if settings.SERVER_EXTERNAL_URL else ""
        if not base_url:
            base_url = f"http://localhost:{settings.PORT}"

        token = create_access_token(user_id, expires_delta=timedelta(minutes=10))
        return {
            "httpBaseURL": f"{base_url}/api/v1/gateway",
            "token": token,
        }

    def _should_stream(self, ctx: _RunContext) -> bool:
        """判断是否应该启用流式输出
        
        根据配置和场景类型决定：
        - 用户与 Agent 对话：由 ENABLE_STREAMING_USER_CHAT 控制
        - Agent 与 Agent 对话：由 ENABLE_STREAMING_AGENT_DIALOG 控制
        """
        is_agent_dialog = ctx.on_complete is not None or ctx.dialog_session_id is not None
        if is_agent_dialog:
            return settings.ENABLE_STREAMING_AGENT_DIALOG
        else:
            return settings.ENABLE_STREAMING_USER_CHAT

    # 用于检测原始 buffer 中是否存在未闭合的特殊标记（悬挂检测）
    # 两层防线：
    #   1. _SUSPECT_RAW_PATTERN: 扫描原始 buffer，检测未闭合的 << 或 [ 标记
    #   2. _SUSPECT_TAIL_PATTERN: 扫描 clean_buffer 末尾，检测残留碎片
    import re as _re
    
    # 检测原始 buffer 中未闭合的特殊标记（任意位置）
    # 匹配 "<<" 开始但没有对应 ">>" 闭合的片段
    _SUSPECT_RAW_PATTERN = _re.compile(
        r'<<(?:NEED_AGENT_DIALOG|[A-Z_]+)[^>]*$'  # << 开头的标记未闭合（到文本末尾都没有 >>）
        r'|'
        r'<(?:/?(?:antml:)?(?:function_calls|invoke|parameter|tool_use|tool_result))[^>]*$'  # XML 标签未闭合
        r'|'
        r'\[(?:/?AGENT_DIALOG|系统指令)[^\]]*$',  # [...] 标记未闭合
        _re.DOTALL
    )
    
    # clean_buffer 末尾的碎片检测（_clean_agent_response 可能残留部分字符）
    _SUSPECT_TAIL_PATTERN = _re.compile(
        r'(?:'
        r'<{1,2}(?:/?(?:antml:)?(?:function_calls|invoke|parameter|tool_use|tool_result|NEED_AGENT_DIALOG)[^>]*)?'  # XML/<< 标记
        r'|'
        r'NEED_AGENT_DIALOG[^>]*'  # 裸露的 NEED_AGENT_DIALOG（<< 被清除后残留）
        r'|'
        r'\[(?:/?AGENT_DIALOG|系统指令)[^\]]*'  # [...] 标记
        r')$'
    )

    async def _broadcast_stream_delta(
        self,
        ctx: _RunContext,
        run_id: str,
        delta: str,
        old_buffer: str,
    ):
        """广播流式增量更新到前端
        
        核心策略（三层防线）：
        1. 检测原始 buffer 中是否有未闭合的特殊标记 → 有则暂缓整个广播
        2. 清洗已累积的完整文本，过滤掉已闭合的特殊标记
        3. 检测 clean_buffer 末尾是否有残留碎片 → 有则截断到安全位置
        """
        import time
        from src.services.agent_dialog_service import _clean_agent_response
        
        # 节流：避免过于频繁的广播
        current_time = time.time() * 1000  # 毫秒
        if current_time - ctx.last_stream_time < settings.STREAMING_CHUNK_INTERVAL_MS:
            return
        ctx.last_stream_time = current_time
        
        # 第一层防线：检测原始 buffer 中是否有未闭合的特殊标记
        # 这是最关键的检测——在清洗之前拦截，避免半成品标记泄漏
        raw_suspect = self._SUSPECT_RAW_PATTERN.search(ctx.buffer)
        if raw_suspect:
            # 原始 buffer 中有未闭合标记，暂缓广播
            # 但仍然可以广播标记出现之前的安全部分
            safe_raw = ctx.buffer[:raw_suspect.start()]
            if not safe_raw.strip():
                # 标记在 buffer 开头或之前没有可用内容，暂不广播
                return
            # 只清洗标记之前的部分
            clean_buffer = _clean_agent_response(safe_raw)
        else:
            # 没有未闭合标记，清洗整个 buffer
            clean_buffer = _clean_agent_response(ctx.buffer)
        
        if not clean_buffer:
            return
        
        # 第二层防线：检测 clean_buffer 末尾是否有残留碎片
        # 例如 _clean_agent_response 可能保留了部分未识别的标记碎片
        safe_buffer = clean_buffer
        suspect_match = self._SUSPECT_TAIL_PATTERN.search(clean_buffer)
        if suspect_match:
            # 找到了可疑的尾部，只广播到可疑部分之前
            safe_buffer = clean_buffer[:suspect_match.start()]
            if not safe_buffer:
                # 整段内容都是可疑的，暂不广播
                return
        
        # 与上次广播内容比较
        if safe_buffer == ctx.last_clean_buffer:
            return
        
        clean_delta = safe_buffer[len(ctx.last_clean_buffer):] if safe_buffer.startswith(ctx.last_clean_buffer) else safe_buffer
        ctx.last_clean_buffer = safe_buffer
        
        if not clean_delta:
            return

        # A2A dialogs: do NOT broadcast streaming to users.
        # The response will be held as a draft for human review instead.
        if ctx.on_complete:
            return

        # 如果还没开始流式，先发送 stream_start
        if not ctx.stream_started:
            ctx.stream_started = True
            ctx.streaming_message_id = f"stream-{run_id}"
            
            sender = await self._get_agent_sender_info(ctx.agent_id)
            
            await ws_manager.send_message_stream_start(
                participant_ids=ctx.participant_ids,
                message_id=ctx.streaming_message_id,
                conversation_id=ctx.conversation_id,
                sender=sender,
            )
        
        # 发送安全的增量更新
        await ws_manager.send_message_stream_delta(
            participant_ids=ctx.participant_ids,
            message_id=ctx.streaming_message_id,
            conversation_id=ctx.conversation_id,
            delta=clean_delta,
            full_text=safe_buffer,
        )

    async def _get_agent_sender_info(self, agent_id: str) -> dict:
        """获取 Agent 的 sender 信息"""
        try:
            async with async_session() as db:
                from src.models.agent import Agent
                from src.models.user import User
                agent = await db.get(Agent, uuid.UUID(agent_id))
                if agent:
                    owner = await db.get(User, agent.owner_id)
                    return {
                        "id": str(agent.id),
                        "name": agent.display_name,
                        "type": "agent",
                        "avatar": agent.avatar_url,
                        "owner_id": str(agent.owner_id),
                        "owner_name": owner.display_name if owner else None,
                    }
        except Exception as e:
            logger.warning(f"Failed to get agent sender info: {e}")
        return {
            "id": agent_id,
            "name": "Assistant",
            "type": "agent",
        }

    async def _finalize_run(self, run_id: str):
        """完成一个聊天请求，保存并广播消息"""
        ctx = self._runs.pop(run_id, None)
        if not ctx:
            return
        final_text = (ctx.buffer or "").strip()
        if not final_text:
            # 如果启用了流式但没有内容，发送流式结束
            if ctx.stream_started:
                await ws_manager.send_message_stream_end(
                    participant_ids=ctx.participant_ids,
                    message_id=ctx.streaming_message_id,
                    conversation_id=ctx.conversation_id,
                    final_text="",
                )
            return

        print(f"[OPENCLAW]{self._log_prefix()} Finalizing run: {run_id}", flush=True)

        # 如果有回调（Agent 对话场景），调用回调而不是保存消息
        # Note: A2A streaming is disabled in _handle_stream_delta (ctx.on_complete check),
        # so ctx.stream_started should always be False here. This block is kept for safety.
        if ctx.on_complete:
            if ctx.stream_started:
                from src.services.agent_dialog_service import _clean_agent_response
                await ws_manager.send_message_stream_end(
                    participant_ids=ctx.participant_ids,
                    message_id=ctx.streaming_message_id,
                    conversation_id=ctx.conversation_id,
                    final_text=_clean_agent_response(final_text),
                )
            try:
                ctx.on_complete(run_id, final_text, ctx.streaming_message_id if ctx.stream_started else None)
            except Exception as e:
                logger.error(f"{self._log_prefix()} on_complete callback error: {e}")
            return

        # 保留原始文本用于意图检测（包含 <<NEED_AGENT_DIALOG:...>> 等标记）
        raw_text = final_text
        
        # 清洗 Agent 回复中的 LLM 杂质（用于保存和展示）
        from src.services.agent_dialog_service import _clean_agent_response
        final_text = _clean_agent_response(final_text)
        if not final_text:
            return

        # 用户消息场景：保存并广播
        async with async_session() as db:
            try:
                msg = await save_message(
                    db=db,
                    conv_id=uuid.UUID(ctx.conversation_id),
                    sender_id=uuid.UUID(ctx.agent_id),
                    sender_type="agent",
                    req=SendMessageRequest(
                        content_type="text",
                        content={"text": final_text},
                        metadata={"source": "openclaw", "run_id": run_id},
                    ),
                )
                await db.commit()
                print(f"[OPENCLAW]{self._log_prefix()} Message saved: {msg.id}", flush=True)
                
                # 意图检测：使用原始文本（包含标记），检查是否需要发起 Agent 间对话
                await self._check_dialog_intent(db, ctx, raw_text, msg)
                
                # 提交意图检测中可能产生的数据库操作
                # （如创建 A2A 对话会话、更新 msg.content 清除标记等）
                await db.commit()
                
                # 如果启用了流式，发送流式结束事件（带真实消息ID）
                if ctx.stream_started:
                    await ws_manager.send_message_stream_end(
                        participant_ids=ctx.participant_ids,
                        message_id=ctx.streaming_message_id,
                        conversation_id=ctx.conversation_id,
                        final_text=final_text,
                    )
                    # 流式模式下，前端已经显示了内容，发送 message.new 用于持久化和状态更新
                    broadcast_data = {
                        "type": "message.new",
                        "data": {
                            "id": str(msg.id),
                            "conversation_id": str(msg.conversation_id),
                            "sender": msg.sender.model_dump(mode="json"),
                            "content_type": msg.content_type,
                            "content": msg.content,
                            "timestamp": msg.timestamp.isoformat(),
                            "metadata": msg.metadata,
                            "streaming_message_id": ctx.streaming_message_id,  # 关联流式消息
                        },
                    }
                else:
                    # 非流式模式，正常广播
                    broadcast_data = {
                        "type": "message.new",
                        "data": {
                            "id": str(msg.id),
                            "conversation_id": str(msg.conversation_id),
                            "sender": msg.sender.model_dump(mode="json"),
                            "content_type": msg.content_type,
                            "content": msg.content,
                            "timestamp": msg.timestamp.isoformat(),
                            "metadata": msg.metadata,
                        },
                    }
                
            except Exception as e:
                print(f"[OPENCLAW]{self._log_prefix()} Failed to save message: {e}", flush=True)
                await db.rollback()
                return

        await ws_manager.broadcast_message(ctx.participant_ids, broadcast_data)
        print(f"[OPENCLAW]{self._log_prefix()} Broadcast done", flush=True)

        # Trigger summary generation for agent conversations
        try:
            await self._maybe_trigger_summary(ctx.conversation_id)
        except Exception as e:
            logger.warning("Summary trigger failed: %s", e)

    async def _maybe_trigger_summary(self, conversation_id: str) -> None:
        """Check and trigger summary generation after a message is saved."""
        from src.models.conversation import Conversation, ConversationParticipant
        from src.models.message import Message
        from sqlalchemy import func, select

        print(f"[SUMMARY] _maybe_trigger_summary called for conv={conversation_id[:8]}", flush=True)

        async with async_session() as db:
            conv = await db.get(Conversation, uuid.UUID(conversation_id))
            if not conv or conv.type != "direct":
                print(f"[SUMMARY] Skipped: conv not found or type={conv.type if conv else 'None'}", flush=True)
                return

            # Check agent participant
            result = await db.execute(
                select(ConversationParticipant).where(
                    ConversationParticipant.conversation_id == uuid.UUID(conversation_id),
                    ConversationParticipant.participant_type == "agent",
                )
            )
            if not result.scalar_one_or_none():
                print(f"[SUMMARY] Skipped: no agent participant", flush=True)
                return

            # Count text messages
            count_result = await db.execute(
                select(func.count()).select_from(Message).where(
                    Message.conversation_id == uuid.UUID(conversation_id),
                    Message.content_type == "text",
                )
            )
            msg_count = count_result.scalar()

            print(f"[SUMMARY] conv={conversation_id[:8]} msg_count={msg_count} summary_version={conv.summary_version}", flush=True)

            from src.services.summary_service import generate_and_save_summary
            import asyncio

            if msg_count >= 2 and conv.summary_version == 0:
                print(f"[SUMMARY] Triggering v1 generation for conv={conversation_id[:8]}", flush=True)
                asyncio.create_task(generate_and_save_summary(
                    conversation_id=conversation_id,
                    max_messages=2,
                    target_version=1,
                ))
            elif msg_count in (4, 5, 6) and conv.summary_version == 1:
                print(f"[SUMMARY] Triggering v2 refinement for conv={conversation_id[:8]}", flush=True)
                asyncio.create_task(generate_and_save_summary(
                    conversation_id=conversation_id,
                    max_messages=8,
                    target_version=2,
                ))
            else:
                print(f"[SUMMARY] No trigger needed", flush=True)

    async def _check_dialog_intent(self, db, ctx: "_RunContext", text: str, msg):
        """检查 Agent 回复中是否有与其他 Agent 对话的意图

        支持单标记和多标记。
        检测到意图后，先请求发起方用户授权，而非直接发起 A2A 对话。
        """
        try:
            from src.services.intent_parser import extract_dialog_intents
            from src.models.agent import Agent
            from src.models.user import User
            from sqlalchemy import select

            # 解析所有标记
            cleaned_text, intents = extract_dialog_intents(text)

            if not intents:
                return

            logger.info(
                f"{self._log_prefix()} LLM dialog intent(s) detected: "
                f"{len(intents)} target(s)"
            )

            # 获取当前 Agent 信息
            agent = await db.get(Agent, uuid.UUID(ctx.agent_id))
            if not agent:
                return

            # 检查是否已有关联的运行中 DiscoveryTask（链式发现追加查询）
            from src.services.discovery_service import discovery_orchestrator
            existing_task = await discovery_orchestrator.get_task_by_conversation(
                db, uuid.UUID(ctx.conversation_id)
            )

            if existing_task and existing_task.status in ("running", "completing"):
                # 链式发现：追加新查询到现有任务（不需要再次授权）
                new_queries = [
                    {"target_owner": i.target_owner, "topic": i.topic}
                    for i in intents
                ]
                await discovery_orchestrator.add_queries_to_task(
                    db, str(existing_task.id), new_queries
                )
                msg.content["text"] = cleaned_text
                logger.info(
                    f"{self._log_prefix()} Chain discovery: added {len(new_queries)} "
                    f"queries to task {str(existing_task.id)[:8]}"
                )
                return

            # Pre-resolve targets to validate existence before asking user
            resolved_targets = []
            for intent in intents:
                result = await db.execute(
                    select(User).where(User.display_name == intent.target_owner)
                )
                target_user = result.scalar_one_or_none()
                if not target_user:
                    escaped = intent.target_owner.replace('%', r'\%').replace('_', r'\_')
                    result = await db.execute(
                        select(User).where(User.display_name.ilike(f'%{escaped}%'))
                    )
                    target_user = result.scalar_one_or_none()

                if not target_user:
                    continue

                result = await db.execute(
                    select(Agent).where(
                        Agent.owner_id == target_user.id,
                        Agent.status == "online"
                    ).order_by(Agent.created_at.desc()).limit(1)
                )
                target_agent = result.scalar_one_or_none()
                if not target_agent:
                    continue

                # Resolve the initiator's contact tag for this target
                # (what tag did I assign to this person — my perspective)
                from src.services import tag_service
                contact_tag = await tag_service.resolve_tag_for_contact(
                    db, uuid.UUID(ctx.user_id), target_user.id
                )

                resolved_targets.append({
                    "intent": intent,
                    "target_user_id": str(target_user.id),
                    "target_user_name": target_user.display_name,
                    "target_agent_id": str(target_agent.id),
                    "target_agent_name": target_agent.display_name,
                    "contact_tag_name": contact_tag.name,
                    "contact_tag_display_name": contact_tag.display_name,
                })

            if not resolved_targets:
                msg.content["text"] = cleaned_text + "\n\n（无法找到对方用户或对方助手不在线）"
                return

            # Check if initiating agent is bound to a main tag — block early
            is_main_agent = False
            if agent.tag_id:
                from src.models.tag import Tag as TagModel
                tag_result = await db.execute(select(TagModel).where(TagModel.id == agent.tag_id))
                tag_obj = tag_result.scalar_one_or_none()
                if tag_obj and tag_obj.is_main:
                    is_main_agent = True

            if is_main_agent:
                # Main agent cannot contact others — notify user only, no pending auth created
                msg.content["text"] = cleaned_text
                await ws_manager.send_to_user(ctx.user_id, {
                    "type": "dialog.main_agent_blocked",
                    "data": {
                        "conversation_id": ctx.conversation_id,
                        "agent_name": agent.display_name,
                        "message": "为了您的信息安全，Main Assistant 不能直接联系其他人。请使用其他助手发起对话。",
                    },
                })
                logger.info(f"{self._log_prefix()} Main agent A2A intent blocked — user notified")
                return

            # Update message text (strip markers)
            msg.content["text"] = cleaned_text

            # Create pending authorization and ask the initiator user
            auth_id = str(uuid.uuid4())
            self._pending_intent_auths[auth_id] = {
                "intents": intents,
                "resolved_targets": resolved_targets,
                "agent_id": ctx.agent_id,
                "agent_name": agent.display_name,
                "conversation_id": ctx.conversation_id,
                "user_id": ctx.user_id,
                "participant_ids": ctx.participant_ids,
                "session_key": ctx.session_key,
                "cleaned_text": cleaned_text,
                "msg_id": str(msg.id),
                "created_at": asyncio.get_event_loop().time(),
            }

            # Push authorization request to the initiator user
            targets_summary = [
                {
                    "target_user_name": t["target_user_name"],
                    "target_agent_name": t["target_agent_name"],
                    "contact_tag_name": t.get("contact_tag_name", ""),
                    "contact_tag_display_name": t.get("contact_tag_display_name", ""),
                    "topic": t["intent"].topic,
                }
                for t in resolved_targets
            ]

            await ws_manager.send_to_user(ctx.user_id, {
                "type": "dialog.intent_authorization",
                "data": {
                    "authorization_id": auth_id,
                    "agent_name": agent.display_name,
                    "conversation_id": ctx.conversation_id,
                    "targets": targets_summary,
                    "is_main_agent": is_main_agent,
                },
            })

            logger.info(
                f"{self._log_prefix()} Intent authorization requested: "
                f"auth_id={auth_id[:8]}, targets={len(resolved_targets)}"
            )

            # Schedule timeout cleanup (5 minutes)
            asyncio.ensure_future(self._intent_auth_timeout(auth_id))

        except Exception as e:
            logger.error(f"{self._log_prefix()} Intent detection error: {e}")

    async def _intent_auth_timeout(self, auth_id: str):
        """Auto-deny intent authorization after 30 minutes."""
        await asyncio.sleep(1800)
        ctx = self._pending_intent_auths.pop(auth_id, None)
        if ctx is None:
            return  # Already handled
        logger.info(f"{self._log_prefix()} Intent authorization timed out: {auth_id[:8]}")
        await self._handle_intent_auth_denied(ctx, reason="timeout")

    async def handle_intent_auth_response(self, auth_id: str, approved: bool, reason: str = ""):
        """Handle user's response to a dialog intent authorization request."""
        ctx = self._pending_intent_auths.pop(auth_id, None)
        if ctx is None:
            logger.warning(f"{self._log_prefix()} Intent auth not found or expired: {auth_id[:8]}")
            return

        if approved:
            await self._handle_intent_auth_approved(ctx)
        else:
            await self._handle_intent_auth_denied(ctx, reason=reason or "user_denied")

    async def _handle_intent_auth_approved(self, ctx: dict):
        """Resume A2A dialog flow after user approval."""
        from src.models.agent import Agent

        resolved = ctx["resolved_targets"]
        intents = ctx["intents"]

        async with async_session() as db:
            agent = await db.get(Agent, uuid.UUID(ctx["agent_id"]))
            if not agent:
                return

            if len(resolved) == 1:
                # Single target: initiate dialog directly
                target = resolved[0]
                intent = target["intent"]
                run_ctx = _RunContext(
                    conversation_id=ctx["conversation_id"],
                    session_key=ctx["session_key"],
                    user_id=ctx["user_id"],
                    participant_ids=ctx["participant_ids"],
                    agent_id=ctx["agent_id"],
                )
                # Create a minimal msg-like object for _initiate_single_dialog
                await self._initiate_single_dialog_from_auth(
                    db, run_ctx, agent, intent, ctx["conversation_id"],
                )
            else:
                # Multiple targets: create DiscoveryTask
                from src.services.discovery_service import discovery_orchestrator
                queries = [
                    {"target_owner": t["intent"].target_owner, "topic": t["intent"].topic}
                    for t in resolved
                ]
                original_intent = ctx["cleaned_text"][:500] if ctx["cleaned_text"] else "多目标协作任务"

                task = await discovery_orchestrator.create_task(
                    db=db,
                    source_conversation_id=ctx["conversation_id"],
                    initiator_agent_id=str(agent.id),
                    initiator_owner_id=ctx["user_id"],
                    original_intent=original_intent,
                    queries=queries,
                )
                task.status = "running"
                task.version += 1
                await db.flush()
                await db.commit()
                await discovery_orchestrator.start_task(str(task.id))

                logger.info(
                    f"{self._log_prefix()} Discovery task created after auth: "
                    f"task={str(task.id)[:8]}, queries={len(queries)}"
                )

    async def _initiate_single_dialog_from_auth(self, db, ctx, agent, intent, conversation_id: str):
        """Initiate a single A2A dialog after user authorization (targets already resolved)."""
        from src.models.agent import Agent
        from src.models.user import User
        from sqlalchemy import select

        # Re-resolve target (may have gone offline during authorization wait)
        result = await db.execute(
            select(User).where(User.display_name == intent.target_owner)
        )
        target_user = result.scalar_one_or_none()
        if not target_user:
            escaped = intent.target_owner.replace('%', r'\%').replace('_', r'\_')
            result = await db.execute(
                select(User).where(User.display_name.ilike(f'%{escaped}%'))
            )
            target_user = result.scalar_one_or_none()

        if not target_user:
            logger.warning(f"Target user no longer found after auth: {intent.target_owner}")
            await self._notify_auth_failure(
                conversation_id, ctx.user_id,
                f"已授权，但无法找到用户 {intent.target_owner}",
            )
            return

        result = await db.execute(
            select(Agent).where(
                Agent.owner_id == target_user.id,
                Agent.status == "online"
            ).order_by(Agent.created_at.desc()).limit(1)
        )
        target_agent = result.scalar_one_or_none()
        if not target_agent:
            logger.warning(f"Target agent offline after auth: {intent.target_owner}")
            await self._notify_auth_failure(
                conversation_id, ctx.user_id,
                f"已授权，但 {intent.target_owner} 的助手当前不在线",
            )
            return

        try:
            from src.services.agent_dialog_service import agent_dialog_orchestrator
            from src.schemas.agent_dialog import CreateDialogSessionRequest

            req = CreateDialogSessionRequest(
                initiator_agent_id=agent.id,
                responder_agent_id=target_agent.id,
                topic=intent.topic,
                max_rounds=10,
                idle_timeout_seconds=settings.AGENT_DIALOG_DEFAULT_IDLE_TIMEOUT,
                metadata={
                    "source_conversation_id": conversation_id,
                    "source_user_id": ctx.user_id,
                },
            )
            session = await agent_dialog_orchestrator.create_session(
                db, req, agent.owner_id
            )
            await db.commit()

            logger.info(
                f"{self._log_prefix()} A2A dialog initiated after auth: "
                f"session={session.id}, target={target_agent.display_name}"
            )
        except Exception as e:
            logger.error(f"Failed to initiate A2A dialog after auth: {e}")

    async def _handle_intent_auth_denied(self, ctx: dict, reason: str = "user_denied"):
        """Handle denied intent authorization: notify conversation + audit log."""
        from src.models.audit import AuditLog
        from src.services.event_service import EventCollector

        targets_desc = ", ".join(
            t["target_user_name"] for t in ctx["resolved_targets"]
        )
        deny_reason = "用户拒绝授权" if reason == "user_denied" else "授权超时"
        deny_text = f"（{deny_reason}，未联系 {targets_desc} 的助手）"

        # Append denial notice to the conversation via a system message
        async with async_session() as db:
            try:
                from src.services.message_service import send_message as save_message
                from src.schemas.message import SendMessageRequest

                msg = await save_message(
                    db=db,
                    conv_id=uuid.UUID(ctx["conversation_id"]),
                    sender_id=uuid.UUID(ctx["agent_id"]),
                    sender_type="agent",
                    req=SendMessageRequest(
                        content_type="text",
                        content={"text": deny_text},
                        metadata={"source": "intent_auth_denied"},
                    ),
                )

                # Write audit log
                audit = AuditLog(
                    agent_id=uuid.UUID(ctx["agent_id"]),
                    user_id=uuid.UUID(ctx["user_id"]),
                    operation_type="intent_authorization",
                    operation_details={
                        "targets": [t["target_user_name"] for t in ctx["resolved_targets"]],
                        "topics": [t["intent"].topic for t in ctx["resolved_targets"]],
                        "agent_name": ctx["agent_name"],
                        "reason": reason,
                    },
                    result="denied",
                )
                db.add(audit)

                # Push audit event
                events = EventCollector()
                events.add(db, ctx["user_id"], "audit.intent_denied", {
                    "audit_id": str(audit.id),
                    "agent_name": ctx["agent_name"],
                    "targets": [t["target_user_name"] for t in ctx["resolved_targets"]],
                    "reason": reason,
                })

                await db.commit()
                await events.deliver()

                # Broadcast the denial message
                broadcast_data = {
                    "type": "message.new",
                    "data": {
                        "id": str(msg.id),
                        "conversation_id": str(msg.conversation_id),
                        "sender": msg.sender.model_dump(mode="json"),
                        "content_type": msg.content_type,
                        "content": msg.content,
                        "timestamp": msg.timestamp.isoformat(),
                        "metadata": msg.metadata,
                    },
                }
                await ws_manager.broadcast_message(ctx["participant_ids"], broadcast_data)

            except Exception as e:
                logger.error(f"{self._log_prefix()} Failed to record intent auth denial: {e}")

    async def _notify_auth_failure(self, conversation_id: str, user_id: str, text: str):
        """Send a system-level notice to the user when post-auth target resolution fails."""
        try:
            await ws_manager.send_to_user(user_id, {
                "type": "message.system",
                "data": {
                    "conversation_id": conversation_id,
                    "text": f"（{text}）",
                },
            })
        except Exception as e:
            logger.error(f"{self._log_prefix()} Failed to notify auth failure: {e}")

    async def _handle_proactive_chat(self, session_key: str, text: str, run_id: str) -> None:
        """处理模型主动发起的对话（如心跳 proactive）：根据 sessionKey 解析会话，落库并广播 message.new。"""
        from sqlalchemy import select
        from src.models.conversation import Conversation, ConversationParticipant
        from src.services.agent_dialog_service import _clean_agent_response

        prefix = "clawnet:"
        if prefix not in session_key:
            return
        conv_id_str = session_key[session_key.index(prefix) + len(prefix) :].strip()
        if not conv_id_str:
            return
        try:
            conv_uuid = uuid.UUID(conv_id_str)
        except ValueError:
            logger.warning(f"[OPENCLAW] Proactive chat invalid conversation id from session_key: {session_key[:50]}")
            return

        clean_text = _clean_agent_response(text)
        if not (clean_text or clean_text.strip()):
            return

        async with async_session() as db:
            try:
                conv = await db.get(Conversation, conv_uuid)
                if not conv:
                    logger.warning(
                        "[OPENCLAW] Proactive chat: conversation not found conv_id=%s",
                        conv_id_str[:8],
                    )
                    return
                agent_result = await db.execute(
                    select(ConversationParticipant.participant_id).where(
                        ConversationParticipant.conversation_id == conv_uuid,
                        ConversationParticipant.participant_type == "agent",
                    ).limit(1)
                )
                agent_row = agent_result.scalar_one_or_none()
                if not agent_row:
                    logger.warning(
                        "[OPENCLAW] Proactive chat: no agent participant conv_id=%s",
                        conv_id_str[:8],
                    )
                    return
                agent_id = agent_row
                part_result = await db.execute(
                    select(ConversationParticipant.participant_id).where(
                        ConversationParticipant.conversation_id == conv_uuid,
                    )
                )
                participant_ids = [str(row[0]) for row in part_result.all()]

                msg = await save_message(
                    db=db,
                    conv_id=conv_uuid,
                    sender_id=agent_id,
                    sender_type="agent",
                    req=SendMessageRequest(
                        content_type="text",
                        content={"text": clean_text.strip()},
                        metadata={"source": "openclaw_proactive", "run_id": run_id},
                    ),
                )
                await db.commit()
                logger.info("[OPENCLAW] Proactive message saved and broadcasting: conv=%s msg=%s", conv_id_str[:8], str(msg.id)[:8])

                broadcast_data = {
                    "type": "message.new",
                    "data": {
                        "id": str(msg.id),
                        "conversation_id": str(msg.conversation_id),
                        "sender": msg.sender.model_dump(mode="json"),
                        "content_type": msg.content_type,
                        "content": msg.content,
                        "timestamp": msg.timestamp.isoformat(),
                        "metadata": msg.metadata,
                    },
                }
                await ws_manager.broadcast_message(participant_ids, broadcast_data)
                logger.info(
                    "[OPENCLAW] Proactive message.new broadcast done: conv_id=%s participant_count=%s",
                    conv_id_str[:8],
                    len(participant_ids),
                )
            except Exception as e:
                logger.exception("[OPENCLAW] Proactive chat save/broadcast failed: %s", e)
                await db.rollback()

    async def _flush_message_buffer(self):
        """重连后发送缓冲的消息"""
        if not self._message_buffer:
            return
            
        logger.info(
            f"{self._log_prefix()} Flushing {len(self._message_buffer)} buffered messages"
        )
        
        while self._message_buffer:
            buffered = self._message_buffer.popleft()
            try:
                await self._send_request(buffered.request, buffered.context)
            except Exception as e:
                logger.error(f"{self._log_prefix()} Failed to send buffered message: {e}")

    async def _send_request(self, request: dict[str, Any], context: _RunContext):
        """发送请求到 Gateway"""
        if self._ws is None:
            raise RuntimeError("WebSocket not connected")
            
        req_id = request["id"]
        self._pending_chat_requests[req_id] = context
        
        fut = asyncio.get_event_loop().create_future()
        self._pending_responses[req_id] = fut
        
        async with self._send_lock:
            await self._ws.send(json.dumps(request, ensure_ascii=False))
        
        try:
            await asyncio.wait_for(fut, timeout=8)
        except Exception:
            logger.warning(f"{self._log_prefix()} send_chat timeout or failure")
            self._pending_chat_requests.pop(req_id, None)
            self._pending_responses.pop(req_id, None)
            raise

    async def _send_control_request(self, request: dict[str, Any], timeout: float = 6) -> dict[str, Any]:
        """发送控制类请求（例如 node.event）。"""
        if self._ws is None:
            raise RuntimeError("WebSocket not connected")

        req_id = request.get("id")
        if not isinstance(req_id, str) or not req_id:
            raise RuntimeError("Invalid control request id")

        fut = asyncio.get_event_loop().create_future()
        self._pending_responses[req_id] = fut
        try:
            async with self._send_lock:
                await self._ws.send(json.dumps(request, ensure_ascii=False))
            resp = await asyncio.wait_for(fut, timeout=timeout)
        except Exception:
            self._pending_responses.pop(req_id, None)
            raise

        if not isinstance(resp, dict) or resp.get("ok") is not True:
            err = resp.get("error") if isinstance(resp, dict) else None
            raise RuntimeError(f"Control request rejected: {err}")
        return resp

    async def _send_node_event(self, event: str, payload: dict[str, Any]) -> None:
        request = {
            "type": "req",
            "id": f"nodeevt-{uuid.uuid4()}",
            "method": "node.event",
            "params": {
                "event": event,
                "payload": payload,
            },
        }
        await self._send_control_request(request, timeout=6)

    async def abort_chat(
        self,
        *,
        session_key: str,
        run_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """发送 chat.abort 到 Gateway，中止指定会话（或特定 run）的生成

        Args:
            session_key: OpenClaw 会话 key
            run_id: 如果指定，只中止该 run；否则中止该 session_key 下所有 run

        Returns:
            Gateway 的响应 payload，例如 {"ok": true, "aborted": true, "runIds": [...]}
        """
        if not self.connected or self._ws is None:
            logger.warning(f"{self._log_prefix()} abort_chat skipped: not connected")
            return {"ok": False, "aborted": False, "runIds": []}

        req_id = f"abort-{uuid.uuid4()}"
        params: dict[str, Any] = {"sessionKey": session_key}
        if run_id:
            params["runId"] = run_id

        request = {
            "type": "req",
            "id": req_id,
            "method": "chat.abort",
            "params": params,
        }

        try:
            resp = await self._send_control_request(request, timeout=6)
            result = resp.get("payload", {})
            logger.info(
                f"{self._log_prefix()} chat.abort result: aborted={result.get('aborted')} "
                f"runIds={result.get('runIds')}"
            )
            return result
        except Exception as e:
            logger.warning(f"{self._log_prefix()} chat.abort failed: {e}")
            return {"ok": False, "aborted": False, "runIds": []}

    async def ensure_chat_subscription(self, session_key: str) -> None:
        """确保当前连接订阅了指定 session 的 chat 事件。"""
        if not self._node_event_supported:
            return
        normalized = (session_key or "").strip()
        if not normalized:
            return

        newly_added = normalized not in self._subscribed_sessions
        self._subscribed_sessions.add(normalized)

        if not self.connected or self._ws is None:
            return
        if not newly_added:
            return

        try:
            await self._send_node_event("chat.subscribe", {"sessionKey": normalized})
            logger.info(f"{self._log_prefix()} chat.subscribe ok: {normalized[-48:]}")
        except Exception as e:
            err_text = str(e)
            if "unauthorized role" in err_text:
                self._node_event_supported = False
                logger.info(
                    f"{self._log_prefix()} chat.subscribe unsupported for current gateway role; disable retries"
                )
                return
            logger.warning(f"{self._log_prefix()} chat.subscribe failed: {normalized[-48:]} err={e}")

    async def _reregister_proxy_nodes(self) -> None:
        """连接恢复后重新注册所有 proxy nodes（含 fileAccess + tagFileAccess）。"""
        if not self.connected or self._ws is None or not self._registered_proxy_nodes:
            return
        for node_id, info in list(self._registered_proxy_nodes.items()):
            try:
                req_id = f"proxy-reg-{uuid.uuid4()}"
                params: dict[str, Any] = {"nodeId": node_id, "commands": info["commands"]}
                if info.get("displayName"):
                    params["displayName"] = info["displayName"]
                if info.get("platform"):
                    params["platform"] = info["platform"]
                if info.get("deviceFamily"):
                    params["deviceFamily"] = info["deviceFamily"]
                if info.get("fileAccess"):
                    params["fileAccess"] = info["fileAccess"]
                if info.get("tagFileAccess"):
                    params["tagFileAccess"] = info["tagFileAccess"]
                request = {"type": "req", "id": req_id, "method": "node.proxy.register", "params": params}
                await self._send_control_request(request, timeout=8)
                logger.info(f"{self._log_prefix()} re-registered proxy node: {node_id}")
            except Exception as e:
                logger.warning(f"{self._log_prefix()} re-register proxy node failed: {node_id} err={e}")

    async def _resubscribe_chat_sessions(self) -> None:
        """连接恢复后重建所有 chat 订阅。"""
        if not self._node_event_supported:
            return
        if not self.connected or self._ws is None or not self._subscribed_sessions:
            return
        for session_key in sorted(self._subscribed_sessions):
            try:
                await self._send_node_event("chat.subscribe", {"sessionKey": session_key})
                logger.info(f"{self._log_prefix()} resubscribed chat session: {session_key[-48:]}")
            except Exception as e:
                logger.warning(f"{self._log_prefix()} resubscribe failed: {session_key[-48:]} err={e}")

    # ============ Proxy Node Methods ============

    async def register_proxy_node(self, node_id: str, commands: list[str], display_name: str = None, platform: str = None, device_family: str = None, file_access: dict = None, tag_file_access: dict = None) -> dict:
        """Register a proxy node on the gateway via node.proxy.register"""
        # Single-device constraint: unregister any OTHER proxy nodes first
        stale_ids = [nid for nid in self._registered_proxy_nodes if nid != node_id]
        for stale_id in stale_ids:
            logger.info(f"{self._log_prefix()} replacing old proxy node {stale_id} with {node_id}")
            await self.unregister_proxy_node(stale_id)

        # Update in-memory dict FIRST (before RPC) for resilience:
        # if the push fails, _reregister_proxy_nodes can still rebuild with latest data.
        self._registered_proxy_nodes[node_id] = {
            "commands": commands, "displayName": display_name,
            "platform": platform, "deviceFamily": device_family,
            "fileAccess": file_access, "tagFileAccess": tag_file_access,
        }

        req_id = f"proxy-reg-{uuid.uuid4()}"
        params: dict[str, Any] = {"nodeId": node_id, "commands": commands}
        if display_name:
            params["displayName"] = display_name
        if platform:
            params["platform"] = platform
        if device_family:
            params["deviceFamily"] = device_family
        if file_access:
            params["fileAccess"] = file_access
        if tag_file_access:
            params["tagFileAccess"] = tag_file_access
        request = {"type": "req", "id": req_id, "method": "node.proxy.register", "params": params}
        resp = await self._send_control_request(request, timeout=8)

        asyncio.ensure_future(self._ensure_node_paired(
            node_id=node_id, commands=commands, display_name=display_name,
            platform=platform, device_family=device_family,
        ))
        return resp.get("payload", {})

    async def _ensure_node_paired(self, node_id: str, commands: list[str],
                                  display_name: str = None, platform: str = None,
                                  device_family: str = None) -> None:
        """Ensure a proxy node has a persistent pairing record on the gateway.

        Uses node.pair.request(silent=true) + node.pair.approve so that the
        gateway's node.list merges the entry and reports paired=true.
        """
        try:
            pair_req_id = f"pair-req-{uuid.uuid4()}"
            pair_params: dict[str, Any] = {
                "nodeId": node_id,
                "commands": commands,
                "silent": True,
            }
            if display_name:
                pair_params["displayName"] = display_name
            if platform:
                pair_params["platform"] = platform
            if device_family:
                pair_params["deviceFamily"] = device_family
            request = {
                "type": "req", "id": pair_req_id,
                "method": "node.pair.request", "params": pair_params,
            }
            resp = await self._send_control_request(request, timeout=8)
            payload = resp.get("payload", {})
            request_obj = payload.get("request", {})
            request_id = request_obj.get("requestId")
            if not request_id:
                logger.debug(f"{self._log_prefix()} node.pair.request returned no requestId, node may already be paired")
                return

            approve_req_id = f"pair-approve-{uuid.uuid4()}"
            approve_request = {
                "type": "req", "id": approve_req_id,
                "method": "node.pair.approve", "params": {"requestId": request_id},
            }
            await self._send_control_request(approve_request, timeout=8)
            logger.info(f"{self._log_prefix()} auto-paired proxy node: {node_id} ({display_name})")
        except Exception as e:
            logger.warning(f"{self._log_prefix()} auto-pair failed for {node_id}: {e}")

    async def unregister_proxy_node(self, node_id: str) -> dict:
        """Unregister a proxy node from the gateway"""
        self._registered_proxy_nodes.pop(node_id, None)
        req_id = f"proxy-unreg-{uuid.uuid4()}"
        request = {"type": "req", "id": req_id, "method": "node.proxy.unregister", "params": {"nodeId": node_id}}
        try:
            resp = await self._send_control_request(request, timeout=6)
            return resp.get("payload", {})
        except Exception as e:
            logger.warning(f"{self._log_prefix()} proxy unregister failed for {node_id}: {e}")
            return {}

    async def send_node_invoke_result(self, invoke_id: str, node_id: str, ok: bool, payload_json: str = None, error: dict = None) -> None:
        """Send node.invoke.result back to gateway."""
        req_id = f"invoke-result-{uuid.uuid4()}"
        params: dict[str, Any] = {"id": invoke_id, "nodeId": node_id, "ok": ok}
        if payload_json is not None:
            params["payloadJSON"] = payload_json
        if error is not None:
            params["error"] = error
        request = {"type": "req", "id": req_id, "method": "node.invoke.result", "params": params}
        await self._send_control_request(request, timeout=10)

    async def _set_tag_context_for_session(
        self,
        *,
        session_key: str,
        user_id: str,
        conversation_id: str,
        tag_id: Optional[str] = None,
        a2a_mode: bool = False,
    ) -> None:
        """Resolve and send tag context to the gateway for workspace isolation.

        If tag_id is provided (A2A), look up the tag directly instead of
        resolving from conversation participants — avoids the non-deterministic
        participant iteration bug in A2A conversations.
        """
        try:
            from src.services import tag_service
            from src.database import async_session
            import uuid as _uuid

            async with async_session() as db:
                if tag_id:
                    ctx = await tag_service.resolve_tag_context_by_id(
                        db, _uuid.UUID(tag_id)
                    )
                else:
                    ctx = await tag_service.resolve_conversation_context(
                        db, _uuid.UUID(user_id), _uuid.UUID(conversation_id)
                    )

            # Gateway prefixes session keys with "agent:main:" internally
            gateway_session_key = f"agent:main:{session_key}" if not session_key.startswith("agent:") else session_key
            tag_params = {
                "sessionKey": gateway_session_key,
                "tagId": ctx["tag_id"],
                "tagName": ctx["tag_name"],
                "tagDisplayName": ctx.get("tag_display_name", ""),
                "workspaceId": ctx["workspace_id"],
            }
            node_acl = ctx.get("node_acl")
            if node_acl:
                tag_params["nodeAcl"] = node_acl

            # Pass access mode so gateway enforces read-only for delegate agents
            access_mode = ctx.get("access_mode", "rw")
            tag_params["accessMode"] = access_mode

            # Mark A2A sessions so gateway can apply stricter restrictions
            if a2a_mode:
                tag_params["a2aMode"] = True

            # Mark main agent tag so gateway widens sandbox to all workspaces
            if ctx.get("is_main"):
                tag_params["isMain"] = True

            req_id = f"tag-ctx-{uuid.uuid4()}"
            request = {
                "type": "req",
                "id": req_id,
                "method": "tag.context.set",
                "params": tag_params,
            }
            await self._send_control_request(request, timeout=5)
        except Exception as e:
            # Non-fatal: tag context is defense-in-depth; primary enforcement is server-side.
            logger.warning(f"{self._log_prefix()} Failed to set tag context: {e}")

    async def send_chat(
        self,
        *,
        conversation_id: str,
        user_id: str,
        participant_ids: list[str],
        agent_id: str,
        session_key: str,
        message: str,
        idempotency_key: str,
        dialog_session_id: Optional[str] = None,
        on_complete: Optional[Callable[[str, str, Optional[str]], None]] = None,
        timeout_ms: Optional[int] = None,
        tag_id: Optional[str] = None,
        a2a_mode: bool = False,
    ):
        """发送聊天消息

        Args:
            conversation_id: 会话 ID
            user_id: 用户 ID
            participant_ids: 参与者 ID 列表
            agent_id: Agent ID
            session_key: OpenClaw 会话 key
            message: 消息内容
            idempotency_key: 幂等性 key
            dialog_session_id: Agent 对话会话 ID（可选，用于 agent-to-agent）
            on_complete: 完成回调（可选，用于 agent-to-agent），签名 (run_id, text, streaming_message_id)
            timeout_ms: 运行超时时间（毫秒），传递给 Gateway 控制单次 run 超时
            tag_id: 直接指定 tag ID（用于 A2A，跳过 conversation-based 解析）
            a2a_mode: 是否为 A2A 对话模式（对方 agent 发起的请求），启用更严格的安全限制
        """
        self.touch()
        # 先订阅 chat 事件，否则 heartbeat proactive 可能因"无订阅者"被 gateway 丢弃。
        await self.ensure_chat_subscription(session_key)

        # Set tag context on the gateway so it loads the correct workspace for this session.
        await self._set_tag_context_for_session(
            session_key=session_key,
            user_id=user_id,
            conversation_id=conversation_id,
            tag_id=tag_id,
            a2a_mode=a2a_mode,
        )

        req_id = f"chat-{uuid.uuid4()}"
        params: dict[str, Any] = {
            "sessionKey": session_key,
            "message": message,
            "deliver": True,
            "idempotencyKey": idempotency_key,
        }
        if timeout_ms is not None:
            params["timeoutMs"] = timeout_ms

        request = {
            "type": "req",
            "id": req_id,
            "method": "chat.send",
            "params": params,
        }

        context = _RunContext(
            conversation_id=conversation_id,
            session_key=session_key,
            user_id=user_id,
            participant_ids=participant_ids,
            agent_id=agent_id,
            dialog_session_id=dialog_session_id,
            on_complete=on_complete,
        )

        # 如果连接中或重连中，缓冲消息
        if not self.connected or self._ws is None:
            if self._status == ConnectionStatus.RECONNECTING:
                logger.info(f"{self._log_prefix()} Buffering message during reconnect")
                self._message_buffer.append(BufferedMessage(request=request, context=context))
                return
            else:
                logger.warning(f"{self._log_prefix()} send_chat skipped: not connected")
                return

        try:
            await self._send_request(request, context)
        except Exception as e:
            # 发送失败，如果是 Agent 连接则缓冲
            if self.is_agent_connection:
                logger.info(f"{self._log_prefix()} Buffering message after send failure: {e}")
                self._message_buffer.append(BufferedMessage(request=request, context=context))


# ============ 连接池 ============

class OpenClawConnectionPool:
    """OpenClaw Gateway 连接池

    为每个用户维护独立的 WebSocket 连接。
    Agent 连接由 AgentConnectionManager 单独管理。
    """

    def __init__(self):
        self._connections: dict[str, GatewayConnection] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: Optional[asyncio.Task] = None

    def start(self):
        """启动连接池（包括清理任务）"""
        if self._cleanup_task and not self._cleanup_task.done():
            return
        self._cleanup_task = asyncio.create_task(self._cleanup_idle_connections())
        logger.info("OpenClaw connection pool started")

    async def stop(self):
        """停止所有连接和清理任务"""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        async with self._lock:
            for conn in self._connections.values():
                await conn.stop()
            self._connections.clear()
        logger.info("OpenClaw connection pool stopped")

    async def _cleanup_idle_connections(self):
        """定期清理空闲的用户连接"""
        while True:
            try:
                await asyncio.sleep(60)  # 每分钟检查一次
                async with self._lock:
                    to_remove = []
                    for user_id, conn in self._connections.items():
                        # 只清理用户连接
                        if not conn.is_agent_connection and conn.idle_seconds > USER_IDLE_TIMEOUT:
                            to_remove.append(user_id)

                    for user_id in to_remove:
                        conn = self._connections.pop(user_id)
                        await conn.stop()
                        logger.info(f"[User:{user_id[:8]}] Connection closed due to idle timeout")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Cleanup error: {e}")

    async def get_connection(self, user_id: str) -> Optional[GatewayConnection]:
        """获取用户的 Gateway 连接，如果不存在则创建"""
        async with self._lock:
            # 检查现有连接
            if user_id in self._connections:
                conn = self._connections[user_id]
                conn.touch()
                return conn

            # 获取用户的 Gateway 配置
            config = get_gateway_config(user_id)
            if not config:
                logger.warning(f"[User:{user_id[:8]}] No gateway config found")
                return None

            # 创建新连接
            conn = GatewayConnection(user_id, config, ConnectionType.USER)
            self._connections[user_id] = conn
            conn.start()

            # 等待连接建立
            try:
                await asyncio.wait_for(conn._connected.wait(), timeout=10)
            except asyncio.TimeoutError:
                logger.warning(f"[User:{user_id[:8]}] Connection timeout")
                # 保留连接，后台会继续重连

            return conn

    def get_status(self) -> dict[str, Any]:
        """获取连接池状态"""
        return {
            "total_connections": len(self._connections),
            "connections": {
                user_id[:8]: {
                    "type": conn.connection_type.value,
                    "connected": conn.connected,
                    "status": conn.status.value,
                    "idle_seconds": int(conn.idle_seconds),
                    "last_error": conn.last_error,
                    "last_connected_at": conn.last_connected_at.isoformat() if conn.last_connected_at else None,
                }
                for user_id, conn in self._connections.items()
            },
        }


# ============ Agent 连接管理器 ============

class AgentConnectionManager:
    """Agent Gateway 连接管理器
    
    专门管理 Agent 的持久连接，生命周期跟随 Agent status：
    - Agent online → 建连
    - Agent offline → 断连
    - 无空闲超时
    """

    def __init__(self):
        self._connections: dict[str, GatewayConnection] = {}
        self._lock = asyncio.Lock()

    async def connect_agent(self, agent_id: str, config: GatewayConfig) -> Optional[GatewayConnection]:
        """建立 Agent 的 Gateway 连接
        
        在 Agent 上线时调用。
        """
        async with self._lock:
            # 检查是否已有连接
            if agent_id in self._connections:
                conn = self._connections[agent_id]
                if conn.connected:
                    return conn
                # 已有但未连接，停止旧连接
                await conn.stop()

            # 创建新连接
            conn = GatewayConnection(agent_id, config, ConnectionType.AGENT)
            self._connections[agent_id] = conn
            conn.start()

            # 等待连接建立
            try:
                await asyncio.wait_for(conn._connected.wait(), timeout=10)
                logger.info(f"[Agent:{agent_id[:8]}] Connected to OpenClaw Gateway")
                return conn
            except asyncio.TimeoutError:
                logger.warning(f"[Agent:{agent_id[:8]}] Connection timeout, will retry in background")
                return conn

    async def disconnect_agent(self, agent_id: str) -> None:
        """断开 Agent 的 Gateway 连接
        
        在 Agent 下线时调用。
        """
        async with self._lock:
            conn = self._connections.pop(agent_id, None)
            if conn:
                await conn.stop()
                logger.info(f"[Agent:{agent_id[:8]}] Disconnected from OpenClaw Gateway")

    def get_connection(self, agent_id: str) -> Optional[GatewayConnection]:
        """获取 Agent 的 Gateway 连接"""
        return self._connections.get(agent_id)

    def is_agent_connected(self, agent_id: str) -> bool:
        """检查 Agent 是否已连接"""
        conn = self._connections.get(agent_id)
        return conn is not None and conn.connected

    async def stop(self):
        """停止所有 Agent 连接"""
        async with self._lock:
            for conn in self._connections.values():
                await conn.stop()
            self._connections.clear()
        logger.info("Agent connection manager stopped")

    def has_active_dialog_run(self, session_id: str, agent_ids: list[str]) -> bool:
        """检查指定 dialog session 的任意 agent 是否有正在进行的 Gateway run

        供 session_cleanup 在终止前调用，防止误杀正在执行的 agent run。
        """
        for agent_id in agent_ids:
            conn = self._connections.get(agent_id)
            if not conn or not conn.connected:
                continue
            session_key = f"dialog:{session_id}:agent:{agent_id}"
            if conn.has_active_run_for_session(session_key):
                return True
        return False

    def get_status(self) -> dict[str, Any]:
        """获取所有 Agent 连接状态"""
        return {
            "total_agents": len(self._connections),
            "agents": {
                agent_id[:8]: {
                    "connected": conn.connected,
                    "status": conn.status.value,
                    "last_error": conn.last_error,
                    "last_connected_at": conn.last_connected_at.isoformat() if conn.last_connected_at else None,
                    "buffer_size": len(conn._message_buffer),
                }
                for agent_id, conn in self._connections.items()
            },
        }


# 全局连接池实例
openclaw_pool = OpenClawConnectionPool()

# 全局 Agent 连接管理器实例
agent_connection_manager = AgentConnectionManager()


# ============ 兼容旧 API 的包装器 ============

class OpenClawService:
    """向后兼容的 OpenClaw 服务接口

    实际委托给连接池处理。
    """

    def __init__(self):
        pass

    @property
    def connected(self) -> bool:
        """返回 True 表示服务可用（连接池已启动）"""
        return True

    @property
    def last_error(self) -> Optional[str]:
        return None

    @property
    def last_connected_at(self) -> Optional[datetime]:
        return None

    def start(self):
        """启动服务（启动连接池）"""
        openclaw_pool.start()

    async def stop(self):
        """停止服务"""
        await openclaw_pool.stop()
        await agent_connection_manager.stop()

    async def send_chat(
        self,
        *,
        conversation_id: str,
        user_id: str,
        participant_ids: list[str],
        agent_id: str,
        session_key: str,
        message: str,
        idempotency_key: str,
    ):
        """发送聊天消息

        根据 user_id 获取对应的 Gateway 连接并发送。
        """
        conn = await openclaw_pool.get_connection(user_id)
        if not conn:
            logger.warning(f"[User:{user_id[:8]}] Cannot send chat: no gateway connection")
            await ws_manager.send_to_user(
                user_id,
                {
                    "type": "assistant.status",
                    "data": {
                        "connected": False,
                        "reason": "no_gateway_config",
                    },
                },
            )
            return

        if not conn.connected:
            logger.warning(f"[User:{user_id[:8]}] Gateway not connected yet")
            await ws_manager.send_to_user(
                user_id,
                {
                    "type": "assistant.status",
                    "data": {
                        "connected": False,
                        "reason": "gateway_connecting",
                    },
                },
            )
            return

        await conn.send_chat(
            conversation_id=conversation_id,
            user_id=user_id,
            participant_ids=participant_ids,
            agent_id=agent_id,
            session_key=session_key,
            message=message,
            idempotency_key=idempotency_key,
        )

    async def abort_chat(
        self,
        *,
        user_id: str,
        session_key: str,
        run_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """中止聊天生成

        根据 user_id 获取对应的 Gateway 连接并发送 chat.abort。
        """
        conn = await openclaw_pool.get_connection(user_id)
        if not conn or not conn.connected:
            logger.warning(f"[User:{user_id[:8]}] Cannot abort chat: no gateway connection")
            return {"ok": False, "aborted": False, "runIds": []}

        return await conn.abort_chat(session_key=session_key, run_id=run_id)

    async def register_proxy_node(self, user_id: str, node_id: str, commands: list[str], **kwargs) -> dict:
        conn = await openclaw_pool.get_connection(user_id)
        if not conn or not conn.connected:
            raise RuntimeError("Gateway not connected")
        return await conn.register_proxy_node(node_id, commands, **kwargs)

    async def unregister_proxy_node(self, user_id: str, node_id: str) -> dict:
        conn = await openclaw_pool.get_connection(user_id)
        if not conn or not conn.connected:
            raise RuntimeError("Gateway not connected")
        return await conn.unregister_proxy_node(node_id)

    async def send_node_invoke_result(self, user_id: str, invoke_id: str, node_id: str, ok: bool, payload_json: str = None, error: dict = None) -> None:
        conn = await openclaw_pool.get_connection(user_id)
        if not conn or not conn.connected:
            raise RuntimeError("Gateway not connected")
        await conn.send_node_invoke_result(invoke_id, node_id, ok, payload_json, error)

    async def touch_user_connection(self, user_id: str) -> None:
        """Refresh the idle timeout for a user's gateway connection.

        Called when the client sends a keepalive ping so the gateway connection
        is not reclaimed while the user's app is still alive.
        """
        async with openclaw_pool._lock:
            conn = openclaw_pool._connections.get(user_id)
            if conn:
                conn.touch()

    async def ensure_user_chat_subscriptions(self, user_id: str) -> None:
        """为用户恢复已知会话的 chat.subscribe 订阅。"""
        conn = await openclaw_pool.get_connection(user_id)
        if not conn:
            return

        try:
            user_uuid = uuid.UUID(user_id)
        except Exception:
            return

        try:
            from sqlalchemy import select
            from src.models.agent_session_key import AgentSessionKey

            async with async_session() as db:
                result = await db.execute(
                    select(AgentSessionKey.session_key).where(
                        AgentSessionKey.user_id == user_uuid
                    )
                )
                session_keys = [row[0] for row in result.all() if row and isinstance(row[0], str)]
        except Exception as e:
            logger.warning(f"[User:{user_id[:8]}] load session keys failed: {e}")
            return

        if not session_keys:
            return

        for key in session_keys:
            await conn.ensure_chat_subscription(key)


# 全局服务实例（兼容旧代码）
openclaw_service = OpenClawService()


# 保持向后兼容的别名
UserGatewayConnection = GatewayConnection
