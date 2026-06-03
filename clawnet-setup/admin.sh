#!/usr/bin/env bash
#
# ClawNet Admin CLI — 用户管理 + Gateway 容器生命周期
#
# 用法:
#   ./admin.sh login                                    登录管理员账号
#   ./admin.sh user list                                列出所有用户
#   ./admin.sh user create <email> <name> <password>    创建用户并自动 provision
#   ./admin.sh user get <email>                         查看用户详情
#   ./admin.sh user provision <email>                   手动触发 provision
#   ./admin.sh user restart <email>                     重启容器
#   ./admin.sh user stop <email>                        停止容器（需确认）
#   ./admin.sh user delete <email>                      删除用户（需确认）
#   ./admin.sh status                                   总览所有容器状态
#   ./admin.sh deploy                                   仅滚动重启所有容器
#
set -euo pipefail

# ── Configuration ──

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN_FILE="$HOME/.clawnet-admin-token"

# Environment → Backend URL mapping
declare -A ENV_BACKEND=(
    ["v1"]="http://localhost:9000"
)

DEFAULT_ENV="v1"

# ── Parse global options ──

ENV="${CLAWNET_ENV:-$DEFAULT_ENV}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --env)
            ENV="$2"
            shift 2
            ;;
        *)
            break
            ;;
    esac
done

BACKEND_URL="${ENV_BACKEND[$ENV]:-}"
if [[ -z "$BACKEND_URL" ]]; then
    echo "ERROR: Unknown environment '$ENV'. Known: ${!ENV_BACKEND[*]}"
    exit 1
fi

CMD="${1:-help}"
shift || true

# ── Helpers ──

_check_deps() {
    for cmd in curl jq; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            echo "ERROR: '$cmd' is required but not found."
            exit 1
        fi
    done
}

_save_token() {
    local token="$1" email="$2" expires_at="$3"
    cat > "$TOKEN_FILE" <<EOF
ADMIN_TOKEN=$token
ADMIN_EMAIL=$email
ADMIN_ENV=$ENV
BACKEND_URL=$BACKEND_URL
EXPIRES_AT=$expires_at
EOF
    chmod 600 "$TOKEN_FILE"
}

_load_token() {
    if [[ ! -f "$TOKEN_FILE" ]]; then
        echo "ERROR: Not logged in. Run: ./admin.sh login"
        exit 1
    fi
    source "$TOKEN_FILE"

    # Check expiry
    local now
    now=$(date +%s)
    if [[ "$now" -ge "${EXPIRES_AT:-0}" ]]; then
        echo "ERROR: Token expired. Run: ./admin.sh login"
        rm -f "$TOKEN_FILE"
        exit 1
    fi

    # Use saved backend URL if env matches
    if [[ "${ADMIN_ENV:-}" == "$ENV" && -n "${BACKEND_URL:-}" ]]; then
        BACKEND_URL="${BACKEND_URL}"
    fi
}

_api() {
    # Usage: _api METHOD /path [data]
    local method="$1" path="$2" data="${3:-}"
    local url="${BACKEND_URL}${path}"
    local args=(-s -w "\n%{http_code}" -H "Authorization: Bearer ${ADMIN_TOKEN}" -H "Content-Type: application/json")

    if [[ -n "$data" ]]; then
        args+=(-d "$data")
    fi

    local response
    response=$(curl "${args[@]}" -X "$method" "$url")

    local body http_code
    http_code=$(echo "$response" | tail -1)
    body=$(echo "$response" | sed '$d')

    if [[ "$http_code" -ge 400 ]]; then
        local detail
        detail=$(echo "$body" | jq -r '.detail // .message // "Unknown error"' 2>/dev/null || echo "$body")
        echo "ERROR ($http_code): $detail" >&2
        return 1
    fi

    echo "$body"
}

_find_user_id_by_email() {
    local email="$1"
    local response
    response=$(_api GET "/api/v1/admin/users") || exit 1
    local user_id
    user_id=$(echo "$response" | jq -r --arg email "$email" '.data[] | select(.email == $email) | .id' 2>/dev/null)
    if [[ -z "$user_id" || "$user_id" == "null" ]]; then
        echo "ERROR: User with email '$email' not found."
        exit 1
    fi
    echo "$user_id"
}

_show_help() {
    cat <<'HELP'
ClawNet Admin CLI

用法: ./admin.sh [--env ENV] <command> [args...]

命令:
  login                                    登录管理员账号
  user list                                列出所有用户及 gateway 状态
  user create <email> <name> <password>    创建用户并自动 provision
  user get <email>                         查看用户详情
  user provision <email>                   手动触发 provision
  user restart <email>                     重启容器
  user stop <email>                        停止容器（需密码确认）
  user delete <email>                      删除用户（需密码确认）
  status                                   总览所有 OpenClaw 容器状态
  deploy                                   仅滚动重启所有容器（使用已有镜像）

选项:
  --env ENV    指定环境 (默认: v1)

示例:
  ./admin.sh login
  ./admin.sh user list
  ./admin.sh user create sara@hk.com "Sara" "pass123"
  ./admin.sh deploy                               # 仅重启容器（不重建镜像）
  ./admin.sh --env prod user list
HELP
}

# ── Commands ──

cmd_login() {
    echo "=== Admin Login ($ENV) ==="
    echo "Backend: $BACKEND_URL"
    echo ""

    read -rp "Admin email: " email
    read -rsp "Admin password: " password
    echo ""

    local response body http_code
    response=$(curl -s -w "\n%{http_code}" -X POST "${BACKEND_URL}/api/v1/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"$email\", \"password\": \"$password\"}")

    http_code=$(echo "$response" | tail -1)
    body=$(echo "$response" | sed '$d')

    if [[ "$http_code" -ge 400 ]]; then
        echo "ERROR: Login failed (HTTP $http_code)"
        echo "$body" | jq -r '.detail // "Unknown error"' 2>/dev/null || echo "$body"
        exit 1
    fi

    local token
    token=$(echo "$body" | jq -r '.data.tokens.access_token')
    if [[ -z "$token" || "$token" == "null" ]]; then
        echo "ERROR: No access token in response"
        exit 1
    fi

    # Verify admin role by checking user list endpoint
    local check_response check_code
    check_response=$(curl -s -w "\n%{http_code}" -X GET "${BACKEND_URL}/api/v1/admin/users" \
        -H "Authorization: Bearer $token")
    check_code=$(echo "$check_response" | tail -1)

    if [[ "$check_code" == "403" ]]; then
        echo "ERROR: User '$email' is not an admin."
        exit 1
    fi

    if [[ "$check_code" -ge 400 ]]; then
        echo "ERROR: Admin verification failed (HTTP $check_code)"
        exit 1
    fi

    # Token expires in 1 hour (3600s)
    local expires_at
    expires_at=$(( $(date +%s) + 3600 ))
    _save_token "$token" "$email" "$expires_at"

    echo ""
    echo "Logged in as $email"
    echo "Token saved to $TOKEN_FILE (expires in 1 hour)"
}

cmd_user_list() {
    _load_token
    local response
    response=$(_api GET "/api/v1/admin/users") || exit 1

    echo ""
    echo "=== Users ($ENV) ==="
    echo ""
    printf "%-36s  %-12s  %-6s  %-5s  %-12s  %-24s\n" \
        "ID" "SLUG" "ROLE" "PORT" "GW_STATUS" "EMAIL"
    printf "%s\n" "$(printf '%.0s-' {1..120})"

    echo "$response" | jq -r '.data[] | "\(.id)  \(.slug // "-"|.[0:12])  \(.role|.[0:6])  \(.gateway_port // "-"|tostring|.[0:5])  \(.gateway_status // "-"|.[0:12])  \(.email // "-")"'
    echo ""
}

cmd_user_create() {
    if [[ $# -lt 3 ]]; then
        echo "Usage: ./admin.sh user create <email> <display_name> <password>"
        exit 1
    fi
    _load_token
    local email="$1" name="$2" password="$3"

    echo "=== Creating user ==="
    echo "  Email: $email"
    echo "  Name:  $name"
    echo "  Env:   $ENV"
    echo ""

    local response
    response=$(_api POST "/api/v1/admin/users" \
        "{\"email\": \"$email\", \"display_name\": \"$name\", \"password\": \"$password\", \"env\": \"$ENV\"}") || exit 1

    local port slug
    port=$(echo "$response" | jq -r '.data.gateway_port')
    slug=$(echo "$response" | jq -r '.data.slug')

    echo "User created!"
    echo "  Port:      $port"
    echo "  Slug:      $slug"
    echo "  Container: oc-${ENV}-${slug}-${port}"
    echo ""
    echo "Provisioning in progress... Polling status:"

    # Poll until running or error
    local user_id
    user_id=$(echo "$response" | jq -r '.data.id')
    for i in $(seq 1 60); do
        sleep 2
        local status_resp
        status_resp=$(_api GET "/api/v1/admin/users/${user_id}") || continue
        local gw_status
        gw_status=$(echo "$status_resp" | jq -r '.data.gateway_status')
        printf "  [%02d] gateway_status = %s\n" "$i" "$gw_status"

        if [[ "$gw_status" == "running" ]]; then
            echo ""
            echo "Container is running!"
            echo "  Gateway: ws://host:${port}"
            echo "  Login:   email=$email password=<provided>"
            return 0
        fi
        if [[ "$gw_status" == "error" ]]; then
            echo ""
            echo "ERROR: Provision failed. Check backend logs."
            return 1
        fi
    done
    echo ""
    echo "TIMEOUT: Provision did not complete in 120s. Check backend logs."
    return 1
}

cmd_user_get() {
    if [[ $# -lt 1 ]]; then
        echo "Usage: ./admin.sh user get <email>"
        exit 1
    fi
    _load_token
    local user_id
    user_id=$(_find_user_id_by_email "$1")

    local response
    response=$(_api GET "/api/v1/admin/users/${user_id}") || exit 1
    echo "$response" | jq '.data'
}

cmd_user_provision() {
    if [[ $# -lt 1 ]]; then
        echo "Usage: ./admin.sh user provision <email>"
        exit 1
    fi
    _load_token
    local user_id
    user_id=$(_find_user_id_by_email "$1")

    _api POST "/api/v1/admin/users/${user_id}/provision" || exit 1
    echo "Provision triggered for $1"
}

cmd_user_restart() {
    if [[ $# -lt 1 ]]; then
        echo "Usage: ./admin.sh user restart <email>"
        exit 1
    fi
    _load_token
    local user_id
    user_id=$(_find_user_id_by_email "$1")

    local response
    response=$(_api POST "/api/v1/admin/users/${user_id}/restart") || exit 1
    echo "$response" | jq -r '.data.message'
}

cmd_user_stop() {
    if [[ $# -lt 1 ]]; then
        echo "Usage: ./admin.sh user stop <email>"
        exit 1
    fi
    _load_token
    local user_id
    user_id=$(_find_user_id_by_email "$1")

    echo "Stopping container for $1"
    read -rsp "Admin password to confirm: " admin_pass
    echo ""

    _api POST "/api/v1/admin/users/${user_id}/stop" \
        "{\"admin_password\": \"$admin_pass\"}" || exit 1
    echo "Container stopped."
}

cmd_user_delete() {
    if [[ $# -lt 1 ]]; then
        echo "Usage: ./admin.sh user delete <email>"
        exit 1
    fi
    _load_token
    local email="$1"
    local user_id
    user_id=$(_find_user_id_by_email "$email")

    # Show user info
    local info
    info=$(_api GET "/api/v1/admin/users/${user_id}") || exit 1
    local container_name gw_status
    container_name=$(echo "$info" | jq -r '.data.container_name // "none"')
    gw_status=$(echo "$info" | jq -r '.data.gateway_status // "none"')

    echo ""
    echo "WARNING: About to DELETE user permanently"
    echo "  Email:     $email"
    echo "  Container: $container_name"
    echo "  Status:    $gw_status"
    echo ""
    read -rsp "Admin password to confirm: " admin_pass
    echo ""

    _api DELETE "/api/v1/admin/users/${user_id}" \
        "{\"admin_password\": \"$admin_pass\"}" || exit 1
    echo "User $email deleted."
}


cmd_deploy() {
    local image="openclaw-${ENV}:local"

    echo "=== Rolling restart all gateway containers ($ENV) ==="
    echo "  Image: $image"
    echo ""

    # Get all running containers for this env
    local containers
    containers=$(docker ps -a --filter "label=oc.env=$ENV" --format "{{.Names}}" 2>/dev/null)

    if [[ -z "$containers" ]]; then
        echo "No containers found for env=$ENV"
        return 0
    fi

    local total=0 success=0 failed=0
    while read -r name; do
        [[ -z "$name" ]] && continue
        total=$((total + 1))

        # Extract labels from existing container
        local user_name user_email user_id port
        user_name=$(docker inspect "$name" --format '{{index .Config.Labels "oc.user_name"}}' 2>/dev/null)
        user_email=$(docker inspect "$name" --format '{{index .Config.Labels "oc.email"}}' 2>/dev/null)
        user_id=$(docker inspect "$name" --format '{{index .Config.Labels "oc.user_id"}}' 2>/dev/null)
        port=$(docker inspect "$name" --format '{{index .Config.Labels "oc.port"}}' 2>/dev/null)

        # Extract volume mounts from existing container
        local config_mount ws_mount gateway_token
        config_mount=$(docker inspect "$name" --format '{{range .Mounts}}{{if eq .Destination "/home/node/.openclaw"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)
        ws_mount=$(docker inspect "$name" --format '{{range .Mounts}}{{if eq .Destination "/home/node/.openclaw/workspace"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)
        # Read token from host config file (config_mount is the host path for /home/node/.openclaw)
        local config_json="${config_mount}/openclaw.json"
        gateway_token=""
        if [[ -f "$config_json" ]]; then
            gateway_token=$(jq -r '.gateway.auth.token // empty' "$config_json" 2>/dev/null)
        fi
        if [[ -z "$gateway_token" ]]; then
            gateway_token=$(docker inspect "$name" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^OPENCLAW_GATEWAY_TOKEN=' | head -1 | cut -d= -f2-)
        fi

        if [[ -z "$port" || -z "$config_mount" ]]; then
            echo "  [$name] SKIP: missing port or mount info"
            failed=$((failed + 1))
            continue
        fi

        echo -n "  [$name] stopping..."
        docker stop "$name" -t 10 >/dev/null 2>&1
        docker rm "$name" >/dev/null 2>&1
        echo -n " recreating..."

        local uid gid
        uid=$(id -u)
        gid=$(id -g)

        if docker run -d --init \
            --name "$name" \
            --restart unless-stopped \
            --user "${uid}:${gid}" \
            -p "0.0.0.0:${port}:18789" \
            -v "${config_mount}:/home/node/.openclaw:rw" \
            -v "${ws_mount}:/home/node/.openclaw/workspace:rw" \
            -e "HOME=/home/node" \
            -e "TERM=xterm-256color" \
            -e "OPENCLAW_GATEWAY_TOKEN=${gateway_token}" \
            -l "oc.env=${ENV}" \
            -l "oc.user_id=${user_id}" \
            -l "oc.user_name=${user_name}" \
            -l "oc.email=${user_email}" \
            -l "oc.port=${port}" \
            "$image" \
            node dist/index.js gateway --bind lan --port 18789 \
            >/dev/null 2>&1; then
            echo " OK"
            success=$((success + 1))
        else
            echo " FAILED"
            failed=$((failed + 1))
        fi
    done <<< "$containers"

    echo ""
    echo "Done: $success/$total succeeded, $failed failed"
}

cmd_status() {
    echo "=== OpenClaw Containers ($ENV) ==="
    echo ""
    docker ps -a --filter "label=oc.env=$ENV" \
        --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Label \"oc.user_name\"}}\t{{.Label \"oc.email\"}}" 2>/dev/null \
        || docker ps -a --filter "name=oc-${ENV}" \
            --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
}

# ── Main dispatch ──

_check_deps

case "$CMD" in
    login)
        cmd_login
        ;;
    user)
        SUBCMD="${1:-list}"
        shift || true
        case "$SUBCMD" in
            list)     cmd_user_list "$@" ;;
            create)   cmd_user_create "$@" ;;
            get)      cmd_user_get "$@" ;;
            provision) cmd_user_provision "$@" ;;
            restart)  cmd_user_restart "$@" ;;
            stop)     cmd_user_stop "$@" ;;
            delete)   cmd_user_delete "$@" ;;
            *)
                echo "Unknown user command: $SUBCMD"
                _show_help
                exit 1
                ;;
        esac
        ;;
    deploy)
        cmd_deploy
        ;;
    status)
        cmd_status
        ;;
    help|--help|-h)
        _show_help
        ;;
    *)
        echo "Unknown command: $CMD"
        _show_help
        exit 1
        ;;
esac
