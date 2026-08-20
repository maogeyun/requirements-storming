import { getActionCard } from "@rs/game-data";
import type { GameState } from "@rs/shared";
import { getPlayer } from "./create-game.js";
import {
  applyProgressGain,
  clearPendingDarkBid,
  detectDarkBidTrigger,
  openDarkBid,
  resolveDarkBidBids,
  resolveDarkBidPriorityOnTie,
  submitDarkBid,
} from "./milestone.js";

export interface PlaySkillResult {
  needsDarkBid: boolean;
  settlements: ReturnType<typeof applyProgressGain>;
}

/**
 * 打出技能卡并处理 FIX-01 暗标流程（简化版：同步提交所有 bid）。
 */
export function playSkillCard(
  state: GameState,
  playerId: string,
  cardId: string,
  bids?: Record<string, number>,
): PlaySkillResult {
  const card = getActionCard(cardId);
  if (!card || card.category !== "skill") {
    throw new Error(`Not a skill card: ${cardId}`);
  }

  const player = getPlayer(state, playerId);
  if (!player.hand.includes(cardId)) {
    throw new Error(`Card not in hand: ${cardId}`);
  }

  const progressGain = card.progressGain ?? 0;
  const trigger = detectDarkBidTrigger(state, progressGain);

  if (trigger) {
    openDarkBid(state, trigger);
    const order = state.playerOrder;
    for (const id of order) {
      submitDarkBid(state, id, bids?.[id] ?? 0);
    }
    resolveDarkBidBids(state);
    resolveDarkBidPriorityOnTie(state, playerId);
  }

  player.workHoursRemaining -= card.workHours;
  player.hand = player.hand.filter((id) => id !== cardId);
  state.actionDiscard.push(cardId);

  const settlements = applyProgressGain(state, playerId, progressGain);
  return { needsDarkBid: Boolean(trigger), settlements };
}

export { createGame, createDefaultConfig } from "./create-game.js";
export type { CreateGameOptions } from "./create-game.js";
export * from "./milestone.js";
export * from "./rng.js";
