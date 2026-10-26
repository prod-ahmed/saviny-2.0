import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { getToken } from "./api";

/** One live connection per signed-in session. Messages use it; nothing personal is cached. */
let socket: Socket | null = null;

/** Idempotent: reuses the open socket for the same token, otherwise connects with the current one. */
export function connectSocket(): void {
  const token = getToken();
  if (!token) return;
  if (socket && (socket.auth as { token?: string }).token === token) return;
  socket?.disconnect();
  socket = io({ path: "/api/socket.io", auth: { token }, transports: ["websocket"] });
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** The live socket when it is connected, otherwise null. Sending must check this first. */
export function liveSocket(): Socket | null {
  return socket?.connected ? socket : null;
}

/** Subscribes a component to a server event for as long as it is mounted. */
export function useLiveEvent<T>(event: string, handler: (payload: T) => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const current = socket;
    if (!current) return;
    const listener = (payload: T) => latest.current(payload);
    current.on(event, listener);
    return () => {
      current.off(event, listener);
    };
  }, [event]);
}

/** Whether the live connection is up, kept in sync with connect and disconnect events. */
export function useLiveStatus(): boolean {
  const [connected, setConnected] = useState(() => liveSocket() !== null);
  useEffect(() => {
    const current = socket;
    if (!current) return;
    const up = () => setConnected(true);
    const down = () => setConnected(false);
    setConnected(current.connected);
    current.on("connect", up);
    current.on("disconnect", down);
    return () => {
      current.off("connect", up);
      current.off("disconnect", down);
    };
  }, []);
  return connected;
}
