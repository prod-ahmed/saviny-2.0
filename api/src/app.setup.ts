import { INestApplication, ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import compression from "compression";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { static as serveStatic, type NextFunction, type Request, type Response } from "express";

/** Shared bootstrap for main.ts and the tests, so both run the same HTTP pipeline. */
export function configureApp(app: INestApplication): void {
  const webDist = resolve(process.env.WEB_DIST ?? join(process.cwd(), "..", "web", "dist"));
  const origins = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",");

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  app.enableCors({ origin: origins, credentials: false });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Serve the built PWA; unknown browser routes fall back to index.html (SPA).
  const index = join(webDist, "index.html");
  if (existsSync(index)) {
    app.use(serveStatic(webDist, { index: false }));
    app.use((req: Request, res: Response, next: NextFunction) => {
      const wantsPage = req.method === "GET" && !req.path.startsWith("/api") && req.accepts("html");
      if (wantsPage) res.sendFile(index);
      else next();
    });
  }
}
