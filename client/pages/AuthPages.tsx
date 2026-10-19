import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { FormError } from "../components/ui";
import { api, setToken } from "../lib/api";
import type { User } from "../lib/types";

interface AuthResult {
  token: string;
  user: User;
}

function AuthLayout({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <section className="auth-brand">
        <img src="/assets/saviny-logo.png" alt="Saviny" />
        <span className="eyebrow">YOUR FINANCIAL LIFE COMPANION</span>
        <h1>Feel calm and confident about your money.</h1>
        <p>Plan today, build tomorrow, and stay connected to what matters.</p>
      </section>
      <section className="auth-card">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {children}
      </section>
    </div>
  );
}

const OAUTH_MESSAGES: Record<string, string> = {
  oauth_denied: "Sign-in was cancelled.",
  oauth_unverified: "That account has no verified email address, so it cannot be used to sign in.",
  oauth_failed: "Sign-in could not be completed. Please try again.",
  oauth_unavailable: "This sign-in option is not available yet.",
};

/** Google's four-colour "G", in the brand colours. */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.022 35.026 44 30.038 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

/** Google and GitHub buttons. Only the providers that have credentials on the server are shown. */
function OAuthButtons() {
  const [providers, setProviders] = useState<{ google: boolean; github: boolean } | null>(null);

  useEffect(() => {
    api<{ google: boolean; github: boolean }>("/auth/providers")
      .then(setProviders)
      .catch(() => setProviders({ google: false, github: false }));
  }, []);

  if (!providers || (!providers.google && !providers.github)) return null;
  return (
    <div className="oauth-buttons">
      <span className="oauth-divider">or continue with</span>
      {providers.google && (
        <a className="secondary oauth-button" href="/api/auth/oauth/google/start">
          <GoogleIcon />
          Continue with Google
        </a>
      )}
      {providers.github && <a className="secondary oauth-button" href="/api/auth/oauth/github/start">Continue with GitHub</a>}
    </div>
  );
}

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const returned = useRef(false);

  // Back from Google or GitHub: the redirect carries a one-time code (or a failure reason), never the session.
  useEffect(() => {
    if (returned.current) return;
    returned.current = true;
    const params = new URLSearchParams(window.location.search);
    const failure = params.get("oauth_error");
    const code = params.get("oauth");
    if (!failure && !code) return;
    window.history.replaceState(null, "", "/login");
    if (failure) {
      setError(OAUTH_MESSAGES[failure] ?? OAUTH_MESSAGES.oauth_failed);
      return;
    }
    setBusy(true);
    api<AuthResult>("/auth/oauth/exchange", { method: "POST", json: { code } })
      .then((result) => {
        setToken(result.token);
        window.location.assign("/dashboard");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : OAUTH_MESSAGES.oauth_failed);
        setBusy(false);
      });
  }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<AuthResult>("/auth/login", { method: "POST", json: { email, password } });
      setToken(result.token);
      window.location.assign("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  };

  return (
    <AuthLayout eyebrow="WELCOME BACK" title="Log in" description="Access your private financial dashboard.">
      <form className="flow-form" onSubmit={submit}>
        <label>Email address<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <FormError message={error} />
        <button className="primary auth-submit" disabled={busy}>{busy ? "Logging in…" : "Log in securely"}</button>
      </form>
      <OAuthButtons />
      <p className="auth-foot">
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
      <p className="auth-foot">New to Saviny? <Link to="/register">Create your account</Link></p>
    </AuthLayout>
  );
}

export function Register() {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<AuthResult>("/auth/register", { method: "POST", json: form });
      setToken(result.token);
      window.location.assign("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setBusy(false);
    }
  };

  return (
    <AuthLayout eyebrow="CREATE ACCOUNT" title="Start with Saviny" description="Your records are private and stored for your account only.">
      <form className="flow-form" onSubmit={submit}>
        <div className="form-row">
          <label>First name<input required value={form.firstName} onChange={set("firstName")} /></label>
          <label>Last name<input required value={form.lastName} onChange={set("lastName")} /></label>
        </div>
        <label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={set("email")} /></label>
        <label>Password<input required type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={set("password")} /></label>
        <label>Confirm password<input required type="password" minLength={8} autoComplete="new-password" value={form.confirmPassword} onChange={set("confirmPassword")} /></label>
        <FormError message={error} />
        <button className="primary auth-submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
      </form>
      <OAuthButtons />
      <p className="auth-foot">Already have an account? <Link to="/login">Log in</Link></p>
    </AuthLayout>
  );
}

export function ForgotPassword() {
  return (
    <AuthLayout eyebrow="PASSWORD" title="Forgot password" description="Password reset by email is not available in this version.">
      <p className="muted-small">If you have lost access, contact the person who manages this Saviny instance. You can also create a new account with another email address.</p>
      <p className="auth-foot"><Link to="/login">Back to login</Link></p>
    </AuthLayout>
  );
}
