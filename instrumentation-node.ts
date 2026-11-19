// Penjaga kantor (hanya di server Node, di laptop): jalan tiap 5 menit selama app terbuka.
import { runWatchdog } from "./lib/watchdog";

const tick = () => runWatchdog()
  .then(r => { if (r.length) console.log("[penjaga]", r.join("; ")); })
  .catch(e => console.warn("[penjaga] gagal:", String(e).slice(0, 200)));

setTimeout(tick, 20_000);
setInterval(tick, 5 * 60_000);

// The assistant's WhatsApp number (if linked before): reconnect when the app starts.
setTimeout(() => { import("./lib/wa-bot").then(m => m.autoStartBot()).catch(() => {}); }, 5_000);

// Knowledge & files: copy files agents attached to tasks into their OneDrive Outputs folder, every 15 minutes.
const filesTick = () => import("./lib/knowledge").then(m => m.syncOutputs()).then(r => { if (r !== "Up to date.") console.log("[files]", r); }).catch(e => console.warn("[files] failed:", String(e).slice(0, 200)));
setTimeout(filesTick, 60_000);
setInterval(filesTick, 15 * 60_000);

// Task chains: start the next task in a chain once the previous one is done (see lib/chain.ts), every 2 minutes.
const chainTick = () => import("./lib/chain").then(m => m.runChains()).then(r => { if (r.length) console.log("[chain]", r.join("; ")); }).catch(e => console.warn("[chain] failed:", String(e).slice(0, 200)));
setTimeout(chainTick, 30_000);
setInterval(chainTick, 2 * 60_000);
