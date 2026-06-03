#!/usr/bin/env bash
set -euo pipefail

# Build and bundle OpenClawNode into a minimal .app we can open.
# Outputs to dist/OpenClawNode.app

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="$ROOT_DIR/dist/OpenClawNode.app"
BUILD_ROOT="$ROOT_DIR/apps/macos/.build"
PRODUCT="OpenClawNode"
BUNDLE_ID="${BUNDLE_ID:-ai.openclaw.node.debug}"
PKG_VERSION="$(cd "$ROOT_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
BUILD_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(cd "$ROOT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_BUILD_NUMBER=$(cd "$ROOT_DIR" && git rev-list --count HEAD 2>/dev/null || echo "0")
APP_VERSION="${APP_VERSION:-$PKG_VERSION}"
APP_BUILD="${APP_BUILD:-$GIT_BUILD_NUMBER}"
BUILD_CONFIG="${BUILD_CONFIG:-debug}"
BUILD_ARCHS_VALUE="${BUILD_ARCHS:-$(uname -m)}"
if [[ "${BUILD_ARCHS_VALUE}" == "all" ]]; then
  BUILD_ARCHS_VALUE="arm64 x86_64"
fi
IFS=' ' read -r -a BUILD_ARCHS <<< "$BUILD_ARCHS_VALUE"
PRIMARY_ARCH="${BUILD_ARCHS[0]}"

build_path_for_arch() {
  echo "$BUILD_ROOT/$1"
}

bin_for_arch() {
  echo "$(build_path_for_arch "$1")/$BUILD_CONFIG/$PRODUCT"
}

echo "📦 Ensuring deps (pnpm install)"
(cd "$ROOT_DIR" && pnpm install --no-frozen-lockfile --config.node-linker=hoisted)

cd "$ROOT_DIR/apps/macos"

echo "🔨 Building $PRODUCT ($BUILD_CONFIG) [${BUILD_ARCHS[*]}]"
for arch in "${BUILD_ARCHS[@]}"; do
  BUILD_PATH="$(build_path_for_arch "$arch")"
  swift build -c "$BUILD_CONFIG" --product "$PRODUCT" --build-path "$BUILD_PATH" --arch "$arch"
done

BIN_PRIMARY="$(bin_for_arch "$PRIMARY_ARCH")"
echo "pkg: binary $BIN_PRIMARY" >&2
echo "🧹 Cleaning old app bundle"
rm -rf "$APP_ROOT"
mkdir -p "$APP_ROOT/Contents/MacOS"
mkdir -p "$APP_ROOT/Contents/Resources"

echo "📄 Copying Info.plist template"
INFO_PLIST_SRC="$ROOT_DIR/apps/macos/Sources/OpenClawNode/Resources/Info.plist"
if [ ! -f "$INFO_PLIST_SRC" ]; then
  echo "ERROR: Info.plist template missing at $INFO_PLIST_SRC" >&2
  exit 1
fi
cp "$INFO_PLIST_SRC" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${BUNDLE_ID}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${APP_VERSION}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${APP_BUILD}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :OpenClawBuildTimestamp ${BUILD_TS}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :OpenClawGitCommit ${GIT_COMMIT}" "$APP_ROOT/Contents/Info.plist" || true

echo "🚚 Copying binary"
cp "$BIN_PRIMARY" "$APP_ROOT/Contents/MacOS/$PRODUCT"
if [[ "${#BUILD_ARCHS[@]}" -gt 1 ]]; then
  BIN_INPUTS=()
  for arch in "${BUILD_ARCHS[@]}"; do
    BIN_INPUTS+=("$(bin_for_arch "$arch")")
  done
  /usr/bin/lipo -create "${BIN_INPUTS[@]}" -output "$APP_ROOT/Contents/MacOS/$PRODUCT"
fi
chmod +x "$APP_ROOT/Contents/MacOS/$PRODUCT"
# SwiftPM outputs ad-hoc signed binaries; strip the signature before any modifications.
/usr/bin/codesign --remove-signature "$APP_ROOT/Contents/MacOS/$PRODUCT" 2>/dev/null || true

# Use the main OpenClaw app icon if available, otherwise skip.
ICON_SRC="$ROOT_DIR/apps/macos/Sources/OpenClaw/Resources/OpenClaw.icns"
if [ -f "$ICON_SRC" ]; then
  echo "🖼  Copying app icon"
  cp "$ICON_SRC" "$APP_ROOT/Contents/Resources/OpenClawNode.icns"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string OpenClawNode" "$APP_ROOT/Contents/Info.plist" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile OpenClawNode" "$APP_ROOT/Contents/Info.plist" || true
else
  echo "WARN: No icon found at $ICON_SRC (continuing without icon)" >&2
fi

echo "⏹  Stopping any running OpenClawNode"
killall -q "$PRODUCT" 2>/dev/null || true

echo "🔏 Signing bundle (ad-hoc)"
/usr/bin/codesign --force --deep --sign - "$APP_ROOT"

echo "✅ Bundle ready at $APP_ROOT"
