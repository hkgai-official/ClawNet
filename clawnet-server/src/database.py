from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from src.config import settings


engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=settings.DATABASE_POOL_SIZE,
    max_overflow=settings.DATABASE_MAX_OVERFLOW,
    echo=False,
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
AsyncSessionLocal = async_session


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    # Import all models to ensure they are registered with Base.metadata
    import src.models.user  # noqa: F401
    import src.models.agent  # noqa: F401
    import src.models.conversation  # noqa: F401
    import src.models.message  # noqa: F401
    import src.models.task  # noqa: F401
    import src.models.file  # noqa: F401
    import src.models.contact  # noqa: F401
    import src.models.audit  # noqa: F401
    import src.models.agent_session_key  # noqa: F401
    import src.models.friend_request  # noqa: F401
    import src.models.user_event  # noqa: F401
    import src.models.discovery_task  # noqa: F401
    import src.models.tag  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db():
    await engine.dispose()
