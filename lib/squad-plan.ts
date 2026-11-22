/** A useful first room for agents that have no local squad assignment yet. */
export function suggestedSquad(name: string, description: string): string {
  const classify = (role: string) => {
    if (/\b(qa|quality|evidence|governance|compliance|testing|test engineer)\b/.test(role)) return "Quality & Governance";
    if (/\b(delivery|execution|engineer|developer|implementation|builder)\b/.test(role)) return "Delivery";
    if (/\b(design|creative|marketing|content)\b/.test(role)) return "Creative";
    if (/\b(research|analyst|insight)\b/.test(role)) return "Research";
    if (/\b(chief|orchestrat|operations|assistant|secretary|meeting|admin)\b/.test(role)) return "Operations";
    return null;
  };
  return classify(name.toLowerCase()) ?? classify(description.toLowerCase()) ?? "General";
}

export function validSquad(value: string): string {
  const squad = value.trim().replace(/\s+/g, " ");
  if (!squad || squad.length > 48 || /[<>\n\r]/.test(squad)) throw new Error("Squad name must be 1–48 plain characters.");
  return squad;
}
