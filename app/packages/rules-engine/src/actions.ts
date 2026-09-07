import { getActionCard } from "@rs/game-data";
import type { GameAction, GameState, LegalAction, MilestoneId } from "@rs/shared";
import { getPlayer } from "./create-game.js";
import {
  allPlayersBid,
  applyProgressGain,
  completeDarkBidAndSettle,
  detectDarkBidTrigger,
  milestonesCrossedByGain,
  openDarkBid,
  submitDarkBid,
  type MilestoneSettlement,
} from "./milestone.js";
import {
  assertNoPendingDarkBid,
  endExecutePhase,
  finishEndPhase,
  getCurrentPlayerId,
  runDrawPhase,
  runPlanPhase,
} from "./turn.js";

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

/**
 * 尝试推进进度（技能卡或演示用直接增益）。
 * - 将跨线且需暗标：打开 pendingDarkBid，挂起结算（补开 / 冲刺区内跨线均不可跳过）。
 * - 仅进入冲刺区未跨线：先应用进度，再打开暗标阻断后续行动。
 */
export function attemptProgressGain(
  state: GameState,
  playerId: string,
  progressGain: number,
  cardId: string | null = null,
): ApplyActionResult {
  assertNoPendingDarkBid(state);

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

  if (trigger && !willCross) {
    openDarkBid(state, trigger);
    return success({
      settlements,
      needsDarkBid: true,
      events: [`进入冲刺区，开启 ${trigger.milestoneId} 暗标`],
    });
  }

  return success({
    settlements,
    events: settlements.map(
      (s) => `里程碑 ${s.milestoneId} 突破者 ${s.breakerId}`,
    ),
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
  return success({
    needsDarkBid: true,
    settlements,
    events: [...result.events, "暗标已同步结算"],
  });
}

export function applyAction(state: GameState, action: GameAction): ApplyResult {
  try {
    switch (action.type) {
      case "DRAW_TO_HAND_LIMIT":
      case "START_TURN": {
        if (hasBlockingDarkBid(state)) {
          return fail("必须补开，不能跳过");
        }
        runDrawPhase(state);
        return success({ events: ["抽卡完成 → 规划阶段"] });
      }
      case "CONFIRM_PLAN": {
        if (hasBlockingDarkBid(state)) {
          return fail("必须补开，不能跳过");
        }
        runPlanPhase(state);
        return success({ events: ["规划完成 → 执行阶段"] });
      }
      case "PLAY_CARD": {
        if (hasBlockingDarkBid(state)) {
          return fail("必须补开，不能跳过");
        }
        const played = playSkillCard(state, action.playerId, action.cardId);
        return played;
      }
      case "SUBMIT_DARK_BID": {
        if (!state.pendingDarkBid || state.pendingDarkBid.resolved) {
          return fail("当前没有待处理的暗标");
        }
        submitDarkBid(state, action.playerId, action.amount);
        const events = [`${action.playerId} 已提交暗标`];
        if (allPlayersBid(state)) {
          const settlements = completeDarkBidAndSettle(state);
          return success({
            events: [...events, "暗标完成，继续结算"],
            settlements,
            needsDarkBid: false,
          });
        }
        return success({ events, needsDarkBid: true });
      }
      case "RESOLVE_DARK_BID": {
        return fail("请通过全体提交暗标完成结算，不可跳过");
      }
      case "END_EXECUTE": {
        if (hasBlockingDarkBid(state)) {
          return fail("必须补开，不能跳过");
        }
        endExecutePhase(state);
        return success({ events: ["执行结束 → 收尾阶段"] });
      }
      case "FINISH_END_PHASE":
      case "END_TURN": {
        if (hasBlockingDarkBid(state)) {
          return fail("必须补开，不能跳过");
        }
        if (state.turnPhase === "execute") {
          endExecutePhase(state);
          finishEndPhase(state);
          return success({ events: ["回合结束 → 下一位抽卡"] });
        }
        if (state.turnPhase === "end") {
          finishEndPhase(state);
          return success({ events: ["收尾完成 → 下一位抽卡"] });
        }
        return fail("当前阶段无法结束回合");
      }
      case "END_ROUND": {
        if (hasBlockingDarkBid(state)) {
          return fail("必须补开，不能跳过");
        }
        while (state.turnPhase !== "draw" || state.currentPlayerIndex !== 0) {
          if (state.turnPhase === "draw") runDrawPhase(state);
          if (state.turnPhase === "plan") runPlanPhase(state);
          if (state.turnPhase === "execute") endExecutePhase(state);
          if (state.turnPhase === "end") finishEndPhase(state);
        }
        return success({ events: ["Round 强制推进完成"] });
      }
      case "RESPOND_C13":
      case "RESPOND_C14":
        return fail("互动卡响应尚未在本里程碑实现");
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
    const player = getPlayer(state, actorId);
    for (const cardId of player.hand) {
      const card = getActionCard(cardId);
      if (!card || card.category !== "skill") continue;
      const canPay = player.workHoursRemaining >= card.workHours;
      actions.push({
        action: { type: "PLAY_CARD", playerId: actorId, cardId },
        label: `打出 ${card.name}（${card.effectText}）`,
        enabled: canPay,
        reason: canPay ? undefined : "工时不足",
      });
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
  state.pendingDarkBid = null;
  state.pendingProgressSettlement = null;
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

export type { MilestoneId };
