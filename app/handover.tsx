"use client";
// Tahap 2 kantor piksel: worker berjalan membawa kertas saat ada serah terima.
// - Hasil kerja masuk review  → worker berjalan ke meja manusia (yang sedang di kantor).
// - Task pindah ke worker lain → worker lama mengantarnya ke meja worker baru.
// - Task dialihkan ke manusia   → worker mengantarnya ke meja orang itu.
// Serah terima dideteksi dengan membandingkan data sebelum dan sesudah pembaruan (tiap 30 detik).
import { useEffect, useRef } from "react";
import type { Office } from "@/lib/office";
import { taskHolders, detectTransfers, type Holder, type Transfer } from "@/lib/workflow-transitions";

export type Handover = Transfer & { face?: string | null };

/** Mencari serah terima baru setiap kali data kantor diperbarui. */
export function useHandoverDetector(office: Office, reviewer: string | null, nameOf: (key: string) => string, onFound: (h: Handover[]) => void) {
  const prev = useRef<{ ws: string; map: Map<string, Holder> } | null>(null);
  useEffect(() => {
    const now = taskHolders(office);
    const before = prev.current?.ws === office.workspaceId ? prev.current.map : null;
    prev.current = { ws: office.workspaceId, map: now };
    if (!before) return;
    const found = detectTransfers(before, now, reviewer, nameOf);
    if (found.length) onFound(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [office]);
}
