/** @type {import('next').NextConfig} */
// whatsapp-web.js (optional, for the assistant's WhatsApp number) runs as a normal Node package, not bundled.
const nextConfig = { reactStrictMode: true, serverExternalPackages: ["whatsapp-web.js", "puppeteer", "puppeteer-core"] };
export default nextConfig;
