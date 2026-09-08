import { getActionCard, isInteractionCardId } from "@rs/game-data";
import type { GameState, MilestoneId, PendingPerformanceSettlement, PlayerState } from "@rs/shared";
import { getDisplayName, getPlayer } from "./create-game";
import { finalizeGameIfComplete } from "./okr";

export function hasUsedInteractionThisSeason(player: PlayerState): boolean {
  return player.seasonPlayedCollab.some((id) => isInteractionCardId(id));
}

export function assertInteractionModule(state: GameState): void {
  if (!state.config.modules.interactionCards) {
    throw new Error("互动卡模块未开启");
  }
}

export function consumeInteractionCard(state: GameState, playerId: string, cardId: string): void {
  const player = getPlayer(state, playerId);
  if (!player.hand.includes(cardId)) {
    throw new Error(`Card not in hand: ${cardId}`);
  }
  if (hasUsedInteractionThisSeason(player)) {
    throw new Error("本考核季互动卡次数已用尽");
  }
  const card = getActionCard(cardId);
  if (!card || !card.isInteraction) {
    throw new Error(`Not an interaction card: ${cardId}`);
  }
  if (player.workHoursRemaining < card.workHours) {
    throw new Error("Insufficient work hours");
  }

  player.workHoursRemaining -= card.workHours;
  player.hand = player.hand.filter((id, index, all) => {
    // 同名多份只移一张
    if (id !== cardId) return true;
    const first = all.indexOf(cardId);
    return index !== first;
  });
  state.actionDiscard.push(cardId);
  player.seasonPlayedCollab.push(cardId);
  // O-05：互动卡 C-12～C-14 不计入 collabCardsPlayed
}

export function rejectPublicDebtDump(): never {
  throw new Error("仅个人债/Bug：公共债不可用 C-12 甩锅");
}

/**
 * C-12 甩锅：仅个人债/Bug；公共债必须拒绝。
 * 打出后打开不可跳过的 C-14 响应窗。
 */
export function playC12(
  state: GameState,
  playerId: string,
  targetId: string,
  dumpKind: "debt" | "bug",
): string[] {
  assertInteractionModule(state);
  if (state.pendingInteraction) {
    throw new Error("已有待处理的互动响应");
  }

  const source = getPlayer(state, playerId);
  getPlayer(state, targetId);

  if (dumpKind === "debt") {
    if (source.personalDebt <= 0) {
      throw new Error("没有可甩的个人技术债（公共债不可甩）");
    }
  } else if (source.personalBugs <= 0) {
    throw new Error("没有可甩的个人 Bug");
  }

  consumeInteractionCard(state, playerId, "C-12");

  state.pendingInteraction = {
    type: "C14",
    sourceCardId: "C-12",
    sourceId: playerId,
    targetId,
    milestoneId: null,
    dumpKind,
  };

  return [
    `${getDisplayName(state, playerId)} 打出 C-12 甩锅 → ${getDisplayName(state, targetId)}（${dumpKind === "debt" ? "个人债" : "Bug"}）`,
    "必须打开 C-14 响应窗，不能跳过",
  ];
}

function applyScaledSettlement(
  state: GameState,
  settlement: PendingPerformanceSettlement,
): string[] {
  const milestone = state.milestones.find((m) => m.id === settlement.milestoneId);
  if (!milestone) {
    throw new Error(`Unknown milestone ${settlement.milestoneId}`);
  }

  let breakerPerf = milestone.breakerPerformance;
  let collabPerf = milestone.collaboratorPerformance;
  if (
    state.activeEventFlags.doubleFirstMilestoneThisRound &&
    !state.activeEventFlags.firstMilestoneDoubled
  ) {
    breakerPerf *= 2;
    collabPerf *= 2;
    state.activeEventFlags.firstMilestoneDoubled = true;
  }

  const breaker = getPlayer(state, settlement.breakerId);
  breaker.performance += breakerPerf;
  breaker.milestoneBreakCount += 1;
  breaker.breakthroughParticipations += 1;

  for (const collaboratorId of settlement.collaboratorIds) {
    if (collaboratorId === settlement.breakerId) continue;
    const collaborator = getPlayer(state, collaboratorId);
    collaborator.performance += collabPerf;
    collaborator.breakthroughParticipations += 1;
  }

  if (!state.crossedMilestones.includes(settlement.milestoneId)) {
    state.crossedMilestones.push(settlement.milestoneId);
  }

  state.pendingPerformanceSettlement = null;
  state.pendingInteraction = null;

  const collabNames = settlement.collaboratorIds.map((id) => getDisplayName(state, id));
  return [
    `结算 ${settlement.milestoneId}：突破者 ${getDisplayName(state, settlement.breakerId)} +${breakerPerf}` +
      (settlement.collaboratorIds.length
        ? `，协作者 ${collabNames.join("/")} 各 +${collabPerf}`
        : ""),
  ];
}

/** 当前线结算后，打开队列中下一条跨线的 C-13 窗 */
function openNextQueuedC13Window(state: GameState): string[] {
  const next = state.pendingPerformanceSettlementQueue.shift();
  if (!next) return [];
  return openC13Window(state, next);
}

/** 打开跨线后的 C-13 窗口；模块关闭时直接结算绩效 */
export function openC13Window(
  state: GameState,
  settlement: PendingPerformanceSettlement,
): string[] {
  if (!state.config.modules.interactionCards) {
    return applyScaledSettlement(state, settlement);
  }

  state.pendingPerformanceSettlement = settlement;
  state.pendingInteraction = {
    type: "C13_WINDOW",
    milestoneId: settlement.milestoneId,
    breakerId: settlement.breakerId,
    collaboratorIds: [...settlement.collaboratorIds],
    passedIds: [],
  };
  return [
    `跨线 ${settlement.milestoneId}：先开 C-13 窗（突破者 ${getDisplayName(state, settlement.breakerId)}），绩效尚未结算`,
  ];
}

export function playC13FromWindow(state: GameState, playerId: string): string[] {
  assertInteractionModule(state);
  const pending = state.pendingInteraction;
  if (!pending || pending.type !== "C13_WINDOW") {
    throw new Error("当前不在 C-13 响应窗");
  }
  if (playerId === pending.breakerId) {
    throw new Error("突破者不能对自己打 C-13");
  }

  const player = getPlayer(state, playerId);
  if (!player.hand.includes("C-13")) {
    throw new Error("手牌没有 C-13");
  }

  const mode = player.contributedThisRound ? "hitch" : "steal";
  consumeInteractionCard(state, playerId, "C-13");

  state.pendingInteraction = {
    type: "C14",
    sourceCardId: "C-13",
    sourceId: playerId,
    targetId: pending.breakerId,
    milestoneId: pending.milestoneId,
    c13Mode: mode,
    deferredSettlement: {
      milestoneId: pending.milestoneId,
      breakerId: pending.breakerId,
      collaboratorIds: [...pending.collaboratorIds],
    },
  };

  return [
    `${getDisplayName(state, playerId)} 打出 C-13 抢功（${mode === "hitch" ? "蹭协作者" : "截 1 绩效"}）`,
    `针对突破者 ${getDisplayName(state, pending.breakerId)}：必须打开 C-14 响应窗，不能跳过`,
  ];
}

export function passC13(state: GameState, playerId: string): string[] {
  const pending = state.pendingInteraction;
  if (!pending || pending.type !== "C13_WINDOW") {
    throw new Error("当前不在 C-13 响应窗");
  }
  if (pending.passedIds.includes(playerId)) {
    throw new Error("你已弃权 C-13");
  }

  pending.passedIds.push(playerId);

  const eligible = state.playerOrder.filter((id) => id !== pending.breakerId);
  const allPassed = eligible.every((id) => pending.passedIds.includes(id));
  if (!allPassed) {
    return [`${getDisplayName(state, playerId)} 弃权 C-13`];
  }

  return finalizePerformanceSettlement(state, {
    milestoneId: pending.milestoneId,
    breakerId: pending.breakerId,
    collaboratorIds: pending.collaboratorIds,
  });
}

export function respondC14(state: GameState, playerId: string): string[] {
  const pending = state.pendingInteraction;
  if (!pending || pending.type !== "C14") {
    throw new Error("当前没有 C-14 响应窗");
  }
  if (playerId !== pending.targetId) {
    throw new Error("只有被针对者可打 C-14");
  }

  const player = getPlayer(state, playerId);
  if (!player.hand.includes("C-14")) {
    throw new Error("手牌没有 C-14");
  }
  if (hasUsedInteractionThisSeason(player)) {
    throw new Error("本考核季互动卡次数已用尽");
  }

  consumeInteractionCard(state, playerId, "C-14");
  const source = getPlayer(state, pending.sourceId);
  source.performance = Math.max(0, source.performance - 1);

  const messages = [
    `${getDisplayName(state, playerId)} 打出 C-14 背刺反制，抵消 ${pending.sourceCardId}`,
    `${getDisplayName(state, pending.sourceId)} -1 绩效`,
  ];

  if (pending.sourceCardId === "C-12") {
    state.pendingInteraction = null;
    messages.push("甩锅被抵消，转移未发生");
    return messages;
  }

  const deferred = pending.deferredSettlement;
  state.pendingInteraction = null;
  if (deferred) {
    messages.push(...finalizePerformanceSettlement(state, deferred));
  }
  return messages;
}

export function declineC14(state: GameState, playerId: string): string[] {
  const pending = state.pendingInteraction;
  if (!pending || pending.type !== "C14") {
    throw new Error("当前没有 C-14 响应窗");
  }
  if (playerId !== pending.targetId) {
    throw new Error("只有被针对者可关闭 C-14 窗");
  }

  const messages = [`${getDisplayName(state, playerId)} 放弃 C-14，互动生效`];

  if (pending.sourceCardId === "C-12") {
    applyC12Transfer(state, pending.sourceId, pending.targetId, pending.dumpKind ?? "debt");
    state.pendingInteraction = null;
    messages.push(
      `转移完成：${pending.dumpKind === "bug" ? "Bug" : "个人债"} → ${getDisplayName(state, pending.targetId)}`,
    );
    return messages;
  }

  const deferred = pending.deferredSettlement;
  const mode = pending.c13Mode ?? "steal";
  const sourceId = pending.sourceId;
  state.pendingInteraction = null;

  if (!deferred) {
    return messages;
  }

  let settlement: PendingPerformanceSettlement = {
    ...deferred,
    collaboratorIds: [...deferred.collaboratorIds],
  };
  if (mode === "hitch" && !settlement.collaboratorIds.includes(sourceId)) {
    settlement = {
      ...settlement,
      collaboratorIds: [...settlement.collaboratorIds, sourceId],
    };
  }

  messages.push(...finalizePerformanceSettlement(state, settlement));

  if (mode === "steal") {
    const breaker = getPlayer(state, settlement.breakerId);
    const thief = getPlayer(state, sourceId);
    if (breaker.performance > 0) {
      breaker.performance -= 1;
      thief.performance += 1;
      messages.push(
        `${getDisplayName(state, sourceId)} 截取 ${getDisplayName(state, settlement.breakerId)} 的 1 绩效`,
      );
    }
  }

  return messages;
}

function applyC12Transfer(
  state: GameState,
  sourceId: string,
  targetId: string,
  dumpKind: "debt" | "bug",
): void {
  const source = getPlayer(state, sourceId);
  const target = getPlayer(state, targetId);
  if (dumpKind === "debt") {
    if (source.personalDebt <= 0) {
      rejectPublicDebtDump();
    }
    source.personalDebt -= 1;
    target.personalDebt += 1;
  } else {
    if (source.personalBugs <= 0) {
      throw new Error("没有可甩的个人 Bug");
    }
    source.personalBugs -= 1;
    target.personalBugs += 1;
  }
}

export function finalizePerformanceSettlement(
  state: GameState,
  settlement: PendingPerformanceSettlement,
): string[] {
  const messages = applyScaledSettlement(state, settlement);
  messages.push(...openNextQueuedC13Window(state));
  messages.push(...finalizeGameIfComplete(state));
  return messages;
}

export function c13ModeForPlayer(state: GameState, playerId: string): "hitch" | "steal" {
  return getPlayer(state, playerId).contributedThisRound ? "hitch" : "steal";
}

export type { MilestoneId };
