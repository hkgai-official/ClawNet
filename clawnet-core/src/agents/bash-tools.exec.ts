import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { type ExecHost, maxAsk, minSecurity } from "../infra/exec-approvals.js";
import { resolveExecSafeBinRuntimePolicy } from "../infra/exec-safe-bin-runtime-policy.js";
import {
  getShellPathFromLoginShell,
  resolveShellEnvFallbackTimeoutMs,
} from "../infra/shell-env.js";
import { logInfo } from "../logger.js";
import { parseAgentSessionKey, resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { markBackgrounded } from "./bash-process-registry.js";
import { processGatewayAllowlist } from "./bash-tools.exec-host-gateway.js";
import { executeNodeHostCommand } from "./bash-tools.exec-host-node.js";
import {
  DEFAULT_MAX_OUTPUT,
  DEFAULT_PATH,
  DEFAULT_PENDING_MAX_OUTPUT,
  applyPathPrepend,
  applyShellPath,
  normalizeExecAsk,
  normalizeExecHost,
  normalizeExecSecurity,
  normalizePathPrepend,
  renderExecHostLabel,
  resolveApprovalRunningNoticeMs,
  runExecProcess,
  sanitizeHostBaseEnv,
  execSchema,
  validateHostEnv,
} from "./bash-tools.exec-runtime.js";
import type {
  ExecElevatedDefaults,
  ExecToolDefaults,
  ExecToolDetails,
} from "./bash-tools.exec-types.js";
import {
  buildSandboxEnv,
  clampWithDefault,
  coerceEnv,
  readEnvInt,
  resolveSandboxWorkdir,
  resolveWorkdir,
  truncateMiddle,
} from "./bash-tools.shared.js";
import { reportBoundaryViolation } from "./boundary-violation.js";
import { getSessionTagContext } from "../gateway/tag-context.js";
import { assertSandboxPath } from "./sandbox-paths.js";

export type { BashSandboxConfig } from "./bash-tools.shared.js";
export type {
  ExecElevatedDefaults,
  ExecToolDefaults,
  ExecToolDetails,
} from "./bash-tools.exec-types.js";

/**
 * Defense-in-depth: scan a shell command for absolute paths that escape the
 * workspace boundary. This is a heuristic that catches common escape patterns
 * (absolute paths, parent-traversal) but cannot prevent all shell-level escapes.
 * Full isolation requires Docker sandbox.
 */
function checkCommandWorkspaceBoundary(
  command: string,
  boundary: string,
  workdir: string,
): string | null {
  // Extract potential file paths from the command:
  // 1. Absolute paths (starting with /)
  // 2. Parent-traversal patterns (../)
  const absolutePathRegex = /(?:^|\s|=|"|')(\/([\w._-]+\/)+[\w._-]*)/g;
  let match: RegExpExecArray | null;
  // Block paths within the openclaw home directory (~/.openclaw/) that are
  // outside the current tag workspace. This prevents access to config files
  // (openclaw.json, config.yaml, credentials/) AND sibling tag workspaces.
  const workspaceParent = path.dirname(boundary);
  const openclawHome = path.dirname(workspaceParent);
  while ((match = absolutePathRegex.exec(command)) !== null) {
    const candidate = match[1]!;
    const resolved = path.resolve(candidate);
    if (
      resolved.startsWith(openclawHome + path.sep) &&
      resolved !== boundary &&
      !resolved.startsWith(boundary + path.sep)
    ) {
      return `command references path "${candidate}" outside workspace boundary`;
    }
  }
  // Check for tilde and shell variable paths that bypass absolute path detection.
  // Patterns: ~/..., $HOME/..., ${HOME}/...
  const tildeVarRegex = /(?:^|\s|=|"|')((?:~|\$HOME|\$\{HOME\})\/[^\s"']*)/g;
  while ((match = tildeVarRegex.exec(command)) !== null) {
    const candidate = match[1]!;
    // Expand ~ and $HOME to actual home directory for boundary check
    const expanded = candidate.replace(/^(?:~|\$HOME|\$\{HOME\})/, os.homedir());
    const resolved = path.resolve(expanded);
    if (
      resolved.startsWith(openclawHome + path.sep) &&
      resolved !== boundary &&
      !resolved.startsWith(boundary + path.sep)
    ) {
      return `command references path "${candidate}" outside workspace boundary`;
    }
  }
  // Check for parent-traversal that could escape workspace
  // Resolve ../  patterns relative to workdir to see if they escape
  const traversalRegex = /(?:^|\s|"|')(\.\.(?:\/[^\s"']*)?)/g;
  while ((match = traversalRegex.exec(command)) !== null) {
    const candidate = match[1]!;
    const resolved = path.resolve(workdir, candidate);
    if (resolved !== boundary && !resolved.startsWith(boundary + path.sep)) {
      return `command uses parent traversal "${candidate}" that escapes workspace boundary`;
    }
  }
  return null;
}

/**
 * A2A mode: block commands that could leak sensitive system information.
 * Returns a human-readable reason if blocked, null if allowed.
 */
function checkA2aCommandRestrictions(command: string): string | null {
  const cmd = command.trim();
  // Block environment variable dump commands.
  // Allow: `set -e`, `set -o pipefail`, `set -- ...` (shell options/positional args)
  // Allow: `export VAR=value` (setting a variable)
  // Block: bare `printenv`, `env`, `set` (no args), `export` (no args), `export -p`
  const envDumpCommands =
    /(?:^|;|&&|\|\|)\s*(?:printenv|env)\b|(?:^|;|&&|\|\|)\s*set\s*(?:;|&&|\|\||$)|(?:^|;|&&|\|\|)\s*export\s*(?:-p\b|;|&&|\|\||$)/;
  if (envDumpCommands.test(cmd)) {
    return "environment inspection commands are not allowed in A2A mode";
  }
  // Block access to config/credential files via tilde or $HOME
  const sensitivePathPatterns =
    /(?:~|\$HOME|\$\{HOME\})\/\.(?:openclaw|config|ssh|gnupg|aws|kube|docker)/;
  if (sensitivePathPatterns.test(cmd)) {
    return "access to dotfile/config directories is not allowed in A2A mode";
  }
  // Block /proc/self/environ (Linux env leak)
  if (/\/proc\/\w+\/environ\b/.test(cmd)) {
    return "access to /proc/*/environ is not allowed in A2A mode";
  }
  // Block reading environment variables via shell expansion
  const envVarRead =
    /\$\{?(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET)[A-Z_]*\}?/i;
  if (envVarRead.test(cmd)) {
    return "reading credential environment variables is not allowed in A2A mode";
  }
  return null;
}

function extractScriptTargetFromCommand(
  command: string,
): { kind: "python"; relOrAbsPath: string } | { kind: "node"; relOrAbsPath: string } | null {
  const raw = command.trim();
  if (!raw) {
    return null;
  }

  // Intentionally simple parsing: we only support common forms like
  //   python file.py
  //   python3 -u file.py
  //   node --experimental-something file.js
  // If the command is more complex (pipes, heredocs, quoted paths with spaces), skip preflight.
  const pythonMatch = raw.match(/^\s*(python3?|python)\s+(?:-[^\s]+\s+)*([^\s]+\.py)\b/i);
  if (pythonMatch?.[2]) {
    return { kind: "python", relOrAbsPath: pythonMatch[2] };
  }
  const nodeMatch = raw.match(/^\s*(node)\s+(?:--[^\s]+\s+)*([^\s]+\.js)\b/i);
  if (nodeMatch?.[2]) {
    return { kind: "node", relOrAbsPath: nodeMatch[2] };
  }

  return null;
}

async function validateScriptFileForShellBleed(params: {
  command: string;
  workdir: string;
}): Promise<void> {
  const target = extractScriptTargetFromCommand(params.command);
  if (!target) {
    return;
  }

  const absPath = path.isAbsolute(target.relOrAbsPath)
    ? path.resolve(target.relOrAbsPath)
    : path.resolve(params.workdir, target.relOrAbsPath);

  // Best-effort: only validate if file exists and is reasonably small.
  let stat: { isFile(): boolean; size: number };
  try {
    await assertSandboxPath({
      filePath: absPath,
      cwd: params.workdir,
      root: params.workdir,
    });
    stat = await fs.stat(absPath);
  } catch {
    return;
  }
  if (!stat.isFile()) {
    return;
  }
  if (stat.size > 512 * 1024) {
    return;
  }

  const content = await fs.readFile(absPath, "utf-8");

  // Common failure mode: shell env var syntax leaking into Python/JS.
  // We deliberately match all-caps/underscore vars to avoid false positives with `$` as a JS identifier.
  const envVarRegex = /\$[A-Z_][A-Z0-9_]{1,}/g;
  const first = envVarRegex.exec(content);
  if (first) {
    const idx = first.index;
    const before = content.slice(0, idx);
    const line = before.split("\n").length;
    const token = first[0];
    throw new Error(
      [
        `exec preflight: detected likely shell variable injection (${token}) in ${target.kind} script: ${path.basename(
          absPath,
        )}:${line}.`,
        target.kind === "python"
          ? `In Python, use os.environ.get(${JSON.stringify(token.slice(1))}) instead of raw ${token}.`
          : `In Node.js, use process.env[${JSON.stringify(token.slice(1))}] instead of raw ${token}.`,
        "(If this is inside a string literal on purpose, escape it or restructure the code.)",
      ].join("\n"),
    );
  }

  // Another recurring pattern from the issue: shell commands accidentally emitted as JS.
  if (target.kind === "node") {
    const firstNonEmpty = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (firstNonEmpty && /^NODE\b/.test(firstNonEmpty)) {
      throw new Error(
        `exec preflight: JS file starts with shell syntax (${firstNonEmpty}). ` +
          `This looks like a shell command, not JavaScript.`,
      );
    }
  }
}

export function createExecTool(
  defaults?: ExecToolDefaults,
  // oxlint-disable-next-line typescript/no-explicit-any
): AgentTool<any, ExecToolDetails> {
  const defaultBackgroundMs = clampWithDefault(
    defaults?.backgroundMs ?? readEnvInt("PI_BASH_YIELD_MS"),
    10_000,
    10,
    120_000,
  );
  const allowBackground = defaults?.allowBackground ?? true;
  const defaultTimeoutSec =
    typeof defaults?.timeoutSec === "number" && defaults.timeoutSec > 0
      ? defaults.timeoutSec
      : 1800;
  const defaultPathPrepend = normalizePathPrepend(defaults?.pathPrepend);
  const {
    safeBins,
    safeBinProfiles,
    trustedSafeBinDirs,
    unprofiledSafeBins,
    unprofiledInterpreterSafeBins,
  } = resolveExecSafeBinRuntimePolicy({
    local: {
      safeBins: defaults?.safeBins,
      safeBinTrustedDirs: defaults?.safeBinTrustedDirs,
      safeBinProfiles: defaults?.safeBinProfiles,
    },
    onWarning: (message) => {
      logInfo(message);
    },
  });
  if (unprofiledSafeBins.length > 0) {
    logInfo(
      `exec: ignoring unprofiled safeBins entries (${unprofiledSafeBins.toSorted().join(", ")}); use allowlist or define tools.exec.safeBinProfiles.<bin>`,
    );
  }
  if (unprofiledInterpreterSafeBins.length > 0) {
    logInfo(
      `exec: interpreter/runtime binaries in safeBins (${unprofiledInterpreterSafeBins.join(", ")}) are unsafe without explicit hardened profiles; prefer allowlist entries`,
    );
  }
  const notifyOnExit = defaults?.notifyOnExit !== false;
  const notifyOnExitEmptySuccess = defaults?.notifyOnExitEmptySuccess === true;
  const notifySessionKey = defaults?.sessionKey?.trim() || undefined;
  const approvalRunningNoticeMs = resolveApprovalRunningNoticeMs(defaults?.approvalRunningNoticeMs);
  // Derive agentId only when sessionKey is an agent session key.
  const parsedAgentSession = parseAgentSessionKey(defaults?.sessionKey);
  const agentId =
    defaults?.agentId ??
    (parsedAgentSession ? resolveAgentIdFromSessionKey(defaults?.sessionKey) : undefined);

  return {
    name: "exec",
    label: "exec",
    description:
      "Execute shell commands with background continuation. Use yieldMs/background to continue later via process tool. Use pty=true for TTY-required commands (terminal UIs, coding agents).",
    parameters: execSchema,
    execute: async (_toolCallId, args, signal, onUpdate) => {
      const params = args as {
        command: string;
        workdir?: string;
        env?: Record<string, string>;
        yieldMs?: number;
        background?: boolean;
        timeout?: number;
        pty?: boolean;
        elevated?: boolean;
        host?: string;
        security?: string;
        ask?: string;
        node?: string;
      };

      if (!params.command) {
        throw new Error("Provide a command to start.");
      }

      const maxOutput = DEFAULT_MAX_OUTPUT;
      const pendingMaxOutput = DEFAULT_PENDING_MAX_OUTPUT;
      const warnings: string[] = [];
      let execCommandOverride: string | undefined;
      const backgroundRequested = params.background === true;
      const yieldRequested = typeof params.yieldMs === "number";
      if (!allowBackground && (backgroundRequested || yieldRequested)) {
        warnings.push("Warning: background execution is disabled; running synchronously.");
      }
      const yieldWindow = allowBackground
        ? backgroundRequested
          ? 0
          : clampWithDefault(
              params.yieldMs ?? defaultBackgroundMs,
              defaultBackgroundMs,
              10,
              120_000,
            )
        : null;
      const elevatedDefaults = defaults?.elevated;
      const elevatedAllowed = Boolean(elevatedDefaults?.enabled && elevatedDefaults.allowed);
      const elevatedDefaultMode =
        elevatedDefaults?.defaultLevel === "full"
          ? "full"
          : elevatedDefaults?.defaultLevel === "ask"
            ? "ask"
            : elevatedDefaults?.defaultLevel === "on"
              ? "ask"
              : "off";
      const effectiveDefaultMode = elevatedAllowed ? elevatedDefaultMode : "off";
      const elevatedMode =
        typeof params.elevated === "boolean"
          ? params.elevated
            ? elevatedDefaultMode === "full"
              ? "full"
              : "ask"
            : "off"
          : effectiveDefaultMode;
      const elevatedRequested = elevatedMode !== "off";
      if (elevatedRequested) {
        if (!elevatedDefaults?.enabled || !elevatedDefaults.allowed) {
          const runtime = defaults?.sandbox ? "sandboxed" : "direct";
          const gates: string[] = [];
          const contextParts: string[] = [];
          const provider = defaults?.messageProvider?.trim();
          const sessionKey = defaults?.sessionKey?.trim();
          if (provider) {
            contextParts.push(`provider=${provider}`);
          }
          if (sessionKey) {
            contextParts.push(`session=${sessionKey}`);
          }
          if (!elevatedDefaults?.enabled) {
            gates.push("enabled (tools.elevated.enabled / agents.list[].tools.elevated.enabled)");
          } else {
            gates.push(
              "allowFrom (tools.elevated.allowFrom.<provider> / agents.list[].tools.elevated.allowFrom.<provider>)",
            );
          }
          throw new Error(
            [
              `elevated is not available right now (runtime=${runtime}).`,
              `Failing gates: ${gates.join(", ")}`,
              contextParts.length > 0 ? `Context: ${contextParts.join(" ")}` : undefined,
              "Fix-it keys:",
              "- tools.elevated.enabled",
              "- tools.elevated.allowFrom.<provider>",
              "- agents.list[].tools.elevated.enabled",
              "- agents.list[].tools.elevated.allowFrom.<provider>",
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }
      }
      if (elevatedRequested) {
        logInfo(`exec: elevated command ${truncateMiddle(params.command, 120)}`);
      }
      const configuredHost = defaults?.host ?? "sandbox";
      const sandboxHostConfigured = defaults?.host === "sandbox";
      const requestedHost = normalizeExecHost(params.host) ?? null;
      let host: ExecHost = requestedHost ?? configuredHost;
      if (!elevatedRequested && requestedHost && requestedHost !== configuredHost) {
        throw new Error(
          `exec host not allowed (requested ${renderExecHostLabel(requestedHost)}; ` +
            `configure tools.exec.host=${renderExecHostLabel(configuredHost)} to allow).`,
        );
      }
      if (elevatedRequested) {
        host = "gateway";
      }

      const configuredSecurity = defaults?.security ?? (host === "sandbox" ? "deny" : "allowlist");
      const requestedSecurity = normalizeExecSecurity(params.security);
      let security = minSecurity(configuredSecurity, requestedSecurity ?? configuredSecurity);
      if (elevatedRequested && elevatedMode === "full") {
        security = "full";
      }
      const configuredAsk = defaults?.ask ?? "on-miss";
      const requestedAsk = normalizeExecAsk(params.ask);
      let ask = maxAsk(configuredAsk, requestedAsk ?? configuredAsk);
      const bypassApprovals = elevatedRequested && elevatedMode === "full";
      if (bypassApprovals) {
        ask = "off";
      }

      const sandbox = host === "sandbox" ? defaults?.sandbox : undefined;
      if (
        host === "sandbox" &&
        !sandbox &&
        (sandboxHostConfigured || requestedHost === "sandbox")
      ) {
        throw new Error(
          [
            "exec host=sandbox is configured, but sandbox runtime is unavailable for this session.",
            'Enable sandbox mode (`agents.defaults.sandbox.mode="non-main"` or `"all"`) or set tools.exec.host to "gateway"/"node".',
          ].join("\n"),
        );
      }
      const rawWorkdir = params.workdir?.trim() || defaults?.cwd || process.cwd();
      let workdir = rawWorkdir;
      let containerWorkdir = sandbox?.containerWorkdir;
      if (sandbox) {
        const resolved = await resolveSandboxWorkdir({
          workdir: rawWorkdir,
          sandbox,
          warnings,
        });
        workdir = resolved.hostWorkdir;
        containerWorkdir = resolved.containerWorkdir;
      } else {
        workdir = resolveWorkdir(rawWorkdir, warnings);
      }

      // Tag workspace isolation: when workspaceBoundary is set and running on gateway (non-sandbox),
      // validate that the resolved workdir stays within the workspace boundary,
      // AND scan the command for paths that escape the boundary.
      if (defaults?.workspaceBoundary && !sandbox) {
        const boundary = path.resolve(defaults.workspaceBoundary);
        const execTagCtx = defaults.sessionKey
          ? getSessionTagContext(defaults.sessionKey)
          : undefined;
        const resolvedWorkdir = path.resolve(workdir);
        if (resolvedWorkdir !== boundary && !resolvedWorkdir.startsWith(boundary + path.sep)) {
          reportBoundaryViolation({
            type: "exec_workdir_escape",
            sessionKey: defaults.sessionKey,
            tagName: execTagCtx?.tagName,
            tagWorkspaceId: execTagCtx?.workspaceId,
            boundary,
            attemptedPath: workdir,
            detail: `workdir "${workdir}" is outside workspace boundary`,
          });
          throw new Error(`workdir "${workdir}" is outside workspace boundary "${boundary}"`);
        }
        const commandViolation = checkCommandWorkspaceBoundary(params.command, boundary, workdir);
        if (commandViolation) {
          const violationType = commandViolation.includes("parent traversal")
            ? ("exec_command_traversal" as const)
            : ("exec_command_path" as const);
          reportBoundaryViolation({
            type: violationType,
            sessionKey: defaults.sessionKey,
            tagName: execTagCtx?.tagName,
            tagWorkspaceId: execTagCtx?.workspaceId,
            boundary,
            attemptedPath: params.command,
            detail: commandViolation,
          });
          throw new Error(
            `Workspace isolation: ${commandViolation}. ` +
              `Use relative paths within your workspace "${boundary}".`,
          );
        }
      }

      // A2A mode: block commands that probe sensitive system/config info.
      // This prevents a remote agent from extracting API keys, tokens, etc.
      if (defaults?.a2aMode && !sandbox) {
        const a2aViolation = checkA2aCommandRestrictions(params.command);
        if (a2aViolation) {
          const execTagCtxA2a = defaults.sessionKey
            ? getSessionTagContext(defaults.sessionKey)
            : undefined;
          reportBoundaryViolation({
            type: "a2a_command_restriction",
            sessionKey: defaults.sessionKey,
            tagName: execTagCtxA2a?.tagName,
            tagWorkspaceId: execTagCtxA2a?.workspaceId,
            boundary: defaults.workspaceBoundary ?? workdir,
            attemptedPath: params.command,
            detail: `A2A restriction: ${a2aViolation}`,
          });
          throw new Error(
            `A2A security: ${a2aViolation}. ` +
              `In agent-to-agent mode, access to system configuration and credentials is restricted.`,
          );
        }
      }

      const inheritedBaseEnv = coerceEnv(process.env);
      const baseEnv = host === "sandbox" ? inheritedBaseEnv : sanitizeHostBaseEnv(inheritedBaseEnv);

      // Logic: Sandbox gets raw env. Host (gateway/node) must pass validation.
      // We validate BEFORE merging to prevent any dangerous vars from entering the stream.
      if (host !== "sandbox" && params.env) {
        validateHostEnv(params.env);
      }

      const mergedEnv = params.env ? { ...baseEnv, ...params.env } : baseEnv;

      const env = sandbox
        ? buildSandboxEnv({
            defaultPath: DEFAULT_PATH,
            paramsEnv: params.env,
            sandboxEnv: sandbox.env,
            containerWorkdir: containerWorkdir ?? sandbox.containerWorkdir,
          })
        : mergedEnv;

      if (!sandbox && host === "gateway" && !params.env?.PATH) {
        const shellPath = getShellPathFromLoginShell({
          env: process.env,
          timeoutMs: resolveShellEnvFallbackTimeoutMs(process.env),
        });
        applyShellPath(env, shellPath);
      }

      // `tools.exec.pathPrepend` is only meaningful when exec runs locally (gateway) or in the sandbox.
      // Node hosts intentionally ignore request-scoped PATH overrides, so don't pretend this applies.
      if (host === "node" && defaultPathPrepend.length > 0) {
        warnings.push(
          "Warning: tools.exec.pathPrepend is ignored for host=node. Configure PATH on the node host/service instead.",
        );
      } else {
        applyPathPrepend(env, defaultPathPrepend);
      }

      if (host === "node") {
        return executeNodeHostCommand({
          command: params.command,
          workdir,
          env,
          requestedEnv: params.env,
          requestedNode: params.node?.trim(),
          boundNode: defaults?.node?.trim(),
          sessionKey: defaults?.sessionKey,
          agentId,
          security,
          ask,
          timeoutSec: params.timeout,
          defaultTimeoutSec,
          approvalRunningNoticeMs,
          warnings,
          notifySessionKey,
          trustedSafeBinDirs,
        });
      }

      if (host === "gateway" && !bypassApprovals) {
        const gatewayResult = await processGatewayAllowlist({
          command: params.command,
          workdir,
          env,
          pty: params.pty === true && !sandbox,
          timeoutSec: params.timeout,
          defaultTimeoutSec,
          security,
          ask,
          safeBins,
          safeBinProfiles,
          agentId,
          sessionKey: defaults?.sessionKey,
          scopeKey: defaults?.scopeKey,
          warnings,
          notifySessionKey,
          approvalRunningNoticeMs,
          maxOutput,
          pendingMaxOutput,
          trustedSafeBinDirs,
        });
        if (gatewayResult.pendingResult) {
          return gatewayResult.pendingResult;
        }
        execCommandOverride = gatewayResult.execCommandOverride;
      }

      const explicitTimeoutSec = typeof params.timeout === "number" ? params.timeout : null;
      const backgroundTimeoutBypass =
        allowBackground && explicitTimeoutSec === null && (backgroundRequested || yieldRequested);
      const effectiveTimeout = backgroundTimeoutBypass
        ? null
        : (explicitTimeoutSec ?? defaultTimeoutSec);
      const getWarningText = () => (warnings.length ? `${warnings.join("\n")}\n\n` : "");
      const usePty = params.pty === true && !sandbox;

      // Preflight: catch a common model failure mode (shell syntax leaking into Python/JS sources)
      // before we execute and burn tokens in cron loops.
      await validateScriptFileForShellBleed({ command: params.command, workdir });

      const run = await runExecProcess({
        command: params.command,
        execCommand: execCommandOverride,
        workdir,
        env,
        sandbox,
        containerWorkdir,
        usePty,
        warnings,
        maxOutput,
        pendingMaxOutput,
        notifyOnExit,
        notifyOnExitEmptySuccess,
        scopeKey: defaults?.scopeKey,
        sessionKey: notifySessionKey,
        timeoutSec: effectiveTimeout,
        onUpdate,
      });

      let yielded = false;
      let yieldTimer: NodeJS.Timeout | null = null;

      // Tool-call abort should not kill backgrounded sessions; timeouts still must.
      const onAbortSignal = () => {
        if (yielded || run.session.backgrounded) {
          return;
        }
        run.kill();
      };

      if (signal?.aborted) {
        onAbortSignal();
      } else if (signal) {
        signal.addEventListener("abort", onAbortSignal, { once: true });
      }

      return new Promise<AgentToolResult<ExecToolDetails>>((resolve, reject) => {
        const resolveRunning = () =>
          resolve({
            content: [
              {
                type: "text",
                text: `${getWarningText()}Command still running (session ${run.session.id}, pid ${
                  run.session.pid ?? "n/a"
                }). Use process (list/poll/log/write/kill/clear/remove) for follow-up.`,
              },
            ],
            details: {
              status: "running",
              sessionId: run.session.id,
              pid: run.session.pid ?? undefined,
              startedAt: run.startedAt,
              cwd: run.session.cwd,
              tail: run.session.tail,
            },
          });

        const onYieldNow = () => {
          if (yieldTimer) {
            clearTimeout(yieldTimer);
          }
          if (yielded) {
            return;
          }
          yielded = true;
          markBackgrounded(run.session);
          resolveRunning();
        };

        if (allowBackground && yieldWindow !== null) {
          if (yieldWindow === 0) {
            onYieldNow();
          } else {
            yieldTimer = setTimeout(() => {
              if (yielded) {
                return;
              }
              yielded = true;
              markBackgrounded(run.session);
              resolveRunning();
            }, yieldWindow);
          }
        }

        run.promise
          .then((outcome) => {
            if (yieldTimer) {
              clearTimeout(yieldTimer);
            }
            if (yielded || run.session.backgrounded) {
              return;
            }
            if (outcome.status === "failed") {
              reject(new Error(outcome.reason ?? "Command failed."));
              return;
            }
            resolve({
              content: [
                {
                  type: "text",
                  text: `${getWarningText()}${outcome.aggregated || "(no output)"}`,
                },
              ],
              details: {
                status: "completed",
                exitCode: outcome.exitCode ?? 0,
                durationMs: outcome.durationMs,
                aggregated: outcome.aggregated,
                cwd: run.session.cwd,
              },
            });
          })
          .catch((err) => {
            if (yieldTimer) {
              clearTimeout(yieldTimer);
            }
            if (yielded || run.session.backgrounded) {
              return;
            }
            reject(err as Error);
          });
      });
    },
  };
}

export const execTool = createExecTool();
