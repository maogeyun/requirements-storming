import { DISCONNECT_GRACE_MS } from "@rs/shared";

/**
 * Offline display-only fallback (RedQueen / JOJO P2).
 *
 * Server `DISCONNECT_GRACE_MS` is the grace authority. The client bar is
 * paint-only: anchor a local deadline once on first disconnect so repeated
 * `onClose` cannot reset/fake-extend the countdown. When a `view` carries
 * `presence.graceRemainingSec`, overwrite this with the server value —
 * do not run a second clock that fights the server.
 */
export function anchorDisconnectGraceDeadline(
  existingDeadlineMs: number | null,
  nowMs: number,
  graceMs: number = DISCONNECT_GRACE_MS,
): number {
  if (existingDeadlineMs != null) {
    return existingDeadlineMs;
  }
  return nowMs + graceMs;
}

/** Overwrite local display deadline from server `graceRemainingSec`. */
export function syncDisplayDeadlineFromServerRemaining(
  graceRemainingSec: number,
  nowMs: number,
): number {
  return nowMs + Math.max(0, graceRemainingSec) * 1000;
}

export function graceSecondsLeft(
  deadlineMs: number,
  nowMs: number,
): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export type DisconnectDisplay =
  | { kind: "ok" }
  | { kind: "grace"; remainingSec: number }
  | { kind: "hosted" };

/**
 * Map self `SeatPresence` → disconnect bar. Server fields win whenever present.
 */
export function disconnectDisplayFromPresence(presence: {
  connected: boolean;
  graceRemainingSec: number | null;
  hosted: boolean;
} | null | undefined): DisconnectDisplay {
  if (!presence) return { kind: "ok" };
  if (presence.hosted) return { kind: "hosted" };
  if (presence.graceRemainingSec != null) {
    if (presence.graceRemainingSec <= 0) return { kind: "hosted" };
    return { kind: "grace", remainingSec: presence.graceRemainingSec };
  }
  return { kind: "ok" };
}
