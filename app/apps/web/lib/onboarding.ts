/**
 * Newbie onboarding V1 (体验口径).
 * Persistence: localStorage `onboarding.v1.done` + `onboarding.v1.tips.seen`.
 * Replay and the same-session first table use sessionStorage only.
 * Match-server authority is untouched.
 */

import { DISCONNECT_GRACE_MS } from "@rs/shared";
import { assertNoBotCopy } from "./lobby-copy";

export const ONBOARDING_DONE_KEY = "onboarding.v1.done";
export const ONBOARDING_TIPS_KEY = "onboarding.v1.tips.seen";

const ONLINE_HINT_SEEN_KEY = "onboarding.v1.onlineHint.seen";
const ONLINE_HINT_PENDING_KEY = "onboarding.v1.onlineHint.pending";
const REPLAY_KEY = "onboarding.v1.replay";
const TABLE_SOFT_KEY = "onboarding.v1.tableSoft";

export const LOBBY_STEP_COUNT = 3;

export const STEP1_LINE = "半合作推需求上线，绩效比拼当 MVP。";
export const STEP1_PRIMARY = "开始本地人机";
export const STEP1_SKIP = "跳过引导";
export const STEP2_PRIMARY = "继续";
export const STEP2_SKIP = "跳过";
export const STEP3_LINE = "首局跟系统提示走；灰掉的动作表示现在不能做。";
export const STEP3_PRIMARY = "开局";
export const STEP3_SKIP = "跳过";
export const REPLAY_LABEL = "再看一遍引导";
export const ONLINE_HINT = "规则还不熟可先打一局人机";

export const ENTRY_GUIDE = {
  local: "自己练规则，推荐新手",
  create: "拉朋友，房号进",
  join: "输入房号",
  match: "排队凑桌，无需房号",
} as const;

export type CoachTipId =
  | "tip.turn_phases"
  | "tip.okr_private"
  | "tip.forced_bid"
  | "tip.c14"
  | "tip.sprint_switch"
  | "tip.disconnect";

export const COACH_TIP_IDS: readonly CoachTipId[] = [
  "tip.turn_phases",
  "tip.okr_private",
  "tip.forced_bid",
  "tip.c14",
  "tip.sprint_switch",
  "tip.disconnect",
];

const SOFT_TIPS = new Set<CoachTipId>(["tip.turn_phases", "tip.okr_private"]);
const FORCED_TIPS = new Set<CoachTipId>([
  "tip.forced_bid",
  "tip.c14",
  "tip.sprint_switch",
  "tip.disconnect",
]);

const COACH_COPY: Record<Exclude<CoachTipId, "tip.disconnect">, { title: string; body: string }> =
  {
    "tip.turn_phases": {
      title: "回合四阶段",
      body: "抽卡、规划、执行、收尾；灰显表示现在不可做。",
    },
    "tip.okr_private": {
      title: "OKR保密",
      body: "自己的 OKR 保密，结算才亮。",
    },
    "tip.forced_bid": {
      title: "暗标出价",
      body: "不可跳过。押 0–8，高者拿突破优先。",
    },
    "tip.c14": {
      title: "当下反制",
      body: "当下反制；错过即过。",
    },
    "tip.sprint_switch": {
      title: "冲刺切换",
      body: "进度重置，绩效结转。",
    },
  };

export type Kv = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type CoachContext = {
  inMatchQueue: boolean;
  endgameBoard: boolean;
  inOwnActionArea: boolean;
  ownOkrVisible: boolean;
  forcedBid: boolean;
  c14Window: boolean;
  sprintSwitch: boolean;
  disconnectBar: boolean;
  disconnectGraceSec: number;
  /** Soft tips (回合 / OKR) — off once the lobby path is done, except the first table session. */
  allowSoft: boolean;
};

export function defaultDisconnectGraceSec(): number {
  return Math.round(DISCONNECT_GRACE_MS / 1000);
}

export function coachTipCopy(
  id: CoachTipId,
  graceSec: number = defaultDisconnectGraceSec(),
): { title: string; body: string } {
  if (id === "tip.disconnect") {
    const n = Math.max(0, Math.floor(graceSec));
    return {
      title: "连接中断",
      body: `${n} 秒内可回；超时本座托管；回连夺回。`,
    };
  }
  return COACH_COPY[id];
}

export function isSoftCoachTip(id: CoachTipId): boolean {
  return SOFT_TIPS.has(id);
}

export function isForcedCoachTip(id: CoachTipId): boolean {
  return FORCED_TIPS.has(id);
}

export function readDone(kv: Kv | null): boolean {
  return kv?.getItem(ONBOARDING_DONE_KEY) === "1";
}

export function readTips(kv: Kv | null): string[] {
  if (!kv) return [];
  const raw = kv.getItem(ONBOARDING_TIPS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function writeTip(kv: Kv, id: string): string[] {
  const next = new Set(readTips(kv));
  next.add(id);
  const list = [...next];
  kv.setItem(ONBOARDING_TIPS_KEY, JSON.stringify(list));
  return list;
}

/** Lobby skip: mark the main path done. Does not touch tip.seen. */
export function applySkip(local: Kv, session: Kv): void {
  local.setItem(ONBOARDING_DONE_KEY, "1");
  session.removeItem(REPLAY_KEY);
}

/** Step 3「开局」: done + this browser session may still teach unseen soft tips once. */
export function applyCompleteConfirm(local: Kv, session: Kv): void {
  local.setItem(ONBOARDING_DONE_KEY, "1");
  session.removeItem(REPLAY_KEY);
  session.setItem(TABLE_SOFT_KEY, "1");
}

/** 「再看一遍」: lobby steps only. Does not reset tip.seen or done. */
export function applyBeginReplay(session: Kv): void {
  session.setItem(REPLAY_KEY, "1");
}

export function replayActive(session: Kv | null): boolean {
  return session?.getItem(REPLAY_KEY) === "1";
}

export function softTipsAllowed(local: Kv | null, session: Kv | null): boolean {
  if (!readDone(local)) return true;
  return session?.getItem(TABLE_SOFT_KEY) === "1";
}

export function confirmGuideActive(local: Kv | null, session: Kv | null): boolean {
  return replayActive(session) || !readDone(local);
}

export function armOnlineHint(local: Kv, session: Kv): void {
  if (local.getItem(ONLINE_HINT_SEEN_KEY) === "1") return;
  session.setItem(ONLINE_HINT_PENDING_KEY, "1");
}

/**
 * Show the prefer-AI hint while it is pending.
 * Pending stays until dismiss so a strict-mode remount can still paint it.
 * Seen is recorded on first show so 「再看一遍」cannot arm it again.
 */
export function consumeOnlineHint(local: Kv, session: Kv): string | null {
  if (session.getItem(ONLINE_HINT_PENDING_KEY) !== "1") return null;
  local.setItem(ONLINE_HINT_SEEN_KEY, "1");
  return ONLINE_HINT;
}

export function dismissOnlineHint(session: Kv): void {
  session.removeItem(ONLINE_HINT_PENDING_KEY);
}

/**
 * One situational tip. Queue and the endgame board suppress everything.
 * Forced windows beat soft tips. Soft tips need `allowSoft` and the local action area.
 */
export function selectCoachTip(
  ctx: CoachContext,
  seen: ReadonlySet<string>,
): CoachTipId | null {
  if (ctx.inMatchQueue || ctx.endgameBoard) return null;
  if (ctx.forcedBid && !seen.has("tip.forced_bid")) return "tip.forced_bid";
  if (ctx.c14Window && !seen.has("tip.c14")) return "tip.c14";
  if (ctx.sprintSwitch && !seen.has("tip.sprint_switch")) return "tip.sprint_switch";
  if (ctx.disconnectBar && !seen.has("tip.disconnect")) return "tip.disconnect";
  if (!ctx.allowSoft || !ctx.inOwnActionArea) return null;
  if (!seen.has("tip.turn_phases")) return "tip.turn_phases";
  if (ctx.ownOkrVisible && !seen.has("tip.okr_private")) return "tip.okr_private";
  return null;
}

export function coachTriggerActive(id: CoachTipId, ctx: CoachContext): boolean {
  if (ctx.inMatchQueue || ctx.endgameBoard) return false;
  switch (id) {
    case "tip.forced_bid":
      return ctx.forcedBid;
    case "tip.c14":
      return ctx.c14Window;
    case "tip.sprint_switch":
      return ctx.sprintSwitch;
    case "tip.disconnect":
      return ctx.disconnectBar;
    case "tip.turn_phases":
      return ctx.allowSoft && ctx.inOwnActionArea;
    case "tip.okr_private":
      return ctx.allowSoft && ctx.inOwnActionArea && ctx.ownOkrVisible;
    default:
      return false;
  }
}

export type LocalTableSignals = {
  allowSoft: boolean;
  gameOver: boolean;
  endgameRitual: boolean;
  vsBot: boolean;
  humanTurn: boolean;
  actionLocked: boolean;
  showForced: boolean;
  forced: "c14" | "catch_up_dark_bid" | null;
  sprintSwitch: boolean;
  okrVisible: boolean;
};

export function coachContextFromLocalTable(signals: LocalTableSignals): CoachContext {
  const endgameBoard = signals.gameOver || signals.endgameRitual;
  const inOwnActionArea =
    !endgameBoard &&
    !signals.showForced &&
    (signals.vsBot ? signals.humanTurn && !signals.actionLocked : true);
  return {
    inMatchQueue: false,
    endgameBoard,
    inOwnActionArea,
    ownOkrVisible: signals.okrVisible && inOwnActionArea,
    forcedBid: signals.showForced && signals.forced === "catch_up_dark_bid",
    c14Window: signals.showForced && signals.forced === "c14",
    sprintSwitch: signals.sprintSwitch && !endgameBoard,
    disconnectBar: false,
    disconnectGraceSec: defaultDisconnectGraceSec(),
    allowSoft: signals.allowSoft,
  };
}

export type OnlineTableSignals = {
  allowSoft: boolean;
  inMatchQueue: boolean;
  gameOver: boolean;
  disconnectBar: boolean;
  graceSec: number;
  forceKind: "dark_bid" | "c14" | "c13" | null;
  ownTurn: boolean;
};

export function coachContextFromOnline(signals: OnlineTableSignals): CoachContext {
  const forcedBid = signals.forceKind === "dark_bid";
  const c14Window = signals.forceKind === "c14";
  const endgameBoard = signals.gameOver;
  return {
    inMatchQueue: signals.inMatchQueue,
    endgameBoard,
    inOwnActionArea:
      signals.allowSoft &&
      signals.ownTurn &&
      !endgameBoard &&
      !signals.inMatchQueue &&
      !forcedBid &&
      !c14Window,
    ownOkrVisible: false,
    forcedBid,
    c14Window,
    sprintSwitch: false,
    disconnectBar: signals.disconnectBar,
    disconnectGraceSec: signals.graceSec,
    allowSoft: signals.allowSoft,
  };
}

/** Free-match teaching line must stay inside the bot-fill lock. */
export function freeMatchGuideBlurb(): string {
  const line = ENTRY_GUIDE.match;
  if (!assertNoBotCopy(line)) {
    throw new Error("free-match onboarding blurb leaked forbidden copy");
  }
  return line;
}

function browserLocal(): Kv | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function browserSession(): Kv | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function isOnboardingDone(): boolean {
  return readDone(browserLocal());
}

export function readTipsSeen(): string[] {
  return readTips(browserLocal());
}

export function markTipSeen(id: string): void {
  const kv = browserLocal();
  if (!kv) return;
  writeTip(kv, id);
}

export function skipOnboarding(): void {
  const local = browserLocal();
  const session = browserSession();
  if (!local || !session) return;
  applySkip(local, session);
}

export function completeOnboardingConfirm(): void {
  const local = browserLocal();
  const session = browserSession();
  if (!local || !session) return;
  applyCompleteConfirm(local, session);
}

export function beginOnboardingReplay(): void {
  const session = browserSession();
  if (!session) return;
  applyBeginReplay(session);
}

export function isOnboardingReplay(): boolean {
  return replayActive(browserSession());
}

export function allowSoftTipsNow(): boolean {
  return softTipsAllowed(browserLocal(), browserSession());
}

export function playConfirmGuideNow(): boolean {
  return confirmGuideActive(browserLocal(), browserSession());
}

export function armPreferAiHint(): void {
  const local = browserLocal();
  const session = browserSession();
  if (!local || !session) return;
  armOnlineHint(local, session);
}

export function takePreferAiHint(): string | null {
  const local = browserLocal();
  const session = browserSession();
  if (!local || !session) return null;
  return consumeOnlineHint(local, session);
}

export function dismissPreferAiHint(): void {
  const session = browserSession();
  if (!session) return;
  dismissOnlineHint(session);
}

/** In-memory pin so a strict-mode remount can restore the tip already marked seen. */
let memoryCoachPin: CoachTipId | null = null;

export function peekCoachPin(): CoachTipId | null {
  return memoryCoachPin;
}

export function setCoachPin(id: CoachTipId | null): void {
  memoryCoachPin = id;
}
