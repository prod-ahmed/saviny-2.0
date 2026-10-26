/** Browser notifications for new messages, the tab title count, and a short tone. */

export const notificationsSupported = (): boolean => typeof window !== "undefined" && "Notification" in window;

export const notificationPermission = (): NotificationPermission | "unsupported" =>
  notificationsSupported() ? Notification.permission : "unsupported";

export async function enableNotifications(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  return Notification.requestPermission();
}

/** Shows a system notification; clicking it focuses Saviny and opens the conversation. */
export function showMessageNotification(title: string, body: string, tag: string, onClick: () => void): void {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  const note = new Notification(title, { body, tag, icon: "/icons/icon-192.png" });
  note.onclick = () => {
    window.focus();
    onClick();
    note.close();
  };
}

export function setUnreadTitle(count: number): void {
  document.title = count > 0 ? `(${count}) Saviny` : "Saviny";
}

/** A short two-note tone. Browsers may refuse audio before the first interaction, so failures are ignored. */
export function playMessageTone(): void {
  try {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtor();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.11);
    });
    setTimeout(() => void ctx.close(), 400);
  } catch {
    /* no audio available */
  }
}
