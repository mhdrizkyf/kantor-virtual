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
  source: "codex-session" | "multica-quota" | "runtime-status";
  updatedAt: string | null;
};

type RawRateLimitWindow = {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
};

type RawRateLimits = {
  limit_id?: string | null;
  primary?: RawRateLimitWindow | null;
  secondary?: RawRateLimitWindow | null;
  credits?: { has_credits?: boolean; unlimited?: boolean; balance?: string | number | null } | null;
  plan_type?: string | null;
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
          // ignore race with deleted temp file
        }
      }
    }
  }
  walk(sessionsRoot, 0);
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, limit);
}

/** Read only the tail chunk (up to 192 KB) of a Codex rollout jsonl to find the latest real rate_limits event. */
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
          if (rl.limit_id && rl.limit_id !== "codex") continue;
          return rl;
        }
      } catch {
        // skip partial first line from chunk slice
      }
    }
  } catch {
    return null;
  }
  return null;
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Resolve real Codex remaining credit / quota by combining:
 * 1. Live local Codex CLI session telemetry (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
 * 2. Live Multica Codex runtime & quota-error status
 */
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
    planType = latestRl.plan_type ?? null;
    updatedAt = latestMtimeMs ? fmtClock(Math.floor(latestMtimeMs / 1000), opts.timeZone) : null;

    const p = latestRl.primary;
    if (p && typeof p.used_percent === "number") {
      const pResetMs = typeof p.resets_at === "number" ? p.resets_at * 1000 : 0;
      if (pResetMs > 0 && nowMs >= pResetMs) {
        remaining5h = 100;
        reset5hAt = null;
      } else {
        remaining5h = clampPct(100 - p.used_percent);
        reset5hAt = pResetMs > 0 ? fmtClock(p.resets_at!, opts.timeZone) : null;
      }
    }

    const sec = latestRl.secondary;
    if (sec && typeof sec.used_percent === "number") {
      const sResetMs = typeof sec.resets_at === "number" ? sec.resets_at * 1000 : 0;
      if (sResetMs > 0 && nowMs >= sResetMs) {
        remainingWeekly = 100;
        resetWeeklyAt = null;
      } else {
        remainingWeekly = clampPct(100 - sec.used_percent);
        resetWeeklyAt = sResetMs > 0 ? fmtShortDayClock(sec.resets_at!, opts.timeZone) : null;
      }
    }

    if (latestRl.credits?.unlimited) {
      creditsBalance = "Unlimited";
    } else if (latestRl.credits?.has_credits && latestRl.credits.balance != null && String(latestRl.credits.balance) !== "0") {
      creditsBalance = String(latestRl.credits.balance);
    }
  }

  // Live Multica quota-exhausted error always takes precedence if Codex just hit its cap!
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
