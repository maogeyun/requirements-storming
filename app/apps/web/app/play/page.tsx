"use client";

import {
  getActionCard,
  getEventCard,
  getOkrCard,
  getRequirementCard,
} from "@rs/game-data";
import {
  applyAction,
  createGame,
  forceCatchUpProgressAttempt,
  forceFlipEvent,
  getCurrentPlayerId,
  listBotActorSeats,
  listLegalActions,
  pickHeuristicLegalAction,
  setupC12Demo,
  setupC13StealDemo,
  setupC14CounterDemo,
  setupMultiCrossDemo,
  setupOkrRevealDemo,
  setupSprintAdvanceDemo,
} from "@rs/rules-engine";
import type {
  GameState,
  LegalAction,
  MilestoneId,
  OkrEvaluation,
  TurnPhase,
} from "@rs/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  barActionLabel,
  compactVariantLabel,
  enabledPlayActions,
  handCardBadge,
  handCardCostCopy,
  handCardEffectLine,
  illegalReasonForCard,
  isCornerPinAction,
  isPhaseRailAction,
  playActionsForCard,
  playVariantKey,
  type TableDetailKind,
} from "./card-ui";

const PHASES: TurnPhase[] = ["draw", "plan", "execute", "end"];
const PHASE_LABEL: Record<TurnPhase, string> = {
  draw: "抽卡",
  plan: "规划",
  execute: "执行",
  end: "收尾",
};

const RULES_VERSION = "v1.2";

type Screen = "setup" | "play";

/** 本地多人 = 座位轮流操作；人机 = 本座真人 + 其余 Bot */
type PlayMode = "local" | "vs_bot";

/** 相位条三类互斥、不可跳过强制窗 */
type ForcedWindowKind = "catch_up_dark_bid" | "c14" | "sprint_switch" | null;

type SettlementKind = "cross_line" | "okr_reveal" | "season_end" | null;

function seatLabel(state: GameState, playerId: string | null | undefined): string {
  if (!playerId) return "—";
  return state.players.find((p) => p.id === playerId)?.displayName ?? "—";
}

/** Visible UI: milestone display name only — never leak internal ids (M1/M2/…). */
function milestoneName(
  state: GameState,
  milestoneId: MilestoneId | null | undefined,
): string {
  if (!milestoneId) return "—";
  return state.milestones.find((m) => m.id === milestoneId)?.name ?? "—";
}

function lastingEventCopy(state: GameState): string {
  const flags = state.activeEventFlags;
  const parts: string[] = [];
  if (flags.doubleFirstMilestoneThisRound) {
    parts.push(
      flags.firstMilestoneDoubled ? "首次突破翻倍已触发" : "本轮首次突破绩效翻倍",
    );
  }
  if (flags.skipExecutePlayerId) {
    parts.push(`${seatLabel(state, flags.skipExecutePlayerId)} 跳过执行`);
  }
  if (flags.firefightingPlayerId) {
    parts.push(`${seatLabel(state, flags.firefightingPlayerId)} 救火 −16 工时`);
  }
  if (flags.sideTrackRemaining > 0) {
    parts.push(`临时轨道剩余 ${flags.sideTrackRemaining}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "无持续效果";
}

function eventBarCopy(state: GameState): string {
  if (!state.eventFlippedThisRound || !state.currentEventId) {
    return "本轮未翻 / 无事件";
  }
  const eventDef = getEventCard(state.currentEventId);
  if (!eventDef) {
    return "本轮未翻 / 无事件";
  }
  return `${eventDef.name} · ${lastingEventCopy(state)}`;
}

function requirementCopy(state: GameState): string {
  if (!state.requirementId) return "本 Sprint 未抽需求";
  const def = getRequirementCard(state.requirementId);
  return def?.name ?? "本 Sprint 未抽需求";
}

function darkBidZoneCopy(state: GameState): {
  status: "pending" | "active" | "collapsed";
  label: string;
} {
  const pending = state.pendingDarkBid;
  if (!pending || pending.resolved) {
    return { status: "collapsed", label: "暗标区空" };
  }
  const bidCount = Object.keys(pending.bids).length;
  if (pending.isCatchUp && bidCount === 0) {
    return { status: "pending", label: "待补开" };
  }
  return { status: "active", label: "暗标进行中" };
}

function detectForcedWindow(
  state: GameState,
  sprintSwitchAckedKey: string | null,
): ForcedWindowKind {
  const interaction = state.pendingInteraction;
  if (interaction?.type === "C14") return "c14";

  const pending = state.pendingDarkBid;
  if (pending && !pending.resolved) {
    return "catch_up_dark_bid";
  }

  if (state.sprintSwitchInfo) {
    const key = sprintSwitchKey(state);
    if (key !== sprintSwitchAckedKey) return "sprint_switch";
  }

  return null;
}

function sprintSwitchKey(state: GameState): string {
  const info = state.sprintSwitchInfo;
  if (!info) return "";
  return `${info.fromSprint}->${info.toSprint}:${info.nextRequirementId}`;
}

function detectSettlement(state: GameState): SettlementKind {
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

function seriesProgressCopy(state: GameState): string {
  const sprintLabel = state.config.modules.continuousSprint
    ? `Sprint ${state.sprint}/${state.config.sprintCount}`
    : `Sprint ${state.sprint}`;
  return `${sprintLabel} · 公共进度 ${state.progress}/${state.totalProgressTarget}`;
}

/** 人机模式下：真人是否必须亲自处理当前强制窗 */
function humanMustHandleForced(
  state: GameState,
  humanSeat: string,
  forced: ForcedWindowKind,
): boolean {
  if (!forced) return false;
  if (forced === "sprint_switch") return false;
  if (forced === "c14") {
    return (
      state.pendingInteraction?.type === "C14" &&
      state.pendingInteraction.targetId === humanSeat
    );
  }
  if (forced === "catch_up_dark_bid") {
    const pending = state.pendingDarkBid;
    if (!pending || pending.resolved) return false;
    return !(humanSeat in pending.bids);
  }
  return false;
}

function turnHudCopy(opts: {
  vsBot: boolean;
  isHumanTurn: boolean;
  currentPlayerId: string | null;
  state: GameState;
  botAuto: boolean;
}): string {
  const { vsBot, isHumanTurn, currentPlayerId, state, botAuto } = opts;
  if (!vsBot) {
    return `该谁 · ${seatLabel(state, currentPlayerId)}`;
  }
  if (isHumanTurn) return "该你";
  const seat = state.players.find((p) => p.id === currentPlayerId);
  const role = seat?.displayName ?? "—";
  const base = `Bot · ${role}`;
  return botAuto ? `${base} · 自动中…` : base;
}

function forcedWindowPreview(
  state: GameState,
  forced: ForcedWindowKind,
): string | null {
  if (forced === "c14") return "下一强制窗：C-14 响应";
  if (forced === "catch_up_dark_bid") return "下一强制窗：暗标（必须出价）";
  if (forced === "sprint_switch") return "下一强制窗：Sprint 切换";
  if (state.pendingDarkBid && !state.pendingDarkBid.resolved && !state.pendingDarkBid.isCatchUp) {
    return "预告：暗标冲刺进行中";
  }
  if (!state.eventFlippedThisRound) return "预告：须先翻本轮事件";
  if (state.pendingInteraction?.type === "C13_WINDOW") return "预告：跨线结算窗";
  return null;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      hand: [...p.hand],
      seasonPlayedCollab: [...p.seasonPlayedCollab],
      gameLimitUsed: { ...p.gameLimitUsed },
    })),
    playerOrder: [...state.playerOrder],
    crossedMilestones: [...state.crossedMilestones],
    darkBidUsed: { ...state.darkBidUsed },
    pendingDarkBid: state.pendingDarkBid
      ? { ...state.pendingDarkBid, bids: { ...state.pendingDarkBid.bids } }
      : null,
    pendingProgressSettlement: state.pendingProgressSettlement
      ? { ...state.pendingProgressSettlement }
      : null,
    pendingPerformanceSettlement: state.pendingPerformanceSettlement
      ? {
          ...state.pendingPerformanceSettlement,
          collaboratorIds: [...state.pendingPerformanceSettlement.collaboratorIds],
        }
      : null,
    pendingPerformanceSettlementQueue: state.pendingPerformanceSettlementQueue.map((item) => ({
      ...item,
      collaboratorIds: [...item.collaboratorIds],
    })),
    actionDeck: [...state.actionDeck],
    actionDiscard: [...state.actionDiscard],
    eventDeck: [...state.eventDeck],
    eventDiscard: [...state.eventDiscard],
    activeEventFlags: { ...state.activeEventFlags },
    roundContributors: new Set(state.roundContributors),
    pendingInteraction: state.pendingInteraction
      ? state.pendingInteraction.type === "C13_WINDOW"
        ? {
            ...state.pendingInteraction,
            collaboratorIds: [...state.pendingInteraction.collaboratorIds],
            passedIds: [...state.pendingInteraction.passedIds],
          }
        : {
            ...state.pendingInteraction,
            deferredSettlement: state.pendingInteraction.deferredSettlement
              ? {
                  ...state.pendingInteraction.deferredSettlement,
                  collaboratorIds: [
                    ...state.pendingInteraction.deferredSettlement.collaboratorIds,
                  ],
                }
              : undefined,
          }
      : null,
    usedRequirementIds: [...state.usedRequirementIds],
    sprintSwitchInfo: state.sprintSwitchInfo
      ? {
          ...state.sprintSwitchInfo,
          cleared: [...state.sprintSwitchInfo.cleared],
          carried: [...state.sprintSwitchInfo.carried],
        }
      : null,
    milestones: state.milestones.map((m) => ({ ...m })),
    config: {
      ...state.config,
      modules: { ...state.config.modules },
    },
    constants: state.constants,
    okrSettlements: state.okrSettlements
      ? state.okrSettlements.map((row) => ({ ...row }))
      : null,
  };
}

function mvpName(state: GameState): string {
  if (state.winnerId) return seatLabel(state, state.winnerId);
  let best = state.players[0];
  if (!best) return "—";
  for (const p of state.players) {
    if (p.performance > best.performance) best = p;
  }
  return best.displayName;
}

export default function PlayShellPage() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [playMode, setPlayMode] = useState<PlayMode>("local");
  const [playerCount, setPlayerCount] = useState(4);
  const [state, setState] = useState<GameState | null>(null);
  const [activeSeat, setActiveSeat] = useState("p1");
  const [humanSeat, setHumanSeat] = useState("p1");
  const [log, setLog] = useState<string[]>([]);
  const [bidAmount, setBidAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sprintSwitchAckedKey, setSprintSwitchAckedKey] = useState<string | null>(null);
  const [settlementDismissedKey, setSettlementDismissedKey] = useState<string | null>(null);
  const [botFlash, setBotFlash] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedVariantKey, setSelectedVariantKey] = useState<string | null>(null);
  const [illegalHint, setIllegalHint] = useState<string | null>(null);
  const [tableDetail, setTableDetail] = useState<TableDetailKind>(null);
  const phaseBarRef = useRef<HTMLElement | null>(null);
  const botBusyRef = useRef(false);
  const illegalPressTimer = useRef<number | null>(null);

  const vsBot = playMode === "vs_bot";
  const currentPlayerId = state ? getCurrentPlayerId(state) : null;
  const botSeatIds = useMemo(() => {
    if (!state || !vsBot) return [] as string[];
    return state.playerOrder.filter((id) => id !== humanSeat);
  }, [state, vsBot, humanSeat]);

  const legal = useMemo(
    () => (state ? listLegalActions(state, activeSeat) : []),
    [state, activeSeat],
  );

  const cornerPinActions = useMemo(
    () => legal.filter((item) => isCornerPinAction(item.action)),
    [legal],
  );

  const phaseRailActions = useMemo(
    () => legal.filter((item) => isPhaseRailAction(item.action)),
    [legal],
  );

  const selectedPlayOptions = useMemo(() => {
    if (!selectedCardId) return [] as LegalAction[];
    return enabledPlayActions(legal, selectedCardId);
  }, [legal, selectedCardId]);

  const selectedPlayAction = useMemo(() => {
    if (selectedPlayOptions.length === 0) return null;
    if (selectedPlayOptions.length === 1) return selectedPlayOptions[0]!;
    if (!selectedVariantKey) return null;
    return (
      selectedPlayOptions.find(
        (item) =>
          item.action.type === "PLAY_CARD" &&
          playVariantKey(item.action) === selectedVariantKey,
      ) ?? null
    );
  }, [selectedPlayOptions, selectedVariantKey]);

  function clearCardSelection() {
    setSelectedCardId(null);
    setSelectedVariantKey(null);
    setIllegalHint(null);
  }

  const forced = state ? detectForcedWindow(state, sprintSwitchAckedKey) : null;
  const settlementKind = state ? detectSettlement(state) : null;
  const settlementKey = state
    ? settlementKind === "okr_reveal"
      ? `okr:${state.okrSettlements?.map((r) => r.playerId).join(",")}`
      : settlementKind === "cross_line"
        ? `cross:${state.pendingInteraction?.type === "C13_WINDOW" ? state.pendingInteraction.milestoneId : state.pendingPerformanceSettlement?.milestoneId ?? "q"}:${state.pendingPerformanceSettlementQueue.length}`
        : settlementKind === "season_end"
          ? `season:${state.sprint}:${state.round}`
          : null
    : null;
  const settlementOpen =
    Boolean(settlementKind && settlementKey && settlementKey !== settlementDismissedKey);

  const humanForced =
    state && vsBot
      ? humanMustHandleForced(state, humanSeat, forced)
      : forced !== null;
  const showForcedUi = vsBot ? humanForced : forced !== null;
  const botActors =
    state && vsBot ? listBotActorSeats(state, botSeatIds) : [];
  const botActing = vsBot && botActors.length > 0;
  const isHumanTurn = currentPlayerId === humanSeat;
  const opsBlocked = showForcedUi;
  const actionBarLocked = Boolean(vsBot && !isHumanTurn && !humanForced && botActing);

  function pushLog(lines: string[]) {
    if (lines.length === 0) return;
    setLog((prev) => [...lines, ...prev].slice(0, 40));
  }

  function focusPhaseBar() {
    phaseBarRef.current?.focus();
    phaseBarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeSettlement() {
    if (settlementKey) setSettlementDismissedKey(settlementKey);
    focusPhaseBar();
  }

  function ackSprintSwitch() {
    if (!state?.sprintSwitchInfo) return;
    setSprintSwitchAckedKey(sprintSwitchKey(state));
    focusPhaseBar();
  }

  function flashBotAuto(seatId: string, kind: string) {
    const seatNo = state ? state.playerOrder.indexOf(seatId) + 1 : 0;
    setBotFlash(`座位 ${seatNo} 已自动提交（${kind}）`);
    window.setTimeout(() => setBotFlash(null), 900);
  }

  function startGame() {
    const names =
      playMode === "vs_bot"
        ? Array.from({ length: playerCount }, (_, i) =>
            i === 0 ? "本座" : `Bot ${i + 1}`,
          )
        : Array.from({ length: playerCount }, (_, i) => `玩家${i + 1}`);
    const game = createGame({
      playerNames: names,
      config: {
        requirementId: "R-01",
        modules: {
          darkBid: true,
          interactionCards: true,
          hiddenOkr: true,
          continuousSprint: true,
        },
      },
      seed: Date.now() % 1_000_000,
    });
    const firstSeat = game.playerOrder[0]!;
    setState(game);
    setHumanSeat(firstSeat);
    setActiveSeat(firstSeat);
    setScreen("play");
    setSprintSwitchAckedKey(null);
    setSettlementDismissedKey(null);
    setBotFlash(null);
    clearCardSelection();
    setTableDetail(null);
    setLog([
      `对局开始 · 规则 ${RULES_VERSION} · ${playerCount} 人 · ${
        playMode === "vs_bot" ? "人机" : "本地多人"
      } · 连续 Sprint×${game.config.sprintCount}`,
      playMode === "vs_bot"
        ? `本座 ${firstSeat}；其余座位 Bot 自动行动`
        : `座位：${game.players.map((p) => p.displayName).join("、")}`,
      `Sprint 1/${game.config.sprintCount} · 需求 ${requirementCopy(game)} · 目标进度 ${game.totalProgressTarget}`,
      "每人已暗抽 1 张 OKR（仅本座位可见）；绩效/OKR 跨 Sprint 结转",
    ]);
    setError(null);
  }

  function commit(next: GameState, events: string[] = []) {
    setState(cloneState(next));
    pushLog(events);
    setError(null);
    clearCardSelection();
  }

  function runLegal(action: LegalAction) {
    if (!state || !action.enabled) {
      setError(action.reason ?? "动作不可用");
      return;
    }
    if (vsBot && botActing && action.action.type !== "SUBMIT_DARK_BID") {
      // Human may still bid while bots auto-bid; otherwise block proxy clicks
      const humanTurn = currentPlayerId === humanSeat;
      const humanC14 =
        state.pendingInteraction?.type === "C14" &&
        state.pendingInteraction.targetId === humanSeat;
      const humanC13 =
        state.pendingInteraction?.type === "C13_WINDOW" &&
        humanSeat !== state.pendingInteraction.breakerId &&
        !state.pendingInteraction.passedIds.includes(humanSeat);
      if (!humanTurn && !humanC14 && !humanC13 && !humanForced) {
        setError("Bot 回合自动中，无法代点");
        return;
      }
    }
    const draft = cloneState(state);
    let payload = action.action;
    if (payload.type === "SUBMIT_DARK_BID") {
      payload = { ...payload, amount: bidAmount };
    }
    const result = applyAction(draft, payload);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    commit(draft, result.events);
  }

  function confirmSelectedPlay() {
    if (!selectedPlayAction) {
      if (selectedCardId && selectedPlayOptions.length > 1 && !selectedVariantKey) {
        setIllegalHint("请选择目标后再确认打出");
        return;
      }
      setError("请先点选手牌中的可打出牌");
      return;
    }
    runLegal(selectedPlayAction);
  }

  function onHandCardActivate(cardId: string) {
    if (opsBlocked || actionBarLocked) return;
    const enabled = enabledPlayActions(legal, cardId);
    const turnAllowsPlay =
      state?.turnPhase === "execute" &&
      currentPlayerId === activeSeat &&
      Boolean(state.eventFlippedThisRound) &&
      !state.pendingInteraction &&
      !(state.pendingDarkBid && !state.pendingDarkBid.resolved);

    if (enabled.length === 0) {
      const reason = illegalReasonForCard(legal, cardId, turnAllowsPlay);
      setIllegalHint(`为何不可：${reason}`);
      setSelectedCardId(null);
      setSelectedVariantKey(null);
      return;
    }

    setIllegalHint(null);
    if (selectedCardId === cardId) {
      if (enabled.length === 1) {
        runLegal(enabled[0]!);
        return;
      }
      if (selectedPlayAction) {
        runLegal(selectedPlayAction);
        return;
      }
      setIllegalHint("请选择目标后再打出");
      return;
    }

    setSelectedCardId(cardId);
    if (enabled.length === 1 && enabled[0]!.action.type === "PLAY_CARD") {
      setSelectedVariantKey(playVariantKey(enabled[0]!.action));
    } else {
      setSelectedVariantKey(null);
    }
  }

  function clearIllegalPressTimer() {
    if (illegalPressTimer.current != null) {
      window.clearTimeout(illegalPressTimer.current);
      illegalPressTimer.current = null;
    }
  }

  function runBotStep() {
    if (!state || !vsBot || state.gameOver || botBusyRef.current) return false;

    // Sprint switch is UI-only — auto-ack so Bot flow never stalls
    if (forced === "sprint_switch" && state.sprintSwitchInfo) {
      botBusyRef.current = true;
      setSprintSwitchAckedKey(sprintSwitchKey(state));
      pushLog([`Bot 自动确认 Sprint 切换`]);
      flashBotAuto(humanSeat, "Sprint 切换");
      botBusyRef.current = false;
      return true;
    }

    const actors = listBotActorSeats(state, botSeatIds);
    if (actors.length === 0) return false;

    const seat = actors[0]!;
    const pick = pickHeuristicLegalAction(state, seat);
    if (!pick || !pick.enabled) return false;

    botBusyRef.current = true;
    const draft = cloneState(state);
    const result = applyAction(draft, pick.action);
    if (!result.ok) {
      setError(result.error);
      botBusyRef.current = false;
      return false;
    }

    const forcedKinds =
      pick.action.type === "SUBMIT_DARK_BID" ||
      pick.action.type === "DECLINE_C14" ||
      pick.action.type === "RESPOND_C14" ||
      pick.action.type === "PASS_C13" ||
      pick.action.type === "RESPOND_C13";
    if (forcedKinds) {
      const kind =
        pick.action.type === "SUBMIT_DARK_BID"
          ? "暗标"
          : pick.action.type === "DECLINE_C14" ||
              pick.action.type === "RESPOND_C14"
            ? "C-14"
            : "C-13";
      flashBotAuto(seat, kind);
    }

    commit(draft, [`Bot（${seatLabel(draft, seat)}）· ${pick.label}`, ...result.events]);
    botBusyRef.current = false;
    return true;
  }

  useEffect(() => {
    if (screen !== "play" || !state || !vsBot || state.gameOver) return;
    const needsSprint =
      forced === "sprint_switch" && Boolean(state.sprintSwitchInfo);
    const actors = listBotActorSeats(state, botSeatIds);
    if (!needsSprint && actors.length === 0) return;

    const timer = window.setTimeout(() => {
      runBotStep();
    }, 280);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drive off state fingerprint
  }, [
    screen,
    vsBot,
    state,
    botSeatIds,
    forced,
    sprintSwitchAckedKey,
  ]);

  function runCatchUpDemo() {
    if (!state) return;
    const draft = cloneState(state);
    draft.currentPlayerIndex = 0;
    const first = seatLabel(draft, "p1");
    const result = forceCatchUpProgressAttempt(draft, "p1", 25);
    setActiveSeat("p1");
    commit(draft, [`演示：跨线补开 — 由 ${first} 推进进度`, ...result.events]);
  }

  function runFlipEventDemo() {
    if (!state) return;
    const draft = cloneState(state);
    draft.currentPlayerIndex = 0;
    const events = forceFlipEvent(draft, "E-04");
    setActiveSeat("p1");
    commit(draft, [`演示：翻事件 — ${seatLabel(draft, "p1")}`, ...events]);
  }

  function runC12Demo() {
    if (!state) return;
    const draft = cloneState(state);
    setupC12Demo(draft);
    setActiveSeat("p1");
    commit(draft, [
      `演示：甩锅 C-12 — ${seatLabel(draft, "p1")} → ${seatLabel(draft, "p2")}`,
      "有个人债/Bug；公共债按钮灰显「仅个人债/Bug」",
      "打出后会打开不可跳过的 C-14 窗",
    ]);
  }

  function runC13Demo() {
    if (!state) return;
    const draft = cloneState(state);
    const result = setupC13StealDemo(draft);
    const actor = draft.playerOrder[draft.playerOrder.length - 1]!;
    setActiveSeat(actor);
    setSettlementDismissedKey(null);
    commit(draft, [
      `演示：抢功 C-13 — 切换到 ${seatLabel(draft, actor)}`,
      ...result.events,
    ]);
  }

  function runC14Demo() {
    if (!state) return;
    const draft = cloneState(state);
    const events = setupC14CounterDemo(draft);
    setActiveSeat("p2");
    commit(draft, [
      `演示：反制 C-14 — 切换到被针对的 ${seatLabel(draft, "p2")}`,
      ...events,
    ]);
  }

  function runMultiCrossDemo() {
    if (!state) return;
    const draft = cloneState(state);
    const result = setupMultiCrossDemo(draft);
    setActiveSeat("p1");
    setSettlementDismissedKey(null);
    commit(draft, result.events);
  }

  function runOkrRevealDemo() {
    if (!state) return;
    const draft = cloneState(state);
    const events = setupOkrRevealDemo(draft);
    setSettlementDismissedKey(null);
    commit(draft, events);
  }

  function runSprintAdvanceDemo() {
    if (!state) return;
    const draft = cloneState(state);
    const events = setupSprintAdvanceDemo(draft);
    setSprintSwitchAckedKey(null);
    commit(draft, events);
  }

  if (screen === "setup") {
    return (
      <main className="shell">
        <header className="hero">
          <p className="eyebrow">Requirement Storm</p>
          <h1>需求风暴</h1>
          <p className="lede">
            连续 Sprint×2 · 事件 + 互动 + 隐藏 OKR ·{" "}
            {playMode === "vs_bot" ? "人机对本座" : "本地多座位"} · 规则 {RULES_VERSION}
          </p>
        </header>

        <section className="setup">
          <h2>开局确认</h2>
          <fieldset className="field mode-toggle">
            <legend>对局模式</legend>
            <label className={`mode-option ${playMode === "local" ? "active" : ""}`}>
              <input
                type="radio"
                name="play-mode"
                checked={playMode === "local"}
                onChange={() => setPlayMode("local")}
              />
              <span>本地多人</span>
            </label>
            <label className={`mode-option ${playMode === "vs_bot" ? "active" : ""}`}>
              <input
                type="radio"
                name="play-mode"
                checked={playMode === "vs_bot"}
                onChange={() => setPlayMode("vs_bot")}
              />
              <span>人机</span>
            </label>
          </fieldset>
          {playMode === "vs_bot" && (
            <p className="mode-hint">
              座位 1 = 本座（真人）；其余座位 = Bot（默认 {playerCount} 人时座位 2–
              {playerCount} 为 Bot）。人数变更时仍保持本座 1 + 其余 Bot。
            </p>
          )}
          <label className="field">
            <span>人数（座位）</span>
            <select
              value={playerCount}
              onChange={(e) => setPlayerCount(Number(e.target.value))}
            >
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} 人{n === 2 ? "（目标进度 100/Sprint）" : n === 4 ? "（默认）" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="rules-box">
            <div>
              规则版本：<strong>{RULES_VERSION}</strong>
            </div>
            <div>
              模块：暗标 · 事件 · 互动 · 隐藏 OKR · <strong>连续 Sprint×2</strong>
            </div>
            <div>Sprint1 需求抽卡；达标后进度归零进入 Sprint2（禁重复需求）</div>
            <div className="muted">绩效 / OKR 计数结转；债与 Bug 重置；系列末定 MVP</div>
          </div>
          <button type="button" className="primary" onClick={startGame}>
            开始
          </button>
        </section>
      </main>
    );
  }

  if (!state) return null;

  const pending = state.pendingDarkBid;
  const interaction = state.pendingInteraction;
  const activePlayer = state.players.find((p) => p.id === activeSeat)!;
  const darkBidZone = darkBidZoneCopy(state);
  const preview = forcedWindowPreview(state, forced);
  const progressPct = Math.min(
    100,
    Math.round((state.progress / Math.max(1, state.totalProgressTarget)) * 100),
  );
  const darkBidMax = state.config.darkBidMax ?? state.constants.darkBidMax;
  const reqDef = state.requirementId ? getRequirementCard(state.requirementId) : undefined;
  const eventDef =
    state.eventFlippedThisRound && state.currentEventId
      ? getEventCard(state.currentEventId)
      : undefined;
  /** 本座在下；其余座位对面上条 — 卡牌桌空间 */
  const localSeatId = vsBot ? humanSeat : activeSeat;
  const opponents = state.players.filter((p) => p.id !== localSeatId);
  const localPlayer = state.players.find((p) => p.id === localSeatId) ?? activePlayer;
  const selfOkr = localPlayer.okrId ? getOkrCard(localPlayer.okrId) : undefined;
  const selfOkrSettlement =
    state.okrRevealed && state.okrSettlements
      ? state.okrSettlements.find((r) => r.playerId === localSeatId)
      : undefined;

  return (
    <main
      className="table-shell card-table"
      onClick={(e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (
          target.closest(
            ".hand-card, .corner-ops, .local-okr-card, .hand-confirm-rail, .forced-window, .settlement-layer, .target-row, .stage-card, .table-detail-layer, .seat-chip, .demo-drawer, .log-drawer, .phase-bar, .hand-head, .opponents-strip",
          )
        ) {
          return;
        }
        clearCardSelection();
      }}
    >
      {botFlash && (
        <div className="bot-flash" role="status" aria-live="polite">
          {botFlash}
        </div>
      )}
      {/* 1. Phase bar — 单行 ≤40px；演示折入次要 */}
      <header
        className={`phase-bar ${showForcedUi ? "busy" : "idle"}`}
        aria-label="相位条"
        tabIndex={-1}
        ref={phaseBarRef}
      >
        <div className="phase-bar-main">
          <div className="phase-bar-title">
            <strong>需求风暴</strong>
          </div>
          <div className="phase-steps" aria-label="回合四阶段">
            {PHASES.map((phase) => (
              <div
                key={phase}
                className={`phase ${state.turnPhase === phase ? "active" : ""}`}
              >
                {PHASE_LABEL[phase]}
              </div>
            ))}
          </div>
          <div className="phase-bar-status">
            <span className="phase-now">{PHASE_LABEL[state.turnPhase]}</span>
            {showForcedUi || preview ? (
              <span className="phase-preview">{preview ?? "强制窗进行中"}</span>
            ) : (
              <span className="phase-hud">
                {turnHudCopy({
                  vsBot,
                  isHumanTurn,
                  currentPlayerId,
                  state,
                  botAuto: botActing,
                })}
              </span>
            )}
          </div>
          <details className="phase-demo-fold">
            <summary>演示</summary>
            <div className="demo-row">
              <button type="button" className="demo" onClick={runFlipEventDemo}>
                翻事件
              </button>
              <button type="button" className="demo" onClick={runC12Demo}>
                甩锅 C-12
              </button>
              <button type="button" className="demo" onClick={runC13Demo}>
                抢功 C-13
              </button>
              <button type="button" className="demo" onClick={runC14Demo}>
                反制 C-14
              </button>
              <button type="button" className="demo" onClick={runCatchUpDemo}>
                跨线补开
              </button>
              <button type="button" className="demo" onClick={runMultiCrossDemo}>
                同次多跨线
              </button>
              <button type="button" className="demo" onClick={runOkrRevealDemo}>
                亮 OKR
              </button>
              <button type="button" className="demo" onClick={runSprintAdvanceDemo}>
                Sprint 切换
              </button>
            </div>
          </details>
          <button type="button" className="ghost phase-back" onClick={() => setScreen("setup")}>
            回开局
          </button>
        </div>

        {showForcedUi && forced === "c14" && interaction?.type === "C14" && (
          <section className="forced-window" role="alertdialog" aria-label="C-14 响应">
            <h2>必须响应 C-14，不能跳过</h2>
            <p>
              {seatLabel(state, interaction.sourceId)} 的互动针对{" "}
              <strong>{seatLabel(state, interaction.targetId)}</strong>
              。被针对者须打出 C-14 或放弃以关闭窗口，然后才结算。
            </p>
            <p className="muted">强制窗覆盖本座操作；完成响应后自动关闭。</p>
            <div className="action-list forced-actions">
              {legal
                .filter(
                  (item) =>
                    item.action.type === "RESPOND_C14" ||
                    item.action.type === "DECLINE_C14",
                )
                .map((item, index) => (
                  <button
                    key={`c14-${item.label}-${index}`}
                    type="button"
                    disabled={!item.enabled}
                    title={item.reason}
                    onClick={() => runLegal(item)}
                  >
                    {item.label}
                    {!item.enabled && item.reason ? ` — ${item.reason}` : ""}
                  </button>
                ))}
            </div>
          </section>
        )}

        {showForcedUi && forced === "catch_up_dark_bid" && pending && !pending.resolved && (
          <section
            className="forced-window catch-up"
            role="alertdialog"
            aria-label={pending.isCatchUp ? "跨线补开暗标" : "冲刺区暗标"}
          >
            <h2>{pending.isCatchUp ? "必须补开，不能跳过" : "暗标进行中，不能跳过"}</h2>
            <p>
              里程碑 <strong>{milestoneName(state, pending.milestoneId)}</strong>
              {pending.isCatchUp
                ? "：未进冲刺区却将跨线，结算前强制补开暗标。"
                : "：冲刺区暗标，全员出价后继续。"}
            </p>
            {state.pendingProgressSettlement && (
              <p className="warn">
                进度结算已挂起（+{state.pendingProgressSettlement.progressGain}
                ），全员出价前不会结算。
              </p>
            )}
            <div className="bid-row">
              <p className="bid-label">
                你的出价（0–{darkBidMax}）
              </p>
              <div className="bid-pills" role="group" aria-label="暗标出价">
                {Array.from({ length: darkBidMax + 1 }, (_, amount) => (
                  <button
                    key={`bid-pill-${amount}`}
                    type="button"
                    className={`bid-pill ${bidAmount === amount ? "selected" : ""}`}
                    onClick={() => setBidAmount(amount)}
                  >
                    {amount}
                  </button>
                ))}
              </div>
              <p className="muted">
                已出价：
                {state.playerOrder
                  .map((id) => {
                    const label = seatLabel(state, id);
                    return `${label}${id in pending.bids ? "✓" : "…"}`;
                  })
                  .join("  ")}
              </p>
            </div>
            <div className="action-list forced-actions">
              {legal
                .filter(
                  (item) =>
                    item.action.type === "SUBMIT_DARK_BID" ||
                    item.action.type === "RESOLVE_DARK_BID",
                )
                .map((item, index) => (
                  <button
                    key={`bid-${item.label}-${index}`}
                    type="button"
                    disabled={!item.enabled}
                    title={item.reason}
                    onClick={() => runLegal(item)}
                  >
                    {item.label}
                    {!item.enabled && item.reason ? ` — ${item.reason}` : ""}
                  </button>
                ))}
            </div>
          </section>
        )}

        {showForcedUi && forced === "sprint_switch" && state.sprintSwitchInfo && (
          <section className="forced-window sprint" role="alertdialog" aria-label="Sprint 切换">
            <h2>
              Sprint 切换 {state.sprintSwitchInfo.fromSprint} →{" "}
              {state.sprintSwitchInfo.toSprint}
            </h2>
            <ul className="switch-facts">
              <li>进度 → 0</li>
              <li>债 / Bug 清空（{state.sprintSwitchInfo.cleared.join("、")}）</li>
              <li>绩效结转（{state.sprintSwitchInfo.carried.join("、")}）</li>
            </ul>
            <p className="muted">
              需求{" "}
              {getRequirementCard(state.sprintSwitchInfo.previousRequirementId)?.name ?? "—"}{" "}
              → {getRequirementCard(state.sprintSwitchInfo.nextRequirementId)?.name ?? "—"}
            </p>
            <button type="button" className="primary" onClick={ackSprintSwitch}>
              确认进入下一 Sprint
            </button>
          </section>
        )}
      </header>

      {/* 2. Upper — 对面上条：他座 1–3 横向芯片（禁大卡） */}
      <section className="opponents-strip" aria-label="对面座位">
        {opponents.map((p) => {
          const isBot = vsBot && p.id !== humanSeat;
          const isTurn = p.id === currentPlayerId;
          const debtPressure = p.personalDebt > 0 || p.personalBugs > 0;
          const canSwitchSeat = !vsBot;
          return (
            <button
              key={p.id}
              type="button"
              className={`seat-chip facing ${isTurn ? "turn" : ""} ${isBot ? "bot" : ""}`}
              disabled={vsBot && isBot}
              onClick={() => {
                if (canSwitchSeat) {
                  setActiveSeat(p.id);
                  clearCardSelection();
                }
              }}
            >
              <span className="seat-color" aria-hidden />
              <span className="seat-facing-name">
                {p.displayName}
                {isBot ? <span className="bot-tag"> Bot</span> : null}
              </span>
              <span className="seat-facing-stat">绩 {p.performance}</span>
              <span className="seat-facing-stat">手 {p.hand.length}</span>
              <span className={`seat-facing-stat ${debtPressure ? "pressure" : ""}`}>
                债{p.personalDebt}/Bug{p.personalBugs}
              </span>
              <span className="seat-facing-okr" title="他座 OKR 不可窥">
                已抽取 · 结算亮牌
              </span>
              {isTurn ? <span className="seat-facing-turn">行动中</span> : null}
            </button>
          );
        })}
      </section>

      {/* 3. Center battlefield — 进度轨 + 三槽放大 */}
      <section className="table-center" aria-label="桌心公共区">
        <div className="series-line">{seriesProgressCopy(state)}</div>

        <div className="progress-block">
          <div className="progress-meta">
            {state.publicDebt > 0 ? (
              <span className="pressure">公共债 {state.publicDebt}</span>
            ) : (
              <span>公共债 0</span>
            )}
          </div>
          <div className="progress-track" aria-hidden>
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            {state.milestones.map((m) => {
              const left = Math.min(
                100,
                Math.round((m.threshold / Math.max(1, state.totalProgressTarget)) * 100),
              );
              const crossed = state.crossedMilestones.includes(m.id);
              return (
                <div
                  key={m.id}
                  className={`milestone-mark ${crossed ? "crossed" : ""}`}
                  style={{ left: `${left}%` }}
                  title={`${m.name} @ ${m.threshold}`}
                >
                  <span>{m.name}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="table-slots">
          <button
            type="button"
            className={`stage-card req-face ${tableDetail === "requirement" ? "detail-open" : ""}`}
            aria-label="当前需求"
            aria-expanded={tableDetail === "requirement"}
            onClick={() =>
              setTableDetail((prev) => (prev === "requirement" ? null : "requirement"))
            }
          >
            <span className="card-badge">R</span>
            <span className="slot-label">当前需求</span>
            <strong>{requirementCopy(state)}</strong>
            {reqDef ? (
              <span className="stage-card-meta">难度 {reqDef.difficulty}</span>
            ) : (
              <span className="stage-card-meta muted-slot">空槽说明</span>
            )}
          </button>

          <button
            type="button"
            className={`stage-card event-slot ${
              eventDef ? "filled" : "empty"
            } ${tableDetail === "event" ? "detail-open" : ""}`}
            aria-label="事件"
            aria-expanded={tableDetail === "event"}
            disabled={!eventDef}
            onClick={() => {
              if (!eventDef) return;
              setTableDetail((prev) => (prev === "event" ? null : "event"));
            }}
          >
            {eventDef ? (
              <>
                <span className="card-badge">E</span>
                <span className="slot-label">事件</span>
                <strong className="event-name">{eventDef.name}</strong>
                <span className="stage-card-meta">{eventDef.trigger}</span>
              </>
            ) : (
              <>
                <span className="slot-label">事件</span>
                <span>{eventBarCopy(state)}</span>
              </>
            )}
          </button>

          <div
            className={`stage-card dark-bid-slot ${darkBidZone.status}${
              darkBidZone.status === "collapsed" ? "" : " fogged"
            }`}
            aria-label={
              darkBidZone.status === "collapsed"
                ? "暗标区空"
                : "暗标区（背面，不可窥视）"
            }
          >
            {darkBidZone.status === "collapsed" ? (
              <>
                <span className="slot-label">暗标</span>
                <span className="status-copy">{darkBidZone.label}</span>
              </>
            ) : (
              <>
                <p className="dark-bid-mark">RS</p>
                <span className="fog-copy">背面</span>
              </>
            )}
          </div>
        </div>

        {tableDetail === "requirement" && (
          <div className="table-detail-layer" role="dialog" aria-label="需求详情">
            <button
              type="button"
              className="table-detail-card"
              onClick={() => setTableDetail(null)}
            >
              <span className="card-badge">R</span>
              <strong>{reqDef?.name ?? "本 Sprint 未抽需求"}</strong>
              <span className="detail-cost">
                {reqDef ? `难度 ${reqDef.difficulty}` : "—"}
              </span>
              <p className="detail-effect">
                {reqDef?.mechanismText ?? "空槽：本 Sprint 尚未抽出需求牌。"}
              </p>
              <span className="detail-close-hint">再次点击关闭</span>
            </button>
          </div>
        )}

        {tableDetail === "event" && eventDef && (
          <div className="table-detail-layer" role="dialog" aria-label="事件详情">
            <button
              type="button"
              className="table-detail-card"
              onClick={() => setTableDetail(null)}
            >
              <span className="card-badge">E</span>
              <strong>{eventDef.name}</strong>
              <span className="detail-cost">{eventDef.trigger}</span>
              <p className="detail-effect">{eventDef.effectText}</p>
              <span className="detail-close-hint">再次点击关闭</span>
            </button>
          </div>
        )}
      </section>

      {/* 4. Bottom — 左 OKR 竖卡 · 中手牌扇 · 右下仅钉工时/结束 */}
      <section
        className={`local-zone ${opsBlocked ? "covered" : ""} ${
          actionBarLocked ? "bot-locked" : ""
        }`}
        aria-label="本座区"
        onClick={(e) => {
          if (e.target === e.currentTarget) clearCardSelection();
        }}
      >
        {opsBlocked && (
          <div className="ops-cover local-cover" aria-hidden>
            <span>强制窗进行中 · 完成本座强制响应后继续</span>
          </div>
        )}

        <aside
          className={`local-okr-card ${selfOkrSettlement ? "revealed" : "hidden-self"}`}
          aria-label="本座 OKR"
        >
          <span className="okr-kicker">本座 OKR</span>
          <strong className="okr-name">
            {selfOkrSettlement?.name ?? selfOkr?.name ?? "未抽取"}
          </strong>
          <p className="okr-cond">
            {selfOkrSettlement?.conditionText ??
              selfOkr?.conditionText ??
              "开局暗抽，总结算亮牌"}
          </p>
          <p className="okr-reward">
            奖励 +{selfOkr?.reward ?? selfOkrSettlement?.reward ?? "—"}
          </p>
          {selfOkrSettlement ? (
            <p className={selfOkrSettlement.achieved ? "okr-ok" : "okr-miss"}>
              {selfOkrSettlement.achieved
                ? `达成 +${selfOkrSettlement.reward}`
                : "未达成"}
            </p>
          ) : null}
        </aside>

        <div className="local-hand-block">
          <div className="hand-confirm-rail">
            <div className="hand-head">
              <h2>
                {localPlayer.displayName}
                <span className="hand-meta-inline">
                  {" "}
                  · 绩 {localPlayer.performance} · 手 {localPlayer.hand.length} · 债
                  {localPlayer.personalDebt}/Bug{localPlayer.personalBugs}
                </span>
              </h2>
              {selectedCardId ? (
                <button type="button" className="ghost" onClick={clearCardSelection}>
                  取消选择
                </button>
              ) : null}
            </div>
            {illegalHint ? <p className="hand-hint">{illegalHint}</p> : null}
            {error && <p className="error">{error}</p>}
            {selectedCardId && selectedPlayOptions.length > 1 ? (
              <div className="target-row" role="group" aria-label="出牌目标">
                <span className="target-label">选择目标</span>
                {selectedPlayOptions.map((item, index) => {
                  if (item.action.type !== "PLAY_CARD") return null;
                  const key = playVariantKey(item.action);
                  return (
                    <button
                      key={`var-${key}-${index}`}
                      type="button"
                      className={`target-chip ${
                        selectedVariantKey === key ? "selected" : ""
                      }`}
                      onClick={() => setSelectedVariantKey(key)}
                    >
                      {compactVariantLabel(item, (id) => seatLabel(state, id))}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="hand-rail-actions">
              <button
                type="button"
                className="primary confirm-play"
                disabled={!selectedPlayAction || opsBlocked || actionBarLocked}
                title={
                  !selectedCardId
                    ? "先点选一张可打出的手牌"
                    : selectedPlayOptions.length > 1 && !selectedVariantKey
                      ? "请选择目标"
                      : undefined
                }
                onClick={confirmSelectedPlay}
              >
                确认打出
              </button>
              {phaseRailActions.map((item, index) => (
                <button
                  key={`${item.action.type}-${index}`}
                  type="button"
                  disabled={!item.enabled || opsBlocked || actionBarLocked}
                  title={actionBarLocked ? "Bot 回合自动中" : item.reason}
                  className={
                    !item.enabled || actionBarLocked ? "illegal" : undefined
                  }
                  onClick={() => runLegal(item)}
                >
                  {barActionLabel(item)}
                  {!item.enabled && item.reason ? ` — ${item.reason}` : ""}
                </button>
              ))}
            </div>
          </div>

          {activePlayer.hand.length === 0 ? (
            <p className="muted hand-empty">空手牌</p>
          ) : (
            <ul className="hand-fan" aria-label="可点选手牌">
              {activePlayer.hand.map((cardId, index) => {
                const card = getActionCard(cardId);
                const badge = handCardBadge(cardId);
                const enabled = enabledPlayActions(legal, cardId);
                const isLegal = enabled.length > 0 && !opsBlocked && !actionBarLocked;
                const isSelected = selectedCardId === cardId;
                const plays = playActionsForCard(legal, cardId);
                const greyReason =
                  !isLegal
                    ? illegalReasonForCard(
                        legal,
                        cardId,
                        state.turnPhase === "execute" &&
                          currentPlayerId === activeSeat &&
                          state.eventFlippedThisRound,
                      )
                    : undefined;
                return (
                  <li key={`${cardId}-${index}`}>
                    <button
                      type="button"
                      className={`hand-card ${isLegal ? "legal" : "illegal"} ${
                        isSelected ? "selected" : ""
                      }`}
                      disabled={opsBlocked || actionBarLocked}
                      title={greyReason}
                      aria-pressed={isSelected}
                      aria-disabled={!isLegal}
                      onClick={(e) => {
                        e.stopPropagation();
                        onHandCardActivate(cardId);
                      }}
                      onPointerDown={() => {
                        if (isLegal || opsBlocked || actionBarLocked) return;
                        clearIllegalPressTimer();
                        illegalPressTimer.current = window.setTimeout(() => {
                          setIllegalHint(
                            `为何不可：${
                              greyReason ??
                              plays.find((p) => p.reason)?.reason ??
                              "当前不可打出"
                            }`,
                          );
                        }, 420);
                      }}
                      onPointerUp={clearIllegalPressTimer}
                      onPointerLeave={clearIllegalPressTimer}
                      onPointerCancel={clearIllegalPressTimer}
                    >
                      <span className={`card-badge ${badge === "I" ? "accent" : ""}`}>
                        {badge}
                      </span>
                      <span className="hand-card-name">{card?.name ?? "未知卡"}</span>
                      <span className="hand-card-meta">{handCardCostCopy(cardId)}</span>
                      <span className="hand-card-effect">{handCardEffectLine(cardId)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside
          className="corner-ops"
          aria-label="本座钉住操作"
          aria-disabled={opsBlocked || actionBarLocked}
        >
          <div className="corner-pin-actions">
            {cornerPinActions.map((item, index) => (
              <button
                key={`${item.action.type}-${index}`}
                type="button"
                disabled={!item.enabled || opsBlocked || actionBarLocked}
                title={actionBarLocked ? "Bot 回合自动中" : item.reason}
                className={
                  !item.enabled || actionBarLocked
                    ? "illegal"
                    : item.action.type === "USE_BASE_OVERTIME"
                      ? "primary"
                      : undefined
                }
                onClick={() => runLegal(item)}
              >
                {barActionLabel(item)}
                {!item.enabled && item.reason ? ` — ${item.reason}` : ""}
              </button>
            ))}
          </div>
        </aside>
      </section>

      <details className="log-drawer">
        <summary>日志</summary>
        <ul>
          {log.map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ul>
      </details>

      {/* 5. Settlement layer — 模态浮层 */}
      {settlementOpen && settlementKind && (
        <div className="settlement-layer" role="dialog" aria-modal="true" aria-label="结算层">
          <div
            className={`settlement-panel ${
              settlementKind === "okr_reveal"
                ? "okr-reveal"
                : settlementKind === "cross_line"
                  ? "cross-line"
                  : ""
            }`}
          >
            {settlementKind === "okr_reveal" && state.okrSettlements && (
              <>
                <h2>系列结算 · OKR 亮牌</h2>
                <p>
                  系列 MVP：<strong>{mvpName(state)}</strong>
                </p>
                <div className="settlement-okr-list">
                  {state.okrSettlements.map((row: OkrEvaluation) => (
                    <div key={row.playerId} className="settlement-okr-row">
                      <strong>{row.displayName}</strong>
                      <span>{row.name}</span>
                      <span className={row.achieved ? "okr-ok" : "okr-miss"}>
                        {row.achieved ? `达成 +${row.reward}` : "未达成"}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {settlementKind === "cross_line" && (
              <>
                <h2>跨线结算</h2>
                {interaction?.type === "C13_WINDOW" ? (
                  <p>
                    里程碑{" "}
                    <strong>{milestoneName(state, interaction.milestoneId)}</strong>{" "}
                    突破者{" "}
                    <strong>{seatLabel(state, interaction.breakerId)}</strong>
                    。可抢功或弃权；全员弃权后发放绩效。
                    {state.pendingPerformanceSettlementQueue.length > 0
                      ? ` 另有 ${state.pendingPerformanceSettlementQueue.length} 条跨线排队。`
                      : ""}
                  </p>
                ) : state.pendingPerformanceSettlement ? (
                  <p>
                    里程碑{" "}
                    <strong>
                      {milestoneName(
                        state,
                        state.pendingPerformanceSettlement.milestoneId,
                      )}
                    </strong>{" "}
                    突破者{" "}
                    <strong>
                      {seatLabel(state, state.pendingPerformanceSettlement.breakerId)}
                    </strong>
                    ；绩效结算挂起中。
                  </p>
                ) : (
                  <p>跨线绩效排队处理中。</p>
                )}
                {interaction?.type === "C13_WINDOW" && (
                  <div className="action-list forced-actions">
                    {legal
                      .filter(
                        (item) =>
                          item.action.type === "RESPOND_C13" ||
                          item.action.type === "PASS_C13",
                      )
                      .map((item, index) => (
                        <button
                          key={`c13-${item.label}-${index}`}
                          type="button"
                          disabled={!item.enabled}
                          title={item.reason}
                          onClick={() => runLegal(item)}
                        >
                          {item.label}
                          {!item.enabled && item.reason ? ` — ${item.reason}` : ""}
                        </button>
                      ))}
                  </div>
                )}
              </>
            )}

            {settlementKind === "season_end" && (
              <>
                <h2>赛季 / 系列终局</h2>
                <p>
                  系列 MVP 候选：<strong>{mvpName(state)}</strong>
                  。隐藏 OKR 尚未亮牌。
                </p>
              </>
            )}

            <button type="button" className="primary" onClick={closeSettlement}>
              关闭并回到相位条
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
