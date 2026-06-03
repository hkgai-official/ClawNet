#!/usr/bin/env bash
#
# Create the first admin user directly in the database.
#
# Usage:
#   ./scripts/seed-admin.sh <email> <display_name> <password> [env]
#
# Examples:
#   ./scripts/seed-admin.sh admin@example.com "Admin" "strongpass123"
#   ./scripts/seed-admin.sh admin@example.com "Admin" "strongpass123" v1
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -lt 3 ]; then
    echo "Usage: $0 <email> <display_name> <password> [env]"
    echo ""
    echo "  email          Admin login email"
    echo "  display_name   Display name"
    echo "  password       Password (min 6 chars)"
    echo "  env            Optional: .env suffix (e.g. v1)"
    echo ""
    echo "Examples:"
    echo "  $0 admin@example.com \"Admin\" \"strongpass123\""
    echo "  $0 admin@example.com \"Admin\" \"strongpass123\" v1"
    exit 1
fi

EMAIL="$1"
DISPLAY_NAME="$2"
PASSWORD="$3"
ENV_NAME="${4:-}"

if [ ${#PASSWORD} -lt 6 ]; then
    echo "ERROR: Password must be at least 6 characters."
    exit 1
fi

# Determine backend container name
if [[ -n "$ENV_NAME" ]]; then
    ENV_FILE="$SERVER_DIR/.env.${ENV_NAME}"
else
    ENV_FILE="$SERVER_DIR/.env"
fi

if [[ -f "$ENV_FILE" ]]; then
    set -a
    source "$ENV_FILE"
    set +a
fi

PROJECT="${COMPOSE_PROJECT_NAME:-clawnet}"
BACKEND_CONTAINER="${PROJECT}-backend"

echo "=== Creating admin user ==="
echo "  Email:     $EMAIL"
echo "  Name:      $DISPLAY_NAME"
echo "  Container: $BACKEND_CONTAINER"
echo ""

# Check container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${BACKEND_CONTAINER}$"; then
    echo "ERROR: Backend container '$BACKEND_CONTAINER' is not running."
    echo "Start it first: cd $SERVER_DIR && ./clawnet.sh setup${ENV_NAME:+ $ENV_NAME}"
    exit 1
fi

# Create admin user via Python in backend container
docker exec "$BACKEND_CONTAINER" python3 -c "
import asyncio, uuid, sys

async def run():
    from src.database import async_session
    from src.models.user import User
    from src.utils.security import hash_password
    from sqlalchemy import select

    email = sys.argv[1]
    display_name = sys.argv[2]
    password = sys.argv[3]

    async with async_session() as db:
        # Check if email already exists
        result = await db.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()

        if existing:
            if existing.role == 'admin':
                print(f'[OK] Admin user already exists: {email}')
                return
            # Upgrade existing user to admin
            existing.role = 'admin'
            await db.commit()
            print(f'[OK] Upgraded existing user to admin: {email}')
            return

        user = User(
            display_name=display_name,
            email=email,
            password_hash=hash_password(password),
            status='offline',
            role='admin',
            user_code='1000',
        )
        db.add(user)
        await db.commit()
        print(f'[OK] Admin user created: {email} (id={user.id})')

asyncio.run(run())
" "$EMAIL" "$DISPLAY_NAME" "$PASSWORD"

echo ""
echo "=== Done ==="
echo "Login with: email=$EMAIL password=<your_password>"
