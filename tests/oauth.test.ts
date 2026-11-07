import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { api, dropTestDatabase, freshDatabase, register } from "./helpers";

// What each provider returns for the account this test signs in with.
const providers = {
  google: { sub: "g-ada-1", email: "ada.google@example.test", email_verified: true, given_name: "Ada", family_name: "Lovelace" },
  githubEmails: [
    { email: "ada.gh@example.test", primary: false, verified: true },
    { email: "ada.main@example.test", primary: true, verified: true },
  ],
  githubUser: { id: 4242, login: "ada", name: "Ada King" },
};

function fakeFetch(input: string | URL | Request): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "g-token" });
  if (url === "https://openidconnect.googleapis.com/v1/userinfo") return json(providers.google);
  if (url === "https://github.com/login/oauth/access_token") return json({ access_token: "gh-token" });
  if (url === "https://api.github.com/user") return json(providers.githubUser);
  if (url === "https://api.github.com/user/emails") return json(providers.githubEmails);
  return json({ message: "unexpected" }, 500);
}

/** Starts a sign-in and returns the state the provider would echo back. */
async function startFlow(provider: "google" | "github") {
  const started = await api("GET", `/api/auth/oauth/${provider}/start`);
  expect(started.status).toBe(302);
  const location = new URL(started.headers.get("location")!);
  return location.searchParams.get("state")!;
}

/** Runs the provider's redirect back to us and returns the one-time code from our redirect. */
async function finishFlow(provider: "google" | "github", state: string, code = "provider-code-123456789") {
  const back = await api("GET", `/api/auth/oauth/${provider}/callback?code=${code}&state=${state}`);
  expect(back.status).toBe(302);
  return new URL(back.headers.get("location")!);
}

describe("Google and GitHub sign-in", () => {
  beforeAll(async () => {
    await freshDatabase("oauth");
    process.env.GOOGLE_CLIENT_ID = "google-client";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret";
    process.env.GITHUB_CLIENT_ID = "github-client";
    process.env.GITHUB_CLIENT_SECRET = "github-secret";
    process.env.PUBLIC_URL = "http://localhost:3000";
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await dropTestDatabase();
  });

  it("offers each provider only when its credentials are configured", async () => {
    const res = await api("GET", "/api/auth/providers");
    expect(res.body).toEqual({ google: true, github: true });
  });

  it("sends the browser to the provider with a state and our callback address", async () => {
    const started = await api("GET", "/api/auth/oauth/google/start");
    const location = new URL(started.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/oauth/google/callback");
    expect(location.searchParams.get("client_id")).toBe("google-client");
    expect(location.searchParams.get("state")).toBeTruthy();
  });

  it("creates an account from a Google sign-in and hands the session over with a one-time code", async () => {
    const state = await startFlow("google");
    const redirect = await finishFlow("google", state);
    expect(redirect.pathname).toBe("/login");
    const code = redirect.searchParams.get("oauth")!;
    expect(code).toBeTruthy();
    expect(redirect.href).not.toMatch(/saviny|eyJ|token=/);

    const session = await api("POST", "/api/auth/oauth/exchange", { body: { code } });
    expect(session.status).toBe(200);
    expect(session.body.user).toMatchObject({ email: "ada.google@example.test", firstName: "Ada", lastName: "Lovelace" });
    expect(session.body.user).not.toHaveProperty("passwordHash");

    const me = await api("GET", "/api/auth/me", { token: session.body.token });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("ada.google@example.test");
  });

  it("refuses to exchange the same code twice", async () => {
    const state = await startFlow("google");
    const code = (await finishFlow("google", state)).searchParams.get("oauth")!;
    expect((await api("POST", "/api/auth/oauth/exchange", { body: { code } })).status).toBe(200);
    expect((await api("POST", "/api/auth/oauth/exchange", { body: { code } })).status).toBe(401);
  });

  it("gives the same account on every later sign-in with that provider identity", async () => {
    const first = await finishFlow("google", await startFlow("google"));
    const second = await finishFlow("google", await startFlow("google"));
    const a = (await api("POST", "/api/auth/oauth/exchange", { body: { code: first.searchParams.get("oauth") } })).body.user.id;
    const b = (await api("POST", "/api/auth/oauth/exchange", { body: { code: second.searchParams.get("oauth") } })).body.user.id;
    expect(b).toBe(a);
  });

  it("links a provider to an existing account with the same verified email", async () => {
    const existing = await register("ada.main@example.test");
    expect(existing.status).toBe(201);

    const redirect = await finishFlow("github", await startFlow("github"));
    const session = await api("POST", "/api/auth/oauth/exchange", { body: { code: redirect.searchParams.get("oauth") } });
    expect(session.body.user.id).toBe(existing.body.user.id);
    expect(session.body.user.email).toBe("ada.main@example.test");
  });

  it("chooses the primary verified GitHub address when a GitHub account has several", async () => {
    // The account above is already linked to this GitHub id, so the primary address is only read here.
    const redirect = await finishFlow("github", await startFlow("github"));
    const session = await api("POST", "/api/auth/oauth/exchange", { body: { code: redirect.searchParams.get("oauth") } });
    expect(session.body.user.email).toBe("ada.main@example.test");
  });

  it("refuses a state that was already used", async () => {
    const state = await startFlow("google");
    await finishFlow("google", state);
    const replay = await api("GET", `/api/auth/oauth/google/callback?code=another-code-1234567890&state=${state}`);
    expect(new URL(replay.headers.get("location")!).searchParams.get("oauth_error")).toBe("oauth_failed");
  });

  it("refuses a state issued to a different provider", async () => {
    const state = await startFlow("google");
    const wrong = await api("GET", `/api/auth/oauth/github/callback?code=some-code-1234567890&state=${state}`);
    expect(new URL(wrong.headers.get("location")!).searchParams.get("oauth_error")).toBe("oauth_failed");
  });

  it("reports a cancelled sign-in", async () => {
    const state = await startFlow("github");
    const cancelled = await api("GET", `/api/auth/oauth/github/callback?error=access_denied&state=${state}`);
    expect(new URL(cancelled.headers.get("location")!).searchParams.get("oauth_error")).toBe("oauth_denied");
  });

  it("does not sign in with an unverified GitHub address", async () => {
    const saved = providers.githubEmails;
    providers.githubEmails = [{ email: "unverified@example.test", primary: true, verified: false }];
    try {
      const redirect = await finishFlow("github", await startFlow("github"));
      expect(redirect.searchParams.get("oauth_error")).toBe("oauth_unverified");
      expect(redirect.searchParams.get("oauth")).toBeNull();
    } finally {
      providers.githubEmails = saved;
    }
  });

  it("rejects an unknown provider and a bad exchange code", async () => {
    expect((await api("GET", "/api/auth/oauth/facebook/start")).status).toBe(404);
    expect((await api("POST", "/api/auth/oauth/exchange", { body: { code: "short" } })).status).toBe(401);
  });
});
