import uuid
from fastapi import APIRouter, Depends, UploadFile, File as FastAPIFile, Response
from fastapi.responses import FileResponse as FastAPIFileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.file import FileResponse, FileCheckResponse, ChunkUploadResponse, CompleteUploadRequest
from src.schemas.common import ApiResponse
from src.services import file_service

router = APIRouter(prefix="/api/v1/files", tags=["files"])


@router.head("/check/{file_hash}")
async def check_file(
    file_hash: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await file_service.check_file_by_hash(db, file_hash)
    if result.exists:
        return Response(
            status_code=200,
            headers={"X-File-Id": str(result.file_id)},
        )
    return Response(status_code=404)


@router.post("/upload/{file_hash}/chunk", response_model=ApiResponse[ChunkUploadResponse])
async def upload_chunk(
    file_hash: str,
    chunk_index: int,
    file: UploadFile = FastAPIFile(...),
    _: User = Depends(get_current_user),
):
    chunk_data = await file.read()
    result = await file_service.upload_chunk(file_hash, chunk_index, chunk_data)
    return ApiResponse(data=result)


@router.post("/upload/{file_hash}/complete", response_model=ApiResponse[FileResponse])
async def complete_upload(
    file_hash: str,
    req: CompleteUploadRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await file_service.complete_upload(db, user.id, req)
    return ApiResponse(data=result)


@router.post("/upload", response_model=ApiResponse[FileResponse])
async def upload_file(
    file: UploadFile = FastAPIFile(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Simple single-file upload (non-chunked)."""
    import hashlib
    import os
    from pathlib import Path
    from src.config import settings

    content = await file.read()
    file_hash = hashlib.sha256(content).hexdigest()

    # Check if already exists
    check = await file_service.check_file_by_hash(db, file_hash)
    if check.exists:
        existing = await file_service.get_file(db, check.file_id)
        return ApiResponse(data=FileResponse.model_validate(existing))

    # Save file
    final_dir = Path(settings.UPLOAD_DIR) / "files"
    final_dir.mkdir(parents=True, exist_ok=True)

    ext = os.path.splitext(file.filename or "")[1]
    storage_path = final_dir / f"{file_hash}{ext}"
    with open(storage_path, "wb") as f:
        f.write(content)

    from src.models.file import File as FileModel
    file_record = FileModel(
        hash=file_hash,
        name=file.filename or "unknown",
        size=len(content),
        mime_type=file.content_type or "application/octet-stream",
        storage_path=str(storage_path),
        uploaded_by=user.id,
    )
    db.add(file_record)
    await db.flush()

    return ApiResponse(data=FileResponse.model_validate(file_record))


@router.get("/{file_id}", response_model=ApiResponse[FileResponse])
async def get_file_info(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    file_record = await file_service.get_file(db, file_id)
    return ApiResponse(data=FileResponse.model_validate(file_record))


@router.get("/{file_id}/download")
async def download_file(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    file_record = await file_service.get_file(db, file_id)
    await file_service.assert_file_access(db, file_record, user.id)
    file_path = await file_service.get_file_path(db, file_id)
    return FastAPIFileResponse(
        path=file_path,
        filename=file_record.name,
        media_type=file_record.mime_type,
    )


@router.get("/{file_id}/preview")
async def preview_file(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    file_record = await file_service.get_file(db, file_id)
    await file_service.assert_file_access(db, file_record, user.id)
    file_path = await file_service.get_file_path(db, file_id)

    # For images, return the file directly
    if file_record.mime_type.startswith("image/"):
        return FastAPIFileResponse(path=file_path, media_type=file_record.mime_type)

    # For other types, return file info
    return ApiResponse(data=FileResponse.model_validate(file_record))
