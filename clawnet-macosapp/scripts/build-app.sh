#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/build"

SIGN_ID=$(security find-identity -v -p codesigning | head -1 | sed 's/.*"\(.*\)".*/\1/')
if [ -z "$SIGN_ID" ]; then
    SIGN_ID="-"
    echo "Warning: No signing identity found, using ad-hoc signing"
fi

echo "Building ClawNet (signing: $SIGN_ID)..."
xcodebuild -project "$PROJECT_DIR/ClawNet.xcodeproj" \
    -scheme ClawNet \
    -configuration Release \
    -derivedDataPath "$BUILD_DIR" \
    build

APP_PATH="$BUILD_DIR/Build/Products/Release/ClawNet.app"

# Strip iCloud / Finder extended attributes that block codesign
xattr -cr "$APP_PATH"

# Re-sign with developer identity + hardened runtime
codesign --force --deep --options runtime --sign "$SIGN_ID" "$APP_PATH"

echo ""
echo "Built: $APP_PATH"
echo "Run:   open $APP_PATH"
