import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

const ips = Object.values(networkInterfaces())
  .flat()
  .filter((d): d is NonNullable<typeof d> => Boolean(d && d.family === "IPv4" && !d.internal))
  .map((d) => d.address);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["mongodb"],
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "*.local",
    "MacBook-Pro.local",
    "macbook-pro.local",
    ...ips,
    ...ips.map((ip) => `${ip}:3000`),
    "localhost:3000",
    "127.0.0.1:3000",
    "MacBook-Pro.local:3000",
    "macbook-pro.local:3000",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
