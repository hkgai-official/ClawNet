# Build Guide

## Prerequisites

| Requirement | Version |
|---|---|
| macOS | 15.0+ |
| Xcode | 16+ |
| Swift | 6.2+ |

## Dependencies

ClawNet depends on the following packages:

- **OpenClawKit** (local) - WebSocket gateway client and protocol definitions. Must be available at `../clawnet-core/apps/shared/OpenClawKit` relative to this repository.
- **swift-log** 1.8.0+ - Structured logging via Apple's `Logging` framework.
- **System Frameworks** - Foundation, SwiftUI, Security, UserNotifications, AppKit, PDFKit, Vision (bundled with macOS SDK).

## Directory Layout

Ensure the following directory layout before building:

```
parent-directory/
  clawnet-core/         # nodeclaw monorepo (provides OpenClawKit)
    apps/shared/OpenClawKit/
  clawnet-macosapp/ # this repository
```

## Building

### Command Line (Swift CLI)

```bash
cd clawnet-macosapp

# Resolve dependencies
swift package resolve

# Build (debug)
swift build

# Build (release)
swift build -c release

# Run
swift run ClawNet
```

### Xcode

1. Open `Package.swift` in Xcode (double-click or `xed .`).
2. Xcode will resolve dependencies automatically.
3. Select the **ClawNet** scheme and click **Run** (Cmd+R).

> Xcode generates `.swiftpm/` workspace files automatically. These are gitignored.

## Configuration

### Server Connection

On first launch, enter your ClawNet server URL, username, and password in the login screen. Credentials are stored securely in the macOS Keychain under the service identifier `ai.clawnet.macos`.

### Security Policies

Open **Settings** (Cmd+,) to configure:

- **Command Policy** - Toggle between allowlist and blocklist modes. Add or remove commands as needed. Certain dangerous commands (`rm`, `sudo`, `shutdown`, etc.) are hard-blocked and cannot be overridden.
- **File Access** - Choose between three modes:
  - **Deny All** - Block all file operations.
  - **Scoped** - Only allow access to explicitly listed paths (glob patterns supported).
  - **Allow All** - Unrestricted file access.

Policy configuration is persisted at `~/Library/Application Support/ClawNet/command-policy.json`.

## Troubleshooting

### `error: missing dependency 'OpenClawKit'`

The local dependency at `../clawnet-core/apps/shared/OpenClawKit` cannot be found. Make sure `clawnet-core` is cloned in the same parent directory as this repository.

### Connection drops / auto-reconnect exhausted

The app attempts up to 10 reconnections with exponential backoff (max 30s delay). If all attempts fail, a manual **Reconnect** button appears in the status bar. Check your network connection and server availability.

### Keychain access denied

If macOS prompts for Keychain access, click **Always Allow** to let ClawNet store and retrieve credentials without repeated prompts. The app uses the `afterFirstUnlock` accessibility class.
