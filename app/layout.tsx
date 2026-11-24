import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Virtual Office", description: "A visual office for AI agents on Multica" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

const THEME_INIT = `try{var s=localStorage.getItem("color-scheme");if(s==="light"||s==="dark"){var m=document.querySelector('meta[name="color-scheme"]');if(m)m.content=s;}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        />
      </head>
      {/* Ekstensi browser (mis. Grammarly) menambah atribut di <body>; abaikan peringatannya. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
