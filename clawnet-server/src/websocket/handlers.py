import asyncio
import uuid
import json
import logging
from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.websocket.manager import ws_manager
from src.models.conversation import ConversationParticipant
from src.models.message import Message
from src.models.agent import Agent
from src.models.agent_dialog_session import AgentDialogSession
from src.services.message_service import send_message as svc_send_message
from src.services.openclaw_service import openclaw_service, openclaw_pool
from src.services.agent_dialog_service import agent_dialog_orchestrator
from src.services.session_key_service import upsert_session_key
from src.schemas.message import SendMessageRequest, SenderInfo
from src.utils.security import decode_token
from src.utils.errors import AppError
from src.database import async_session

logger = logging.getLogger("clawnet.ws.handlers")


async def authenticate_ws(websocket: WebSocket) -> str | None:
    """Authenticate WebSocket connection via query param or initial message."""
    token = websocket.query_params.get("token")
    if not token:
        # Try to get from first message
        try:
            data = await websocket.receive_json()
            if data.get("type") == "auth":
                token = data.get("token", "").replace("Bearer ", "")
        except Exception:
            return None

    if not token:
        return None

    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        return None

    return payload.get("sub")


async def handle_ws_message(user_id: str, data: dict, websocket: WebSocket = None):
    """Handle incoming WebSocket messages from client."""
    msg_type = data.get("type", "")

    if msg_type == "message.send":
        await _handle_message_send(user_id, data)
    elif msg_type == "message.read":
        await _handle_message_read(user_id, data)
    elif msg_type in ("typing.start", "typing.stop"):
        await _handle_typing(user_id, data, msg_type == "typing.start")
    elif msg_type == "approval.response":
        await _handle_approval_response(user_id, data)
    elif msg_type == "dialog.intent_authorize":
        await _handle_dialog_intent_authorize(user_id, data)
    elif msg_type == "dialog.approve":
        await _handle_dialog_approve(user_id, data)
    elif msg_type == "dialog.terminate":
        await _handle_dialog_terminate(user_id, data)
    elif msg_type == "dialog.extend":
        await _handle_dialog_extend(user_id, data)
    elif msg_type == "message.stop":
        await _handle_message_stop(user_id, data)
    elif msg_type == "node.capabilities":
        await _handle_node_capabilities(user_id, data, websocket)
    elif msg_type == "node.invoke.result":
        await _handle_node_invoke_result(user_id, data)
    elif msg_type == "ping":
        await ws_manager.send_to_user(user_id, {"type": "pong"})
        # Touch the gateway connection so keepalive pings prevent idle timeout
        await openclaw_service.touch_user_connection(user_id)


async def _handle_message_send(user_id: str, data: dict):
    """Handle message.send from client."""
    msg_data = data.get("data", {})
    request_id = data.get("request_id", "")
    conv_id = msg_data.get("conversation_id")

    if not conv_id:
        return

    async with async_session() as db:
        try:
            req = SendMessageRequest(
                content_type=msg_data.get("content_type", "text"),
                content=msg_data.get("content", {}),
                metadata=msg_data.get("metadata"),
            )

            msg_response = await svc_send_message(
                db, uuid.UUID(conv_id), uuid.UUID(user_id), "human", req
            )
            await db.commit()

            # Send confirmation back to sender
            await ws_manager.send_to_user(user_id, {
                "type": "message.sent",
                "request_id": request_id,
                "data": {
                    "message_id": str(msg_response.id),
                    "timestamp": msg_response.timestamp.isoformat(),
                },
            })

            # Broadcast to other participants (exclude sender — they already have the message)
            participant_result = await db.execute(
                select(ConversationParticipant.participant_id).where(
                    ConversationParticipant.conversation_id == uuid.UUID(conv_id)
                )
            )
            all_participant_ids = [str(row[0]) for row in participant_result.all()]
            other_participant_ids = [pid for pid in all_participant_ids if pid != user_id]

            await ws_manager.broadcast_message(
                other_participant_ids,
                {
                    "type": "message.new",
                    "data": {
                        "id": str(msg_response.id),
                        "conversation_id": conv_id,
                        "sender": msg_response.sender.model_dump(mode="json"),
                        "content_type": msg_response.content_type,
                        "content": msg_response.content,
                        "timestamp": msg_response.timestamp.isoformat(),
                        "metadata": msg_response.metadata,
                    },
                },
            )

            # Bridge user message to OpenClaw gateway.
            # Agent 回复需要广播给所有人（包含发送者），所以传完整列表
            # 隔离 OpenClaw 调用，其错误不应导致消息显示为发送失败
            try:
                await _dispatch_openclaw_response(
                    db=db,
                    conv_id=conv_id,
                    user_id=user_id,
                    user_text=msg_response.content.get("text", ""),
                    participant_ids=all_participant_ids,
                    idempotency_key=str(msg_response.id),
                )
            except Exception as openclaw_err:
                import logging
                logging.getLogger("clawnet.ws").error(
                    f"OpenClaw dispatch failed: {openclaw_err}", exc_info=True
                )

        except AppError as e:
            await db.rollback()
            await ws_manager.send_to_user(user_id, {
                "type": "error",
                "request_id": request_id,
                "data": {"message": e.error_message},
            })
        except Exception as e:
            await db.rollback()
            logger.error("message.send failed for user %s: %s", user_id[:8], e, exc_info=True)
            await ws_manager.send_to_user(user_id, {
                "type": "error",
                "request_id": request_id,
                "data": {"message": "消息发送失败，请重试"},
            })


async def _handle_message_read(user_id: str, data: dict):
    """Handle message.read from client."""
    msg_data = data.get("data", {})
    conv_id = msg_data.get("conversation_id")
    last_read_id = msg_data.get("last_read_message_id")

    if not conv_id or not last_read_id:
        return

    async with async_session() as db:
        try:
            from src.services.conversation_service import mark_as_read
            await mark_as_read(db, uuid.UUID(conv_id), uuid.UUID(user_id), uuid.UUID(last_read_id))
            await db.commit()
        except Exception as e:
            logger.warning("message.read failed: %s", e)
            await db.rollback()


async def _handle_typing(user_id: str, data: dict, typing: bool):
    """Handle typing indicator."""
    msg_data = data.get("data", {})
    conv_id = msg_data.get("conversation_id")

    if not conv_id:
        return

    async with async_session() as db:
        participant_result = await db.execute(
            select(ConversationParticipant.participant_id).where(
                ConversationParticipant.conversation_id == uuid.UUID(conv_id)
            )
        )
        participant_ids = [str(row[0]) for row in participant_result.all()]

    await ws_manager.send_typing_indicator(participant_ids, user_id, typing)


async def _handle_approval_response(user_id: str, data: dict):
    """Handle approval response from client."""
    msg_data = data.get("data", {})
    async with async_session() as db:
        try:
            from src.services.task_service import approve_task
            from src.schemas.task import ApproveTaskRequest
            task_id = msg_data.get("task_id") or msg_data.get("approval_id")
            if task_id:
                req = ApproveTaskRequest(
                    decision=msg_data.get("decision", "rejected"),
                    modifications=msg_data.get("modifications"),
                )
                await approve_task(db, uuid.UUID(task_id), uuid.UUID(user_id), req)
                await db.commit()
        except Exception as e:
            logger.warning("approval.response failed: %s", e)
            await db.rollback()


async def _dispatch_openclaw_response(
    db: AsyncSession,
    conv_id: str,
    user_id: str,
    user_text: str,
    participant_ids: list[str],
    idempotency_key: str,
):
    """Forward user text to OpenClaw and let service aggregate final reply.

    Frontend currently consumes non-stream `message.new`, so stream deltas are
    merged in `openclaw_service` and persisted/broadcast only on completion.
    
    LLM 自主判定流程：
    1. 获取 Agent 的联系人列表
    2. 注入能力声明 prompt
    3. 发送给 OpenClaw
    4. openclaw_service 中会解析回复并处理 A2A 意图
    """
    if not user_text:
        return

    # 跳过 agent_task 类型的会话（A2A 对话有独立的 session key 管理）
    from src.models.conversation import Conversation
    conv = await db.get(Conversation, uuid.UUID(conv_id))
    if not conv or conv.type == "agent_task":
        return

    # Find agent participants
    result = await db.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == uuid.UUID(conv_id),
            ConversationParticipant.participant_type == "agent",
        )
    )
    agent_participants = result.scalars().all()

    if not agent_participants:
        return

    # Single-user mode: first online agent is enough.
    selected_agent = None
    for ap in agent_participants:
        agent_result = await db.execute(select(Agent).where(Agent.id == ap.participant_id))
        agent = agent_result.scalar_one_or_none()
        if agent and agent.status == "online":
            selected_agent = agent
            break

    if not selected_agent:
        return

    # 构造增强消息（注入能力声明）
    enhanced_message = await _build_enhanced_message(db, selected_agent, user_text)

    session_key = f"clawnet:{conv_id}"

    # 持久化 session key 到数据库
    await upsert_session_key(
        db,
        conversation_id=conv_id,
        user_id=user_id,
        agent_id=str(selected_agent.id),
        session_key=session_key,
    )

    await openclaw_service.send_chat(
        conversation_id=conv_id,
        user_id=user_id,
        participant_ids=participant_ids,
        agent_id=str(selected_agent.id),
        session_key=session_key,
        message=enhanced_message,
        idempotency_key=idempotency_key,
    )


async def _build_enhanced_message(db: AsyncSession, agent: Agent, user_text: str) -> str:
    """构造增强消息，注入能力声明
    
    Args:
        db: 数据库会话
        agent: 当前 Agent
        user_text: 用户原始消息
        
    Returns:
        增强后的消息（包含能力声明 + 用户消息）
    """
    from src.services.prompt_templates import build_capability_prompt_i18n, get_user_lang, get_user_msg_label

    # 获取 Agent 的联系人列表
    contacts = await _get_agent_contacts(db, agent)

    logger.debug(
        "Enhanced message: agent=%s, contacts=%d",
        agent.display_name, len(contacts),
    )

    if not contacts:
        return user_text

    # 获取当前 Agent 所属用户名称（让 LLM 知道自己是谁）
    from src.models.user import User
    my_owner_name = ""
    owner = await db.get(User, agent.owner_id)
    lang = get_user_lang(owner)
    if owner:
        my_owner_name = owner.display_name

    # 构造能力声明 prompt
    capability_prompt = build_capability_prompt_i18n(contacts, my_owner_name=my_owner_name, lang=lang)

    if not capability_prompt:
        return user_text

    # 注入方式：以系统指令格式包裹，让 LLM 更容易识别
    # 将用户消息明确标记，帮助 LLM 区分指令和用户输入
    enhanced = (
        f"{capability_prompt}\n\n"
        f"---\n"
        f"{get_user_msg_label(lang)}{user_text}"
    )
    
    logger.debug("Capability prompt injected, total len=%d", len(enhanced))
    
    return enhanced


async def _get_agent_contacts(db: AsyncSession, agent: Agent) -> list[dict]:
    """获取 Agent 可联系的其他用户列表（基于联系人关系）

    按 Owner（用户）去重，每个好友只出现一次。
    来源 1（model_config 预配置）和来源 2（自动发现）互补合并。

    这不是 Rule Engine — 只是"通讯录"，不决定何时联系。
    何时联系完全由 LLM 自主判断。
    """
    from src.models.user import User
    from src.models.tag import Tag

    seen_owner_ids: set[uuid.UUID] = set()
    contacts = []

    # 来源 1：从 Agent 的 model_config 中获取预配置的联系人（需校验好友关系）
    if agent.model_config_data and isinstance(agent.model_config_data, dict):
        from src.services.contact_check import are_owners_contacts
        configured_contacts = agent.model_config_data.get("contacts", [])

        for c in configured_contacts:
            target_agent_id = c.get("agent_id")
            if not target_agent_id:
                continue

            try:
                target_agent = await db.get(Agent, uuid.UUID(target_agent_id))
                if not target_agent:
                    continue

                if target_agent.id == agent.id:
                    continue

                # 按 Owner 去重
                if target_agent.owner_id in seen_owner_ids:
                    continue

                if target_agent.owner_id != agent.owner_id:
                    if not await are_owners_contacts(db, agent.owner_id, target_agent.owner_id):
                        continue

                owner = await db.get(User, target_agent.owner_id)
                if not owner:
                    continue

                seen_owner_ids.add(target_agent.owner_id)
                contacts.append({
                    "owner_name": owner.display_name,
                    "status": owner.status,
                })
            except Exception:
                continue

    # 来源 2：自动发现好友（基于联系人关系），与来源 1 互补
    from sqlalchemy import select
    from src.models.contact import Contact

    friends_result = await db.execute(
        select(Contact.contact_id).where(
            Contact.user_id == agent.owner_id,
            Contact.contact_type == "human",
        )
    )
    friend_ids = [row[0] for row in friends_result.all()]

    for friend_id in friend_ids:
        if friend_id in seen_owner_ids:
            continue

        friend_user = await db.get(User, friend_id)
        if not friend_user:
            continue

        seen_owner_ids.add(friend_id)
        contacts.append({
            "owner_name": friend_user.display_name,
            "status": friend_user.status,
        })

        if len(contacts) >= 50:
            break

    return contacts


# ============ Dialog Intent Authorization Handler ============

async def _handle_dialog_intent_authorize(user_id: str, data: dict):
    """Handle dialog.intent_authorize from client.

    The initiator user approves or denies their agent's request to contact
    another user's agent.
    """
    msg_data = data.get("data", {})
    auth_id = msg_data.get("authorization_id")
    approved = msg_data.get("approved", False)
    reason = msg_data.get("reason", "")

    if not auth_id:
        await ws_manager.send_to_user(user_id, {
            "type": "error",
            "data": {"message": "authorization_id is required"},
        })
        return

    # Find the user's gateway connection that holds the pending authorization
    conn = await openclaw_pool.get_connection(user_id)
    if not conn:
        logger.warning(f"[User:{user_id[:8]}] Intent auth response: no gateway connection")
        return

    await conn.handle_intent_auth_response(auth_id, approved, reason)

    await ws_manager.send_to_user(user_id, {
        "type": "dialog.intent_authorize.success",
        "data": {
            "authorization_id": auth_id,
            "approved": approved,
        },
    })


# ============ Agent Dialog Session Handlers ============

async def _handle_dialog_approve(user_id: str, data: dict):
    """Handle dialog.approve from client.
    
    用于通过 WebSocket 处理对话授权响应。
    """
    msg_data = data.get("data", {})
    request_id = data.get("request_id", "")
    session_id = msg_data.get("session_id")
    approved = msg_data.get("approved", False)
    reason = msg_data.get("reason")
    
    if not session_id:
        await ws_manager.send_to_user(user_id, {
            "type": "error",
            "request_id": request_id,
            "data": {"message": "session_id is required"},
        })
        return
    
    async with async_session() as db:
        try:
            session = await agent_dialog_orchestrator.approve_session(
                db, uuid.UUID(session_id), uuid.UUID(user_id), approved, reason
            )
            await ws_manager.send_to_user(user_id, {
                "type": "dialog.approve.success",
                "request_id": request_id,
                "data": {
                    "session_id": str(session.id),
                    "status": session.status,
                },
            })
        except Exception as e:
            await db.rollback()
            await ws_manager.send_to_user(user_id, {
                "type": "error",
                "request_id": request_id,
                "data": {"message": e.error_message if isinstance(e, AppError) else "操作失败，请重试"},
            })
            if not isinstance(e, AppError):
                logger.error("WS handler error: %s", e, exc_info=True)


async def _handle_dialog_terminate(user_id: str, data: dict):
    """Handle dialog.terminate from client.
    
    用于通过 WebSocket 终止对话。
    """
    msg_data = data.get("data", {})
    request_id = data.get("request_id", "")
    session_id = msg_data.get("session_id")
    reason = msg_data.get("reason")
    
    if not session_id:
        await ws_manager.send_to_user(user_id, {
            "type": "error",
            "request_id": request_id,
            "data": {"message": "session_id is required"},
        })
        return
    
    async with async_session() as db:
        try:
            session = await agent_dialog_orchestrator.terminate_session(
                db, uuid.UUID(session_id), uuid.UUID(user_id), reason
            )
            await ws_manager.send_to_user(user_id, {
                "type": "dialog.terminate.success",
                "request_id": request_id,
                "data": {
                    "session_id": str(session.id),
                    "status": session.status,
                },
            })
        except Exception as e:
            await db.rollback()
            await ws_manager.send_to_user(user_id, {
                "type": "error",
                "request_id": request_id,
                "data": {"message": e.error_message if isinstance(e, AppError) else "操作失败，请重试"},
            })
            if not isinstance(e, AppError):
                logger.error("WS handler error: %s", e, exc_info=True)


async def _handle_message_stop(user_id: str, data: dict):
    """Handle message.stop from client.

    用户点击"停止生成"按钮时触发。
    1. 向 OpenClaw Gateway 发送 chat.abort，中止模型生成
    2. 通知所有参与者流式消息已结束
    """
    msg_data = data.get("data", {})
    conv_id = msg_data.get("conversation_id")

    if not conv_id:
        return

    async with async_session() as db:
        try:
            # 获取会话的所有参与者
            participant_result = await db.execute(
                select(ConversationParticipant.participant_id).where(
                    ConversationParticipant.conversation_id == uuid.UUID(conv_id)
                )
            )
            participant_ids = [str(row[0]) for row in participant_result.all()]

            # 广播停止事件，让前端清理所有该会话的流式消息
            await ws_manager.broadcast_message(
                participant_ids,
                {
                    "type": "message.stop",
                    "data": {
                        "conversation_id": conv_id,
                    },
                },
            )

            # 向 OpenClaw Gateway 发送 chat.abort，中止模型生成
            session_key = f"clawnet:{conv_id}"
            try:
                result = await openclaw_service.abort_chat(
                    user_id=user_id,
                    session_key=session_key,
                )
                logger.info(
                    "message.stop: chat.abort sent for conv=%s aborted=%s runIds=%s",
                    conv_id[:8],
                    result.get("aborted"),
                    result.get("runIds"),
                )
            except Exception as abort_err:
                logger.warning(
                    "message.stop: chat.abort failed for conv=%s: %s",
                    conv_id[:8],
                    abort_err,
                )
        except Exception as e:
            logger.error(
                "Failed to handle message.stop: %s", e, exc_info=True
            )


async def _handle_dialog_extend(user_id: str, data: dict):
    """Handle dialog.extend from client.
    
    用于通过 WebSocket 延长对话轮数。
    """
    msg_data = data.get("data", {})
    request_id = data.get("request_id", "")
    session_id = msg_data.get("session_id")
    additional_rounds = msg_data.get("additional_rounds", 5)
    
    if not session_id:
        await ws_manager.send_to_user(user_id, {
            "type": "error",
            "request_id": request_id,
            "data": {"message": "session_id is required"},
        })
        return
    
    async with async_session() as db:
        try:
            session = await agent_dialog_orchestrator.extend_session(
                db, uuid.UUID(session_id), uuid.UUID(user_id), additional_rounds
            )
            await ws_manager.send_to_user(user_id, {
                "type": "dialog.extend.success",
                "request_id": request_id,
                "data": {
                    "session_id": str(session.id),
                    "status": session.status,
                    "max_rounds": session.max_rounds,
                },
            })
        except Exception as e:
            await db.rollback()
            await ws_manager.send_to_user(user_id, {
                "type": "error",
                "request_id": request_id,
                "data": {"message": e.error_message if isinstance(e, AppError) else "操作失败，请重试"},
            })
            if not isinstance(e, AppError):
                logger.error("WS handler error: %s", e, exc_info=True)


# ============ Proxy Node Handlers ============

async def _handle_node_capabilities(user_id: str, data: dict, websocket: WebSocket):
    """Handle node.capabilities from macOS app client.

    Server is the source of truth: queries DB for fileAccess + tags
    instead of trusting client-provided values.
    """
    msg_data = data.get("data", {})
    request_id = data.get("request_id", "")
    node_id = msg_data.get("nodeId")
    commands = msg_data.get("commands", [])
    display_name = msg_data.get("displayName")
    platform = msg_data.get("platform")
    device_family = msg_data.get("deviceFamily")

    if not node_id or not commands:
        await ws_manager.send_to_user(user_id, {
            "type": "error",
            "request_id": request_id,
            "data": {"message": "nodeId and commands are required"},
        })
        return

    try:
        # Query DB for authoritative fileAccess + tagFileAccess
        from src.database import async_session
        from src.models.user import User
        from src.services import tag_service
        from sqlalchemy import select
        import time

        file_access = None
        tag_file_access = {}

        async with async_session() as db:
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if user:
                fa = (user.settings or {}).get("file_access", {})
                file_access = {
                    "mode": fa.get("mode", "scoped"),
                    "allowedPaths": fa.get("allowed_paths", []),
                    "deniedPaths": fa.get("denied_paths", []),
                    "updatedAtMs": int(time.time() * 1000),
                }

                tags = await tag_service.get_tags(db, user.id)
                for tag in tags:
                    tag_file_access[tag.name] = {
                        "allowedPaths": tag.node_acl.allowed_paths,
                        "deniedPaths": tag.node_acl.denied_paths,
                    }

        # Ensure gateway connection is ready before registering node
        from src.services.openclaw_service import openclaw_pool
        conn = await openclaw_pool.get_connection(user_id)
        if conn and not conn.connected:
            try:
                await asyncio.wait_for(conn._connected.wait(), timeout=5)
            except asyncio.TimeoutError:
                logger.warning("Gateway not ready for node registration, proceeding anyway: user=%s", user_id[:8])

        result = await openclaw_service.register_proxy_node(
            user_id=user_id,
            node_id=node_id,
            commands=commands,
            display_name=display_name,
            platform=platform,
            device_family=device_family,
            file_access=file_access,
            tag_file_access=tag_file_access,
        )

        # Track the proxy node -> websocket mapping
        ws_manager.register_proxy_node(node_id, user_id, websocket)

        await ws_manager.send_to_user(user_id, {
            "type": "node.capabilities.registered",
            "request_id": request_id,
            "data": {
                "nodeId": node_id,
                "commands": result.get("commands", commands),
            },
        })
        logger.info("Proxy node registered: nodeId=%s user=%s commands=%s", node_id, user_id[:8], commands)
    except Exception as e:
        logger.error("Failed to register proxy node: %s", e, exc_info=True)
        await ws_manager.send_to_user(user_id, {
            "type": "error",
            "request_id": request_id,
            "data": {"message": f"Failed to register node: {e}"},
        })


async def _handle_node_invoke_result(user_id: str, data: dict):
    """Handle node.invoke.result from macOS app client -- forward to gateway."""
    msg_data = data.get("data", {})
    invoke_id = msg_data.get("id")
    node_id = msg_data.get("nodeId")
    ok = msg_data.get("ok", False)
    payload_json = msg_data.get("payloadJSON")
    error = msg_data.get("error")

    if not invoke_id or not node_id:
        return

    # Pop cached invoke metadata for audit
    invoke_meta = ws_manager.pop_invoke(invoke_id)

    try:
        await openclaw_service.send_node_invoke_result(
            user_id=user_id,
            invoke_id=invoke_id,
            node_id=node_id,
            ok=ok,
            payload_json=payload_json,
            error=error,
        )
    except Exception as e:
        logger.error("Failed to forward invoke result: %s", e, exc_info=True)

    # Record audit log for file operations (fire-and-forget, truly non-blocking)
    if invoke_meta:
        import asyncio
        asyncio.create_task(_safe_record_file_operation(invoke_meta, ok, error, user_id))

    # Periodic cleanup of stale invokes
    import random
    if random.random() < 0.01:
        ws_manager.cleanup_stale_invokes()


async def _safe_record_file_operation(invoke_meta: dict, ok: bool, error, user_id: str):
    """Fire-and-forget wrapper for audit logging."""
    try:
        from src.services.openclaw_service import _record_file_operation
        await _record_file_operation(
            user_id=invoke_meta.get("user_id", user_id),
            agent_id=invoke_meta.get("agent_id"),
            command=invoke_meta.get("command", ""),
            params_json=invoke_meta.get("params_json"),
            ok=ok,
            error_message=error.get("message") if isinstance(error, dict) else str(error) if error else None,
        )
    except Exception as e:
        logger.warning("Failed to record file operation audit: %s", e)
