"""
Intent Detector

检测 Agent 回复中的意图，识别需要与其他 Agent 对话的场景。

触发场景示例：
- "我需要联系张三的助手"
- "帮我问一下李四的 Agent"
- "请你去查询王五那边的信息"
- "让我和小明的数字分身对话"
"""

import re
import logging
from dataclasses import dataclass
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.agent import Agent
from src.models.user import User
from src.models.contact import Contact

logger = logging.getLogger("clawnet.intent_detector")


@dataclass
class AgentDialogIntent:
    """Agent 对话意图"""
    target_user_name: str           # 目标用户名称
    target_user_id: Optional[str]   # 目标用户 ID（如果能匹配到）
    target_agent_id: Optional[str]  # 目标 Agent ID（如果能匹配到）
    topic: str                      # 推断的对话议题
    confidence: float               # 置信度 0-1
    raw_text: str                   # 原始文本


# 意图检测正则模式
INTENT_PATTERNS = [
    # "联系/找/问 XXX 的助手/Agent/数字分身"
    re.compile(
        r'(?:联系|找|问|询问|咨询|请教)\s*(?:一下\s*)?'
        r'[「"\'"]?([^「"\'"\s]{1,20})[」"\'"]?\s*的?\s*'
        r'(?:助手|Agent|agent|数字分身|私人助手|AI助手)',
        re.IGNORECASE
    ),
    # "让我和 XXX 的助手对话"
    re.compile(
        r'(?:让我|帮我|请你?)\s*(?:和|与|跟)\s*'
        r'[「"\'"]?([^「"\'"\s]{1,20})[」"\'"]?\s*的?\s*'
        r'(?:助手|Agent|agent|数字分身|私人助手)?\s*'
        r'(?:对话|聊|沟通|联系|说话)',
        re.IGNORECASE
    ),
    # "去问一下 XXX"（隐式意图）
    re.compile(
        r'(?:去|帮我去)\s*(?:问|查询|了解|确认)\s*(?:一下\s*)?'
        r'[「"\'"]?([^「"\'"\s]{1,20})[」"\'"]?\s*'
        r'(?:那边|那里)?',
        re.IGNORECASE
    ),
    # "XXX 的 Agent/助手 能帮我..."
    re.compile(
        r'[「"\'"]?([^「"\'"\s]{1,20})[」"\'"]?\s*的?\s*'
        r'(?:助手|Agent|agent|数字分身)\s*'
        r'(?:能|可以|是否能)',
        re.IGNORECASE
    ),
]

# 用于提取议题的模式
TOPIC_PATTERNS = [
    re.compile(r'(?:关于|有关|询问|查询|了解)\s*(.{5,50}?)(?:\s*的?\s*(?:信息|情况|事情|问题)|$)'),
    re.compile(r'(?:帮我|请你?)\s*(.{5,50}?)(?:\s*吗?\s*[。？?！!]|$)'),
]


def detect_agent_dialog_intent(text: str) -> Optional[AgentDialogIntent]:
    """检测文本中的 Agent 对话意图
    
    Args:
        text: Agent 的回复文本
        
    Returns:
        AgentDialogIntent 如果检测到意图，否则 None
    """
    for pattern in INTENT_PATTERNS:
        match = pattern.search(text)
        if match:
            target_name = match.group(1).strip()
            
            # 过滤掉常见的非人名词
            if target_name.lower() in {'你', '我', '他', '她', '它', '这个', '那个', 'the', 'a'}:
                continue
            
            # 提取议题
            topic = _extract_topic(text, target_name)
            
            return AgentDialogIntent(
                target_user_name=target_name,
                target_user_id=None,
                target_agent_id=None,
                topic=topic,
                confidence=0.8 if '助手' in text or 'agent' in text.lower() else 0.6,
                raw_text=text,
            )
    
    return None


def _extract_topic(text: str, target_name: str) -> str:
    """从文本中提取对话议题"""
    # 尝试匹配议题模式
    for pattern in TOPIC_PATTERNS:
        match = pattern.search(text)
        if match:
            topic = match.group(1).strip()
            # 移除目标用户名
            topic = topic.replace(target_name, '').strip()
            if len(topic) >= 5:
                return topic
    
    # 如果没有匹配到，使用文本的主要部分
    # 移除常见的开头短语
    cleaned = re.sub(r'^(?:我想|我需要|请你?|帮我|让我)\s*', '', text)
    cleaned = re.sub(r'[。？?！!]+$', '', cleaned)
    
    if len(cleaned) > 50:
        cleaned = cleaned[:50] + '...'
    
    return cleaned or text[:50]


async def resolve_target_agent(
    db: AsyncSession,
    intent: AgentDialogIntent,
    initiator_owner_id: str,
) -> AgentDialogIntent:
    """解析目标用户和 Agent
    
    尝试从联系人列表中匹配目标用户，并找到其 Agent。
    
    Args:
        db: 数据库会话
        intent: 检测到的意图
        initiator_owner_id: 发起方 Owner 的 ID
        
    Returns:
        更新后的 AgentDialogIntent
    """
    import uuid
    
    # 1. 在联系人中搜索匹配的用户（仅限好友）
    from src.models.contact import Contact

    # 查询发起方的好友列表
    friends_result = await db.execute(
        select(Contact.contact_id).where(
            Contact.user_id == uuid.UUID(initiator_owner_id),
            Contact.contact_type == "human",
        )
    )
    friend_ids = [row[0] for row in friends_result.all()]

    target_user = None
    if friend_ids:
        # 精确匹配（仅在好友中搜索）
        result = await db.execute(
            select(User).where(
                User.id.in_(friend_ids),
                User.display_name == intent.target_user_name,
            )
        )
        target_user = result.scalar_one_or_none()

        if not target_user:
            # 模糊匹配（仅在好友中搜索）
            result = await db.execute(
                select(User).where(
                    User.id.in_(friend_ids),
                    User.display_name.ilike(f'%{intent.target_user_name}%'),
                )
            )
            target_user = result.scalar_one_or_none()
    
    if target_user:
        intent.target_user_id = str(target_user.id)
        
        # 2. 查找该用户的 Agent
        result = await db.execute(
            select(Agent).where(
                Agent.owner_id == target_user.id,
                Agent.status == 'online'
            ).order_by(Agent.created_at.desc()).limit(1)
        )
        target_agent = result.scalar_one_or_none()
        
        if target_agent:
            intent.target_agent_id = str(target_agent.id)
            intent.confidence = min(intent.confidence + 0.15, 1.0)
        
        logger.info(
            f"Resolved target: user={target_user.display_name}, "
            f"agent={target_agent.display_name if target_agent else 'None'}"
        )
    else:
        logger.warning(f"Could not resolve target user: {intent.target_user_name}")
        intent.confidence = max(intent.confidence - 0.2, 0.3)
    
    return intent


class AgentResponseIntentAnalyzer:
    """Agent 回复意图分析器
    
    在 Agent 回复后分析是否需要与其他 Agent 对话，
    如果需要则触发确认流程。
    """
    
    def __init__(self):
        self._enabled = True
    
    async def analyze_and_maybe_trigger(
        self,
        db: AsyncSession,
        agent_id: str,
        owner_id: str,
        conversation_id: str,
        response_text: str,
    ) -> Optional[dict]:
        """分析 Agent 回复并可能触发 Agent 对话
        
        Args:
            db: 数据库会话
            agent_id: 当前 Agent ID
            owner_id: Agent Owner ID
            conversation_id: 当前会话 ID
            response_text: Agent 的回复文本
            
        Returns:
            如果检测到意图，返回意图信息供发送确认卡片；否则返回 None
        """
        if not self._enabled:
            return None
        
        # 检测意图
        intent = detect_agent_dialog_intent(response_text)
        if not intent:
            return None
        
        logger.info(
            f"Detected agent dialog intent: target={intent.target_user_name}, "
            f"topic={intent.topic}, confidence={intent.confidence}"
        )
        
        # 置信度过低则不触发
        if intent.confidence < 0.5:
            logger.info(f"Intent confidence too low ({intent.confidence}), skipping")
            return None
        
        # 解析目标 Agent
        intent = await resolve_target_agent(db, intent, owner_id)
        
        # 如果没有找到目标 Agent，不触发
        if not intent.target_agent_id:
            logger.info("Could not resolve target agent, skipping")
            return None
        
        # 获取当前 Agent 信息
        initiator_agent = await db.get(Agent, agent_id)
        if not initiator_agent:
            return None
        
        # 获取目标 Agent 信息
        import uuid
        target_agent = await db.get(Agent, uuid.UUID(intent.target_agent_id))
        target_user = await db.get(User, uuid.UUID(intent.target_user_id)) if intent.target_user_id else None
        
        if not target_agent or not target_user:
            return None
        
        return {
            "type": "dialog_request_detected",
            "intent": {
                "target_user_name": intent.target_user_name,
                "target_user_id": intent.target_user_id,
                "target_agent_id": intent.target_agent_id,
                "topic": intent.topic,
                "confidence": intent.confidence,
            },
            "initiator_agent": {
                "id": str(initiator_agent.id),
                "displayName": initiator_agent.display_name,
                "avatarUrl": initiator_agent.avatar_url,
                "status": initiator_agent.status,
            },
            "target_agent": {
                "id": str(target_agent.id),
                "displayName": target_agent.display_name,
                "avatarUrl": target_agent.avatar_url,
                "status": target_agent.status,
            },
            "target_owner": {
                "id": str(target_user.id),
                "displayName": target_user.display_name,
                "avatarUrl": target_user.avatar_url,
            },
            "conversation_id": conversation_id,
        }


# 全局分析器实例
intent_analyzer = AgentResponseIntentAnalyzer()
