/** Client session for online seat reconnect (seatToken issued after auth). */

const KEY = "rs.online.seat";

export type OnlineSeatSession = {
  roomCode: string;
  seatId: string;
  seatToken: string;
  displayName: string;
};

export function saveOnlineSession(session: OnlineSeatSession): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function loadOnlineSession(): OnlineSeatSession | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OnlineSeatSession;
  } catch {
    return null;
  }
}

export function clearOnlineSession(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(KEY);
}
