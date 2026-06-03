#!/usr/bin/env bash
set -euo pipefail

# Code-sign the OpenClaw Node standalone app.
# Usage: codesign-node-app.sh <path-to-OpenClawNode.app>
#
# Signing considerations for the separate node app:
# - Has its own bundle ID (ai.openclaw.node / ai.openclaw.node.debug)
# - Requires its own TCC permissions (camera, microphone, location, screen capture)
# - Does NOT include Sparkle framework (no auto-update)
# - Separate entitlements from the main OpenClaw app

APP="$1"

if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "ERROR: provide a valid .app path" >&2
  exit 1
fi

# --- Identity selection ---
IDENTITY="${SIGN_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
  # Try Developer ID Application first
  IDENTITY=$(security find-identity -v -p codesigning | grep 'Developer ID Application' | head -1 | awk -F'"' '{print $2}') || true
fi
if [ -z "$IDENTITY" ]; then
  IDENTITY=$(security find-identity -v -p codesigning | grep 'Apple Distribution' | head -1 | awk -F'"' '{print $2}') || true
fi
if [ -z "$IDENTITY" ]; then
  IDENTITY=$(security find-identity -v -p codesigning | grep 'Apple Development' | head -1 | awk -F'"' '{print $2}') || true
fi
if [ -z "$IDENTITY" ]; then
  if [[ "${ALLOW_ADHOC_SIGNING:-0}" == "1" ]]; then
    echo "⚠️  No signing identity found; using ad-hoc signing" >&2
    IDENTITY="-"
  else
    echo "ERROR: No signing identity found. Set SIGN_IDENTITY or ALLOW_ADHOC_SIGNING=1" >&2
    exit 1
  fi
fi

echo "🔑 Signing identity: $IDENTITY"

# --- Entitlements ---
# The node app needs camera, mic, location, automation, and screen capture.
# It does NOT need JIT or unsigned memory (no embedded Node.js).
ENTITLEMENTS_FILE=$(mktemp /tmp/openclaw-node-entitlements.XXXXXX.plist)
cat > "$ENTITLEMENTS_FILE" << 'ENTITLEMENTS_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.automation.apple-events</key>
	<true/>
	<key>com.apple.security.device.audio-input</key>
	<true/>
	<key>com.apple.security.device.camera</key>
	<true/>
	<key>com.apple.security.personal-information.location</key>
	<true/>
</dict>
</plist>
ENTITLEMENTS_EOF

cleanup() {
  rm -f "$ENTITLEMENTS_FILE"
}
trap cleanup EXIT

# --- Timestamp ---
TIMESTAMP_FLAG=""
if [[ "$IDENTITY" == *"Developer ID"* ]]; then
  TIMESTAMP_FLAG="--timestamp"
elif [[ "${CODESIGN_TIMESTAMP:-auto}" == "on" ]]; then
  TIMESTAMP_FLAG="--timestamp"
fi

SIGN_FLAGS=(--force --options runtime --sign "$IDENTITY" --entitlements "$ENTITLEMENTS_FILE")
if [ -n "$TIMESTAMP_FLAG" ]; then
  SIGN_FLAGS+=("$TIMESTAMP_FLAG")
fi

# Clear xattrs to avoid signature conflicts
xattr -cr "$APP" 2>/dev/null || true

# Sign embedded frameworks/dylibs first
if [ -d "$APP/Contents/Frameworks" ]; then
  find "$APP/Contents/Frameworks" -type f \( -name "*.dylib" -o -perm +111 \) -print0 | while IFS= read -r -d '' lib; do
    if file "$lib" | grep -q "Mach-O"; then
      /usr/bin/codesign --force --options runtime --sign "$IDENTITY" ${TIMESTAMP_FLAG:+"$TIMESTAMP_FLAG"} "$lib"
    fi
  done
fi

# Sign main binary
echo "🔏 Signing main binary"
/usr/bin/codesign "${SIGN_FLAGS[@]}" "$APP/Contents/MacOS/OpenClawNode"

# Sign app bundle
echo "🔏 Signing app bundle"
/usr/bin/codesign "${SIGN_FLAGS[@]}" "$APP"

# Verify
echo "✅ Verifying signature"
/usr/bin/codesign --verify --deep --strict "$APP" 2>&1 || {
  echo "ERROR: Signature verification failed" >&2
  exit 1
}

echo "✅ Node app signed successfully"
echo "   Identity: $IDENTITY"
echo "   Bundle: $(defaults read "$APP/Contents/Info.plist" CFBundleIdentifier 2>/dev/null || echo 'unknown')"
