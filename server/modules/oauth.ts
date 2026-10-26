import { randomBytes } from "node:crypto";
import { context } from "../context";
import { HttpError, notFound } from "../common/errors";
import { moderatorEmails, newUser } from "../common/domain";
import { toUser } from "../common/mappers";
import { newId, newToken, nowIso, sha256 } from "../common/security";
import type { Store } from "../database/store";
import type { Row } from "../database/types";
import { route, type Route } from "../http/types";
import { openSession } from "./auth";
import { DEFAULT_CATEGORIES } from "../common/domain";

type Provider = "google" | "github";
const PROVIDERS: Provider[] = ["google", "github"];

const STATE_TTL_MS = 10 * 60_000;
const HANDOFF_TTL_MS = 2 * 60_000;

/** Failure reasons the login page turns into a message. */
type OAuthFailure = "oauth_denied" | "oauth_unverified" | "oauth_failed" | "oauth_unavailable";

interface Profile {
  provider: Provider;
  providerUserId: string;
  email: string;
  firstName: string;
  lastName: string;
}

class OAuthError extends Error {
  constructor(readonly reason: OAuthFailure) {
    super(reason);
  }
}

function parseProvider(value: string): Provider {
  if (!PROVIDERS.includes(value as Provider)) throw notFound();
  return value as Provider;
}

/** Client id and secret come from the environment. A provider without both is not offered. */
function credentials(provider: Provider): { clientId: string; clientSecret: string } | null {
  const prefix = provider.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Public origin used for the redirect URIs registered with each provider. */
function publicOrigin(): string {
  return (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

const callbackUrl = (provider: Provider) => `${publicOrigin()}/api/auth/oauth/${provider}/callback`;

function loginRedirect(query: string): Response {
  return redirect(`${publicOrigin()}/login?${query}`);
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

function authorizeUrl(provider: Provider, clientId: string, state: string): string {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: callbackUrl(provider), response_type: "code", state });
  if (provider === "google") {
    params.set("scope", "openid email profile");
    params.set("prompt", "select_account");
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }
  params.set("scope", "read:user user:email");
  params.set("allow_signup", "true");
  return `https://github.com/login/oauth/authorize?${params}`;
}

/** Exchanges the authorisation code for an access token and reads the verified profile from the provider. */
async function fetchProfile(provider: Provider, code: string): Promise<Profile> {
  const creds = credentials(provider);
  if (!creds) throw new OAuthError("oauth_unavailable");
  return provider === "google" ? googleProfile(code, creds) : githubProfile(code, creds);
}

async function googleProfile(code: string, creds: { clientId: string; clientSecret: string }): Promise<Profile> {
  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: callbackUrl("google"),
      grant_type: "authorization_code",
    }),
  });
  const tokenBody = (await token.json().catch(() => ({}))) as { access_token?: string };
  if (!token.ok || !tokenBody.access_token) throw new OAuthError("oauth_failed");

  const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const user = (await info.json().catch(() => ({}))) as { sub?: string; email?: string; email_verified?: boolean | string; given_name?: string; family_name?: string; name?: string };
  if (!info.ok || !user.sub || !user.email) throw new OAuthError("oauth_failed");
  if (user.email_verified !== true && user.email_verified !== "true") throw new OAuthError("oauth_unverified");

  const [firstName, lastName] = names(user.given_name ? [user.given_name, user.family_name ?? ""] : splitFull(user.name), user.email);
  return { provider: "google", providerUserId: user.sub, email: user.email.toLowerCase(), firstName, lastName };
}

async function githubProfile(code: string, creds: { clientId: string; clientSecret: string }): Promise<Profile> {
  const token = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, code, redirect_uri: callbackUrl("github") }),
  });
  const tokenBody = (await token.json().catch(() => ({}))) as { access_token?: string };
  if (!token.ok || !tokenBody.access_token) throw new OAuthError("oauth_failed");
  const headers = { Authorization: `Bearer ${tokenBody.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "saviny" };

  const me = await fetch("https://api.github.com/user", { headers });
  const user = (await me.json().catch(() => ({}))) as { id?: number; login?: string; name?: string | null };
  if (!me.ok || user.id === undefined) throw new OAuthError("oauth_failed");

  const emailsRes = await fetch("https://api.github.com/user/emails", { headers });
  const emails = (await emailsRes.json().catch(() => [])) as { email: string; primary: boolean; verified: boolean }[];
  if (!emailsRes.ok) throw new OAuthError("oauth_failed");
  // Only a verified address may be used: an unverified one could belong to someone else.
  const chosen = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
  if (!chosen) throw new OAuthError("oauth_unverified");

  const [firstName, lastName] = names(splitFull(user.name ?? undefined), user.login ?? chosen.email);
  return { provider: "github", providerUserId: String(user.id), email: chosen.email.toLowerCase(), firstName, lastName };
}

function splitFull(full: string | undefined): string[] {
  return (full ?? "").trim().split(/\s+/).filter(Boolean);
}

/** First and last name, both non-empty for the first name. Falls back to the account handle. */
function names(parts: string[], fallback: string): [string, string] {
  const clean = parts.map((p) => p.trim()).filter(Boolean);
  const first = (clean[0] ?? fallback.split("@")[0] ?? "Member").slice(0, 60);
  const last = clean.slice(1).join(" ").slice(0, 60);
  return [first, last];
}

/** One account per person: a known provider identity, then a verified email match, otherwise a new account. */
async function linkOrCreate(store: Store, profile: Profile): Promise<string> {
  const existing = await store.one("oauth_identities", { provider: profile.provider, provider_user_id: profile.providerUserId });
  if (existing) return existing.user_id;

  let user = await store.one("users", { email: profile.email });
  if (!user) {
    // Provider accounts have no password. The random hash means password login cannot succeed for them.
    const role = moderatorEmails().includes(profile.email) ? "moderator" : "member";
    user = newUser({ firstName: profile.firstName, lastName: profile.lastName, email: profile.email, passwordHash: passwordPlaceholder(), role });
    await store.insert("users", user);
    await store.insert("categories", DEFAULT_CATEGORIES.map((name) => ({ id: newId(), user_id: user!.id, name, archived: false })));
  }
  await store.insert("oauth_identities", { provider: profile.provider, provider_user_id: profile.providerUserId, user_id: user.id, email: profile.email, created_at: nowIso() });
  return user.id;
}

/** A hash nobody knows, so the column stays NOT NULL without making a password usable. */
function passwordPlaceholder(): string {
  return `oauth$${randomBytes(32).toString("base64url")}`;
}

async function purgeExpired(store: Store): Promise<void> {
  const now = nowIso();
  await store.remove("oauth_states", { expires_at: { $lt: now } });
  await store.remove("login_handoffs", { expires_at: { $lt: now } });
}

async function start(provider: Provider): Promise<Response> {
  const creds = credentials(provider);
  if (!creds) return loginRedirect("oauth_error=oauth_unavailable");
  const { store } = await context();
  await purgeExpired(store);
  const state = newToken();
  await store.insert("oauth_states", { state_hash: sha256(state), provider, expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString() });
  return redirect(authorizeUrl(provider, creds.clientId, state));
}

/** Consumes the state: it works once, and only for the provider that issued it. */
async function consumeState(store: Store, provider: Provider, state: string): Promise<boolean> {
  const hash = sha256(state);
  const row = await store.one("oauth_states", { state_hash: hash });
  await store.remove("oauth_states", { state_hash: hash });
  return !!row && row.provider === provider && row.expires_at > nowIso();
}

async function callback(provider: Provider, params: URLSearchParams): Promise<Response> {
  if (params.get("error")) return loginRedirect("oauth_error=oauth_denied");
  const code = params.get("code");
  const state = params.get("state");
  const { store } = await context();
  if (!code || !state || !(await consumeState(store, provider, state))) return loginRedirect("oauth_error=oauth_failed");

  try {
    const userId = await linkOrCreate(store, await fetchProfile(provider, code));
    const handoff = newToken();
    await store.insert("login_handoffs", { code_hash: sha256(handoff), user_id: userId, expires_at: new Date(Date.now() + HANDOFF_TTL_MS).toISOString() });
    return loginRedirect(`oauth=${handoff}`);
  } catch (err) {
    const reason: OAuthFailure = err instanceof OAuthError ? err.reason : "oauth_failed";
    if (!(err instanceof OAuthError)) console.error("OAuth sign-in failed", provider, err instanceof Error ? err.message : err);
    return loginRedirect(`oauth_error=${reason}`);
  }
}

/** Trades the one-time code from the redirect for a session token. Works once and expires in two minutes. */
async function exchange(code: string) {
  const { store } = await context();
  const hash = sha256(code);
  const row = await store.one("login_handoffs", { code_hash: hash });
  await store.remove("login_handoffs", { code_hash: hash });
  if (!row || row.expires_at <= nowIso()) throw new HttpError(401, "This sign-in link has expired. Please try again.");
  const user = (await store.one("users", { id: row.user_id })) as Row;
  return { token: await openSession(user.id), user: toUser(user) };
}

export const oauthRoutes: Route[] = [
  route("GET", "auth/providers", () => ({
    google: !!credentials("google"),
    github: !!credentials("github"),
  }), { public: true }),

  route("GET", "auth/oauth/:provider/start", (ctx) => start(parseProvider(ctx.params.provider)), { public: true, limit: { max: 30, windowMs: 60_000 } }),

  route("GET", "auth/oauth/:provider/callback", (ctx) => callback(parseProvider(ctx.params.provider), ctx.query), { public: true, limit: { max: 60, windowMs: 60_000 } }),

  route("POST", "auth/oauth/exchange", async (ctx) => {
    const body = (await ctx.req.json().catch(() => ({}))) as { code?: unknown };
    if (typeof body.code !== "string" || body.code.length < 20) throw new HttpError(401, "This sign-in link has expired. Please try again.");
    return exchange(body.code);
  }, { public: true, status: 200, limit: { max: 20, windowMs: 60_000 } }),
];
