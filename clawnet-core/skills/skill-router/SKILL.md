---
name: skill-router
description: Route every user request by evaluating installed skills to detect capability gaps. Consult as the FIRST step for ANY user request to determine whether existing skills suffice, need updating, or a new skill must be created via skill-creator and validated by skill-evaluator. Triggers on all user requests for capability routing, skill gap detection, and self-evolution decisions.
---

# Skill Router

Lightweight decision layer. For every user request, quickly determine the best path: use an existing skill, update one, or create a new one.

## Hard Rules

1. **Protected skills**: NEVER create, modify, or trigger creation of skill-router, skill-creator, or skill-evaluator. These infrastructure skills are maintained manually only.
2. **No unnecessary skills**: Do NOT create skills for tasks the agent handles well natively — writing text, answering questions, general coding, summarizing, translating short content, etc. Only create skills when a genuinely new capability is needed (external API integration, domain-specific tooling, deterministic scripts, recurring complex workflows).
3. **No one-off skills**: Do NOT create skills for tasks unlikely to recur. A skill is worth creating only when the capability will be reused across future requests.
4. **No duplicates**: Before creating any skill, always verify no existing skill already covers the same domain after requirement distillation.

## Workflow

### Step 1: Quick Capability Scan

Read ONLY the `name` and `description` metadata of every installed skill. Do NOT load skill bodies or resources — keep this step fast.

For each skill, assess: does its described capability semantically cover what the user is asking for?

Four possible outcomes:

- **No skill needed** — the agent can handle this natively → fulfill the request directly, skip all remaining steps
- **Full match** — an existing skill clearly covers this request → Step 2A
- **Partial match** — a skill covers the domain but the request reveals a gap → Step 2B
- **No match** — a genuinely new capability is needed → Step 2C

### Step 2A: Full Match — Use Existing Skill

Load and follow the matched skill to fulfill the user's request. No further routing action.

### Step 2B: Partial Match — Consider Updating

An existing skill covers the domain but the user's request exposes a limitation.

1. Attempt to fulfill the request with the existing skill first
2. If the result is insufficient, inform the user of the specific limitation
3. Ask the user: "Current [{skill-name}] doesn't fully support [{missing capability}]. Update it?"
   - **Yes** → distill the improvement requirement (Step 3), pass to skill-creator targeting the existing skill for update, then validate with skill-evaluator
   - **No** → deliver best-effort result

### Step 2C: No Match — Consider Creating

No installed skill covers this capability, and the agent cannot handle it natively.

1. If the user's request is vague or ambiguous, ask clarifying questions first — do not create skills from unclear requirements
2. Distill the general capability needed (Step 3)
3. Confirm with the user: "No existing skill covers [{distilled capability}]. Create one?"
   - **Yes** → proceed to Step 4
   - **No** → attempt best-effort without a dedicated skill

### Step 3: Distill Requirement

Transform the user's specific request into a **general-purpose** skill requirement. This is the most critical step — poor distillation leads to narrow or duplicate skills.

#### Generality Distillation

Extract the domain-level capability, not the user's specific instance:

| User says | Distill to | NOT |
|-----------|-----------|-----|
| "Calculate sqrt(pi)" | General math calculator | "sqrt(pi) function" |
| "Generate a cat picture" | Text-to-image generation via API | "Cat picture generator" |
| "Convert report.docx to PDF" | General DOCX→PDF converter | "report.docx processor" |
| "Query our sales database" | Database query tool | "Sales table querier" |
| "Translate this paragraph to French" | Multi-language text translator | "French-only translator" |

Ask: "If the user came back tomorrow with a different input in the same domain, would this skill still work?"

#### De-duplication Check

After distillation, re-scan all skill descriptions one more time. If the distilled capability now overlaps with an existing skill that was missed in Step 1, switch to Step 2B (update) instead of creating a new one.

#### Produce Structured Requirement

Assemble a complete requirement — this is what skill-creator receives, not the user's raw words:

```
Skill Requirement:
- Name: {proposed hyphen-case name}
- Capability: {general domain description}
- Core functions: {list of key operations the skill must support}
- Input: {what the user provides}
- Output: {what the skill produces}
- External dependencies: {APIs, libraries, tools — mark user-configurable items like API keys}
- Scope boundary: {what this skill explicitly does NOT cover}
```

When external services are involved (API keys, credentials), specify that these must be user-configurable, never hardcoded.

### Step 4: Create → Evaluate → Execute

1. Pass the structured requirement to **skill-creator** to produce the new skill (or update the existing one)
2. Pass the result to **skill-evaluator** for validation (intent alignment, quality and generality, functional testing)
3. If evaluation passes → use the new or updated skill to fulfill the user's **original request** immediately
4. If evaluation fails → skill-evaluator handles the fix-and-retest loop (up to K iterations)

The user's current task is always completed with the newly created skill — create first, then execute.
