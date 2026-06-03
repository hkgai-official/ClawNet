#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# 使用单一镜像启动多个 Clawnet Gateway 容器
# 用法: ./multi-run.sh setup
#
# 所有容器共享同一个 clawnet-v1 镜像，通过不同的后缀区分。
# =============================================================================

# ---- 配置 ----
# 镜像名须与后端 provision 服务的 OPENCLAW_IMAGE_PATTERN 一致 (默认 openclaw-{env}:local)
ENV="${CLAWNET_ENV:-v1}"
IMAGE_NAME="openclaw-${ENV}:local"
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$BASE_DIR/../clawnet-core"
COMPOSE_FILE="$BASE_DIR/docker-compose.yml"

show_help() {
  cat <<EOF
用法: $0 <command> [suffixes...]

命令:
  setup                 构建 Docker 镜像 ($IMAGE_NAME)

示例:
  $0 setup                     # 构建镜像
EOF
}

# 构建 Docker 镜像
build_image() {
  local no_cache="${1:-false}"
  local fix_uid fix_gid
  fix_uid="$(id -u)"
  fix_gid="$(id -g)"

  # 确定 Dockerfile 位置
  local dockerfile=""
  if [[ -f "$BASE_DIR/Dockerfile" ]]; then
    dockerfile="$BASE_DIR/Dockerfile"
  elif [[ -f "$SOURCE_DIR/Dockerfile" ]]; then
    dockerfile="$SOURCE_DIR/Dockerfile"
  else
    echo "错误: 找不到 Dockerfile" >&2
    echo "  检查: $BASE_DIR/Dockerfile 或 $SOURCE_DIR/Dockerfile" >&2
    return 1
  fi

  # 确定源码目录
  if [[ ! -d "$SOURCE_DIR" ]]; then
    echo "错误: 源码目录不存在: $SOURCE_DIR" >&2
    return 1
  fi
  local abs_source_dir
  abs_source_dir="$(cd "$SOURCE_DIR" && pwd)"

  echo "==> 构建镜像: $IMAGE_NAME"
  echo "    Dockerfile: $dockerfile"
  echo "    源码目录:   $abs_source_dir"
  echo "    UID/GID:    $fix_uid/$fix_gid"

  local build_args=(
    --build-arg "NODE_UID=${fix_uid}"
    --build-arg "NODE_GID=${fix_gid}"
    --build-arg "OPENCLAW_DOCKER_APT_PACKAGES=${OPENCLAW_DOCKER_APT_PACKAGES:-}"
    -t "$IMAGE_NAME"
    -f "$dockerfile"
  )

  build_args+=(--no-cache)

  docker build "${build_args[@]}" "$abs_source_dir"

  echo ""
  echo "==> 镜像构建完成: $IMAGE_NAME"
}

# ---- 主逻辑 ----

COMMAND="${1:-}"
shift || true

if [[ -z "$COMMAND" ]]; then
  show_help
  exit 1
fi

case "$COMMAND" in
  setup)
    NO_CACHE=true
    build_image "$NO_CACHE"
    ;;

  --help|-h|help)
    show_help
    ;;

  *)
    echo "未知命令: $COMMAND" >&2
    show_help
    exit 1
    ;;
esac

echo ""
echo "完成！"
