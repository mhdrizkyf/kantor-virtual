/** Lightweight event trigger to open the human DM drawer without statically importing Messages. */
export function openChat(userId?: string | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("kantor:dm", { detail: { userId: userId ?? null } }));
}
