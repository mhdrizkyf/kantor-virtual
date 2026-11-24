import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodexQuota = {
  online: boolean;
  onlineCount: number;
  totalCount: number;
  remaining5h: number;
  remainingWeekly: number;
  reset5hAt: string | null;
  resetWeeklyAt: string | null;
  creditsBalance: string | null;
  planType: string | null;
  source: "codex-live" | "codex-session" | "multica-quota" | "runtime-status";
  updatedAt: string | null;
};

type RawRateLimitWindow = {
  used_percent?: number;
  usedPercent?: number;
  window_minutes?: number;
  windowDurationMins?: number;
  resets_at?: number;
  resetsAt?: number;
};

type RawRateLimits = {
  limit_id?: string | null;
  limitId?: string | null;
  primary?: RawRateLimitWindow | null;
  secondary?: RawRateLimitWindow | null;
  credits?: {
    has_credits?: boolean;
    hasCredits?: boolean;
    unlimited?: boolean;
    balance?: string | number | null;
  } | null;
  plan_type?: string | null;
  planType?: string | null;
};

type AppServerRateLimitResult = {
  ordinaryUsageAllowed?: boolean;
  rateLimits?: RawRateLimits | null;
  rateLimitsByLimitId?: Record<string, RawRateLimits> | null;
};

function fmtClock(epochSec: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(epochSec * 1000));
  } catch {
    return new Date(epochSec * 1000).toISOString().slice(11, 16);
  }
}

function fmtShortDayClock(epochSec: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(epochSec * 1000));
  } catch {
    return new Date(epochSec * 1000).toISOString().slice(0, 16);
  }
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function windowRemaining(
  win: RawRateLimitWindow | null | undefined,
  nowMs: number,
  timeZone: string,
  shortDay: boolean
): { remaining: number | null; resetAt: string | null } {
  if (!win) return { remaining: null, resetAt: null };
  const used = typeof win.usedPercent === "number" ? win.usedPercent : win.used_percent;
  const resetSec = typeof win.resetsAt === "number" ? win.resetsAt : win.resets_at;
  if (typeof used !== "number") return { remaining: null, resetAt: null };
  const resetMs = typeof resetSec === "number" ? resetSec * 1000 : 0;
  if (resetMs > 0 && nowMs >= resetMs) {
    return { remaining: 100, resetAt: null };
  }
  return {
    remaining: clampPct(100 - used),
    resetAt: resetMs > 0 ? (shortDay ? fmtShortDayClock(resetSec!, timeZone) : fmtClock(resetSec!, timeZone)) : null,
  };
}

function parseCredits(credits: RawRateLimits["credits"]): string | null {
  if (!credits) return null;
  if (credits.unlimited) return "Unlimited";
  const has = Boolean(credits.hasCredits ?? credits.has_credits);
  if (has && credits.balance != null && String(credits.balance) !== "0") {
    return String(credits.balance);
  }
  return null;
}

/** Pure parser for `codex app-server` `account/rateLimits/read` JSON-RPC result. */
export function parseCodexAppServerRateLimits(
  result: AppServerRateLimitResult | null | undefined,
  opts: {
    runtimes: { provider: string; online: boolean; quotaOut: boolean; quotaReset: string | null }[];
    timeZone: string;
    now?: Date;
  }
): CodexQuota | null {
  if (!result) return null;
  const rl = result.rateLimitsByLimitId?.codex ?? result.rateLimits;
  if (!rl || (!rl.primary && !rl.secondary)) return null;

  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const codexRuntimes = opts.runtimes.filter(r => r.provider === "codex");
  const onlineCount = codexRuntimes.filter(r => r.online).length;
  const totalCount = codexRuntimes.length;

  const p = windowRemaining(rl.primary, nowMs, opts.timeZone, false);
  const s = windowRemaining(rl.secondary, nowMs, opts.timeZone, true);

  let remaining5h = p.remaining ?? 100;
  const remainingWeekly = s.remaining ?? 100;
  if (result.ordinaryUsageAllowed === false && remaining5h > 0 && remainingWeekly > 0) {
    remaining5h = 0;
  }

  return {
    online: totalCount > 0 ? onlineCount > 0 : true,
    onlineCount,
    totalCount,
    remaining5h,
    remainingWeekly,
    reset5hAt: p.resetAt,
    resetWeeklyAt: s.resetAt,
    creditsBalance: parseCredits(rl.credits),
    planType: rl.planType ?? rl.plan_type ?? null,
    source: "codex-live",
    updatedAt: fmtClock(Math.floor(nowMs / 1000), opts.timeZone),
  };
}

function listRecentSessionFiles(sessionsRoot: string, limit = 12): { file: string; mtimeMs: number }[] {
  const out: { file: string; mtimeMs: number }[] = [];
  function walk(dir: string, depth: number) {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        try {
          out.push({ file: full, mtimeMs: fs.statSync(full).mtimeMs });
        } catch {
          // ignore temp race
        }
      }
    }
  }
  walk(sessionsRoot, 0);
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, limit);
}

function extractLatestRateLimits(filePath: string): RawRateLimits | null {
  try {
    const stat = fs.statSync(filePath);
    const chunkSize = Math.min(stat.size, 196608);
    if (chunkSize <= 0) return null;
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(chunkSize);
    try {
      fs.readSync(fd, buf, 0, chunkSize, Math.max(0, stat.size - chunkSize));
    } finally {
      fs.closeSync(fd);
    }
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || !line.includes("rate_limits")) continue;
      try {
        const parsed = JSON.parse(line);
        const rl: RawRateLimits | undefined = parsed?.payload?.rate_limits ?? parsed?.rate_limits;
        if (rl && (rl.primary || rl.secondary)) {
          const lid = rl.limitId ?? rl.limit_id;
          if (lid && lid !== "codex") continue;
          return rl;
        }
      } catch {
        // skip partial first line
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Synchronous fallback reading local Codex rollout jsonl & Multica runtime state. */
export function readCodexQuota(opts: {
  runtimes: { provider: string; online: boolean; quotaOut: boolean; quotaReset: string | null }[];
  timeZone: string;
  codexHome?: string;
  now?: Date;
}): CodexQuota {
  const nowMs = (opts.now ?? new Date()).getTime();
  const codexRuntimes = opts.runtimes.filter(r => r.provider === "codex");
  const onlineCount = codexRuntimes.filter(r => r.online).length;
  const totalCount = codexRuntimes.length;
  const online = onlineCount > 0;
  const multicaQuotaOut = codexRuntimes.find(r => r.quotaOut) ?? null;

  const codexHome = opts.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const files = listRecentSessionFiles(path.join(codexHome, "sessions"), 12);

  let latestRl: RawRateLimits | null = null;
  let latestMtimeMs = 0;
  for (const f of files) {
    const rl = extractLatestRateLimits(f.file);
    if (rl) {
      latestRl = rl;
      latestMtimeMs = f.mtimeMs;
      break;
    }
  }

  let remaining5h = online ? 100 : 0;
  let remainingWeekly = online ? 100 : 0;
  let reset5hAt: string | null = null;
  let resetWeeklyAt: string | null = null;
  let creditsBalance: string | null = null;
  let planType: string | null = null;
  let source: CodexQuota["source"] = "runtime-status";
  let updatedAt: string | null = null;

  if (latestRl) {
    source = "codex-session";
    planType = latestRl.planType ?? latestRl.plan_type ?? null;
    updatedAt = latestMtimeMs ? fmtClock(Math.floor(latestMtimeMs / 1000), opts.timeZone) : null;
    const p = windowRemaining(latestRl.primary, nowMs, opts.timeZone, false);
    const s = windowRemaining(latestRl.secondary, nowMs, opts.timeZone, true);
    if (p.remaining != null) {
      remaining5h = p.remaining;
      reset5hAt = p.resetAt;
    }
    if (s.remaining != null) {
      remainingWeekly = s.remaining;
      resetWeeklyAt = s.resetAt;
    }
    creditsBalance = parseCredits(latestRl.credits);
  }

  if (multicaQuotaOut) {
    source = "multica-quota";
    remaining5h = 0;
    if (multicaQuotaOut.quotaReset) reset5hAt = multicaQuotaOut.quotaReset;
  }

  return {
    online,
    onlineCount,
    totalCount,
    remaining5h,
    remainingWeekly,
    reset5hAt,
    resetWeeklyAt,
    creditsBalance,
    planType,
    source,
    updatedAt,
  };
}

function resolveCodexBinary(): string | null {
  const candidates = [
    process.env.CODEX_BIN,
    path.join(os.homedir(), ".local", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ].filter((p): p is string => Boolean(p));
  for (const bin of candidates) {
    try {
      if (fs.existsSync(bin)) return bin;
    } catch {
      // continue
    }
  }
  return "codex";
}

const LIVE_CACHE_TTL_MS = 45_000;
let liveCache: { at: number; result: AppServerRateLimitResult } | null = null;
let liveInFlight: Promise<AppServerRateLimitResult | null> | null = null;

function queryCodexAppServerRateLimits(timeoutMs = 4200): Promise<AppServerRateLimitResult | null> {
  const bin = resolveCodexBinary();
  if (!bin) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    let buf = "";
    const finish = (val: AppServerRateLimitResult | null, child?: ReturnType<typeof spawn>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child && !child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
      resolve(val);
    };

    let child: ReturnType<typeof spawn>;
    const timer = setTimeout(() => finish(null, child), timeoutMs);
    try {
      child = spawn(bin, ["app-server"], {
        stdio: ["pipe", "pipe", "ignore"],
        env: {
          ...process.env,
          PATH: `${path.join(os.homedir(), ".local", "bin")}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`,
        },
      });
    } catch {
      finish(null);
      return;
    }

    child.on("error", () => finish(null, child));
    child.on("exit", () => finish(null, child));
    child.stdout?.on("data", chunk => {
      buf += String(chunk);
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg?.id === 2 && msg?.result) {
            finish(msg.result as AppServerRateLimitResult, child);
            return;
          }
        } catch {
          // ignore non-json log lines
        }
      }
    });

    try {
      child.stdin?.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { clientInfo: { name: "kantor-virtual", version: "1.0" }, capabilities: {} },
        }) + "\n"
      );
      child.stdin?.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "account/rateLimits/read",
          params: {},
        }) + "\n"
      );
    } catch {
      finish(null, child);
    }
  });
}

/**
 * Fetch real-time live Codex remaining credit via official `codex app-server` RPC
 * (`account/rateLimits/read`), cached for 45s with graceful fallback to local session telemetry.
 */
export async function fetchLiveCodexQuota(opts: {
  runtimes: { provider: string; online: boolean; quotaOut: boolean; quotaReset: string | null }[];
  timeZone: string;
  force?: boolean;
}): Promise<CodexQuota> {
  const now = Date.now();
  let rpcResult: AppServerRateLimitResult | null = null;
  if (!opts.force && liveCache && now - liveCache.at < LIVE_CACHE_TTL_MS) {
    rpcResult = liveCache.result;
  } else {
    if (!liveInFlight) {
      liveInFlight = queryCodexAppServerRateLimits()
        .then(res => {
          if (res) liveCache = { at: Date.now(), result: res };
          return res;
        })
        .finally(() => {
          liveInFlight = null;
        });
    }
    rpcResult = await liveInFlight;
  }

  const parsed = parseCodexAppServerRateLimits(rpcResult, {
    runtimes: opts.runtimes,
    timeZone: opts.timeZone,
  });
  if (parsed) return parsed;
  return readCodexQuota(opts);
}
