"""
Discovery Task Schemas

Pydantic 模型用于多用户发现任务的请求和响应。
"""

import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# ============ 请求模型 ============

class CancelDiscoveryTaskRequest(BaseModel):
    """取消发现任务请求"""
    reason: Optional[str] = Field(None, max_length=500, description="取消原因")


class ConfirmDiscoveryTaskRequest(BaseModel):
    """确认执行发现任务请求（可编辑计划）"""
    # 用户可以编辑 pending_queries（删除不需要的、修改 topic）
    queries: Optional[list[dict]] = Field(
        None,
        description="编辑后的查询列表 [{target_owner, topic}]，为 None 表示全部接受",
    )


# ============ 查询项模型 ============

class DiscoveryQueryItem(BaseModel):
    """发现任务中的单个查询项"""
    target_owner: str
    topic: str
    priority: Optional[int] = 0


class DiscoveryResultItem(BaseModel):
    """发现任务中的单个结果项"""
    target_owner: str
    topic: str
    summary: str
    session_id: Optional[str] = None
    status: str  # completed | failed | timeout


class ActiveSessionItem(BaseModel):
    """发现任务中的活跃会话"""
    session_id: str
    target_owner: str
    topic: str


# ============ 响应模型 ============

class DiscoveryTaskResponse(BaseModel):
    """发现任务响应"""
    id: uuid.UUID
    source_conversation_id: uuid.UUID
    initiator_agent_id: uuid.UUID
    initiator_owner_id: uuid.UUID

    status: str
    original_intent: str

    max_hops: int
    current_hop_count: int
    max_concurrent: int

    pending_queries: list[dict]
    completed_results: list[dict]
    active_sessions: list[dict]

    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class DiscoveryTaskListResponse(BaseModel):
    """发现任务列表响应"""
    tasks: list[DiscoveryTaskResponse]
    total: int


# ============ WebSocket 事件模型 ============

class DiscoveryTaskCreatedEvent(BaseModel):
    """发现任务创建事件"""
    type: str = "discovery.created"
    task_id: uuid.UUID
    source_conversation_id: uuid.UUID
    original_intent: str
    pending_queries: list[dict]
    max_hops: int
    timestamp: datetime


class DiscoveryTaskProgressEvent(BaseModel):
    """发现任务进度更新事件"""
    type: str = "discovery.progress"
    task_id: uuid.UUID
    source_conversation_id: uuid.UUID
    status: str
    current_hop_count: int
    max_hops: int
    pending_queries: list[dict]
    active_sessions: list[dict]
    completed_results: list[dict]
    timestamp: datetime


class DiscoveryTaskCompletedEvent(BaseModel):
    """发现任务完成事件"""
    type: str = "discovery.completed"
    task_id: uuid.UUID
    source_conversation_id: uuid.UUID
    status: str
    completed_results: list[dict]
    total_contacted: int
    timestamp: datetime
