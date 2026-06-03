import asyncio
import json
import logging
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from src.websocket.manager import ws_manager
from src.websocket.handlers import authenticate_ws, handle_ws_message
from src.services.openclaw_service import openclaw_service

router = APIRouter(tags=["websocket"])
logger = logging.getLogger("clawnet.ws")


async def _unregister_proxy_nodes(user_id: str, node_ids: set[str]) -> None:
    """Unregister proxy nodes from gateway when client disconnects."""
    for node_id in node_ids:
        try:
            await openclaw_service.unregister_proxy_node(user_id, node_id)
            logger.info("Proxy node unregistered on disconnect: nodeId=%s user=%s", node_id, user_id[:8])
        except Exception as e:
            logger.warning("Failed to unregister proxy node %s: %s", node_id, e)


async def _update_user_status(user_id: str, status: str) -> None:
    """更新用户在线状态（静默失败）"""
    try:
        from src.database import async_session
        from src.models.user import User
        async with async_session() as db:
            user = await db.get(User, uuid.UUID(user_id))
            if user and user.status != status:
                user.status = status
                await db.commit()
                logger.debug("User %s status -> %s", user_id[:8], status)
    except Exception as e:
        logger.warning("Failed to update user %s status: %s", user_id[:8], e)


@router.websocket("/ws/v1/messages")
async def websocket_endpoint(websocket: WebSocket):
    # 尝试从 query param 快速认证（有 token 时先验证再 accept）
    token = websocket.query_params.get("token")

    if token:
        from src.utils.security import decode_token
        payload = decode_token(token)
        if not payload or payload.get("type") != "access" or not payload.get("sub"):
            await websocket.close(code=4001, reason="Invalid token")
            return
        user_id = payload["sub"]
        await websocket.accept()
    else:
        # 无 query token，需要接受连接后等待 auth 消息
        await websocket.accept()
        try:
            data = await asyncio.wait_for(websocket.receive_json(), timeout=10)
            if data.get("type") == "auth":
                token = data.get("token", "").replace("Bearer ", "")
        except (asyncio.TimeoutError, Exception):
            await websocket.close(code=4001, reason="Authentication required")
            return

        if not token:
            await websocket.close(code=4001, reason="Authentication required")
            return

        from src.utils.security import decode_token
        payload = decode_token(token)
        if not payload or payload.get("type") != "access":
            await websocket.close(code=4001, reason="Invalid token")
            return

        user_id = payload.get("sub")
        if not user_id:
            await websocket.close(code=4001, reason="Invalid token")
            return

    # Register connection (closes any stale connections for the same user)
    await ws_manager.register(websocket, user_id)

    # Mark user online
    asyncio.create_task(_update_user_status(user_id, "online"))

    # Ensure gateway connection + restore chat subscriptions
    asyncio.create_task(openclaw_service.ensure_user_chat_subscriptions(user_id))

    # Deliver any pending events the user missed while offline
    from src.services.event_service import deliver_pending_events
    asyncio.create_task(deliver_pending_events(user_id))

    # Send auth success
    await websocket.send_json({
        "type": "auth_success",
        "user_id": user_id,
    })

    try:
        while True:
            message = await websocket.receive()
            raw = message.get("text") or (message.get("bytes") or b"").decode("utf-8")
            if not raw:
                continue
            data = json.loads(raw)
            await handle_ws_message(user_id, data, websocket)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("WebSocket error for user %s: %s", user_id[:8], exc)
    finally:
        # Unregister any proxy nodes this connection had
        removed_nodes = ws_manager.cleanup_proxy_nodes(websocket)
        if removed_nodes:
            asyncio.create_task(_unregister_proxy_nodes(user_id, removed_nodes))
        await ws_manager.disconnect(websocket, user_id)
        # 如果该用户没有其他活跃连接，标记为离线
        if not ws_manager.is_online(user_id):
            asyncio.create_task(_update_user_status(user_id, "offline"))
