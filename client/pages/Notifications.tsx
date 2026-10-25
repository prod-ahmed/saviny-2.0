import { useState } from "react";
import { useNavigate } from "react-router";
import { EmptyState, Icon, PageHeader, StateText } from "../components/ui";
import { AiPanel } from "../components/AiPanel";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useApi } from "../lib/hooks";
import type { AppNotification } from "../lib/types";

type Filter = "all" | "unread" | "financial" | "community";

const FINANCIAL = ["budget_alert", "bill_due", "goal_progress"];
const COMMUNITY = ["community_reply", "community_interaction"];

export default function Notifications() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const list = useApi<{ items: AppNotification[]; unreadCount: number }>("/notifications");
  const items = (list.data?.items ?? []).filter((n) => {
    if (filter === "unread") return !n.read;
    if (filter === "financial") return FINANCIAL.includes(n.kind);
    if (filter === "community") return COMMUNITY.includes(n.kind);
    return true;
  });
  const unread = list.data?.unreadCount ?? 0;

  const open = async (n: AppNotification) => {
    if (!n.read) await api(`/notifications/${n.id}/read`, { method: "POST" });
    list.reload();
    navigate(n.link);
  };

  const readAll = async () => {
    await api("/notifications/read-all", { method: "POST" });
    list.reload();
  };

  return (
    <div className="content module-page">
      <PageHeader eyebrow="STAY INFORMED" title="Notifications" description="Useful alerts across your budgets, bills, goals, marketplace, and community." />
      <AiPanel<{ digest: string }>
        title="Digest"
        action="Summarise unread"
        run={() => api("/ai/notifications/digest")}
        render={(result) => <p>{result.digest}</p>}
      />
      <section className="card notification-page">
        <div className="notification-tools">
          {(["all", "unread", "financial", "community"] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "unread" ? "Unread" : f === "financial" ? "Financial" : "Community"}
              {f === "unread" && unread > 0 && <b>{unread}</b>}
            </button>
          ))}
          <button onClick={readAll} disabled={unread === 0}>Mark all read</button>
          <button onClick={() => navigate("/settings")}>Preferences</button>
        </div>
        <StateText loading={list.loading} error={list.error} empty={!list.data} />
        {list.data && items.length === 0 && <EmptyState title="You’re all caught up" text="New alerts about budgets, bills, goals and the community will appear here." />}
        {items.map((n) => (
          <button className={`notification-line ${n.read ? "" : "unread"}`} key={n.id} onClick={() => open(n)}>
            <span className={`notice-icon ${n.kind === "budget_alert" ? "warning" : ""}`}>{n.kind === "budget_alert" ? "!" : <Icon name={n.kind.startsWith("bill") ? "calendar" : n.kind.startsWith("goal") ? "target" : "message"} size={17} />}</span>
            <div><strong>{n.title}</strong><p>{n.body}</p><small>{timeAgo(n.createdAt)}</small></div>
            <i />
            <Icon name="chevron" size={17} />
          </button>
        ))}
      </section>
    </div>
  );
}
