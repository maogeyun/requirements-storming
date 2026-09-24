"use client";

import type {
  ForceWindow,
  GameAction,
  LegalAction,
  PlayerView,
  ServerMessage,
} from "@rs/shared";
import { DISCONNECT_GRACE_MS } from "@rs/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CoachTip } from "../../coach-tip";
import { MatchClient } from "../../../lib/match-client";
import {
  allowSoftTipsNow,
  coachContextFromOnline,
} from "../../../lib/onboarding";
import {
  DISCONNECT_HOSTED_HINT,
  DISCONNECT_RECLAIM_TOAST,
  disconnectTopBar,
} from "../../../lib/online-disconnect-copy";
import {
  anchorDisconnectGraceDeadline,
  disconnectDisplayFromPresence,
  graceSecondsLeft,
  syncDisplayDeadlineFromServerRemaining,
} from "../../../lib/online-disconnect-grace";
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

type DisconnectUi = "ok" | "grace" | "hosted";

export default function OnlinePlayPage() {
  const router = useRouter();
  const [view, setView] = useState<PlayerView | null>(null);
  const [legal, setLegal] = useState<LegalAction[]>([]);
  const [seatId, setSeatId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<string>("connecting");
  const [disconnectUi, setDisconnectUi] = useState<DisconnectUi>("ok");
  const [graceLeftSec, setGraceLeftSec] = useState(
    () => Math.ceil(DISCONNECT_GRACE_MS / 1000),
  );
  const [toast, setToast] = useState<string | null>(null);
  const [forceWindow, setForceWindow] = useState<ForceWindow | null>(null);
  const [allowSoftTips, setAllowSoftTips] = useState(false);
  const clientRef = useRef<MatchClient | null>(null);
  const intentionalCloseRef = useRef(false);
  const hasViewRef = useRef(false);
  const graceDeadlineRef = useRef<number | null>(null);
  const handRef = useRef<HTMLElement | null>(null);
  const forceRef = useRef<HTMLElement | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setAllowSoftTips(allowSoftTipsNow());
  }, []);

  useEffect(() => {
    const session = loadOnlineSession();
    if (!session) {
      setError("没有联机会话，请从大厅重新进入");
      setPhase("error");
      return;
    }
    const activeSession = session;

    function clearReconnectLoop(): void {
      if (reconnectTimerRef.current != null) {
        clearInterval(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function beginLocalDisconnectGrace(): void {
      const now = Date.now();
      // Display-only fallback while offline. Server grace is authoritative;
      // never reset/fake-extend on repeated reconnect onClose (JOJO P2).
      const deadline = anchorDisconnectGraceDeadline(
        graceDeadlineRef.current,
        now,
      );
      graceDeadlineRef.current = deadline;
      const left = graceSecondsLeft(deadline, now);
      if (left <= 0) {
        setGraceLeftSec(0);
        setDisconnectUi("hosted");
        return;
      }
      setDisconnectUi("grace");
      setGraceLeftSec(left);
    }

    function focusPlaySurface(): void {
      const target = forceRef.current ?? handRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    }

    function joinWithSession(client: MatchClient): void {
      client.send({
        type: "join",
        mode: "join",
        roomCode: activeSession.roomCode,
        displayName: activeSession.displayName,
        seatToken: activeSession.seatToken,
        seatCount: 4,
      });
    }

    const client = new MatchClient({
      onMessage: (message: ServerMessage) => {
        if (message.type === "error") {
          setError(message.error.message);
          return;
        }
        if (message.type === "force") {
          setForceWindow(message.window);
          return;
        }
        if (message.type !== "view") return;

        setSeatId(message.seatId);
        setRoomCode(message.roomCode);
        setPhase(message.phase);
        clearReconnectLoop();

        if (message.phase === "lobby" && message.lobby) {
          // Rare: reconnect before start — bounce back to lobby wait
          graceDeadlineRef.current = null;
          setDisconnectUi("ok");
          router.replace(`/lobby?mode=join&code=${message.roomCode}`);
          return;
        }

        if (message.view) {
          hasViewRef.current = true;
          setView(message.view);
        }
        setLegal(message.legalActions ?? []);

        // Server presence wins the bar; local deadline is only an offline paint.
        const display = disconnectDisplayFromPresence(
          message.presence?.[message.seatId],
        );
        if (display.kind === "grace") {
          graceDeadlineRef.current = syncDisplayDeadlineFromServerRemaining(
            display.remainingSec,
            Date.now(),
          );
          setDisconnectUi("grace");
          setGraceLeftSec(display.remainingSec);
        } else if (display.kind === "hosted") {
          graceDeadlineRef.current = null;
          setDisconnectUi("hosted");
        } else {
          // Reconnected / reclaimed — end disconnect episode
          graceDeadlineRef.current = null;
          setDisconnectUi("ok");
        }

        if (message.reclaimed) {
          setToast(DISCONNECT_RECLAIM_TOAST);
          // Focus hand / forced window after reclaim
          requestAnimationFrame(() => focusPlaySurface());
        }
      },
      onOpen: () => {
        joinWithSession(client);
      },
      onClose: () => {
        if (intentionalCloseRef.current) return;
        beginLocalDisconnectGrace();
        if (reconnectTimerRef.current == null) {
          reconnectTimerRef.current = setInterval(() => {
            if (intentionalCloseRef.current) return;
            if (client.ready) return;
            client.connect();
          }, 2000);
        }
      },
      onError: () => {
        if (intentionalCloseRef.current) return;
        // Prefer top-bar UX over scary full-screen; soft status only before first view
        if (!hasViewRef.current) setError("连接中断");
      },
    });
    clientRef.current = client;
    client.connect();

    return () => {
      intentionalCloseRef.current = true;
      clearReconnectLoop();
      client.close();
      clientRef.current = null;
    };
  }, [router]);

  // Display-only countdown while offline (server grace remains authoritative).
  useEffect(() => {
    if (disconnectUi !== "grace") return;
    const id = setInterval(() => {
      const deadline = graceDeadlineRef.current;
      if (deadline == null) return;
      const left = graceSecondsLeft(deadline, Date.now());
      setGraceLeftSec(left);
      if (left <= 0) {
        setDisconnectUi("hosted");
      }
    }, 250);
    return () => clearInterval(id);
  }, [disconnectUi]);

  // Auto-dismiss reclaim toast
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(id);
  }, [toast]);

  function sendIntent(action: GameAction): void {
    setError(null);
    clientRef.current?.send({ type: "intent", action });
  }

  function leave(): void {
    intentionalCloseRef.current = true;
    clientRef.current?.send({ type: "leave" });
    clientRef.current?.close();
    clearOnlineSession();
    router.replace("/");
  }

  const coachCtx = useMemo(
    () =>
      coachContextFromOnline({
        allowSoft: allowSoftTips,
        inMatchQueue: false,
        gameOver: Boolean(view?.gameOver),
        disconnectBar: disconnectUi === "grace",
        graceSec: graceLeftSec,
        forceKind:
          forceWindow?.kind === "dark_bid" ||
          forceWindow?.kind === "c14" ||
          forceWindow?.kind === "c13"
            ? forceWindow.kind
            : null,
        ownTurn: Boolean(
          view?.currentPlayerId &&
            (seatId ?? view.selfId) &&
            view.currentPlayerId === (seatId ?? view.selfId),
        ),
      }),
    [allowSoftTips, view, disconnectUi, graceLeftSec, forceWindow, seatId],
  );

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
      {disconnectUi === "grace" ? (
        <div className="online-disconnect-bar" role="status">
          {disconnectTopBar(graceLeftSec)}
        </div>
      ) : null}
      <CoachTip ctx={coachCtx} />

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

      {disconnectUi === "hosted" ? (
        <p className="online-hosted-hint" role="status">
          {DISCONNECT_HOSTED_HINT}
        </p>
      ) : null}

      {toast ? (
        <p className="online-reclaim-toast" role="status">
          {toast}
        </p>
      ) : null}

      {error && disconnectUi === "ok" ? (
        <p className="inline-error">{error}</p>
      ) : null}

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

        {forceWindow ? (
          <section
            ref={forceRef}
            className="online-force"
            tabIndex={-1}
            aria-label="强制响应窗"
          >
            <p className="muted">强制窗 · {forceWindow.kind}</p>
          </section>
        ) : null}

        <section
          ref={handRef}
          className="online-hand"
          aria-label="本座手牌"
          tabIndex={-1}
        >
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
