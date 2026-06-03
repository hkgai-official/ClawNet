# ClawNet — Local Build & Packaging Guide

How to set up, run, build, and package the ClawNet desktop app locally.

> Project directory in the ClawNet monorepo: `clawnet-desktop`. Productized name: `ClawNet`.
> Stack: Electron 40 + electron-vite + React 18 + TypeScript 5.6.

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | **≥ 20.10** (22.x recommended) | The CI uses Node 22 |
| pnpm | **9.x** | Lockfile is pnpm-only; npm/yarn won't work |
| Python 3 + C/C++ toolchain | latest | Required by `better-sqlite3` native build |
| **macOS only**: Xcode CLT | latest | `xcode-select --install` |
| **Windows only**: Build Tools | 2022 | `npm install -g windows-build-tools` or VS Build Tools |
| **Linux only**: build-essential + libnss3 + libgtk-3 + libasound2 | latest | `sudo apt install build-essential libnss3 libgtk-3-0 libasound2 xvfb` |

### Install pnpm via corepack (recommended)

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
```

---

## 2. Install dependencies

```bash
pnpm install
```

This automatically builds the `better-sqlite3` native module for **Node ABI** (used by unit tests). You'll need a different ABI for the Electron app — see § "Native module ABI" below.

---

## 3. Run in development (HMR)

```bash
pnpm dev
```

`electron-vite` starts:
- Renderer dev server (React + HMR on file save)
- Main + preload bundles rebuild on save
- Electron window auto-launches

The dev window connects to `http://localhost:9000` by default (configurable in Settings → Connection on first run).

> **Hot reload of main-process code** restarts the Electron window automatically. Renderer changes hot-swap without restart.

---

## 4. Build for production (no installer)

```bash
pnpm build
```

Outputs:
- `out/main/index.js` — main process bundle (~2 MB)
- `out/preload/index.cjs` — context-isolated preload (CJS for Electron's sandbox)
- `out/renderer/` — renderer SPA (~2 MB JS + ~40 KB CSS)

Run the built app without an installer:

```bash
pnpm exec electron .
```

(Reads `main` field from `package.json`, which points at `out/main/index.js`.)

---

## 5. Native module ABI (better-sqlite3) — important

`better-sqlite3` is a native module that must match the runtime ABI:

| Scenario | Command | Why |
|---|---|---|
| Run unit tests (`pnpm test`) | `pnpm rebuild:node` | Tests run under plain Node |
| Run the app / e2e tests | `pnpm rebuild:electron` | Electron has its own Node ABI |

`pnpm install` builds for Node ABI by default. **Switch with the rebuild scripts above** whenever you alternate between unit tests and running the app. Forgetting this is the most common pitfall.

If you see `NODE_MODULE_VERSION X expected NODE_MODULE_VERSION Y` at app startup, run the matching rebuild command.

---

## 6. Package Windows installer (.exe)

```bash
pnpm build:win
```

Equivalent to:
```bash
pnpm build && electron-builder --win --publish never
```

Outputs `build/dist/`:
- `ClawNet-Setup-<version>.exe` — NSIS installer (per-user, opt-in install dir)
- `ClawNet-<version>.exe` — portable single-file executable
- `latest.yml`, blockmap files (for electron-updater; ignore unless publishing)

> The NSIS config (`package.json` `build.nsis`) creates a Start menu shortcut "ClawNet" + desktop shortcut by default. `oneClick: false` shows the install wizard rather than installing silently.

### Cross-building for Windows from macOS / Linux

Works out of the box for unsigned builds; produces the same NSIS + portable artifacts. **Code signing is not configured** (P3 roadmap). First-run SmartScreen will warn unless you sign manually.

---

## 7. Package macOS app (.dmg)

`package.json` already has `build.mac` config (added 2026-05-21) — see the block in package.json for the canonical version. Icon at `resources/clawnetv2-icon/clawnetv2.icns` (6-layer real `.icns`).

### Step 7.1 — Build (must run on macOS — `hdiutil` is Mac-only)

```bash
pnpm build && pnpm exec electron-builder --mac --publish never
```

Outputs `build/dist/`:
- `ClawNet-<version>-x64.dmg` (Intel Mac)
- `ClawNet-<version>-arm64.dmg` (Apple Silicon)
- `.zip` variants for auto-update

### Step 7.2 — Signing & notarization (optional, for distribution)

Unsigned .dmg works for personal use but Gatekeeper warns on first run. For production:

```bash
export CSC_LINK="/path/to/Developer ID Application.p12"
export CSC_KEY_PASSWORD="..."
export APPLE_ID="..."
export APPLE_APP_SPECIFIC_PASSWORD="..."
export APPLE_TEAM_ID="..."

pnpm build && pnpm exec electron-builder --mac --publish never
```

`electron-builder` auto-detects these env vars and runs codesigning + notarization. See [electron-builder docs](https://www.electron.build/code-signing-mac) for details.

---

## 8. Package Linux (.AppImage / .deb)

`package.json` already has `build.linux` config (added 2026-05-21) — icon at `resources/clawnetv2-icon/clawnetv2-1024.png`, maintainer set so `.deb` builds.

```bash
pnpm build && pnpm exec electron-builder --linux --publish never
```

Outputs `build/dist/`:
- `ClawNet-<version>-x86_64.AppImage` (172 MB at v0.18.0)
- `ClawNet-<version>-amd64.deb` (106 MB at v0.18.0)

Builds cleanly on any Linux host (no wine / no extra deps needed beyond what `pnpm install` already pulls).

---

## 9. Test commands

```bash
pnpm typecheck                              # tsc --build
pnpm lint                                   # eslint
pnpm rebuild:node && pnpm test              # vitest unit (1180+ tests, ~4 s)
pnpm rebuild:electron && pnpm test:e2e      # Playwright fake-server e2e (60 specs, ~2 min)
```

E2E uses an in-process Express + ws fake server — no real backend needed. On Linux, wrap with `xvfb-run -a pnpm test:e2e` (Electron needs an X display).

---

## 10. Common pitfalls cheat sheet

| Symptom | Fix |
|---|---|
| `NODE_MODULE_VERSION X expected Y` on startup | `pnpm rebuild:electron` |
| `NODE_MODULE_VERSION X expected Y` running `pnpm test` | `pnpm rebuild:node` |
| `pnpm install` rebuilds native every time | Normal; cached after first run unless `node_modules` deleted |
| Dev window blank / "Connecting…" forever | Verify server URL in Settings → Connection. Default `http://localhost:9000` |
| `xvfb-run: command not found` on Linux | `sudo apt install xvfb` |
| `pnpm build:win` fails on macOS with `wine not found` | Cross-build to Win needs wine OR run on Windows / Linux. For unsigned Win builds from macOS, install `brew install --cask wine-stable` |
| `electron-builder` complains about icon | Provide a 256×256+ PNG (Linux), .icns (macOS), .ico (Windows) at the path in your `build.{win,mac,linux}.icon` config |

---

## 11. Where artifacts land

| Artifact | Path |
|---|---|
| Dev bundle (no installer) | `out/{main,preload,renderer}/...` |
| All packaged installers | `build/dist/` |
| User data (runtime) | `%LOCALAPPDATA%\ClawNet\` (Win), `~/Library/Application Support/ClawNet/` (macOS), `~/.config/ClawNet/` (Linux) |
| Logs | inside the user-data path under `logs/*.jsonl` |
| Test artifacts (screenshots, traces) | `test-results/`, `playwright-report/` |
| A2A harness output (if you run `scripts/a2a-harness.mjs`) | `artifacts/a2a-<timestamp>/` |

---

## 12. Quick reference

```bash
# First time
corepack enable && corepack prepare pnpm@9.12.0 --activate
pnpm install

# Day-to-day dev
pnpm dev                                    # HMR window

# Before commit
pnpm typecheck && pnpm lint
pnpm rebuild:node && pnpm test
pnpm rebuild:electron && pnpm test:e2e

# Ship a Windows build
pnpm build:win
# → build/dist/ClawNet-Setup-<version>.exe + portable .exe

# Ship a macOS build (requires Mac host + mac config in package.json)
pnpm build && pnpm exec electron-builder --mac --publish never
# → build/dist/ClawNet-<version>-{x64,arm64}.dmg
```
