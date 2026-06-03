#!/usr/bin/env python3
"""
OpenClaw Gateway WebSocket test client. 

What it does:
1) Connect to gateway websocket
2) Receive connect.challenge
3) Send connect request (with token, and optional device identity)
4) If connected, send chat.send with your message
5) Print all responses/events

Quick start:
  cd backend
  python tests/test_gateway_ws.py --url ws://localhost:18891 --token YOUR_TOKEN

If NOT_PAIRED:
  - script prints requestId
  - approve from your docker CLI, then run again
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit

import websockets
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519


DEFAULT_URL = os.environ.get("OPENCLAW_WS_URL", "ws://localhost:18891")
DEFAULT_TOKEN = os.environ.get("OPENCLAW_TOKEN", "")
DEFAULT_MSG = "你好"
DEFAULT_SESSION = "main"
DEFAULT_IDENTITY_FILE = ".openclaw_ws_identity.json"


def b64u_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def b64u_decode(text: str) -> bytes:
    padded = text + "=" * ((4 - len(text) % 4) % 4)
    return base64.urlsafe_b64decode(padded.encode("utf-8"))


def add_query(url: str, key: str, value: str) -> str:
    parts = urlsplit(url)
    items: dict[str, str] = {}
    if parts.query:
        for p in parts.query.split("&"):
            if not p:
                continue
            if "=" in p:
                k, v = p.split("=", 1)
                items[k] = v
            else:
                items[p] = ""
    items[key] = value
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(items), parts.fragment))


def ensure_gatewaytoken(url: str, token: str) -> str:
    if "gatewaytoken=" in (urlsplit(url).query or ""):
        return url
    return add_query(url, "gatewaytoken", token)


def resolve_identity_path(raw: str) -> Path:
    p = Path(raw)
    if p.is_absolute():
        return p
    return Path(__file__).resolve().parent / p


def load_or_create_identity(path: Path) -> dict[str, str]:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        for key in ("device_id", "private_key_b64u", "public_key_b64u"):
            if key not in data:
                raise ValueError(f"Identity file missing key: {key}")
        return {
            "device_id": data["device_id"],
            "private_key_b64u": data["private_key_b64u"],
            "public_key_b64u": data["public_key_b64u"],
        }

    sk = ed25519.Ed25519PrivateKey.generate()
    pk = sk.public_key()
    sk_raw = sk.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pk_raw = pk.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    data = {
        "device_id": hashlib.sha256(pk_raw).hexdigest(),
        "private_key_b64u": b64u_encode(sk_raw),
        "public_key_b64u": b64u_encode(pk_raw),
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except Exception:
        pass
    return data


def build_auth_payload(
    *,
    device_id: str,
    client_id: str,
    client_mode: str,
    role: str,
    scopes: list[str],
    signed_at_ms: int,
    token: str,
    nonce: str,
) -> str:
    # Gateway v2 payload (nonce included)
    return "|".join(
        [
            "v2",
            device_id,
            client_id,
            client_mode,
            role,
            ",".join(scopes),
            str(signed_at_ms),
            token or "",
            nonce,
        ]
    )


def build_connect_req(
    *,
    nonce: str,
    token: str,
    client_id: str,
    client_mode: str,
    role: str,
    scopes: list[str],
    identity: dict[str, str] | None,
) -> dict[str, Any]:
    signed_at_ms = int(time.time() * 1000)
    req_id = f"req-{uuid.uuid4()}"
    params: dict[str, Any] = {
        "minProtocol": 3,
        "maxProtocol": 3,
        "client": {
            "id": client_id,
            "version": "0.1.0",
            "platform": "python",
            "mode": client_mode,
        },
        "role": role,
        "scopes": scopes,
        "caps": [],
        "commands": [],
        "permissions": {},
        "auth": {"token": token},
        "locale": "zh-CN",
        "userAgent": "clawnet-openclaw-ws-test/0.1.0",
    }

    if identity is not None:
        sk = ed25519.Ed25519PrivateKey.from_private_bytes(b64u_decode(identity["private_key_b64u"]))
        payload = build_auth_payload(
            device_id=identity["device_id"],
            client_id=client_id,
            client_mode=client_mode,
            role=role,
            scopes=scopes,
            signed_at_ms=signed_at_ms,
            token=token,
            nonce=nonce,
        )
        signature = b64u_encode(sk.sign(payload.encode("utf-8")))
        params["device"] = {
            "id": identity["device_id"],
            "publicKey": identity["public_key_b64u"],
            "signature": signature,
            "signedAt": signed_at_ms,
            "nonce": nonce,
        }

    return {
        "type": "req",
        "id": req_id,
        "method": "connect",
        "params": params,
    }


def extract_request_id(err: dict[str, Any]) -> str | None:
    details = err.get("details")
    if isinstance(details, dict):
        rid = details.get("requestId")
        if isinstance(rid, str) and rid:
            return rid
        nested = details.get("details")
        if isinstance(nested, dict):
            rid2 = nested.get("requestId")
            if isinstance(rid2, str) and rid2:
                return rid2
    return None


async def recv_json(ws, timeout: float) -> dict[str, Any] | None:
    try:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
    except asyncio.TimeoutError:
        return None
    if not isinstance(raw, str):
        return None
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        print(f"[RECV-TEXT] {raw}")
        return None
    print(f"[RECV-JSON] {json.dumps(obj, ensure_ascii=False)}")
    return obj


async def run(args: argparse.Namespace) -> int:
    if not args.token:
        print("ERROR: --token is required (or set OPENCLAW_TOKEN env var)")
        return 1

    url = ensure_gatewaytoken(args.url, args.token)
    headers: dict[str, str] | None = None
    if args.origin:
        headers = {"Origin": args.origin}

    identity = None
    args.no_device = True

    print(f"WS URL: {url}")
    if headers:
        print(f"Headers: {headers}")

    try:
        async with websockets.connect(
            url,
            additional_headers=headers,
            open_timeout=8,
            ping_interval=20,
        ) as ws:
            print("Connected.")

            challenge = await recv_json(ws, timeout=6)
            if not challenge:
                print("No connect.challenge received.")
                return 2
            if challenge.get("type") != "event" or challenge.get("event") != "connect.challenge":
                print("First frame is not connect.challenge.")
                return 2
            payload = challenge.get("payload") or {}
            nonce = payload.get("nonce")
            if not isinstance(nonce, str) or not nonce:
                print("Challenge nonce missing.")
                return 2

            connect_req = build_connect_req(
                nonce=nonce,
                token=args.token,
                client_id=args.client_id,
                client_mode=args.client_mode,
                role=args.role,
                scopes=args.scopes,
                identity=identity,
            )
            connect_id = connect_req["id"]
            await ws.send(json.dumps(connect_req, ensure_ascii=False))
            print(f"[SEND] connect id={connect_id}")

            connect_res = None
            deadline = asyncio.get_event_loop().time() + 10
            while asyncio.get_event_loop().time() < deadline:
                msg = await recv_json(ws, timeout=2)
                if not msg:
                    continue
                if msg.get("type") == "res" and msg.get("id") == connect_id:
                    connect_res = msg
                    break

            if not connect_res:
                print("No connect response.")
                return 2

            if not connect_res.get("ok"):
                err = connect_res.get("error") or {}
                code = err.get("code")
                message = err.get("message")
                print(f"Connect rejected: code={code}, message={message}")
                req_id = extract_request_id(err)
                if req_id:
                    print(f"Pairing requestId: {req_id}")
                    print(
                        f"Approve with: openclaw-cli devices approve {req_id} "
                        f"--url <gateway-internal-url> --token {args.token}"
                    )
                return 3

            print("Handshake success.")

            if args.message:
                chat_id = f"chat-{uuid.uuid4()}"
                chat_req = {
                    "type": "req",
                    "id": chat_id,
                    "method": "chat.send",
                    "params": {
                        "sessionKey": args.session_key,
                        "message": args.message,
                        "deliver": True,
                        "idempotencyKey": f"idem-{uuid.uuid4()}",
                    },
                }
                await ws.send(json.dumps(chat_req, ensure_ascii=False))
                print(f"[SEND] chat.send id={chat_id} message={args.message}")

            end = asyncio.get_event_loop().time() + args.wait_seconds
            while asyncio.get_event_loop().time() < end:
                _ = await recv_json(ws, timeout=2)
            print("Done.")
            return 0
    except Exception as e:
        print(f"Failed: {type(e).__name__}: {e}")
        return 5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OpenClaw websocket test script")
    parser.add_argument("--url", default=DEFAULT_URL, help="Gateway websocket URL")
    parser.add_argument("--token", default=DEFAULT_TOKEN, help="Gateway token (required)")
    parser.add_argument("--message", default=DEFAULT_MSG, help="Message for chat.send")
    parser.add_argument("--session-key", default=DEFAULT_SESSION, help="chat.send sessionKey")
    parser.add_argument("--wait-seconds", type=float, default=12.0, help="Wait time for events")

    parser.add_argument("--client-id", default="gateway-client", help="connect.params.client.id")
    parser.add_argument("--client-mode", default="backend", help="connect.params.client.mode")
    parser.add_argument("--role", default="operator", help="connect.params.role")
    parser.add_argument(
        "--scopes",
        nargs="+",
        default=["operator.admin"],
        help="connect.params.scopes, e.g. --scopes operator.read operator.write",
    )

    parser.add_argument("--origin", default="", help="Optional Origin header")
    parser.add_argument("--no-device", action="store_true", help="Do not send connect.params.device")
    parser.add_argument(
        "--identity-file",
        default=DEFAULT_IDENTITY_FILE,
        help="Identity file path (relative to backend/ or absolute path)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run(parse_args())))
