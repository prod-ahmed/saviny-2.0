import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import next from "next";
import nextEnv from "@next/env";
import { ensureLocalCertificate, localIpv4, localDomains } from "./server/http/local-https";
import { attachSocket } from "./server/messages/socket";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

/**
 * One process serves the whole app: Next.js renders the pages and runs the /api route handlers,
 * and the same server carries the Socket.IO connection for live marketplace messages.
 * Opening the app from a phone uses HTTPS, because Safari blocks the camera on plain http.
 */
const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const useHttps = process.env.HTTPS !== "0";
const hostname = process.env.HOST ?? "0.0.0.0";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();

const onRequest = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
  void handle(req, res);
};
const server = useHttps ? createHttpsServer(ensureLocalCertificate(), onRequest) : createServer(onRequest);
attachSocket(server);

server.listen(port, hostname, () => {
  const mode = dev ? "development" : "production";
  if (!useHttps) {
    const addresses = localIpv4();
    console.log(`Saviny listening on http://localhost:${port} (${mode}, API: /api)`);
    for (const ip of addresses) console.log(`  LAN / Phone: http://${ip}:${port}`);
    return;
  }
  const domains = localDomains().filter((d) => d.includes(".local"));
  const addresses = localIpv4();
  console.log(`Saviny listening with HTTPS (${mode}, API: /api)`);
  console.log(`  Sur ce Mac (Safari): https://localhost:${port}`);
  for (const domain of domains) {
    console.log(`  Sur iPhone (Safari): https://${domain}:${port}`);
  }
  for (const ip of addresses) {
    console.log(`  Ou par IP:           https://${ip}:${port}`);
  }
  console.log("\nDans Safari sur iPhone: appuyez sur 'Afficher les détails' puis 'visiter ce site web'.");
});
