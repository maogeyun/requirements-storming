import { getEventCard } from "@rs/game-data";
import type { GameState } from "@rs/shared";
import { getPlayer } from "./create-game";
import { createRng, drawOne } from "./rng";

export function assertEventFlipped(state: GameState): void {
  if (!state.eventFlippedThisRound) {
    throw new Error("必须先翻 1 张事件牌，才能进入本 Round");
  }
}

export function resetEventFlagsForNewRound(state: GameState): void {
  if (state.currentEventId) {
    state.eventDiscard.push(state.currentEventId);
    state.currentEventId = null;
  }
  state.eventFlippedThisRound = false;
  state.activeEventFlags = {
    doubleFirstMilestoneThisRound: false,
    firstMilestoneDoubled: false,
    skipExecutePlayerId: null,
    firefightingPlayerId: null,
    sideTrackRemaining: state.activeEventFlags.sideTrackRemaining,
  };
}

/**
 * Round 开始翻恰好 1 张事件牌并结算即时效果；持续效果写入 activeEventFlags。
 */
export function flipEventCard(state: GameState): { eventId: string; events: string[] } {
  if (state.eventFlippedThisRound) {
    throw new Error("本 Round 已翻过事件牌");
  }

  if (state.eventDeck.length === 0) {
    if (state.eventDiscard.length === 0) {
      throw new Error("事件牌库为空");
    }
    const rng = createRng(state.rngSeed + state.round * 17 + state.season * 31);
    let pool = [...state.eventDiscard];
    state.eventDiscard = [];
    const reshuffled: string[] = [];
    while (pool.length > 0) {
      const pick = drawOne(pool, rng);
      reshuffled.push(pick.item);
      pool = pick.rest;
    }
    state.eventDeck = reshuffled;
  }

  const { item, rest } = drawOne(state.eventDeck, createRng(state.rngSeed + state.round * 97));
  state.eventDeck = rest;
  state.currentEventId = item;
  state.eventFlippedThisRound = true;

  const flipperId = state.playerOrder[state.currentPlayerIndex]!;
  const messages = applyEventEffects(state, item, flipperId);
  return { eventId: item, events: messages };
}

function discardOneFromHand(state: GameState, playerId: string): void {
  const player = getPlayer(state, playerId);
  if (player.hand.length === 0) return;
  const cardId = player.hand[0]!;
  player.hand = player.hand.slice(1);
  state.actionDiscard.push(cardId);
}

function applyEventEffects(state: GameState, eventId: string, flipperId: string): string[] {
  const def = getEventCard(eventId);
  const name = def?.name ?? eventId;
  const messages: string[] = [`翻开事件 ${eventId}「${name}」`];

  switch (eventId) {
    case "E-01": {
      state.progress = Math.max(0, state.progress - 10);
      for (const id of state.playerOrder) {
        discardOneFromHand(state, id);
      }
      messages.push("进度 -10，全员弃 1 张手牌");
      break;
    }
    case "E-02": {
      state.activeEventFlags.firefightingPlayerId = flipperId;
      messages.push(`${flipperId} 本 Turn 规划 -16 工时救火`);
      break;
    }
    case "E-03": {
      state.activeEventFlags.sideTrackRemaining = 20;
      messages.push("新增临时需求轨道 20 进度");
      break;
    }
    case "E-04": {
      for (const player of state.players) {
        player.nextTurnBonusHours += 8;
      }
      messages.push("全员下个 Turn +8 工时");
      break;
    }
    case "E-05": {
      state.activeEventFlags.doubleFirstMilestoneThisRound = true;
      messages.push("本 Round 第一次突破的里程碑绩效翻倍（持续至收尾）");
      break;
    }
    case "E-06": {
      for (const player of state.players) {
        if (player.hand.length > 3) {
          discardOneFromHand(state, player.id);
        }
      }
      messages.push("手牌 >3 的玩家各弃 1 张");
      break;
    }
    case "E-07": {
      state.totalProgressTarget = Math.max(1, state.totalProgressTarget - 20);
      state.milestones = state.milestones.map((m) =>
        state.crossedMilestones.includes(m.id)
          ? m
          : { ...m, threshold: Math.max(1, m.threshold - 20) },
      );
      messages.push("总目标 -20，未达成里程碑阈值 -20");
      break;
    }
    case "E-08": {
      let lowest = state.players[0]!;
      for (const player of state.players) {
        if (player.performance < lowest.performance) lowest = player;
      }
      state.activeEventFlags.skipExecutePlayerId = lowest.id;
      messages.push(`${lowest.name} 跳过下个 Turn 执行阶段`);
      break;
    }
    case "E-09": {
      let totalBugs = 0;
      for (const player of state.players) {
        totalBugs += player.personalBugs;
      }
      if (totalBugs === 0) {
        for (const player of state.players) {
          player.performance += 1;
        }
        messages.push("无 Bug：全员 +1 绩效");
      } else {
        state.progress = Math.max(0, state.progress - totalBugs * 3);
        messages.push(`${totalBugs} 个未清 Bug → 进度 -${totalBugs * 3}`);
      }
      break;
    }
    default:
      messages.push("未知事件，仅记录翻开");
  }

  return messages;
}

/** 收尾阶段处理持续事件效果（v1.2：本 Round 持续类在 Round 末清除） */
export function resolveEndPhaseEventEffects(state: GameState): string[] {
  if (state.activeEventFlags.doubleFirstMilestoneThisRound) {
    return ["E-05 持续效果保留至 Round 结束"];
  }
  return [];
}

/** 测试/演示：强制翻开指定事件（绕过 RNG） */
export function forceFlipSpecificEvent(state: GameState, eventId: string): string[] {
  if (state.eventFlippedThisRound && state.currentEventId) {
    state.eventDiscard.push(state.currentEventId);
  }
  state.eventDeck = state.eventDeck.filter((id) => id !== eventId);
  state.eventDiscard = state.eventDiscard.filter((id) => id !== eventId);
  state.currentEventId = null;
  state.eventFlippedThisRound = false;
  state.activeEventFlags = {
    doubleFirstMilestoneThisRound: false,
    firstMilestoneDoubled: false,
    skipExecutePlayerId: null,
    firefightingPlayerId: null,
    sideTrackRemaining: state.activeEventFlags.sideTrackRemaining,
  };

  state.currentEventId = eventId;
  state.eventFlippedThisRound = true;
  const flipperId = state.playerOrder[state.currentPlayerIndex]!;
  return applyEventEffects(state, eventId, flipperId);
}
