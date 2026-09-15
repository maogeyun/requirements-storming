"use client";

import type { LobbyState, ServerMessage } from "@rs/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  FREE_MATCH_QUEUE_SUB,
  freeMatchQueueMain,
} from "../../lib/lobby-copy";
import { MatchClient } from "../../lib/match-client";
import { saveOnlineSession } from "../../lib/online-session";
import { LobbySeatRing, lobbyFromPartial } from "./seat-ring";

type LobbyMode = "create" | "join" | "match";

function parseMode(raw: string | null): LobbyMode | null {
  if (raw === "create" || raw === "join" || raw === "match") return raw;
  return null;
}

function LobbyShellInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = parseMode(searchParams.get("mode"));

  const [displayName, setDisplayName] = useState("玩家");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "lobby" | "queue">(
    "idle",
  );
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [queueStartedAt, setQueueStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const clientRef = useRef<MatchClient | null>(null);
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;

  const waitedSeconds = useMemo(() => {
    if (queueStartedAt == null) return 0;
    return Math.floor((now - queueStartedAt) / 1000);
  }, [now, queueStartedAt]);

  useEffect(() => {
    if (status !== "queue" || queueStartedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status, queueStartedAt]);

  useEffect(() => {
    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  function handleServerMessage(message: ServerMessage): void {
    if (message.type === "error") {
      const code = message.error.code;
      if (code === "ROOM_FULL") {
        setInlineError("房间已满");
      } else if (code === "PLAYER_NOT_FOUND") {
        setInlineError("房间不存在或房间码错误");
      } else {
        setInlineError(message.error.message || "无法加入");
      }
      setStatus((prev) => (prev === "queue" || prev === "connecting" ? "idle" : prev));
      setQueueStartedAt(null);
      return;
    }

    if (message.type !== "view") return;

    saveOnlineSession({
      roomCode: message.roomCode,
      seatId: message.seatId,
      seatToken: message.seatToken,
      displayName: displayNameRef.current.trim() || "玩家",
    });
    setSelfId(message.seatId);
    setInlineError(null);

    if (message.phase === "lobby" && message.lobby) {
      setLobby(message.lobby);
      setStatus("lobby");
      setQueueStartedAt(null);
      return;
    }

    if (message.phase === "playing" || message.phase === "finished") {
      setLobby(null);
      setQueueStartedAt(null);
      router.replace("/play/online");
    }
  }

  function connectAndSend(build: () => Parameters<MatchClient["send"]>[0]): void {
    clientRef.current?.close();
    const client = new MatchClient({
      onMessage: handleServerMessage,
      onOpen: () => client.send(build()),
      onError: () => {
        setInlineError("无法连接匹配服务");
        setStatus("idle");
        setQueueStartedAt(null);
      },
    });
    clientRef.current = client;
    client.connect();
  }

  function startCreate(): void {
    setInlineError(null);
    setStatus("connecting");
    const name = displayName.trim() || "玩家";
    connectAndSend(() => ({
      type: "join",
      mode: "create",
      displayName: name,
      seatCount: 4,
    }));
  }

  function startJoin(): void {
    setInlineError(null);
    const code = roomCodeInput.trim().toUpperCase();
    if (!code) {
      setInlineError("请输入房间码");
      return;
    }
    setStatus("connecting");
    const name = displayName.trim() || "玩家";
    connectAndSend(() => ({
      type: "join",
      mode: "join",
      roomCode: code,
      displayName: name,
      seatCount: 4,
    }));
  }

  function startMatch(): void {
    setInlineError(null);
    setStatus("queue");
    setQueueStartedAt(Date.now());
    setNow(Date.now());
    const name = displayName.trim() || "玩家";
    connectAndSend(() => ({
      type: "join",
      mode: "match",
      displayName: name,
      seatCount: 4,
    }));
  }

  function cancelQueueOrLeave(): void {
    clientRef.current?.send({ type: "leave" });
    clientRef.current?.close();
    clientRef.current = null;
    setStatus("idle");
    setLobby(null);
    setQueueStartedAt(null);
    setSelfId(null);
  }

  if (!mode) {
    return (
      <main className="shell lobby-shell">
        <p className="inline-error">未知入口</p>
        <Link href="/">返回大厅</Link>
      </main>
    );
  }

  const ring = lobbyFromPartial(lobby);
  const showForm =
    status === "idle" || (status === "connecting" && !lobby && mode !== "match");

  return (
    <main className="shell lobby-shell">
      <header className="lobby-header">
        <p className="eyebrow">Requirement Storm</p>
        <h1>需求风暴</h1>
        <p className="lede">
          {mode === "create" && "联机 · 建房"}
          {mode === "join" && "联机 · 加入"}
          {mode === "match" && "自由匹配"}
        </p>
      </header>

      {status === "queue" ? (
        <section className="match-queue" aria-live="polite">
          <p className="match-queue-main">{freeMatchQueueMain(waitedSeconds)}</p>
          <p className="match-queue-sub">{FREE_MATCH_QUEUE_SUB}</p>
          <button type="button" className="ghost" onClick={cancelQueueOrLeave}>
            取消
          </button>
          {inlineError ? <p className="inline-error">{inlineError}</p> : null}
        </section>
      ) : null}

      {status === "lobby" && lobby ? (
        <section className="lobby-waiting">
          <LobbySeatRing
            seatCount={ring.seatCount}
            players={ring.players}
            selfId={selfId}
            roomCode={ring.roomCode}
          />
          <button type="button" className="ghost" onClick={cancelQueueOrLeave}>
            离开房间
          </button>
        </section>
      ) : null}

      {showForm ? (
        <section className="lobby-form setup">
          <label className="field">
            <span>昵称</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={12}
              autoComplete="nickname"
            />
          </label>

          {mode === "join" ? (
            <label className="field">
              <span>房间码</span>
              <input
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                maxLength={8}
                placeholder="例如 AB3K7"
                autoCapitalize="characters"
              />
            </label>
          ) : null}

          {inlineError ? <p className="inline-error">{inlineError}</p> : null}

          <div className="lobby-actions">
            {mode === "create" ? (
              <button
                type="button"
                className="primary"
                disabled={status === "connecting"}
                onClick={startCreate}
              >
                {status === "connecting" ? "创建中…" : "创建房间"}
              </button>
            ) : null}
            {mode === "join" ? (
              <button
                type="button"
                className="primary"
                disabled={status === "connecting"}
                onClick={startJoin}
              >
                {status === "connecting" ? "加入中…" : "加入房间"}
              </button>
            ) : null}
            {mode === "match" ? (
              <button type="button" className="primary" onClick={startMatch}>
                开始匹配
              </button>
            ) : null}
            <Link className="muted" href="/">
              返回
            </Link>
          </div>
        </section>
      ) : null}
    </main>
  );
}

export default function LobbyPage() {
  return (
    <Suspense
      fallback={
        <main className="shell lobby-shell">
          <p className="muted">加载中…</p>
        </main>
      }
    >
      <LobbyShellInner />
    </Suspense>
  );
}
