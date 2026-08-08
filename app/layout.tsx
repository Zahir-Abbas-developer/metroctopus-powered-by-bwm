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
    default: "Agency OS",
    template: "%s · Agency OS",
  },
  description:
    "Operations platform for a remote 360° digital marketing agency — clients, milestones, tasks and team performance in one place.",
};

export const viewport: Viewport = {
  themeColor: "#0C0C0A",
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
