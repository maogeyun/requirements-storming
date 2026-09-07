"use client";

import { getActionCard, getEventCard } from "@rs/game-data";
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
} from "@rs/rules-engine";
import type { GameState, LegalAction, TurnPhase } from "@rs/shared";
import { useMemo, useState } from "react";

const PHASES: TurnPhase[] = ["draw", "plan", "execute", "end"];
const PHASE_LABEL: Record<TurnPhase, string> = {
  draw: "1 抽卡",
  plan: "2 规划",
  execute: "3 执行",
  end: "4 收尾",
};

const RULES_VERSION = "v1.2";

type Screen = "setup" | "play";

function seatLabel(state: GameState, playerId: string | null | undefined): string {
  if (!playerId) return "—";
  return state.players.find((p) => p.id === playerId)?.displayName ?? "—";
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
    milestones: state.milestones.map((m) => ({ ...m })),
    config: {
      ...state.config,
      modules: { ...state.config.modules },
    },
    constants: state.constants,
  };
}

export default function PlayShellPage() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [playerCount, setPlayerCount] = useState(4);
  const [state, setState] = useState<GameState | null>(null);
  const [activeSeat, setActiveSeat] = useState("p1");
  const [log, setLog] = useState<string[]>([]);
  const [bidAmount, setBidAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const currentPlayerId = state ? getCurrentPlayerId(state) : null;
  const legal = useMemo(
    () => (state ? listLegalActions(state, activeSeat) : []),
    [state, activeSeat],
  );

  function pushLog(lines: string[]) {
    if (lines.length === 0) return;
    setLog((prev) => [...lines, ...prev].slice(0, 40));
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
          hiddenOkr: false,
          continuousSprint: false,
        },
      },
      seed: Date.now() % 1_000_000,
    });
    setState(game);
    setActiveSeat(game.playerOrder[0]!);
    setScreen("play");
    setLog([
      `对局开始 · 规则 ${RULES_VERSION} · ${playerCount} 人 · 事件+互动`,
      `座位：${game.players.map((p) => p.displayName).join("、")}`,
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
    commit(draft, [
      `演示：跨线补开 — 由 ${first} 推进进度`,
      ...result.events,
    ]);
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

  if (screen === "setup") {
    return (
      <main className="shell">
        <header className="hero">
          <p className="eyebrow">Requirement Storm</p>
          <h1>需求风暴</h1>
          <p className="lede">事件 + 互动 · 本地多座位 · 规则 {RULES_VERSION}</p>
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
                  {n} 人
                </option>
              ))}
            </select>
          </label>
          <div className="rules-box">
            <div>规则版本：<strong>{RULES_VERSION}</strong></div>
            <div>模块：暗标 · 事件牌 · 互动卡 C-12～C-14</div>
            <div>模式：本机多座位（非联机大厅）</div>
            <div className="muted">座位展示名示例：座位 1 / 产品</div>
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
  const currentPlayer = state.players.find((p) => p.id === currentPlayerId);
  const eventDef = state.currentEventId ? getEventCard(state.currentEventId) : null;
  const queuedCrossCount = state.pendingPerformanceSettlementQueue.length;

  return (
    <main className="shell play">
      <header className="bar">
        <div>
          <strong>需求风暴</strong>
          <span className="muted"> · {RULES_VERSION}</span>
        </div>
        <div className="muted">
          R{state.round} · S{state.season} · 进度 {state.progress}/{state.totalProgressTarget}
          {state.publicDebt > 0 ? ` · 公共债 ${state.publicDebt}` : ""}
        </div>
        <button type="button" className="ghost" onClick={() => setScreen("setup")}>
          回开局
        </button>
      </header>

      <section className="phases" aria-label="回合阶段">
        {PHASES.map((phase) => (
          <div
            key={phase}
            className={`phase ${state.turnPhase === phase ? "active" : ""}`}
          >
            {PHASE_LABEL[phase]}
          </div>
        ))}
      </section>

      <section className="status">
        <p>
          当前该谁：<strong>{currentPlayer?.displayName ?? "—"}</strong>
          {activeSeat === currentPlayerId ? "（正是你操作的座位）" : ""}
        </p>
        <p className="muted">
          事件：
          {!state.eventFlippedThisRound
            ? "尚未翻开（必须先翻 1 张，才能抽卡/互动）"
            : `${state.currentEventId} ${eventDef?.name ?? ""} — ${eventDef?.effectText ?? ""}`}
        </p>
        <p className="muted">
          你能做什么：
          {interaction?.type === "C14"
            ? "必须响应 C-14，不能跳过"
            : interaction?.type === "C13_WINDOW"
              ? queuedCrossCount > 0
                ? `跨线后 C-13 窗：可抢功或弃权（绩效尚未结算；另有 ${queuedCrossCount} 条排队）`
                : "跨线后 C-13 窗：可抢功或弃权（绩效尚未结算）"
              : pending && !pending.resolved
                ? pending.isCatchUp
                  ? "必须补开暗标，不能跳过；结算已挂起"
                  : "先完成暗标出价，才能继续"
                : !state.eventFlippedThisRound
                  ? "先翻本 Round 事件牌"
                  : `${PHASE_LABEL[state.turnPhase]}阶段可用动作见下方`}
        </p>
      </section>

      {!state.eventFlippedThisRound && (
        <section className="interrupt event-gate" role="alertdialog" aria-label="翻事件">
          <h2>必须翻 1 张事件牌</h2>
          <p>本 Round 开始尚未翻事件；翻开前不能进入抽卡/互动。</p>
        </section>
      )}

      {interaction?.type === "C14" && (
        <section className="interrupt" role="alertdialog" aria-label="C-14 响应">
          <h2>必须响应 C-14，不能跳过</h2>
          <p>
            {seatLabel(state, interaction.sourceId)} 的 {interaction.sourceCardId} 针对{" "}
            <strong>{seatLabel(state, interaction.targetId)}</strong>
            。被针对者须打出 C-14 或放弃以关闭窗口，然后才结算。
          </p>
        </section>
      )}

      {interaction?.type === "C13_WINDOW" && (
        <section className="interrupt c13" role="alertdialog" aria-label="C-13 窗">
          <h2>跨线 C-13 窗（绩效挂起）</h2>
          <p>
            里程碑 <strong>{interaction.milestoneId}</strong> 突破者{" "}
            <strong>{seatLabel(state, interaction.breakerId)}</strong>
            。可打 C-13（蹭协作者 / 截 1 绩效）或弃权；全员弃权后结算绩效。
            {queuedCrossCount > 0
              ? ` 另有 ${queuedCrossCount} 条跨线排队，本线结算后继续开窗。`
              : ""}
          </p>
        </section>
      )}

      {pending && !pending.resolved && (
        <section className="interrupt" role="alertdialog" aria-label="强制暗标">
          <h2>{pending.isCatchUp ? "必须补开，不能跳过" : "暗标冲刺"}</h2>
          <p>
            里程碑 <strong>{pending.milestoneId}</strong>
            {pending.isCatchUp
              ? "：未进冲刺区却将跨线，结算前强制补开暗标。"
              : "：已进入冲刺区，请提交暗标。"}
          </p>
          {state.pendingProgressSettlement && (
            <p className="warn">
              进度结算已挂起（+{state.pendingProgressSettlement.progressGain}），全员出价前不会结算。
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
        </section>
      )}

      <section className="seats">
        <h2>座位（本机切换）</h2>
        <div className="seat-row">
          {state.players.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`seat ${activeSeat === p.id ? "active" : ""}`}
              onClick={() => setActiveSeat(p.id)}
            >
              {p.displayName}
              {p.id === currentPlayerId ? " · 当前" : ""}
            </button>
          ))}
        </div>
        <p className="muted">
          操作中：{activePlayer.displayName} · 手牌 {activePlayer.hand.length} · 工时{" "}
          {activePlayer.workHoursRemaining}/{activePlayer.workHoursBudget} · 绩效{" "}
          {activePlayer.performance} · 个人债 {activePlayer.personalDebt} · Bug{" "}
          {activePlayer.personalBugs}
        </p>
        {state.turnPhase === "execute" && activeSeat === currentPlayerId && (
          <ul className="hand">
            {activePlayer.hand.map((cardId, index) => {
              const card = getActionCard(cardId);
              return (
                <li key={`${cardId}-${index}`}>
                  {card ? `${card.id} ${card.name}（${card.workHours}h）` : cardId}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="actions">
        <h2>动作</h2>
        {error && <p className="error">{error}</p>}
        <div className="action-list">
          {legal.map((item, index) => (
            <button
              key={`${item.label}-${index}`}
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
        <div className="demo-row">
          <button type="button" className="demo" onClick={runFlipEventDemo}>
            演示：翻事件（E-04）
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
        </div>
      </section>

      <section className="log">
        <h2>日志</h2>
        <ul>
          {log.map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
