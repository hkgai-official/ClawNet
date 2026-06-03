"""
OpenClaw Gateway 容器生命周期管理。

负责：workspace 创建、openclaw.json 渲染、Docker 容器启停、健康检查。
"""

import asyncio
import json
import logging
import os
import re
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import docker
import docker.errors
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user import User

logger = logging.getLogger("clawnet.provision")

# ── Configuration ──

# Container-internal path (for shutil, json operations inside backend container)
WORKSPACES_ROOT = Path(os.getenv("WORKSPACES_ROOT", "/data/workspaces"))
# Host path (for Docker volume mounts — Docker daemon runs on host, not inside backend container)
WORKSPACES_HOST_PATH = os.getenv("WORKSPACES_HOST_PATH", str(WORKSPACES_ROOT))

TEMPLATE_DIR_NAME = "ws-0-template"
OPENCLAW_IMAGE_PATTERN = os.getenv("OPENCLAW_IMAGE_PATTERN", "openclaw-{env}:local")
DEFAULT_GATEWAY_ENV = os.getenv("GATEWAY_ENV", "v1")

# UID/GID for gateway containers (must match host user, not backend container user)
PROVISION_UID = int(os.getenv("PROVISION_UID", os.getenv("FIX_UID", "1001")))
PROVISION_GID = int(os.getenv("PROVISION_GID", os.getenv("FIX_GID", "1001")))

# Port ranges per environment
ENV_PORT_BASE: dict[str, int] = {
    "v1": 20000,
    "prod": 21000,
    "staging": 22000,
}

# Container internal port (fixed by openclaw)
INTERNAL_GATEWAY_PORT = 18789

# Health check host (from inside backend container, use host.docker.internal to reach host ports)
HEALTH_CHECK_HOST = os.getenv("HEALTH_CHECK_HOST", "host.docker.internal")


def make_slug(email: Optional[str], display_name: str) -> str:
    """Generate a short slug from email prefix, fallback to display_name."""
    raw = email.split("@")[0] if email else display_name
    slug = re.sub(r"[^a-z0-9]", "", raw.lower())[:16]
    return slug or "user"


def _container_name(env: str, slug: str, port: int) -> str:
    return f"oc-{env}-{slug}-{port}"


def _workspace_name(env: str, slug: str, port: int) -> str:
    return f"ws-{env}-{slug}-{port}"


def _to_host_path(container_path: Path) -> str:
    """Convert a container-internal workspace path to the corresponding host path.

    Docker daemon runs on the host, so volume mounts must use host paths.
    e.g. /data/workspaces/ws-v1-sara-20001/config
      -> /data/workspaces/ws-v1-sara-20001/config
    """
    relative = container_path.relative_to(WORKSPACES_ROOT)
    return str(Path(WORKSPACES_HOST_PATH) / relative)


def get_workspace_host_path(user) -> str | None:
    """Get the host-visible workspace root path for a user.

    Used to send workspace root to macOS Node app, which operates
    on the host filesystem (not inside the container).
    Returns None if user is not yet provisioned (no gateway_port).
    """
    if user.gateway_port is None:
        return None
    name = _workspace_name(
        user.gateway_env or DEFAULT_GATEWAY_ENV,
        user.slug or "user",
        user.gateway_port,
    )
    container_path = WORKSPACES_ROOT / name / "workspace"
    return _to_host_path(container_path)


class ProvisionService:
    """Manage OpenClaw Gateway container lifecycle."""

    def __init__(self) -> None:
        self._docker: Optional[docker.DockerClient] = None

    @property
    def docker(self) -> docker.DockerClient:
        if self._docker is None:
            self._docker = docker.from_env()
        return self._docker

    # ── Port allocation ──

    async def allocate_port(self, db: AsyncSession, env: str) -> int:
        """Allocate next available port for the given environment.

        Uses a subquery approach to avoid FOR UPDATE with aggregate functions.
        The UNIQUE constraint on gateway_port provides the final safety net
        against concurrent allocation.
        """
        base = ENV_PORT_BASE.get(env)
        if base is None:
            raise ValueError(f"Unknown environment: {env}. Known: {list(ENV_PORT_BASE)}")

        result = await db.execute(
            select(func.coalesce(func.max(User.gateway_port), base))
            .where(User.gateway_env == env)
        )
        max_port = result.scalar()
        return max_port + 1

    # ── Main provision flow ──

    async def provision(self, db: AsyncSession, user: User) -> None:
        """Full provision: create workspace, render config, start container."""
        env = user.gateway_env or DEFAULT_GATEWAY_ENV
        slug = user.slug or "user"
        port = user.gateway_port
        if port is None:
            raise ValueError("User has no gateway_port assigned")

        container_name = _container_name(env, slug, port)
        workspace_name = _workspace_name(env, slug, port)
        workspace_path = WORKSPACES_ROOT / workspace_name
        template_path = WORKSPACES_ROOT / TEMPLATE_DIR_NAME

        try:
            user.gateway_status = "provisioning"
            await db.commit()

            # Step 1: Create workspace from template
            logger.info("Provisioning %s: creating workspace at %s", container_name, workspace_path)
            if workspace_path.exists():
                shutil.rmtree(workspace_path)
            if not template_path.exists():
                raise FileNotFoundError(f"Template not found: {template_path}")
            shutil.copytree(template_path, workspace_path)

            # Step 2: Render openclaw.json (inject gateway token)
            config_file = workspace_path / "config" / "openclaw.json"
            if config_file.exists():
                config = json.loads(config_file.read_text(encoding="utf-8"))
                if "gateway" not in config:
                    config["gateway"] = {}
                config["gateway"]["auth"] = {
                    "mode": "token",
                    "token": user.gateway_token,
                }
                # Allow backend (host.docker.internal) to connect as operator
                cui = config["gateway"].setdefault("controlUi", {})
                origins = cui.get("allowedOrigins", [])
                backend_origin = f"http://host.docker.internal:{user.gateway_port}"
                if backend_origin not in origins:
                    origins.append(backend_origin)
                    cui["allowedOrigins"] = origins
                config_file.write_text(
                    json.dumps(config, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8",
                )
                logger.info("Rendered openclaw.json with gateway token")
            else:
                logger.warning("No openclaw.json in template, skipping render")

            # Step 2.5: Fix ownership (backend runs as root, gateway runs as PROVISION_UID)
            for root_dir, dirs, files in os.walk(workspace_path):
                os.chown(root_dir, PROVISION_UID, PROVISION_GID)
                for f in files:
                    os.chown(os.path.join(root_dir, f), PROVISION_UID, PROVISION_GID)
            logger.info("Fixed workspace ownership to %d:%d", PROVISION_UID, PROVISION_GID)

            # Step 3: Check image exists
            image_name = OPENCLAW_IMAGE_PATTERN.format(env=env)
            try:
                self.docker.images.get(image_name)
            except docker.errors.ImageNotFound:
                raise RuntimeError(
                    f"Docker image '{image_name}' not found. Build it first."
                )

            # Step 4: Remove old container if exists
            try:
                old = self.docker.containers.get(container_name)
                logger.info("Removing existing container %s", container_name)
                old.stop(timeout=10)
                old.remove()
            except docker.errors.NotFound:
                pass

            # Step 5: Start new container
            # Use host paths for Docker volume mounts (Docker daemon runs on host)
            host_config_dir = _to_host_path(workspace_path / "config")
            host_ws_dir = _to_host_path(workspace_path / "workspace")

            self.docker.containers.run(
                image=image_name,
                name=container_name,
                detach=True,
                init=True,
                restart_policy={"Name": "unless-stopped"},
                user=f"{PROVISION_UID}:{PROVISION_GID}",
                ports={f"{INTERNAL_GATEWAY_PORT}/tcp": ("0.0.0.0", port)},
                volumes={
                    host_config_dir: {"bind": "/home/node/.openclaw", "mode": "rw"},
                    host_ws_dir: {"bind": "/home/node/.openclaw/workspace", "mode": "rw"},
                },
                environment={
                    "HOME": "/home/node",
                    "TERM": "xterm-256color",
                    "OPENCLAW_GATEWAY_TOKEN": user.gateway_token,
                    "SERPAPI_API_KEY": os.environ.get("SERPAPI_API_KEY", ""),
                    "GOG_KEYRING_PASSWORD": "clawnet",
                },
                command=[
                    "sh", "-c",
                    f"node dist/index.js gateway --bind lan --port {INTERNAL_GATEWAY_PORT}",
                ],
                labels={
                    "oc.env": env,
                    "oc.user_id": str(user.id),
                    "oc.user_name": user.display_name,
                    "oc.email": user.email or "",
                    "oc.port": str(port),
                },
            )
            logger.info("Container %s started on port %d", container_name, port)

            # Step 6: Health check
            await self._wait_healthy(port, timeout=30)
            logger.info("Container %s is healthy", container_name)

            # Step 7: Update status
            user.gateway_status = "running"
            user.provisioned_at = datetime.now(timezone.utc)
            await db.commit()

        except Exception:
            logger.exception("Provision failed for %s", container_name)
            user.gateway_status = "error"
            await db.commit()
            raise

    # ── Lifecycle operations ──

    async def stop(self, db: AsyncSession, user: User) -> None:
        """Stop user's gateway container."""
        name = self._get_container_name(user)
        try:
            container = self.docker.containers.get(name)
            container.stop(timeout=10)
            logger.info("Stopped container %s", name)
        except docker.errors.NotFound:
            logger.warning("Container %s not found", name)
        user.gateway_status = "stopped"
        await db.commit()

    async def restart(self, db: AsyncSession, user: User) -> None:
        """Restart user's gateway container."""
        name = self._get_container_name(user)
        try:
            container = self.docker.containers.get(name)
            container.restart(timeout=10)
            logger.info("Restarted container %s", name)
            await self._wait_healthy(user.gateway_port, timeout=30)
            user.gateway_status = "running"
            user.provisioned_at = datetime.now(timezone.utc)
        except docker.errors.NotFound:
            logger.info("Container %s not found, running full provision", name)
            await self.provision(db, user)
            return
        await db.commit()

    async def rebuild(self, db: AsyncSession, user: User) -> None:
        """Rebuild container with new command without touching workspace data."""
        env = user.gateway_env or DEFAULT_GATEWAY_ENV
        slug = user.slug or "user"
        port = user.gateway_port
        if port is None:
            raise ValueError("User has no gateway_port assigned")

        container_name = _container_name(env, slug, port)
        workspace_path = WORKSPACES_ROOT / _workspace_name(env, slug, port)
        image_name = OPENCLAW_IMAGE_PATTERN.format(env=env)
        host_config_dir = _to_host_path(workspace_path / "config")
        host_ws_dir = _to_host_path(workspace_path / "workspace")

        # Remove old container
        try:
            old = self.docker.containers.get(container_name)
            old.stop(timeout=10)
            old.remove()
            logger.info("Removed old container %s", container_name)
        except docker.errors.NotFound:
            pass

        # Start new container (same config, new command)
        self.docker.containers.run(
            image=image_name,
            name=container_name,
            detach=True,
            init=True,
            restart_policy={"Name": "unless-stopped"},
            user=f"{PROVISION_UID}:{PROVISION_GID}",
            ports={f"{INTERNAL_GATEWAY_PORT}/tcp": ("0.0.0.0", port)},
            volumes={
                host_config_dir: {"bind": "/home/node/.openclaw", "mode": "rw"},
                host_ws_dir: {"bind": "/home/node/.openclaw/workspace", "mode": "rw"},
            },
            environment={
                "HOME": "/home/node",
                "TERM": "xterm-256color",
                "OPENCLAW_GATEWAY_TOKEN": user.gateway_token,
                "SERPAPI_API_KEY": os.environ.get("SERPAPI_API_KEY", ""),
                "GOG_KEYRING_PASSWORD": "clawnet",
            },
            command=[
                "sh", "-c",
                f"node dist/index.js gateway --bind lan --port {INTERNAL_GATEWAY_PORT}",
            ],
            labels={
                "oc.env": env,
                "oc.user_id": str(user.id),
                "oc.user_name": user.display_name,
                "oc.email": user.email or "",
                "oc.port": str(port),
            },
        )
        logger.info("Rebuilt container %s on port %d (no browser)", container_name, port)
        await self._wait_healthy(port, timeout=30)
        user.gateway_status = "running"
        user.provisioned_at = datetime.now(timezone.utc)
        await db.commit()

    async def destroy(self, db: AsyncSession, user: User) -> None:
        """Stop container and remove workspace."""
        name = self._get_container_name(user)

        # Stop and remove container
        try:
            container = self.docker.containers.get(name)
            container.stop(timeout=10)
            container.remove()
            logger.info("Removed container %s", name)
        except docker.errors.NotFound:
            pass

        # Remove workspace
        workspace_path = self._get_workspace_path(user)
        if workspace_path.exists():
            shutil.rmtree(workspace_path)
            logger.info("Removed workspace %s", workspace_path)

        user.gateway_status = "pending"
        user.gateway_port = None
        user.provisioned_at = None
        await db.commit()

    # ── Helpers ──

    def _get_container_name(self, user: User) -> str:
        return _container_name(
            user.gateway_env or DEFAULT_GATEWAY_ENV,
            user.slug or "user",
            user.gateway_port,
        )

    def _get_workspace_path(self, user: User) -> Path:
        name = _workspace_name(
            user.gateway_env or DEFAULT_GATEWAY_ENV,
            user.slug or "user",
            user.gateway_port,
        )
        return WORKSPACES_ROOT / name

    async def _wait_healthy(self, port: int, timeout: int = 30) -> None:
        """Poll until the gateway WebSocket port is reachable."""
        import websockets

        deadline = asyncio.get_event_loop().time() + timeout
        last_error = None
        while asyncio.get_event_loop().time() < deadline:
            try:
                async with asyncio.timeout(3):
                    async with websockets.connect(f"ws://{HEALTH_CHECK_HOST}:{port}"):
                        return
            except Exception as e:
                last_error = e
                await asyncio.sleep(1)
        raise TimeoutError(
            f"Gateway port {port} not reachable after {timeout}s: {last_error}"
        )

    def get_container_status(self, user: User) -> Optional[str]:
        """Get actual Docker container status (running, exited, etc.)."""
        try:
            name = self._get_container_name(user)
            container = self.docker.containers.get(name)
            return container.status
        except docker.errors.NotFound:
            return None
