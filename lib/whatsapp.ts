// WhatsApp drafts: agents write a message in a ```whatsapp block, and Virtual Office shows a
// "Send via WhatsApp" card that opens the member's own WhatsApp with the text filled in.
// Nothing is sent automatically: the member presses Send in WhatsApp.

export type Contact = { name: string; phone: string };

/** Digits only, in international form (Indonesian 08… becomes 628…). */
export function normalizePhone(raw: string) {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "62" + d.slice(1);
  d = d.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d : null;
}
export const showPhone = (d: string) => "+" + d.replace(/^(\d{2})(\d{3})(\d{4})(\d+)$/, "$1 $2 $3 $4");

const HONORIFIC = /^(bu|ibu|pak|bapak|mbak|mba|mas|kak|bang|teh|dr\.?|prof\.?|mr\.?|mrs\.?|ms\.?)\s+/i;
const plain = (s: string) => s.trim().replace(HONORIFIC, "").toLowerCase();

/** Find the contact an agent meant by "To: Bu Wanda" (honorifics ignored, first names allowed). */
export function findContact(list: Contact[], to: string) {
  const want = plain(to);
  if (!want) return null;
  return list.find(c => plain(c.name) === want)
    ?? list.find(c => plain(c.name).split(/\s+/)[0] === want.split(/\s+/)[0])
    ?? list.find(c => plain(c.name).includes(want) || want.includes(plain(c.name)))
    ?? null;
}

/** Split a ```whatsapp block into recipient, optional send time ("Send at: YYYY-MM-DD HH:MM") and message. */
export function parseDraft(block: string) {
  const lines = block.replace(/\s+$/, "").split("\n");
  let to = "", date = "", time = "", whenDone = false;
  while (lines.length) {
    const t = lines[0].match(/^\s*(?:to|kepada|untuk|recipient)\s*:\s*(.+)$/i);
    const w = lines[0].match(/^\s*(?:send at|kirim(?: pada)?|schedule)\s*:\s*(\d{4}-\d{2}-\d{2})(?:[ T]+(\d{1,2}[:.]\d{2}))?/i);
    const d = lines[0].match(/^\s*(?:send when|kirim saat|send after)\s*:\s*(?:this )?(?:task )?(?:is )?(?:done|selesai|finished|complete[d]?)\b/i);
    if (d) whenDone = true;
    else if (t && !to) to = t[1].trim();
    else if (w && !date) { date = w[1]; time = (w[2] ?? "09:00").replace(".", ":").padStart(5, "0"); }
    else break;
    lines.shift();
  }
  return { to, text: lines.join("\n").trim(), sendAt: date ? { date, time } : null, whenDone };
}
export const fmtSendAt = (s: { date: string; time: string }) => {
  const d = new Date(`${s.date}T00:00:00`);
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${s.time}`;
};

export const DEFAULT_NOTE = "🤖 _Pesan ini dikirim oleh virtual assistant {me}._";
export const withNote = (note: string, me: string, text: string) => {
  const n = note.replace(/\{me\}/g, me).trim();
  return n ? `${n}\n\n${text}` : text;
};
export const waLink = (phone: string, text: string) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

/** Instructions added to every agent so their WhatsApp drafts get a Send button. */
export const WA_MARKER = "## Kantor Virtual WhatsApp drafts";
const F = "```";
export const AGENT_WHATSAPP = `
${WA_MARKER}
Virtual Office can send WhatsApp messages for the member. When the member asks you to message someone on WhatsApp (now or at a set time), write each message in its own block like this:

${F}whatsapp
To: <recipient's name, as the member calls them>
Send at: YYYY-MM-DD HH:MM   (only if it should go out later; ${process.env.KANTOR_TIMEZONE || "Asia/Jakarta"} time, 24-hour)
<the message, exactly as it should be sent>
${F}

When the member wants a message to go out once a task is finished ("kirim WA kalau sudah selesai", "send it when this is done"), use \`Send when: done\` instead of \`Send at\`:

${F}whatsapp
To: <recipient's name>
Send when: done
<the message>
${F}

- Write that draft at the START, in your first reply on that task, so the member can approve it before the work is finished. Never wait until the end to show it.
- Put it on the task whose completion should trigger the message. The member presses "Approve, send when done" once; Virtual Office then sends it by itself the moment that task's status becomes done (no second click). If the task is cancelled, nothing is sent.
- When the work is finished and the only step left is this pre-approved message, set the task to done yourself, and say the message will go out automatically. Don't post the draft again at the end.
- If the facts in the message change before the task is done, post an updated draft and tell the member to approve the new card (and cancel the old one).

Virtual Office turns each block into a card with an "Approve & send" button. When the member presses it, the message is sent from their assistant's own WhatsApp number (or at the "Send at" time). If no assistant number is linked, the card opens the member's own WhatsApp instead.
- You don't need a tool or the multica CLI to send WhatsApp, and never say you can't send it. Say the drafts are ready and the member can press "Approve & send" on each card.
- Virtual Office keeps the phone numbers. Don't ask the member for phone numbers; the card asks if one is missing.
- One block per recipient. Only the message goes inside the block; put your explanations outside it.
- Virtual Office already adds a first line saying the message comes from the member's virtual assistant, so don't introduce yourself again or sign it as the member.
- Don't create a reminder task to send WhatsApp later; use "Send at" instead.`;
