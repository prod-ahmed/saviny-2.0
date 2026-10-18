import { z } from "zod";

/** Text that is trimmed by the service and must not be blank. */
export const text = (max: number) => z.string().trim().min(1).max(max);

/** Money: a positive number with at most two decimals. */
export const money = z.number().refine((v) => Number.isFinite(v) && Number.isInteger(Number((v * 100).toFixed(6))), "must have at most 2 decimal places");
export const positiveMoney = money.refine((v) => v > 0, "must be a positive number");

/** An ISO date (YYYY-MM-DD) or a full ISO timestamp. */
export const isoDateString = z.string().refine((s) => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s)), "must be a valid ISO date string");
