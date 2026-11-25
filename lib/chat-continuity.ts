// Shared per-agent conversation continuity helpers (browser + tests).
// Keeps one ongoing chat thread per (workspace, agent) across ChatPanel, OfficeComposer, Desk Drawer, and Stapler
// until the user explicitly starts a new topic.

export type ChatSessionRef = {
  id: string;
  agentId: string;
  title: string;
  updatedAt: string;
  unread?: number;
  last?: string;
};

export function activeChatStorageKey(workspaceId: string, agentId: string): string {
  return `kantor-active-chat:${workspaceId}:${agentId}`;
}

export function readActiveChatId(workspaceId: string, agentId: string): string | null {
  if (typeof window === "undefined" || !workspaceId || !agentId) return null;
  try {
    const val = window.localStorage.getItem(activeChatStorageKey(workspaceId, agentId));
    return val && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}

export function writeActiveChatId(workspaceId: string, agentId: string, sessionId: string | null): void {
  if (typeof window === "undefined" || !workspaceId || !agentId) return;
  try {
    const key = activeChatStorageKey(workspaceId, agentId);
    if (sessionId && sessionId.trim()) {
      window.localStorage.setItem(key, sessionId.trim());
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage quota or private-mode restrictions.
  }
}

/**
 * Resolve which chat session should open for an agent so conversations in one context
 * stay in one continuous thread unless the user explicitly asks to start fresh.
 */
export function pickContinuitySession<T extends ChatSessionRef>(
  sessions: readonly T[],
  agentId: string,
  opts: {
    preferredId?: string | null;
    savedId?: string | null;
    startFresh?: boolean;
  } = {}
): T | null {
  if (opts.startFresh) return null;
  if (opts.preferredId) {
    const exact = sessions.find(s => s.id === opts.preferredId);
    if (exact) return exact;
  }
  const forAgent = sessions
    .filter(s => s.agentId === agentId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  if (!forAgent.length) return null;
  if (opts.savedId) {
    const saved = forAgent.find(s => s.id === opts.savedId);
    if (saved) return saved;
  }
  return forAgent[0];
}
