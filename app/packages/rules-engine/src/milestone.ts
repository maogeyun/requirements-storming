import type { DarkBidState, GameState, MilestoneDefinition, MilestoneId } from "@rs/shared";
import { getPlayer, getSprintZoneDistanceForState } from "./create-game.js";

export function distanceToMilestone(progress: number, threshold: number): number {
  return threshold - progress;
}

export function isInSprintZone(
  progress: number,
  threshold: number,
  zoneDistance: number,
): boolean {
  return progress < threshold && distanceToMilestone(progress, threshold) <= zoneDistance;
}

export function getNextUncrossedMilestone(state: GameState): MilestoneDefinition | null {
  return state.milestones.find((m) => !state.crossedMilestones.includes(m.id)) ?? null;
}

export function milestonesCrossedByGain(
  progress: number,
  gain: number,
  milestones: MilestoneDefinition[],
): MilestoneDefinition[] {
  const newProgress = progress + gain;
  return milestones.filter((m) => progress < m.threshold && newProgress >= m.threshold);
}

export interface DarkBidTrigger {
  milestoneId: MilestoneId;
  isCatchUp: boolean;
}

/**
 * FIX-01：判断在应用 progressGain 之前是否需要暗标。
 * - 进入冲刺区（距下一里程碑 ≤ zoneDistance）且该里程碑尚未暗标
 * - 跨线瞬间补开：将直接跨过里程碑但此前未进入冲刺区
 */
export function detectDarkBidTrigger(
  state: GameState,
  progressGain: number,
): DarkBidTrigger | null {
  if (!state.config.modules.darkBid || state.pendingDarkBid) {
    return null;
  }

  const zoneDistance = getSprintZoneDistanceForState(state);
  const crossed = milestonesCrossedByGain(state.progress, progressGain, state.milestones);

  for (const milestone of crossed) {
    if (state.darkBidUsed[milestone.id]) {
      continue;
    }
    const wasInZone = isInSprintZone(state.progress, milestone.threshold, zoneDistance);
    return {
      milestoneId: milestone.id,
      isCatchUp: !wasInZone,
    };
  }

  const next = getNextUncrossedMilestone(state);
  if (!next || state.darkBidUsed[next.id]) {
    return null;
  }

  const afterProgress = state.progress + progressGain;
  const entersZone =
    !isInSprintZone(state.progress, next.threshold, zoneDistance) &&
    isInSprintZone(afterProgress, next.threshold, zoneDistance) &&
    afterProgress < next.threshold;

  if (entersZone || isInSprintZone(state.progress, next.threshold, zoneDistance)) {
    return { milestoneId: next.id, isCatchUp: false };
  }

  return null;
}

export function openDarkBid(state: GameState, trigger: DarkBidTrigger): DarkBidState {
  state.pendingDarkBid = {
    milestoneId: trigger.milestoneId,
    isCatchUp: trigger.isCatchUp,
    resolved: false,
    bids: {},
    priorityHolderId: null,
    crosserId: null,
  };
  return state.pendingDarkBid;
}

export function submitDarkBid(state: GameState, playerId: string, amount: number): void {
  const bid = state.pendingDarkBid;
  if (!bid || bid.resolved) {
    throw new Error("No pending dark bid");
  }

  const player = getPlayer(state, playerId);
  const maxBid = state.config.darkBidMax ?? state.constants.darkBidMax;
  const clamped = Math.max(0, Math.min(maxBid, Math.floor(amount)));

  if (bid.isCatchUp) {
    if (clamped > player.workHoursRemaining) {
      throw new Error("Catch-up bid exceeds remaining work hours");
    }
  } else if (clamped > player.workHoursBudget) {
    throw new Error("Bid exceeds turn work hour budget");
  }

  bid.bids[playerId] = clamped;
}

export function allPlayersBid(state: GameState): boolean {
  const bid = state.pendingDarkBid;
  if (!bid) return false;
  return state.playerOrder.every((id) => id in bid.bids);
}

/** 消耗押注工时并确定优先权持有者（尚未知 crosser） */
export function resolveDarkBidBids(state: GameState): string | null {
  const bid = state.pendingDarkBid;
  if (!bid) {
    throw new Error("No pending dark bid");
  }

  for (const playerId of state.playerOrder) {
    const amount = bid.bids[playerId] ?? 0;
    const player = getPlayer(state, playerId);
    player.workHoursRemaining -= amount;
    if (!bid.isCatchUp) {
      player.workHoursBudget -= amount;
    }
    state.darkBidTotalSpent += amount;
  }

  const entries = state.playerOrder.map((id) => ({ id, amount: bid.bids[id] ?? 0 }));
  const maxAmount = Math.max(...entries.map((e) => e.amount));
  const winners = entries.filter((e) => e.amount === maxAmount);

  bid.resolved = true;
  state.darkBidUsed[bid.milestoneId] = true;

  if (winners.length === 1) {
    bid.priorityHolderId = winners[0].id;
    return winners[0].id;
  }

  return null;
}

export function resolveDarkBidPriorityOnTie(state: GameState, crosserId: string): string {
  const bid = state.pendingDarkBid;
  if (!bid) {
    throw new Error("No pending dark bid");
  }
  bid.crosserId = crosserId;
  bid.priorityHolderId = bid.priorityHolderId ?? crosserId;
  return bid.priorityHolderId;
}

export function clearPendingDarkBid(state: GameState): void {
  state.pendingDarkBid = null;
}

export interface MilestoneSettlement {
  milestoneId: MilestoneId;
  breakerId: string;
  collaboratorIds: string[];
}

/** FIX-02 步骤 ①：暗标优先权确定突破者 */
export function determineBreaker(
  state: GameState,
  crosserId: string,
  milestoneId: MilestoneId,
): string {
  const bid = state.pendingDarkBid;
  if (bid && bid.milestoneId === milestoneId && bid.priorityHolderId) {
    return bid.priorityHolderId;
  }
  return crosserId;
}

export function settleMilestonePerformance(
  state: GameState,
  milestone: MilestoneDefinition,
  breakerId: string,
  collaboratorIds: string[],
): void {
  const breaker = getPlayer(state, breakerId);
  breaker.performance += milestone.breakerPerformance;
  breaker.milestoneBreakCount += 1;
  breaker.breakthroughParticipations += 1;

  for (const collaboratorId of collaboratorIds) {
    if (collaboratorId === breakerId) continue;
    const collaborator = getPlayer(state, collaboratorId);
    collaborator.performance += milestone.collaboratorPerformance;
    collaborator.breakthroughParticipations += 1;
  }

  if (!state.crossedMilestones.includes(milestone.id)) {
    state.crossedMilestones.push(milestone.id);
  }
}

export function applyProgressGain(
  state: GameState,
  playerId: string,
  gain: number,
): MilestoneSettlement[] {
  if (gain <= 0) {
    return [];
  }

  state.roundContributors.add(playerId);
  getPlayer(state, playerId).contributedThisRound = true;

  const zoneDistance = getSprintZoneDistanceForState(state);
  const crossed = milestonesCrossedByGain(state.progress, gain, state.milestones);
  state.progress += gain;

  const settlements: MilestoneSettlement[] = [];

  for (const milestone of crossed) {
    const breakerId = determineBreaker(state, playerId, milestone.id);
    const collaboratorIds = [...state.roundContributors].filter((id) => id !== breakerId);
    settleMilestonePerformance(state, milestone, breakerId, collaboratorIds);
    settlements.push({ milestoneId: milestone.id, breakerId, collaboratorIds });
    clearPendingDarkBid(state);
  }

  if (state.progress >= state.totalProgressTarget) {
    state.gameOver = true;
  }

  void zoneDistance;
  return settlements;
}
