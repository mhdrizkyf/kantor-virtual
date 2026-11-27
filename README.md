# Virtual Office (Kantor Virtual)

A cozy, pixel-art virtual office and operational cockpit for your [Multica](https://multica.ai) workspace. Watch your human teammates and AI agents work across a living 2× Stardew-inspired office floor, triage approvals and questions, orchestrate multi-agent workflows, and manage chats, files, and integrations—all from one local-first web app.

## Highlights

- **Living Stardew-Style Pixel Office:** Seamless 2× pixel-art studio (`public/office-harvest.js`, `public/art/stardew-v1/`, and `public/art/retina-v2.7/`) featuring a Founder/CEO Executive Suite, symmetrical desk pods (23 workstations), East Executive Boardroom, Espresso Coffee Bar, Breakout Lounge with TV, Kitchen, Restroom, Garage, interactive office pets, live wall clock, natural owner roaming, and 2-way agent check-ins.
- **24 Customizable Character Presets:** Pick from 24 illustrated pixel avatars with picker filters for **both AI agents and human teammates**—synced consistently across the office floor, Task Board, task pop-ups, mentions, and sidebar roster.
- **Klipi Quick Capture (`⌥⇧K` / `⌥⇧S`):** Expressive floating paperclip-note mascot (`Klipi`) at the bottom-right dock for screenshots, microphone meeting/voice recordings (preserved in a compact live dock pill when minimized), quick notes, and drag-and-drop file capture into an agent chat.
- **Actionable Live Office Feed & Quick Approval Bar:** Real-time activity hub tracking handoffs, approvals, revisions, delegations, standups, chains, watchdog retries, and schedule events—plus one-click task review and approval directly from the floor HUD.
- **Command Palette (`⌘K` / `Ctrl+K`):** Instant keyboard navigation and quick search across tasks, agent chats, desks, actions, and workspaces.
- **Multi-Agent Orchestration, Playbooks & Workflow Hub:** Delegate goals across the team in **chain**, **parallel**, or **staged** modes, reuse saved playbooks, run team standups, inspect workspace metrics, and monitor integrations (Telegram, WhatsApp, Taiga, OneDrive, and signed outbound webhooks).
- **Live Sync, Codex Credit Meter & Studio Sound Mixer:** Local Server-Sent Events (`/api/office/stream`) + optimistic Kanban updates, live Codex credit usage meter with breakdown popover, light/dark theme toggle, desktop notifications, and a built-in Web Audio **Lo-Fi Beat / Working / Mix** sound mixer.

## Where data lives

**Multica is the source of truth for workspace work.** Virtual Office also keeps optional integrations, caches, and preferences locally on your computer.

- Workspace members, agents, projects, issues, comments, runtimes, and notifications come from Multica.
- Core workspace actions write straight back to Multica: creating tasks, approving work, replying to agents, inviting people, or creating projects. Open Multica next to it and you will see the same changes immediately.
- There is no separate account or external database. Local preferences and integration state live under `data/` and are excluded from Git.

Virtual Office also stores these conventions in Multica:

| Feature | How it's stored in Multica |
|---|---|
| **Office open / closed & auto-schedule** (pauses or resumes agent work) | workspace settings (`kantor`) |
| **Who's in the office** | a hidden issue called `🟢 Virtual Office · who's in` |
| **Person-to-person chat** | one hidden issue per pair, titled `💬 Chat · A & B` |
| **Telegram reminders** | hidden issues prefixed with `⏰` (`kantor_remind_at` metadata) |
| **Agent summaries, questions & draft cards** | standardized `## Kantor Virtual ...` blocks appended to agent instructions |
| **Watchdog notifications, quota failover & retries** | workspace settings (`kantor_watch`) |
| **Parked tasks and office transitions** | issue metadata (`kantor_parked`) and workspace settings |

Leave those hidden issues in the backlog and don't delete them. Virtual Office filters them out of its own views.

Local files under `data/` (excluded from Git; back them up securely when moving computers):

| Local path | Purpose |
|---|---|
| `characters.json` | Pixel character preset choices per workspace for AI agents and human teammates. |
| `squads.json` | Squad room assignments per workspace and agent. |
| `chains.json` | Multi-step task chain order, stages, and crash-safe start/recovery progress. |
| `playbooks.json` | Reusable workflow playbook templates for the Orchestrator. |
| `activity.json` | Persistent Office Feed event log (approvals, handoffs, chains, watchdog, schedule). |
| `work-calendar.json` | Optional per-workspace custom holidays and extra work dates. |
| `contacts.json` | WhatsApp contacts, saved groups, and the assistant disclaimer note. |
| `wa-session/`, `wa-queue.json` | WhatsApp Web login session and approved immediate/scheduled/when-done send queue. Keep private. |
| `taiga.json` | Taiga credentials (`0600` permissions), project/story metadata, and logged activity keys. Keep private. |
| `files-sync.json` | OneDrive folder links and copied-file sync metadata (actual files stay in OneDrive). |
| `judul.json` | Optional personal friendly issue titles; see `data/judul.example.json`. |
| `cache/` | Local snapshot and digest caches (`snapshots.json`, `digests.json`) for faster loads. |
| `shot-profile/`, `.locks/` | Headless browser screenshot profile and cross-process atomic locks. |

`notes/` and `public/me/` are also local and excluded from Git.

### Characters & Klipi

- **Characters:** Choose from **24 pixel character presets** when creating an agent, from **Team Members → Edit profile**, or via the interactive avatar picker for both human teammates and AI agents. Choices are stored locally in `data/characters.json` and stay synced across the floor, Task Board, task pop-ups, mentions, and sidebar; an agent's Multica profile emoji remains a separate setting.
- **Klipi:** The floating paperclip-note mascot at the bottom-right dock lets you capture a screen image, record microphone audio for a meeting or voice note, jot a quick note, or drag-and-drop a file straight onto the dock. Background recordings stay alive in a compact dock pill while you keep working across the app. Review the preview, choose an agent, add instructions, and press **Send** to deliver it into a Multica chat. Toggle Klipi anytime with **Option/Alt + Shift + K** (or **Option/Alt + Shift + S**). Captures stay local until you press Send.

### Office Floor, Work Hours & Ambience

The Office opens as a full-window interactive 2× pixel-art scene with 23 workstation positions (1 Founder/CEO private office + up to 5 human teammate desks + remaining AI agent desks with pagination). Hover or focus any seat for an unclipped top-layer status card, click desks to open the interactive agent drawer, or click room props (boardroom, coffee bar, lounge, pets) for natural interactions.

- **Working hours:** Monday–Friday **08:00–17:30** in `KANTOR_TIMEZONE` (default `Asia/Jakarta`).
- **Lunch break:** **12:00–13:15** on work days—available agents naturally stroll to the lounge/coffee bar.
- **Holidays & overtime:** Includes built-in Indonesian national holidays (2026–2027) and respects custom overrides in `data/work-calendar.json` (weekends and holidays remain off-duty unless an agent is actively working or the date is listed in `extraWorkDates`):

```json
{ "WORKSPACE_ID": { "holidays": ["2026-12-25"], "extraWorkDates": ["2026-12-26"] } }
```

- **Studio Sound Mixer:** Toggle locally synthesized **Lo-Fi Beat**, **Working** (soft typing & mouse clicks), or **Mix** with a real-time volume slider—zero external audio files, and `prefers-reduced-motion` pauses ambient canvas movement.

## What you need

- **A Multica account** with at least one workspace, on either:
  - **multica.ai** (hosted), or
  - **a self-hosted Multica server** (e.g. `multica.playdev.online`).
- **Node.js 20 or newer (LTS, recommended Node 22)** from [nodejs.org](https://nodejs.org).
- **One way to sign in:**
  - **Multica Desktop** installed and signed in on the same computer (easiest), or
  - **a personal access token** from Multica (Multica web app → Settings → Tokens; starts with `mul_`).
- **Optional:** Git, so the launcher can update itself.

Virtual Office runs **locally on your own computer** (`http://127.0.0.1:3456`). Your Multica token stays strictly on the server side and never leaves your machine.

## Quick start

### 1. Get the code

```bash
git clone https://github.com/mhdrizkyf/kantor-virtual.git
cd kantor-virtual
```

Or download the ZIP from GitHub (**Code → Download ZIP**), unzip it, and open a terminal in that folder.

### 2. Create your settings file

macOS / Linux:

```bash
cp .env.example .env.local
```

Windows (Command Prompt):

```bat
copy .env.example .env.local
```

Open `.env.local` and pick your Multica server:

| Server | `MULTICA_API_URL` | `MULTICA_APP_URL` |
|---|---|---|
| multica.ai | `https://api.multica.ai` | `https://multica.ai` |
| multica.playdev.online | `https://api.multica.playdev.online` | `https://multica.playdev.online` |
| your own server | your server's API address | your server's web address |

Then choose how to sign in:

- **With Multica Desktop:** leave `MULTICA_TOKEN` empty. The app reads the local Multica Desktop login matching `MULTICA_API_URL`.
- **With a token:** paste your personal access token after `MULTICA_TOKEN=`. Treat it like a password and never commit `.env.local`.

### 3. Start it

**The easy way:** double-click the launcher in the folder:

- **macOS:** `Buka Kantor.command` (first time: right-click → **Open**; if downloaded as ZIP, run `chmod +x "Buka Kantor.command"` once).
- **Windows:** `Buka Kantor.cmd`.

**The developer way:**

```bash
npm ci
npm run dev
```

Then open http://127.0.0.1:3456.

### Moving to another computer

Clone `main`, install Node.js 22 LTS and Git, run `npm ci`, copy `.env.example` to `.env.local`, and sign in to Multica Desktop (or set `MULTICA_TOKEN`). Transfer needed local files from `data/` securely (`characters.json`, `squads.json`, `playbooks.json`, `work-calendar.json`, unfinished `chains.json`). Keep credential/session files private and avoid running two copies of the automatic watchdog against the same workspace simultaneously.

## What's inside

| Surface | What it provides |
|---|---|
| **Office (`/`)** | 23-seat animated Stardew-style pixel office, live **Office Feed**, **Quick Approval Bar**, **Needs Attention** drawer, Codex credit meter, Studio Sound Mixer, quick message composer, and **Controls** (open/close switch, auto-schedule, workflow preview). |
| **Task Board (`/papan`)** | Per-project Kanban (`Backlog → Ready → In progress → Needs review → Done`) with optimistic drag-and-drop moves, assignee filters, and project creation. |
| **Team Members (`/tim`)** | People and AI agents, workload meters, email invites, agent creation/profile editing, AI engine switching, and 24-preset avatar picker. |
| **Knowledge & Files (`/files`)** | Per-agent OneDrive `Knowledge` & `Outputs` folders, linked external OneDrive folders, drag-and-drop uploads, and 15-minute automatic attachment syncing. |
| **Task Pop-up** | Two-column review workspace: conversation + inline Office/PDF/image/CSV/Markdown previews + interactive **WhatsApp** and **Taiga** action cards on the left; parsed `## Summary`, interactive `## Questions` answer cards, `@mentions`, and approve/revise/stop/restart controls on the right. |
| **Workflow & Integrations Hub** | Inspect and manage active **Task Chains**, **Workspace Metrics**, **Playbooks**, **Team Standups**, **Goal Orchestration** (`chain` / `parallel` / `staged`), and **Integration Health** (including webhook test pings). |
| **Command Palette (`⌘K` / `Ctrl+K`)** | Quick jump across tasks, agent chats, desks, workspaces, and office actions. |
| **Continuous Agent Chat & Ask Mika** | Persistent per-context agent chat with history, attachments, and one-click "Turn into task" / manager delegation. |
| **Messages, Reminders & WhatsApp Contacts** | Human-to-human DMs, scheduled Telegram reminders, WhatsApp contact/group book, and optional `whatsapp-web.js` assistant bot. |
| **Attachment Viewer (`/lampiran/[id]`)** | Authenticated full-page browser previewer for task/chat attachments (images, PDF, audio, video, CSV, Markdown, sandboxed HTML, and zero-dependency `.pptx`/`.docx`/`.xlsx` rendering). |
| **Klipi (`⌥⇧K`)** | Floating quick-capture mascot for screenshots, background meeting/voice recording, notes, and files. |

## Optional settings (`.env.local`)

| Setting | What it does |
|---|---|
| `NEXT_PUBLIC_KANTOR_MANAGER` | Name of the agent behind the floating "Ask …" chat. Default is `Mika`. |
| `KANTOR_TIMEZONE` | Time zone for working hours, lunch break, due dates, and digests. Default is `Asia/Jakarta`. |
| `MULTICA_WORKSPACE_ID` | Workspace ID to open by default. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHATS`, `TELEGRAM_BOTS` | Telegram alerts, morning digests, and reminders. See `setup/SETUP-TELEGRAM.md`. |
| `TAIGA_URL`, `TAIGA_PROJECT`, `TAIGA_STORY` | Optional Taiga server URL, project slug, and user story ref for daily activity logging (all three required before connecting). |
| `KANTOR_FILES_FOLDER`, `KANTOR_ONEDRIVE` | Top folder name inside OneDrive (default `Kantor Virtual`) and optional explicit OneDrive root path. |
| `KANTOR_CHROME` | Optional Chrome/Chromium executable path for the WhatsApp Web bot (`whatsapp-web.js`). |
| `CODEX_HOME`, `CODEX_BIN` | Optional overrides for local Codex credit polling (`lib/codex-quota.ts`). |
| `KANTOR_WEBHOOK_URL`, `KANTOR_WEBHOOK_SECRET` | Optional outbound workflow webhook endpoint and `X-Kantor-Secret` header for lifecycle events (`task.approved`, `task.revised`, `task.handoff`, `task.failed`, `office.toggled`). |
| `KANTOR_AUTO_HEAL_STUCK`, `KANTOR_STUCK_MINUTES` | Set `KANTOR_AUTO_HEAL_STUCK=1` to let the watchdog automatically restart runs stuck longer than `KANTOR_STUCK_MINUTES`. |
| `KANTOR_ALLOWED_HOSTS` | Comma-separated extra `Host` values allowed by the `/api/*` security guard (defaults to loopback: `localhost`, `127.0.0.1`, `[::1]`). |
| `KANTOR_NO_WATCHDOG` | Set to `1` to disable in-process background timers during local development. |

### Syncing agent instructions

Task pop-ups, WhatsApp draft cards, Taiga activity cards, reminders, and web screenshots work best when agents include the Kantor Virtual instruction blocks. Preview or apply them to all agents in your workspace:

```bash
npm run agents:format -- --dry
npm run agents:format
```

Agents created from **Team Members** include these blocks automatically, and you can also sync instructions from the Integrations Hub.

## Good to know

- **Who shows as "in the office":** A person shows as in the office while Virtual Office is open or their Multica Desktop / runtime is online; otherwise their last-seen timestamp is shown.
- **Agents run where their runtime runs:** Each Multica agent runs on a specific runtime (usually a laptop running Multica Desktop). Online agents remain seated at their desks (showing `Standby · ready for tasks` when idle); offline runtimes show `"Laptop off"`.
- **Private runtimes & roles:** Only a runtime's owner can assign agents to a private runtime, and actions like opening/closing the office or inviting members require workspace **owner** or **admin** rights in Multica.
- **Customizing styles:** Styling is organized into modular stylesheets under `app/styles/01-tokens-base.css` through `08-avatars-theme-adv.css` (imported by `app/globals.css`), with pixel icons in `app/pixel-icon.tsx`.

## Troubleshooting

| You see | Try |
|---|---|
| `"Not signed in to Multica on this laptop"` | Sign in to Multica Desktop for `MULTICA_API_URL`, or set `MULTICA_TOKEN` in `.env.local`, then reload. |
| `401` / `403` errors | Check that your token matches the configured Multica server, hasn't expired, and your role permits the action. |
| Blank page or runtime error after updating | Stop the app (`Ctrl+C` or close the launcher window) and start it again. |
| Port `3456` already in use | Close the other running copy, or run `npm run dev -- -p 3457`. |

## For developers

- **Stack:** Next.js 15 (App Router), React 19, TypeScript (`strict: true`). All Multica API calls run server-side in `lib/multica.ts`; credentials never reach the browser.
- **Security guard:** `middleware.ts` (`lib/request-guard.ts`) protects `/api/*` against DNS rebinding and cross-origin CSRF by restricting local `Host` headers to loopback addresses (`localhost`, `127.0.0.1`, `[::1]`, extendable via `KANTOR_ALLOWED_HOSTS`) and enforcing same-origin `Origin` / `Sec-Fetch-Site` / `Referer` checks on mutating requests. OOXML previews (`lib/office-preview.ts`) enforce ZIP bounds and decompression caps and render inside `sandbox=""` iframes. Local JSON stores use atomic locked writes (`lib/json-store.ts`, `lib/process-lock.ts`).
- **Platform notes:** Core Multica views work on macOS and Windows. Local OneDrive auto-discovery (`~/Library/CloudStorage/OneDrive*`), Finder Open/Reveal, web screenshots (`scripts/web-shot.sh`), and WhatsApp bot Chrome auto-discovery are currently macOS-focused; set `KANTOR_ONEDRIVE` and `KANTOR_CHROME` to override paths on other platforms.
- **Scripts:**
  - `npm run typecheck` — TypeScript check (`tsc --noEmit`).
  - `npm test` — `node:test` suites covering Multica workflows, office sync, security hardening, Retina workstations, campus pathing, floor seats, office schedule/clock, and feed/workflow helpers.
  - `npm run build` — Production Next.js build (including Edge Middleware).
  - `npm run office:measure -- --baseline` and `npm run office:measure` — Benchmark Office load latency and API call counts.
  - `npm run penjaga:uji` — Dry-run the office watchdog (supports `--kuota=claude` simulation).
  - `npm run telegram:cek` / `npm run telegram:tes` — Discover Telegram chat IDs and send a test notification.
- **GitHub Actions:**
  - `.github/workflows/ci.yml` — Runs `npm ci`, `typecheck`, `test`, and `build` on pushes to `main` and pull requests.
  - `.github/workflows/penjaga.yml` — Optional scheduled watchdog (every 30 minutes, 07:00–23:30 WIB); see `setup/SETUP-TELEGRAM.md`.

## License & Artwork Attribution

MIT. See [LICENSE](LICENSE).

- **Scene Engine:** Builds on the MIT-licensed procedural office engine from [Munder Difflin](https://github.com/HarnessMD/munder-difflin) (copyright 2026 Chaitanya Giri; license included in `public/vendor/munder/LICENSE`), extended with a modular TypeScript engine in `lib/office-engine/`. Only procedural/open art is bundled; separately licensed LimeZu tilesets are not included.
- **Office World & Workstations:** Uses the Stardew-inspired 2× pixel-art environment (`public/office-harvest.js` + `public/art/stardew-v1/`) and Golden Retina Assets v2.7 workstation pack (`public/art/retina-v2.7/` + `public/retina-workstation.js`), alongside user-supplied reference textures in `public/art/office-reference.png` (not covered by the Munder MIT license). Append `?retina=0` to the Office URL to fall back to the legacy 1× workstation renderer.
