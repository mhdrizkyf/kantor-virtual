// Penjaga kantor (hanya di server Node, di laptop): jalan tiap 5 menit selama app terbuka.
import { runWatchdog } from "./lib/watchdog";

const tick = () => runWatchdog()
  .then(r => { if (r.length) console.log("[penjaga]", r.join("; ")); })
  .catch(e => console.warn("[penjaga] gagal:", String(e).slice(0, 200)));

setTimeout(tick, 20_000);
setInterval(tick, 5 * 60_000);

// The assistant's WhatsApp number (if linked before): reconnect when the app starts.
setTimeout(() => { import("./lib/wa-bot").then(m => m.autoStartBot()).catch(() => {}); }, 5_000);
