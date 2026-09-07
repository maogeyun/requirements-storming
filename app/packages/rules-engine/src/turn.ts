import { gameConstants } from "@rs/game-data";
import type { GameState } from "@rs/shared";
import { getPlayer } from "./create-game";
import {
  assertEventFlipped,
  resetEventFlagsForNewRound,
  resolveEndPhaseEventEffects,
} from "./events";
import { createRng, drawOne } from "./rng";

export function getCurrentPlayerId(state: GameState): string {
  return state.playerOrder[state.currentPlayerIndex]!;
}

export function assertNoPendingDarkBid(state: GameState): void {
  if (state.pendingDarkBid && !state.pendingDarkBid.resolved) {
    throw new Error("必须补开，不能跳过：存在未完成的强制暗标");
  }
  if (state.pendingProgressSettlement) {
    throw new Error("必须补开，不能跳过：跨线进度结算仍挂起");
  }
}

export function assertNoPendingInteraction(state: GameState): void {
  if (state.pendingInteraction?.type === "C14") {
    throw new Error("必须响应 C-14，不能跳过");
  }
  if (state.pendingInteraction?.type === "C13_WINDOW") {
    throw new Error("跨线互动窗未关闭：请先处理 C-13 或弃权");
  }
  if (state.pendingPerformanceSettlement) {
    throw new Error("跨线绩效尚未结算");
  }
  if (state.pendingPerformanceSettlementQueue.length > 0) {
    throw new Error("跨线绩效队列未清空：后续线仍须走 C-13 窗");
  }
}

/** 抽卡阶段：手牌补至上限，然后进入规划 */
export function runDrawPhase(state: GameState): void {
  assertEventFlipped(state);
  assertNoPendingDarkBid(state);
  assertNoPendingInteraction(state);
  if (state.turnPhase !== "draw") {
    throw new Error("Not in draw phase");
  }

  const player = getPlayer(state, getCurrentPlayerId(state));
  const handLimit = Math.max(0, gameConstants.handLimit + player.handLimitModifier);
  const rng = createRng(state.rngSeed + state.round * 100 + state.currentPlayerIndex);

  while (player.hand.length < handLimit && state.actionDeck.length > 0) {
    const { item, rest } = drawOne(state.actionDeck, rng);
    state.actionDeck = rest;
    player.hand.push(item);
  }

  // Reshuffle discard if deck empty and still need cards
  if (player.hand.length < handLimit && state.actionDeck.length === 0 && state.actionDiscard.length > 0) {
    state.actionDeck = [...state.actionDiscard];
    state.actionDiscard = [];
    const reshuffled: string[] = [];
    let pool = state.actionDeck;
    while (pool.length > 0) {
      const pick = drawOne(pool, rng);
      reshuffled.push(pick.item);
      pool = pick.rest;
    }
    state.actionDeck = reshuffled;
    while (player.hand.length < handLimit && state.actionDeck.length > 0) {
      const { item, rest } = drawOne(state.actionDeck, rng);
      state.actionDeck = rest;
      player.hand.push(item);
    }
  }

  state.turnPhase = "plan";
}

/** 规划阶段：领取本 Turn 工时预算，进入执行 */
export function runPlanPhase(state: GameState): void {
  assertEventFlipped(state);
  assertNoPendingDarkBid(state);
  assertNoPendingInteraction(state);
  if (state.turnPhase !== "plan") {
    throw new Error("Not in plan phase");
  }

  const player = getPlayer(state, getCurrentPlayerId(state));
  let base = gameConstants.baseWorkHoursPerTurn + player.nextTurnBonusHours;
  if (state.activeEventFlags.firefightingPlayerId === player.id) {
    base = Math.max(0, base - 16);
    state.activeEventFlags.firefightingPlayerId = null;
  }
  player.workHoursBudget = base;
  player.workHoursRemaining = base;
  player.nextTurnBonusHours = 0;
  player.usedOvertime = false;

  // E-08：跳过执行阶段
  if (state.activeEventFlags.skipExecutePlayerId === player.id) {
    state.activeEventFlags.skipExecutePlayerId = null;
    state.turnPhase = "end";
    return;
  }

  state.turnPhase = "execute";
}

/** 执行阶段结束 → 收尾 */
export function endExecutePhase(state: GameState): void {
  assertNoPendingDarkBid(state);
  assertNoPendingInteraction(state);
  if (state.turnPhase !== "execute") {
    throw new Error("Not in execute phase");
  }
  state.turnPhase = "end";
}

/** 收尾：清零未用工时，推进到下一位玩家的抽卡（或下一 Round） */
export function finishEndPhase(state: GameState): void {
  assertNoPendingDarkBid(state);
  assertNoPendingInteraction(state);
  if (state.turnPhase !== "end") {
    throw new Error("Not in end phase");
  }

  resolveEndPhaseEventEffects(state);

  const player = getPlayer(state, getCurrentPlayerId(state));
  player.workHoursRemaining = 0;
  player.handLimitModifier = 0;

  const nextIndex = state.currentPlayerIndex + 1;
  if (nextIndex >= state.playerOrder.length) {
    // Round 结束：进入下一 Round，须重新翻事件
    state.currentPlayerIndex = 0;
    state.round += 1;
    for (const p of state.players) {
      p.contributedThisRound = false;
    }
    state.roundContributors = new Set();
    resetEventFlagsForNewRound(state);
    if (state.round > gameConstants.roundsPerSeason) {
      state.round = 1;
      state.season += 1;
      for (const p of state.players) {
        p.seasonPlayedCollab = [];
        if (p.slackingNextSeason) {
          p.handLimitModifier = -1;
          p.slackingNextSeason = false;
        }
      }
    }
  } else {
    state.currentPlayerIndex = nextIndex;
  }

  state.turnPhase = "draw";
}
