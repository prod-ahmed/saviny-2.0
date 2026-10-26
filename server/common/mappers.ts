import { Row } from "../database/types";
import { initialsOf } from "./security";

/** Public user shape. Never includes the password hash. */
export const toUser = (r: Row) => ({
  id: r.id as string,
  firstName: r.first_name as string,
  lastName: r.last_name as string,
  email: r.email as string,
  role: r.role as string,
  currency: r.currency as string,
  memberSince: r.created_at as string,
  deletionRequestedAt: (r.deletion_requested_at as string | null) ?? null,
  notifications: {
    budgetAlerts: !!r.notify_budget_alerts,
    upcomingBills: !!r.notify_upcoming_bills,
    savingsMilestones: !!r.notify_savings_milestones,
    communityReplies: !!r.notify_community_replies,
    marketplaceMessages: !!r.notify_marketplace_messages,
  },
});

export const author = (r: Row) => ({
  id: r.user_id as string,
  name: `${r.first_name} ${String(r.last_name)[0] ?? ""}.`,
  initials: initialsOf(r.first_name as string, r.last_name as string),
});
