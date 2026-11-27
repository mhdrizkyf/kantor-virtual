import { NextResponse } from "next/server";
import { loadDirectory, workspace } from "@/lib/multica";
import { botFor, telegramReady } from "@/lib/telegram";
import { status as taigaStatus } from "@/lib/taiga";
import { botState } from "@/lib/wa-bot";
import { syncInfo } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

function maskedWebhookHost(raw?: string): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim());
    return `${u.protocol}//${u.host}${u.pathname.length > 24 ? `${u.pathname.slice(0, 24)}…` : u.pathname}`;
  } catch {
    return null;
  }
}

export type IntegrationHealthItem = {
  id: "webhook" | "telegram" | "whatsapp" | "taiga" | "knowledge";
  name: string;
  status: "connected" | "configured" | "warning" | "off";
  summary: string;
  detail: string;
  canTest?: boolean;
};

/** Unified integration health inspector (never leaks tokens or secrets). */
export async function GET(req: Request) {
  const wsPick = new URL(req.url).searchParams.get("ws");
  try {
    const ws = await workspace(wsPick);
    const [dir, wa] = await Promise.all([
      loadDirectory(ws.id).catch(() => null),
      botState().catch(() => ({ status: "off" as const })),
    ]);
    const tgOffice = {
      id: ws.id,
      slug: ws.slug,
      name: ws.name,
      members: dir?.members.map(m => m.name) ?? [],
    };
    const tgReady = telegramReady(tgOffice);
    const tgBot = botFor(tgOffice);
    const taiga = (() => { try { return taigaStatus(); } catch { return { configured: false, connected: false, user: null, story: null }; } })();
    const kb = (() => { try { return syncInfo(); } catch { return { root: null, lastSync: null, lastResult: null, agents: {} as Record<string, string> }; } })();
    const webhookUrl = process.env.KANTOR_WEBHOOK_URL?.trim();
    const webhookHost = maskedWebhookHost(webhookUrl);

    const items: IntegrationHealthItem[] = [
      {
        id: "webhook",
        name: "Outbound Webhook",
        status: webhookHost ? "connected" : "off",
        summary: webhookHost ? "Active (Slack / Discord / n8n)" : "Not configured",
        detail: webhookHost
          ? `Target: ${webhookHost}${process.env.KANTOR_WEBHOOK_SECRET ? " · signed" : ""}`
          : "Set KANTOR_WEBHOOK_URL in .env.local to emit task.approved, task.revised, task.handoff & task.failed events.",
        canTest: !!webhookHost,
      },
      {
        id: "telegram",
        name: "Telegram Notifications",
        status: tgReady ? "connected" : "off",
        summary: tgReady ? (tgBot?.own ? "Dedicated workspace bot" : "Shared bot ready") : "Not configured",
        detail: tgReady
          ? "Watchdog alerts, reminders & morning summaries enabled."
          : "Set TELEGRAM_BOT_TOKEN & chat mapping in .env.local to enable Telegram alerts.",
      },
      {
        id: "whatsapp",
        name: "WhatsApp Assistant",
        status: wa.status === "ready" ? "connected" : wa.status === "starting" || wa.status === "code" ? "warning" : "off",
        summary: wa.status === "ready" ? `Connected (+${wa.phone ?? "linked"})` : wa.status === "missing" ? "Add-on not installed" : `Status: ${wa.status}`,
        detail: wa.status === "ready"
          ? "Drafts can be sent & scheduled directly from the assistant number."
          : "Open WhatsApp contacts in the sidebar to link or check assistant status.",
      },
      {
        id: "taiga",
        name: "Taiga Activity Sync",
        status: taiga.connected ? "connected" : taiga.configured ? "warning" : "off",
        summary: taiga.connected ? `Connected (${taiga.user ?? "signed in"})` : taiga.configured ? "Needs login" : "Not configured",
        detail: taiga.connected
          ? `Auto-logs approved daily review tasks${taiga.story ? ` to ${taiga.story}` : ""}.`
          : "Configure TAIGA_URL in .env.local to sync approved work logs.",
      },
      {
        id: "knowledge",
        name: "Knowledge & Files (OneDrive)",
        status: kb.root ? "connected" : "off",
        summary: kb.root ? `${Object.keys(kb.agents ?? {}).length} agent folder(s) linked` : "No root folder yet",
        detail: kb.lastSync
          ? `Last sync: ${kb.lastSync}${kb.lastResult ? ` · ${kb.lastResult}` : ""}`
          : "Open Knowledge & Files in the sidebar to connect shared references.",
      },
    ];

    return NextResponse.json({ workspaceId: ws.id, workspaceName: ws.name, items });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

/** Test outbound webhook connectivity with a safe synthetic ping. */
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { ws?: string; action?: string };
    if (b.action !== "test-webhook") {
      return NextResponse.json({ error: "Unknown integration action." }, { status: 400 });
    }
    const url = process.env.KANTOR_WEBHOOK_URL?.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: "KANTOR_WEBHOOK_URL is not configured in .env.local." }, { status: 400 });
    }
    const ws = await workspace(b.ws ?? null).catch(() => ({ id: b.ws ?? "", name: "Virtual Office" }));
    const secret = process.env.KANTOR_WEBHOOK_SECRET?.trim();
    const t0 = Date.now();
    const res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-Kantor-Secret": secret } : {}),
      },
      body: JSON.stringify({
        event: "webhook.test",
        at: new Date().toISOString(),
        payload: { wsId: ws.id, workspaceName: ws.name, message: "Test ping from Virtual Office" },
      }),
    });
    const latencyMs = Date.now() - t0;
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      latencyMs,
      target: maskedWebhookHost(url),
      message: res.ok ? `Webhook responded HTTP ${res.status} in ${latencyMs}ms.` : `Webhook returned HTTP ${res.status} (${latencyMs}ms).`,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
