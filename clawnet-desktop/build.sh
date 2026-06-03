#!/usr/bin/env bash
#
# build.sh — one-shot build script for ClawNet
#
# Usage:
#   bash build.sh mac           # macOS, arm64 (Apple Silicon — default)
#   bash build.sh mac x64       # macOS, Intel
#   bash build.sh win           # Windows, x64 (default)
#   bash build.sh win ia32      # Windows, 32-bit (rarely needed)
#
# Arch default depends on target — mac defaults to arm64 since modern
# Macs are Apple Silicon; win defaults to x64.
#
# What it does (in order):
#   1. rm -rf build out                    — clean BOTH artefact dirs (was the
#                                            bug: `rm -rf build` alone leaves
#                                            stale out/ from a previous source
#                                            checkout, and electron-builder
#                                            re-packages that stale out/).
#   2. pnpm rebuild:electron               — better-sqlite3 ABI for Electron
#   3. pnpm build                          — electron-vite build → out/
#   4. pnpm electron-builder --<target>    — package out/ → build/dist/

set -euo pipefail

TARGET="${1:-}"

if [[ "$TARGET" != "mac" && "$TARGET" != "win" ]]; then
  echo "Usage: bash $0 <mac|win> [arch]"
  echo "  mac → arm64 default (also accepts x64)"
  echo "  win → x64 default (also accepts ia32)"
  exit 1
fi

# Pick a sensible default arch per target if the caller didn't say.
if [[ -n "${2:-}" ]]; then
  ARCH="$2"
elif [[ "$TARGET" == "mac" ]]; then
  ARCH="arm64"
else
  ARCH="x64"
fi

case "$ARCH" in
  x64|arm64|ia32) ;;
  *)
    echo "Unsupported arch: $ARCH (allowed: x64, arm64, ia32)"
    exit 1
    ;;
esac

cd "$(dirname "$0")"

echo "==> 1/4  cleaning build/ + out/"
rm -rf build out

echo "==> 2/4  rebuilding native modules for Electron ABI"
pnpm rebuild:electron

echo "==> 3/4  electron-vite build (main + preload + renderer)"
pnpm build

echo "==> 4/4  electron-builder --${TARGET} --${ARCH}"
pnpm electron-builder "--${TARGET}" "--${ARCH}"

echo ""
echo "✓ done. artifacts:"
ls -1 build/dist 2>/dev/null | sed 's/^/    /' || echo "    (build/dist not found)"
