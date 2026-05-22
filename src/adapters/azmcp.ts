import { spawn } from "node:child_process";
import { normalize } from "../normalize/index.js";
import type {
  AdapterCapabilities,
  AdapterInput,
  LogSourceAdapter,
  ValidationResult,
} from "./index.js";
import type { NormalizedRowset } from "../types.js";

export const AZMCP_NPM_SPEC = "@azure/mcp@^2";
export const AZMCP_DEFAULT_TIMEOUT_MS = 5 * 60_000;
export const AZMCP_MIN_VERSION_MAJOR = 2;

export type SpawnLike = (
  command: string,
  args: string[],
  options: { signal?: AbortSignal },
) => SubprocessHandle;

export interface SubprocessHandle {
  stdoutText: Promise<string>;
  stderrText: Promise<string>;
  done: Promise<{ code: number | null }>;
}

function defaultSpawn(
  command: string,
  args: string[],
  options: { signal?: AbortSignal },
): SubprocessHandle {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    signal: options.signal,
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
  child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));

  const stdoutText = new Promise<string>((resolve) => {
    child.stdout.on("end", () =>
      resolve(Buffer.concat(stdoutChunks).toString("utf8")),
    );
  });
  const stderrText = new Promise<string>((resolve) => {
    child.stderr.on("end", () =>
      resolve(Buffer.concat(stderrChunks).toString("utf8")),
    );
  });
  const done = new Promise<{ code: number | null }>((resolve) => {
    child.on("close", (code) => resolve({ code }));
    child.on("error", () => resolve({ code: -1 }));
  });

  return { stdoutText, stderrText, done };
}

export interface AzmcpAdapterOptions {
  command?: string;
  fallbackArgs?: string[];
  spawn?: SpawnLike;
  versionCheck?: () => Promise<ValidationResult>;
}

function parseAzmcpMajor(versionText: string): number | undefined {
  const m = versionText.match(/(\d+)\.\d+(?:\.\d+)?/);
  if (!m || !m[1]) return undefined;
  return Number(m[1]);
}

export class AzmcpAdapter implements LogSourceAdapter {
  readonly id = "azmcp";
  readonly capabilities: AdapterCapabilities = { live: true, paste: false };

  private readonly command: string;
  private readonly fallbackArgs: string[];
  private readonly spawnFn: SpawnLike;
  private readonly versionOverride?: () => Promise<ValidationResult>;
  private validationCache?: ValidationResult;

  constructor(opts: AzmcpAdapterOptions = {}) {
    this.command = opts.command ?? "azmcp";
    this.fallbackArgs = opts.fallbackArgs ?? ["-y", AZMCP_NPM_SPEC];
    this.spawnFn = opts.spawn ?? defaultSpawn;
    this.versionOverride = opts.versionCheck;
  }

  async validate(): Promise<ValidationResult> {
    if (this.validationCache) return this.validationCache;
    if (this.versionOverride) {
      this.validationCache = await this.versionOverride();
      return this.validationCache;
    }

    const onPath = await this.probeVersion(this.command, ["--version"]);
    if (onPath.ok && onPath.major !== undefined && onPath.major >= AZMCP_MIN_VERSION_MAJOR) {
      this.validationCache = { ok: true };
      return this.validationCache;
    }
    if (onPath.ok && onPath.major !== undefined) {
      this.validationCache = {
        ok: false,
        reason: `azmcp version "${onPath.versionText}" is below the required major (${AZMCP_MIN_VERSION_MAJOR}.x)`,
        installHint: `Install: npm i -g ${AZMCP_NPM_SPEC} (or rely on auto-spawn via npx)`,
      };
      return this.validationCache;
    }

    const viaNpx = await this.probeVersion("npx", [...this.fallbackArgs, "--version"]);
    if (viaNpx.ok && viaNpx.major !== undefined && viaNpx.major >= AZMCP_MIN_VERSION_MAJOR) {
      this.validationCache = { ok: true };
      return this.validationCache;
    }

    this.validationCache = {
      ok: false,
      reason: `azmcp not found on PATH and npx fallback failed for ${AZMCP_NPM_SPEC}`,
      installHint: `Install: npm i -g ${AZMCP_NPM_SPEC}`,
    };
    return this.validationCache;
  }

  private async probeVersion(
    command: string,
    args: string[],
  ): Promise<{ ok: boolean; major?: number; versionText: string }> {
    try {
      const handle = this.spawnFn(command, args, {});
      const { code } = await handle.done;
      const stdout = await handle.stdoutText;
      if (code !== 0) return { ok: false, versionText: "" };
      const major = parseAzmcpMajor(stdout);
      return { ok: true, major, versionText: stdout.trim() };
    } catch {
      return { ok: false, versionText: "" };
    }
  }

  async fetch(
    input: AdapterInput,
    signal: AbortSignal,
  ): Promise<NormalizedRowset> {
    if (input.kind !== "azmcp") {
      throw new Error(`AzmcpAdapter cannot handle input kind=${input.kind}`);
    }

    const validation = await this.validate();
    if (!validation.ok) {
      throw new Error(`${validation.reason}. ${validation.installHint}`);
    }

    const timeoutMs = input.timeoutMs ?? AZMCP_DEFAULT_TIMEOUT_MS;
    const timeoutController = new AbortController();
    const compositeAbort = new AbortController();
    const onParentAbort = () => compositeAbort.abort();
    signal.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const onTimeout = () => compositeAbort.abort();
    timeoutController.signal.addEventListener("abort", onTimeout, { once: true });

    const args = [
      "monitor",
      "workspace",
      "log",
      "query",
      "--subscription",
      input.subscriptionId,
      "--workspace",
      input.workspaceId,
      "--table",
      input.table,
      "--query",
      input.query,
      "--output",
      "json",
    ];
    if (input.hours !== undefined) args.push("--hours", String(input.hours));
    if (input.limit !== undefined) args.push("--limit", String(input.limit));

    let handle: SubprocessHandle;
    try {
      handle = this.spawnFn(this.command, args, {
        signal: compositeAbort.signal,
      });
    } catch {
      handle = this.spawnFn("npx", [...this.fallbackArgs, ...args], {
        signal: compositeAbort.signal,
      });
    }

    try {
      const [stdout, stderr, result] = await Promise.all([
        handle.stdoutText,
        handle.stderrText,
        handle.done,
      ]);

      if (timeoutController.signal.aborted) {
        const lastStderrLine = stderr.trim().split("\n").pop() ?? "";
        throw new Error(
          `azmcp subprocess timed out after ${timeoutMs}ms. Last stderr: ${lastStderrLine}`,
        );
      }

      if (result.code !== 0) {
        const tail = stderr.trim().split("\n").pop() ?? "(no stderr)";
        throw new Error(`azmcp exited ${result.code}: ${tail}`);
      }

      return normalize("azure-monitor-json", stdout);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onParentAbort);
      timeoutController.signal.removeEventListener("abort", onTimeout);
    }
  }
}
