// Edge-safe request guard for /api/* routes: blocks DNS rebinding (Host check) and cross-origin CSRF.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export type GuardResult = { ok: true } | { ok: false; status: number; error: string };

function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase();
}

function hostnameOf(host: string): string {
  const clean = normalizeHost(host);
  if (!clean) return "";
  if (clean.startsWith("[")) {
    const end = clean.indexOf("]");
    return end >= 0 ? clean.slice(0, end + 1) : clean;
  }
  const colon = clean.indexOf(":");
  return colon >= 0 ? clean.slice(0, colon) : clean;
}

function allowedHost(host: string, env: Record<string, string | undefined>): boolean {
  if (env.NETLIFY || env.VERCEL) return true;
  const clean = normalizeHost(host);
  const name = hostnameOf(clean);
  if (!name) return false;
  if (LOOPBACK_HOSTS.has(name)) return true;
  const extra = (env.KANTOR_ALLOWED_HOSTS ?? "")
    .split(",")
    .map(normalizeHost)
    .filter(Boolean);
  return extra.includes(clean) || extra.includes(name);
}

function urlHost(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return normalizeHost(u.host);
  } catch {
    return null;
  }
}

/** Validate Host (all /api/* requests) and Origin / Sec-Fetch-Site / Referer (mutating requests). */
export function checkApiRequest(
  req: Pick<Request, "method" | "url" | "headers">,
  env: Record<string, string | undefined> = process.env,
): GuardResult {
  const fallbackHost = (() => {
    try { return normalizeHost(new URL(req.url).host); } catch { return ""; }
  })();
  const host = normalizeHost(req.headers.get("host") ?? "") || fallbackHost;
  if (!host || !allowedHost(host, env)) {
    return { ok: false, status: 403, error: "Forbidden host." };
  }

  const method = (req.method || "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) return { ok: true };

  // Fetch metadata: reject cross-site or cross-port same-site browser mutations.
  const fetchSite = (req.headers.get("sec-fetch-site") ?? "").trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { ok: false, status: 403, error: "Cross-site request blocked." };
  }

  // Origin header: always sent by browsers on cross-origin mutations and sandboxed ("null") frames.
  const origin = req.headers.get("origin");
  if (origin !== null) {
    const trimmed = origin.trim();
    if (!trimmed || trimmed.toLowerCase() === "null") {
      return { ok: false, status: 403, error: "Cross-origin request blocked." };
    }
    const parsed = urlHost(trimmed);
    if (!parsed || parsed !== host) {
      return { ok: false, status: 403, error: "Cross-origin request blocked." };
    }
    return { ok: true };
  }

  // Fallback for clients that omit Origin but send Referer.
  const referer = req.headers.get("referer");
  if (referer !== null && referer.trim()) {
    const parsed = urlHost(referer.trim());
    if (!parsed || parsed !== host) {
      return { ok: false, status: 403, error: "Cross-origin request blocked." };
    }
  }

  return { ok: true };
}
