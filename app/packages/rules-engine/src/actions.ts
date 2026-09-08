import { getActionCard, isInteractionCardId } from "@rs/game-data";
import type { GameAction, GameState, LegalAction, MilestoneId } from "@rs/shared";
import { getDisplayName, getPlayer } from "./create-game";
import { assertEventFlipped, flipEventCard, forceFlipSpecificEvent } from "./events";
import {
  declineC14,
  hasUsedInteractionThisSeason,
  passC13,
  playC12,
  playC13FromWindow,
  rejectPublicDebtDump,
  respondC14,
} from "./interaction";
import {
  allPlayersBid,
  applyProgressGain,
  completeDarkBidAndSettle,
  detectDarkBidTrigger,
  milestonesCrossedByGain,
  openDarkBid,
  submitDarkBid,
  type MilestoneSettlement,
} from "./milestone";
import { settleHiddenOkrs } from "./okr";
import {
  assertNoPendingDarkBid,
  assertNoPendingInteraction,
  endExecutePhase,
  finishEndPhase,
  getCurrentPlayerId,
  runDrawPhase,
  runPlanPhase,
} from "./turn";

export interface ApplyActionResult {
  ok: true;
  events: string[];
  settlements: MilestoneSettlement[];
  needsDarkBid: boolean;
}

export interface ApplyActionFailure {
  ok: false;
  error: string;
}

export type ApplyResult = ApplyActionResult | ApplyActionFailure;

function success(
  partial: Partial<ApplyActionResult> = {},
): ApplyActionResult {
  return {
    ok: true,
    events: [],
    settlements: [],
    needsDarkBid: false,
    ...partial,
  };
}

function fail(error: string): ApplyActionFailure {
  return { ok: false, error };
}

function hasBlockingDarkBid(state: GameState): boolean {
  return Boolean(
    (state.pendingDarkBid && !state.pendingDarkBid.resolved) || state.pendingProgressSettlement,
  );
}

function hasBlockingInteraction(state: GameState): boolean {
  return Boolean(state.pendingInteraction || state.pendingPerformanceSettlement);
}

/**
 * 尝试推进进度（技能卡或演示用直接增益）。
 * - 将跨线且需暗标：打开 pendingDarkBid，挂起结算（补开 / 冲刺区内跨线均不可跳过）。
 * - 仅进入冲刺区未跨线：先应用进度，再打开暗标阻断后续行动。
 * - 跨线后若互动模块开启：绩效挂起，先开 C-13/C-14 窗（防双重结算）。
 */
export function attemptProgressGain(
  state: GameState,
  playerId: string,
  progressGain: number,
  cardId: string | null = null,
): ApplyActionResult {
  assertNoPendingDarkBid(state);
  assertNoPendingInteraction(state);

  const trigger = detectDarkBidTrigger(state, progressGain);
  const willCross = milestonesCrossedByGain(
    state.progress,
    progressGain,
    state.milestones,
  ).some((m) => !state.darkBidUsed[m.id]);

  if (trigger && willCross) {
    openDarkBid(state, trigger);
    state.pendingProgressSettlement = {
      playerId,
      cardId,
      progressGain,
    };
    const reason = trigger.isCatchUp
      ? `必须补开，不能跳过：跨线瞬间强制开启 ${trigger.milestoneId} 暗标`
      : `跨线前须完成 ${trigger.milestoneId} 暗标，不能跳过`;
    return success({
      needsDarkBid: true,
      events: [reason],
    });
  }

  const settlements = applyProgressGain(state, playerId, progressGain);
  const events = settlements.map(
    (s) => `里程碑 ${s.milestoneId} 突破者 ${getDisplayName(state, s.breakerId)}`,
  );
  if (state.pendingInteraction?.type === "C13_WINDOW") {
    events.push("绩效挂起：先处理 C-13 窗（可打 C-13 或弃权）");
    if (state.pendingPerformanceSettlementQueue.length > 0) {
      events.push(
        `另有 ${state.pendingPerformanceSettlementQueue.length} 条跨线排队：将按序开 C-13 窗`,
      );
    }
  }
  if (state.okrRevealed && state.okrSettlements) {
    events.push("总结算：隐藏 OKR 亮牌");
    for (const row of state.okrSettlements) {
      events.push(
        `${row.displayName} ${row.okrId} ${row.name}：${row.achieved ? "达成" : "未达成"}` +
          (row.achieved ? ` +${row.reward}` : ""),
      );
    }
  }

  if (trigger && !willCross) {
    openDarkBid(state, trigger);
    return success({
      settlements,
      needsDarkBid: true,
      events: [...events, `进入冲刺区，开启 ${trigger.milestoneId} 暗标`],
    });
  }

  return success({
    settlements,
    events,
  });
}

export function playSkillCard(
  state: GameState,
  playerId: string,
  cardId: string,
): ApplyActionResult {
  if (hasBlockingDarkBid(state)) {
    throw new Error("必须补开，不能跳过：请先完成暗标");
  }
  if (hasBlockingInteraction(state)) {
    throw new Error("必须先完成互动响应窗");
  }
  assertEventFlipped(state);
  if (state.turnPhase !== "execute") {
    throw new Error("Can only play cards in execute phase");
  }
  if (getCurrentPlayerId(state) !== playerId) {
    throw new Error("Not your turn");
  }

  const card = getActionCard(cardId);
  if (!card || card.category !== "skill") {
    throw new Error(`Not a skill card: ${cardId}`);
  }

  const player = getPlayer(state, playerId);
  if (!player.hand.includes(cardId)) {
    throw new Error(`Card not in hand: ${cardId}`);
  }
  if (player.workHoursRemaining < card.workHours) {
    throw new Error("Insufficient work hours");
  }

  player.workHoursRemaining -= card.workHours;
  player.hand = player.hand.filter((id) => id !== cardId);
  state.actionDiscard.push(cardId);

  const progressGain = card.progressGain ?? 0;
  return attemptProgressGain(state, playerId, progressGain, cardId);
}

/**
 * 测试/演示辅助：同步提交全部暗标并完成结算（不可用于可跳过路径）。
 */
export function playSkillCardWithBids(
  state: GameState,
  playerId: string,
  cardId: string,
  bids: Record<string, number>,
): ApplyActionResult {
  const result = playSkillCard(state, playerId, cardId);
  if (!result.needsDarkBid || !state.pendingDarkBid) {
    return result;
  }
  for (const id of state.playerOrder) {
    submitDarkBid(state, id, bids[id] ?? 0);
  }
  const settlements = completeDarkBidAndSettle(state);
  const events = [...result.events, "暗标已同步结算"];
  if (state.pendingInteraction?.type === "C13_WINDOW") {
    events.push("绩效挂起：先处理 C-13 / C-14");
  }
  return success({
    needsDarkBid: true,
    settlements,
    events,
  });
}

export function applyAction(state: GameState, action: GameAction): ApplyResult {
  try {
    switch (action.type) {
      case "FLIP_EVENT": {
        if (hasBlockingDarkBid(state)) {
          return fail("必须补开，不能跳过");
        }
        if (hasBlockingInteraction(state)) {
          return fail("必须先完成互动响应窗");
        }
        const flipped = flipEventCard(state);
        return success({ events: flipped.events });
      }
      case "DRAW_TO_HAND_LIMIT":
      case "START_TURN": {
        if (!state.eventFlippedThisRound) {
          return fail("必须先翻 1 张事件牌，才能进入本 Round");
        }
        if (hasBlockingDarkBid(state)) {
          return fail("必须补开，不能跳过");
        }
        if (hasBlockingInteraction(state)) {
          return fail("必须先完成互动响应窗");
        }
        runDrawPhase(state);
        return success({ events: ["抽卡完成 → 规划阶段"] });
      }
      case "CONFIRM_PLAN": {
        if (!state.eventFlippedThisRound) {
          return fail("必须先翻 1 张事件牌");
        }
        if (hasBlockingDarkBid(state)) {
          return fail("必须补开，不能跳过");
        }
        if (hasBlockingInteraction(state)) {
          return fail("必须先完成互动响应窗");
        }
        runPlanPhase(state);
        const skipped =
          state.turnPhase === "end"
            ? ["规划完成 → 因事件跳过执行，进入收尾"]
            : ["规划完成 → 执行阶段"];
        return success({ events: skipped });
      }
      case "PLAY_CARD": {
        if (!state.eventFlippedThisRound) {
          return fail("必须先翻 1 张事件牌，才能进入互动");
        }
        if (hasBlockingDarkBid(state)) {
          return fail("必须补开，不能跳过");
        }
        if (hasBlockingInteraction(state)) {
          return fail("必须先完成互动响应窗");
        }

        if (isInteractionCardId(action.cardId)) {
          if (!state.config.modules.interactionCards) {
            return fail("互动卡模块未开启");
          }
          if (state.turnPhase !== "execute") {
            return fail("只能在执行阶段打互动卡");
          }
          if (getCurrentPlayerId(state) !== action.playerId) {
            return fail("当前不是你的回合");
          }
          if (action.cardId === "C-12") {
            const targetId = action.targets?.[0];
            if (!targetId) {
              return fail("C-12 需要指定目标玩家");
            }
            if (action.dumpKind == null) {
              return fail("仅个人债/Bug：请选择甩个人债或 Bug（公共债不可甩）");
            }
            const messages = playC12(state, action.playerId, targetId, action.dumpKind);
            return success({ events: messages });
          }
          if (action.cardId === "C-13" || action.cardId === "C-14") {
            return fail("C-13/C-14 只能在跨线/被针对响应窗打出");
          }
          return fail("未知互动卡");
        }

        const played = playSkillCard(state, action.playerId, action.cardId);
        return played;
      }
      case "SUBMIT_DARK_BID": {
        if (!state.pendingDarkBid || state.pendingDarkBid.resolved) {
          return fail("当前没有待处理的暗标");
        }
        submitDarkBid(state, action.playerId, action.amount);
        const events = [`${getDisplayName(state, action.playerId)} 已提交暗标`];
        if (allPlayersBid(state)) {
          const settlements = completeDarkBidAndSettle(state);
          if (state.pendingInteraction?.type === "C13_WINDOW") {
            events.push("暗标完成 → 打开 C-13 窗（绩效尚未结算）");
            if (state.pendingPerformanceSettlementQueue.length > 0) {
              events.push(
                `另有 ${state.pendingPerformanceSettlementQueue.length} 条跨线排队：将按序开 C-13 窗`,
              );
            }
          } else {
            events.push("暗标完成，继续结算");
          }
          return success({
            events,
            settlements,
            needsDarkBid: false,
          });
        }
        return success({ events, needsDarkBid: true });
      }
      case "RESOLVE_DARK_BID": {
        return fail("请通过全体提交暗标完成结算，不可跳过");
      }
      case "RESPOND_C13": {
        const events = playC13FromWindow(state, action.playerId);
        return success({ events });
      }
      case "PASS_C13": {
        const events = passC13(state, action.playerId);
        return success({ events });
      }
      case "RESPOND_C14": {
        if (state.pendingInteraction?.type !== "C14") {
          return fail("当前没有 C-14 响应窗");
        }
        if (action.playerId !== state.pendingInteraction.targetId) {
          return fail("只有被针对者可打 C-14");
        }
        const events = respondC14(state, action.playerId);
        return success({ events });
      }
      case "DECLINE_C14": {
        if (state.pendingInteraction?.type !== "C14") {
          return fail("当前没有 C-14 响应窗");
        }
        const events = declineC14(state, action.playerId);
        return success({ events });
      }
      case "END_EXECUTE": {
        if (hasBlockingDarkBid(state)) {
          return fail("必须补开，不能跳过");
        }
        if (hasBlockingInteraction(state)) {
          return fail("必须先完成互动响应窗");
        }
        endExecutePhase(state);
        return success({ events: ["执行结束 → 收尾阶段"] });
      }
      case "FINISH_END_PHASE":
      case "END_TURN": {
        if (hasBlockingDarkBid(state)) {
          return fail("必须补开，不能跳过");
        }
        if (hasBlockingInteraction(state)) {
          return fail("必须先完成互动响应窗");
        }
        if (state.turnPhase === "execute") {
          endExecutePhase(state);
          finishEndPhase(state);
          return success({
            events: state.eventFlippedThisRound
              ? ["回合结束 → 下一位抽卡"]
              : ["回合结束 → 新 Round，须先翻事件"],
          });
        }
        if (state.turnPhase === "end") {
          finishEndPhase(state);
          return success({
            events: state.eventFlippedThisRound
              ? ["收尾完成 → 下一位抽卡"]
              : ["收尾完成 → 新 Round，须先翻事件"],
          });
        }
        return fail("当前阶段无法结束回合");
      }
      case "END_ROUND": {
        if (hasBlockingDarkBid(state)) {
          return fail("必须补开，不能跳过");
        }
        if (hasBlockingInteraction(state)) {
          return fail("必须先完成互动响应窗");
        }
        const startRound = state.round;
        while (
          state.round === startRound &&
          (state.turnPhase !== "draw" || state.currentPlayerIndex !== 0 || state.eventFlippedThisRound)
        ) {
          if (!state.eventFlippedThisRound && state.turnPhase === "draw") {
            flipEventCard(state);
          }
          if (state.turnPhase === "draw") runDrawPhase(state);
          if (state.turnPhase === "plan") runPlanPhase(state);
          if (state.turnPhase === "execute") endExecutePhase(state);
          if (state.turnPhase === "end") finishEndPhase(state);
        }
        return success({ events: ["Round 强制推进完成"] });
      }
      default:
        return fail("未知动作");
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export function listLegalActions(state: GameState, actorId: string): LegalAction[] {
  const currentId = getCurrentPlayerId(state);
  const actions: LegalAction[] = [];
  const blocked = hasBlockingDarkBid(state);
  const player = getPlayer(state, actorId);

  // C-14 响应窗：不可跳过
  if (state.pendingInteraction?.type === "C14") {
    const pending = state.pendingInteraction;
    const isTarget = actorId === pending.targetId;
    const hasC14 = player.hand.includes("C-14") && !hasUsedInteractionThisSeason(player);
    actions.push({
      action: { type: "RESPOND_C14", playerId: actorId, sourceId: pending.sourceId },
      label: "打出 C-14 背刺反制",
      enabled: isTarget && hasC14,
      reason: !isTarget
        ? "只有被针对者可响应"
        : hasUsedInteractionThisSeason(player)
          ? "本考核季互动卡已用尽"
          : !player.hand.includes("C-14")
            ? "手牌无 C-14"
            : undefined,
    });
    actions.push({
      action: { type: "DECLINE_C14", playerId: actorId },
      label: "放弃 C-14（关闭响应窗）",
      enabled: isTarget,
      reason: isTarget ? undefined : "只有被针对者可关闭窗口",
    });
    actions.push({
      action: { type: "END_EXECUTE" },
      label: "跳过 C-14",
      enabled: false,
      reason: "必须响应 C-14，不能跳过",
    });
    return actions;
  }

  // C-13 窗（跨线后、绩效前）
  if (state.pendingInteraction?.type === "C13_WINDOW") {
    const pending = state.pendingInteraction;
    const canPlay =
      actorId !== pending.breakerId &&
      player.hand.includes("C-13") &&
      !hasUsedInteractionThisSeason(player) &&
      !pending.passedIds.includes(actorId);
    actions.push({
      action: { type: "RESPOND_C13", playerId: actorId },
      label: player.contributedThisRound
        ? "打出 C-13 抢功（蹭协作者）"
        : "打出 C-13 抢功（截 1 绩效）",
      enabled: canPlay,
      reason:
        actorId === pending.breakerId
          ? "突破者不能打 C-13"
          : hasUsedInteractionThisSeason(player)
            ? "本考核季互动卡已用尽"
            : !player.hand.includes("C-13")
              ? "手牌无 C-13"
              : pending.passedIds.includes(actorId)
                ? "你已弃权"
                : undefined,
    });
    actions.push({
      action: { type: "PASS_C13", playerId: actorId },
      label: "弃权 C-13",
      enabled: !pending.passedIds.includes(actorId) && actorId !== pending.breakerId,
      reason:
        actorId === pending.breakerId
          ? "突破者无需弃权"
          : pending.passedIds.includes(actorId)
            ? "你已弃权"
            : undefined,
    });
    // Breaker can also "pass" conceptually by waiting — allow breaker to pass to help demos close window? 
    // Spec: eligible = non-breakers. Breaker waits.
    if (actorId === pending.breakerId) {
      actions.push({
        action: { type: "PASS_C13", playerId: actorId },
        label: "等待他人 C-13 / 弃权",
        enabled: false,
        reason: "等待其他玩家处理 C-13 窗",
      });
    }
    return actions;
  }

  if (blocked && state.pendingDarkBid && !state.pendingDarkBid.resolved) {
    const already = actorId in state.pendingDarkBid.bids;
    actions.push({
      action: { type: "SUBMIT_DARK_BID", playerId: actorId, amount: 0 },
      label: state.pendingDarkBid.isCatchUp
        ? "提交补开暗标（必须补开，不能跳过）"
        : "提交暗标",
      enabled: !already,
      reason: already ? "你已提交出价" : undefined,
    });
    actions.push({
      action: { type: "END_EXECUTE" },
      label: "跳过暗标",
      enabled: false,
      reason: "必须补开，不能跳过",
    });
    actions.push({
      action: { type: "PLAY_CARD", playerId: actorId, cardId: "" },
      label: "继续出牌/结算",
      enabled: false,
      reason: "必须补开，不能跳过",
    });
    return actions;
  }

  // Round 开始必须翻事件
  if (!state.eventFlippedThisRound) {
    actions.push({
      action: { type: "FLIP_EVENT" },
      label: "翻开本 Round 事件牌（必须）",
      enabled: actorId === currentId,
      reason: actorId === currentId ? undefined : "当前不是你的回合",
    });
    actions.push({
      action: { type: "DRAW_TO_HAND_LIMIT" },
      label: "抽卡",
      enabled: false,
      reason: "必须先翻 1 张事件牌",
    });
    actions.push({
      action: { type: "PLAY_CARD", playerId: actorId, cardId: "C-12" },
      label: "互动卡",
      enabled: false,
      reason: "必须先翻事件，才能进入互动",
    });
    return actions;
  }

  if (state.turnPhase === "draw") {
    actions.push({
      action: { type: "DRAW_TO_HAND_LIMIT" },
      label: "抽卡（补至手牌上限）",
      enabled: actorId === currentId,
      reason: actorId === currentId ? undefined : "当前不是你的回合",
    });
  }

  if (state.turnPhase === "plan") {
    actions.push({
      action: { type: "CONFIRM_PLAN" },
      label: "完成规划（领取工时）",
      enabled: actorId === currentId,
      reason: actorId === currentId ? undefined : "当前不是你的回合",
    });
  }

  if (state.turnPhase === "execute" && actorId === currentId) {
    for (const cardId of player.hand) {
      const card = getActionCard(cardId);
      if (!card) continue;

      if (card.category === "skill") {
        const canPay = player.workHoursRemaining >= card.workHours;
        actions.push({
          action: { type: "PLAY_CARD", playerId: actorId, cardId },
          label: `打出 ${card.name}（${card.effectText}）`,
          enabled: canPay,
          reason: canPay ? undefined : "工时不足",
        });
        continue;
      }

      if (
        state.config.modules.interactionCards &&
        card.isInteraction &&
        cardId === "C-12"
      ) {
        const seasonUsed = hasUsedInteractionThisSeason(player);
        const canPay = player.workHoursRemaining >= card.workHours;
        const hasPersonal =
          player.personalDebt > 0 || player.personalBugs > 0;
        for (const target of state.playerOrder.filter((id) => id !== actorId)) {
          const targetName = getDisplayName(state, target);
          if (player.personalDebt > 0) {
            actions.push({
              action: {
                type: "PLAY_CARD",
                playerId: actorId,
                cardId: "C-12",
                targets: [target],
                dumpKind: "debt",
              },
              label: `C-12 甩个人债 → ${targetName}`,
              enabled: !seasonUsed && canPay,
              reason: seasonUsed
                ? "本考核季互动卡已用尽"
                : !canPay
                  ? "工时不足"
                  : undefined,
            });
          }
          if (player.personalBugs > 0) {
            actions.push({
              action: {
                type: "PLAY_CARD",
                playerId: actorId,
                cardId: "C-12",
                targets: [target],
                dumpKind: "bug",
              },
              label: `C-12 甩 Bug → ${targetName}`,
              enabled: !seasonUsed && canPay,
              reason: seasonUsed
                ? "本考核季互动卡已用尽"
                : !canPay
                  ? "工时不足"
                  : undefined,
            });
          }
        }
        // 公共债明示灰掉
        if (state.publicDebt > 0) {
          actions.push({
            action: {
              type: "PLAY_CARD",
              playerId: actorId,
              cardId: "C-12",
              targets: [state.playerOrder.find((id) => id !== actorId)!],
              dumpKind: "debt",
            },
            label: "C-12 甩公共债",
            enabled: false,
            reason: "仅个人债/Bug",
          });
        }
        if (!hasPersonal && state.publicDebt === 0) {
          actions.push({
            action: { type: "PLAY_CARD", playerId: actorId, cardId: "C-12" },
            label: "C-12 甩锅",
            enabled: false,
            reason: seasonUsed ? "本考核季互动卡已用尽" : "仅个人债/Bug",
          });
        } else if (seasonUsed) {
          actions.push({
            action: { type: "PLAY_CARD", playerId: actorId, cardId: "C-12" },
            label: "C-12 甩锅",
            enabled: false,
            reason: "本考核季互动卡已用尽",
          });
        }
      }

      if (
        state.config.modules.interactionCards &&
        card.isInteraction &&
        (cardId === "C-13" || cardId === "C-14")
      ) {
        actions.push({
          action: { type: "PLAY_CARD", playerId: actorId, cardId },
          label: `${cardId} ${card.name}`,
          enabled: false,
          reason:
            cardId === "C-13"
              ? "仅可在跨线瞬间响应窗打出"
              : "仅可在被针对时响应窗打出",
        });
      }
    }
    actions.push({
      action: { type: "END_EXECUTE" },
      label: "结束执行",
      enabled: true,
    });
  }

  if (state.turnPhase === "execute" && actorId !== currentId) {
    actions.push({
      action: { type: "END_EXECUTE" },
      label: "结束执行",
      enabled: false,
      reason: "当前不是你的回合",
    });
  }

  if (state.turnPhase === "end") {
    actions.push({
      action: { type: "FINISH_END_PHASE" },
      label: "收尾并交给下一位",
      enabled: actorId === currentId,
      reason: actorId === currentId ? undefined : "当前不是你的回合",
    });
  }

  return actions;
}

/** 构造跨线补开演示：进度未进冲刺区，一次增益将跨过里程碑 */
export function setupCatchUpScenario(state: GameState, progress = 22): void {
  state.progress = progress;
  state.turnPhase = "execute";
  state.eventFlippedThisRound = true;
  state.pendingDarkBid = null;
  state.pendingProgressSettlement = null;
  state.pendingPerformanceSettlement = null;
  state.pendingPerformanceSettlementQueue = [];
  state.pendingInteraction = null;
  state.crossedMilestones = [];
  state.darkBidUsed = { M1: false, M2: false, M3: false, M4: false };
  for (const player of state.players) {
    player.workHoursRemaining = state.constants.baseWorkHoursPerTurn;
    player.workHoursBudget = state.constants.baseWorkHoursPerTurn;
  }
}

export function forceCatchUpProgressAttempt(
  state: GameState,
  playerId: string,
  gain = 25,
): ApplyActionResult {
  setupCatchUpScenario(state);
  return attemptProgressGain(state, playerId, gain, null);
}

/** 演示：强制翻指定事件（不随机） */
export function forceFlipEvent(state: GameState, eventId: string): string[] {
  return forceFlipSpecificEvent(state, eventId);
}

/** 演示：C-12 甩锅场景 */
export function setupC12Demo(state: GameState): void {
  state.eventFlippedThisRound = true;
  state.turnPhase = "execute";
  state.currentPlayerIndex = 0;
  state.pendingInteraction = null;
  state.publicDebt = 3;
  const p1 = getPlayer(state, "p1");
  p1.personalDebt = 1;
  p1.personalBugs = 1;
  p1.workHoursRemaining = 40;
  p1.seasonPlayedCollab = [];
  if (!p1.hand.includes("C-12")) p1.hand = ["C-12", ...p1.hand];
  getPlayer(state, "p2").personalDebt = 0;
}

/** 演示：跨线 + C-13 截绩效（暗标赢家可被截） */
export function setupC13StealDemo(state: GameState): ApplyActionResult {
  setupCatchUpScenario(state, 22);
  state.config.modules.interactionCards = true;
  const p4 = getPlayer(state, state.playerOrder[state.playerOrder.length - 1]!);
  p4.hand = ["C-13", ...p4.hand.filter((id) => id !== "C-13")];
  p4.seasonPlayedCollab = [];
  p4.contributedThisRound = false;
  p4.workHoursRemaining = 40;

  const result = attemptProgressGain(state, "p1", 25, null);
  if (result.needsDarkBid && state.pendingDarkBid) {
    for (const id of state.playerOrder) {
      submitDarkBid(state, id, id === "p1" ? 8 : 0);
    }
    completeDarkBidAndSettle(state);
  }
  return success({
    events: [
      ...(result.events ?? []),
      "暗标完成：突破者为暗标赢家；C-13 窗已开，可截其绩效",
    ],
    settlements: [],
    needsDarkBid: false,
  });
}

/** 演示：C-14 反制 C-12 */
export function setupC14CounterDemo(state: GameState): string[] {
  setupC12Demo(state);
  const p2 = getPlayer(state, "p2");
  p2.hand = ["C-14", ...p2.hand.filter((id) => id !== "C-14")];
  p2.seasonPlayedCollab = [];
  return playC12(state, "p1", "p2", "debt");
}

/**
 * 演示：同次多跨线（M1+M2）→ 暗标后先开 M1 的 C-13，M2 入队。
 * 对应 interaction 测试中的多跨场景。
 */
export function setupMultiCrossDemo(state: GameState): ApplyActionResult {
  setupCatchUpScenario(state, 22);
  state.config.modules.interactionCards = true;
  state.config.modules.darkBid = true;
  state.activeEventFlags.doubleFirstMilestoneThisRound = false;

  const result = attemptProgressGain(state, "p1", 80, null);
  if (result.needsDarkBid && state.pendingDarkBid) {
    for (const id of state.playerOrder) {
      submitDarkBid(state, id, id === "p1" ? 5 : 0);
    }
    completeDarkBidAndSettle(state);
  }

  const queued = state.pendingPerformanceSettlementQueue.length;
  return success({
    events: [
      "演示：同次多跨线 M1+M2",
      `进度 ${state.progress}；当前 C-13 窗：${
        state.pendingInteraction?.type === "C13_WINDOW"
          ? state.pendingInteraction.milestoneId
          : "—"
      }`,
      queued > 0 ? `另有 ${queued} 条跨线排队（将按序开 C-13）` : "无排队",
      "绩效尚未结算，不与暗标双重结算",
    ],
    settlements: [],
    needsDarkBid: false,
  });
}

/**
 * 演示：总结算亮 OKR。
 * 为各座位写入可区分的统计，强制终局并亮牌。
 */
export function setupOkrRevealDemo(state: GameState): string[] {
  state.config.modules.hiddenOkr = true;
  state.gameOver = true;
  state.okrRevealed = false;
  state.okrSettlements = null;

  // 确保人人有隐藏 OKR（若开局未开模块则补发）
  const used = new Set(state.players.map((p) => p.okrId).filter(Boolean));
  const pool = ["O-01", "O-02", "O-03", "O-04", "O-05", "O-06"].filter((id) => !used.has(id));
  for (const player of state.players) {
    if (!player.okrId) {
      player.okrId = pool.shift() ?? "O-01";
    }
  }

  // 写入可演示的差异化统计（不影响暗牌窥视规则）
  for (const [index, player] of state.players.entries()) {
    player.milestoneBreakCount = index === 0 ? 2 : 0;
    player.bugsClearedTotal = index === 1 ? 5 : 1;
    player.bottomMarks = index === 2 ? 1 : 0;
    player.performance = index === 2 ? 12 : 4 - index;
    player.personalDebt = index === 3 ? 0 : index === 0 ? 1 : 0;
    player.breakthroughParticipations = index === 3 ? 2 : index === 0 ? 3 : 1;
    player.collabCardsPlayed = index === 0 ? 4 : 1;
    player.neverUsedOvertime = index !== 1;
  }

  // 若人数够，尽量让座位对齐 O-01～O-0n 便于肉眼核对
  const preferred = ["O-01", "O-02", "O-03", "O-04", "O-05", "O-06"];
  for (const [index, player] of state.players.entries()) {
    if (preferred[index]) player.okrId = preferred[index]!;
  }

  const results = settleHiddenOkrs(state);
  const lines = ["演示：总结算亮 OKR"];
  for (const row of results) {
    lines.push(
      `${row.displayName} · ${row.okrId} ${row.name}：${row.achieved ? "达成" : "未达成"}` +
        (row.achieved ? ` +${row.reward}` : "") +
        `（${row.reason}）`,
    );
  }
  if (state.winnerId) {
    lines.push(`MVP：${getDisplayName(state, state.winnerId)}`);
  }
  return lines;
}

export { rejectPublicDebtDump };

export type { MilestoneId };
