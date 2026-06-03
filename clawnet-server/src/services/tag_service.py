import fnmatch as _fnmatch
import hashlib
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.agent import Agent
from src.models.contact import Contact
from src.models.tag import Tag
from src.models.user import User
from src.schemas.agent import CreateAgentRequest
from src.schemas.tag import CreateTagRequest, TagResponse, UpdateTagRequest


def _camel_case_node_acl(node_acl: dict | None) -> dict | None:
    """Convert snake_case node_acl fields to camelCase for gateway consumption."""
    if not node_acl:
        return node_acl
    return {
        "allowedPaths": node_acl.get("allowed_paths", []),
        "deniedPaths": node_acl.get("denied_paths", []),
    }


async def create_default_tag(db: AsyncSession, owner_id: uuid.UUID) -> Tag:
    """Create the default tag for a new user. Called during registration.

    Creates TWO tags:
    - default: regular fallback tag, same permissions as other tags, can be contacted by external agents
    - main: global advisor tag, elevated permissions (user-level whitelist), hidden from external contact
    Returns the default tag.
    """
    # 1. Create the default tag (regular, for external contact fallback)
    default_tag = Tag(
        owner_id=owner_id,
        name="default",
        display_name="Default",
        is_default=True,
        is_main=False,
        workspace_id="default",
    )
    db.add(default_tag)
    await db.flush()
    await _create_tag_agent_pair(db, owner_id, default_tag)

    # 2. Create the main tag (global advisor, hidden from external contact)
    main_tag = Tag(
        owner_id=owner_id,
        name="main",
        display_name="Main Assistant",
        is_default=False,
        is_main=True,
        workspace_id="main",
    )
    db.add(main_tag)
    await db.flush()
    await _create_tag_agent_pair(db, owner_id, main_tag)

    # Sync main tag ACL to user-level whitelist
    await _sync_main_tag_acl(db, owner_id)

    return default_tag


async def ensure_default_tag(db: AsyncSession, owner_id: uuid.UUID) -> Tag:
    """Ensure a default tag exists for the user. Creates one if missing (backfill for old users)."""
    result = await db.execute(
        select(Tag).where(Tag.owner_id == owner_id, Tag.is_default.is_(True))
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing
    return await create_default_tag(db, owner_id)


def _slugify(display_name: str) -> str:
    """Convert display_name to a filesystem-safe slug (lowercase alphanumeric + hyphens)."""
    slug = display_name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    if not slug:
        slug = "tag-" + hashlib.md5(display_name.encode()).hexdigest()[:8]
    return slug


async def _unique_workspace_id(db: AsyncSession, owner_id: uuid.UUID, base: str) -> str:
    """Ensure workspace_id is unique for this owner."""
    candidate = base
    suffix = 2
    while True:
        existing = await db.execute(
            select(Tag).where(Tag.owner_id == owner_id, Tag.workspace_id == candidate)
        )
        if existing.scalar_one_or_none() is None:
            return candidate
        candidate = f"{base}-{suffix}"
        suffix += 1


async def create_tag(db: AsyncSession, owner_id: uuid.UUID, req: CreateTagRequest) -> TagResponse:
    workspace_id = _slugify(req.display_name)
    workspace_id = await _unique_workspace_id(db, owner_id, workspace_id)
    name = workspace_id

    tag = Tag(
        owner_id=owner_id,
        name=name,
        display_name=req.display_name,
        icon=req.icon,
        color=req.color,
        workspace_id=workspace_id,
        node_acl=req.node_acl.model_dump() if req.node_acl else {"allowed_paths": [], "denied_paths": []},
    )
    db.add(tag)
    await db.flush()

    # Auto-create owner + delegate agent pair for the new tag
    await _create_tag_agent_pair(db, owner_id, tag)

    await _sync_main_tag_acl(db, owner_id)

    return TagResponse.model_validate(tag)


async def _create_tag_agent_pair(db: AsyncSession, owner_id: uuid.UUID, tag: Tag) -> None:
    """Create an owner agent (rw, user-visible) and a delegate agent (ro, hidden) for the tag."""
    from src.services.agent_service import create_agent

    # Resolve the User object needed by create_agent
    user_result = await db.execute(select(User).where(User.id == owner_id))
    user = user_result.scalar_one()

    # Owner agent — creates contact + conversation (user can see and chat)
    owner_req = CreateAgentRequest(
        display_name=f"{tag.display_name}",
        description=f"{tag.display_name} 的 AI 助理",
        tag_id=tag.id,
        tag_role="owner",
    )
    await create_agent(db, user, owner_req, create_contact=True)

    # Delegate agent — no contact/conversation (hidden, used for A2A only)
    delegate_req = CreateAgentRequest(
        display_name=f"{tag.display_name}（助理）",
        description=f"{tag.display_name} 的 A2A 助理（只读）",
        tag_id=tag.id,
        tag_role="delegate",
    )
    await create_agent(db, user, delegate_req, create_contact=False)


async def _ensure_tag_agent_pair(db: AsyncSession, owner_id: uuid.UUID, tag: Tag) -> None:
    """Backfill owner+delegate agents if missing for an existing tag."""
    result = await db.execute(
        select(Agent).where(Agent.owner_id == owner_id, Agent.tag_id == tag.id)
    )
    if not result.scalars().first():
        await _create_tag_agent_pair(db, owner_id, tag)


async def get_tags(db: AsyncSession, owner_id: uuid.UUID) -> list[TagResponse]:
    result = await db.execute(
        select(Tag).where(Tag.owner_id == owner_id).order_by(Tag.created_at)
    )
    tags = result.scalars().all()

    # Backfill: ensure each tag has its agent pair
    for tag in tags:
        await _ensure_tag_agent_pair(db, owner_id, tag)

    return [TagResponse.model_validate(t) for t in tags]


async def get_tag(db: AsyncSession, tag_id: uuid.UUID, owner_id: uuid.UUID) -> TagResponse:
    result = await db.execute(
        select(Tag).where(Tag.id == tag_id, Tag.owner_id == owner_id)
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise ValueError("Tag not found")
    return TagResponse.model_validate(tag)


async def update_tag(db: AsyncSession, tag_id: uuid.UUID, owner_id: uuid.UUID, req: UpdateTagRequest) -> TagResponse:
    result = await db.execute(
        select(Tag).where(Tag.id == tag_id, Tag.owner_id == owner_id)
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise ValueError("Tag not found")

    if req.display_name is not None:
        tag.display_name = req.display_name
    if req.icon is not None:
        tag.icon = req.icon
    if req.color is not None:
        tag.color = req.color
    if req.node_acl is not None:
        tag.node_acl = req.node_acl.model_dump()

    tag.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return TagResponse.model_validate(tag)


async def delete_tag(db: AsyncSession, tag_id: uuid.UUID, owner_id: uuid.UUID) -> None:
    result = await db.execute(
        select(Tag).where(Tag.id == tag_id, Tag.owner_id == owner_id)
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise ValueError("Tag not found")
    if tag.is_default:
        raise ValueError("Cannot delete default tag")
    if tag.is_main:
        raise ValueError("Cannot delete main tag")

    # Cascade delete: remove agents bound to this tag and their contacts
    agent_ids_result = await db.execute(
        select(Agent.id).where(Agent.tag_id == tag_id, Agent.owner_id == owner_id)
    )
    agent_ids = [row[0] for row in agent_ids_result.all()]

    if agent_ids:
        # Delete contacts pointing to these agents
        await db.execute(
            delete(Contact).where(Contact.contact_id.in_(agent_ids), Contact.contact_type == "agent")
        )
        # Delete the agents themselves
        await db.execute(
            delete(Agent).where(Agent.id.in_(agent_ids))
        )

    await db.delete(tag)
    await db.flush()

    await _sync_main_tag_acl(db, owner_id)


async def get_main_tag(db: AsyncSession, owner_id: uuid.UUID) -> Tag | None:
    """Get the main tag (is_main=True) for a user, if any."""
    result = await db.execute(
        select(Tag).where(Tag.owner_id == owner_id, Tag.is_main == True)
    )
    return result.scalar_one_or_none()


async def _sync_main_tag_acl(db: AsyncSession, owner_id: uuid.UUID):
    """Sync the main tag's node_acl to equal the user-level fileAccess whitelist.

    The main agent's node permissions are always the full user-level whitelist,
    not a subset. This is called when tags are created/deleted or when user
    file access settings change.
    """
    main_tag = await get_main_tag(db, owner_id)
    if not main_tag:
        return

    # Load user-level fileAccess settings (the "big whitelist")
    user_result = await db.execute(select(User).where(User.id == owner_id))
    user = user_result.scalar_one_or_none()
    if not user:
        return

    file_access = (user.settings or {}).get("file_access", {})
    user_allowed = file_access.get("allowed_paths", [])
    user_denied = file_access.get("denied_paths", [])

    main_tag.node_acl = {
        "allowed_paths": list(user_allowed),
        "denied_paths": list(user_denied),
    }
    await db.flush()


async def get_default_tag(db: AsyncSession, owner_id: uuid.UUID) -> Tag:
    result = await db.execute(
        select(Tag).where(Tag.owner_id == owner_id, Tag.is_default == True)
    )
    tag = result.scalar_one_or_none()
    if not tag:
        tag = await create_default_tag(db, owner_id)
    else:
        # Ensure agent pair exists (backfill for tags created before tag_role system)
        await _ensure_tag_agent_pair(db, owner_id, tag)
    return tag


async def resolve_tag_for_agent(db: AsyncSession, agent: Agent) -> Tag:
    """Resolve the effective tag for an agent."""
    if agent.tag_id:
        result = await db.execute(select(Tag).where(Tag.id == agent.tag_id))
        tag = result.scalar_one_or_none()
        if tag:
            return tag
    return await get_default_tag(db, agent.owner_id)


async def resolve_tag_for_contact(db: AsyncSession, user_id: uuid.UUID, contact_user_id: uuid.UUID) -> Tag:
    """Resolve the effective tag for a human contact."""
    import logging as _logging
    _log = _logging.getLogger("clawnet.agent_dialog")

    result = await db.execute(
        select(Contact).where(
            Contact.user_id == user_id,
            Contact.contact_id == contact_user_id,
            Contact.contact_type == "human",
        )
    )
    contact = result.scalar_one_or_none()
    if contact and contact.tag_id:
        tag_result = await db.execute(select(Tag).where(Tag.id == contact.tag_id))
        tag = tag_result.scalar_one_or_none()
        if tag:
            _log.warning(
                f"[resolve_tag_for_contact] user={str(user_id)[:8]} contact={str(contact_user_id)[:8]} "
                f"→ found Contact tag_id={str(contact.tag_id)[:8]} → tag={tag.name}({tag.display_name})"
            )
            return tag
        _log.warning(
            f"[resolve_tag_for_contact] user={str(user_id)[:8]} contact={str(contact_user_id)[:8]} "
            f"→ Contact.tag_id={str(contact.tag_id)[:8]} but Tag not found! Falling back to default."
        )
    else:
        _log.warning(
            f"[resolve_tag_for_contact] user={str(user_id)[:8]} contact={str(contact_user_id)[:8]} "
            f"→ Contact {'not found' if not contact else 'has no tag_id'}. Falling back to default."
        )
    return await get_default_tag(db, user_id)


async def find_agent_by_tag(db: AsyncSession, owner_id: uuid.UUID, tag_id: uuid.UUID) -> Agent | None:
    """Find an agent bound to a tag. Prefer online agents, then most recently created."""
    result = await db.execute(
        select(Agent)
        .where(Agent.owner_id == owner_id, Agent.tag_id == tag_id)
        .order_by(
            (Agent.status == "online").desc(),
            Agent.created_at.desc(),
        )
    )
    return result.scalars().first()


async def find_agent_by_tag_role(
    db: AsyncSession, owner_id: uuid.UUID, tag_id: uuid.UUID, role: str
) -> Agent | None:
    """Find an agent bound to a tag with a specific role. Prefer online agents."""
    result = await db.execute(
        select(Agent)
        .where(
            Agent.owner_id == owner_id,
            Agent.tag_id == tag_id,
            Agent.tag_role == role,
        )
        .order_by(
            (Agent.status == "online").desc(),
            Agent.created_at.desc(),
        )
    )
    return result.scalars().first()


def validate_node_acl(tag: Tag, requested_path: str) -> tuple[bool, str]:
    """Check if a file path is allowed by the tag's node_acl. Returns (allowed, reason)."""
    acl = tag.node_acl or {}
    denied = acl.get("denied_paths", [])
    allowed = acl.get("allowed_paths", [])

    for pattern in denied:
        if _fnmatch.fnmatch(requested_path, pattern):
            return False, f"denied by tag ACL pattern: {pattern}"

    for pattern in allowed:
        if _fnmatch.fnmatch(requested_path, pattern):
            return True, "allowed by tag ACL"
        clean = pattern.rstrip("/")
        if not any(c in clean for c in "*?["):
            if requested_path.startswith(clean + "/"):
                return True, "allowed by tag ACL (dir prefix)"

    return False, "not in tag ACL allowed paths"


async def resolve_tag_context_by_id(db: AsyncSession, tag_id: uuid.UUID) -> dict:
    """Resolve tag context directly by tag ID.
    Used by A2A where the correct tag is already determined by the caller.
    """
    result = await db.execute(select(Tag).where(Tag.id == tag_id))
    tag = result.scalar_one_or_none()
    if not tag:
        raise ValueError(f"Tag {tag_id} not found")
    return {
        "tag_id": str(tag.id),
        "tag_name": tag.name,
        "tag_display_name": tag.display_name,
        "workspace_id": tag.workspace_id,
        "node_acl": _camel_case_node_acl(tag.node_acl),
        "is_main": tag.is_main,
    }


async def resolve_conversation_context(
    db: AsyncSession, user_id: uuid.UUID, conversation_id: uuid.UUID
) -> dict:
    """Resolve the full tag context for a conversation.
    Returns dict with tag info, workspace_id, camelCase node_acl, and access_mode.
    access_mode is "rw" for owner agents, "ro" for delegate agents.
    Used by nodeclaw to load the correct workspace.
    """
    from src.models.conversation import ConversationParticipant

    result = await db.execute(
        select(ConversationParticipant)
        .where(ConversationParticipant.conversation_id == conversation_id)
    )
    participants = result.scalars().all()

    tag = None
    access_mode = "rw"  # default: read-write

    for p in participants:
        if p.participant_type == "agent":
            agent_result = await db.execute(select(Agent).where(Agent.id == p.participant_id))
            agent = agent_result.scalar_one_or_none()
            if agent and agent.owner_id == user_id:
                tag = await resolve_tag_for_agent(db, agent)
                # Determine access_mode from agent's tag_role
                if agent.tag_role == "delegate":
                    access_mode = "ro"
                break
            elif agent:
                tag = await resolve_tag_for_contact(db, user_id, agent.owner_id)
                break
        elif p.participant_type == "human" and p.participant_id != user_id:
            tag = await resolve_tag_for_contact(db, user_id, p.participant_id)
            break

    if not tag:
        tag = await get_default_tag(db, user_id)

    return {
        "tag_id": str(tag.id),
        "tag_name": tag.name,
        "tag_display_name": tag.display_name,
        "workspace_id": tag.workspace_id,
        "node_acl": _camel_case_node_acl(tag.node_acl),
        "access_mode": access_mode,
        "is_main": tag.is_main,
    }
