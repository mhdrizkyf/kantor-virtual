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

/** Split a ```whatsapp block into recipient and message. */
export function parseDraft(block: string) {
  const lines = block.replace(/\s+$/, "").split("\n");
  const m = lines[0]?.match(/^\s*(?:to|kepada|untuk|recipient)\s*:\s*(.+)$/i);
  const to = m ? m[1].trim() : "";
  const text = (m ? lines.slice(1) : lines).join("\n").trim();
  return { to, text };
}

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
When you draft a message that the member will send to someone on WhatsApp, put each message in its own block like this, so Virtual Office shows a "Send via WhatsApp" button:

${F}whatsapp
To: <recipient's name, as the member calls them>
<the message, exactly as it should be sent>
${F}

- One block per recipient. Only the message goes inside the block; put your explanations outside it.
- Don't sign it as the member and don't add a note about who sent it: Virtual Office adds a line saying it comes from the member's virtual assistant.
- You can't send WhatsApp messages yourself. The member checks the text and presses Send.`;
