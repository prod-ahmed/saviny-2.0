import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const newId = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();
export const round2 = (value: number): number => Math.round(value * 100) / 100;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(expected, actual);
}

/** Opaque session token: only its SHA-256 is stored in the database. */
export const newToken = (): string => randomBytes(32).toString("base64url");
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export const initialsOf = (firstName: string, lastName: string): string =>
  `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
