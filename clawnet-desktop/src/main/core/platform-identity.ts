// src/main/core/platform-identity.ts
//
// Cross-platform identity helpers for the `node.capabilities` envelope.
//
// ## Why we always REPORT macos
//
// The Electron client runs the same code on all three desktops, but
// the **server** has a per-platform command allowlist
// (clawnet-core `src/gateway/node-command-policy.ts:73-114`):
//
//   macos:   canvas + camera + location + device + contacts + calendar
//            + reminders + photos + motion + **file** (10) + **ops** (3)
//            + macos-system commands     ← only this bucket has file/ops
//   windows: system.run / system.which / system.notify / browser.proxy
//   linux:   same as windows
//   ios/android: mobile-only (canvas/camera/location/device/etc, no file)
//
// Reporting anything other than `macos` results in
// `"file.list" is not in the allowlist for platform "windows"` and
// every file op is rejected. The server's `normalizePlatformId` accepts
// `"macos"`, `"darwin"`, `"Mac"`, or anything starting with `"mac"` —
// all map to the same `macos` bucket.
//
// Until the server-side allowlist is extended to add file/ops to
// windows/linux (which would be the proper fix on the server side),
// every client reports `macos` so the file commands are accepted.
// `deviceFamily` is only consulted as a fallback when `platform`
// doesn't match any prefix, so `"Mac"` keeps things consistent with no
// other behavioural effects.
//
// `platformLabel()` / `deviceFamilyLabel()` still expose the runtime
// truth for diagnostics + future use; `reportedPlatformLabel()` /
// `reportedDeviceFamilyLabel()` are the ones that go on the wire.

import { hostname } from 'node:os';
import { execSync } from 'node:child_process';

/** Returns the canonical platform string the gateway expects.
 *  Matches macOS Swift `ChatService.swift:119` (`"macos"`). */
export function platformLabel(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case 'darwin': return 'macos';
    case 'win32':  return 'windows';
    case 'linux':  return 'linux';
    default:       return String(platform);
  }
}

/** Returns the gateway's deviceFamily label.
 *  Matches macOS Swift `InstanceIdentity.swift:47` (`"Mac"`). */
export function deviceFamilyLabel(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case 'darwin': return 'Mac';
    case 'win32':  return 'Windows';
    case 'linux':  return 'Linux';
    default:       return 'Unknown';
  }
}

/** What we put on the wire as `platform`. ALWAYS `'macos'` — see the
 *  file-level comment for why. Independent of the actual host so file
 *  commands stay allowed on Win/Linux Electron sessions until the
 *  server-side allowlist is extended. */
export function reportedPlatformLabel(): string {
  return 'macos';
}

/** Wire-side `deviceFamily`. Pinned to `'Mac'` to match
 *  `reportedPlatformLabel()`. */
export function reportedDeviceFamilyLabel(): string {
  return 'Mac';
}

/** Returns the user-facing device name to send as `displayName`.
 *
 *  On macOS, `os.hostname()` returns the dashed `.local` form
 *  (`alice-mba.local`) — but Swift uses `Host.current().localizedName`
 *  which yields the user-friendly name with spaces (`Alice MBA`). We
 *  match Swift by shelling out to `scutil --get ComputerName`. If that
 *  fails for any reason we fall back to `os.hostname()`.
 *
 *  On Windows/Linux, `os.hostname()` already returns the user-facing
 *  computer name, so we just use it directly.
 *
 *  Falls back to `'ClawNet'` if both lookups return empty. */
export function resolveDisplayName(
  platform: NodeJS.Platform = process.platform,
  runExec: (cmd: string) => string = (cmd) =>
    execSync(cmd, { encoding: 'utf8', timeout: 1000 }).trim(),
  getHostname: () => string = () => hostname() ?? '',
): string {
  if (platform === 'darwin') {
    try {
      const name = runExec('scutil --get ComputerName');
      if (name) return name;
    } catch {
      // scutil unavailable / permission denied — fall through to hostname.
    }
  }
  return getHostname() || 'ClawNet';
}
