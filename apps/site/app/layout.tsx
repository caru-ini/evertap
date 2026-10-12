import "@evertap/ui/globals.css";
import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SITE_URL } from "../lib/layout.tsx";

const description =
  "One box on your home server, a VPS, or your own computer that hands out PostgreSQL®, MySQL®, Redis®, and S3-compatible buckets from a web UI and a CLI.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "evertap", template: "%s · evertap" },
  description,
  icons: { icon: "/favicon.svg" },
  openGraph: { siteName: "evertap", description, images: "/og.png" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
