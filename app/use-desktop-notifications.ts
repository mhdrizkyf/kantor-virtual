"use client";
// Opt-in native Desktop Browser Notifications powered by live office updates.
// Only notifies when the user enabled it AND the browser tab is hidden/backgrounded.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Office } from "@/lib/office";

const DESKTOP_NOTIF_KEY = "kantor-desktop-notif";

export function useDesktopNotifications(office: Office) {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setSupported(true);
    setPermission(Notification.permission);
    try {
      const saved = localStorage.getItem(DESKTOP_NOTIF_KEY) === "1";
      setEnabled(saved && Notification.permission === "granted");
    } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return { ok: false, message: "Browser does not support desktop notifications." };
    }
    if (enabled) {
      setEnabled(false);
      try { localStorage.setItem(DESKTOP_NOTIF_KEY, "0"); } catch { /* ignore */ }
      return { ok: true, message: "Desktop notifications muted." };
    }
    let perm = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
    }
    setPermission(perm);
    if (perm !== "granted") {
      setEnabled(false);
      return { ok: false, message: "Permission denied. Allow notifications in browser settings." };
    }
    setEnabled(true);
    try { localStorage.setItem(DESKTOP_NOTIF_KEY, "1"); } catch { /* ignore */ }
    return { ok: true, message: "Desktop notifications enabled for reviews & alerts." };
  }, [enabled]);

  // Track previously seen review & failed IDs so we only notify on newly arrived items
  const seenReviewRef = useRef<Set<string> | null>(null);
  const seenFailedRef = useRef<Set<string> | null>(null);
  const wsRef = useRef(office.workspaceId);

  useEffect(() => {
    if (wsRef.current !== office.workspaceId) {
      wsRef.current = office.workspaceId;
      seenReviewRef.current = null;
      seenFailedRef.current = null;
    }
    const reviewIds = new Set(office.attention.review.map(t => t.id));
    const failedIds = new Set(office.attention.failed.map(f => f.id));

    if (seenReviewRef.current === null || seenFailedRef.current === null) {
      seenReviewRef.current = reviewIds;
      seenFailedRef.current = failedIds;
      return;
    }

    const newReviews = office.attention.review.filter(t => !seenReviewRef.current!.has(t.id));
    const newFails = office.attention.failed.filter(f => !seenFailedRef.current!.has(f.id));
    seenReviewRef.current = reviewIds;
    seenFailedRef.current = failedIds;

    if (!enabled || typeof document === "undefined" || document.visibilityState === "visible") return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    if (newReviews.length > 0) {
      const first = newReviews[0];
      const title = (first.questionCount ?? 0) > 0
        ? `${first.assignee ?? "Agent"} butuh keputusan (${office.workspace})`
        : `${first.assignee ?? "Agent"} siap direview (${office.workspace})`;
      const body = newReviews.length === 1
        ? first.title
        : `${first.title} (+${newReviews.length - 1} lainnya)`;
      try {
        const n = new Notification(title, { body, tag: `kantor-rev-${office.workspaceId}` });
        n.onclick = () => { window.focus(); n.close(); };
      } catch { /* ignore OS notification error */ }
    } else if (newFails.length > 0) {
      const first = newFails[0];
      try {
        const n = new Notification(`Task run gagal (${office.workspace})`, {
          body: `${first.agent}: ${first.issueTitle ?? "Task"} — ${first.error ?? "cek detail"}`,
          tag: `kantor-fail-${office.workspaceId}`,
        });
        n.onclick = () => { window.focus(); n.close(); };
      } catch { /* ignore */ }
    }
  }, [office.workspaceId, office.workspace, office.attention.review, office.attention.failed, enabled]);

  return { supported, permission, enabled, toggle };
}
