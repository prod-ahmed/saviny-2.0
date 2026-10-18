import type { Metadata, Viewport } from "next";
import "../client/index.css";

export const metadata: Metadata = {
  title: "Saviny",
  description: "Saviny — your financial companion: accounts, budgets, savings goals, marketplace and community.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
