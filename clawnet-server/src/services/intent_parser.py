"""
Intent Parser

从 Agent 回复中解析 A2A 对话意图标记。

标记格式：
<<NEED_AGENT_DIALOG:target_owner=对方用户名,topic=你需要问的具体问题>>

支持单个或多个标记（多目标发现场景）。
"""

import re
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger("clawnet.intent_parser")

# 意图标记正则
_INTENT_PATTERN = re.compile(
    r'<<NEED_AGENT_DIALOG:target_owner=(.+?),topic=(.+?)>>',
    re.DOTALL
)

# 备用模式：更宽松的匹配
_INTENT_PATTERN_ALT = re.compile(
    r'<<NEED_AGENT_DIALOG\s*:\s*target_owner\s*=\s*["\']?(.+?)["\']?\s*,\s*topic\s*=\s*["\']?(.+?)["\']?\s*>>',
    re.DOTALL | re.IGNORECASE
)


@dataclass
class AgentDialogIntent:
    """Agent 对话意图"""
    target_owner: str       # 目标用户名称
    topic: str              # 要讨论的议题
    raw_marker: str         # 原始标记文本


def extract_dialog_intent(response: str) -> tuple[str, Optional[AgentDialogIntent]]:
    """
    从 Agent 回复中提取单个对话意图（向后兼容）

    Args:
        response: Agent 的原始回复文本

    Returns:
        (cleaned_response, intent_or_none)
        - cleaned_response: 移除标记后的回复文本
        - intent_or_none: 如果有意图则返回 AgentDialogIntent，否则 None
    """
    cleaned, intents = extract_dialog_intents(response)
    if intents:
        return cleaned, intents[0]
    return cleaned, None


def extract_dialog_intents(response: str) -> tuple[str, list[AgentDialogIntent]]:
    """
    从 Agent 回复中提取所有对话意图（支持多标记）

    Args:
        response: Agent 的原始回复文本

    Returns:
        (cleaned_response, intents)
        - cleaned_response: 移除所有标记后的回复文本
        - intents: AgentDialogIntent 列表（可能为空）
    """
    intents: list[AgentDialogIntent] = []
    seen_targets: set[str] = set()

    # 用主模式提取所有匹配
    matches = list(_INTENT_PATTERN.finditer(response))

    # 如果主模式没有匹配到，尝试备用模式
    if not matches:
        matches = list(_INTENT_PATTERN_ALT.finditer(response))

    if not matches:
        return response, []

    for match in matches:
        target_owner = match.group(1).strip()
        topic = match.group(2).strip()
        raw_marker = match.group(0)

        # 验证提取的内容
        if not target_owner or not topic:
            logger.warning(f"Invalid intent marker: {raw_marker}")
            continue

        # 去重：相同 target_owner 只保留第一个（后续合并 topic 可扩展）
        if target_owner in seen_targets:
            logger.info(f"Duplicate target_owner skipped: {target_owner}")
            continue
        seen_targets.add(target_owner)

        intents.append(AgentDialogIntent(
            target_owner=target_owner,
            topic=topic,
            raw_marker=raw_marker,
        ))

    if not intents:
        return response, []

    # 清理回复：移除所有标记
    cleaned = response
    for match in reversed(matches):  # 从后向前替换，避免偏移
        before = cleaned[:match.start()].rstrip()
        after = cleaned[match.end():].lstrip('\n')
        cleaned = before + ('\n' + after if after.strip() else '')
    cleaned = cleaned.rstrip()

    logger.info(
        f"Extracted {len(intents)} dialog intent(s): "
        + ", ".join(f"{i.target_owner}" for i in intents)
    )

    return cleaned, intents


def build_capability_prompt(
    contacts: list[dict],
    my_owner_name: str = "",
    current_dialog_partner: str = "",
) -> str:
    """
    构造能力声明 prompt 片段

    Args:
        contacts: 可联系的 Agent 列表，每个包含:
            - owner_name: 所有者名称
            - agent_name: Agent 名称
            - description: Agent 描述/擅长领域
            - status: Agent 在线状态
        my_owner_name: 当前 Agent 所属用户名称（用于防止自联系）
        current_dialog_partner: 当前正在对话的对方 owner 名称（A2A 场景，防止循环联系）

    Returns:
        能力声明 prompt 文本，如果没有联系人则返回空字符串
    """
    if not contacts:
        return ""

    contact_lines = []
    for c in contacts:
        owner_name = c.get('owner_name', 'Unknown')
        description = c.get('description', '通用助手')
        status = c.get('status', 'unknown')
        status_label = "在线" if status == "online" else "离线"
        contact_lines.append(f"  - {owner_name} 的助手 [{status_label}]")

    identity_line = ""
    if my_owner_name:
        identity_line = (
            f"⚠ 你是用户「{my_owner_name}」的私人助手。你只能联系其他用户的助手，不能联系自己主人的助手。\n"
            f"⚠ 自我认知：「{my_owner_name}」就是你的主人。当对话中提到「{my_owner_name}」时，指的就是你所代表的人，你不需要也不应该去联系「{my_owner_name}」。\n\n"
        )

    dialog_partner_line = ""
    if current_dialog_partner:
        dialog_partner_line = (
            f"⚠⚠⚠ 你当前正在与「{current_dialog_partner}」的助手【直接对话中】。\n"
            f"你不需要也不应该联系「{current_dialog_partner}」——对方助手就是你当前的对话者。\n"
            f"如果需要向「{current_dialog_partner}」了解信息，请直接在当前对话中向对方提问。\n\n"
        )

    return f"""[系统指令 - 跨助手协作能力]

{identity_line}{dialog_partner_line}你可以联系以下用户的助手来获取信息或协调事务：
{chr(10).join(contact_lines)}

【重要】当用户要求你去询问/联系/找某个人时，你必须按照以下步骤操作：
1. 判断用户提到的人名是否匹配上述联系人列表中的某位用户
2. 如果匹配，你需要发起跨助手对话。在你的回复正文中告诉用户「好的，我这就去联系 XX 的助手」
3. 然后在回复的最末尾（新起一行）输出以下标记：
   <<NEED_AGENT_DIALOG:target_owner=对方用户名,topic=你需要问的具体问题>>

【多人联系】如果你需要同时联系多个人，可以一次输出多个标记：
<<NEED_AGENT_DIALOG:target_owner=张三,topic=问题1>>
<<NEED_AGENT_DIALOG:target_owner=李四,topic=问题2>>
系统会帮你依次或并行联系他们，并将结果汇总给你。最多可联系 5 个人。

示例 - 假设用户说「帮我问一下王五最近在忙什么」，且联系人中有王五：
你的回复应该是：
好的，我这就去联系王五的助手，帮你问一下他最近的工作情况。
<<NEED_AGENT_DIALOG:target_owner=王五,topic=请问你的主人最近在忙什么工作？>>

注意事项：
- 标记必须在回复最末尾，单独一行
- target_owner 必须是联系人列表中的用户名（不是助手名）
- topic 是你要问对方助手的具体问题
- 只有用户明确要求联系/询问/找某人时才使用此标记
- 如果目标用户不在联系人列表中，告知用户无法联系

[/系统指令]"""


def build_dialog_result_prompt(
    topic: str,
    responder_owner_name: str,
    summary: str,
    discovery_context: Optional[dict] = None,
) -> str:
    """
    构造对话结果回传 prompt

    当 A2A 对话完成后，将结果注入回发起方 Agent 的原始会话

    Args:
        topic: 原始讨论议题
        responder_owner_name: 对方 Owner 名称
        summary: 对话结果摘要
        discovery_context: 可选的发现任务上下文，包含：
            - contacted_count: 已联系人数
            - max_hops: 最大联系人数
            - original_intent: 原始用户意图
            - pending_count: 待处理查询数
    """
    if discovery_context:
        contacted = discovery_context.get("contacted_count", 1)
        max_hops = discovery_context.get("max_hops", 5)
        original_intent = discovery_context.get("original_intent", "")
        pending = discovery_context.get("pending_count", 0)

        return f"""[DIALOG_RESULT]
你之前就「{topic}」联系了{responder_owner_name}的助手。
对方的回复摘要：{summary}

当前已联系 {contacted}/{max_hops} 人。{'还有 ' + str(pending) + ' 个待处理查询。' if pending else ''}
原始用户意图：{original_intent}

如果你还需要联系其他人获取更多信息，请继续输出标记。
如果信息已经足够，请直接汇总结果回复你的用户。
[/DIALOG_RESULT]"""

    return f"""[DIALOG_RESULT]
你之前就「{topic}」联系了{responder_owner_name}的助手。
对方的回复摘要：{summary}
请将此结果汇总后回复你的用户。
[/DIALOG_RESULT]"""
