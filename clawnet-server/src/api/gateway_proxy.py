"""Gateway blob proxy — lets mobile/desktop clients upload/download blobs
through clawnet-server instead of directly accessing the Gateway.

Clients authenticate with their JWT token; the server forwards requests
to the Gateway using the per-user Gateway token internally.
"""

import logging
from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse

import httpx

from src.config import get_gateway_config
from src.dependencies import get_current_user
from src.models.user import User

logger = logging.getLogger("clawnet.gateway_proxy")

router = APIRouter(prefix="/api/v1/gateway", tags=["gateway-proxy"])

MAX_BLOB_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB


def _gateway_http_base(user: User) -> str:
    """Derive the Gateway HTTP base URL from the user's Gateway WS URL."""
    config = get_gateway_config(str(user.id))
    if not config:
        raise HTTPException(status_code=502, detail="No gateway configured for user")
    from urllib.parse import urlparse
    parsed = urlparse(config.ws_url)
    scheme = "https" if parsed.scheme == "wss" else "http"
    return f"{scheme}://{parsed.netloc}"


def _gateway_token(user: User) -> str:
    config = get_gateway_config(str(user.id))
    if not config:
        raise HTTPException(status_code=502, detail="No gateway configured for user")
    return config.token


@router.post("/blobs")
async def upload_blob(request: Request, user: User = Depends(get_current_user)):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_BLOB_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Blob too large (max 100 MB)")

    gw_base = _gateway_http_base(user)
    gw_token = _gateway_token(user)
    gw_url = f"{gw_base}/blobs"

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            body = await request.body()
            if len(body) > MAX_BLOB_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="Blob too large (max 100 MB)")

            resp = await client.post(
                gw_url,
                content=body,
                headers={
                    "Content-Type": "application/octet-stream",
                    "Authorization": f"Bearer {gw_token}",
                },
            )
    except httpx.ConnectError as e:
        logger.error("Gateway blob upload connect error: %s", e)
        raise HTTPException(status_code=502, detail="Gateway unreachable")
    except Exception as e:
        logger.error("Gateway blob upload error: %s", e)
        raise HTTPException(status_code=502, detail="Gateway blob upload failed")

    if resp.status_code != 201:
        logger.warning("Gateway blob upload returned %d: %s", resp.status_code, resp.text[:200])
        raise HTTPException(status_code=resp.status_code, detail="Gateway blob upload failed")

    return JSONResponse(status_code=201, content=resp.json())


@router.get("/blobs/{blob_id}")
async def download_blob(blob_id: str, user: User = Depends(get_current_user)):
    gw_base = _gateway_http_base(user)
    gw_token = _gateway_token(user)
    gw_url = f"{gw_base}/blobs/{blob_id}"

    try:
        client = httpx.AsyncClient(timeout=httpx.Timeout(120.0))
        resp = await client.send(
            client.build_request(
                "GET", gw_url,
                headers={"Authorization": f"Bearer {gw_token}"},
            ),
            stream=True,
        )
    except httpx.ConnectError as e:
        logger.error("Gateway blob download connect error: %s", e)
        raise HTTPException(status_code=502, detail="Gateway unreachable")
    except Exception as e:
        logger.error("Gateway blob download error: %s", e)
        raise HTTPException(status_code=502, detail="Gateway blob download failed")

    if resp.status_code != 200:
        await resp.aclose()
        await client.aclose()
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Blob not found or expired")
        raise HTTPException(status_code=resp.status_code, detail="Gateway blob download failed")

    async def stream_and_close():
        try:
            async for chunk in resp.aiter_bytes(chunk_size=64 * 1024):
                yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(
        stream_and_close(),
        status_code=200,
        media_type="application/octet-stream",
        headers={"Content-Length": resp.headers.get("content-length", "")},
    )
