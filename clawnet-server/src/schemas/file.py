from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid


class FileResponse(BaseModel):
    id: uuid.UUID
    hash: str
    name: str
    size: int
    mime_type: str
    storage_path: str
    uploaded_by: Optional[uuid.UUID] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class FileCheckResponse(BaseModel):
    exists: bool
    file_id: Optional[uuid.UUID] = None


class ChunkUploadResponse(BaseModel):
    chunk_index: int
    received: bool


class CompleteUploadRequest(BaseModel):
    hash: str
    name: str
    size: int
    mime_type: str
    total_chunks: int
