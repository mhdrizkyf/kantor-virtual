import type { Office } from "./office";

export type Holder = { who: string; status: string; title: string };
export type Transfer = { from: string; to: string; title: string; fromName: string; toName: string };

export function taskHolders(office: Office): Map<string, Holder> {
  const holders = new Map<string, Holder>();
  for (const [agentId, detail] of Object.entries(office.agentsDetail)) {
    for (const task of detail.tasks) holders.set(task.id, { who: agentId, status: task.status, title: task.title });
  }
  for (const task of office.attention.human) {
    if (task.assignee) holders.set(task.id, { who: `person:${task.assignee}`, status: task.status, title: task.title });
  }
  return holders;
}

/** Changes in Multica that should produce a visible handoff on the office floor. */
export function detectTransfers(before: Map<string, Holder>, after: Map<string, Holder>, reviewer: string | null, nameOf: (key: string) => string): Transfer[] {
  const transfers: Transfer[] = [];
  for (const [id, current] of after) {
    const previous = before.get(id);
    if (!previous || previous.who.startsWith("person:")) continue;
    const to = previous.who !== current.who ? current.who
      : current.status === "in_review" && previous.status !== "in_review" && reviewer ? `person:${reviewer}` : null;
    if (to && to !== previous.who) transfers.push({ from: previous.who, to, title: current.title, fromName: nameOf(previous.who), toName: nameOf(to) });
  }
  return transfers;
}
