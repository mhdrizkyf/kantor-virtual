import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {(phase: string) => import('next').NextConfig} */
// whatsapp-web.js (optional, for the assistant's WhatsApp number) runs as a normal Node package, not bundled.
export default function nextConfig(phase) {
  return {
    reactStrictMode: true,
    // Keep dev and production build caches separate so running `next build`
    // never corrupts a live `next dev` server's webpack chunks.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
    serverExternalPackages: ["whatsapp-web.js", "puppeteer", "puppeteer-core"],
  };
}
