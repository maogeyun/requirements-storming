"use client";

import type {
  GameAction,
  LegalAction,
  PlayerView,
  ServerMessage,
} from "@rs/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MatchClient } from "../../../lib/match-client";
import {
  clearOnlineSession,
  loadOnlineSession,
} from "../../../lib/online-session";

function playerLabel(
  entry: PlayerView["players"][number],
): string {
  if (entry.isSelf) return entry.displayName;
  return entry.displayName;
}

export default function OnlinePlayPage() {
  const router = useRouter();
  const [view, setView] = useState<PlayerView | null>(null);
  const [legal, setLegal] = useState<LegalAction[]>([]);
  const [seatId, setSeatId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<string>("connecting");
  const clientRef = useRef<MatchClient | null>(null);

  useEffect(() => {
    const session = loadOnlineSession();
    if (!session) {
      setError("没有联机会话，请从大厅重新进入");
      setPhase("error");
      return;
    }

    const client = new MatchClient({
      onMessage: (message: ServerMessage) => {
        if (message.type === "error") {
          setError(message.error.message);
          return;
        }
        if (message.type === "force") {
          // Force windows are also reflected in legalActions on view; keep light.
          return;
        }
        if (message.type !== "view") return;

        setSeatId(message.seatId);
        setRoomCode(message.roomCode);
        setPhase(message.phase);

        if (message.phase === "lobby" && message.lobby) {
          // Rare: reconnect before start — bounce back to lobby wait
          router.replace(`/lobby?mode=join&code=${message.roomCode}`);
          return;
        }

        if (message.view) {
          setView(message.view);
        }
        setLegal(message.legalActions ?? []);
      },
      onOpen: () => {
        client.send({
          type: "join",
          mode: "join",
          roomCode: session.roomCode,
          displayName: session.displayName,
          seatToken: session.seatToken,
          seatCount: 4,
        });
      },
      onError: () => setError("连接中断"),
    });
    clientRef.current = client;
    client.connect();

    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [router]);

  function sendIntent(action: GameAction): void {
    setError(null);
    clientRef.current?.send({ type: "intent", action });
  }

  function leave(): void {
    clientRef.current?.send({ type: "leave" });
    clientRef.current?.close();
    clearOnlineSession();
    router.replace("/");
  }

  if (phase === "error" && !view) {
    return (
      <main className="shell online-play">
        <p className="inline-error">{error ?? "无法进入对局"}</p>
        <Link href="/">返回大厅</Link>
      </main>
    );
  }

  const self = view?.players.find((p) => p.isSelf);
  const others = view?.players.filter((p) => !p.isSelf) ?? [];
  const enabled = legal.filter((item) => item.enabled);

  return (
    <main className="online-play table-shell">
      <header className="online-play-bar">
        <div>
          <p className="eyebrow">联机桌</p>
          <p className="online-room">
            {roomCode ? `房间 ${roomCode}` : "连接中…"}
            {seatId ? ` · ${seatId}` : ""}
          </p>
        </div>
        <button type="button" className="ghost" onClick={leave}>
          离开
        </button>
      </header>

      {error ? <p className="inline-error">{error}</p> : null}

      <div className="card-table online-table">
        <ul className="online-opponents" aria-label="其他座位">
          {others.map((p) => (
            <li key={p.id} className="seat-chip ring-seat">
              <span className="seat-name">{playerLabel(p)}</span>
              <span className="seat-meta">
                绩效 {p.performance} · 手牌 {p.handCount}
              </span>
            </li>
          ))}
        </ul>

        <section className="stage-card online-stage">
          {view ? (
            <>
              <p>
                Sprint {view.sprint} · 进度 {view.progress}/{view.totalProgressTarget}
              </p>
              <p className="muted">
                阶段 {view.turnPhase}
                {view.currentPlayerId
                  ? ` · 当前 ${
                      view.players.find((p) => p.id === view.currentPlayerId)
                        ?.displayName ?? view.currentPlayerId
                    }`
                  : ""}
              </p>
              {view.gameOver ? (
                <p className="online-over">
                  终局
                  {view.winnerId
                    ? ` · ${
                        view.players.find((p) => p.id === view.winnerId)
                          ?.displayName ?? ""
                      }`
                    : ""}
                </p>
              ) : null}
            </>
          ) : (
            <p className="muted">同步座位视图…</p>
          )}
        </section>

        <section className="online-hand" aria-label="本座手牌">
          <h2>{self ? self.displayName : "本座"}</h2>
          {self && "hand" in self ? (
            <ul className="online-hand-list">
              {self.hand.map((cardId) => (
                <li key={cardId} className="online-hand-card">
                  {cardId}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">等待手牌…</p>
          )}
          {self ? (
            <p className="muted">
              工时 {self.workHoursRemaining} · 绩效 {self.performance}
            </p>
          ) : null}
        </section>
      </div>

      <section className="online-intents" aria-label="可用意图">
        {enabled.length === 0 ? (
          <p className="muted">暂无可用动作</p>
        ) : (
          <ul className="online-intent-list">
            {enabled.map((item, index) => (
              <li key={`${item.action.type}-${index}`}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => sendIntent(item.action)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
