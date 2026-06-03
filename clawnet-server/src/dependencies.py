import uuid
from typing import Optional
from fastapi import Depends, Header, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.database import get_db
from src.models.user import User
from src.utils.security import decode_token
from src.utils.errors import AuthTokenInvalid, AuthTokenExpired


async def get_current_user(
    authorization: Optional[str] = Header(None, alias="Authorization"),
    token: Optional[str] = Query(None, alias="token"),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and validate JWT token.
    
    Supports two methods:
    1. Authorization: Bearer <token> header (primary)
    2. ?token=<token> query parameter (fallback, for <img>/<video> src URLs)
    """
    jwt_token: Optional[str] = None

    # Try Authorization header first
    if authorization and authorization.startswith("Bearer "):
        jwt_token = authorization[7:]
    # Fallback to query parameter
    elif token:
        jwt_token = token

    if not jwt_token:
        raise AuthTokenInvalid()

    payload = decode_token(jwt_token)

    if payload is None:
        raise AuthTokenInvalid()

    if payload.get("type") != "access":
        raise AuthTokenInvalid()

    user_id = payload.get("sub")
    if not user_id:
        raise AuthTokenInvalid()

    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        raise AuthTokenInvalid()

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()

    if user is None:
        raise AuthTokenInvalid()

    return user


async def require_admin(
    user: User = Depends(get_current_user),
) -> User:
    """Require the current user to have admin role."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
