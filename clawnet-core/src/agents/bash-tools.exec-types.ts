import type { ExecAsk, ExecHost, ExecSecurity } from "../infra/exec-approvals.js";
import type { SafeBinProfileFixture } from "../infra/exec-safe-bin-policy.js";
import type { BashSandboxConfig } from "./bash-tools.shared.js";

export type ExecToolDefaults = {
  host?: ExecHost;
  security?: ExecSecurity;
  ask?: ExecAsk;
  node?: string;
  pathPrepend?: string[];
  safeBins?: string[];
  safeBinTrustedDirs?: string[];
  safeBinProfiles?: Record<string, SafeBinProfileFixture>;
  agentId?: string;
  backgroundMs?: number;
  timeoutSec?: number;
  approvalRunningNoticeMs?: number;
  sandbox?: BashSandboxConfig;
  elevated?: ExecElevatedDefaults;
  allowBackground?: boolean;
  scopeKey?: string;
  sessionKey?: string;
  messageProvider?: string;
  notifyOnExit?: boolean;
  notifyOnExitEmptySuccess?: boolean;
  cwd?: string;
  /**
   * When set, the resolved workdir must be within this boundary directory.
   * Used for tag workspace isolation on gateway host (non-sandbox).
   * Note: This only validates the workdir param — it cannot prevent `cd` within shell commands.
   */
  workspaceBoundary?: string;
  /** True when responding to an A2A dialog — enables stricter command filtering
   *  (e.g., blocks env/set, ~/.config paths, printenv). */
  a2aMode?: boolean;
};

export type ExecElevatedDefaults = {
  enabled: boolean;
  allowed: boolean;
  defaultLevel: "on" | "off" | "ask" | "full";
};

export type ExecToolDetails =
  | {
      status: "running";
      sessionId: string;
      pid?: number;
      startedAt: number;
      cwd?: string;
      tail?: string;
    }
  | {
      status: "completed" | "failed";
      exitCode: number | null;
      durationMs: number;
      aggregated: string;
      cwd?: string;
    }
  | {
      status: "approval-pending";
      approvalId: string;
      approvalSlug: string;
      expiresAtMs: number;
      host: ExecHost;
      command: string;
      cwd?: string;
      nodeId?: string;
    };
