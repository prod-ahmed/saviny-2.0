const TOKEN_KEY = "saviny.token";

/** The session token is the only browser-side value kept; every access is guarded. */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session lasts for this page only */
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Options = Omit<RequestInit, "body"> & { json?: unknown };

export async function api<T>(path: string, { json, headers, method, ...init }: Options = {}): Promise<T> {
  const write = (method ?? "GET") !== "GET";
  if (write && !navigator.onLine) throw new ApiError("Connection required — nothing was saved.", 0);

  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    method,
    headers: {
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(headers as Record<string, string>),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

  if (res.status === 401 && token && !path.startsWith("/auth/")) {
    setToken(null);
    window.location.assign("/login");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message ?? res.statusText;
    throw new ApiError(message, res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Reads a local image as a data URL for listing photos. */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The photo could not be read"));
    reader.readAsDataURL(file);
  });
}

/** Authenticated GET for binary responses such as photos and voice notes. */
export async function apiBlob(path: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`/api${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError("This file is no longer available", res.status);
  return res.blob();
}

/** Authenticated multipart upload of one file. */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  if (!navigator.onLine) throw new ApiError("Connection required — nothing was saved.", 0);
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api${path}`, { method: "POST", body: form, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message ?? "The file could not be sent";
    throw new ApiError(message, res.status);
  }
  return body as T;
}
