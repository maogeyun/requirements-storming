import { getOkrCard, isInteractionCardId, isTeamFoundationCollabId } from "@rs/game-data";
import type { GameState, OkrEvaluation, PlayerState } from "@rs/shared";
import { getDisplayName, getPlayer } from "./create-game";
import { advanceToNextSprint, canAdvanceSprint } from "./sprint";

/**
 * 记录协作卡打出（O-05）。
 * 仅 C-01～C-07 计入；C-12～C-14 互动卡必须排除。
 */
export function noteCollabCardPlayed(player: PlayerState, cardId: string): void {
  if (isInteractionCardId(cardId)) {
    return;
  }
  if (!isTeamFoundationCollabId(cardId)) {
    return;
  }
  player.collabCardsPlayed += 1;
  player.seasonPlayedCollab.push(cardId);
}

/** 清 Bug：仅累计实际清除数（计入 O-02） */
export function noteBugsCleared(player: PlayerState, count: number): number {
  if (count <= 0) return 0;
  const actual = Math.min(count, player.personalBugs);
  player.personalBugs -= actual;
  player.bugsClearedTotal += actual;
  return actual;
}

/** 加班 / 通宵（含 B-04）：破坏 O-06 */
export function noteOvertimeUsed(player: PlayerState): void {
  player.usedOvertime = true;
  player.neverUsedOvertime = false;
}

/** 考核季结束：绩效最低者垫底标记（O-03） */
export function markSeasonBottomPlayers(state: GameState): string[] {
  if (state.players.length === 0) return [];
  let minPerf = Infinity;
  for (const p of state.players) {
    if (p.performance < minPerf) minPerf = p.performance;
  }
  const bottoms = state.players.filter((p) => p.performance === minPerf);
  for (const p of bottoms) {
    p.bottomMarks += 1;
  }
  return bottoms.map((p) => p.id);
}

/** 绩效最高者（并列全收）；用于 O-03 MVP 判定（亮牌前） */
export function findProvisionalMvpIds(state: GameState): Set<string> {
  if (state.players.length === 0) return new Set();
  let maxPerf = -Infinity;
  for (const p of state.players) {
    if (p.performance > maxPerf) maxPerf = p.performance;
  }
  return new Set(state.players.filter((p) => p.performance === maxPerf).map((p) => p.id));
}

export function determineWinnerId(state: GameState): string | null {
  if (state.players.length === 0) return null;
  let best: PlayerState | null = null;
  for (const p of state.players) {
    if (!best || p.performance > best.performance) {
      best = p;
    }
  }
  return best?.id ?? null;
}

function evaluateOne(
  state: GameState,
  player: PlayerState,
  mvpIds: Set<string>,
): OkrEvaluation | null {
  if (!player.okrId) return null;
  const def = getOkrCard(player.okrId);
  if (!def) {
    return {
      playerId: player.id,
      displayName: getDisplayName(state, player.id),
      okrId: player.okrId,
      name: player.okrId,
      conditionText: "",
      achieved: false,
      reward: 0,
      reason: "未知 OKR",
    };
  }

  let achieved = false;
  let reason = "";

  switch (def.id) {
    case "O-01": {
      // 抢镜狂魔：独揽（突破者）≥2 次
      achieved = player.milestoneBreakCount >= 2;
      reason = achieved
        ? `独揽突破 ${player.milestoneBreakCount} 次 ≥ 2`
        : `独揽突破 ${player.milestoneBreakCount} 次 < 2`;
      break;
    }
    case "O-02": {
      // 救火队长：全局累计清 ≥5 Bug
      achieved = player.bugsClearedTotal >= 5;
      reason = achieved
        ? `累计清 Bug ${player.bugsClearedTotal} ≥ 5`
        : `累计清 Bug ${player.bugsClearedTotal} < 5`;
      break;
    }
    case "O-03": {
      // 逆风翻盘：曾垫底 + 亮牌前绩效 MVP
      const wasBottom = player.bottomMarks > 0;
      const isMvp = mvpIds.has(player.id);
      achieved = wasBottom && isMvp;
      reason = achieved
        ? `曾垫底（${player.bottomMarks}）且亮牌前 MVP`
        : !wasBottom
          ? "未曾垫底"
          : "亮牌前非 MVP";
      break;
    }
    case "O-04": {
      // 零债交付：结束时无个人技术债 + 参与 ≥2 次突破
      const noDebt = player.personalDebt <= 0;
      const parts = player.breakthroughParticipations >= 2;
      achieved = noDebt && parts;
      reason = achieved
        ? `零债且参与突破 ${player.breakthroughParticipations} 次`
        : !noDebt
          ? `仍有个人债 ${player.personalDebt}`
          : `参与突破 ${player.breakthroughParticipations} 次 < 2`;
      break;
    }
    case "O-05": {
      // 团队基石：C-01～C-07 ≥4；不含 C-12～C-14
      achieved = player.collabCardsPlayed >= 4;
      reason = achieved
        ? `协作卡（C-01～C-07）${player.collabCardsPlayed} 张 ≥ 4`
        : `协作卡（C-01～C-07）${player.collabCardsPlayed} 张 < 4（互动卡不计）`;
      break;
    }
    case "O-06": {
      // 效率之王：从未加班/通宵 + 参与 ≥3 次突破
      const neverOt = player.neverUsedOvertime;
      const parts = player.breakthroughParticipations >= 3;
      achieved = neverOt && parts;
      reason = achieved
        ? `从未加班且参与突破 ${player.breakthroughParticipations} 次`
        : !neverOt
          ? "曾加班/通宵"
          : `参与突破 ${player.breakthroughParticipations} 次 < 3`;
      break;
    }
    default: {
      reason = "未实现的 OKR";
      achieved = false;
    }
  }

  return {
    playerId: player.id,
    displayName: getDisplayName(state, player.id),
    okrId: def.id,
    name: def.name,
    conditionText: def.conditionText,
    achieved,
    reward: achieved ? def.reward : 0,
    reason,
  };
}

/** 纯判定，不改状态（亮牌前绩效用于 O-03 MVP） */
export function evaluateAllOkrs(state: GameState): OkrEvaluation[] {
  const mvpIds = findProvisionalMvpIds(state);
  const results: OkrEvaluation[] = [];
  for (const player of state.players) {
    const row = evaluateOne(state, player, mvpIds);
    if (row) results.push(row);
  }
  return results;
}

export function evaluatePlayerOkr(state: GameState, playerId: string): OkrEvaluation | null {
  const mvpIds = findProvisionalMvpIds(state);
  return evaluateOne(state, getPlayer(state, playerId), mvpIds);
}

/**
 * 总结算亮牌：统一判定 O-01～O-06，写入绩效奖励，确定 MVP。
 * 幂等：已亮牌则直接返回缓存结果。
 */
export function settleHiddenOkrs(state: GameState): OkrEvaluation[] {
  if (state.okrRevealed && state.okrSettlements) {
    return state.okrSettlements;
  }

  if (!state.config.modules.hiddenOkr) {
    state.okrRevealed = true;
    state.okrSettlements = [];
    state.winnerId = determineWinnerId(state);
    return [];
  }

  const results = evaluateAllOkrs(state);
  for (const row of results) {
    if (row.reward > 0) {
      const player = getPlayer(state, row.playerId);
      player.performance += row.reward;
    }
  }

  state.okrRevealed = true;
  state.okrSettlements = results;
  state.winnerId = determineWinnerId(state);
  return results;
}

function hasBlockingSettlement(state: GameState): boolean {
  return (
    Boolean(state.pendingInteraction) ||
    Boolean(state.pendingPerformanceSettlement) ||
    state.pendingPerformanceSettlementQueue.length > 0 ||
    Boolean(state.pendingDarkBid && !state.pendingDarkBid.resolved) ||
    Boolean(state.pendingProgressSettlement)
  );
}

/**
 * 终局 / Sprint 切换触发：进度达标后
 * - 连续 Sprint 且未跑完 → 进下一 Sprint（不清整局）
 * - 否则亮 OKR（若模块开启）并定系列 MVP
 * 有互动/绩效挂起时推迟。
 */
export function finalizeGameIfComplete(state: GameState): string[] {
  const events: string[] = [];
  if (state.progress < state.totalProgressTarget) {
    return events;
  }

  if (hasBlockingSettlement(state)) {
    // 连续 Sprint 中途不标 gameOver；末 Sprint / 单局仍标记终局等待挂起解除
    if (!canAdvanceSprint(state)) {
      state.gameOver = true;
    }
    return events;
  }

  if (canAdvanceSprint(state)) {
    return advanceToNextSprint(state);
  }

  state.gameOver = true;

  if (state.config.modules.hiddenOkr && !state.okrRevealed) {
    const results = settleHiddenOkrs(state);
    events.push("总结算：隐藏 OKR 亮牌");
    for (const row of results) {
      events.push(
        `${row.displayName} ${row.okrId} ${row.name}：${row.achieved ? "达成" : "未达成"}` +
          (row.achieved ? ` +${row.reward}` : ""),
      );
    }
    if (state.winnerId) {
      const label = state.config.modules.continuousSprint ? "系列 MVP" : "MVP";
      events.push(`${label}：${getDisplayName(state, state.winnerId)}`);
    }
  } else if (!state.winnerId) {
    state.winnerId = determineWinnerId(state);
    if (state.winnerId && state.config.modules.continuousSprint) {
      events.push(`系列 MVP：${getDisplayName(state, state.winnerId)}`);
    }
  }
  return events;
}
