import { useCallback, useEffect, useState } from "react";
import { AssistantChat } from "./components/AssistantChat";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import Accounts from "./pages/Accounts";
import Landing from "./pages/Landing";
import Bills from "./pages/Bills";
import Budgets from "./pages/Budgets";
import Community from "./pages/Community";
import Dashboard from "./pages/Dashboard";
import Goals from "./pages/Goals";
import Marketplace from "./pages/Marketplace";
import Messages from "./pages/Messages";
import Notifications from "./pages/Notifications";
import { Profile, Settings } from "./pages/Profile";
import Support from "./pages/Support";
import Transactions from "./pages/Transactions";
import { ForgotPassword, Login, Register } from "./pages/AuthPages";
import { Confirm, Icon, type IconName } from "./components/ui";
import { api, getToken } from "./lib/api";
import { flushOutbox, OUTBOX_EVENT, pendingCount } from "./lib/offline";
import { SessionContext, useApi, useOnline, useSessionState } from "./lib/hooks";
import { useLiveEvent } from "./lib/socket";
import { playMessageTone, setUnreadTitle, showMessageNotification } from "./lib/notify";
import type { AppNotification } from "./lib/types";

const NAV: { label: string; path: string; icon: IconName }[] = [
  { label: "Dashboard", path: "/dashboard", icon: "grid" },
  { label: "Accounts", path: "/accounts", icon: "wallet" },
  { label: "Transactions", path: "/transactions", icon: "swap" },
  { label: "Budget Management", path: "/budgets", icon: "budget" },
  { label: "Savings Goals", path: "/goals", icon: "target" },
  { label: "Marketplace", path: "/marketplace", icon: "store" },
  { label: "Messages", path: "/messages", icon: "message" },
  { label: "Community", path: "/community", icon: "users" },
  { label: "Notifications", path: "/notifications", icon: "bell" },
  { label: "My Profile", path: "/profile", icon: "user" },
  { label: "Settings", path: "/settings", icon: "settings" },
];

const TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  transactions: "Transactions",
  accounts: "Accounts",
  budgets: "Budget Management",
  bills: "Bills & Payments",
  goals: "Savings Goals",
  marketplace: "Marketplace",
  messages: "Messages",
  community: "Community",
  notifications: "Notifications",
  profile: "My Profile",
  settings: "Settings",
  support: "Support",
};

const AUTH_PATHS = ["/login", "/register", "/forgot-password"];

interface NotificationList {
  items: AppNotification[];
  unreadCount: number;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSessionState();
  const online = useOnline();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);

  // Changes made offline wait in the outbox; they are sent in order as soon as the connection returns.
  const refreshPending = useCallback(() => {
    void pendingCount().then(setPending);
  }, []);
  useEffect(() => {
    const sync = () => {
      if (!navigator.onLine) return refreshPending();
      void flushOutbox(getToken()).then(refreshPending);
    };
    sync();
    refreshPending();
    window.addEventListener("online", sync);
    window.addEventListener(OUTBOX_EVENT, refreshPending);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener(OUTBOX_EVENT, refreshPending);
    };
  }, [refreshPending]);

  const isAuthPage = AUTH_PATHS.includes(location.pathname);
  const notices = useApi<NotificationList>(session.user && !isAuthPage ? "/notifications" : null);
  const inbox = useApi<{ items: { id: string; listingTitle: string; other: { name: string } }[]; unreadCount: number }>(
    session.user && !isAuthPage ? "/conversations" : null,
  );
  useLiveEvent("message:read", () => inbox.reload());
  useLiveEvent("connect", () => inbox.reload());
  useLiveEvent<{ conversationId: string; message: { senderId: string; kind: string; body: string } }>("message:new", ({ conversationId, message }) => {
    inbox.reload();
    if (!session.user || message.senderId === session.user.id) return;
    // Stay quiet while the person is already reading this conversation.
    if (location.pathname === `/messages/${conversationId}` && !document.hidden) return;
    const conversation = inbox.data?.items.find((c) => c.id === conversationId);
    const body = message.kind === "image" ? "📷 Photo" : message.kind === "voice" ? "🎤 Voice message" : message.body;
    playMessageTone();
    showMessageNotification(conversation ? conversation.other.name : "New message", conversation ? `${conversation.listingTitle} · ${body}` : body, conversationId, () =>
      navigate(`/messages/${conversationId}`),
    );
  });
  useEffect(() => {
    setUnreadTitle(inbox.data?.unreadCount ?? 0);
  }, [inbox.data?.unreadCount]);

  // Refresh the unread badge whenever the visible page changes.
  useEffect(() => {
    notices.reload();
    inbox.reload();
    setMenuOpen(false);
    setProfileOpen(false);
    setNotificationsOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Routes>
    );
  }

  // The landing page is for visitors; members go straight to their dashboard.
  if (location.pathname === "/") {
    if (!session.ready) return <p className="state-text">Loading…</p>;
    return session.user ? <Navigate to="/dashboard" replace /> : <Landing />;
  }

  if (!session.ready) return <p className="state-text">Loading…</p>;
  if (!session.user) return <Navigate to="/login" replace />;

  const user = session.user;
  const routeKey = location.pathname.split("/").filter(Boolean)[0] ?? "dashboard";
  const active = TITLES[routeKey] ?? "Dashboard";
  const currentDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  const unread = notices.data?.unreadCount ?? 0;
  const latest = (notices.data?.items ?? []).slice(0, 5);
  const initials = (user.firstName[0] ?? "") + (user.lastName[0] ?? "");

  const markAllRead = async () => {
    try {
      await api("/notifications/read-all", { method: "POST" });
    } finally {
      notices.reload();
    }
  };

  const openNotice = async (n: AppNotification) => {
    try {
      if (!n.read) await api(`/notifications/${n.id}/read`, { method: "POST" });
    } finally {
      notices.reload();
    }
    setNotificationsOpen(false);
    navigate(n.link);
  };

  const logout = async () => {
    setBusy(true);
    await session.logout();
  };

  return (
    <SessionContext.Provider value={session}>
      <div className="app-shell">
        {menuOpen && <button className="drawer-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
        <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
          <div className="brand">
            <button className="brand-home" aria-label="Go to dashboard" onClick={() => navigate("/dashboard")} />
            <img src="/assets/saviny-logo.png" alt="Brixy" />
            <div><strong>Brixy</strong><span>Financial companion</span></div>
            <button className="sidebar-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><Icon name="close" /></button>
          </div>
          <nav aria-label="Primary navigation">
            <span className="nav-label">WORKSPACE</span>
            {NAV.map((item, i) => (
              <button key={item.label} className={`nav-item ${active === item.label ? "active" : ""} ${item.label === "Notifications" ? "nav-break" : ""}`} onClick={() => navigate(item.path)}>
                <Icon name={item.icon} /><span>{item.label}</span>
                {item.label === "Notifications" && unread > 0 && <b>{unread}</b>}
                {item.label === "Messages" && (inbox.data?.unreadCount ?? 0) > 0 && <b>{inbox.data?.unreadCount}</b>}
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="help-card">
              <span><Icon name="sparkle" size={18} /></span>
              <strong>Need a hand?</strong>
              <p>Visit our help center for financial guidance.</p>
              <button onClick={() => navigate("/support")}>Get support <Icon name="arrow" size={15} /></button>
            </div>
            <button className="logout" onClick={() => setLogoutOpen(true)}><Icon name="logout" /> Log out</button>
            <p>© 2025 Brixy · v1.0</p>
          </div>
        </aside>

        <main>
          {!online && <div className="offline-banner" role="status">You’re offline. You can read your saved data{pending > 0 ? `, and ${pending} change${pending === 1 ? "" : "s"} will sync when you reconnect` : ""}.</div>}
          {online && pending > 0 && <div className="offline-banner" role="status">{pending} change{pending === 1 ? "" : "s"} waiting to sync.</div>}
          <header className="topbar">
            <div className="topbar-left">
              <button className="mobile-menu icon-button" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button>
              <div><h1>{active}</h1><p>Your financial life, beautifully organized.</p></div>
            </div>
            <div className="topbar-actions">
              <span className="online"><i /> {online ? "Online" : "Offline"}</span>
              <span className="date"><Icon name="calendar" size={17} />{currentDate}</span>
              <div className="global-search">
                <Icon name="search" size={18} />
                <input
                  aria-label="Search transactions"
                  placeholder="Search anything..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.currentTarget.value.trim()) navigate(`/transactions?search=${encodeURIComponent(e.currentTarget.value.trim())}`);
                  }}
                />
              </div>
              <div className="popover-wrap">
                <button className="icon-button notification-button" onClick={() => setNotificationsOpen(!notificationsOpen)} aria-label="Notifications">
                  <Icon name="bell" />{unread > 0 && <b>{unread}</b>}
                </button>
                {notificationsOpen && (
                  <div className="popover notifications-pop">
                    <div className="pop-head">
                      <strong>Notifications</strong>
                      <button onClick={markAllRead} disabled={unread === 0}>Mark all read</button>
                    </div>
                    {latest.length === 0 && <p className="muted-small">You’re all caught up.</p>}
                    {latest.map((n) => (
                      <button key={n.id} className={`notice notice-button ${n.read ? "" : "new"}`} onClick={() => openNotice(n)}>
                        <span className={`notice-icon ${n.kind === "budget_alert" ? "warning" : ""}`}>{n.kind === "budget_alert" ? "!" : <Icon name="calendar" size={15} />}</span>
                        <div><strong>{n.title}</strong><p>{n.body}</p></div>
                      </button>
                    ))}
                    <button className="pop-footer" onClick={() => { setNotificationsOpen(false); navigate("/notifications"); }}>View all notifications</button>
                  </div>
                )}
              </div>
              <div className="popover-wrap">
                <button className="user-chip" onClick={() => setProfileOpen(!profileOpen)}>
                  <span>{initials}</span>
                  <div><strong>{user.firstName} {user.lastName}</strong><small>Personal account</small></div>
                  <Icon name="chevron" size={15} />
                </button>
                {profileOpen && (
                  <div className="popover profile-pop">
                    <button onClick={() => navigate("/profile")}><Icon name="user" /> Profile</button>
                    <button onClick={() => navigate("/settings")}><Icon name="settings" /> Settings</button>
                    <hr />
                    <button onClick={() => setLogoutOpen(true)}><Icon name="logout" /> Log out</button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/budgets" element={<Budgets />} />
            <Route path="/budgets/:id" element={<Budgets />} />
            <Route path="/bills" element={<Bills />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/goals/:id" element={<Goals />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/marketplace/:id" element={<Marketplace />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/messages/:id" element={<Messages />} />
            <Route path="/community" element={<Community />} />
            <Route path="/community/:id" element={<Community />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/support" element={<Support />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>

          <nav className="bottom-nav" aria-label="Mobile navigation">
            {NAV.slice(0, 5).map((item) => (
              <button key={item.label} className={active === item.label ? "active" : ""} onClick={() => navigate(item.path)}>
                <Icon name={item.icon} size={20} />
                <span>{item.label === "Budget Management" ? "Budgets" : item.label}</span>
              </button>
            ))}
          </nav>
        </main>

        <AssistantChat />

        {logoutOpen && (
          <Confirm
            title="Leave your Brixy session?"
            text="You’ll need to log in again to access your private financial dashboard."
            confirmLabel="Log out"
            busy={busy}
            onCancel={() => setLogoutOpen(false)}
            onConfirm={logout}
          />
        )}
      </div>
    </SessionContext.Provider>
  );
}

