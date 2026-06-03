import os
import uuid
import hashlib
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.models.file import File
from src.schemas.file import FileResponse, FileCheckResponse, ChunkUploadResponse, CompleteUploadRequest
from src.utils.errors import FileNotFound, FileTooLarge
from src.config import settings


# Temporary storage for chunks during upload
_chunk_storage: dict[str, dict] = {}


async def check_file_by_hash(db: AsyncSession, file_hash: str) -> FileCheckResponse:
    result = await db.execute(select(File).where(File.hash == file_hash))
    existing = result.scalar_one_or_none()
    if existing:
        return FileCheckResponse(exists=True, file_id=existing.id)
    return FileCheckResponse(exists=False)


async def upload_chunk(file_hash: str, chunk_index: int, chunk_data: bytes) -> ChunkUploadResponse:
    # Store chunk to disk
    chunk_dir = Path(settings.UPLOAD_DIR) / "chunks" / file_hash
    chunk_dir.mkdir(parents=True, exist_ok=True)

    chunk_path = chunk_dir / f"chunk_{chunk_index}"
    with open(chunk_path, "wb") as f:
        f.write(chunk_data)

    # Track chunks
    if file_hash not in _chunk_storage:
        _chunk_storage[file_hash] = {"chunks": set()}
    _chunk_storage[file_hash]["chunks"].add(chunk_index)

    return ChunkUploadResponse(chunk_index=chunk_index, received=True)


async def complete_upload(
    db: AsyncSession,
    user_id: uuid.UUID,
    req: CompleteUploadRequest,
) -> FileResponse:
    # Check if already exists (instant upload / 秒传)
    existing_result = await db.execute(select(File).where(File.hash == req.hash))
    existing = existing_result.scalar_one_or_none()
    if existing:
        return FileResponse(
            id=existing.id,
            hash=existing.hash,
            name=existing.name,
            size=existing.size,
            mime_type=existing.mime_type,
            storage_path=existing.storage_path,
            uploaded_by=existing.uploaded_by,
            created_at=existing.created_at,
        )

    # Merge chunks
    chunk_dir = Path(settings.UPLOAD_DIR) / "chunks" / req.hash
    final_dir = Path(settings.UPLOAD_DIR) / "files"
    final_dir.mkdir(parents=True, exist_ok=True)

    file_ext = Path(req.name).suffix
    storage_filename = f"{req.hash}{file_ext}"
    storage_path = final_dir / storage_filename

    with open(storage_path, "wb") as outfile:
        for i in range(req.total_chunks):
            chunk_path = chunk_dir / f"chunk_{i}"
            if chunk_path.exists():
                with open(chunk_path, "rb") as chunk_file:
                    outfile.write(chunk_file.read())

    # Clean up chunks
    if chunk_dir.exists():
        for f in chunk_dir.iterdir():
            f.unlink()
        chunk_dir.rmdir()

    # Clean up tracking
    _chunk_storage.pop(req.hash, None)

    # Save to database
    file_record = File(
        hash=req.hash,
        name=req.name,
        size=req.size,
        mime_type=req.mime_type,
        storage_path=str(storage_path),
        uploaded_by=user_id,
    )
    db.add(file_record)
    await db.flush()

    return FileResponse(
        id=file_record.id,
        hash=file_record.hash,
        name=file_record.name,
        size=file_record.size,
        mime_type=file_record.mime_type,
        storage_path=file_record.storage_path,
        uploaded_by=file_record.uploaded_by,
        created_at=file_record.created_at,
    )


async def assert_file_access(db: AsyncSession, file_record: File, user_id: uuid.UUID) -> None:
    """Verify user has access to a file.

    Access is granted if the user uploaded the file OR is a participant in any
    conversation where a message references this file (by file_id in content).
    For simplicity we check uploader first (fast path) then fall back to a
    conversation-participant check via message content.
    """
    # Fast path: uploader owns the file
    if file_record.uploaded_by == user_id:
        return

    # Slow path: check if user is participant in a conversation containing a
    # message that references this file id.
    from src.models.message import Message
    from src.models.conversation import ConversationParticipant
    from sqlalchemy import cast, String

    file_id_str = str(file_record.id)
    # Find conversations where this user is a participant
    user_conv_ids = (
        select(ConversationParticipant.conversation_id)
        .where(ConversationParticipant.participant_id == user_id)
    )
    # Check if any message in those conversations references this file
    msg_result = await db.execute(
        select(Message.id)
        .where(
            Message.conversation_id.in_(user_conv_ids),
            cast(Message.content, String).contains(file_id_str),
        )
        .limit(1)
    )
    if msg_result.scalar_one_or_none() is not None:
        return

    from src.utils.errors import ForbiddenError
    raise ForbiddenError("无权访问该文件")


async def get_file(db: AsyncSession, file_id: uuid.UUID) -> File:
    result = await db.execute(select(File).where(File.id == file_id))
    file_record = result.scalar_one_or_none()
    if not file_record:
        raise FileNotFound()
    return file_record


async def get_file_path(db: AsyncSession, file_id: uuid.UUID) -> str:
    file_record = await get_file(db, file_id)
    if not os.path.exists(file_record.storage_path):
        raise FileNotFound()
    return file_record.storage_path
