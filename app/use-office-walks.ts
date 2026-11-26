"use client";
// Floor walk/handover orchestration, 2-way workflow dialog events, and preview animation timeline.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Desk, Office } from "@/lib/office";
import { useHandoverDetector, type Handover } from "./handover";
import type { OfficeWalk } from "./reference-office";
import { resolveHandoverDelivery, type ActivityEvent, type HandoverStyle } from "@/lib/munder-workflows";

export function useOfficeWalks(opts: {
  office: Office;
  allDesks: Desk[];
  uniqueDesks: Desk[];
  seen: Record<string, string>;
  people: string[];
  meId?: string | null;
  handoverStyle: HandoverStyle;
  onResetRoom: () => void;
  logEvent: (ev: Omit<ActivityEvent, "id" | "at">, persist?: boolean) => void;
}) {
  const { office, allDesks, uniqueDesks, seen, people, meId, handoverStyle, onResetRoom, logEvent } = opts;
  const [walks, setWalks] = useState<OfficeWalk[]>([]);
  const [flowNotice, setFlowNotice] = useState("");
  const [flowPaused, setFlowPaused] = useState(false);
  const [previewStep, setPreviewStep] = useState<number | null>(null);

  const walkingIds = useMemo(() => new Set(walks.map(w => w.from)), [walks]);
  const ownerName = office.members.find(m => m.id === meId)?.name ?? people[0] ?? null;
  const here = (p: string) => !!seen[p] && Date.now() - Date.parse(seen[p]) < 5 * 60000;
  const reviewer = (ownerName && here(ownerName) ? ownerName : people.find(here)) ?? ownerName;

  const ownerActorId = useMemo(() => {
    const o = office.members.find(m => m.id === meId) ?? office.members[0];
    return o ? `person:${o.id}` : null;
  }, [office.members, meId]);

  const resolveActorKey = useCallback((k: string) => {
    if (!k.startsWith("person:")) return k;
    const raw = k.slice(7);
    const byId = office.members.find(m => m.id === raw);
    if (byId) return `person:${byId.id}`;
    const byName = office.members.find(m => m.name === raw);
    if (byName) return `person:${byName.id}`;
    return ownerActorId ?? k;
  }, [office.members, ownerActorId]);

  const nameOf = useCallback((k: string) => {
    if (!k.startsWith("person:")) return allDesks.find(d => d.agentId === k)?.name ?? "Agent";
    const raw = k.slice(7);
    return office.members.find(m => m.id === raw || m.name === raw)?.name ?? raw;
  }, [allDesks, office.members]);

  const startWalks = useCallback((hs: (Handover & { kind?: OfficeWalk["kind"] })[]) => {
    if (!hs.length) return;
    onResetRoom();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const resolved = hs.map(h => ({
      ...h,
      from: resolveActorKey(h.from),
      to: resolveActorKey(h.to),
      face: uniqueDesks.find(d => d.agentId === h.from)?.face ?? null,
      key: h.from + ":" + Date.now() + Math.random(),
    }));

    const walkList: typeof resolved = [];
    const bubbleList: typeof resolved = [];
    resolved.forEach((h, idx) => {
      const delivery = reduced ? "bubble" : resolveHandoverDelivery(handoverStyle, idx);
      if (delivery === "bubble") bubbleList.push(h);
      else walkList.push(h);
    });

    if (walkList.length) {
      setWalks(cur => [...cur, ...walkList.filter(h => !cur.some(c => c.from === h.from))]);
    }
    bubbleList.forEach((h, idx) => {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("kantor:dialog", {
          detail: {
            fromId: h.from,
            toId: h.to,
            fromName: h.fromName,
            toName: h.toName,
            title: h.title,
            kind: h.kind ?? "handoff",
          },
        }));
      }, idx * 500);
    });

    setFlowNotice(resolved.map(h => `${h.fromName} → ${h.toName}: ${h.title}`).join(" · "));
    resolved.forEach(h => logEvent({ kind: "handoff", title: `${h.fromName} → ${h.toName}`, detail: h.title, agentId: h.to.startsWith("person:") ? undefined : h.to }));
  }, [uniqueDesks, logEvent, resolveActorKey, handoverStyle, onResetRoom]);

  useHandoverDetector(office, reviewer, nameOf, startWalks);

  const handoverRef = useRef({ startWalks, nameOf });
  handoverRef.current = { startWalks, nameOf };

  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent).detail;
      const { startWalks: go, nameOf: nm } = handoverRef.current;
      go([{ ...d, fromName: nm(d.from), toName: nm(d.to) }]);
    };
    addEventListener("kantor:handover", f);
    return () => removeEventListener("kantor:handover", f);
  }, []);

  useEffect(() => {
    const f = (event: Event) => {
      const detail = (event as CustomEvent<{ action: string; title: string; agentId: string | null }>).detail;
      if (!detail) return;
      if (detail.action === "approve" || detail.action === "done") {
        setFlowNotice(`Approved: ${detail.title}`);
        const agent = uniqueDesks.find(d => d.agentId === detail.agentId);
        if (agent && ownerActorId) {
          window.dispatchEvent(new CustomEvent("kantor:dialog", {
            detail: { fromId: ownerActorId, toId: agent.agentId, fromName: ownerName ?? "You", toName: agent.name, title: detail.title, kind: "approve" },
          }));
          const cheer = uniqueDesks.find(d => d.agentId !== agent.agentId && d.squad === agent.squad && !["off", "closed"].includes(d.state));
          if (cheer) {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent("kantor:speech", {
                detail: { actorId: cheer.agentId, tone: "approved", badge: "Apresiasi", text: `Keren ${agent.name.split(/\s+/)[0]}! 👏`, pixelKind: "heart", ms: 2600 },
              }));
            }, 1900);
          }
        } else if (detail.agentId) {
          window.dispatchEvent(new CustomEvent("kantor:speech", {
            detail: { actorId: detail.agentId, tone: "approved", badge: "Selesai", text: "Siap, terima kasih! 🙌", pixelKind: "heart", ms: 3400 },
          }));
        }
      } else if (detail.action === "assigned" || detail.action === "queued") {
        setFlowNotice(`${detail.action === "assigned" ? "Assigned" : "Queued"}: ${detail.title}`);
        const agent = uniqueDesks.find(d => d.agentId === detail.agentId);
        if (agent && ownerActorId) {
          startWalks([{ from: ownerActorId, to: agent.agentId, title: detail.title, fromName: ownerName ?? "You", toName: agent.name, kind: "assign" }]);
        }
      } else if (detail.action === "revise" || detail.action === "reply") {
        setFlowNotice(`Feedback sent: ${detail.title}`);
        const agent = uniqueDesks.find(d => d.agentId === detail.agentId);
        if (agent) {
          if (ownerActorId) {
            startWalks([{ from: ownerActorId, to: agent.agentId, title: detail.title, fromName: ownerName ?? "You", toName: agent.name, kind: "revise" }]);
          } else {
            window.dispatchEvent(new CustomEvent("kantor:speech", {
              detail: { actorId: agent.agentId, tone: "revise", badge: "Revisi", text: "Oke, langsung saya perbaiki! ✎", pixelKind: "mail", ms: 3200 },
            }));
          }
        }
      }
    };
    addEventListener("kantor:workflow", f);
    return () => removeEventListener("kantor:workflow", f);
  }, [ownerActorId, ownerName, startWalks, uniqueDesks]);

  useEffect(() => {
    if (!flowNotice) setFlowPaused(false);
  }, [flowNotice]);

  useEffect(() => {
    if (!flowNotice || flowPaused) return;
    const t = setTimeout(() => setFlowNotice(""), 5000);
    return () => clearTimeout(t);
  }, [flowNotice, flowPaused]);

  useEffect(() => {
    if (previewStep === null) return;
    const first = uniqueDesks[0];
    if (previewStep === 0 && first) {
      const fromId = ownerActorId ?? uniqueDesks[1]?.agentId;
      const fromLabel = ownerActorId ? (ownerName ?? "Owner") : (uniqueDesks[1]?.name ?? "Manager");
      if (fromId && fromId !== first.agentId) {
        startWalks([{ from: fromId, to: first.agentId, title: "Q4 Launch Brief", fromName: fromLabel, toName: first.name, kind: "assign" }]);
      }
    } else if (previewStep === 3 && first) {
      if (ownerActorId) {
        window.dispatchEvent(new CustomEvent("kantor:dialog", {
          detail: { fromId: ownerActorId, toId: first.agentId, fromName: ownerName ?? "Owner", toName: first.name, title: "Q4 Launch Brief", kind: "approve" },
        }));
      } else {
        window.dispatchEvent(new CustomEvent("kantor:speech", {
          detail: { actorId: first.agentId, tone: "approved", badge: "Selesai", text: "Siap, terima kasih! 🙌", pixelKind: "heart", ms: 3400 },
        }));
      }
    }
    const durations = [4200, 3200, 7500, 3200];
    const timer = setTimeout(() => setPreviewStep(step => (step === 3 ? null : step === null ? null : step + 1)), durations[previewStep] ?? 3200);
    return () => clearTimeout(timer);
  }, [previewStep, ownerActorId, ownerName, startWalks, uniqueDesks]);

  const handleFloorDone = useCallback((key: string) => setWalks(items => items.filter(x => x.key !== key)), []);
  const handleFloorDelivered = useCallback((h: Handover) => {
    if (h.title === "Preview handover") setPreviewStep(step => (step === 2 ? 3 : step));
  }, []);

  return {
    walks,
    walkingIds,
    ownerName,
    ownerActorId,
    nameOf,
    startWalks,
    flowNotice,
    setFlowNotice,
    setFlowPaused,
    previewStep,
    setPreviewStep,
    handleFloorDone,
    handleFloorDelivered,
  };
}
