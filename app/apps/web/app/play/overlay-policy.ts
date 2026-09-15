import type { GameState } from "@rs/shared";

/** 相位条强制窗：未完成前不可自动关 */
export type ForcedWindowKind = "catch_up_dark_bid" | "c14" | null;

/** 结算层种类（终局板不自动关） */
export type SettlementKind = "cross_line" | "okr_reveal" | "season_end" | null;

/** 短暂信息 tip（reveal 可 1s hold；节点推进立刻关） */
export type InfoTipKind = "dark_bid_reveal" | "c14_explain" | "okr_mid_reveal";

export type InfoTip = {
  kind: InfoTipKind;
  text: string;
  /** reveal 类：出现后至少可读到该时刻才允许纯计时关闭 */
  holdUntilMs: number;
};

export const REVEAL_HOLD_MS = 1000;

/**
 * 对局「节点」指纹：阶段 / 座位 / 未完成强制中断。
 * 节点推进 → 信息层立刻关闭（优先于 1s hold）。
 */
export function playNodeKey(state: GameState): string {
  const interaction = state.pendingInteraction;
  let interactionKey = "-";
  if (interaction?.type === "C14") {
    interactionKey = `c14:${interaction.targetId}:${interaction.sourceId}`;
  } else if (interaction?.type === "C13_WINDOW") {
    interactionKey = `c13:${interaction.milestoneId}:${interaction.breakerId}:${[
      ...interaction.passedIds,
    ]
      .sort()
      .join(",")}`;
  }

  const pending = state.pendingDarkBid;
  const darkKey =
    pending && !pending.resolved
      ? `bid:${pending.milestoneId}:${Object.keys(pending.bids).length}`
      : "-";

  return [
    state.sprint,
    state.round,
    state.turnPhase,
    state.currentPlayerIndex,
    state.progress,
    interactionKey,
    darkKey,
    state.gameOver ? "over" : "live",
    state.okrRevealed ? "okr" : "hid",
    state.pendingPerformanceSettlement?.milestoneId ?? "-",
    state.pendingPerformanceSettlementQueue.length,
  ].join("|");
}

export function sprintSwitchKey(state: GameState): string {
  const info = state.sprintSwitchInfo;
  if (!info) return "";
  return `${info.fromSprint}->${info.toSprint}:${info.nextRequirementId}`;
}

export function detectForcedWindow(state: GameState): ForcedWindowKind {
  if (state.pendingInteraction?.type === "C14") return "c14";
  const pending = state.pendingDarkBid;
  if (pending && !pending.resolved) return "catch_up_dark_bid";
  return null;
}

/** Sprint 切换文案窗：信息层，不挡操作；节点推进时自动确认 */
export function sprintSwitchInfoOpen(
  state: GameState,
  sprintSwitchAckedKey: string | null,
): boolean {
  if (!state.sprintSwitchInfo) return false;
  return sprintSwitchKey(state) !== sprintSwitchAckedKey;
}

export function detectSettlement(state: GameState): SettlementKind {
  if (state.okrRevealed && state.okrSettlements) return "okr_reveal";
  if (state.pendingInteraction?.type === "C13_WINDOW") return "cross_line";
  if (
    state.pendingPerformanceSettlement ||
    state.pendingPerformanceSettlementQueue.length > 0
  ) {
    return "cross_line";
  }
  if (state.gameOver && !state.okrRevealed) return "season_end";
  return null;
}

export function settlementKeyFor(
  state: GameState,
  settlementKind: SettlementKind,
): string | null {
  if (!settlementKind) return null;
  if (settlementKind === "okr_reveal") {
    return `okr:${state.okrSettlements?.map((r) => r.playerId).join(",")}`;
  }
  if (settlementKind === "cross_line") {
    const milestoneId =
      state.pendingInteraction?.type === "C13_WINDOW"
        ? state.pendingInteraction.milestoneId
        : (state.pendingPerformanceSettlement?.milestoneId ?? "q");
    return `cross:${milestoneId}:${state.pendingPerformanceSettlementQueue.length}`;
  }
  if (settlementKind === "season_end") {
    return `season:${state.sprint}:${state.round}`;
  }
  return null;
}

/** 跨线仍有 C-13 待处理 → 未完成强制窗，禁止自动关 */
export function settlementNeedsAction(
  state: GameState,
  settlementKind: SettlementKind,
): boolean {
  return (
    settlementKind === "cross_line" &&
    state.pendingInteraction?.type === "C13_WINDOW"
  );
}

/** 终局胜利 / MVP 板：永不自动关 */
export function settlementIsFinalVictory(settlementKind: SettlementKind): boolean {
  return settlementKind === "okr_reveal";
}

/**
 * 节点推进时应自动关掉的结算层（信息层）。
 * 终局板、未完成强制跨线窗 → false。
 */
export function shouldAutoDismissSettlement(
  state: GameState,
  settlementKind: SettlementKind,
): boolean {
  if (!settlementKind) return false;
  if (settlementIsFinalVictory(settlementKind)) return false;
  if (settlementNeedsAction(state, settlementKind)) return false;
  return settlementKind === "cross_line" || settlementKind === "season_end";
}

export function makeRevealTip(kind: InfoTipKind, text: string, nowMs: number): InfoTip {
  return {
    kind,
    text,
    holdUntilMs: nowMs + REVEAL_HOLD_MS,
  };
}

/** 纯计时关闭：未到 hold 则继续等；节点推进不走这里 */
export function canTimerDismissInfoTip(tip: InfoTip, nowMs: number): boolean {
  return nowMs >= tip.holdUntilMs;
}

/**
 * 强制窗刚结束后的 reveal tip。
 * 在「节点推进清旧 tip」之后调用，避免被同帧清掉。
 */
export function tipFromForcedTransition(
  prevForced: ForcedWindowKind | undefined,
  nextForced: ForcedWindowKind,
  nowMs: number,
): InfoTip | null {
  if (prevForced === "catch_up_dark_bid" && nextForced !== "catch_up_dark_bid") {
    return makeRevealTip("dark_bid_reveal", "暗标揭晓 · 优先权已定", nowMs);
  }
  if (prevForced === "c14" && nextForced !== "c14") {
    return makeRevealTip("c14_explain", "C-14 响应结束 · 互动已结算", nowMs);
  }
  return null;
}

/** season_end 候选板出现时，附带短 tip（与板并存；节点推进同关） */
export function tipFromSettlementTransition(
  prevKind: SettlementKind | undefined,
  nextKind: SettlementKind,
  nowMs: number,
): InfoTip | null {
  if (prevKind !== "season_end" && nextKind === "season_end") {
    return makeRevealTip("okr_mid_reveal", "系列候选已出 · 待 OKR 亮牌", nowMs);
  }
  return null;
}
