/** ISO 4217 code, e.g. "USD". Any code the runtime supports. */
export type Currency = string;

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "member" | "moderator";
  currency: Currency;
  memberSince: string;
  deletionRequestedAt: string | null;
  notifications: {
    budgetAlerts: boolean;
    upcomingBills: boolean;
    savingsMilestones: boolean;
    communityReplies: boolean;
    marketplaceMessages: boolean;
  };
}

export interface Account {
  id: string;
  name: string;
  type: "checking" | "savings" | "cash" | "credit";
  initialBalance: number;
  archived: boolean;
  balance: number;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  archived: boolean;
}

export interface Transaction {
  id: string;
  type: "income" | "expense";
  amount: number;
  date: string;
  description: string;
  accountId: string;
  accountName: string;
  categoryId: string;
  categoryName: string;
}

export interface Budget {
  id: string;
  name: string;
  limit: number;
  period: "monthly" | "weekly" | "custom";
  startDate: string | null;
  endDate: string | null;
  categoryIds: string[];
  spent: number;
  remaining: number;
  overBy: number;
  percent: number;
  status: "on_track" | "near_limit" | "over";
  range: { from: string; to: string };
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
  kind: "bill" | "scheduled";
  status: "upcoming" | "paid";
  accountId: string | null;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  targetAmount: number;
  targetDate: string | null;
  status: "active" | "archived";
  savedAmount: number;
  remaining: number;
  progress: number;
  estimatedCompletionDate: string | null;
  estimationNote: string;
  contributionCount: number;
}

export interface Contribution {
  id: string;
  goalId: string;
  amount: number;
  date: string;
  note: string;
}

export interface Dashboard {
  period: string;
  balance: number;
  income: number;
  expenses: number;
  saved: number;
  activeAccounts: number;
  activeGoals: number;
  incomeCount: number;
  expenseCount: number;
  byCategory: { categoryId: string; name: string; amount: number; percent: number }[];
  weeklyFlow: { label: string; income: number; expenses: number }[];
  budgets: Budget[];
  goals: Goal[];
  recentTransactions: Transaction[];
  upcomingBills: Bill[];
  alerts: { kind: string; title: string; body: string }[];
}

export interface Listing {
  id: string;
  title: string;
  description: string;
  price: number;
  category: string;
  condition: "New" | "Like new" | "Good" | "Fair";
  photos: string[];
  image: string;
  status: "available" | "unavailable" | "sold";
  createdAt: string;
  seller: { id: string; name: string; initials: string };
  isOwner: boolean;
  favorited: boolean;
}

export interface Post {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  category: string;
  createdAt: string;
  replyCount: number;
  reactionCount: number;
  viewerReacted: boolean;
  isOwner: boolean;
  author: { id: string; name: string; initials: string };
}

export interface Comment {
  id: string;
  postId: string;
  body: string;
  createdAt: string;
  isOwner: boolean;
  author: { id: string; name: string; initials: string };
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}
