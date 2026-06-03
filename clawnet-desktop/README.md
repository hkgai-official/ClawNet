# ClawNet Desktop

Cross-platform ClawNet desktop client for **Windows, macOS, and Linux** (x64 / ARM). Electron + React + TypeScript.

> Feature-complete desktop client with end-to-end smoke tests, CI, and crash reporting.

## Prerequisites

- Node.js 20.10+
- pnpm 9.x (`corepack enable && corepack prepare pnpm@9 --activate`)
- Runtime targets: Windows 10 1809+ / 11, macOS 12+, modern Linux — x64 and ARM64
- You can develop on any of the three OSes. Building an installer for a given OS generally needs that OS (or CI); cross-building to Windows from macOS/Linux additionally needs `wine`.

## Develop

```bash
pnpm install
pnpm dev          # opens the dev window with HMR
```

## Verify quality

```bash
pnpm typecheck
pnpm lint
pnpm test           # ~301 unit tests
pnpm test:cov
pnpm test:e2e       # 5 Playwright e2e flows against an in-process fake server
```

The e2e suite boots the packaged Electron app against a fake ClawNet
server (Express + ws). Each spec spawns its own server + fresh tmp
`userData` dir. First-run requires `pnpm exec playwright install chromium`
(~150 MB cache).

## Build installers

```bash
pnpm build:win      # Windows: NSIS installer + portable .exe
pnpm build:mac      # macOS: .dmg / .zip
pnpm build:linux    # Linux: AppImage / .deb
```

Output goes to `build/dist/`. Build each target on (or for) its own OS; see [start.md](start.md) for cross-building notes.

## Project layout

```
src/main         Electron main process (Node)
src/preload      Context-isolated bridge
src/renderer     React app
src/shared       Cross-process types + IPC contract
```

## Features

- Frameless branded window with custom titlebar (drag region)
- Theme: light / dark / follow-system
- Language: English / 简体中文
- IPC plumbing: typed `window.clawnet.invoke` + `.on` derived from zod-based contract
- Per-user app-data dir (Windows `%LOCALAPPDATA%\ClawNet\`, macOS `~/Library/Application Support/ClawNet/`, Linux `~/.config/ClawNet/`)
- OS-encrypted credentials via Electron `safeStorage` (DPAPI / Keychain / libsecret)
- Logger writing JSONL to the app-data `logs/` directory
- Custom ESLint rule: no hard-coded colors (must use CSS variable tokens)

## Operator Manual

> Paths below use Windows conventions (`%LOCALAPPDATA%\ClawNet\`). On macOS substitute `~/Library/Application Support/ClawNet/`, on Linux `~/.config/ClawNet/`. Install/uninstall steps are Windows-specific; on macOS use the `.dmg`, on Linux the AppImage/`.deb`.

### First run

After installing (Windows NSIS/portable `.exe`, macOS `.dmg`, or Linux AppImage/`.deb`):

1. Launch ClawNet from Start Menu.
2. Enter your server URL (default `http://localhost:9000`).
3. Sign in with email + password — the session persists across restarts (DPAPI-encrypted credentials at `%LOCALAPPDATA%\ClawNet\credentials.bin`).

### Daily use

- **Chat**: click a conversation in the sidebar to open it; type and press Enter to send. Streaming agent replies render token-by-token via the PlaybackEngine.
- **Agents**: click the Agents tab (sidebar icon) to browse contactable agents; click one for the detail view.
- **A2A dialogs**: when an agent-to-agent session is active in a chat, a control bar appears over the composer with view / approve / cancel actions.
- **File access**: Settings → File Access lets you manage which folders agents may read/write. When an agent requests access to a new path, a consent banner appears at the top of the window.

### Diagnostics

- Logs live at `%LOCALAPPDATA%\ClawNet\logs\`:
  - `app-YYYY-MM-DD.jsonl` — general application log
  - `ops-YYYY-MM-DD.jsonl` — agent operation decisions (allow / deny / pending-consent)
  - `crash-*.log` — uncaught exceptions + unhandled promise rejections
- If the app refuses to start: delete `%LOCALAPPDATA%\ClawNet\prefs.json` to reset preferences. As a last resort, also delete `credentials.bin` (you'll need to log in again).

### Uninstall

Settings → Apps → ClawNet → Uninstall. Local data at `%LOCALAPPDATA%\ClawNet\` is preserved by default; tick "Also remove user data" in the uninstall wizard for a clean wipe.

## Architecture

Brief overview:

- **Main process (Node)**: owns REST + WS gateway + state + persistence. Hosts ChatService, AgentService, DialogService, DiscoveryService, TaskService, AuditService, FileAccessService, CommandPolicy, BookmarkStore, PlaybackEngine, ConnectionManager.
- **Preload**: `contextBridge`-exposed typed `window.clawnet.invoke` / `.on` API. Schemas live in `src/shared/ipc-contract`. Emitted as CommonJS (`out/preload/index.cjs`) because Electron's sandboxed preload requires CJS.
- **Renderer (React)**: pure views + TanStack Query (caches IPC calls) + zustand (UI state).
- **Storage**: `%LOCALAPPDATA%\ClawNet\` — `prefs.json` (electron-store), `credentials.bin` (safeStorage/DPAPI), `file_access.json` (bookmarks), `logs/*.jsonl`.
- **REST boundary**: `HttpClient` applies `deepSnakeToCamel` / `deepCamelToSnake` so the wire protocol is snake_case while the renderer + zod schemas use camelCase.
- **WS gateway**: bypasses HttpClient case conversion. Push payloads use the field names the server emits (`run_id`, `conversation_id`, `final_text` for stream frames; camelCase for `chat.message.{created,updated}` to match `ChatMessageSchema`).

## Phase Roadmap

- **P1 (complete)**: foundation, auth, chat text, streaming, agent governance, file consent, e2e smoke, CI, crash reporter.
- **P2**: rich media messages (image / video / voice / file), Agent CRUD UI, full file-action execution beyond the file-command handler stub.
- **P3**: audit center UI, electron-updater auto-update, EV/OV code signing, multi-server config, SQLite migration once the message JSON store grows past 5 MB, Storybook + chromatic visual regression.


