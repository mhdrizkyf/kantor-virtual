import { workspace } from "@/lib/multica";
import { subscribeOfficeEvents } from "@/lib/office-events";
import { computeOfficeFingerprint } from "@/lib/office-fingerprint";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXTERNAL_CHECK_MS = 8_000;
const HEARTBEAT_MS = 25_000;

/**
 * Local real-time Server-Sent Events (SSE) stream for Virtual Office:
 * - Pushes local mutations (task create/approve/revise/handoff, chat, squad, door) in <50ms.
 * - Watches external Multica updates only while at least one visible tab holds this stream open.
 * - Cleans up all timers & subscriptions immediately on tab hide/close.
 */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const wsPick = u.get("ws");
  const initialFp = u.get("fp") || null;

  let wsId: string;
  try {
    const ws = await workspace(wsPick);
    wsId = ws.id;
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastFp: string | null = initialFp;
      let checking = false;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closeAll();
        }
      };

      const sendEvent = (eventName: string, payload: Record<string, unknown>) => {
        send(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      };

      const unsub = subscribeOfficeEvents(wsId, ev => {
        if (ev.fp) lastFp = ev.fp;
        sendEvent("office", {
          reason: ev.reason,
          wsId: ev.wsId,
          at: ev.at,
          ...(ev.fp ? { fp: ev.fp } : {}),
        });
      });

      const checkExternal = async () => {
        if (closed || checking) return;
        checking = true;
        try {
          const res = await computeOfficeFingerprint(wsId, 5000);
          if (closed) return;
          if (lastFp && res.fp !== lastFp) {
            lastFp = res.fp;
            sendEvent("office", { reason: "external", wsId, fp: res.fp, updatedAt: res.updatedAt, at: Date.now() });
          } else if (!lastFp) {
            lastFp = res.fp;
            sendEvent("ready", { wsId, fp: res.fp, updatedAt: res.updatedAt });
          }
        } catch {
          // Transient Multica error; keep stream alive and try next tick.
        } finally {
          checking = false;
        }
      };

      const pollTimer = setInterval(() => { void checkExternal(); }, EXTERNAL_CHECK_MS);
      const pingTimer = setInterval(() => { send(`: ping ${Date.now()}\n\n`); }, HEARTBEAT_MS);

      const closeAll = () => {
        if (closed) return;
        closed = true;
        clearInterval(pollTimer);
        clearInterval(pingTimer);
        unsub();
        req.signal.removeEventListener("abort", closeAll);
        try { controller.close(); } catch { /* already closed */ }
      };

      cleanup = closeAll;
      req.signal.addEventListener("abort", closeAll);

      // Handshake immediately so EventSource transitions to OPEN without waiting for Multica
      send(`retry: 3000\n`);
      sendEvent("connected", { wsId, at: Date.now() });
      void checkExternal();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
