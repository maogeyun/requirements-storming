/**
 * Online disconnect UX copy (i-pple).
 * Distinct from free-match: 托管 / Bot wording is OK here only.
 */

export function disconnectTopBar(graceRemainingSec: number): string {
  return `连接中断 · ${Math.max(0, Math.floor(graceRemainingSec))} 秒内可回`;
}

/** Weak post-timeout hint on the disconnected seat (self). */
export const DISCONNECT_HOSTED_HINT = "本座已托管";

/** One-line toast after seatToken reclaim. */
export const DISCONNECT_RECLAIM_TOAST = "座位已收回";
