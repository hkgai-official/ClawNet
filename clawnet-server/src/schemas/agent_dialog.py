"""
Agent Dialog Session Schemas

Pydantic 模型用于 Agent 间对话的请求和响应。
"""

import uuid
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

from src.models.agent_dialog_session import DialogSessionStatus, TerminationReason


# ============ 请求模型 ============

class CreateDialogSessionRequest(BaseModel):
    """创建 Agent 对话会话请求"""
    initiator_agent_id: uuid.UUID = Field(..., description="发起方 Agent ID")
    responder_agent_id: Optional[uuid.UUID] = Field(None, description="接收方 Agent ID（未指定时按tag路由）")
    responder_owner_id: Optional[uuid.UUID] = Field(None, description="接收方 Owner ID（用于tag路由）")
    topic: str = Field(..., min_length=1, max_length=1000, description="对话议题")
    max_rounds: int = Field(default=10, ge=1, le=100, description="最大对话轮数")
    idle_timeout_seconds: int = Field(default=86400, ge=60, le=86400, description="空闲超时秒数")
    metadata: Optional[dict] = Field(None, description="元数据（如原始会话信息）")


class ApproveDialogSessionRequest(BaseModel):
    """批准 Agent 对话会话请求"""
    approved: bool = Field(..., description="是否批准")
    reason: Optional[str] = Field(None, max_length=500, description="拒绝原因（如果拒绝）")


class TerminateDialogSessionRequest(BaseModel):
    """终止 Agent 对话会话请求"""
    reason: Optional[str] = Field(None, max_length=500, description="终止原因说明")


class ExtendDialogSessionRequest(BaseModel):
    """延长 Agent 对话会话请求（追加轮数）"""
    additional_rounds: int = Field(..., ge=1, le=50, description="追加轮数")


# ============ 响应模型 ============

class AgentInfo(BaseModel):
    """Agent 简要信息"""
    id: uuid.UUID
    display_name: str
    avatar_url: Optional[str] = None
    status: str


class UserInfo(BaseModel):
    """用户简要信息"""
    id: uuid.UUID
    display_name: str
    avatar_url: Optional[str] = None


class DialogSessionResponse(BaseModel):
    """Agent 对话会话响应"""
    id: uuid.UUID
    conversation_id: uuid.UUID
    
    # 参与方信息
    initiator_agent: AgentInfo
    responder_agent: AgentInfo
    initiator_owner: UserInfo
    responder_owner: UserInfo
    
    # 议题
    topic: str
    
    # 授权状态
    initiator_approved: bool
    responder_approved: bool
    
    # 会话控制
    status: str
    current_round: int
    max_rounds: int
    idle_timeout_seconds: int
    
    # 终止信息
    termination_reason: Optional[str] = None
    
    # 时间戳
    created_at: datetime
    started_at: Optional[datetime] = None
    last_message_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class DialogSessionListResponse(BaseModel):
    """Agent 对话会话列表响应"""
    sessions: list[DialogSessionResponse]
    total: int


# ============ WebSocket 事件模型 ============

class DialogApprovalRequestEvent(BaseModel):
    """对话授权请求事件（发送给 Owner）"""
    type: str = "dialog.approval_request"
    session_id: uuid.UUID
    topic: str
    
    # 发起方信息
    initiator_agent: AgentInfo
    initiator_owner: UserInfo
    
    # 接收方信息（当前用户的 Agent）
    responder_agent: AgentInfo
    
    created_at: datetime


class DialogStatusChangeEvent(BaseModel):
    """对话状态变更事件"""
    type: str = "dialog.status_change"
    session_id: uuid.UUID
    conversation_id: uuid.UUID
    old_status: str
    new_status: str
    reason: Optional[str] = None
    timestamp: datetime


class DialogRoundCompleteEvent(BaseModel):
    """对话轮次完成事件"""
    type: str = "dialog.round_complete"
    session_id: uuid.UUID
    conversation_id: uuid.UUID
    current_round: int
    max_rounds: int
    speaker_agent_id: uuid.UUID
    dialog_status: Optional[str] = None  # RESOLVED / CONTINUE / DEADLOCK
    timestamp: datetime


class DialogTerminatedEvent(BaseModel):
    """对话终止事件"""
    type: str = "dialog.terminated"
    session_id: uuid.UUID
    conversation_id: uuid.UUID
    termination_reason: str
    final_round: int
    timestamp: datetime


# ============ 内部模型 ============

class DialogStatusMarker(BaseModel):
    """对话状态标记（从 Agent 回复中提取）"""
    status: str  # RESOLVED / CONTINUE / DEADLOCK
    raw_marker: str  # 原始标记文本


class DialogPromptContext(BaseModel):
    """对话 Prompt 上下文"""
    session_id: uuid.UUID
    topic: str
    current_round: int
    max_rounds: int
    is_initiator: bool
    other_agent_name: str
    other_owner_name: str
    other_agent_message: str


class RefineRequest(BaseModel):
    """Request to refine a draft response."""
    target: Literal["tag", "main"] = Field(description="Which draft to refine: tag agent or main agent")
    instruction: str = Field(min_length=1, description="Refine instruction from the user")


class SubmitResponseRequest(BaseModel):
    """Request to submit the final reviewed response."""
    text: str = Field(min_length=1, description="Final response text to send")


class DraftResponse(BaseModel):
    """Response containing a draft for review."""
    session_id: str
    round: int
    target: str
    draft_text: str
    status: str
