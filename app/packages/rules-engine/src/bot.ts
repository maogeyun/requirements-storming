import { getActionCard } from "@rs/game-data";
import type { GameAction, GameState, LegalAction } from "@rs/shared";
import { listLegalActions } from "./actions";
import { getCurrentPlayerId } from "./turn";

/**
 * Thin heuristic picker for vs-Bot local play.
 * Prefer progress / legal plays / mid dark-bid — not smart, not LLM.
 * Does not change rules or settlement semantics.
 */
export function pickHeuristicLegalAction(
  state: GameState,
  seatId: string,
): LegalAction | null {
  const enabled = listLegalActions(state, seatId).filter((item) => item.enabled);
  if (enabled.length === 0) return null;

  const byType = (type: GameAction["type"]) =>
    enabled.filter((item) => item.action.type === type);

  // Forced / window responses first
  const darkBids = byType("SUBMIT_DARK_BID");
  if (darkBids.length > 0) {
    const base = darkBids[0]!;
    const max =
      state.config.darkBidMax ?? state.constants.darkBidMax ?? 8;
    const mid = Math.floor(max / 2);
    const action: GameAction = {
      type: "SUBMIT_DARK_BID",
      playerId: seatId,
      amount: mid,
    };
    return { ...base, action, label: `${base.label}（启发式出价 ${mid}）` };
  }

  const declineC14 = byType("DECLINE_C14");
  if (declineC14.length > 0) return declineC14[0]!;
  const respondC14 = byType("RESPOND_C14");
  if (respondC14.length > 0) return respondC14[0]!;

  const passC13 = byType("PASS_C13");
  if (passC13.length > 0) return passC13[0]!;
  const respondC13 = byType("RESPOND_C13");
  if (respondC13.length > 0) return respondC13[0]!;

  // Phase bookkeeping
  for (const type of [
    "FLIP_EVENT",
    "DRAW_TO_HAND_LIMIT",
    "CONFIRM_PLAN",
    "FINISH_END_PHASE",
    "END_TURN",
  ] as const) {
    const hit = byType(type);
    if (hit.length > 0) return hit[0]!;
  }

  // Prefer progress-bearing plays, then any play, then overtime, then end
  const plays = byType("PLAY_CARD");
  if (plays.length > 0) {
    const scored = plays.map((item) => ({
      item,
      score: scorePlay(item),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0]!.item;
  }

  const overtime = byType("USE_BASE_OVERTIME");
  if (overtime.length > 0) return overtime[0]!;

  const endExecute = byType("END_EXECUTE");
  if (endExecute.length > 0) return endExecute[0]!;

  return enabled[0]!;
}

function scorePlay(item: LegalAction): number {
  if (item.action.type !== "PLAY_CARD") return 0;
  const card = getActionCard(item.action.cardId);
  if (!card) return 0;
  let score = 0;
  if (typeof card.progressGain === "number") score += card.progressGain * 10;
  if (typeof card.collabProgress === "number") score += card.collabProgress * 8;
  if (card.category === "skill") score += 5;
  if (card.category === "boost") score += 3;
  if (card.category === "collab" && !card.isInteraction) score += 2;
  // Avoid opening C-14 windows unless nothing else
  if (card.isInteraction) score -= 20;
  return score;
}

/** Seats that currently owe a Bot decision (forced windows or own turn). */
export function listBotActorSeats(
  state: GameState,
  botSeatIds: readonly string[],
): string[] {
  const bots = new Set(botSeatIds);
  if (bots.size === 0) return [];

  const interaction = state.pendingInteraction;
  if (interaction?.type === "C14") {
    return bots.has(interaction.targetId) ? [interaction.targetId] : [];
  }

  if (interaction?.type === "C13_WINDOW") {
    return state.playerOrder.filter(
      (id) =>
        bots.has(id) &&
        id !== interaction.breakerId &&
        !interaction.passedIds.includes(id),
    );
  }

  const pending = state.pendingDarkBid;
  if (pending && !pending.resolved) {
    return state.playerOrder.filter(
      (id) => bots.has(id) && !(id in pending.bids),
    );
  }

  const current = getCurrentPlayerId(state);
  if (current && bots.has(current) && !state.gameOver) {
    return [current];
  }

  return [];
}
