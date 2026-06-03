import os
import random
import re
import secrets
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from fastapi import HTTPException

from src.models.user import User
from src.schemas.auth import RegisterRequest, LoginRequest, AuthTokens
from src.utils.security import hash_password, verify_password, create_access_token, create_refresh_token, decode_token
from src.utils.errors import ValidationError, AuthTokenInvalid, AuthRefreshFailed, PasswordMismatch, PasswordSameAsOld
from src.config import settings
from src.services import tag_service
from src.services.provision_service import ProvisionService, make_slug, DEFAULT_GATEWAY_ENV

_provision_svc = ProvisionService()


# Reserved user_code pools
def _build_reserved_codes() -> set[str]:
    codes = set()
    # 0-prefix: 0000-0999
    for i in range(0, 1000):
        codes.add(f"{i:04d}")
    # Repeating (豹子号)
    for d in range(1, 10):
        codes.add(str(d) * 4)
    # Sequential ascending
    for start in range(1, 7):
        codes.add("".join(str(start + j) for j in range(4)))
    # Sequential descending
    for start in range(9, 3, -1):
        codes.add("".join(str(start - j) for j in range(4)))
    return codes

_RESERVED_CODES = _build_reserved_codes()


async def allocate_user_code(db: AsyncSession) -> str:
    """Pick a random available non-reserved user_code."""
    result = await db.execute(select(User.user_code))
    taken = {row[0] for row in result.fetchall()}

    all_codes = {f"{i:04d}" for i in range(1000, 10000)}
    available = list(all_codes - _RESERVED_CODES - taken)

    if not available:
        raise HTTPException(status_code=503, detail="No available user codes")

    return random.choice(available)


async def register_user(db: AsyncSession, req: RegisterRequest) -> tuple[User, AuthTokens]:
    if not req.email and not req.phone:
        raise ValidationError("邮箱和手机号至少需要一个")

    # Check duplicates
    conditions = []
    if req.email:
        conditions.append(User.email == req.email)
    if req.phone:
        conditions.append(User.phone == req.phone)

    existing = await db.execute(select(User).where(or_(*conditions)))
    if existing.scalar_one_or_none():
        raise ValidationError("该邮箱或手机号已注册")

    # Allocate gateway resources
    env = os.getenv("GATEWAY_ENV", DEFAULT_GATEWAY_ENV)
    slug = make_slug(req.email, req.display_name)
    port = await _provision_svc.allocate_port(db, env)
    token = secrets.token_hex(24)
    user_code = await allocate_user_code(db)

    user = User(
        display_name=req.display_name,
        email=req.email,
        phone=req.phone,
        password_hash=hash_password(req.password),
        avatar_url=req.avatar_url,
        status="online",
        slug=slug,
        user_code=user_code,
        gateway_port=port,
        gateway_token=token,
        gateway_env=env,
        gateway_status="pending",
    )
    db.add(user)
    await db.flush()

    # create_default_tag also creates owner+delegate agent pair via _create_tag_agent_pair
    await tag_service.create_default_tag(db, user.id)

    tokens = _create_tokens(str(user.id))
    return user, tokens


async def login_user(db: AsyncSession, req: LoginRequest) -> tuple[User, AuthTokens]:
    identifier = (req.email or "").strip()

    if re.fullmatch(r'\d{4}', identifier):
        # 4-digit number → lookup by user_code
        stmt = select(User).where(User.user_code == identifier)
    elif identifier:
        # Otherwise → lookup by email
        stmt = select(User).where(User.email == identifier)
    elif req.phone:
        # Fallback: phone login (preserved for backward compat)
        stmt = select(User).where(User.phone == req.phone.strip())
    else:
        raise HTTPException(status_code=400, detail="Email or ID required")

    user = (await db.execute(stmt)).scalar_one_or_none()

    if not user or not verify_password(req.password, user.password_hash):
        raise AuthTokenInvalid()

    user.status = "online"
    await db.flush()

    # Ensure default tag exists (backfill for users created before this feature)
    await tag_service.ensure_default_tag(db, user.id)

    tokens = _create_tokens(str(user.id))
    return user, tokens


async def refresh_tokens(db: AsyncSession, refresh_token: str) -> AuthTokens:
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise AuthRefreshFailed()

    user_id = payload.get("sub")
    if not user_id:
        raise AuthRefreshFailed()

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise AuthRefreshFailed()

    return _create_tokens(str(user.id))


async def change_password(db: AsyncSession, user: User, old_password: str, new_password: str):
    if not verify_password(old_password, user.password_hash):
        raise PasswordMismatch()
    if verify_password(new_password, user.password_hash):
        raise PasswordSameAsOld()
    user.password_hash = hash_password(new_password)
    await db.flush()


async def logout_user(db: AsyncSession, user: User):
    user.status = "offline"
    await db.flush()


def _create_tokens(user_id: str) -> AuthTokens:
    return AuthTokens(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_SECONDS,
    )
