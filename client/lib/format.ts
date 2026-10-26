import type { Currency } from "./types";

/** Money in the user's currency. The absolute value is shown; the sign is drawn by the caller. Decimal places follow the currency. */
export const formatMoney = (amount: number, currency: Currency = "USD"): string => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Math.abs(amount));
  } catch {
    return `${currency} ${Math.abs(amount).toFixed(2)}`;
  }
};

const parseDay = (iso: string) => new Date(iso.length > 10 ? iso : `${iso}T00:00:00`);

export const shortDate = (iso: string): string =>
  parseDay(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export const monthYear = (iso: string): string =>
  parseDay(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });

export const longDate = (iso: string): string =>
  parseDay(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export const timeAgo = (iso: string): string => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

export const todayIso = (): string => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export const initials = (name: string): string =>
  name.split(" ").map((x) => x[0] ?? "").join("").slice(0, 2).toUpperCase();
