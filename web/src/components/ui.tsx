import type React from "react";

export type IconName =
  | "grid" | "swap" | "budget" | "target" | "store" | "users" | "bell" | "user" | "settings" | "logout" | "search"
  | "calendar" | "wallet" | "income" | "expense" | "saving" | "more" | "chevron" | "arrow" | "plus" | "heart"
  | "message" | "sparkle" | "close" | "menu" | "edit" | "trash" | "check";

const PATHS: Record<IconName, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  swap: <><path d="M7 7h13l-3-3" /><path d="m17 10 3-3-3-3" /><path d="M17 17H4l3 3" /><path d="m7 14-3 3 3 3" /></>,
  budget: <><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M3 10h18M8 3v4m8-4v4" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="m15 9 5-5m-3 0h3v3" /></>,
  store: <><path d="M4 10v10h16V10M3 10l2-6h14l2 6" /><path d="M8 20v-6h8v6M3 10c1.2 2 3.8 2 5 0 1.2 2 3.8 2 5 0 1.2 2 3.8 2 5 0 1 1.5 2 1.5 3 0" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-4 2.5-6 6-6s6 2 6 6M16 4a3 3 0 0 1 0 6M17 14c2.5.3 4 2.2 4 5" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.5-5 3-7 8-7s7.5 2 8 7" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 14.5l2-1v-3l-2-1-.7-1.7.7-2-2.2-2.2-2 1L13 4l-1-2H9L8 4l-1.8.7-2-1L2 6l1 2-.7 1.7-2 1v3l2 1 .7 1.7-1 2 2.2 2.2 2-1 1.8.7 1 2h3l1-2 1.8-.7 2 1 2.2-2.2-1-2z" /></>,
  logout: <><path d="M10 4H4v16h6M14 8l4 4-4 4m-6-4h10" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 10h18" /></>,
  wallet: <><path d="M4 6h14a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h12" /><path d="M16 11h5v5h-5a2.5 2.5 0 0 1 0-5z" /></>,
  income: <><path d="M12 3v14m-5-5 5 5 5-5" /><path d="M4 21h16" /></>,
  expense: <><path d="M12 20V6m-5 5 5-5 5 5" /><path d="M4 3h16" /></>,
  saving: <><path d="M5 10c-2 1-2 6 1 8 3 2 11 2 14-1 2-2 1-7-3-8-3-1-7-1-10 0L5 6l3 1" /><circle cx="13" cy="7" r="3" /><path d="M8 18v3m9-3v3m3-9h2" /></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  heart: <path d="M20.8 5.7a5.4 5.4 0 0 0-7.6 0L12 6.9l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 22l8.8-8.7a5.4 5.4 0 0 0 0-7.6z" />,
  message: <path d="M21 12a8 8 0 0 1-8 8H5l-3 2 1-5a9 9 0 1 1 18-5z" />,
  sparkle: <path d="m12 3 1.3 4.2L17 9l-3.7 1.8L12 15l-1.3-4.2L7 9l3.7-1.8L12 3zM5 15l.7 2.3L8 18l-2.3.7L5 21l-.7-2.3L2 18l2.3-.7L5 15z" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  check: <path d="m5 12 4 4 10-10" />,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><span className="eyebrow">SAVINY</span><h2>{title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function Confirm({ title, text, confirmLabel, onCancel, onConfirm, busy }: { title: string; text: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void; busy?: boolean }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="confirm-dialog">
        <span><Icon name="trash" size={28} /></span>
        <h3>{title}</h3>
        <p>{text}</p>
        <div>
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button className="danger-button" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}

export function FormError({ message }: { message: string }) {
  return message ? <p className="auth-error" role="alert">{message}</p> : null;
}

export function PageHeader({ eyebrow, title, description, action, onAction }: { eyebrow: string; title: string; description: string; action?: string; onAction?: () => void }) {
  return (
    <div className="module-header">
      <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
      {action && <button className="primary" onClick={onAction}><Icon name="plus" size={17} />{action}</button>}
    </div>
  );
}

export function EmptyState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="empty-state">
      <span><Icon name="sparkle" size={27} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && <button className="primary" onClick={onAction}>{action}</button>}
    </div>
  );
}

export function StateText({ loading, error, empty }: { loading: boolean; error: string; empty?: boolean }) {
  if (error) return <p className="state-text error" role="alert">{error}</p>;
  if (loading && empty) return <p className="state-text">Loading…</p>;
  return null;
}

export function SectionTitle({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) {
  return (
    <div className="section-title">
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      {action && <button className="text-link" onClick={onAction}>{action}<Icon name="arrow" size={16} /></button>}
    </div>
  );
}
