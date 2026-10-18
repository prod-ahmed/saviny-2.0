import { useState, type FormEvent } from "react";
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

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
