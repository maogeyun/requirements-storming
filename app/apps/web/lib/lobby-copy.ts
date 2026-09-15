/**
 * Free-match / lobby copy locks (i-pple): never expose Bot fill to the player.
 */

export const FREE_MATCH_LABEL = "自由匹配";
export const FREE_MATCH_QUEUE_SUB = "预计不久开局";

export function freeMatchQueueMain(waitedSeconds: number): string {
  return `正在匹配玩家 · ${Math.max(0, Math.floor(waitedSeconds))}s`;
}

/** Forbidden substrings in any player-facing free-match / lobby chrome. */
export const FORBIDDEN_BOT_COPY = [
  "Bot",
  "bot",
  "机器人",
  "补位",
  "匹配失败",
  "本局含 Bot",
] as const;

export function assertNoBotCopy(text: string): boolean {
  return !FORBIDDEN_BOT_COPY.some((needle) => text.includes(needle));
}
