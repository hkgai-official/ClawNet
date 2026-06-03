"""Conversation summary generation via DeepSeek API."""

import json
import logging
import os
from pathlib import Path
from typing import Optional

from openai import AsyncOpenAI

logger = logging.getLogger("clawnet.summary")

# Load DeepSeek config from workspace template (single source of truth)
_client: Optional[AsyncOpenAI] = None
_MODEL = "deepseek-chat"

def _init_client() -> Optional[AsyncOpenAI]:
    """Load DeepSeek API config from ws-0-template/config/openclaw.json."""
    global _client
    if _client is not None:
        return _client

    workspaces_root = Path(os.getenv("WORKSPACES_ROOT", "/data/workspaces"))
    config_path = workspaces_root / "ws-0-template" / "config" / "openclaw.json"

    try:
        with open(config_path) as f:
            config = json.load(f)
        deepseek = config["models"]["providers"]["deepseek"]
        base_url = deepseek["baseUrl"]
        api_key = deepseek["apiKey"]
        _client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        logger.info("DeepSeek client initialized from %s", config_path)
        return _client
    except Exception as e:
        logger.warning("Failed to init DeepSeek client: %s", e)
        return None


async def generate_summary(messages: list[str]) -> Optional[str]:
    """Generate a <=10 char Chinese summary from conversation messages.

    Returns None on any failure (LLM error, empty response, etc.).
    """
    client = _init_client()
    if not client:
        return None

    if not messages:
        return None

    conversation_text = "\n".join(
        f"{'用户' if i % 2 == 0 else '助手'}: {m}" for i, m in enumerate(messages)
    )

    try:
        response = await client.chat.completions.create(
            model=_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": (
                        "根据以下对话内容，生成一个不超过20个汉字的简短摘要，"
                        "概括对话核心主题。只输出摘要文本，不要任何解释或标点。\n\n"
                        f"对话内容：\n{conversation_text}"
                    ),
                }
            ],
            max_tokens=30,
            temperature=0.3,
        )
        summary = response.choices[0].message.content.strip()
        # Truncate as safety net
        return summary[:20] if summary else None
    except Exception as e:
        logger.warning("Summary generation failed: %s", e)
        return None


async def generate_and_save_summary(
    conversation_id: str,
    max_messages: int,
    target_version: int,
) -> None:
    """Background task: generate summary and persist to DB.

    Creates its own DB session (request session is closed by task execution time).
    """
    import uuid
    from sqlalchemy import select, update

    from src.database import async_session
    from src.models.conversation import Conversation, ConversationParticipant
    from src.models.message import Message
    from src.websocket.manager import ws_manager

    try:
        async with async_session() as db:
            # Fetch text messages
            result = await db.execute(
                select(Message)
                .where(
                    Message.conversation_id == uuid.UUID(conversation_id),
                    Message.content_type == "text",
                )
                .order_by(Message.timestamp.asc())
                .limit(max_messages)
            )
            msgs = result.scalars().all()
            if not msgs:
                return

            texts = []
            for m in msgs:
                text = m.content.get("text", "") if isinstance(m.content, dict) else ""
                if text:
                    texts.append(text)

            if not texts:
                return

            summary = await generate_summary(texts)
            if not summary:
                return

            # Optimistic lock: only update if version hasn't advanced
            result = await db.execute(
                update(Conversation)
                .where(
                    Conversation.id == uuid.UUID(conversation_id),
                    Conversation.summary_version < target_version,
                )
                .values(summary=summary, summary_version=target_version)
                .returning(Conversation.id)
            )
            updated = result.scalar_one_or_none()
            if not updated:
                return  # Another task already advanced the version

            await db.commit()

            # Notify participants via WebSocket
            p_result = await db.execute(
                select(ConversationParticipant.participant_id).where(
                    ConversationParticipant.conversation_id == uuid.UUID(conversation_id)
                )
            )
            participant_ids = [str(row[0]) for row in p_result.all()]

            await ws_manager.broadcast_message(
                participant_ids,
                {
                    "type": "conversation.updated",
                    "data": {
                        "conversation_id": conversation_id,
                        "summary": summary,
                        "summary_version": target_version,
                    },
                },
            )

            logger.info(
                "Summary v%d generated for conv %s: %s",
                target_version, conversation_id[:8], summary,
            )

    except Exception as e:
        logger.warning("generate_and_save_summary failed: %s", e)
