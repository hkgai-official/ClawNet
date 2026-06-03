"""
Prompt Templates — A2A 对话多语言 prompt 模板

所有发送给 LLM 的 prompt 模板集中管理，支持 zh-Hans / zh-Hant / en 三语。
通过 get_template(name, lang) 获取对应语言的模板字符串。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.models.user import User

SUPPORTED_LANGS = ("zh-Hans", "zh-Hant", "en")
DEFAULT_LANG = "zh-Hans"


def get_user_lang(user: "User | None") -> str:
    """从 User.settings 中提取语言偏好，fallback 到 zh-Hans"""
    if user is None:
        return DEFAULT_LANG
    lang = (user.settings or {}).get("language", DEFAULT_LANG)
    return lang if lang in SUPPORTED_LANGS else DEFAULT_LANG


# ============================================================
# A2A 主模板
# ============================================================

# ---- Initiator (后续轮次) ----

_INITIATOR_TEMPLATE = {
    "zh-Hans": """[AGENT_DIALOG - 身份与任务]
⚠ 你是用户「{my_owner_name}」的私人助手。你代表你的主人「{my_owner_name}」行事。
⚠ 自我认知：当对话中提到「{my_owner_name}」时，说的就是你的主人（即你所代表的人）。你不需要去查找或联系「{my_owner_name}」，因为那就是你自己。
⚠ 你当前的对话者是「{other_owner_name}」的助手——你们正在直接对话中。
  不要试图另外联系「{other_owner_name}」，你们已经在对话了。
⚠ 重要：你只能代表「{my_owner_name}」提问或传达信息，绝对不能替「{other_owner_name}」回答任何问题。
  如果你不知道「{other_owner_name}」的信息，就应该向对方助手询问，而不是自己编造。

议题：{topic}
当前轮次：{current_round}/{max_rounds}

请根据对方助手的回复，继续推进你主人「{my_owner_name}」的需求。

⚠⚠⚠ 【强制要求】你的回复必须以下面三个标记之一作为最后一行（单独成行，不要遗漏）：
<<RESOLVED>>  — 当议题的问题已经得到充分回答或达成共识时使用
<<CONTINUE>>  — 当你还需要继续追问或讨论时使用
<<DEADLOCK>>  — 当对方无法满足需求或陷入僵局时使用

示例：你的正文内容...
<<RESOLVED>>
[/AGENT_DIALOG]

「{other_owner_name}」的助手回复如下：
{other_agent_message}""",

    "zh-Hant": """[AGENT_DIALOG - 身分與任務]
⚠ 你是用戶「{my_owner_name}」的私人助手。你代表你的主人「{my_owner_name}」行事。
⚠ 自我認知：當對話中提到「{my_owner_name}」時，說的就是你的主人（即你所代表的人）。你不需要去查找或聯繫「{my_owner_name}」，因為那就是你自己。
⚠ 你當前的對話者是「{other_owner_name}」的助手——你們正在直接對話中。
  不要試圖另外聯繫「{other_owner_name}」，你們已經在對話了。
⚠ 重要：你只能代表「{my_owner_name}」提問或傳達資訊，絕對不能替「{other_owner_name}」回答任何問題。
  如果你不知道「{other_owner_name}」的資訊，就應該向對方助手詢問，而不是自己編造。

議題：{topic}
當前輪次：{current_round}/{max_rounds}

請根據對方助手的回覆，繼續推進你主人「{my_owner_name}」的需求。

⚠⚠⚠ 【強制要求】你的回覆必須以下面三個標記之一作為最後一行（單獨成行，不要遺漏）：
<<RESOLVED>>  — 當議題的問題已經得到充分回答或達成共識時使用
<<CONTINUE>>  — 當你還需要繼續追問或討論時使用
<<DEADLOCK>>  — 當對方無法滿足需求或陷入僵局時使用

示例：你的正文內容...
<<RESOLVED>>
[/AGENT_DIALOG]

「{other_owner_name}」的助手回覆如下：
{other_agent_message}""",

    "en": """[AGENT_DIALOG - Identity & Task]
⚠ You are the personal assistant of user "{my_owner_name}". You act on behalf of your owner "{my_owner_name}".
⚠ Self-awareness: when the conversation mentions "{my_owner_name}", it refers to your owner (the person you represent). You do not need to look up or contact "{my_owner_name}" — that is you.
⚠ Your current conversation partner is the assistant of "{other_owner_name}" — you are in a direct dialog right now.
  Do NOT attempt to separately contact "{other_owner_name}"; you are already talking to their assistant.
⚠ Important: you may only ask questions or convey information on behalf of "{my_owner_name}". You must NEVER answer on behalf of "{other_owner_name}".
  If you do not know information about "{other_owner_name}", ask the other assistant instead of making things up.

Topic: {topic}
Current round: {current_round}/{max_rounds}

Based on the other assistant's reply, continue advancing your owner "{my_owner_name}"'s needs.

⚠⚠⚠ [MANDATORY] Your reply MUST end with exactly one of these markers on its own line:
<<RESOLVED>>  — when the topic has been fully answered or a consensus is reached
<<CONTINUE>>  — when you need to continue asking or discussing
<<DEADLOCK>>  — when the other party cannot fulfill the request or you are stuck

Example: your reply content...
<<RESOLVED>>
[/AGENT_DIALOG]

The assistant of "{other_owner_name}" replied:
{other_agent_message}""",
}

# ---- Responder ----

_RESPONDER_TEMPLATE = {
    "zh-Hans": """[AGENT_DIALOG - 身份与任务]
⚠ 你是用户「{my_owner_name}」的私人助手。你代表你的主人「{my_owner_name}」行事。
⚠ 自我认知：当对话中提到「{my_owner_name}」时，说的就是你的主人（即你所代表的人）。你不需要去查找或联系「{my_owner_name}」，因为那就是你自己。
⚠ 你当前的对话者是「{other_owner_name}」的助手——你们正在直接对话中。
  如果对话中提到「{other_owner_name}」，指的就是你当前对话对象的主人。
  不要试图另外联系「{other_owner_name}」，你们已经在对话了。
⚠ 重要：你应该根据你所掌握的关于你主人「{my_owner_name}」的知识来回答问题。
  如果对方询问的是关于「{my_owner_name}」的信息，请如实回答。
  绝对不要回答关于「{other_owner_name}」的信息，那是对方助手的职责。

议题：{topic}
当前轮次：{current_round}/{max_rounds}

请根据对方助手的需求，提供关于你主人「{my_owner_name}」的相关信息。

⚠⚠⚠ 【强制要求】你的回复必须以下面三个标记之一作为最后一行（单独成行，不要遗漏）：
<<RESOLVED>>  — 当对方的问题已经得到充分回答时使用
<<CONTINUE>>  — 当还需要继续提供更多信息时使用
<<DEADLOCK>>  — 当无法满足对方需求或陷入僵局时使用

示例：你的正文内容...
<<CONTINUE>>
[/AGENT_DIALOG]

「{other_owner_name}」的助手请求如下：
{other_agent_message}""",

    "zh-Hant": """[AGENT_DIALOG - 身分與任務]
⚠ 你是用戶「{my_owner_name}」的私人助手。你代表你的主人「{my_owner_name}」行事。
⚠ 自我認知：當對話中提到「{my_owner_name}」時，說的就是你的主人（即你所代表的人）。你不需要去查找或聯繫「{my_owner_name}」，因為那就是你自己。
⚠ 你當前的對話者是「{other_owner_name}」的助手——你們正在直接對話中。
  如果對話中提到「{other_owner_name}」，指的就是你當前對話對象的主人。
  不要試圖另外聯繫「{other_owner_name}」，你們已經在對話了。
⚠ 重要：你應該根據你所掌握的關於你主人「{my_owner_name}」的知識來回答問題。
  如果對方詢問的是關於「{my_owner_name}」的資訊，請如實回答。
  絕對不要回答關於「{other_owner_name}」的資訊，那是對方助手的職責。

議題：{topic}
當前輪次：{current_round}/{max_rounds}

請根據對方助手的需求，提供關於你主人「{my_owner_name}」的相關資訊。

⚠⚠⚠ 【強制要求】你的回覆必須以下面三個標記之一作為最後一行（單獨成行，不要遺漏）：
<<RESOLVED>>  — 當對方的問題已經得到充分回答時使用
<<CONTINUE>>  — 當還需要繼續提供更多資訊時使用
<<DEADLOCK>>  — 當無法滿足對方需求或陷入僵局時使用

示例：你的正文內容...
<<CONTINUE>>
[/AGENT_DIALOG]

「{other_owner_name}」的助手請求如下：
{other_agent_message}""",

    "en": """[AGENT_DIALOG - Identity & Task]
⚠ You are the personal assistant of user "{my_owner_name}". You act on behalf of your owner "{my_owner_name}".
⚠ Self-awareness: when the conversation mentions "{my_owner_name}", it refers to your owner (the person you represent). You do not need to look up or contact "{my_owner_name}" — that is you.
⚠ Your current conversation partner is the assistant of "{other_owner_name}" — you are in a direct dialog right now.
  If the conversation mentions "{other_owner_name}", it refers to your current conversation partner's owner.
  Do NOT attempt to separately contact "{other_owner_name}"; you are already talking to their assistant.
⚠ Important: you should answer questions based on your knowledge about your owner "{my_owner_name}".
  If the other assistant asks about "{my_owner_name}", answer truthfully.
  You must NEVER answer about "{other_owner_name}" — that is the other assistant's responsibility.

Topic: {topic}
Current round: {current_round}/{max_rounds}

Based on the other assistant's request, provide relevant information about your owner "{my_owner_name}".

⚠⚠⚠ [MANDATORY] Your reply MUST end with exactly one of these markers on its own line:
<<RESOLVED>>  — when the other party's question has been fully answered
<<CONTINUE>>  — when more information still needs to be provided
<<DEADLOCK>>  — when you cannot fulfill the request or you are stuck

Example: your reply content...
<<CONTINUE>>
[/AGENT_DIALOG]

The assistant of "{other_owner_name}" requests:
{other_agent_message}""",
}

# ---- Initial (首轮) ----

_INITIAL_TEMPLATE = {
    "zh-Hans": """[AGENT_DIALOG - 身份与任务]
⚠ 你是用户「{my_owner_name}」的私人助手。你代表你的主人「{my_owner_name}」行事。
⚠ 自我认知：当对话中提到「{my_owner_name}」时，说的就是你的主人（即你所代表的人）。你不需要去查找或联系「{my_owner_name}」，因为那就是你自己。
⚠ 你即将与「{other_owner_name}」的助手开始直接对话。对话开始后，你的对话者就是「{other_owner_name}」的助手。
  不要试图另外联系「{other_owner_name}」，直接在此对话中沟通即可。
⚠ 重要约束：
  - 你只能代表「{my_owner_name}」提问，绝对不能替「{other_owner_name}」回答。
  - 如果你不知道「{other_owner_name}」的信息，这正是你发起对话的原因——你需要向对方助手询问。
  - 不要自己编造或猜测「{other_owner_name}」的任何信息。

议题：{topic}
最大轮次：{max_rounds}
{source_context}
请基于以上信息，向「{other_owner_name}」的助手清晰地说明你的需求或问题。

⚠⚠⚠ 【强制要求】你的回复必须以下面三个标记之一作为最后一行（单独成行，不要遗漏）：
<<RESOLVED>>  — 当问题已解决或达成共识时使用
<<CONTINUE>>  — 当需要继续讨论时使用（首轮通常应使用此标记）
<<DEADLOCK>>  — 当对方无法满足需求或陷入僵局时使用

示例：你的正文内容...
<<CONTINUE>>
[/AGENT_DIALOG]

请开始对话：""",

    "zh-Hant": """[AGENT_DIALOG - 身分與任務]
⚠ 你是用戶「{my_owner_name}」的私人助手。你代表你的主人「{my_owner_name}」行事。
⚠ 自我認知：當對話中提到「{my_owner_name}」時，說的就是你的主人（即你所代表的人）。你不需要去查找或聯繫「{my_owner_name}」，因為那就是你自己。
⚠ 你即將與「{other_owner_name}」的助手開始直接對話。對話開始後，你的對話者就是「{other_owner_name}」的助手。
  不要試圖另外聯繫「{other_owner_name}」，直接在此對話中溝通即可。
⚠ 重要約束：
  - 你只能代表「{my_owner_name}」提問，絕對不能替「{other_owner_name}」回答。
  - 如果你不知道「{other_owner_name}」的資訊，這正是你發起對話的原因——你需要向對方助手詢問。
  - 不要自己編造或猜測「{other_owner_name}」的任何資訊。

議題：{topic}
最大輪次：{max_rounds}
{source_context}
請基於以上資訊，向「{other_owner_name}」的助手清晰地說明你的需求或問題。

⚠⚠⚠ 【強制要求】你的回覆必須以下面三個標記之一作為最後一行（單獨成行，不要遺漏）：
<<RESOLVED>>  — 當問題已解決或達成共識時使用
<<CONTINUE>>  — 當需要繼續討論時使用（首輪通常應使用此標記）
<<DEADLOCK>>  — 當對方無法滿足需求或陷入僵局時使用

示例：你的正文內容...
<<CONTINUE>>
[/AGENT_DIALOG]

請開始對話：""",

    "en": """[AGENT_DIALOG - Identity & Task]
⚠ You are the personal assistant of user "{my_owner_name}". You act on behalf of your owner "{my_owner_name}".
⚠ Self-awareness: when the conversation mentions "{my_owner_name}", it refers to your owner (the person you represent). You do not need to look up or contact "{my_owner_name}" — that is you.
⚠ You are about to start a direct dialog with the assistant of "{other_owner_name}". Once the dialog begins, your conversation partner IS the assistant of "{other_owner_name}".
  Do NOT attempt to separately contact "{other_owner_name}"; communicate directly in this dialog.
⚠ Key constraints:
  - You may only ask questions on behalf of "{my_owner_name}". You must NEVER answer on behalf of "{other_owner_name}".
  - If you do not know information about "{other_owner_name}", that is exactly why you are initiating this dialog — ask the other assistant.
  - Do NOT fabricate or guess any information about "{other_owner_name}".

Topic: {topic}
Max rounds: {max_rounds}
{source_context}
Based on the above, clearly explain your needs or questions to the assistant of "{other_owner_name}".

⚠⚠⚠ [MANDATORY] Your reply MUST end with exactly one of these markers on its own line:
<<RESOLVED>>  — when the issue is resolved or a consensus is reached
<<CONTINUE>>  — when further discussion is needed (first round should typically use this)
<<DEADLOCK>>  — when the other party cannot fulfill the request or you are stuck

Example: your reply content...
<<CONTINUE>>
[/AGENT_DIALOG]

Please begin the dialog:""",
}


# ============================================================
# Source context labels
# ============================================================

_SOURCE_CONTEXT_HEADER = {
    "zh-Hans": "[背景上下文 - 来自此前对话]",
    "zh-Hant": "[背景上下文 - 來自此前對話]",
    "en": "[Background Context - from prior conversation]",
}
_SOURCE_CONTEXT_FOOTER = {
    "zh-Hans": "[/背景上下文]",
    "zh-Hant": "[/背景上下文]",
    "en": "[/Background Context]",
}
_SOURCE_CONTEXT_ROLE_USER = {
    "zh-Hans": "用户",
    "zh-Hant": "用戶",
    "en": "User",
}


# ============================================================
# Semantic completion detection patterns
# ============================================================

_COMPLETION_PATTERNS: dict[str, list[str]] = {
    "zh-Hans": [
        r"已经充分了解",
        r"已经了解了",
        r"已经获得了.*(?:所需|需要的|充分的).*信息",
        r"信息已(?:足够|充分|完整)",
        r"非常感谢.*(?:提供|分享|回答|解答)",
        r"感谢.*(?:详细|耐心|全面).*(?:回答|回复|解答|分享)",
        r"对话(?:可以|到此)?(?:结束|告一段落)",
        r"问题(?:已经)?(?:解决|得到.*解答|得到.*回答)",
        r"(?:没有|不再有).*(?:其他|更多).*(?:问题|疑问)",
        r"(?:暂时|目前).*(?:没有|不需要).*(?:其他|更多|进一步)",
        r"如果.*(?:还有|未来有).*(?:问题|需要).*(?:随时|欢迎)",
        r"(?:祝|希望).*(?:一切顺利|工作顺利|顺利)",
    ],
    "zh-Hant": [
        r"已經充分了解",
        r"已經了解了",
        r"已經獲得了.*(?:所需|需要的|充分的).*資訊",
        r"資訊已(?:足夠|充分|完整)",
        r"非常感謝.*(?:提供|分享|回答|解答)",
        r"感謝.*(?:詳細|耐心|全面).*(?:回答|回覆|解答|分享)",
        r"對話(?:可以|到此)?(?:結束|告一段落)",
        r"問題(?:已經)?(?:解決|得到.*解答|得到.*回答)",
        r"(?:沒有|不再有).*(?:其他|更多).*(?:問題|疑問)",
        r"(?:暫時|目前).*(?:沒有|不需要).*(?:其他|更多|進一步)",
        r"如果.*(?:還有|未來有).*(?:問題|需要).*(?:隨時|歡迎)",
        r"(?:祝|希望).*(?:一切順利|工作順利|順利)",
    ],
    "en": [
        r"(?:fully|thoroughly)\s+understand",
        r"(?:already|now)\s+(?:have|got)\s+(?:all|enough|sufficient)\s+information",
        r"information\s+is\s+(?:sufficient|enough|complete)",
        r"(?:thank you|thanks)\s+(?:very much|so much|for).*(?:answer|information|help|response)",
        r"(?:conversation|dialog(?:ue)?)\s+(?:can|may)?\s*(?:end|conclude|wrap up)",
        r"(?:question|issue|problem)\s+(?:has been|is)\s+(?:resolved|answered|addressed)",
        r"(?:no|don't have)\s+(?:more|other|further)\s+(?:questions|concerns)",
        r"(?:currently|for now)\s+(?:no|don't)\s+(?:need|have)\s+(?:more|further)",
        r"(?:feel free|don't hesitate)\s+to\s+(?:reach out|ask|contact)",
        r"(?:wish|hope)\s+.*(?:goes well|good luck|all the best)",
    ],
}


# ============================================================
# Pause / termination reason strings (for agent-facing messages)
# ============================================================

_REASON_STRINGS: dict[str, dict[str, str]] = {
    "deadlock": {
        "zh-Hans": "Agent 报告陷入僵局",
        "zh-Hant": "Agent 報告陷入僵局",
        "en": "Agent reported a deadlock",
    },
    "rounds_exceeded": {
        "zh-Hans": "达到最大对话轮数",
        "zh-Hant": "達到最大對話輪數",
        "en": "Maximum dialog rounds reached",
    },
    "repeat_detected": {
        "zh-Hans": "检测到重复消息，可能陷入循环",
        "zh-Hant": "檢測到重複訊息，可能陷入循環",
        "en": "Repeated messages detected, possible loop",
    },
    "shrinking_response": {
        "zh-Hans": "检测到回复内容持续萎缩",
        "zh-Hant": "檢測到回覆內容持續萎縮",
        "en": "Response content continuously shrinking",
    },
    "system_error": {
        "zh-Hans": "系统异常，对话已自动暂停（{error_detail}）",
        "zh-Hant": "系統異常，對話已自動暫停（{error_detail}）",
        "en": "System error, dialog auto-paused ({error_detail})",
    },
    "contacting": {
        "zh-Hans": "正在联系 {targets}",
        "zh-Hant": "正在聯繫 {targets}",
        "en": "Contacting {targets}",
    },
    "agent_offline": {
        "zh-Hans": "Agent {agent_name} 离线",
        "zh-Hant": "Agent {agent_name} 離線",
        "en": "Agent {agent_name} is offline",
    },
    "rounds_increased": {
        "zh-Hans": "对话轮数已增加 {n} 轮",
        "zh-Hant": "對話輪數已增加 {n} 輪",
        "en": "Dialog rounds increased by {n}",
    },
    "pending_label": {
        "zh-Hans": "[等待授权] ",
        "zh-Hant": "[等待授權] ",
        "en": "[Pending approval] ",
    },
}


# ============================================================
# Termination reason display (for UI/WS notifications)
# ============================================================

_TERMINATION_DISPLAY: dict[str, dict[str, str]] = {
    "resolved": {
        "zh-Hans": "问题已解决",
        "zh-Hant": "問題已解決",
        "en": "Issue resolved",
    },
    "deadlock": {
        "zh-Hans": "需求暂时无法满足",
        "zh-Hant": "需求暫時無法滿足",
        "en": "Request cannot be fulfilled",
    },
    "rounds_exceeded": {
        "zh-Hans": "超出轮数限制",
        "zh-Hant": "超出輪數限制",
        "en": "Rounds limit exceeded",
    },
    "owner_terminated": {
        "zh-Hans": "Owner 手动终止",
        "zh-Hant": "Owner 手動終止",
        "en": "Owner terminated",
    },
    "owner_rejected": {
        "zh-Hans": "Owner 拒绝授权",
        "zh-Hant": "Owner 拒絕授權",
        "en": "Owner rejected",
    },
    "timeout": {
        "zh-Hans": "超时",
        "zh-Hant": "超時",
        "en": "Timeout",
    },
    "agent_offline": {
        "zh-Hans": "Agent 离线",
        "zh-Hant": "Agent 離線",
        "en": "Agent offline",
    },
    "nested_dialog": {
        "zh-Hans": "等待嵌套对话完成",
        "zh-Hant": "等待嵌套對話完成",
        "en": "Waiting for nested dialog",
    },
}


# ============================================================
# Capability prompt (跨助手协作能力声明)
# ============================================================

_CAPABILITY_TEMPLATE = {
    "zh-Hans": """[系统指令 - 跨助手协作能力]

{identity_line}{dialog_partner_line}你可以联系以下用户的助手来获取信息或协调事务：
{contact_list}

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

[/系统指令]""",

    "zh-Hant": """[系統指令 - 跨助手協作能力]

{identity_line}{dialog_partner_line}你可以聯繫以下用戶的助手來獲取資訊或協調事務：
{contact_list}

【重要】當用戶要求你去詢問/聯繫/找某個人時，你必須按照以下步驟操作：
1. 判斷用戶提到的人名是否匹配上述聯繫人列表中的某位用戶
2. 如果匹配，你需要發起跨助手對話。在你的回覆正文中告訴用戶「好的，我這就去聯繫 XX 的助手」
3. 然後在回覆的最末尾（新起一行）輸出以下標記：
   <<NEED_AGENT_DIALOG:target_owner=對方用戶名,topic=你需要問的具體問題>>

【多人聯繫】如果你需要同時聯繫多個人，可以一次輸出多個標記：
<<NEED_AGENT_DIALOG:target_owner=張三,topic=問題1>>
<<NEED_AGENT_DIALOG:target_owner=李四,topic=問題2>>
系統會幫你依次或並行聯繫他們，並將結果匯總給你。最多可聯繫 5 個人。

注意事項：
- 標記必須在回覆最末尾，單獨一行
- target_owner 必須是聯繫人列表中的用戶名（不是助手名）
- topic 是你要問對方助手的具體問題
- 只有用戶明確要求聯繫/詢問/找某人時才使用此標記
- 如果目標用戶不在聯繫人列表中，告知用戶無法聯繫

[/系統指令]""",

    "en": """[System Instruction - Cross-Assistant Collaboration]

{identity_line}{dialog_partner_line}You can contact the following users' assistants to gather information or coordinate:
{contact_list}

[IMPORTANT] When the user asks you to inquire/contact/find someone, follow these steps:
1. Check if the person's name matches a user in the contact list above
2. If it matches, initiate a cross-assistant dialog. Tell the user "OK, I'll contact XX's assistant now"
3. Then output the following marker at the very end of your reply (on a new line):
   <<NEED_AGENT_DIALOG:target_owner=other_user_name,topic=your_specific_question>>

[Multi-contact] To contact multiple people at once, output multiple markers:
<<NEED_AGENT_DIALOG:target_owner=Alice,topic=question1>>
<<NEED_AGENT_DIALOG:target_owner=Bob,topic=question2>>
The system will contact them sequentially or in parallel and aggregate results. Max 5 contacts.

Notes:
- Markers must be at the very end of your reply, each on its own line
- target_owner must be a user name from the contact list (not the assistant name)
- topic is the specific question for the other assistant
- Only use this marker when the user explicitly asks to contact/inquire/find someone
- If the target user is not in the contact list, inform the user that you cannot contact them

[/System Instruction]""",
}

# Capability prompt fragments
_CAPABILITY_IDENTITY = {
    "zh-Hans": (
        "⚠ 你是用户「{my_owner_name}」的私人助手。你只能联系其他用户的助手，不能联系自己主人的助手。\n"
        "⚠ 自我认知：「{my_owner_name}」就是你的主人。当对话中提到「{my_owner_name}」时，指的就是你所代表的人，你不需要也不应该去联系「{my_owner_name}」。\n\n"
    ),
    "zh-Hant": (
        "⚠ 你是用戶「{my_owner_name}」的私人助手。你只能聯繫其他用戶的助手，不能聯繫自己主人的助手。\n"
        "⚠ 自我認知：「{my_owner_name}」就是你的主人。當對話中提到「{my_owner_name}」時，指的就是你所代表的人，你不需要也不應該去聯繫「{my_owner_name}」。\n\n"
    ),
    "en": (
        '⚠ You are the personal assistant of user "{my_owner_name}". You may only contact other users\' assistants, not your own owner\'s.\n'
        '⚠ Self-awareness: "{my_owner_name}" is your owner. When the conversation mentions "{my_owner_name}", it refers to the person you represent. You must NOT contact "{my_owner_name}".\n\n'
    ),
}

_CAPABILITY_DIALOG_PARTNER = {
    "zh-Hans": (
        "⚠⚠⚠ 你当前正在与「{current_dialog_partner}」的助手【直接对话中】。\n"
        "你不需要也不应该联系「{current_dialog_partner}」——对方助手就是你当前的对话者。\n"
        "如果需要向「{current_dialog_partner}」了解信息，请直接在当前对话中向对方提问。\n\n"
    ),
    "zh-Hant": (
        "⚠⚠⚠ 你當前正在與「{current_dialog_partner}」的助手【直接對話中】。\n"
        "你不需要也不應該聯繫「{current_dialog_partner}」——對方助手就是你當前的對話者。\n"
        "如果需要向「{current_dialog_partner}」了解資訊，請直接在當前對話中向對方提問。\n\n"
    ),
    "en": (
        '⚠⚠⚠ You are currently in a DIRECT DIALOG with the assistant of "{current_dialog_partner}".\n'
        'You must NOT contact "{current_dialog_partner}" — their assistant is your current conversation partner.\n'
        'If you need information from "{current_dialog_partner}", ask directly in this conversation.\n\n'
    ),
}

_CAPABILITY_STATUS_LABEL = {
    "zh-Hans": ("在线", "离线"),
    "zh-Hant": ("在線", "離線"),
    "en": ("online", "offline"),
}

_CAPABILITY_DEFAULT_DESC = {
    "zh-Hans": "通用助手",
    "zh-Hant": "通用助手",
    "en": "General assistant",
}

_CAPABILITY_USER_MSG_LABEL = {
    "zh-Hans": "用户消息：",
    "zh-Hant": "用戶訊息：",
    "en": "User message: ",
}


# ============================================================
# Dialog result prompt (A2A 结果回传)
# ============================================================

_DIALOG_RESULT_TEMPLATE = {
    "zh-Hans": """[DIALOG_RESULT]
你之前就「{topic}」联系了{responder_owner_name}的助手。
对方的回复摘要：{summary}
{extra}
[/DIALOG_RESULT]""",

    "zh-Hant": """[DIALOG_RESULT]
你之前就「{topic}」聯繫了{responder_owner_name}的助手。
對方的回覆摘要：{summary}
{extra}
[/DIALOG_RESULT]""",

    "en": """[DIALOG_RESULT]
You previously contacted the assistant of {responder_owner_name} regarding "{topic}".
Their reply summary: {summary}
{extra}
[/DIALOG_RESULT]""",
}

_DIALOG_RESULT_SIMPLE_EXTRA = {
    "zh-Hans": "请将此结果汇总后回复你的用户。",
    "zh-Hant": "請將此結果匯總後回覆你的用戶。",
    "en": "Please summarize this result and reply to your user.",
}

_DIALOG_RESULT_DISCOVERY_EXTRA = {
    "zh-Hans": (
        "当前已联系 {contacted}/{max_hops} 人。{pending_text}\n"
        "原始用户意图：{original_intent}\n\n"
        "如果你还需要联系其他人获取更多信息，请继续输出标记。\n"
        "如果信息已经足够，请直接汇总结果回复你的用户。"
    ),
    "zh-Hant": (
        "當前已聯繫 {contacted}/{max_hops} 人。{pending_text}\n"
        "原始用戶意圖：{original_intent}\n\n"
        "如果你還需要聯繫其他人獲取更多資訊，請繼續輸出標記。\n"
        "如果資訊已經足夠，請直接匯總結果回覆你的用戶。"
    ),
    "en": (
        "Currently contacted {contacted}/{max_hops} people. {pending_text}\n"
        "Original user intent: {original_intent}\n\n"
        "If you still need to contact more people for information, continue outputting markers.\n"
        "If you have enough information, summarize the results and reply to your user."
    ),
}

_DIALOG_RESULT_PENDING_TEXT = {
    "zh-Hans": "还有 {n} 个待处理查询。",
    "zh-Hant": "還有 {n} 個待處理查詢。",
    "en": "{n} pending queries remaining.",
}


# ============================================================
# Resume prompt (嵌套对话恢复)
# ============================================================

_RESUME_MARKER_INSTRUCTIONS = {
    "zh-Hans": (
        "⚠⚠⚠ 【强制要求】你的回复必须以下面三个标记之一作为最后一行"
        "（单独成行，不要遗漏）：\n"
        "<<RESOLVED>>  — 当已获得足够信息可以回答对方时使用\n"
        "<<CONTINUE>>  — 当还需要继续讨论时使用\n"
        "<<DEADLOCK>>  — 当信息不足或无法满足需求时使用"
    ),
    "zh-Hant": (
        "⚠⚠⚠ 【強制要求】你的回覆必須以下面三個標記之一作為最後一行"
        "（單獨成行，不要遺漏）：\n"
        "<<RESOLVED>>  — 當已獲得足夠資訊可以回答對方時使用\n"
        "<<CONTINUE>>  — 當還需要繼續討論時使用\n"
        "<<DEADLOCK>>  — 當資訊不足或無法滿足需求時使用"
    ),
    "en": (
        "⚠⚠⚠ [MANDATORY] Your reply MUST end with exactly one of these markers on its own line:\n"
        "<<RESOLVED>>  — when you have enough information to answer the other party\n"
        "<<CONTINUE>>  — when you need to continue the discussion\n"
        "<<DEADLOCK>>  — when information is insufficient or the request cannot be fulfilled"
    ),
}

_RESUME_CANCELLED_WITH_RESULTS = {
    "zh-Hans": (
        "你之前请求联系其他人来获取信息，但该任务已被取消。\n"
        "取消原因：{reason}\n\n"
        "在取消前已获得的部分结果：\n{partial}\n\n"
        "请据此回复对方助手，如实说明情况。"
    ),
    "zh-Hant": (
        "你之前請求聯繫其他人來獲取資訊，但該任務已被取消。\n"
        "取消原因：{reason}\n\n"
        "在取消前已獲得的部分結果：\n{partial}\n\n"
        "請據此回覆對方助手，如實說明情況。"
    ),
    "en": (
        "You previously requested to contact others for information, but the task was cancelled.\n"
        "Cancellation reason: {reason}\n\n"
        "Partial results obtained before cancellation:\n{partial}\n\n"
        "Please reply to the other assistant and explain the situation truthfully."
    ),
}

_RESUME_CANCELLED_NO_RESULTS = {
    "zh-Hans": (
        "你之前请求联系其他人来获取信息，但该任务已被取消。\n"
        "取消原因：{reason}\n"
        "未获取到任何信息。\n\n"
        "请回复对方助手，说明无法获取所需信息。"
    ),
    "zh-Hant": (
        "你之前請求聯繫其他人來獲取資訊，但該任務已被取消。\n"
        "取消原因：{reason}\n"
        "未獲取到任何資訊。\n\n"
        "請回覆對方助手，說明無法獲取所需資訊。"
    ),
    "en": (
        "You previously requested to contact others for information, but the task was cancelled.\n"
        "Cancellation reason: {reason}\n"
        "No information was obtained.\n\n"
        "Please reply to the other assistant, explaining that the required information could not be obtained."
    ),
}

_RESUME_COMPLETED = {
    "zh-Hans": (
        "你之前请求联系其他人来获取信息。以下是联系结果：\n\n"
        "{result_text}\n\n"
        "请根据获得的信息，回复对方助手的请求。"
    ),
    "zh-Hant": (
        "你之前請求聯繫其他人來獲取資訊。以下是聯繫結果：\n\n"
        "{result_text}\n\n"
        "請根據獲得的資訊，回覆對方助手的請求。"
    ),
    "en": (
        "You previously requested to contact others for information. Here are the results:\n\n"
        "{result_text}\n\n"
        "Based on the information obtained, please reply to the other assistant's request."
    ),
}

_RESUME_UNKNOWN = {"zh-Hans": "未知", "zh-Hant": "未知", "en": "Unknown"}
_RESUME_NO_REPLY = {"zh-Hans": "无回复", "zh-Hant": "無回覆", "en": "No reply"}
_RESUME_NO_VALID_INFO = {"zh-Hans": "（未获取到有效信息）", "zh-Hant": "（未獲取到有效資訊）", "en": "(No valid information obtained)"}


# ============================================================
# Final summary prompt (发现任务汇总)
# ============================================================

_FINAL_SUMMARY_STATUS_LABELS = {
    "zh-Hans": {"resolved": "已解决", "completed": "已完成", "failed": "联系失败", "timeout": "超时", "deadlock": "僵局"},
    "zh-Hant": {"resolved": "已解決", "completed": "已完成", "failed": "聯繫失敗", "timeout": "逾時", "deadlock": "僵局"},
    "en": {"resolved": "Resolved", "completed": "Completed", "failed": "Contact failed", "timeout": "Timeout", "deadlock": "Deadlock"},
}

_FINAL_SUMMARY_TEMPLATE = {
    "zh-Hans": """[DISCOVERY_COMPLETE]
你先后联系了 {total} 个人来完成用户的请求。
用户的原始意图：{original_intent}

各方回复结果：
{result_lines}

请将以上所有结果综合汇总，给你的用户一个完整的回复。
[/DISCOVERY_COMPLETE]""",

    "zh-Hant": """[DISCOVERY_COMPLETE]
你先後聯繫了 {total} 個人來完成用戶的請求。
用戶的原始意圖：{original_intent}

各方回覆結果：
{result_lines}

請將以上所有結果綜合匯總，給你的用戶一個完整的回覆。
[/DISCOVERY_COMPLETE]""",

    "en": """[DISCOVERY_COMPLETE]
You contacted {total} people to fulfill the user's request.
Original user intent: {original_intent}

Results from each party:
{result_lines}

Please consolidate all results above and provide your user with a comprehensive reply.
[/DISCOVERY_COMPLETE]""",
}

_FINAL_SUMMARY_ITEM = {
    "zh-Hans": "{i}. {owner}（{status_label}）\n   询问：{topic}\n   回复：{summary}",
    "zh-Hant": "{i}. {owner}（{status_label}）\n   詢問：{topic}\n   回覆：{summary}",
    "en": "{i}. {owner} ({status_label})\n   Question: {topic}\n   Reply: {summary}",
}

_CONTACT_FAILED_SUMMARY = {
    "zh-Hans": "无法联系（用户不存在或助手离线）",
    "zh-Hant": "無法聯繫（用戶不存在或助手離線）",
    "en": "Unable to contact (user does not exist or assistant is offline)",
}

_UNKNOWN_USER = {
    "zh-Hans": "未知用户",
    "zh-Hant": "未知用戶",
    "en": "Unknown user",
}


# ============================================================
# Public API
# ============================================================

_TEMPLATE_MAP = {
    "initiator": _INITIATOR_TEMPLATE,
    "responder": _RESPONDER_TEMPLATE,
    "initial": _INITIAL_TEMPLATE,
}


def get_template(name: str, lang: str = DEFAULT_LANG) -> str:
    """获取指定语言的 prompt 模板字符串，fallback 到 zh-Hans"""
    templates = _TEMPLATE_MAP.get(name, {})
    return templates.get(lang) or templates.get(DEFAULT_LANG, "")


def get_source_context_labels(lang: str = DEFAULT_LANG) -> tuple[str, str, str]:
    """返回 (header, footer, user_role_label)"""
    return (
        _SOURCE_CONTEXT_HEADER.get(lang, _SOURCE_CONTEXT_HEADER[DEFAULT_LANG]),
        _SOURCE_CONTEXT_FOOTER.get(lang, _SOURCE_CONTEXT_FOOTER[DEFAULT_LANG]),
        _SOURCE_CONTEXT_ROLE_USER.get(lang, _SOURCE_CONTEXT_ROLE_USER[DEFAULT_LANG]),
    )


def get_completion_patterns(lang: str = DEFAULT_LANG) -> list[str]:
    """返回语义完成检测的正则模式列表（目标语言 + 通用 fallback 并集）"""
    patterns = list(_COMPLETION_PATTERNS.get(lang, []))
    if lang != DEFAULT_LANG:
        # 追加默认语言模式作为 fallback（LLM 可能不严格遵循 prompt 语言）
        patterns.extend(_COMPLETION_PATTERNS.get(DEFAULT_LANG, []))
    return patterns


def get_reason_string(key: str, lang: str = DEFAULT_LANG, **kwargs) -> str:
    """获取暂停/终止原因的本地化文本"""
    entry = _REASON_STRINGS.get(key, {})
    text = entry.get(lang) or entry.get(DEFAULT_LANG, key)
    if kwargs:
        try:
            text = text.format(**kwargs)
        except (KeyError, IndexError):
            pass
    return text


def get_termination_display(reason_value: str, lang: str = DEFAULT_LANG) -> str:
    """获取终止原因枚举值的本地化显示文本"""
    entry = _TERMINATION_DISPLAY.get(reason_value, {})
    return entry.get(lang) or entry.get(DEFAULT_LANG, reason_value)


def _l(d: dict[str, str], lang: str) -> str:
    return d.get(lang) or d.get(DEFAULT_LANG, "")


# ---- Capability prompt builder ----

def build_capability_prompt_i18n(
    contacts: list[dict],
    my_owner_name: str = "",
    current_dialog_partner: str = "",
    lang: str = DEFAULT_LANG,
) -> str:
    """构造多语言版 capability prompt"""
    if not contacts:
        return ""

    online, offline = _CAPABILITY_STATUS_LABEL.get(lang, _CAPABILITY_STATUS_LABEL[DEFAULT_LANG])
    default_desc = _l(_CAPABILITY_DEFAULT_DESC, lang)

    contact_lines = []
    for c in contacts:
        owner_name = c.get("owner_name", "Unknown")
        status = c.get("status", "unknown")
        status_label = online if status == "online" else offline
        contact_lines.append(f"  - {owner_name} [{status_label}]")

    identity_line = ""
    if my_owner_name:
        identity_tpl = _l(_CAPABILITY_IDENTITY, lang)
        identity_line = identity_tpl.format(my_owner_name=my_owner_name)

    dialog_partner_line = ""
    if current_dialog_partner:
        partner_tpl = _l(_CAPABILITY_DIALOG_PARTNER, lang)
        dialog_partner_line = partner_tpl.format(current_dialog_partner=current_dialog_partner)

    template = _l(_CAPABILITY_TEMPLATE, lang)
    return template.format(
        identity_line=identity_line,
        dialog_partner_line=dialog_partner_line,
        contact_list="\n".join(contact_lines),
    )


def get_user_msg_label(lang: str = DEFAULT_LANG) -> str:
    """获取 '用户消息：' 标签"""
    return _l(_CAPABILITY_USER_MSG_LABEL, lang)


# ---- Dialog result prompt builder ----

def build_dialog_result_prompt_i18n(
    topic: str,
    responder_owner_name: str,
    summary: str,
    discovery_context: dict | None = None,
    lang: str = DEFAULT_LANG,
) -> str:
    """构造多语言版对话结果回传 prompt"""
    if discovery_context:
        contacted = discovery_context.get("contacted_count", 1)
        max_hops = discovery_context.get("max_hops", 5)
        original_intent = discovery_context.get("original_intent", "")
        pending = discovery_context.get("pending_count", 0)

        pending_text = ""
        if pending:
            pending_text = _l(_DIALOG_RESULT_PENDING_TEXT, lang).format(n=pending)

        extra = _l(_DIALOG_RESULT_DISCOVERY_EXTRA, lang).format(
            contacted=contacted,
            max_hops=max_hops,
            original_intent=original_intent,
            pending_text=pending_text,
        )
    else:
        extra = _l(_DIALOG_RESULT_SIMPLE_EXTRA, lang)

    return _l(_DIALOG_RESULT_TEMPLATE, lang).format(
        topic=topic,
        responder_owner_name=responder_owner_name,
        summary=summary,
        extra=extra,
    )


# ---- Resume prompt builder ----

def build_resume_prompt_i18n(
    completed_results: list[dict],
    cancelled: bool = False,
    cancel_reason: str | None = None,
    lang: str = DEFAULT_LANG,
) -> str:
    """构造多语言版嵌套对话恢复 prompt"""
    unknown = _l(_RESUME_UNKNOWN, lang)
    no_reply = _l(_RESUME_NO_REPLY, lang)
    marker = _l(_RESUME_MARKER_INSTRUCTIONS, lang)

    if cancelled:
        reason_text = cancel_reason or "user_cancelled"
        if completed_results:
            result_lines = [
                f"- {r.get('target_owner', unknown)}: {r.get('summary', no_reply)}"
                for r in completed_results
            ]
            body = _l(_RESUME_CANCELLED_WITH_RESULTS, lang).format(
                reason=reason_text, partial="\n".join(result_lines),
            )
        else:
            body = _l(_RESUME_CANCELLED_NO_RESULTS, lang).format(reason=reason_text)
    else:
        result_lines = []
        for r in completed_results:
            owner = r.get("target_owner", unknown)
            summary = r.get("summary", no_reply)
            status = r.get("status", "unknown")
            result_lines.append(f"- {owner}（{status}）: {summary}")

        no_info = _l(_RESUME_NO_VALID_INFO, lang)
        result_text = "\n".join(result_lines) if result_lines else no_info
        body = _l(_RESUME_COMPLETED, lang).format(result_text=result_text)

    return f"[NESTED_DIALOG_RESULT]\n{body}\n{marker}\n[/NESTED_DIALOG_RESULT]"


# ---- Final summary prompt builder ----

def build_final_summary_prompt_i18n(
    completed_results: list[dict],
    original_intent: str,
    lang: str = DEFAULT_LANG,
) -> str:
    """构造多语言版发现任务最终汇总 prompt"""
    unknown = _l(_RESUME_UNKNOWN, lang)
    no_reply = _l(_RESUME_NO_REPLY, lang)
    status_labels = _FINAL_SUMMARY_STATUS_LABELS.get(lang, _FINAL_SUMMARY_STATUS_LABELS[DEFAULT_LANG])
    item_tpl = _l(_FINAL_SUMMARY_ITEM, lang)

    result_lines = []
    for i, r in enumerate(completed_results, 1):
        owner = r.get("target_owner", unknown)
        topic = r.get("topic", "")
        summary = r.get("summary", no_reply)
        status = r.get("status", "unknown")
        status_label = status_labels.get(status, status)
        result_lines.append(item_tpl.format(
            i=i, owner=owner, status_label=status_label, topic=topic, summary=summary,
        ))

    return _l(_FINAL_SUMMARY_TEMPLATE, lang).format(
        total=len(completed_results),
        original_intent=original_intent,
        result_lines="\n".join(result_lines),
    )


def get_contact_failed_summary(lang: str = DEFAULT_LANG) -> str:
    return _l(_CONTACT_FAILED_SUMMARY, lang)


def get_unknown_user(lang: str = DEFAULT_LANG) -> str:
    return _l(_UNKNOWN_USER, lang)
