import { Link } from "react-router";

const FEATURES = [
  { title: "Accounts and transactions", text: "Track checking, savings, cash and credit in one place. Every income and expense is recorded against the account it belongs to." },
  { title: "Budgets that warn you early", text: "Set a monthly, weekly or custom limit per category. Brixy flags a budget at 80% and again when it's exceeded." },
  { title: "Savings goals with a real estimate", text: "Add contributions to a goal and see progress, what remains, and when you'd finish at your current pace." },
  { title: "Bills and scheduled payments", text: "See what's due in the next seven days. Marking a bill paid only updates your record: Brixy never moves money." },
  { title: "A marketplace with private messages", text: "Buy and sell secondhand items. Talk with the other person in a chat with photos, voice notes and reactions." },
  { title: "A community that moderates itself", text: "Share saving tips and budgeting ideas. Reports reach moderators, and hidden posts stay hidden from everyone else." },
];

const STEPS = [
  { title: "Create your account", text: "Sign up with an email address or with Google, in under a minute." },
  { title: "Add an account and your transactions", text: "Start with a current account and record what you've spent and earned." },
  { title: "Watch your month take shape", text: "The dashboard shows your balance, where the money goes, and what needs attention." },
];

export default function Landing() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Link to="/" className="landing-brand" aria-label="Brixy home">
          <img src="/assets/saviny-logo.png" alt="" width="40" height="40" />
          <strong>Brixy</strong>
        </Link>
        <nav aria-label="Account">
          <Link to="/login" className="landing-link">Log in</Link>
          <Link to="/register" className="primary landing-cta">Get started</Link>
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <div>
            <span className="eyebrow">YOUR FINANCIAL LIFE COMPANION</span>
            <h1>Feel calm and confident about your money.</h1>
            <p>
              Brixy brings your accounts, budgets, savings goals and bills into one private dashboard. It also has a
              marketplace and a community, so you can buy, sell and learn from people nearby.
            </p>
            <div className="landing-actions">
              <Link to="/register" className="primary landing-cta">Create your free account</Link>
              <Link to="/login" className="secondary landing-secondary">I already have an account</Link>
            </div>
            <p className="landing-fine">Your records are private to you. Other members never see them.</p>
          </div>
          <div className="landing-preview" aria-hidden="true">
            <div className="landing-preview-card">
              <small>Total balance</small>
              <strong>$1,379.50</strong>
              <span>Across 1 active account</span>
            </div>
            <div className="landing-preview-card">
              <small>Groceries budget</small>
              <div className="progress"><i className="orange" style={{ width: "86%" }} /></div>
              <span>86% used · near limit</span>
            </div>
            <div className="landing-preview-card">
              <small>Laptop fund</small>
              <div className="progress large"><i className="blue" style={{ width: "42%" }} /></div>
              <span>42% saved · on track</span>
            </div>
          </div>
        </section>

        <section className="landing-section" id="features">
          <span className="eyebrow">EVERYTHING IN ONE PLACE</span>
          <h2>Built for the whole month, not just the bank balance.</h2>
          <div className="landing-grid">
            {FEATURES.map((f) => (
              <article className="card landing-feature" key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-steps" id="how">
          <span className="eyebrow">HOW IT WORKS</span>
          <h2>Three steps to a clearer picture.</h2>
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span>{i + 1}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section landing-trust">
          <div>
            <span className="eyebrow">PRIVACY BY DEFAULT</span>
            <h2>Your financial records stay yours.</h2>
            <p>
              Passwords are stored as salted hashes. You can sign out of a device from settings, and changing your password
              signs out every other device. You can request account deletion at any time. Nothing is removed until it is reviewed.
            </p>
          </div>
          <Link to="/register" className="primary landing-cta">Start in a minute</Link>
        </section>
      </main>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} Brixy</span>
        <nav aria-label="Footer">
          <Link to="/login">Log in</Link>
          <Link to="/register">Sign up</Link>
        </nav>
      </footer>
    </div>
  );
}
