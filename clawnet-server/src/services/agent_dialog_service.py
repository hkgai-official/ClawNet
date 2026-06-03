"""
Agent Dialog Service

Agent-to-Agent 对话的核心调度器，包括：
- 会话创建与授权管理
- Prompt 注入与标记提取
- 轮转调度
- 终止判定引擎
"""

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Optional

from sqlalchemy import select, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import (
    GatewayConfig,
    get_gateway_config,
    register_agent_gateway,
    unregister_agent_gateway,
    settings,
)
from src.database import async_session
from src.models.agent import Agent
from src.models.agent_dialog_session import (
    AgentDialogSession,
    DialogSessionStatus,
    TerminationReason,
)
from src.models.conversation import Conversation, ConversationParticipant
from src.models.message import Message
from src.models.user import User
from src.schemas.agent_dialog import (
    CreateDialogSessionRequest,
    DialogSessionResponse,
    AgentInfo,
    UserInfo,
)
from src.schemas.message import SendMessageRequest
from src.services.message_service import send_message as save_message
from src.services.openclaw_service import agent_connection_manager
from src.services.session_key_service import upsert_session_key
from src.services.event_service import EventCollector
from src.websocket.manager import ws_manager

logger = logging.getLogger("clawnet.agent_dialog")


@dataclass
class DraftState:
    """In-memory state for a draft response awaiting user review."""
    agent_id: str
    draft_text: str = ""
    gateway_session_key: str = ""
    refine_history: list = dc_field(default_factory=list)
    status: str = "generating"  # "generating" | "ready" | "refining"


MAX_NESTING_DEPTH = 1  # 嵌套对话最大深度：0 可嵌套，1 不可再嵌套（最多 2 层对话链）
SOURCE_CONTEXT_LIMIT = 10  # 源对话上下文最多取最近 N 条消息


async def _route_agent_by_tag(
    db: AsyncSession, owner_id: uuid.UUID, initiator_owner_id: uuid.UUID
) -> uuid.UUID | None:
    """Select which local agent handles an inbound A2A dialog based on contact tag.

    Resolves the tag assigned to the initiator in the owner's contact list,
    then finds a delegate agent bound to that tag (preferring online agents).
    Falls back to any agent on the tag if no delegate is found.
    Returns None if no suitable agent found.
    """
    from src.services import tag_service

    tag = await tag_service.resolve_tag_for_contact(db, owner_id, initiator_owner_id)
    logger.warning(
        f"[A2A-route] owner={str(owner_id)[:8]} initiator={str(initiator_owner_id)[:8]} "
        f"→ tag={tag.name}({tag.display_name}) tag_id={str(tag.id)[:8]} is_default={tag.is_default}"
    )

    # Prefer delegate agent (read-only, designed for external A2A)
    agent = await tag_service.find_agent_by_tag_role(db, owner_id, tag.id, role="delegate")
    if agent:
        logger.warning(
            f"[A2A-route] delegate agent found: {str(agent.id)[:8]} tag_role={agent.tag_role}"
        )
        return agent.id

    # Fallback: any agent on this tag (backward compat for tags without role assignment)
    agent = await tag_service.find_agent_by_tag(db, owner_id, tag.id)
    logger.warning(
        f"[A2A-route] fallback agent={'found:'+str(agent.id)[:8] if agent else 'None'} "
        f"agent_tag_id={str(agent.tag_id)[:8] if agent and agent.tag_id else 'None'}"
    )
    return agent.id if agent else None


async def _fetch_source_context(
    conversation_id: str, db: AsyncSession, limit: int = SOURCE_CONTEXT_LIMIT,
    lang: str = "zh-Hans",
) -> str:
    """从源对话中提取最近的消息作为背景上下文"""
    from src.services.prompt_templates import get_source_context_labels

    try:
        conv_uuid = uuid.UUID(conversation_id)
    except (ValueError, TypeError):
        return ""

    result = await db.execute(
        select(Message)
        .where(
            Message.conversation_id == conv_uuid,
            Message.content_type.in_(["text", "agent_response"]),
        )
        .order_by(Message.timestamp.desc())
        .limit(limit)
    )
    messages = list(reversed(result.scalars().all()))
    if not messages:
        return ""

    header, footer, user_role = get_source_context_labels(lang)

    lines = []
    for msg in messages:
        role = "Agent" if msg.sender_type == "agent" else user_role
        text = (msg.content or {}).get("text", "")
        if text:
            if len(text) > 200:
                text = text[:200] + "..."
            lines.append(f"{role}: {text}")

    if not lines:
        return ""

    return f"{header}\n" + "\n".join(lines) + f"\n{footer}"


# ============ Prompt 模板（已迁移至 prompt_templates.py） ============
# 通过 get_template("initiator"/"responder"/"initial", lang) 获取


# ============ 状态标记提取 ============

STATUS_MARKER_PATTERN = re.compile(r"<<(RESOLVED|CONTINUE|DEADLOCK)>>", re.IGNORECASE)


def extract_dialog_status(text: str) -> tuple[str, Optional[str]]:
    """从 Agent 回复中提取状态标记
    
    Returns:
        tuple: (clean_text, status_marker)
        - clean_text: 移除标记后的文本
        - status_marker: RESOLVED / CONTINUE / DEADLOCK / None
    """
    match = STATUS_MARKER_PATTERN.search(text)
    if match:
        marker = match.group(1).upper()
        # 移除标记
        clean_text = STATUS_MARKER_PATTERN.sub("", text).strip()
        return clean_text, marker
    return text.strip(), None


# ============ 回复清洗 ============

# 需要清除的 LLM 杂质模式
_ARTIFACT_PATTERNS = [
    # XML 风格的 function_calls / invoke / parameter 标签
    re.compile(r"</?(?:antml:)?(?:function_calls|invoke|parameter|tool_use|tool_result)[^>]*>", re.IGNORECASE),
    # 类似 function_calls> 的残缺标签
    re.compile(r"(?:function_calls|invoke|parameter)\s*>", re.IGNORECASE),
    # [AGENT_DIALOG] ... [/AGENT_DIALOG] 系统指令回显
    re.compile(r"\[/?AGENT_DIALOG[^\]]*\]", re.IGNORECASE),
    # 泄漏的 prompt 指令标记
    re.compile(r"\[系统指令[^\]]*\]", re.IGNORECASE),
    # <<RESOLVED>> / <<CONTINUE>> / <<DEADLOCK>> 状态标记
    re.compile(r"<<(?:RESOLVED|CONTINUE|DEADLOCK)>>", re.IGNORECASE),
    # <<NEED_AGENT_DIALOG:...>> 意图标记
    re.compile(r"<<NEED_AGENT_DIALOG[^>]*>>", re.DOTALL),
]

# 需要整行删除的模式（如果某行只包含杂质，删掉整行）
_LINE_ARTIFACT_PATTERNS = [
    re.compile(r"^\s*</?(?:antml:)?(?:function_calls|invoke|parameter)[^>]*>\s*$", re.IGNORECASE),
    re.compile(r'^\s*<parameter\s+name=', re.IGNORECASE),
]


def _clean_agent_response(text: str) -> str:
    """清洗 Agent 回复中的 LLM 杂质
    
    移除：
    - XML 标签（function_calls, invoke, parameter 等）
    - 系统指令回显
    - 残缺的标记片段
    """
    # 先逐行处理，删掉纯杂质行
    lines = text.split("\n")
    cleaned_lines = []
    for line in lines:
        skip = False
        for pattern in _LINE_ARTIFACT_PATTERNS:
            if pattern.match(line):
                skip = True
                break
        if not skip:
            cleaned_lines.append(line)
    text = "\n".join(cleaned_lines)
    
    # 全局替换
    for pattern in _ARTIFACT_PATTERNS:
        text = pattern.sub("", text)
    
    # 清理多余空行
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    
    return text.strip()


def calculate_text_similarity(text1: str, text2: str) -> float:
    """计算两段文本的相似度"""
    return SequenceMatcher(None, text1, text2).ratio()


# ============ Agent Dialog Orchestrator ============

class AgentDialogOrchestrator:
    """Agent 对话调度器
    
    核心职责：
    1. 管理对话会话的生命周期
    2. 处理双方 Owner 的授权
    3. 轮转调度 Agent 间的对话
    4. 终止判定
    """

    def __init__(self):
        # 活跃的对话会话 (session_id -> session context)
        # 注意：这些是性能缓存，DB 是唯一真实状态源
        self._active_sessions: dict[str, dict] = {}
        self._lock = asyncio.Lock()
        # 用于标记缺失兜底检测
        self._recent_messages: dict[str, list[str]] = {}  # session_id -> last N messages
        self._missing_marker_count: dict[str, int] = {}  # session_id -> consecutive missing count
        # Draft sessions for human review (keyed by (session_id, round_num, agent_type))
        self._draft_sessions: dict[tuple[str, int, str], DraftState] = {}

    def _cleanup_memory_state(self, session_id_str: str):
        """清理指定 session 的内存缓存状态（非阻塞，不需要锁）"""
        self._active_sessions.pop(session_id_str, None)
        self._recent_messages.pop(session_id_str, None)
        self._missing_marker_count.pop(session_id_str, None)
        # Also clean up any pending drafts for this session
        draft_keys = [k for k in self._draft_sessions if k[0] == session_id_str]
        for k in draft_keys:
            del self._draft_sessions[k]

    # ---- Draft session helpers ----

    def _get_draft(self, session_id: str, round_num: int, agent_type: str) -> DraftState | None:
        return self._draft_sessions.get((session_id, round_num, agent_type))

    def _set_draft(self, session_id: str, round_num: int, agent_type: str, draft: DraftState):
        self._draft_sessions[(session_id, round_num, agent_type)] = draft

    def _clear_drafts_for_round(self, session_id: str, round_num: int):
        keys_to_remove = [k for k in self._draft_sessions if k[0] == session_id and k[1] == round_num]
        for k in keys_to_remove:
            del self._draft_sessions[k]

    async def _abort_active_runs(self, session: AgentDialogSession):
        """中止 Gateway 上两个 Agent 正在进行的 run（best-effort）"""
        session_id_str = str(session.id)
        agent_ids = [str(session.initiator_agent_id), str(session.responder_agent_id)]

        for agent_id in agent_ids:
            conn = agent_connection_manager.get_connection(agent_id)
            if not conn or not conn.connected:
                continue
            session_key = f"dialog:{session_id_str}:agent:{agent_id}"
            try:
                result = await conn.abort_chat(session_key=session_key)
                logger.info(
                    "[Session:%s] abort_chat for agent=%s: aborted=%s runIds=%s",
                    session_id_str[:8], agent_id[:8],
                    result.get("aborted"), result.get("runIds"),
                )
            except Exception as e:
                logger.warning(
                    "[Session:%s] abort_chat failed for agent=%s: %s",
                    session_id_str[:8], agent_id[:8], e,
                )

    async def create_session(
        self,
        db: AsyncSession,
        req: CreateDialogSessionRequest,
        created_by_user_id: uuid.UUID,
    ) -> DialogSessionResponse:
        """创建 Agent 对话会话

        1. 验证参与方
        2. 创建会话和 AgentDialogSession
        3. 发送授权请求给双方 Owner
        """
        # 获取发起方 Agent 信息
        initiator_agent = await db.get(Agent, req.initiator_agent_id)
        if not initiator_agent:
            raise ValueError(f"Initiator agent {req.initiator_agent_id} not found")

        # 验证发起方是 Owner（在路由前就验证，避免无意义的路由操作）
        if initiator_agent.owner_id != created_by_user_id:
            raise ValueError("You are not the owner of the initiator agent")

        # 解析接收方 Agent：始终通过 Contact tag 路由
        # 1. 确定 responder owner ID
        if req.responder_agent_id:
            hint_agent = await db.get(Agent, req.responder_agent_id)
            if not hint_agent:
                raise ValueError(f"Responder agent {req.responder_agent_id} not found")
            responder_owner_id = hint_agent.owner_id
        elif req.responder_owner_id:
            responder_owner_id = req.responder_owner_id
            hint_agent = None
        else:
            raise ValueError("Either responder_agent_id or responder_owner_id must be provided")

        # 2. 始终通过 Contact tag 路由选择正确的 responder agent
        routed_agent_id = await _route_agent_by_tag(
            db, responder_owner_id, initiator_agent.owner_id
        )
        if routed_agent_id:
            responder_agent = await db.get(Agent, routed_agent_id)
        else:
            # Fallback: 使用前端提供的 agent，或任意在线 agent
            if hint_agent:
                responder_agent = hint_agent
            else:
                from sqlalchemy import select as _select
                result = await db.execute(
                    _select(Agent)
                    .where(Agent.owner_id == responder_owner_id, Agent.status == "online")
                    .order_by(Agent.created_at.desc())
                    .limit(1)
                )
                responder_agent = result.scalar_one_or_none()

        if not responder_agent:
            raise ValueError("No available agent found for the responder owner")

        # 如果两个 Agent 属于不同 Owner，校验 Owner 之间的联系人关系
        if initiator_agent.owner_id != responder_agent.owner_id:
            from src.services.contact_check import are_owners_contacts
            if not await are_owners_contacts(db, initiator_agent.owner_id, responder_agent.owner_id):
                raise ValueError("Cannot create dialog: the responder agent's owner is not in your contacts")

        # Block main agent from A2A
        from src.services import tag_service

        initiator_tag = await tag_service.resolve_tag_for_agent(db, initiator_agent)
        if initiator_tag and initiator_tag.is_main:
            raise ValueError("Main agent cannot participate in A2A dialogs")

        responder_tag = await tag_service.resolve_tag_for_agent(db, responder_agent)
        if responder_tag and responder_tag.is_main:
            raise ValueError("Main agent cannot participate in A2A dialogs")

        # 获取 Owner 信息
        initiator_owner = await db.get(User, initiator_agent.owner_id)
        responder_owner = await db.get(User, responder_agent.owner_id)

        if not initiator_owner or not responder_owner:
            raise ValueError("Owner not found")

        # 创建会话
        conversation = Conversation(
            type="agent_task",
            created_by=created_by_user_id,
            title=f"Agent Dialog: {req.topic[:50]}",
            summary=req.topic[:20] if req.topic else None,
            summary_version=999,  # topic-derived, no auto-update needed
        )
        db.add(conversation)
        await db.flush()

        # 添加参与者（双方 Agent 和双方 Owner）
        participants = [
            ConversationParticipant(
                conversation_id=conversation.id,
                participant_id=initiator_agent.id,
                participant_type="agent",
            ),
            ConversationParticipant(
                conversation_id=conversation.id,
                participant_id=responder_agent.id,
                participant_type="agent",
            ),
            ConversationParticipant(
                conversation_id=conversation.id,
                participant_id=initiator_owner.id,
                participant_type="human",
            ),
            ConversationParticipant(
                conversation_id=conversation.id,
                participant_id=responder_owner.id,
                participant_type="human",
            ),
        ]
        for p in participants:
            db.add(p)

        # 创建 AgentDialogSession
        session = AgentDialogSession(
            conversation_id=conversation.id,
            initiator_agent_id=initiator_agent.id,
            responder_agent_id=responder_agent.id,
            initiator_owner_id=initiator_owner.id,
            responder_owner_id=responder_owner.id,
            topic=req.topic,
            max_rounds=req.max_rounds,
            idle_timeout_seconds=req.idle_timeout_seconds,
            status=DialogSessionStatus.PENDING_APPROVAL.value,
            # 发起方 Owner 自动授权（因为是他发起的）
            initiator_approved=True,
            # 元数据（如原始会话信息，用于结果回传）
            metadata_=req.metadata,
        )
        db.add(session)
        await db.flush()

        # ---- 解析双方各自的 contact tag（各自只能看到自己给对方打的 tag）----
        from src.services import tag_service
        # A 给 B 打的 tag（A 的视角：我把 B 分类为什么）
        initiator_contact_tag = await tag_service.resolve_tag_for_contact(
            db, initiator_owner.id, responder_owner.id
        )
        # B 给 A 打的 tag（B 的视角：我把 A 分类为什么）
        responder_contact_tag = await tag_service.resolve_tag_for_contact(
            db, responder_owner.id, initiator_owner.id
        )

        # ---- 消息1: 发起方看到的"请求已发送"卡片 ----
        request_msg = Message(
            conversation_id=conversation.id,
            sender_id=initiator_agent.id,
            sender_type="agent",
            content_type="dialog_request",
            content={
                "sessionId": str(session.id),
                "topic": req.topic,
                "myAgent": {
                    "id": str(initiator_agent.id),
                    "displayName": initiator_agent.display_name,
                    "avatarUrl": initiator_agent.avatar_url,
                    "status": initiator_agent.status,
                },
                "targetAgent": {
                    "id": str(responder_agent.id),
                    "displayName": responder_agent.display_name,
                    "avatarUrl": responder_agent.avatar_url,
                    "status": responder_agent.status,
                },
                "targetOwner": {
                    "id": str(responder_owner.id),
                    "displayName": responder_owner.display_name,
                    "avatarUrl": responder_owner.avatar_url,
                },
                "contactTag": {
                    "name": initiator_contact_tag.name,
                    "displayName": initiator_contact_tag.display_name,
                },
                "maxRounds": session.max_rounds,
                "status": "pending",
                "createdAt": int(session.created_at.timestamp() * 1000),
            },
        )
        db.add(request_msg)

        # ---- 消息2: 接收方看到的"授权请求"卡片 ----
        approval_msg = Message(
            conversation_id=conversation.id,
            sender_id=initiator_agent.id,
            sender_type="agent",
            content_type="dialog_approval",
            content={
                "sessionId": str(session.id),
                "topic": req.topic,
                "initiatorAgent": {
                    "id": str(initiator_agent.id),
                    "displayName": initiator_agent.display_name,
                    "avatarUrl": initiator_agent.avatar_url,
                    "status": initiator_agent.status,
                },
                "initiatorOwner": {
                    "id": str(initiator_owner.id),
                    "displayName": initiator_owner.display_name,
                    "avatarUrl": initiator_owner.avatar_url,
                },
                "myAgent": {
                    "id": str(responder_agent.id),
                    "displayName": responder_agent.display_name,
                    "avatarUrl": responder_agent.avatar_url,
                    "status": responder_agent.status,
                },
                "contactTag": {
                    "name": responder_contact_tag.name,
                    "displayName": responder_contact_tag.display_name,
                },
                "status": "pending",
                "createdAt": int(session.created_at.timestamp() * 1000),
            },
        )
        db.add(approval_msg)
        
        # 更新会话的最后消息预览
        now = datetime.now(timezone.utc)
        from src.services.prompt_templates import get_reason_string, get_user_lang
        conversation.last_message_preview = get_reason_string("pending_label", get_user_lang(responder_owner)) + req.topic[:60]
        conversation.last_message_at = now
        conversation.updated_at = now
        
        # 给接收方 Owner 增加未读计数
        for p in participants:
            if p.participant_id == responder_owner.id:
                p.unread_count = (p.unread_count or 0) + 1
                break
        
        await db.flush()

        # 收集事件（随事务持久化）
        events = EventCollector()

        sender_data = {
            "id": str(initiator_agent.id),
            "name": initiator_agent.display_name,
            "type": "agent",
            "avatar": initiator_agent.avatar_url,
            "owner_name": initiator_owner.display_name,
        }

        # 事件1: 接收方 Owner 的授权请求弹窗
        events.add(db, str(responder_owner.id), "dialog.approval_request", {
            "session_id": str(session.id),
            "topic": req.topic,
            "initiator_agent": {
                "id": str(initiator_agent.id),
                "display_name": initiator_agent.display_name,
                "avatar_url": initiator_agent.avatar_url,
                "status": initiator_agent.status,
            },
            "initiator_owner": {
                "id": str(initiator_owner.id),
                "display_name": initiator_owner.display_name,
                "avatar_url": initiator_owner.avatar_url,
            },
            "responder_agent": {
                "id": str(responder_agent.id),
                "display_name": responder_agent.display_name,
                "avatar_url": responder_agent.avatar_url,
                "status": responder_agent.status,
            },
            "created_at": session.created_at.isoformat(),
        })

        # 事件2: 发起方 Owner 的 dialog_request 卡片
        events.add(db, str(initiator_owner.id), "message.new", {
            "id": str(request_msg.id),
            "conversation_id": str(conversation.id),
            "sender": sender_data,
            "content_type": "dialog_request",
            "content": request_msg.content,
            "timestamp": request_msg.timestamp.isoformat(),
        })

        # 事件3: 接收方 Owner 的 dialog_approval 卡片
        events.add(db, str(responder_owner.id), "message.new", {
            "id": str(approval_msg.id),
            "conversation_id": str(conversation.id),
            "sender": sender_data,
            "content_type": "dialog_approval",
            "content": approval_msg.content,
            "timestamp": approval_msg.timestamp.isoformat(),
        })

        # 事件4: 通知发起方 Owner 请求已发送（触发会话列表刷新）
        events.add(db, str(initiator_owner.id), "dialog.request_sent", {
            "session_id": str(session.id),
            "conversation_id": str(conversation.id),
            "responder_agent": {
                "id": str(responder_agent.id),
                "display_name": responder_agent.display_name,
            },
            "responder_owner": {
                "id": str(responder_owner.id),
                "display_name": responder_owner.display_name,
            },
            "topic": req.topic,
        })

        response = await self._build_session_response(session, db)
        # 先 commit，再投递通知
        await db.commit()
        await events.deliver()
        return response

    async def approve_session(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        approved: bool,
        reason: Optional[str] = None,
    ) -> DialogSessionResponse:
        """处理 Owner 的授权响应（幂等：重复提交相同决定不报错）"""
        session = await db.get(AgentDialogSession, session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        # 确定是哪一方
        if user_id == session.initiator_owner_id:
            already_decided = session.initiator_approved is not None
            same_decision = session.initiator_approved == approved
        elif user_id == session.responder_owner_id:
            already_decided = session.responder_approved is not None
            same_decision = session.responder_approved == approved
        else:
            raise ValueError("You are not a participant owner of this session")

        # 幂等：如果 session 已不是 PENDING，且用户已做过相同决定，直接返回
        if session.status != DialogSessionStatus.PENDING_APPROVAL.value:
            if already_decided and same_decision:
                logger.info(
                    f"[Session:{str(session_id)[:8]}] Idempotent approval from "
                    f"user {str(user_id)[:8]}, status={session.status}"
                )
                return await self._build_session_response(session, db)
            raise ValueError(f"Session is not pending approval, current status: {session.status}")

        # 设置授权状态
        if user_id == session.initiator_owner_id:
            session.initiator_approved = approved
        else:
            session.responder_approved = approved
        
        old_status = session.status

        if not approved:
            # 任一方拒绝
            session.status = DialogSessionStatus.TERMINATED.value
            session.termination_reason = TerminationReason.OWNER_REJECTED.value
            session.completed_at = datetime.now(timezone.utc)
            
            # 更新数据库中的卡片消息状态
            await self._update_card_messages_status(
                db, session.conversation_id, str(session_id), "rejected",
            )

            # 给发起方的原始会话发一条系统消息（确保有未读提醒）
            metadata = session.metadata_ or {}
            source_conv_id = metadata.get("source_conversation_id")
            if source_conv_id:
                rejector = await db.get(User, user_id)
                rejector_name = rejector.display_name if rejector else ""
                params = {"rejector_name": rejector_name}
                if reason:
                    params["custom_reason"] = reason
                await self._send_dialog_status(
                    db,
                    uuid.UUID(source_conv_id),
                    action="approval_rejected",
                    reason="owner_rejected",
                    params=params,
                    owner_ids=[session.initiator_owner_id],
                )

            # 收集事件
            events = EventCollector()
            user_ids = [str(session.initiator_owner_id), str(session.responder_owner_id)]
            status_payload = {
                "session_id": str(session.id),
                "conversation_id": str(session.conversation_id),
                "old_status": old_status,
                "new_status": session.status,
                "reason": reason or "Owner rejected the dialog request",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            for uid in user_ids:
                events.add(db, uid, "dialog.status_change", status_payload)

            response = await self._build_session_response(session, db)
            await db.commit()
            await events.deliver()

            # 如果是 discovery 子对话，通知编排器
            if metadata.get("discovery_task_id"):
                logger.info(
                    f"[Session:{str(session_id)[:8]}] Rejection on discovery dialog, "
                    f"triggering feedback"
                )
                await self._feedback_dialog_result(session, db)

            return response

        elif session.initiator_approved and session.responder_approved:
            # 双方都授权，用乐观锁原子切换到 ACTIVE
            activate_result = await db.execute(
                update(AgentDialogSession)
                .where(
                    AgentDialogSession.id == session_id,
                    AgentDialogSession.version == session.version,
                    AgentDialogSession.status == DialogSessionStatus.PENDING_APPROVAL.value,
                )
                .values(
                    status=DialogSessionStatus.ACTIVE.value,
                    started_at=datetime.now(timezone.utc),
                    version=session.version + 1,
                )
            )
            if activate_result.rowcount == 0:
                await db.refresh(session)
                return await self._build_session_response(session, db)

            await db.refresh(session)

            # 更新数据库中的卡片消息状态
            await self._update_card_messages_status(
                db, session.conversation_id, str(session_id), "approved",
            )

            # 收集事件
            events = EventCollector()
            user_ids = [str(session.initiator_owner_id), str(session.responder_owner_id)]
            status_payload = {
                "session_id": str(session.id),
                "conversation_id": str(session.conversation_id),
                "old_status": old_status,
                "new_status": session.status,
                "reason": "Both parties approved, dialog started",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            for uid in user_ids:
                events.add(db, uid, "dialog.status_change", status_payload)

            response = await self._build_session_response(session, db)
            await db.commit()
            await events.deliver()

            asyncio.create_task(self._start_dialog(session_id))
            return response

        response = await self._build_session_response(session, db)
        await db.commit()
        return response

    async def terminate_session(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        reason: Optional[str] = None,
        skip_discovery_feedback: bool = False,
    ) -> DialogSessionResponse:
        """Owner 手动终止对话"""
        session = await db.get(AgentDialogSession, session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")
        
        if not session.is_participant_owner(user_id):
            raise ValueError("You are not a participant owner of this session")
        
        if session.status in (
            DialogSessionStatus.COMPLETED.value,
            DialogSessionStatus.TERMINATED.value,
        ):
            raise ValueError("Session is already completed or terminated")

        old_status = session.status

        # 乐观锁：原子更新状态为 TERMINATED
        result = await db.execute(
            update(AgentDialogSession)
            .where(
                AgentDialogSession.id == session_id,
                AgentDialogSession.version == session.version,
                AgentDialogSession.status.notin_([
                    DialogSessionStatus.COMPLETED.value,
                    DialogSessionStatus.TERMINATED.value,
                ]),
            )
            .values(
                status=DialogSessionStatus.TERMINATED.value,
                termination_reason=TerminationReason.OWNER_TERMINATED.value,
                completed_at=datetime.now(timezone.utc),
                version=session.version + 1,
            )
        )
        if result.rowcount == 0:
            raise ValueError("Session is already completed or terminated (concurrent modification)")

        await db.refresh(session)

        # 清理内存缓存
        self._cleanup_memory_state(str(session_id))

        # 中止 Gateway 上正在进行的 run（两个 Agent 各自的 session_key）
        await self._abort_active_runs(session)

        # 广播 message.stop 给前端清理流式消息
        conv_id_str = str(session.conversation_id)
        owner_ids = [str(session.initiator_owner_id), str(session.responder_owner_id)]
        await ws_manager.broadcast_message(
            owner_ids,
            {
                "type": "message.stop",
                "data": {"conversation_id": conv_id_str},
            },
        )

        # 发送结构化对话状态消息
        await self._send_dialog_status(
            db,
            session.conversation_id,
            action="terminated",
            reason=reason if reason else "owner_terminated",
            owner_ids=[session.initiator_owner_id, session.responder_owner_id],
        )

        # 收集事件
        events = EventCollector()
        user_ids = [str(session.initiator_owner_id), str(session.responder_owner_id)]
        terminated_payload = {
            "session_id": str(session.id),
            "conversation_id": str(session.conversation_id),
            "termination_reason": TerminationReason.OWNER_TERMINATED.value,
            "final_round": session.current_round,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        for uid in user_ids:
            events.add(db, uid, "dialog.terminated", terminated_payload)

        response = await self._build_session_response(session, db)
        await db.commit()
        await events.deliver()

        # 如果有源对话（discovery 或直接 A2A），回传结果给源 Agent
        if not skip_discovery_feedback:
            metadata = session.metadata_ or {}
            if metadata.get("discovery_task_id") or metadata.get("source_conversation_id"):
                logger.info(
                    f"[Session:{str(session_id)[:8]}] Termination on tracked dialog, "
                    f"triggering feedback"
                )
                await self._feedback_dialog_result(session, db)

        return response

    async def extend_session(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        additional_rounds: int,
    ) -> DialogSessionResponse:
        """延长对话轮数"""
        session = await db.get(AgentDialogSession, session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")
        
        if not session.is_participant_owner(user_id):
            raise ValueError("You are not a participant owner of this session")
        
        if session.status not in (DialogSessionStatus.PAUSED.value, DialogSessionStatus.ACTIVE.value):
            raise ValueError("Session must be active or paused to extend")

        was_paused = session.status == DialogSessionStatus.PAUSED.value
        old_status = session.status
        session.max_rounds += additional_rounds

        if was_paused:
            session.status = DialogSessionStatus.ACTIVE.value

        from src.services.prompt_templates import get_reason_string, get_user_lang
        initiator_owner = await db.get(User, session.initiator_owner_id)
        lang = get_user_lang(initiator_owner)

        # 收集事件
        events = EventCollector()
        user_ids = [str(session.initiator_owner_id), str(session.responder_owner_id)]
        status_payload = {
            "session_id": str(session.id),
            "conversation_id": str(session.conversation_id),
            "old_status": old_status,
            "new_status": session.status,
            "reason": get_reason_string("rounds_increased", lang, n=additional_rounds),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        for uid in user_ids:
            events.add(db, uid, "dialog.status_change", status_payload)

        response = await self._build_session_response(session, db)
        await db.commit()
        await events.deliver()

        # 如果之前是暂停状态，继续对话
        if was_paused:
            asyncio.create_task(self._continue_dialog(session_id))

        return response

    async def get_session(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> DialogSessionResponse:
        """获取会话详情"""
        session = await db.get(AgentDialogSession, session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")
        
        if not session.is_participant_owner(user_id):
            raise ValueError("You are not a participant owner of this session")
        
        return await self._build_session_response(session, db)

    async def get_session_by_conversation(
        self,
        db: AsyncSession,
        conversation_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> Optional[DialogSessionResponse]:
        """根据 conversation_id 查找对话会话"""
        result = await db.execute(
            select(AgentDialogSession).where(
                AgentDialogSession.conversation_id == conversation_id
            )
        )
        session = result.scalar_one_or_none()
        if not session:
            return None

        if not session.is_participant_owner(user_id):
            return None

        return await self._build_session_response(session, db)

    async def list_sessions(
        self,
        db: AsyncSession,
        user_id: uuid.UUID,
        status: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[DialogSessionResponse], int]:
        """列出用户参与的对话会话"""
        query = select(AgentDialogSession).where(
            (AgentDialogSession.initiator_owner_id == user_id) |
            (AgentDialogSession.responder_owner_id == user_id)
        )
        
        if status:
            query = query.where(AgentDialogSession.status == status)
        
        # 获取总数
        count_query = select(AgentDialogSession.id).where(
            (AgentDialogSession.initiator_owner_id == user_id) |
            (AgentDialogSession.responder_owner_id == user_id)
        )
        if status:
            count_query = count_query.where(AgentDialogSession.status == status)
        
        count_result = await db.execute(count_query)
        total = len(count_result.all())
        
        # 获取数据
        query = query.order_by(AgentDialogSession.created_at.desc()).limit(limit).offset(offset)
        result = await db.execute(query)
        sessions = result.scalars().all()
        
        responses = []
        for session in sessions:
            responses.append(await self._build_session_response(session, db))
        
        return responses, total

    # ============ 内部方法 ============

    async def _start_dialog(self, session_id: uuid.UUID):
        """启动对话（发送首条消息给发起方 Agent）"""
        async with async_session() as db:
            session = await db.get(AgentDialogSession, session_id)
            if not session or session.status != DialogSessionStatus.ACTIVE.value:
                return
            
            # 获取参与方信息
            initiator_agent = await db.get(Agent, session.initiator_agent_id)
            responder_agent = await db.get(Agent, session.responder_agent_id)
            initiator_owner = await db.get(User, session.initiator_owner_id)
            responder_owner = await db.get(User, session.responder_owner_id)
            
            if not all([initiator_agent, responder_agent, initiator_owner, responder_owner]):
                logger.error(f"[Session:{str(session_id)[:8]}] Failed to get participants")
                return

            # 注册到活跃会话缓存（asyncio 单线程，dict 操作无需锁）
            self._active_sessions[str(session_id)] = {
                "current_speaker": "initiator",
                "waiting_response": True,
            }
            self._recent_messages[str(session_id)] = []
            self._missing_marker_count[str(session_id)] = 0

            # 获取发起方语言偏好
            from src.services.prompt_templates import get_template, get_user_lang
            lang = get_user_lang(initiator_owner)

            # 获取源对话上下文
            metadata = session.metadata_ or {}
            source_conv_id = metadata.get("source_conversation_id")
            source_context = ""
            if source_conv_id:
                source_context = await _fetch_source_context(source_conv_id, db, lang=lang)
                if source_context:
                    source_context = "\n" + source_context + "\n"

            # 构建首条消息的 Prompt
            prompt = get_template("initial", lang).format(
                my_owner_name=initiator_owner.display_name,
                other_owner_name=responder_owner.display_name,
                topic=session.topic,
                max_rounds=session.max_rounds,
                source_context=source_context,
            )

            # 发送给发起方 Agent
            await self._send_to_agent(
                session=session,
                agent=initiator_agent,
                message=prompt,
                db=db,
            )

    async def _continue_dialog(self, session_id: uuid.UUID):
        """继续暂停的对话（从 DB 推断发言者，不依赖内存状态）"""
        async with async_session() as db:
            session = await db.get(AgentDialogSession, session_id)
            if not session or session.status != DialogSessionStatus.ACTIVE.value:
                return

            # 确保内存缓存存在（可能被 cleanup 清理过）
            session_id_str = str(session_id)
            if session_id_str not in self._active_sessions:
                self._active_sessions[session_id_str] = {
                    "current_speaker": None,
                    "waiting_response": True,
                }

            # 获取最后一条 agent 消息，从 sender_id 推断谁是上一个发言者
            result = await db.execute(
                select(Message)
                .where(
                    Message.conversation_id == session.conversation_id,
                    Message.sender_type == "agent",
                )
                .order_by(Message.timestamp.desc())
                .limit(1)
            )
            last_message = result.scalar_one_or_none()

            if not last_message:
                return

            # 从最后一条消息的 sender_id 推断下一个发言者
            last_speaker_id = last_message.sender_id
            if last_speaker_id == session.initiator_agent_id:
                # 上一个是 initiator，下一个是 responder
                next_agent = await db.get(Agent, session.responder_agent_id)
                next_agent_owner = await db.get(User, session.responder_owner_id)
                other_owner = await db.get(User, session.initiator_owner_id)
                is_initiator = False
            else:
                # 上一个是 responder，下一个是 initiator
                next_agent = await db.get(Agent, session.initiator_agent_id)
                next_agent_owner = await db.get(User, session.initiator_owner_id)
                other_owner = await db.get(User, session.responder_owner_id)
                is_initiator = True

            if not next_agent or not next_agent_owner or not other_owner:
                return

            # 构建 Prompt
            message_text = last_message.content.get("text", "")
            prompt = await self._build_prompt(
                session=session,
                is_initiator=is_initiator,
                my_owner_name=next_agent_owner.display_name,
                other_owner_name=other_owner.display_name,
                other_agent_message=message_text,
                db=db,
                current_agent=next_agent,
            )
            
            # 发送
            await self._send_to_agent(
                session=session,
                agent=next_agent,
                message=prompt,
                db=db,
            )

    async def _send_to_agent(
        self,
        session: AgentDialogSession,
        agent: Agent,
        message: str,
        db: AsyncSession,
    ):
        """发送消息到 Agent 的 OpenClaw Gateway"""
        conn = agent_connection_manager.get_connection(str(agent.id))
        if not conn:
            # Agent 未连接，尝试建立连接
            config = get_gateway_config(str(agent.owner_id))
            if not config:
                logger.error(f"[Agent:{str(agent.id)[:8]}] No gateway config found")
                await self._handle_agent_offline(session, agent, db)
                return

            conn = await agent_connection_manager.connect_agent(str(agent.id), config)
            if not conn:
                logger.error(f"[Agent:{str(agent.id)[:8]}] Failed to connect")
                await self._handle_agent_offline(session, agent, db)
                return

        # 每个 Agent 使用独立的 session_key，确保 OpenClaw Gateway 中
        # 两个 Agent 有各自独立的上下文，不会混淆身份和知识
        session_key = f"dialog:{session.id}:agent:{agent.id}"
        idempotency_key = f"dialog-{session.id}-{session.current_round}-{agent.id}"

        # 获取参与者 ID 列表
        result = await db.execute(
            select(ConversationParticipant.participant_id).where(
                ConversationParticipant.conversation_id == session.conversation_id
            )
        )
        participant_ids = [str(row[0]) for row in result.all()]

        # A2A tag 解析：根据角色明确 tag 来源
        # - 发起者: 用自己 agent 绑定的 tag（用户选了哪个 agent 就用哪个 tag）
        # - 响应者: 用 Contact 权限（我给对方设的 tag，即对方来找我时看到的人格）
        from src.services import tag_service
        is_initiator = (agent.id == session.initiator_agent_id)
        if is_initiator:
            tag = await tag_service.resolve_tag_for_agent(db, agent)
        else:
            tag = await tag_service.resolve_tag_for_contact(
                db, agent.owner_id, session.initiator_owner_id
            )
        logger.warning(
            f"[A2A-tag-ctx] agent={str(agent.id)[:8]} role={'initiator' if is_initiator else 'responder'} "
            f"→ tag={tag.name}({tag.display_name}) tag_id={str(tag.id)[:8]}"
        )

        # 定义回调处理响应（带错误恢复）
        session_id_capture = session.id
        agent_id_capture = agent.id

        def on_agent_response(run_id: str, response_text: str, streaming_message_id: str = None):
            task = asyncio.create_task(
                self._handle_agent_response(
                    session_id=session_id_capture,
                    agent_id=agent_id_capture,
                    response_text=response_text,
                    participant_ids=participant_ids,
                    streaming_message_id=streaming_message_id,
                )
            )
            task.add_done_callback(
                lambda t: self._on_response_task_done(
                    t, session_id_capture, agent_id_capture, response_text, participant_ids
                )
            )

        # 发送 prompt 前先刷新 last_message_at，防止 cleanup 任务在 agent 处理期间
        # 误判为空闲超时（last_message_at 仅在收到响应时更新，发送到响应之间可能很长）
        now = datetime.now(timezone.utc)
        await db.execute(
            update(AgentDialogSession)
            .where(AgentDialogSession.id == session.id)
            .values(last_message_at=now)
        )
        await db.commit()

        await conn.send_chat(
            conversation_id=str(session.conversation_id),
            user_id=str(agent.owner_id),
            participant_ids=participant_ids,
            agent_id=str(agent.id),
            session_key=session_key,
            message=message,
            idempotency_key=idempotency_key,
            dialog_session_id=str(session.id),
            on_complete=on_agent_response,
            timeout_ms=settings.AGENT_DIALOG_RUN_TIMEOUT_SECONDS * 1000,
            tag_id=str(tag.id),
            a2a_mode=True,
        )

    def _on_response_task_done(
        self,
        task: asyncio.Task,
        session_id: uuid.UUID,
        agent_id: uuid.UUID,
        response_text: str,
        participant_ids: list[str],
    ):
        """回调 task 完成/失败时的处理"""
        exc = task.exception()
        if exc is None:
            return  # 成功，无需处理

        log_prefix = f"[A2A Session:{str(session_id)[:8]}]"
        logger.error(
            f"{log_prefix} _handle_agent_response failed: {exc}",
            exc_info=exc,
        )

        # 尝试重试一次
        retry_task = asyncio.create_task(
            self._retry_handle_agent_response(
                session_id, agent_id, response_text, participant_ids
            )
        )
        retry_task.add_done_callback(
            lambda t: self._on_retry_failed(t, session_id)
            if t.exception() else None
        )

    async def _retry_handle_agent_response(
        self,
        session_id: uuid.UUID,
        agent_id: uuid.UUID,
        response_text: str,
        participant_ids: list[str],
    ):
        """重试一次 _handle_agent_response"""
        log_prefix = f"[A2A Session:{str(session_id)[:8]}]"
        logger.info(f"{log_prefix} Retrying _handle_agent_response...")

        await asyncio.sleep(2)  # 等待 2 秒再重试
        await self._handle_agent_response(
            session_id=session_id,
            agent_id=agent_id,
            response_text=response_text,
            participant_ids=participant_ids,
        )

    def _on_retry_failed(self, task: asyncio.Task, session_id: uuid.UUID):
        """重试也失败时：暂停 session 并通知用户"""
        exc = task.exception()
        if exc is None:
            return

        log_prefix = f"[A2A Session:{str(session_id)[:8]}]"
        logger.error(
            f"{log_prefix} Retry also failed: {exc}. Pausing session.",
            exc_info=exc,
        )

        # 异步暂停 session 并通知 owner
        asyncio.create_task(
            self._emergency_pause_session(session_id, str(exc))
        )

    async def _emergency_pause_session(
        self, session_id: uuid.UUID, error_msg: str
    ):
        """紧急暂停 session（当回调处理彻底失败时）"""
        try:
            async with async_session() as db:
                session = await db.get(AgentDialogSession, session_id)
                if not session:
                    return
                if session.status not in (
                    DialogSessionStatus.ACTIVE.value,
                    DialogSessionStatus.PENDING_APPROVAL.value,
                ):
                    return  # 已经不是活跃状态，无需处理

                from src.services.prompt_templates import get_reason_string
                await self._pause_session(
                    session=session,
                    reason=get_reason_string("system_error", error_detail=error_msg[:100]),
                    db=db,
                )
                self._cleanup_memory_state(str(session_id))
        except Exception as e:
            logger.error(
                f"[Session:{str(session_id)[:8]}] Emergency pause also failed: {e}",
                exc_info=True,
            )

    async def _handle_agent_response(
        self,
        session_id: uuid.UUID,
        agent_id: uuid.UUID,
        response_text: str,
        participant_ids: list[str],
        streaming_message_id: str = None,
    ):
        """处理 Agent 的响应"""
        async with async_session() as db:
            session = await db.get(AgentDialogSession, session_id)
            if not session:
                logger.warning(f"[A2A] Session {session_id} not found, ignoring response")
                return

            # 获取 initiator 语言偏好（用于本地化通知）
            from src.services.prompt_templates import get_user_lang
            initiator_owner = await db.get(User, session.initiator_owner_id)
            lang = get_user_lang(initiator_owner)

            # 检查会话是否仍在活跃状态
            if session.status not in (
                DialogSessionStatus.ACTIVE.value,
                DialogSessionStatus.PENDING_APPROVAL.value,
            ):
                logger.info(
                    f"[A2A Session:{str(session_id)[:8]}] Session already {session.status}, "
                    f"ignoring late response from agent {str(agent_id)[:8]}"
                )
                # 自愈：清理可能残留的内存状态
                self._cleanup_memory_state(str(session_id))
                return

            # 在清洗前先检测嵌套对话意图（<<NEED_AGENT_DIALOG>> 标记）
            from src.services.intent_parser import extract_dialog_intents
            cleaned_for_intents, nested_intents = extract_dialog_intents(response_text)
            if nested_intents:
                response_text = cleaned_for_intents

            # 提取状态标记
            clean_text, status_marker = extract_dialog_status(response_text)

            logger.info(
                f"[A2A Session:{str(session_id)[:8]}] Agent:{str(agent_id)[:8]} responded, "
                f"round={session.current_round+1}/{session.max_rounds}, "
                f"marker={status_marker}, nested_intents={len(nested_intents)}, "
                f"text_len={len(clean_text)}"
            )

            # 清洗 LLM 回复中的杂质（XML标签、function_calls 等）
            clean_text = _clean_agent_response(clean_text)

            # --- Human review mode: hold draft instead of saving/forwarding ---
            # Store draft in memory; DO NOT save to DB, increment round, or switch speaker.
            # The owner must explicitly submit via submit_response() to proceed.

            current_round = session.current_round
            draft_session_key = f"draft:{session_id}:round:{current_round}:tag"

            # Get agent display name for the pending_review event
            agent_obj = await db.get(Agent, agent_id)
            agent_display_name = agent_obj.display_name if agent_obj else str(agent_id)[:8]

            draft = DraftState(
                agent_id=str(agent_id),
                draft_text=clean_text,
                gateway_session_key=draft_session_key,
                status="ready",
            )
            # Stash intent/marker info on the draft for submit_response to use later
            draft._status_marker = status_marker
            draft._nested_intents = nested_intents
            draft._lang = lang
            self._set_draft(str(session_id), current_round, "tag", draft)

            # Determine the owner of this agent and push pending_review event
            if str(agent_id) == str(session.initiator_agent_id):
                owner_id = str(session.initiator_owner_id)
            else:
                owner_id = str(session.responder_owner_id)

            await ws_manager.send_to_user(owner_id, {
                "type": "dialog.pending_review",
                "data": {
                    "session_id": str(session_id),
                    "conversation_id": str(session.conversation_id),
                    "round": current_round,
                    "draft_text": clean_text,
                    "agent_name": agent_display_name,
                }
            })

            logger.info(
                f"[A2A Session:{str(session_id)[:8]}] Draft held for review, "
                f"agent={str(agent_id)[:8]}, round={current_round}, "
                f"marker={status_marker}, owner={owner_id[:8]}"
            )

    async def _handle_nested_dialog_request(
        self,
        session: AgentDialogSession,
        agent_id: uuid.UUID,
        intents: list,
        db: AsyncSession,
        lang: str = "zh-Hans",
    ) -> bool:
        """处理嵌套对话请求：暂停当前 A2A 对话并创建 DiscoveryTask 子任务

        Returns:
            True 表示已成功创建子任务并暂停当前对话，调用方应直接 return；
            False 表示受限（如嵌套深度超限），调用方继续正常流程。
        """
        session_id_str = str(session.id)
        metadata = dict(session.metadata_ or {})
        nesting_depth = metadata.get("nesting_depth", 0)

        if nesting_depth >= MAX_NESTING_DEPTH:
            logger.warning(
                f"[Session:{session_id_str[:8]}] Nesting depth limit reached "
                f"({nesting_depth}/{MAX_NESTING_DEPTH}), ignoring nested intent"
            )
            return False

        # 循环防护：过滤掉指向当前对话参与方的意图
        initiator_owner = await db.get(User, session.initiator_owner_id)
        responder_owner = await db.get(User, session.responder_owner_id)
        current_party_names = {
            initiator_owner.display_name if initiator_owner else "",
            responder_owner.display_name if responder_owner else "",
        }
        current_party_names.discard("")

        valid_intents = []
        for intent in intents:
            if intent.target_owner in current_party_names:
                logger.warning(
                    f"[Session:{session_id_str[:8]}] Blocked circular intent: "
                    f"agent tried to contact '{intent.target_owner}' who is already in this dialog"
                )
            else:
                valid_intents.append(intent)

        if not valid_intents:
            logger.info(
                f"[Session:{session_id_str[:8]}] All nested intents were circular, "
                f"continuing normal dialog flow"
            )
            return False

        intents = valid_intents

        target_names = [i.target_owner for i in intents]
        logger.info(
            f"[Session:{session_id_str[:8]}] Nested dialog request from "
            f"agent {str(agent_id)[:8]}: targets={target_names}"
        )

        # 缓存必要字段——_pause_session 内部 commit 后 session 属性会过期
        session_conv_id = session.conversation_id
        session_initiator_agent_id = session.initiator_agent_id
        session_initiator_owner_id = session.initiator_owner_id
        session_responder_owner_id = session.responder_owner_id
        session_topic = session.topic

        # 暂停当前对话（内部 commit + WS 通知）
        from src.services.prompt_templates import get_reason_string
        await self._pause_session(
            session=session,
            reason=get_reason_string("contacting", lang, targets=', '.join(target_names)),
            db=db,
            pause_reason=TerminationReason.NESTED_DIALOG,
        )

        # 确定发起嵌套对话的 Agent 所属 Owner
        if agent_id == session_initiator_agent_id:
            nested_owner_id = session_initiator_owner_id
        else:
            nested_owner_id = session_responder_owner_id

        # 构造查询列表（携带嵌套深度，供子会话继承）
        queries = [
            {
                "target_owner": i.target_owner,
                "topic": i.topic,
                "nesting_depth": nesting_depth + 1,
            }
            for i in intents
        ]

        # 创建 DiscoveryTask（内部 flush，尚未 commit）
        from src.services.discovery_service import discovery_orchestrator

        task = await discovery_orchestrator.create_task(
            db=db,
            source_conversation_id=str(session_conv_id),
            initiator_agent_id=str(agent_id),
            initiator_owner_id=str(nested_owner_id),
            original_intent=session_topic,
            queries=queries,
            max_hops=5,
            max_concurrent=2,
        )

        # 一次性更新 session metadata + task 状态，合并为单次 commit
        metadata["nested_initiator_agent_id"] = str(agent_id)
        metadata["nested_discovery_task_id"] = str(task.id)
        metadata["nesting_depth"] = nesting_depth
        session.metadata_ = metadata
        task.status = "running"
        task.version += 1
        await db.commit()

        # 启动子任务队列处理
        await discovery_orchestrator.start_task(str(task.id))

        logger.info(
            f"[Session:{session_id_str[:8]}] Nested DiscoveryTask "
            f"{str(task.id)[:8]} created and started"
        )
        return True

    async def _evaluate_termination(
        self,
        session: AgentDialogSession,
        status_marker: Optional[str],
        response_text: str,
        db: AsyncSession,
        lang: str = "zh-Hans",
    ) -> bool:
        """终止判定引擎
        
        按优先级检查终止条件：
        1. Owner 手动终止 (已在其他地方处理)
        2. RESOLVED 标记
        3. DEADLOCK 标记
        4. 轮数上限
        5. 超时 (由定时任务处理)
        6. 标记缺失兜底
        
        Returns:
            bool: True 继续，False 停止
        """
        session_id_str = str(session.id)
        log_prefix = f"[A2A Session:{session_id_str[:8]}]"
        
        # 优先级 2: RESOLVED
        if status_marker == "RESOLVED":
            logger.info(f"{log_prefix} RESOLVED marker detected, completing session")
            await self._complete_session(
                session=session,
                reason=TerminationReason.RESOLVED,
                db=db,
            )
            return False
        
        # 优先级 3: DEADLOCK
        if status_marker == "DEADLOCK":
            metadata = session.metadata_ or {}
            is_programmatic = bool(
                metadata.get("discovery_task_id") or metadata.get("source_conversation_id")
            )
            if is_programmatic:
                logger.info(f"{log_prefix} DEADLOCK in programmatic dialog, completing session")
                await self._complete_session(
                    session=session,
                    reason=TerminationReason.DEADLOCK,
                    db=db,
                )
            else:
                logger.info(f"{log_prefix} DEADLOCK marker detected, pausing session")
                from src.services.prompt_templates import get_reason_string
                await self._pause_session(
                    session=session,
                    reason=get_reason_string("deadlock", lang),
                    db=db,
                    pause_reason=TerminationReason.DEADLOCK,
                )
            return False

        # 优先级 4: 轮数上限
        if session.current_round >= session.max_rounds:
            metadata = session.metadata_ or {}
            is_programmatic = bool(
                metadata.get("discovery_task_id") or metadata.get("source_conversation_id")
            )
            if is_programmatic:
                logger.info(
                    f"{log_prefix} Max rounds in programmatic dialog, completing session"
                )
                await self._complete_session(
                    session=session,
                    reason=TerminationReason.ROUNDS_EXCEEDED,
                    db=db,
                )
            else:
                logger.info(
                    f"{log_prefix} Max rounds reached ({session.current_round}/{session.max_rounds}), "
                    f"pausing session"
                )
                from src.services.prompt_templates import get_reason_string
                await self._pause_session(
                    session=session,
                    reason=get_reason_string("rounds_exceeded", lang),
                    db=db,
                    pause_reason=TerminationReason.ROUNDS_EXCEEDED,
                )
            return False
        
        # 优先级 6: 标记缺失兜底
        if status_marker is None:
            self._missing_marker_count[session_id_str] = (
                self._missing_marker_count.get(session_id_str, 0) + 1
            )
            
            # 首次缺失就触发语义完结检测，连续 2 次缺失触发全面机械检测
            if self._missing_marker_count[session_id_str] >= 1:
                should_stop = await self._mechanical_detection(
                    session=session,
                    response_text=response_text,
                    db=db,
                    lang=lang,
                )
                if should_stop:
                    return False
        else:
            # 有标记，重置计数
            self._missing_marker_count[session_id_str] = 0
        
        # 更新最近消息（用于重复检测）
        if session_id_str not in self._recent_messages:
            self._recent_messages[session_id_str] = []
        self._recent_messages[session_id_str].append(response_text)
        if len(self._recent_messages[session_id_str]) > 4:
            self._recent_messages[session_id_str].pop(0)
        
        return True

    @staticmethod
    def _detect_semantic_completion(text: str) -> bool:
        """检测回复是否在语义上表达了「对话已完结」

        通过组合关键词模式匹配来判断 Agent 是否已经表达出对话结束的意图，
        即使没有输出 <<RESOLVED>> 标记。

        Returns:
            bool: True 表示语义上已完结
        """
        # 完结性动词/短语（必须至少命中一组）
        # Chinese patterns
        zh_completion_signals = [
            # 表达"已充分了解/获取到信息"
            r"已经充分了解",
            r"已经了解了",
            r"已经获得了.*(?:所需|需要的|充分的).*信息",
            r"信息已(?:足够|充分|完整)",
            # 表达感谢+总结性收尾
            r"非常感谢.*(?:提供|分享|回答|解答)",
            r"感谢.*(?:详细|耐心|全面).*(?:回答|回复|解答|分享)",
            # 明确的结束表述
            r"对话(?:可以|到此)?(?:结束|告一段落)",
            r"问题(?:已经)?(?:解决|得到.*解答|得到.*回答)",
            r"(?:没有|不再有).*(?:其他|更多).*(?:问题|疑问)",
            r"(?:暂时|目前).*(?:没有|不需要).*(?:其他|更多|进一步)",
            # Agent 主动收尾
            r"如果.*(?:还有|未来有).*(?:问题|需要).*(?:随时|欢迎)",
            r"(?:祝|希望).*(?:一切顺利|工作顺利|顺利)",
        ]

        # English patterns
        en_completion_signals = [
            # Expressing "have sufficient information"
            r"(?:i|we)\s+(?:have|'ve)\s+(?:all|sufficient|enough)\s+(?:the\s+)?information",
            r"(?:fully|thoroughly)\s+understand",
            r"(?:that|this)\s+(?:answers?|addresses?|resolves?|covers?)\s+(?:all|my|the)\s+(?:questions?|concerns?|queries?)",
            # Thank you + closing summary
            r"thank\s+you\s+(?:for|so\s+much\s+for)\s+(?:the\s+)?(?:detailed|thorough|comprehensive|helpful)",
            r"(?:thanks|thank\s+you)\s+for\s+(?:sharing|providing|explaining|clarifying)",
            # Explicit closing statements
            r"(?:this|the)\s+(?:conversation|discussion|dialog)\s+(?:can\s+)?(?:be\s+)?(?:concluded|wrapped\s+up|ended)",
            r"(?:issue|problem|question)s?\s+(?:has|have)\s+been\s+(?:resolved|addressed|answered|settled)",
            r"(?:no|don't\s+have)\s+(?:further|more|additional|other)\s+(?:questions?|concerns?|issues?)",
            r"(?:nothing|no)\s+(?:else|more)\s+(?:to\s+(?:ask|discuss|add))",
            # Agent closing remarks
            r"(?:if|should)\s+you\s+(?:have|need)\s+(?:any\s+)?(?:further|more|additional).*(?:feel\s+free|don't\s+hesitate)",
            r"(?:wish|hope)\s+(?:you|everything)\s+(?:goes?\s+well|all\s+the\s+best|good\s+luck)",
        ]

        text_lower = text.lower()
        zh_matched = sum(1 for p in zh_completion_signals if re.search(p, text_lower))
        en_matched = sum(1 for p in en_completion_signals if re.search(p, text_lower))
        # 命中 2 个及以上模式视为语义完结（中英文分别计数再合并）
        return (zh_matched + en_matched) >= 2

    async def _mechanical_detection(
        self,
        session: AgentDialogSession,
        response_text: str,
        db: AsyncSession,
        lang: str = "zh-Hans",
    ) -> bool:
        """机械检测（标记缺失兜底）
        
        检测：
        a. 语义完结检测（Agent 的回复在语义上已表达对话结束）
        b. 重复检测（最近 4 条消息相似度 > 0.85）
        c. 消息萎缩（回复长度连续缩短至首轮的 30% 以下）
        
        Returns:
            bool: True 应该停止，False 继续
        """
        session_id_str = str(session.id)
        log_prefix = f"[Session:{session_id_str[:8]}]"
        recent = self._recent_messages.get(session_id_str, [])

        # (a) 语义完结检测
        if self._detect_semantic_completion(response_text):
            logger.info(
                f"{log_prefix} Semantic completion detected (no marker), "
                f"auto-resolving session"
            )
            await self._complete_session(
                session=session,
                reason=TerminationReason.RESOLVED,
                db=db,
            )
            return True
        
        if len(recent) >= 2:
            # (b) 重复检测
            for i, prev_msg in enumerate(recent[:-1]):
                similarity = calculate_text_similarity(prev_msg, response_text)
                if similarity > 0.85:
                    logger.warning(
                        f"{log_prefix} Detected repetitive messages "
                        f"(similarity={similarity:.2f})"
                    )
                    from src.services.prompt_templates import get_reason_string
                    await self._pause_session(
                        session=session,
                        reason=get_reason_string("repeat_detected", lang),
                        db=db,
                        pause_reason=TerminationReason.DEADLOCK,
                    )
                    return True

        if len(recent) >= 3:
            # (c) 消息萎缩检测
            first_len = len(recent[0])
            current_len = len(response_text)
            if first_len > 0 and current_len / first_len < 0.3:
                # 检查是否连续缩短
                if all(len(recent[i]) > len(recent[i+1]) for i in range(len(recent)-1)):
                    logger.warning(
                        f"{log_prefix} Detected message shrinking "
                        f"(first={first_len}, current={current_len})"
                    )
                    from src.services.prompt_templates import get_reason_string
                    await self._pause_session(
                        session=session,
                        reason=get_reason_string("shrinking_response", lang),
                        db=db,
                        pause_reason=TerminationReason.DEADLOCK,
                    )
                    return True
        
        return False

    async def _switch_speaker_and_continue(
        self,
        session: AgentDialogSession,
        current_agent_id: uuid.UUID,
        message_text: str,
        db: AsyncSession,
    ):
        """切换发言者并继续对话（从 current_agent_id 推断，不依赖内存状态）"""
        session_id_str = str(session.id)

        # 从 current_agent_id 直接推断下一个发言者，不依赖 _active_sessions
        if current_agent_id == session.initiator_agent_id:
            # 当前是 initiator 说完了，下一个是 responder
            next_agent = await db.get(Agent, session.responder_agent_id)
            next_agent_owner = await db.get(User, session.responder_owner_id)
            other_owner = await db.get(User, session.initiator_owner_id)
            is_initiator = False
        else:
            # 当前是 responder 说完了，下一个是 initiator
            next_agent = await db.get(Agent, session.initiator_agent_id)
            next_agent_owner = await db.get(User, session.initiator_owner_id)
            other_owner = await db.get(User, session.responder_owner_id)
            is_initiator = True

        # 更新内存缓存（仅作为辅助，不是决策依据）
        ctx = self._active_sessions.get(session_id_str)
        if ctx:
            ctx["current_speaker"] = "initiator" if is_initiator else "responder"

        if not next_agent or not next_agent_owner or not other_owner:
            return

        # 获取下一个发言者的语言偏好
        from src.services.prompt_templates import get_user_lang
        lang = get_user_lang(next_agent_owner)

        # 构建 Prompt
        prompt = await self._build_prompt(
            session=session,
            is_initiator=is_initiator,
            my_owner_name=next_agent_owner.display_name,
            other_owner_name=other_owner.display_name,
            other_agent_message=message_text,
            db=db,
            current_agent=next_agent,
            lang=lang,
        )

        # 发送给下一个 Agent
        await self._send_to_agent(
            session=session,
            agent=next_agent,
            message=prompt,
            db=db,
        )

    async def _build_prompt(
        self,
        session: AgentDialogSession,
        is_initiator: bool,
        my_owner_name: str,
        other_owner_name: str,
        other_agent_message: str,
        db: Optional[AsyncSession] = None,
        current_agent: Optional[Agent] = None,
        lang: str = "zh-Hans",
    ) -> str:
        """构建 Prompt

        当 current_agent + db 非空且目标是 Responder 时，自动注入联系人能力声明，
        使其可以在对话中发起嵌套 A2A 对话。
        """
        from src.services.prompt_templates import get_template

        template_name = "initiator" if is_initiator else "responder"
        template = get_template(template_name, lang)

        base_prompt = template.format(
            my_owner_name=my_owner_name,
            other_owner_name=other_owner_name,
            topic=session.topic,
            current_round=session.current_round + 1,
            max_rounds=session.max_rounds,
            other_agent_message=other_agent_message,
        )

        if not is_initiator and current_agent and db:
            capability = await self._build_responder_capability(
                session, current_agent, other_owner_name, db, lang=lang,
            )
            if capability:
                base_prompt = capability + "\n\n" + base_prompt

        return base_prompt

    async def _build_responder_capability(
        self,
        session: AgentDialogSession,
        agent: Agent,
        initiator_owner_name: str,
        db: AsyncSession,
        lang: str = "zh-Hans",
    ) -> str:
        """为 Responder 构建联系人能力声明（支持嵌套对话）"""
        metadata = session.metadata_ or {}
        nesting_depth = metadata.get("nesting_depth", 0)
        if nesting_depth >= MAX_NESTING_DEPTH:
            return ""

        from src.websocket.handlers import _get_agent_contacts
        from src.services.prompt_templates import build_capability_prompt_i18n

        contacts = await _get_agent_contacts(db, agent)
        contacts = [c for c in contacts if c.get("owner_name") != initiator_owner_name]

        if not contacts:
            return ""

        # 获取 responder 自己的 owner name，用于 capability prompt 的自我认知
        responder_owner = await db.get(User, agent.owner_id)
        my_owner_name = responder_owner.display_name if responder_owner else ""

        return build_capability_prompt_i18n(
            contacts,
            my_owner_name=my_owner_name,
            current_dialog_partner=initiator_owner_name,
            lang=lang,
        )

    async def _complete_session(
        self,
        session: AgentDialogSession,
        reason: TerminationReason,
        db: AsyncSession,
    ):
        """完成会话（带乐观锁保护，防止与 cleanup 任务重复终止）"""
        session_id_str = str(session.id)
        log_prefix = f"[Session:{session_id_str[:8]}]"

        # 乐观锁：原子更新状态，防止 cleanup 同时终止
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
                status=DialogSessionStatus.COMPLETED.value,
                termination_reason=reason.value,
                completed_at=datetime.now(timezone.utc),
                version=session.version + 1,
            )
        )
        if result.rowcount == 0:
            logger.info(f"{log_prefix} Complete skipped: already terminated or version conflict")
            self._cleanup_memory_state(session_id_str)
            return

        # 刷新获取最新状态
        await db.refresh(session)

        # 清理内存状态
        self._cleanup_memory_state(session_id_str)

        # 发送结构化对话状态消息
        await self._send_dialog_status(
            db,
            session.conversation_id,
            action="completed",
            reason=reason.value if hasattr(reason, "value") else str(reason),
            owner_ids=[session.initiator_owner_id, session.responder_owner_id],
        )

        # 立即提交状态变更，防止定时任务读取到旧状态导致二次终止
        await db.commit()

        # commit 后刷新 session 对象，避免属性 expired 导致后续访问失败
        try:
            await db.refresh(session)
        except Exception as e:
            logger.warning(f"{log_prefix} Failed to refresh session after commit: {e}")

        # 通知双方（commit 后安全投递，失败不阻塞）
        try:
            await ws_manager.send_dialog_completed(
                user_ids=[str(session.initiator_owner_id), str(session.responder_owner_id)],
                session_id=str(session.id),
                conversation_id=str(session.conversation_id),
                termination_reason=reason.value,
                final_round=session.current_round,
            )
        except Exception as e:
            logger.warning(f"{log_prefix} Failed to send dialog.completed notification: {e}")

        # 结果回传：检查是否属于发现任务，如果是则由编排器处理
        await self._feedback_dialog_result(session, db)

    async def _feedback_dialog_result(
        self,
        session: AgentDialogSession,
        db: AsyncSession,
    ):
        """将 A2A 对话结果回传给原始会话

        当对话完成后：
        1. 如果属于 DiscoveryTask，由 DiscoveryOrchestrator 处理
        2. 否则直接注入回原始会话（原有行为）
        """
        from src.services.prompt_templates import build_dialog_result_prompt_i18n, get_user_lang
        from src.services.openclaw_service import openclaw_service

        metadata = session.metadata_ or {}
        source_conv_id = metadata.get("source_conversation_id")
        source_user_id = metadata.get("source_user_id")
        discovery_task_id = metadata.get("discovery_task_id")

        logger.debug(
            "[A2A FEEDBACK] Session:%s metadata=%s, source_conv_id=%s, discovery=%s",
            str(session.id)[:8], metadata, source_conv_id, discovery_task_id,
        )

        # 如果属于发现任务，交给编排器处理
        if discovery_task_id:
            try:
                from src.services.discovery_service import discovery_orchestrator
                handled = await discovery_orchestrator.on_dialog_completed(session, db)
                if handled:
                    logger.info(
                        f"[Session:{str(session.id)[:8]}] Feedback handled by DiscoveryOrchestrator"
                    )
                    return
            except Exception as e:
                logger.error(
                    f"[Session:{str(session.id)[:8]}] DiscoveryOrchestrator callback failed: {e}, "
                    f"falling back to direct feedback"
                )

        if not source_conv_id:
            logger.info(
                f"[Session:{str(session.id)[:8]}] No source conversation for feedback"
            )
            return

        try:
            summary = await self._build_dialog_summary(session, db)

            responder_owner = await db.get(User, session.responder_owner_id)
            if not responder_owner:
                return

            initiator_owner = await db.get(User, session.initiator_owner_id)
            lang = get_user_lang(initiator_owner)

            result_prompt = build_dialog_result_prompt_i18n(
                topic=session.topic,
                responder_owner_name=responder_owner.display_name,
                summary=summary,
                lang=lang,
            )

            initiator_agent = await db.get(Agent, session.initiator_agent_id)
            if not initiator_agent:
                return

            result = await db.execute(
                select(ConversationParticipant.participant_id).where(
                    ConversationParticipant.conversation_id == uuid.UUID(source_conv_id)
                )
            )
            participant_ids = [str(row[0]) for row in result.all()]

            print(
                f"[A2A FEEDBACK] Session:{str(session.id)[:8]} Sending dialog result "
                f"to source conversation {source_conv_id[:8]}, "
                f"agent={str(initiator_agent.id)[:8]}, "
                f"participants={[p[:8] for p in participant_ids]}",
                flush=True,
            )

            session_key = f"clawnet:{source_conv_id}"
            effective_user_id = source_user_id or str(session.initiator_owner_id)

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
                idempotency_key=f"dialog-result-{session.id}",
            )

            print(
                f"[A2A FEEDBACK] Session:{str(session.id)[:8]} send_chat dispatched successfully",
                flush=True,
            )

        except Exception as e:
            import traceback
            session_id_str = "unknown"
            try:
                session_id_str = str(session.id)[:8]
            except:
                pass
            error_msg = f"[Session:{session_id_str}] Failed to feedback dialog result: {e}"
            logger.error(error_msg)
            print(f"[A2A FEEDBACK ERROR] {error_msg}", flush=True)
            print(f"[A2A FEEDBACK ERROR] Traceback: {traceback.format_exc()}", flush=True)

    async def _build_dialog_summary(
        self,
        session: AgentDialogSession,
        db: AsyncSession,
    ) -> str:
        """构建对话摘要
        
        提取对话的最后几轮消息作为摘要。
        """
        # 获取对话中的消息（最后 4 条 Agent 消息）
        result = await db.execute(
            select(Message).where(
                Message.conversation_id == session.conversation_id,
                Message.sender_type == "agent",
            ).order_by(Message.timestamp.desc()).limit(4)
        )
        messages = result.scalars().all()
        
        if not messages:
            return "（对话无实质内容）"
        
        # 反转顺序（最早的在前）
        messages = list(reversed(messages))
        
        # 构建摘要
        summary_parts = []
        for msg in messages:
            content = msg.content
            if isinstance(content, dict):
                text = content.get("text", "")
            else:
                text = str(content)
            
            # 移除状态标记
            import re
            text = re.sub(r'<<(RESOLVED|CONTINUE|DEADLOCK)>>', '', text).strip()
            
            if text:
                # 截取前 200 字符
                if len(text) > 200:
                    text = text[:200] + "..."
                summary_parts.append(text)
        
        return "\n\n".join(summary_parts) if summary_parts else "（对话无实质内容）"

    async def _pause_session(
        self,
        session: AgentDialogSession,
        reason: str,
        db: AsyncSession,
        pause_reason: Optional[TerminationReason] = None,
    ):
        """暂停会话（带乐观锁保护）

        Args:
            pause_reason: 暂停原因枚举值，持久化到 termination_reason 字段，
                          后续 cleanup terminate 时不会覆写已有值
        """
        session_id_str = str(session.id)

        # 乐观锁：原子更新状态为 PAUSED，同时记录暂停原因
        update_values: dict = {
            "status": DialogSessionStatus.PAUSED.value,
            "version": session.version + 1,
        }
        if pause_reason:
            update_values["termination_reason"] = pause_reason.value

        result = await db.execute(
            update(AgentDialogSession)
            .where(
                AgentDialogSession.id == session.id,
                AgentDialogSession.version == session.version,
                AgentDialogSession.status.notin_([
                    DialogSessionStatus.COMPLETED.value,
                    DialogSessionStatus.TERMINATED.value,
                    DialogSessionStatus.PAUSED.value,
                ]),
            )
            .values(**update_values)
        )
        if result.rowcount == 0:
            logger.info(
                f"[Session:{session_id_str[:8]}] Pause skipped: "
                f"already paused/terminated or version conflict"
            )
            return

        # 刷新获取最新状态
        await db.refresh(session)

        # 发送结构化对话状态消息
        await self._send_dialog_status(
            db,
            session.conversation_id,
            action="paused",
            reason=reason,
            owner_ids=[session.initiator_owner_id, session.responder_owner_id],
        )

        # 立即提交状态变更，防止定时任务读取到旧状态导致二次终止
        await db.commit()

        # 通知双方（commit 后安全投递）
        try:
            await ws_manager.send_dialog_paused(
                user_ids=[str(session.initiator_owner_id), str(session.responder_owner_id)],
                session_id=str(session.id),
                conversation_id=str(session.conversation_id),
                reason=reason,
                current_round=session.current_round,
                max_rounds=session.max_rounds,
            )
        except Exception as e:
            logger.warning(
                "[Session:%s] Failed to send dialog.paused notification: %s",
                str(session.id)[:8], e,
            )

        # 对于实质性终止的程序化对话，触发结果回传
        # （NESTED_DIALOG 除外，因为那是主动暂停等待子任务完成）
        if pause_reason and pause_reason != TerminationReason.NESTED_DIALOG:
            metadata = session.metadata_ or {}
            has_feedback_target = bool(
                metadata.get("discovery_task_id") or metadata.get("source_conversation_id")
            )
            if has_feedback_target:
                logger.info(
                    f"[Session:{session_id_str[:8]}] Terminal pause ({pause_reason.value}) "
                    f"for programmatic dialog, triggering feedback"
                )
                await self._feedback_dialog_result(session, db)

    async def _handle_agent_offline(
        self,
        session: AgentDialogSession,
        agent: Agent,
        db: AsyncSession,
    ):
        """处理 Agent 离线"""
        from src.services.prompt_templates import get_reason_string, get_user_lang
        initiator_owner = await db.get(User, session.initiator_owner_id)
        lang = get_user_lang(initiator_owner)

        session.status = DialogSessionStatus.PAUSED.value

        # 发送结构化对话状态消息
        await self._send_dialog_status(
            db,
            session.conversation_id,
            action="agent_offline",
            reason="agent_offline",
            params={"agent_name": agent.display_name},
            owner_ids=[session.initiator_owner_id, session.responder_owner_id],
        )
        
        await db.flush()

        # 程序化对话（有 source 或 discovery）离线时，回传反馈给源会话
        metadata = session.metadata_ or {}
        if metadata.get("discovery_task_id") or metadata.get("source_conversation_id"):
            logger.info(
                f"[Session:{str(session.id)[:8]}] Agent offline on programmatic dialog, "
                f"triggering feedback"
            )
            await self._feedback_dialog_result(session, db)

        # 通知双方（flush 后安全投递，caller 负责 commit）
        try:
            await ws_manager.send_dialog_paused(
                user_ids=[str(session.initiator_owner_id), str(session.responder_owner_id)],
                session_id=str(session.id),
                conversation_id=str(session.conversation_id),
                reason=get_reason_string("agent_offline", lang, agent_name=agent.display_name),
                current_round=session.current_round,
                max_rounds=session.max_rounds,
            )
        except Exception as e:
            logger.warning(
                "[Session:%s] Failed to send agent offline notification: %s",
                str(session.id)[:8], e,
            )

    # ── Fallback text builders for structured dialog_status messages ──

    _REASON_FALLBACK = {
        "resolved": "Issue resolved",
        "deadlock": "Request cannot be fulfilled",
        "rounds_exceeded": "Rounds limit exceeded",
        "owner_terminated": "Owner terminated",
        "owner_rejected": "Owner rejected",
        "timeout": "Timeout",
        "idle_timeout": "Idle timeout",
        "approval_timeout": "Approval request timed out",
        "agent_offline": "Agent offline",
        "nested_dialog": "Waiting for nested dialog",
        "nested_completed": "Nested dialog completed",
        "nested_cancelled": "Nested task cancelled",
    }

    def _fallback_text(self, action: str, reason: str | None = None, params: dict | None = None) -> str:
        """Build human-readable English fallback text for structured dialog_status messages."""
        reason_display = self._REASON_FALLBACK.get(reason, reason) if reason else None
        match action:
            case "completed":
                return f"Dialog completed. Reason: {reason_display}" if reason_display else "Dialog completed."
            case "terminated":
                return f"Dialog terminated. Reason: {reason_display}" if reason_display else "Dialog terminated."
            case "paused":
                return f"Dialog paused. Reason: {reason_display}" if reason_display else "Dialog paused."
            case "approval_rejected":
                name = (params or {}).get("rejector_name", "")
                base = f"{name} rejected the dialog request." if name else "Dialog request rejected."
                custom = (params or {}).get("custom_reason")
                return f"{base} Reason: {custom}" if custom else base
            case "agent_offline":
                name = (params or {}).get("agent_name", "Agent")
                return f"{name} went offline. Dialog paused."
            case "resumed":
                return f"Dialog resumed. {reason_display}" if reason_display else "Dialog resumed."
            case _:
                return action

    async def _send_dialog_status(
        self,
        db: AsyncSession,
        conversation_id: uuid.UUID,
        action: str,
        reason: str | None = None,
        params: dict | None = None,
        owner_ids: list[uuid.UUID] | None = None,
    ):
        """Send a structured dialog_status message and broadcast to owners."""
        content: dict = {"action": action}
        if reason:
            content["reason"] = reason
        if params:
            content["params"] = params
        content["text"] = self._fallback_text(action, reason, params)

        msg = Message(
            conversation_id=conversation_id,
            sender_id=uuid.UUID("00000000-0000-0000-0000-000000000000"),  # System
            sender_type="system",
            content_type="dialog_status",
            content=content,
        )
        db.add(msg)
        await db.flush()

        if owner_ids:
            # 递增 human Owner 的未读计数
            result = await db.execute(
                select(ConversationParticipant).where(
                    ConversationParticipant.conversation_id == conversation_id,
                    ConversationParticipant.participant_type == "human",
                    ConversationParticipant.participant_id.in_(owner_ids),
                )
            )
            for p in result.scalars().all():
                p.unread_count = (p.unread_count or 0) + 1

            # 更新会话的最后消息预览
            conv_result = await db.execute(
                select(Conversation).where(Conversation.id == conversation_id)
            )
            conv = conv_result.scalar_one_or_none()
            if conv:
                fallback = content["text"]
                conv.last_message_preview = f"[System] {fallback[:60]}"
                conv.last_message_at = msg.timestamp
                conv.updated_at = msg.timestamp

            await db.flush()

            # 广播给 Owner（失败不阻塞业务）
            str_owner_ids = [str(oid) for oid in owner_ids]
            try:
                await ws_manager.broadcast_message(
                    str_owner_ids,
                    {
                        "type": "message.new",
                        "data": {
                            "id": str(msg.id),
                            "conversation_id": str(conversation_id),
                            "sender": {
                                "id": "00000000-0000-0000-0000-000000000000",
                                "name": "System",
                                "type": "system",
                            },
                            "content_type": "dialog_status",
                            "content": msg.content,
                            "timestamp": msg.timestamp.isoformat(),
                        },
                    },
                )
            except Exception as e:
                logger.warning(
                    "Failed to broadcast dialog_status message to conversation %s: %s",
                    str(conversation_id)[:8], e,
                )

    async def _send_system_message(
        self,
        db: AsyncSession,
        conversation_id: uuid.UUID,
        text: str,
        owner_ids: list[uuid.UUID] | None = None,
    ):
        """发送通用系统消息到会话（non-dialog-status uses only）"""
        msg = Message(
            conversation_id=conversation_id,
            sender_id=uuid.UUID("00000000-0000-0000-0000-000000000000"),  # System
            sender_type="system",
            content_type="system",
            content={"text": text},
        )
        db.add(msg)
        await db.flush()

        if owner_ids:
            result = await db.execute(
                select(ConversationParticipant).where(
                    ConversationParticipant.conversation_id == conversation_id,
                    ConversationParticipant.participant_type == "human",
                    ConversationParticipant.participant_id.in_(owner_ids),
                )
            )
            for p in result.scalars().all():
                p.unread_count = (p.unread_count or 0) + 1

            conv_result = await db.execute(
                select(Conversation).where(Conversation.id == conversation_id)
            )
            conv = conv_result.scalar_one_or_none()
            if conv:
                conv.last_message_preview = f"[System] {text[:60]}"
                conv.last_message_at = msg.timestamp
                conv.updated_at = msg.timestamp

            await db.flush()

            str_owner_ids = [str(oid) for oid in owner_ids]
            try:
                await ws_manager.broadcast_message(
                    str_owner_ids,
                    {
                        "type": "message.new",
                        "data": {
                            "id": str(msg.id),
                            "conversation_id": str(conversation_id),
                            "sender": {
                                "id": "00000000-0000-0000-0000-000000000000",
                                "name": "System",
                                "type": "system",
                            },
                            "content_type": "system",
                            "content": msg.content,
                            "timestamp": msg.timestamp.isoformat(),
                        },
                    },
                )
            except Exception as e:
                logger.warning(
                    "Failed to broadcast system message to conversation %s: %s",
                    str(conversation_id)[:8], e,
                )

    async def _update_card_messages_status(
        self,
        db: AsyncSession,
        conversation_id: uuid.UUID,
        session_id: str,
        new_status: str,
    ):
        """更新数据库中 dialog_request / dialog_approval 卡片消息的 status 字段。
        
        确保历史消息加载时卡片状态也是最新的。
        """
        from sqlalchemy import or_
        result = await db.execute(
            select(Message).where(
                Message.conversation_id == conversation_id,
                or_(
                    Message.content_type == "dialog_request",
                    Message.content_type == "dialog_approval",
                ),
            )
        )
        for msg in result.scalars().all():
            content = msg.content or {}
            if content.get("sessionId") == session_id:
                if msg.content_type == "dialog_request":
                    # dialog_request: pending -> confirmed / cancelled
                    card_status = "confirmed" if new_status == "approved" else "cancelled"
                else:
                    # dialog_approval: pending -> approved / rejected
                    card_status = new_status  # already 'approved' or 'rejected'
                updated_content = {**content, "status": card_status}
                msg.content = updated_content
        await db.flush()

    def _get_reason_display(self, reason: TerminationReason, lang: str = "zh-Hans") -> str:
        """获取终止原因的本地化显示文本"""
        from src.services.prompt_templates import get_termination_display
        return get_termination_display(reason.value if hasattr(reason, "value") else str(reason), lang)

    async def _build_session_response(
        self,
        session: AgentDialogSession,
        db: AsyncSession,
    ) -> DialogSessionResponse:
        """构建会话响应"""
        # 获取关联数据
        initiator_agent = await db.get(Agent, session.initiator_agent_id)
        responder_agent = await db.get(Agent, session.responder_agent_id)
        initiator_owner = await db.get(User, session.initiator_owner_id)
        responder_owner = await db.get(User, session.responder_owner_id)
        
        return DialogSessionResponse(
            id=session.id,
            conversation_id=session.conversation_id,
            initiator_agent=AgentInfo(
                id=initiator_agent.id,
                display_name=initiator_agent.display_name,
                avatar_url=initiator_agent.avatar_url,
                status=initiator_agent.status,
            ),
            responder_agent=AgentInfo(
                id=responder_agent.id,
                display_name=responder_agent.display_name,
                avatar_url=responder_agent.avatar_url,
                status=responder_agent.status,
            ),
            initiator_owner=UserInfo(
                id=initiator_owner.id,
                display_name=initiator_owner.display_name,
                avatar_url=initiator_owner.avatar_url,
            ),
            responder_owner=UserInfo(
                id=responder_owner.id,
                display_name=responder_owner.display_name,
                avatar_url=responder_owner.avatar_url,
            ),
            topic=session.topic,
            initiator_approved=session.initiator_approved,
            responder_approved=session.responder_approved,
            status=session.status,
            current_round=session.current_round,
            max_rounds=session.max_rounds,
            idle_timeout_seconds=session.idle_timeout_seconds,
            termination_reason=session.termination_reason,
            created_at=session.created_at,
            started_at=session.started_at,
            last_message_at=session.last_message_at,
            completed_at=session.completed_at,
        )

    # ============ Human Review / Draft Management ============

    REFINE_SYSTEM_PROMPT = """You are refining a draft response based on the user's feedback.
1. Only adjust the response according to the user's instructions while maintaining coherence with the conversation history.
2. Output the revised response directly without explaining what changes you made."""

    async def request_main_draft(self, session_id: str, user_id: str):
        """Generate a Main Assistant advisory draft for the current A2A round."""
        async with async_session() as db:
            session = await db.get(AgentDialogSession, uuid.UUID(session_id))
            if not session or session.status != DialogSessionStatus.ACTIVE.value:
                raise ValueError("Session not active")

            if str(user_id) not in (str(session.initiator_owner_id), str(session.responder_owner_id)):
                raise PermissionError("Not a session owner")

            from src.services import tag_service
            main_tag = await tag_service.get_main_tag(db, uuid.UUID(user_id))
            if not main_tag:
                raise ValueError("No main agent configured")

            main_agent = await tag_service.find_agent_by_tag_role(db, uuid.UUID(user_id), main_tag.id, "owner")
            if not main_agent:
                raise ValueError("Main agent not found")

            current_round = session.current_round

            # Build conversation history for context
            result = await db.execute(
                select(Message)
                .where(Message.conversation_id == session.conversation_id)
                .order_by(Message.timestamp.asc())
            )
            messages = result.scalars().all()
            history_text = self._format_conversation_history(messages)

            draft_session_key = f"draft:{session_id}:round:{current_round}:main"
            draft = DraftState(
                agent_id=str(main_agent.id),
                gateway_session_key=draft_session_key,
                status="generating",
            )
            self._set_draft(session_id, current_round, "main", draft)

            await self._send_draft_to_agent(
                db=db, session=session, agent=main_agent,
                session_key=draft_session_key, prompt=history_text, tag=main_tag,
                on_response=lambda text: self._handle_main_draft_response(session_id, current_round, user_id, text),
            )

    async def _handle_main_draft_response(self, session_id: str, round_num: int, user_id: str, response_text: str):
        draft = self._get_draft(session_id, round_num, "main")
        if draft:
            draft.draft_text = response_text
            draft.status = "ready"
        await ws_manager.send_to_user(user_id, {
            "type": "dialog.main_draft_ready",
            "data": {"session_id": session_id, "round": round_num, "draft_text": response_text}
        })

    async def refine_draft(self, session_id: str, user_id: str, target: str, instruction: str):
        """Refine an existing draft based on user feedback."""
        async with async_session() as db:
            session = await db.get(AgentDialogSession, uuid.UUID(session_id))
            if not session or session.status != DialogSessionStatus.ACTIVE.value:
                raise ValueError("Session not active")

            current_round = session.current_round
            draft = self._get_draft(session_id, current_round, target)
            if not draft:
                raise ValueError(f"No {target} draft found for current round")

            draft.status = "refining"
            refine_prompt = (
                f"{self.REFINE_SYSTEM_PROMPT}\n\nCurrent draft:\n{draft.draft_text}\n\n"
                f"User's feedback:\n{instruction}"
            )
            draft.refine_history.append({"instruction": instruction, "previous_draft": draft.draft_text})

            agent = await db.get(Agent, uuid.UUID(draft.agent_id))
            if not agent:
                raise ValueError("Draft agent not found")

            from src.services import tag_service
            tag = await tag_service.resolve_tag_for_agent(db, agent)

            await self._send_draft_to_agent(
                db=db, session=session, agent=agent,
                session_key=draft.gateway_session_key, prompt=refine_prompt, tag=tag,
                on_response=lambda text: self._handle_refine_response(session_id, current_round, target, user_id, text),
            )

    async def _handle_refine_response(self, session_id: str, round_num: int, target: str, user_id: str, response_text: str):
        draft = self._get_draft(session_id, round_num, target)
        if draft:
            draft.draft_text = response_text
            draft.status = "ready"
        await ws_manager.send_to_user(user_id, {
            "type": "dialog.draft_updated",
            "data": {"session_id": session_id, "round": round_num, "target": target, "draft_text": response_text}
        })

    async def submit_response(self, session_id: str, user_id: str, text: str):
        """Submit a reviewed/edited response — saves to DB and advances the dialog."""
        async with async_session() as db:
            session = await db.get(AgentDialogSession, uuid.UUID(session_id))
            if not session or session.status != DialogSessionStatus.ACTIVE.value:
                raise ValueError("Session not active")

            if str(user_id) == str(session.initiator_owner_id):
                our_agent_id = session.initiator_agent_id
            elif str(user_id) == str(session.responder_owner_id):
                our_agent_id = session.responder_agent_id
            else:
                raise PermissionError("Not a session owner")

            current_round = session.current_round

            # Idempotency: if no drafts exist for this round, it was already submitted
            tag_draft = self._get_draft(session_id, current_round, "tag")
            main_draft = self._get_draft(session_id, current_round, "main")
            if not tag_draft and not main_draft:
                logger.info(f"[A2A Session:{session_id[:8]}] submit_response ignored: no drafts for round {current_round} (likely duplicate)")
                return

            # Retrieve stashed intent/marker data from the tag draft before clearing
            status_marker = getattr(tag_draft, '_status_marker', None) if tag_draft else None
            nested_intents = getattr(tag_draft, '_nested_intents', []) if tag_draft else []
            lang = getattr(tag_draft, '_lang', 'zh-Hans') if tag_draft else 'zh-Hans'

            self._clear_drafts_for_round(session_id, current_round)

            # Save message to DB
            msg = await save_message(
                db=db,
                conv_id=session.conversation_id,
                sender_id=our_agent_id,
                sender_type="agent",
                req=SendMessageRequest(
                    content_type="text",
                    content={"text": text},
                    metadata={
                        "source": "agent_dialog",
                        "session_id": session_id,
                        "dialog_status": status_marker,
                        "human_reviewed": True,
                    },
                ),
            )

            # Optimistic lock: increment round + version
            now = datetime.now(timezone.utc)
            expected_version = session.version
            result = await db.execute(
                update(AgentDialogSession)
                .where(
                    AgentDialogSession.id == session.id,
                    AgentDialogSession.status == DialogSessionStatus.ACTIVE.value,
                    AgentDialogSession.version == expected_version,
                )
                .values(
                    current_round=current_round + 1,
                    last_message_at=now,
                    version=expected_version + 1,
                )
            )
            if result.rowcount == 0:
                raise ValueError("Concurrent update conflict")

            await db.commit()
            await db.refresh(session)

            # Broadcast message to both owners
            owner_ids = [
                str(session.initiator_owner_id),
                str(session.responder_owner_id),
            ]
            try:
                msg_data = {
                    "id": str(msg.id),
                    "conversation_id": str(msg.conversation_id),
                    "sender": msg.sender.model_dump(mode="json"),
                    "content_type": msg.content_type,
                    "content": msg.content,
                    "timestamp": msg.timestamp.isoformat(),
                    "metadata": msg.metadata,
                }
                await ws_manager.broadcast_message(
                    owner_ids,
                    {"type": "message.new", "data": msg_data},
                )
                await ws_manager.send_dialog_round_complete(
                    user_ids=owner_ids,
                    session_id=str(session.id),
                    conversation_id=str(session.conversation_id),
                    current_round=session.current_round,
                    max_rounds=session.max_rounds,
                    speaker_agent_id=str(our_agent_id),
                    dialog_status=status_marker,
                )
            except Exception as e:
                logger.warning(
                    "[A2A Session:%s] Failed to broadcast submitted response: %s",
                    session_id[:8], e,
                )

            # Handle nested dialog intents (originally from _handle_agent_response)
            if nested_intents:
                handled = await self._handle_nested_dialog_request(
                    session=session,
                    agent_id=our_agent_id,
                    intents=nested_intents,
                    db=db,
                    lang=lang,
                )
                if handled:
                    return

            # Termination evaluation
            should_continue = await self._evaluate_termination(
                session=session,
                status_marker=status_marker,
                response_text=text,
                db=db,
                lang=lang,
            )

            if should_continue:
                logger.info(
                    f"[A2A Session:{session_id[:8]}] Continuing dialog after submit, "
                    f"switching speaker from agent {str(our_agent_id)[:8]}"
                )
                await self._switch_speaker_and_continue(session, our_agent_id, text, db)
            else:
                logger.info(
                    f"[A2A Session:{session_id[:8]}] Dialog terminated/paused after submit, "
                    f"marker={status_marker}, round={session.current_round}/{session.max_rounds}"
                )

    async def _send_draft_to_agent(self, db, session, agent, session_key, prompt, tag, on_response):
        """Send a prompt to an agent for draft generation (review mode).

        Modeled after _send_to_agent but uses a temporary session_key and
        wires on_response as the completion callback.
        """
        conn = agent_connection_manager.get_connection(str(agent.id))
        if not conn:
            config = get_gateway_config(str(agent.owner_id))
            if not config:
                logger.error(f"[Draft] Agent:{str(agent.id)[:8]} No gateway config found")
                return
            conn = await agent_connection_manager.connect_agent(str(agent.id), config)
            if not conn:
                logger.error(f"[Draft] Agent:{str(agent.id)[:8]} Failed to connect")
                return

        # Get participant IDs for the conversation
        result = await db.execute(
            select(ConversationParticipant.participant_id).where(
                ConversationParticipant.conversation_id == session.conversation_id
            )
        )
        participant_ids = [str(row[0]) for row in result.all()]

        idempotency_key = f"draft-{session_key}-{uuid.uuid4()}"

        # Capture on_response for the callback closure
        on_response_capture = on_response

        def on_agent_response(run_id: str, response_text: str, streaming_message_id: str = None):
            asyncio.create_task(on_response_capture(response_text))

        await conn.send_chat(
            conversation_id=str(session.conversation_id),
            user_id=str(agent.owner_id),
            participant_ids=participant_ids,
            agent_id=str(agent.id),
            session_key=session_key,
            message=prompt,
            idempotency_key=idempotency_key,
            dialog_session_id=str(session.id),
            on_complete=on_agent_response,
            timeout_ms=settings.AGENT_DIALOG_RUN_TIMEOUT_SECONDS * 1000,
            tag_id=str(tag.id),
            a2a_mode=False,
        )

    def _format_conversation_history(self, messages: list) -> str:
        """Format ORM Message objects into a text summary for the Main assistant."""
        lines = ["The following is the conversation history of an Agent-to-Agent dialog:\n"]
        for msg in messages:
            # msg is an ORM Message object
            sender_name = str(msg.sender_id)[:8]  # fallback
            content = msg.content or {}
            text = content.get("text", "")
            if text:
                lines.append(f"[{sender_name}]: {text}")
        lines.append("\nBased on the above conversation, please provide your recommended response.")
        return "\n".join(lines)


# 全局调度器实例
agent_dialog_orchestrator = AgentDialogOrchestrator()


# ============ Agent 连接管理辅助函数 ============

async def connect_agent_on_online(agent_id: str, owner_id: str) -> bool:
    """Agent 上线时建立 Gateway 连接
    
    在 agent status 设为 online 时调用。
    """
    config = get_gateway_config(owner_id)
    if not config:
        logger.warning(f"[Agent:{agent_id[:8]}] Owner has no gateway config")
        return False
    
    # 注册 Agent 的 gateway 配置
    register_agent_gateway(agent_id, config)
    
    # 建立连接
    conn = await agent_connection_manager.connect_agent(agent_id, config)
    return conn is not None and conn.connected


async def disconnect_agent_on_offline(agent_id: str) -> None:
    """Agent 下线时断开 Gateway 连接
    
    在 agent status 设为 offline 时调用。
    """
    # 清理进行中的对话会话
    async with async_session() as db:
        result = await db.execute(
            select(AgentDialogSession).where(
                and_(
                    (AgentDialogSession.initiator_agent_id == uuid.UUID(agent_id)) |
                    (AgentDialogSession.responder_agent_id == uuid.UUID(agent_id)),
                    AgentDialogSession.status.in_([
                        DialogSessionStatus.ACTIVE.value,
                        DialogSessionStatus.PENDING_APPROVAL.value,
                    ])
                )
            )
        )
        sessions = result.scalars().all()
        
        for session in sessions:
            agent = await db.get(Agent, uuid.UUID(agent_id))
            if agent:
                await agent_dialog_orchestrator._handle_agent_offline(session, agent, db)
        
        await db.commit()
    
    # 断开连接
    await agent_connection_manager.disconnect_agent(agent_id)
    
    # 注销配置
    unregister_agent_gateway(agent_id)
