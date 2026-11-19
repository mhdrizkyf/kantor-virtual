// Tells agents they can take screenshots of public web pages (scripts/web-shot.sh), so reports can show
// evidence (pricing pages, sign-up flows, feature screens) instead of only links.
import { join } from "node:path";

export const SHOTS_MARKER = "## Kantor Virtual web screenshots";
const SCRIPT = join(process.cwd(), "scripts", "web-shot.sh");
export const AGENT_SHOTS = `
${SHOTS_MARKER}
You can take a screenshot of any public web page on this computer:

    "${SCRIPT}" <url> <file.png> [width] [height]

- Default is a 1440×1000 desktop view. Use a bigger height (e.g. 3000) for a long page. 390 844 gives a rough phone view.
- Always open the PNG with the Read tool and check it before using it. Some sites show a bot check ("Performing security verification") or a cookie banner instead of the page; then try another page of that site, or list the URL for the member to capture by hand. Never use a blocked screenshot as evidence.
- Use screenshots as evidence in reports and decks: one claim per screenshot, with a caption that says what the reader should notice and the URL + date.
- Never say you can't take screenshots.`;
