import { createServer } from "node:http";
import next from "next";
import { attachSocket } from "./server/messages/socket";

/**
 * One process serves the whole app: Next.js renders the pages and runs the /api route handlers,
 * and the same HTTP server carries the Socket.IO connection for live marketplace messages.
 */
const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "localhost";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer((req, res) => {
  void handle(req, res);
});
attachSocket(server);

server.listen(port, () => {
  console.log(`Brixy listening on http://${hostname}:${port} (${dev ? "development" : "production"}, API: /api)`);
});
