import { DISCONNECT_GRACE_MS } from "@rs/shared";

/**
 * Local disconnect-grace deadline for one offline episode.
 * Anchor once on first disconnect; later onClose must not extend it.
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

/** Prefer server remaining seconds when a view arrives mid-grace. */
export function deadlineFromServerGraceRemainingSec(
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
