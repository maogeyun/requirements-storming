import type { GameAction, LegalAction } from "@rs/shared";

/**
 * 判断 intent 是否落在 listLegalActions 的 enabled 集合中。
 * SUBMIT_DARK_BID 的 list 项 amount 为占位 0，只按 type+playerId 匹配。
 */
export function isLegalIntent(
  legal: LegalAction[],
  action: GameAction,
): boolean {
  return legal.some((item) => item.enabled && actionsMatch(item.action, action));
}

function actionsMatch(a: GameAction, b: GameAction): boolean {
  if (a.type !== b.type) return false;

  switch (a.type) {
    case "SUBMIT_DARK_BID":
      return b.type === "SUBMIT_DARK_BID" && a.playerId === b.playerId;
    case "PLAY_CARD":
      return (
        b.type === "PLAY_CARD" &&
        a.playerId === b.playerId &&
        a.cardId === b.cardId &&
        a.dumpKind === b.dumpKind &&
        sameStringArray(a.targets, b.targets)
      );
    case "RESOLVE_DARK_BID":
      return b.type === "RESOLVE_DARK_BID" && a.crosserId === b.crosserId;
    case "RESPOND_C13":
    case "PASS_C13":
    case "DECLINE_C14":
    case "USE_BASE_OVERTIME":
      return (
        "playerId" in b &&
        b.type === a.type &&
        a.playerId === b.playerId
      );
    case "RESPOND_C14":
      return (
        b.type === "RESPOND_C14" &&
        a.playerId === b.playerId &&
        a.sourceId === b.sourceId
      );
    default:
      return a.type === b.type;
  }
}

function sameStringArray(
  a: string[] | undefined,
  b: string[] | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
