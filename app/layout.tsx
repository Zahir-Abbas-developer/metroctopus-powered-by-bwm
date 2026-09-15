import type { Metadata, Viewport } from "next";
import { DM_Sans, Syne } from "next/font/google";

import "./globals.css";
import { Providers } from "@/components/Providers";

/** Display face — headings, wordmark, eyebrow labels, stat figures. */
const syne = Syne({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-syne",
  display: "swap",
});

/** Body face — everything else. */
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Metroctopus",
    template: "%s · Metroctopus",
  },
  description:
    "Department-based CRM and internal business operating system for Metroctopus — leads, clients, deals, tasks and follow-ups across every business line.",
  // Installable, so an availability check can reach a phone's notification
  // tray rather than depending on a browser tab being open.
  manifest: "/manifest.webmanifest",
  applicationName: "Metroctopus",
  appleWebApp: {
    capable: true,
    title: "Metroctopus",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0C0C0A",
  // The app is a real working surface on a phone; letting iOS zoom the layout
  // on an input focus makes answering a check fiddly.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable}`}>
      <body className="min-h-screen bg-paper text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
