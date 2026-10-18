import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import { connectSocket, disconnectSocket } from "./socket";
import type { User } from "./types";

export interface Loader<T> {
  data: T | undefined;
  error: string;
  loading: boolean;
  reload: () => void;
}

/** GET a resource whenever the path changes or reload() is called. */
export function useApi<T>(path: string | null): Loader<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let active = true;
    setLoading(true);
    api<T>(path)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError("");
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export interface Session {
  user: User | null;
  ready: boolean;
  refresh: () => void;
  logout: () => Promise<void>;
}

export const SessionContext = createContext<Session>({ user: null, ready: false, refresh: () => {}, logout: async () => {} });

export const useSession = () => useContext(SessionContext);

/** Loads the signed-in user once per token; signing out clears the token everywhere. */
export function useSessionState(): Session {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!getToken());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!getToken()) return;
    let active = true;
    api<User>("/auth/me")
      .then((u) => {
        if (!active) return;
        connectSocket();
        setUser(u);
      })
      .catch(() => active && setUser(null))
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, [version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* the session may already be gone; clear it locally anyway */
    }
    disconnectSocket();
    setToken(null);
    window.location.assign("/login");
  }, []);

  return { user, ready, refresh, logout };
}
