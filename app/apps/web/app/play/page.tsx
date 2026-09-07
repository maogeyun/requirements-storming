"use client";

import { getActionCard } from "@rs/game-data";
import {
  applyAction,
  createGame,
  forceCatchUpProgressAttempt,
  getCurrentPlayerId,
  listLegalActions,
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
    actionDeck: [...state.actionDeck],
    actionDiscard: [...state.actionDiscard],
    eventDeck: [...state.eventDeck],
    eventDiscard: [...state.eventDiscard],
    roundContributors: new Set(state.roundContributors),
    pendingInteraction: state.pendingInteraction
      ? { ...state.pendingInteraction }
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
  const [playerCount, setPlayerCount] = useState(3);
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
          interactionCards: false,
          hiddenOkr: false,
          continuousSprint: false,
        },
      },
      seed: Date.now() % 1_000_000,
    });
    setState(game);
    setActiveSeat(game.playerOrder[0]!);
    setScreen("play");
    setLog([`对局开始 · 规则 ${RULES_VERSION} · ${playerCount} 人`]);
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
    // Ensure we are in execute as p1 for the demo
    draft.currentPlayerIndex = 0;
    const result = forceCatchUpProgressAttempt(draft, "p1", 25);
    setActiveSeat("p1");
    commit(draft, result.events);
  }

  if (screen === "setup") {
    return (
      <main className="shell">
        <header className="hero">
          <p className="eyebrow">Requirement Storm</p>
          <h1>需求风暴</h1>
          <p className="lede">M1 最小可玩壳 · 本地多座位 · 规则 {RULES_VERSION}</p>
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
            <div>模块：暗标冲刺（FIX-01 / 跨线补开）</div>
            <div>模式：本机多座位（非联机大厅）</div>
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
  const activePlayer = state.players.find((p) => p.id === activeSeat)!;
  const currentPlayer = state.players.find((p) => p.id === currentPlayerId);

  return (
    <main className="shell play">
      <header className="bar">
        <div>
          <strong>需求风暴</strong>
          <span className="muted"> · {RULES_VERSION}</span>
        </div>
        <div className="muted">
          R{state.round} · S{state.season} · 进度 {state.progress}/{state.totalProgressTarget}
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
          当前该谁：<strong>{currentPlayer?.name ?? "—"}</strong>
          {activeSeat === currentPlayerId ? "（正是你操作的座位）" : ""}
        </p>
        <p className="muted">
          你能做什么：
          {pending && !pending.resolved
            ? pending.isCatchUp
              ? "必须补开暗标，不能跳过；结算已挂起"
              : "先完成暗标出价，才能继续"
            : `${PHASE_LABEL[state.turnPhase]}阶段可用动作见下方`}
        </p>
      </section>

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
                  const name = state.players.find((p) => p.id === id)?.name ?? id;
                  return `${name}${id in pending.bids ? "✓" : "…"}`;
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
              {p.name}
              {p.id === currentPlayerId ? " · 当前" : ""}
            </button>
          ))}
        </div>
        <p className="muted">
          操作中：{activePlayer.name} · 手牌 {activePlayer.hand.length} · 工时{" "}
          {activePlayer.workHoursRemaining}/{activePlayer.workHoursBudget} · 绩效{" "}
          {activePlayer.performance}
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
        <button type="button" className="demo" onClick={runCatchUpDemo}>
          演示：跨线补开（进度22 +25）
        </button>
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
