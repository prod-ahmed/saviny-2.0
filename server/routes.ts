import { aiRoutes } from "./ai/routes";
import { authRoutes } from "./modules/auth";
import { communityRoutes } from "./modules/community";
import { financeRoutes } from "./modules/finance";
import { marketRoutes } from "./modules/market";
import { messagesRoutes } from "./modules/messages";
import { oauthRoutes } from "./modules/oauth";
import { route, type Route } from "./http/types";

/** Every REST endpoint, in matching order. Paths are relative to /api. */
export const routes: Route[] = [
  route("GET", "health", () => ({ status: "ok" }), { public: true }),
  ...authRoutes,
  ...oauthRoutes,
  ...financeRoutes,
  ...marketRoutes,
  ...communityRoutes,
  ...messagesRoutes,
  ...aiRoutes,
];
