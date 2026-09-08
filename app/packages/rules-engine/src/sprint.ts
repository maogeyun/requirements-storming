import { buildRequirementDeck } from "@rs/game-data";
import type { GameState, SprintSwitchInfo } from "@rs/shared";
import { resetDarkBidFlags } from "./create-game";
import { createRng, drawOne, shuffle } from "./rng";

/** 连续 Sprint 开启且尚未跑完约定局数 → 达标后进下一 Sprint，不终局 */
export function canAdvanceSprint(state: GameState): boolean {
  return (
    state.config.modules.continuousSprint &&
    state.sprint < state.config.sprintCount
  );
}

/** 从剩余需求池抽取（禁止已用过的需求卡，TC-624） */
export function drawNextRequirementId(
  usedRequirementIds: readonly string[],
  rng: () => number,
): string {
  const used = new Set(usedRequirementIds);
  const remaining = buildRequirementDeck().filter((id) => !used.has(id));
  if (remaining.length === 0) {
    throw new Error("需求卡池已耗尽，无法抽取下一 Sprint 需求");
  }
  const { item } = drawOne(shuffle(remaining, rng), rng);
  return item;
}

function buildSwitchInfo(
  fromSprint: number,
  toSprint: number,
  previousRequirementId: string,
  nextRequirementId: string,
): SprintSwitchInfo {
  return {
    fromSprint,
    toSprint,
    previousRequirementId,
    nextRequirementId,
    cleared: ["进度", "个人技术债", "个人 Bug", "公共债", "里程碑突破记录"],
    carried: ["绩效", "OKR 计数器"],
  };
}

/**
 * Sprint 达标后进入下一 Sprint：
 * - 进度 → 0；债 / Bug 清空（TC-621 / TC-623）
 * - 绩效与 OKR 计数器结转不清零（TC-622 / TC-625）
 * - 需求从剩余池抽取，禁重复（TC-624）
 */
export function advanceToNextSprint(state: GameState, seedOffset = 0): string[] {
  if (!canAdvanceSprint(state)) {
    throw new Error("Cannot advance sprint: continuous module off or series complete");
  }

  const fromSprint = state.sprint;
  const previousRequirementId = state.requirementId;
  const rng = createRng(state.rngSeed + state.sprint * 97 + seedOffset);
  const nextRequirementId = drawNextRequirementId(state.usedRequirementIds, rng);

  state.sprint += 1;
  state.progress = 0;
  state.crossedMilestones = [];
  resetDarkBidFlags(state);
  state.pendingDarkBid = null;
  state.pendingProgressSettlement = null;
  state.pendingPerformanceSettlement = null;
  state.pendingPerformanceSettlementQueue = [];
  state.pendingInteraction = null;
  state.publicDebt = nextRequirementId === "R-06" ? 3 : 0;
  state.roundContributors = new Set();
  state.darkBidTotalSpent = 0;
  state.currentEventId = null;
  state.eventFlippedThisRound = false;
  state.activeEventFlags = {
    doubleFirstMilestoneThisRound: false,
    firstMilestoneDoubled: false,
    skipExecutePlayerId: null,
    firefightingPlayerId: null,
    sideTrackRemaining: 0,
  };

  for (const player of state.players) {
    player.personalBugs = 0;
    player.personalDebt = 0;
    player.contributedThisRound = false;
    // 绩效 / OKR 计数器（bugsClearedTotal、milestoneBreakCount 等）保留
  }

  state.requirementId = nextRequirementId;
  state.usedRequirementIds = [...state.usedRequirementIds, nextRequirementId];
  state.gameOver = false;
  state.winnerId = null;
  // OKR 仅在全部 Sprint 结束后亮牌
  state.okrRevealed = false;
  state.okrSettlements = null;

  const info = buildSwitchInfo(
    fromSprint,
    state.sprint,
    previousRequirementId,
    nextRequirementId,
  );
  state.sprintSwitchInfo = info;

  return [
    `Sprint ${fromSprint} 达标 → 进入 Sprint ${state.sprint}/${state.config.sprintCount}`,
    `重置：进度 0 · 债/Bug 清空 · 里程碑重置`,
    `结转：绩效累计 · OKR 计数器跨 Sprint`,
    `需求：${previousRequirementId} → ${nextRequirementId}（禁重复）`,
  ];
}

/** 系列是否已跑完全部 Sprint（用于总结算 / 系列 MVP） */
export function isSeriesComplete(state: GameState): boolean {
  if (!state.config.modules.continuousSprint) {
    return state.progress >= state.totalProgressTarget;
  }
  return (
    state.sprint >= state.config.sprintCount &&
    state.progress >= state.totalProgressTarget
  );
}
