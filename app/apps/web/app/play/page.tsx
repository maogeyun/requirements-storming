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
  listLegalActions,
  setupC12Demo,
  setupC13StealDemo,
  setupC14CounterDemo,
  setupMultiCrossDemo,
  setupOkrRevealDemo,
  setupSprintAdvanceDemo,
} from "@rs/rules-engine";
import type { GameState, LegalAction, OkrEvaluation, TurnPhase } from "@rs/shared";
import { useMemo, useRef, useState } from "react";

const PHASES: TurnPhase[] = ["draw", "plan", "execute", "end"];
const PHASE_LABEL: Record<TurnPhase, string> = {
  draw: "抽卡",
  plan: "规划",
  execute: "执行",
  end: "收尾",
};

const RULES_VERSION = "v1.2";

type Screen = "setup" | "play";

/** 相位条三类互斥、不可跳过强制窗 */
type ForcedWindowKind = "catch_up_dark_bid" | "c14" | "sprint_switch" | null;

type SettlementKind = "cross_line" | "okr_reveal" | "season_end" | null;

function seatLabel(state: GameState, playerId: string | null | undefined): string {
  if (!playerId) return "—";
  return state.players.find((p) => p.id === playerId)?.displayName ?? "—";
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
    return { status: "collapsed", label: "已收束" };
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
  if (pending && !pending.resolved && pending.isCatchUp) {
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
  const seriesDone =
    (state.sprint - 1) * state.totalProgressTarget + state.progress;
  const seriesTarget = state.config.modules.continuousSprint
    ? state.config.sprintCount * state.totalProgressTarget
    : state.totalProgressTarget;
  return `${sprintLabel} · 系列进度 ${seriesDone}/${seriesTarget}`;
}

function forcedWindowPreview(
  state: GameState,
  forced: ForcedWindowKind,
): string | null {
  if (forced === "c14") return "下一强制窗：C-14 响应";
  if (forced === "catch_up_dark_bid") return "下一强制窗：跨线补开暗标";
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
  const [playerCount, setPlayerCount] = useState(4);
  const [state, setState] = useState<GameState | null>(null);
  const [activeSeat, setActiveSeat] = useState("p1");
  const [log, setLog] = useState<string[]>([]);
  const [bidAmount, setBidAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sprintSwitchAckedKey, setSprintSwitchAckedKey] = useState<string | null>(null);
  const [settlementDismissedKey, setSettlementDismissedKey] = useState<string | null>(null);
  const phaseBarRef = useRef<HTMLElement | null>(null);

  const currentPlayerId = state ? getCurrentPlayerId(state) : null;
  const legal = useMemo(
    () => (state ? listLegalActions(state, activeSeat) : []),
    [state, activeSeat],
  );

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

  function startGame() {
    const names = Array.from({ length: playerCount }, (_, i) => `玩家${i + 1}`);
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
    setState(game);
    setActiveSeat(game.playerOrder[0]!);
    setScreen("play");
    setSprintSwitchAckedKey(null);
    setSettlementDismissedKey(null);
    setLog([
      `对局开始 · 规则 ${RULES_VERSION} · ${playerCount} 人 · 连续 Sprint×${game.config.sprintCount}`,
      `座位：${game.players.map((p) => p.displayName).join("、")}`,
      `Sprint 1/${game.config.sprintCount} · 需求 ${requirementCopy(game)} · 目标进度 ${game.totalProgressTarget}`,
      "每人已暗抽 1 张 OKR（仅本座位可见）；绩效/OKR 跨 Sprint 结转",
    ]);
    setError(null);
  }

  function commit(next: GameState, events: string[] = []) {
    setState(cloneState(next));
    pushLog(events);
    setError(null);
  }

  function runLegal(action: LegalAction) {
    if (!state || !action.enabled) {
      setError(action.reason ?? "动作不可用");
      return;
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
            连续 Sprint×2 · 事件 + 互动 + 隐藏 OKR · 本地多座位 · 规则 {RULES_VERSION}
          </p>
        </header>

        <section className="setup">
          <h2>开局确认</h2>
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
  const opsBlocked = forced !== null;
  const selfOkr = activePlayer.okrId ? getOkrCard(activePlayer.okrId) : undefined;
  const progressPct = Math.min(
    100,
    Math.round((state.progress / Math.max(1, state.totalProgressTarget)) * 100),
  );

  return (
    <main className="table-shell">
      {/* 1. Phase bar — 全局置顶 */}
      <header
        className={`phase-bar ${forced ? "busy" : "idle"}`}
        aria-label="相位条"
        tabIndex={-1}
        ref={phaseBarRef}
      >
        <div className="phase-bar-main">
          <div className="phase-bar-title">
            <strong>需求风暴</strong>
            <span className="muted"> · {RULES_VERSION}</span>
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
          <button type="button" className="ghost" onClick={() => setScreen("setup")}>
            回开局
          </button>
        </div>
        <div className="phase-bar-status">
          <span>
            当前阶段：<strong>{PHASE_LABEL[state.turnPhase]}</strong>
          </span>
          {forced || preview ? (
            <span className="phase-preview">{preview ?? "强制窗进行中"}</span>
          ) : null}
        </div>

        {forced === "c14" && interaction?.type === "C14" && (
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

        {forced === "catch_up_dark_bid" && pending && !pending.resolved && (
          <section className="forced-window" role="alertdialog" aria-label="跨线补开暗标">
            <h2>必须补开，不能跳过</h2>
            <p>
              里程碑 <strong>{pending.milestoneId}</strong>
              ：未进冲刺区却将跨线，结算前强制补开暗标。
            </p>
            {state.pendingProgressSettlement && (
              <p className="warn">
                进度结算已挂起（+{state.pendingProgressSettlement.progressGain}
                ），全员出价前不会结算。
              </p>
            )}
            <div className="bid-row">
              <label>
                你的出价（0–{state.config.darkBidMax ?? state.constants.darkBidMax}）
                <input
                  type="number"
                  min={0}
                  max={state.config.darkBidMax ?? state.constants.darkBidMax}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(Number(e.target.value))}
                />
              </label>
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

        {forced === "sprint_switch" && state.sprintSwitchInfo && (
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

      {/* 2. Table center — 公共状态 */}
      <section className="table-center" aria-label="桌心公共区">
        <div className="series-line">{seriesProgressCopy(state)}</div>

        <div className="progress-block">
          <div className="progress-meta">
            <span>
              公共进度 {state.progress}/{state.totalProgressTarget}
            </span>
            {state.publicDebt > 0 ? (
              <span className="warn">公共债 {state.publicDebt}</span>
            ) : (
              <span className="muted">公共债 0</span>
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

        <div className="req-card skeleton-slot">
          <span className="slot-label">当前需求</span>
          <strong>{requirementCopy(state)}</strong>
        </div>

        <div className="event-bar skeleton-slot">
          <span className="slot-label">事件</span>
          <span>{eventBarCopy(state)}</span>
        </div>

        <div className={`dark-bid-zone skeleton-slot ${darkBidZone.status}`}>
          <span className="slot-label">暗标区</span>
          <span>{darkBidZone.label}</span>
          {darkBidZone.status !== "collapsed" && pending && (
            <span className="muted">
              {" "}
              · {pending.milestoneId}
              {pending.isCatchUp ? " · 补开" : ""}
            </span>
          )}
        </div>
      </section>

      {/* 3. Seat ring */}
      <section className="seat-ring" aria-label="座位环">
        <div className="seat-ring-grid">
          {state.players.map((p) => {
            const isOwn = p.id === activeSeat;
            const isTurn = p.id === currentPlayerId;
            const okrDef = p.okrId ? getOkrCard(p.okrId) : undefined;
            return (
              <button
                key={p.id}
                type="button"
                className={`seat-chip ${isTurn ? "turn" : ""} ${isOwn ? "own" : ""}`}
                onClick={() => setActiveSeat(p.id)}
              >
                <div className="seat-chip-head">
                  <strong>{p.displayName}</strong>
                  {isOwn ? <span className="own-tag">本座</span> : null}
                  {isTurn ? <span className="turn-tag">行动中</span> : null}
                </div>
                <div className="seat-stats">
                  <span>绩效 {p.performance}</span>
                  <span>
                    工时 {p.workHoursRemaining}/{p.workHoursBudget}
                  </span>
                  <span>
                    债 {p.personalDebt} · Bug {p.personalBugs}
                  </span>
                  <span>手牌 {p.hand.length}</span>
                </div>
                <div className="seat-okr">
                  {state.okrRevealed ? (
                    <span className="muted">已亮牌 · 见结算层</span>
                  ) : isOwn ? (
                    <span>OKR · {okrDef?.name ?? "未抽取"}</span>
                  ) : (
                    <span className="locked">已抽取 · 结算亮牌</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 4. Local seat ops — 仅本座 */}
      <section
        className={`local-ops ${opsBlocked ? "covered" : ""}`}
        aria-label="本座操作"
        aria-disabled={opsBlocked}
      >
        {opsBlocked && (
          <div className="ops-cover" aria-hidden>
            <span>强制窗进行中 · 完成本座强制响应后继续</span>
          </div>
        )}

        <div className="local-okr">
          <h2>本座 OKR</h2>
          {state.okrRevealed && state.okrSettlements ? (
            (() => {
              const row = state.okrSettlements.find((r) => r.playerId === activeSeat);
              return (
                <p>
                  {row
                    ? `${row.name} · ${row.achieved ? `达成 +${row.reward}` : "未达成"}`
                    : "—"}
                </p>
              );
            })()
          ) : (
            <>
              <p className="okr-title-line">{selfOkr?.name ?? "未抽取"}</p>
              <p className="muted">{selfOkr?.conditionText ?? "开局暗抽，总结算亮牌"}</p>
            </>
          )}
        </div>

        <div className="local-hand">
          <h2>本座手牌</h2>
          {activePlayer.hand.length === 0 ? (
            <p className="muted">空手牌</p>
          ) : (
            <ul className="hand-expanded">
              {activePlayer.hand.map((cardId, index) => {
                const card = getActionCard(cardId);
                return (
                  <li key={`${cardId}-${index}`}>
                    {card ? `${card.name}（${card.workHours}h）` : "未知卡"}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="local-actions">
          <h2>本座动作 · {PHASE_LABEL[state.turnPhase]}</h2>
          {error && <p className="error">{error}</p>}
          <div className="action-list">
            {legal.map((item, index) => (
              <button
                key={`${item.label}-${index}`}
                type="button"
                disabled={!item.enabled || opsBlocked}
                title={item.reason}
                className={!item.enabled ? "illegal" : undefined}
                onClick={() => runLegal(item)}
              >
                {item.label}
                {!item.enabled && item.reason ? ` — ${item.reason}` : ""}
              </button>
            ))}
          </div>
        </div>

      </section>

      <details className="demo-drawer">
        <summary>演示路径（次要，不抢主流程）</summary>
        <div className="demo-row">
          <button type="button" className="demo" onClick={runFlipEventDemo}>
            演示：翻事件
          </button>
          <button type="button" className="demo" onClick={runC12Demo}>
            演示：甩锅 C-12
          </button>
          <button type="button" className="demo" onClick={runC13Demo}>
            演示：抢功 C-13
          </button>
          <button type="button" className="demo" onClick={runC14Demo}>
            演示：反制 C-14
          </button>
          <button type="button" className="demo" onClick={runCatchUpDemo}>
            演示：跨线补开
          </button>
          <button type="button" className="demo" onClick={runMultiCrossDemo}>
            演示：同次多跨线
          </button>
          <button type="button" className="demo" onClick={runOkrRevealDemo}>
            演示：总结算亮 OKR
          </button>
          <button type="button" className="demo" onClick={runSprintAdvanceDemo}>
            演示：Sprint 切换
          </button>
        </div>
      </details>

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
          <div className="settlement-panel">
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
                    里程碑 <strong>{interaction.milestoneId}</strong> 突破者{" "}
                    <strong>{seatLabel(state, interaction.breakerId)}</strong>
                    。可抢功或弃权；全员弃权后发放绩效。
                    {state.pendingPerformanceSettlementQueue.length > 0
                      ? ` 另有 ${state.pendingPerformanceSettlementQueue.length} 条跨线排队。`
                      : ""}
                  </p>
                ) : state.pendingPerformanceSettlement ? (
                  <p>
                    里程碑{" "}
                    <strong>{state.pendingPerformanceSettlement.milestoneId}</strong>{" "}
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
