#!/usr/bin/env bash
# =============================================================================
#  ClawNet Backend 管理脚本
#
#  用法:
#    ./clawnet.sh setup   [env]   — 首次初始化（构建镜像 + 启动 + 迁移）
#    ./clawnet.sh rebuild [env]   — 重建容器（复用镜像）+ 迁移
#    ./clawnet.sh migrate [env]   — 仅执行数据库迁移
#    ./clawnet.sh shell   [env]   — 进入后端容器 bash
#    ./clawnet.sh psql    [env]   — 进入 PostgreSQL 交互终端
#    ./clawnet.sh logs    [env]   — 查看后端日志（follow）
#    ./clawnet.sh status  [env]   — 查看容器状态
#    ./clawnet.sh clean   [env]   — 停止并删除容器和数据卷
#
#  [env] 可选，指定 .env 文件名（不含 .env 后缀），默认使用 .env。
#  例如:  ./clawnet.sh setup test   → 使用 .env.test
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ---- 解析参数 ----
CMD="${1:-help}"
ENV_NAME="${2:-}"

if [[ -n "$ENV_NAME" ]]; then
    ENV_FILE=".env.${ENV_NAME}"
else
    ENV_FILE=".env"
fi

# ---- 加载 .env ----
if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
else
    if [[ "$CMD" != "help" && "$CMD" != "init" ]]; then
        echo "[WARN] $ENV_FILE not found, using defaults. Run: cp .env.example $ENV_FILE"
    fi
fi

# ---- 派生变量（从 .env 读到的值或默认值）----
# Docker Compose 未设置 COMPOSE_PROJECT_NAME 时默认用目录名，此处保持一致
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$SCRIPT_DIR")}"
PG_CONTAINER="${PROJECT}-postgres"
REDIS_CONTAINER="${PROJECT}-redis"
BACKEND_CONTAINER="${PROJECT}-backend"
PG_USER="${POSTGRES_USER:-clawnet}"
PG_DB="${POSTGRES_DB:-clawnet}"
BE_PORT="${BACKEND_PORT:-9000}"

DC="docker compose --env-file $ENV_FILE"
# 如果 env 文件不存在，不传 --env-file
if [[ ! -f "$ENV_FILE" ]]; then
    DC="docker compose"
fi

# ---- 工具函数 ----
header() {
    echo ""
    echo "========================================="
    echo "  ClawNet [$PROJECT] — $1"
    echo "========================================="
}

wait_pg() {
    echo "[*] Waiting for PostgreSQL ($PG_CONTAINER) ..."
    for i in $(seq 1 30); do
        if docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" -q 2>/dev/null; then
            echo "    PostgreSQL is ready."
            return 0
        fi
        if [[ "$i" -eq 30 ]]; then
            echo "    ERROR: PostgreSQL did not become ready in time."
            return 1
        fi
        sleep 1
    done
}

run_migrations() {
    echo "[*] Running database migrations ..."
    for sql_file in migrations/*.sql; do
        [[ -f "$sql_file" ]] || continue
        filename=$(basename "$sql_file")
        if [[ "$filename" == "001_initial.sql" ]]; then
            continue
        fi
        echo "    Applying $filename ..."
        docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" < "$sql_file" 2>&1 | \
            grep -v "^$" | sed 's/^/      /' || true
    done
    echo "    Migrations done."
}

show_info() {
    echo ""
    echo "  Backend : http://localhost:${BE_PORT}"
    echo "  Logs    : ./clawnet.sh logs${ENV_NAME:+ $ENV_NAME}"
    echo "  Shell   : ./clawnet.sh shell${ENV_NAME:+ $ENV_NAME}"
    echo "  Stop    : ./clawnet.sh down${ENV_NAME:+ $ENV_NAME}"
    echo ""
}

# ---- 命令实现 ----
case "$CMD" in

setup)
    header "Setup (first time)"
    echo "[1/4] Building & starting containers ..."
    $DC up -d --build
    echo "[2/4] Waiting for services ..."
    wait_pg
    echo "[3/4] Running migrations ..."
    run_migrations
    echo "[4/4] Done!"
    show_info
    ;;

rebuild)
    header "Rebuild (reuse existing image)"
    echo "[1/4] Stopping containers ..."
    $DC down
    echo "[2/4] Starting containers ..."
    $DC up -d
    echo "[3/4] Waiting for services ..."
    wait_pg
    echo "[4/4] Running migrations ..."
    run_migrations
    echo "  Rebuild done!"
    show_info
    ;;

shell)
    header "Shell → $BACKEND_CONTAINER"
    docker exec -it "$BACKEND_CONTAINER" bash
    ;;

psql)
    header "PostgreSQL → $PG_CONTAINER"
    docker exec -it "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB"
    ;;

logs)
    docker logs -f "$BACKEND_CONTAINER"
    ;;

status)
    header "Status"
    echo ""
    echo "  Containers:"
    for c in "$PG_CONTAINER" "$REDIS_CONTAINER" "$BACKEND_CONTAINER"; do
        state=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo "not found")
        printf "    %-30s %s\n" "$c" "$state"
    done
    echo ""
    echo "  Ports:"
    echo "    Backend   : ${BE_PORT}"
    echo "    PostgreSQL: ${POSTGRES_PORT:-5432}"
    echo "    Redis     : ${REDIS_PORT:-6379}"
    echo ""
    echo "  Env file: $ENV_FILE"
    echo "  Project : $PROJECT"
    echo ""
    ;;

clean)
    header "Clean (remove containers + volumes)"
    read -rp "  This will DELETE all data. Continue? [y/N] " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        $DC down -v
        echo "  Cleaned."
    else
        echo "  Cancelled."
    fi
    ;;

init)
    if [[ -f "$ENV_FILE" ]]; then
        echo "[SKIP] $ENV_FILE already exists."
    else
        cp .env.example "$ENV_FILE"
        echo "[OK] Created $ENV_FILE from .env.example"
        echo "     Edit it: vim $ENV_FILE"
    fi
    ;;

help|*)
    cat <<'USAGE'
ClawNet Backend 管理脚本

用法: ./clawnet.sh <command> [env]

命令:
  init    [env]   创建 .env 文件（从 .env.example 复制）
  setup   [env]   首次初始化（构建镜像 + 启动 + 迁移）
  rebuild [env]   重建容器（复用镜像）+ 迁移
  shell   [env]   进入后端容器 bash
  psql    [env]   进入 PostgreSQL 交互终端
  logs    [env]   查看后端日志（follow）
  status  [env]   查看容器状态
  clean   [env]   停止并删除容器和数据卷（危险）
  help            显示此帮助

环境参数:
  [env] 可选，指定使用 .env.<env> 配置文件，默认使用 .env
  例如: ./clawnet.sh setup test  →  使用 .env.test 配置

示例:
  ./clawnet.sh init                # 创建 .env
  ./clawnet.sh init test           # 创建 .env.test
  ./clawnet.sh setup               # 首次部署（默认环境）
  ./clawnet.sh setup test          # 首次部署（test 环境）
  ./clawnet.sh rebuild             # 重建容器（默认环境）
  ./clawnet.sh rebuild test        # 重建 test 环境容器
  ./clawnet.sh shell               # 进入后端容器
  ./clawnet.sh psql test           # 连接 test 环境数据库
USAGE
    ;;

esac
