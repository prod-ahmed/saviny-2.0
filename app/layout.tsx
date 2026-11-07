import type { Metadata, Viewport } from "next";
import "../client/index.css";
import { THEME_INIT_SCRIPT } from "../client/lib/theme";

export const metadata: Metadata = {
  title: "Pennywise — Smart Financial Companion",
  description: "Pennywise — your smart financial companion: accounts, budgets, savings goals, AI Coach and receipt scanner.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Pennywise" },
  icons: {
    icon: "/assets/pennywise-logo.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#102a29",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
