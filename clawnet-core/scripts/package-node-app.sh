#!/usr/bin/env bash
set -euo pipefail

# Build and bundle OpenClaw Node into a standalone .app.
# Outputs to dist/OpenClawNode.app
#
# This is the standalone node agent app with its own bundle ID (ai.openclaw.node)
# and separate code signing from the main OpenClaw menu bar app.

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
cp "$BIN_PRIMARY" "$APP_ROOT/Contents/MacOS/OpenClawNode"
if [[ "${#BUILD_ARCHS[@]}" -gt 1 ]]; then
  BIN_INPUTS=()
  for arch in "${BUILD_ARCHS[@]}"; do
    BIN_INPUTS+=("$(bin_for_arch "$arch")")
  done
  /usr/bin/lipo -create "${BIN_INPUTS[@]}" -output "$APP_ROOT/Contents/MacOS/OpenClawNode"
fi
chmod +x "$APP_ROOT/Contents/MacOS/OpenClawNode"
/usr/bin/codesign --remove-signature "$APP_ROOT/Contents/MacOS/OpenClawNode" 2>/dev/null || true

echo "📦 Copying Swift 6.2 compatibility libraries"
SWIFT_COMPAT_LIB="$(xcode-select -p)/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-6.2/macosx/libswiftCompatibilitySpan.dylib"
if [ -f "$SWIFT_COMPAT_LIB" ]; then
  mkdir -p "$APP_ROOT/Contents/Frameworks"
  cp "$SWIFT_COMPAT_LIB" "$APP_ROOT/Contents/Frameworks/"
  chmod +x "$APP_ROOT/Contents/Frameworks/libswiftCompatibilitySpan.dylib"
else
  echo "WARN: Swift compatibility library not found at $SWIFT_COMPAT_LIB (continuing)" >&2
fi

echo "📦 Copying OpenClawKit resources"
OPENCLAWKIT_BUNDLE="$(build_path_for_arch "$PRIMARY_ARCH")/$BUILD_CONFIG/OpenClawKit_OpenClawKit.bundle"
if [ -d "$OPENCLAWKIT_BUNDLE" ]; then
  rm -rf "$APP_ROOT/Contents/Resources/OpenClawKit_OpenClawKit.bundle"
  cp -R "$OPENCLAWKIT_BUNDLE" "$APP_ROOT/Contents/Resources/OpenClawKit_OpenClawKit.bundle"
else
  echo "WARN: OpenClawKit resource bundle not found at $OPENCLAWKIT_BUNDLE (continuing)" >&2
fi

echo "🔏 Signing bundle"
if [ -x "$ROOT_DIR/scripts/codesign-node-app.sh" ]; then
  "$ROOT_DIR/scripts/codesign-node-app.sh" "$APP_ROOT"
elif [ -x "$ROOT_DIR/scripts/codesign-mac-app.sh" ]; then
  echo "INFO: Using main app codesign script (codesign-node-app.sh not found)"
  "$ROOT_DIR/scripts/codesign-mac-app.sh" "$APP_ROOT"
else
  echo "WARN: No codesign script found; skipping signing" >&2
fi

echo "✅ Node app bundle ready at $APP_ROOT"
