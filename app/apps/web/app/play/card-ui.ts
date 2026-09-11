import { getActionCard } from "@rs/game-data";
import type { GameAction, LegalAction } from "@rs/shared";

/** Busy 牌族角标：手牌 A/I；桌心/详情 E/O/R */
export type CardFamilyBadge = "A" | "I" | "E" | "O" | "R";

export type TableDetailKind = "requirement" | "event" | null;

export function handCardBadge(cardId: string): CardFamilyBadge {
  const card = getActionCard(cardId);
  if (!card) return "A";
  if (card.category === "collab" || card.isInteraction) return "I";
  return "A";
}

export function handCardCostCopy(cardId: string): string {
  const card = getActionCard(cardId);
  if (!card) return "—";
  return `${card.workHours}h`;
}

export function handCardEffectLine(cardId: string): string {
  const card = getActionCard(cardId);
  if (!card) return "—";
  return card.effectText;
}

export function playVariantKey(action: Extract<GameAction, { type: "PLAY_CARD" }>): string {
  const targets = action.targets?.join(",") ?? "";
  const dump = action.dumpKind ?? "";
  return `${action.cardId}|${targets}|${dump}`;
}

export function playActionsForCard(
  legal: LegalAction[],
  cardId: string,
): LegalAction[] {
  return legal.filter(
    (item) => item.action.type === "PLAY_CARD" && item.action.cardId === cardId,
  );
}

export function enabledPlayActions(legal: LegalAction[], cardId: string): LegalAction[] {
  return playActionsForCard(legal, cardId).filter((item) => item.enabled);
}

/** 非出牌主路径：留在底栏；出牌走点牌 */
export function isNonCardBarAction(action: GameAction): boolean {
  switch (action.type) {
    case "DRAW_TO_HAND_LIMIT":
    case "CONFIRM_PLAN":
    case "FLIP_EVENT":
    case "USE_BASE_OVERTIME":
    case "END_EXECUTE":
    case "FINISH_END_PHASE":
      return true;
    default:
      return false;
  }
}

/** 右下角钉住：投入工时 / 结束回合 — 不抢手牌扇视觉 */
export function isCornerPinAction(action: GameAction): boolean {
  switch (action.type) {
    case "USE_BASE_OVERTIME":
    case "END_EXECUTE":
    case "FINISH_END_PHASE":
      return true;
    default:
      return false;
  }
}

/** 贴在手牌上方的阶段动作（抽卡 / 翻事件 / 领取工时） */
export function isPhaseRailAction(action: GameAction): boolean {
  return isNonCardBarAction(action) && !isCornerPinAction(action);
}

export function barActionLabel(item: LegalAction): string {
  switch (item.action.type) {
    case "USE_BASE_OVERTIME":
      return "投入工时";
    case "END_EXECUTE":
      return "结束回合";
    case "FINISH_END_PHASE":
      return "结束回合";
    case "CONFIRM_PLAN":
      return "领取工时";
    case "FLIP_EVENT":
      return "翻开事件";
    case "DRAW_TO_HAND_LIMIT":
      return "抽卡";
    default:
      return item.label;
  }
}

export function compactVariantLabel(
  item: LegalAction,
  stateSeatName: (playerId: string) => string,
): string {
  const action = item.action;
  if (action.type !== "PLAY_CARD") return item.label;
  const target = action.targets?.[0];
  const targetName = target ? stateSeatName(target) : null;
  if (action.cardId === "C-12") {
    const kind = action.dumpKind === "bug" ? "甩 Bug" : "甩债";
    return targetName ? `${kind} → ${targetName}` : kind;
  }
  if (targetName) return `→ ${targetName}`;
  return "打出";
}

export function illegalReasonForCard(
  legal: LegalAction[],
  cardId: string,
  turnPhaseAllowsPlay: boolean,
): string {
  const plays = playActionsForCard(legal, cardId);
  if (plays.length > 0) {
    const disabled = plays.find((p) => !p.enabled && p.reason);
    if (disabled?.reason) return disabled.reason;
    if (plays.every((p) => !p.enabled)) {
      return plays[0]?.reason ?? "当前不可打出";
    }
  }
  if (!turnPhaseAllowsPlay) return "当前阶段无法出牌";
  return "当前不可打出";
}
