import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@rs/shared";
import { ErrorCode } from "@rs/shared";
import { createFakeClock } from "./clock";
import { leaksBotMarker, pickFakeDisplayNames } from "./fake-names";
import { isLegalIntent } from "./intent";
import { MatchHub } from "./match-hub";
import { MatchRoom, REQUIRED_SEAT_COUNT } from "./match-room";
import { getForceWindowForSeat, getPlayerView } from "./player-view";
import { applyAction, createGame, forceCatchUpProgressAttempt, listLegalActions } from "@rs/rules-engine";

function collectEmit() {
  const inbox = new Map<string, ServerMessage[]>();
  const emit = (connectionId: string, message: ServerMessage) => {
    const list = inbox.get(connectionId) ?? [];
    list.push(message);
    inbox.set(connectionId, list);
  };
  return { inbox, emit };
}

function fillRoom(room: MatchRoom, names = ["A", "B", "C", "D"]): void {
  names.forEach((name, i) => {
    room.handleMessage(`c${i + 1}`, {
      type: "join",
      mode: i === 0 ? "create" : "join",
      roomCode: room.roomCode,
      displayName: name,
    });
  });
}

describe("isLegalIntent", () => {
  it("accepts enabled FLIP_EVENT and rejects disabled", () => {
    const state = createGame({ playerNames: ["A", "B"], seed: 1 });
    const legal = listLegalActions(state, "p1");
    expect(isLegalIntent(legal, { type: "FLIP_EVENT" })).toBe(true);
    expect(isLegalIntent(legal, { type: "DRAW_TO_HAND_LIMIT" })).toBe(false);
  });

  it("matches SUBMIT_DARK_BID ignoring placeholder amount", () => {
    const state = createGame({
      playerNames: ["A", "B", "C", "D"],
      seed: 77,
      config: {
        modules: {
          darkBid: true,
          interactionCards: true,
          hiddenOkr: true,
          continuousSprint: true,
        },
      },
    });
    forceCatchUpProgressAttempt(state, "p1", 25);
    expect(state.pendingDarkBid && !state.pendingDarkBid.resolved).toBe(true);
    const legal = listLegalActions(state, "p2");
    expect(
      isLegalIntent(legal, { type: "SUBMIT_DARK_BID", playerId: "p2", amount: 4 }),
    ).toBe(true);
  });
});

describe("getPlayerView seat scoping", () => {
  it("strips other seats' hands and OKR before reveal", () => {
    const state = createGame({ playerNames: ["A", "B"], seed: 3 });
    state.players[0]!.hand = ["S-01", "S-02"];
    state.players[1]!.hand = ["C-01"];
    state.players[0]!.okrId = "O-01";
    state.players[1]!.okrId = "O-02";
    state.okrRevealed = false;

    const view = getPlayerView(state, "p1", "ROOM", "playing");
    const self = view.players.find((p) => p.id === "p1");
    const other = view.players.find((p) => p.id === "p2");
    expect(self && "hand" in self && self.hand).toEqual(["S-01", "S-02"]);
    expect(self && "okrId" in self && self.okrId).toBe("O-01");
    expect(other && other.isSelf === false && other.handCount).toBe(1);
    expect(other && "hand" in other).toBe(false);
    expect(other && other.isSelf === false && other.okrId).toBeNull();
    expect(other && other.isSelf === false && other.performance).toBe(
      state.players[1]!.performance,
    );
  });
});

describe("MatchRoom full-4 start lock", () => {
  it("stays in lobby under 4 and rejects host tryStartGame", () => {
    const { inbox, emit } = collectEmit();
    const room = new MatchRoom({ roomCode: "WAIT", seed: 1, emit });

    room.handleMessage("c1", {
      type: "join",
      mode: "create",
      displayName: "Host",
    });
    room.handleMessage("c2", {
      type: "join",
      mode: "join",
      roomCode: "WAIT",
      displayName: "B",
    });
    expect(room.phase).toBe("lobby");
    expect(room.seats).toHaveLength(2);

    inbox.clear();
    expect(room.tryStartGame("c1")).toBe(false);
    expect(room.phase).toBe("lobby");
    const err = (inbox.get("c1") ?? []).find((m) => m.type === "error");
    expect(err?.type === "error" && err.error.code).toBe(ErrorCode.INSUFFICIENT_PLAYERS);
  });

  it("rejects seatCount other than 4", () => {
    const { inbox, emit } = collectEmit();
    const room = new MatchRoom({ roomCode: "BAD", seed: 1, emit });
    room.handleMessage("c1", {
      type: "join",
      mode: "create",
      displayName: "Host",
      seatCount: 2,
    });
    expect(room.seats).toHaveLength(0);
    const err = (inbox.get("c1") ?? []).find((m) => m.type === "error");
    expect(err?.type === "error" && err.error.code).toBe(ErrorCode.INVALID_MESSAGE);
  });

  it("starts only when seated count === 4", () => {
    const { emit } = collectEmit();
    const room = new MatchRoom({ roomCode: "FULL", seed: 42, emit });
    fillRoom(room);
    expect(room.seatCount).toBe(REQUIRED_SEAT_COUNT);
    expect(room.phase).toBe("playing");
    expect(room.gameState?.players).toHaveLength(4);
  });
});

describe("MatchRoom intent validation", () => {
  it("rejects illegal intent and accepts legal FLIP_EVENT", () => {
    const { inbox, emit } = collectEmit();
    const room = new MatchRoom({
      roomCode: "TEST1",
      seed: 42,
      emit,
    });
    fillRoom(room, ["Alice", "Bob", "Carol", "Dave"]);

    expect(room.phase).toBe("playing");
    expect(room.gameState).not.toBeNull();

    inbox.clear();

    // p2 cannot flip while p1 is current
    room.handleMessage("c2", { type: "intent", action: { type: "FLIP_EVENT" } });
    const rejected = inbox.get("c2") ?? [];
    expect(rejected.some((m) => m.type === "error")).toBe(true);
    const err = rejected.find((m) => m.type === "error");
    expect(err?.type === "error" && err.error.code).toBe(ErrorCode.INVALID_ACTION);
    expect(room.gameState!.eventFlippedThisRound).toBe(false);

    inbox.clear();

    room.handleMessage("c1", { type: "intent", action: { type: "FLIP_EVENT" } });
    expect(room.gameState!.eventFlippedThisRound).toBe(true);
    const forP1 = inbox.get("c1") ?? [];
    const forP2 = inbox.get("c2") ?? [];
    expect(forP1.some((m) => m.type === "view")).toBe(true);
    expect(forP2.some((m) => m.type === "view")).toBe(true);

    const p2View = forP2.find((m) => m.type === "view");
    if (p2View?.type === "view" && p2View.view) {
      const other = p2View.view.players.find((p) => p.id === "p1");
      expect(other && "hand" in other).toBe(false);
    }
  });

  it("pushes force window on catch-up dark bid", () => {
    const { inbox, emit } = collectEmit();
    const room = new MatchRoom({
      roomCode: "FORCE",
      seed: 77,
      emit,
    });
    fillRoom(room);

    expect(room.phase).toBe("playing");
    room.gameState!.config.modules.continuousSprint = true;
    forceCatchUpProgressAttempt(room.gameState!, "p1", 25);
    expect(room.gameState!.pendingDarkBid).not.toBeNull();

    inbox.clear();
    room.handleMessage("c1", { type: "resync" });
    room.handleMessage("c2", { type: "resync" });

    const forceP2 = (inbox.get("c2") ?? []).find((m) => m.type === "force");
    expect(forceP2?.type === "force" && forceP2.window.kind).toBe("dark_bid");

    const forSeat = getForceWindowForSeat(room.gameState!, "p2");
    expect(forSeat?.kind).toBe("dark_bid");
  });
});

describe("MatchHub create/join", () => {
  it("creates a room and starts only after the 4th join", () => {
    const { inbox, emit } = collectEmit();
    const hub = new MatchHub(emit, { seed: 99 });

    hub.handleMessage(
      "c1",
      JSON.stringify({
        type: "join",
        mode: "create",
        displayName: "Host",
      }),
    );

    const hostMsgs = inbox.get("c1") ?? [];
    const hostView = hostMsgs.find((m) => m.type === "view");
    expect(hostView?.type).toBe("view");
    if (hostView?.type !== "view") return;
    const code = hostView.roomCode;
    expect(code.length).toBeGreaterThanOrEqual(4);
    expect(hub.rooms.get(code)?.phase).toBe("lobby");

    hub.handleMessage(
      "c2",
      JSON.stringify({
        type: "join",
        mode: "join",
        roomCode: code,
        displayName: "B",
      }),
    );
    expect(hub.rooms.get(code)?.phase).toBe("lobby");

    hub.handleMessage(
      "c3",
      JSON.stringify({
        type: "join",
        mode: "join",
        roomCode: code,
        displayName: "C",
      }),
    );
    hub.handleMessage(
      "c4",
      JSON.stringify({
        type: "join",
        mode: "join",
        roomCode: code,
        displayName: "D",
      }),
    );

    const room = hub.rooms.get(code);
    expect(room?.phase).toBe("playing");
    expect(room?.seats).toHaveLength(4);
  });
});

describe("MatchHub free-match silent Bot fill", () => {
  it("stays unmatched under 4 humans before 60s (lobby not opened)", () => {
    const { inbox, emit } = collectEmit();
    const clock = createFakeClock();
    const hub = new MatchHub(emit, { seed: 7, clock, botFillMs: 60_000 });

    hub.handleMessage(
      "c1",
      JSON.stringify({ type: "join", mode: "match", displayName: "Alice" }),
    );
    hub.handleMessage(
      "c2",
      JSON.stringify({ type: "join", mode: "match", displayName: "Bob" }),
    );

    expect(hub.matchQueueLength).toBe(2);
    expect(hub.rooms.size).toBe(0);
    expect(inbox.get("c1") ?? []).toHaveLength(0);

    clock.tick(59_000);
    expect(hub.matchQueueLength).toBe(2);
    expect(hub.rooms.size).toBe(0);
  });

  it("at 60s fills remaining seats with fake names and starts with 4", () => {
    const { inbox, emit } = collectEmit();
    const clock = createFakeClock();
    const hub = new MatchHub(emit, { seed: 7, clock, botFillMs: 60_000 });

    hub.handleMessage(
      "c1",
      JSON.stringify({ type: "join", mode: "match", displayName: "Alice" }),
    );
    hub.handleMessage(
      "c2",
      JSON.stringify({ type: "join", mode: "match", displayName: "Bob" }),
    );

    clock.tick(60_000);

    expect(hub.matchQueueLength).toBe(0);
    expect(hub.rooms.size).toBe(1);
    const room = [...hub.rooms.values()][0]!;
    expect(room.phase).toBe("playing");
    expect(room.seats).toHaveLength(4);
    expect(room.botSeatIds()).toHaveLength(2);

    const view = (inbox.get("c1") ?? []).find((m) => m.type === "view" && m.phase === "playing");
    expect(view?.type).toBe("view");
    if (view?.type !== "view" || !view.view) return;

    const names = view.view.players.map((p) => p.displayName);
    expect(names).toHaveLength(4);
    for (const name of names) {
      expect(leaksBotMarker(String(name))).toBe(false);
    }
  });

  it("client-facing lobby/view JSON has no Bot markers or isBot flags", () => {
    const { inbox, emit } = collectEmit();
    const clock = createFakeClock();
    const hub = new MatchHub(emit, { seed: 3, clock, botFillMs: 1_000 });

    hub.handleMessage(
      "c1",
      JSON.stringify({ type: "join", mode: "match", displayName: "Host" }),
    );
    clock.tick(1_000);

    const room = [...hub.rooms.values()][0]!;
    expect(room.phase).toBe("playing");

    const payload = JSON.stringify(inbox.get("c1") ?? []);
    expect(leaksBotMarker(payload)).toBe(false);
    expect(payload.toLowerCase()).not.toContain("isbot");
    expect(payload).not.toContain('"isBot"');

    // Lobby path: create room under-4 stays lobby; seat names clean
    const { inbox: inbox2, emit: emit2 } = collectEmit();
    const room2 = new MatchRoom({ roomCode: "LOB", seed: 1, emit: emit2 });
    room2.handleMessage("h1", { type: "join", mode: "create", displayName: "H" });
    room2.fillSilentBots(pickFakeDisplayNames(3, new Set(["H"])));
    expect(room2.phase).toBe("playing");
    const lobbyOrPlay = JSON.stringify(inbox2.get("h1") ?? []);
    expect(leaksBotMarker(lobbyOrPlay)).toBe(false);
    expect(lobbyOrPlay).not.toContain('"isBot"');
  });

  it("four humans match immediately without Bot seats", () => {
    const { emit } = collectEmit();
    const clock = createFakeClock();
    const hub = new MatchHub(emit, { seed: 11, clock });

    for (let i = 1; i <= 4; i += 1) {
      hub.handleMessage(
        `c${i}`,
        JSON.stringify({ type: "join", mode: "match", displayName: `P${i}` }),
      );
    }
    expect(hub.matchQueueLength).toBe(0);
    const room = [...hub.rooms.values()][0]!;
    expect(room.phase).toBe("playing");
    expect(room.botSeatIds()).toHaveLength(0);
  });

  it("leave cancels free-match queue", () => {
    const { emit } = collectEmit();
    const clock = createFakeClock();
    const hub = new MatchHub(emit, { seed: 1, clock, botFillMs: 60_000 });
    hub.handleMessage(
      "c1",
      JSON.stringify({ type: "join", mode: "match", displayName: "A" }),
    );
    expect(hub.matchQueueLength).toBe(1);
    hub.handleMessage("c1", JSON.stringify({ type: "leave" }));
    expect(hub.matchQueueLength).toBe(0);
    clock.tick(60_000);
    expect(hub.rooms.size).toBe(0);
  });
});

describe("MatchRoom disconnect grace / Bot takeover / reclaim", () => {
  it("disconnect starts grace: seat retained, not hosted, not in botSeatIds", () => {
    const { inbox, emit } = collectEmit();
    const clock = createFakeClock();
    const room = new MatchRoom({
      roomCode: "GRACE",
      seed: 42,
      emit,
      clock,
      disconnectGraceMs: 45_000,
    });
    fillRoom(room);
    expect(room.phase).toBe("playing");

    const seat = room.seats.find((s) => s.connectionId === "c1")!;
    const token = seat.seatToken;
    const seatId = seat.seatId;

    inbox.clear();
    room.onDisconnect("c1");

    expect(seat.connected).toBe(false);
    expect(seat.connectionId).toBeNull();
    expect(seat.disconnectHosted).toBe(false);
    expect(seat.disconnectGraceUntil).toBe(45_000);
    expect(room.botSeatIds()).not.toContain(seatId);
    expect(room.seats).toHaveLength(4);
    expect(seat.seatToken).toBe(token);

    const presence = room.buildPresence();
    expect(presence[seatId]?.connected).toBe(false);
    expect(presence[seatId]?.hosted).toBe(false);
    expect(presence[seatId]?.graceRemainingSec).toBe(45);

    // Others still connected receive presence update
    const forP2 = inbox.get("c2") ?? [];
    const view = forP2.find((m) => m.type === "view");
    expect(view?.type === "view" && view.presence?.[seatId]?.graceRemainingSec).toBe(45);
  });

  it("after grace timeout: disconnectHosted and Bot acts on that seat", () => {
    const { emit } = collectEmit();
    const clock = createFakeClock();
    const room = new MatchRoom({
      roomCode: "HOST",
      seed: 42,
      emit,
      clock,
      disconnectGraceMs: 45_000,
    });
    fillRoom(room);

    const p1 = room.seats.find((s) => s.connectionId === "c1")!;
    expect(room.gameState!.players[room.gameState!.currentPlayerIndex]?.id).toBe(
      p1.seatId,
    );
    expect(room.gameState!.turnPhase).toBe("draw");
    expect(room.gameState!.eventFlippedThisRound).toBe(false);

    room.onDisconnect("c1");
    clock.tick(44_999);
    expect(p1.disconnectHosted).toBe(false);
    expect(room.gameState!.eventFlippedThisRound).toBe(false);

    clock.tick(1); // grace fires → hosted → queueBotTurns(0)
    expect(p1.disconnectHosted).toBe(true);
    expect(room.botSeatIds()).toContain(p1.seatId);
    // Bot should have flipped (and possibly more) for current seat
    expect(room.gameState!.eventFlippedThisRound).toBe(true);

    const presence = room.buildPresence();
    expect(presence[p1.seatId]?.hosted).toBe(true);
    expect(presence[p1.seatId]?.graceRemainingSec).toBeNull();
  });

  it("reconnect with seatToken reclaims seat and clears hosted", () => {
    const { inbox, emit } = collectEmit();
    const clock = createFakeClock();
    const room = new MatchRoom({
      roomCode: "RECL",
      seed: 42,
      emit,
      clock,
      disconnectGraceMs: 1_000,
    });
    fillRoom(room);

    const seat = room.seats.find((s) => s.connectionId === "c2")!;
    const token = seat.seatToken;
    const name = seat.displayName;

    room.onDisconnect("c2");
    clock.tick(1_000);
    expect(seat.disconnectHosted).toBe(true);

    inbox.clear();
    room.handleMessage("c2-new", {
      type: "join",
      mode: "join",
      roomCode: "RECL",
      displayName: name,
      seatToken: token,
      seatCount: 4,
    });

    expect(seat.connected).toBe(true);
    expect(seat.connectionId).toBe("c2-new");
    expect(seat.disconnectHosted).toBe(false);
    expect(seat.disconnectGraceUntil).toBeNull();
    expect(room.botSeatIds()).not.toContain(seat.seatId);

    const msgs = inbox.get("c2-new") ?? [];
    const snap = msgs.find((m) => m.type === "view");
    expect(snap?.type === "view" && snap.reclaimed).toBe(true);
    expect(snap?.type === "view" && snap.presence?.[seat.seatId]?.hosted).toBe(false);
    expect(snap?.type === "view" && snap.presence?.[seat.seatId]?.connected).toBe(true);
  });

  it("silent-fill Bot seats never report hosted in presence", () => {
    const { emit } = collectEmit();
    const clock = createFakeClock();
    const room = new MatchRoom({ roomCode: "SIL", seed: 1, emit, clock });
    room.handleMessage("h1", { type: "join", mode: "create", displayName: "Host" });
    room.fillSilentBots(pickFakeDisplayNames(3, new Set(["Host"])));
    expect(room.phase).toBe("playing");

    const presence = room.buildPresence();
    for (const seat of room.seats) {
      if (!seat.isBot) continue;
      expect(presence[seat.seatId]?.hosted).toBe(false);
      expect(presence[seat.seatId]?.connected).toBe(true);
    }
  });
});

describe("applyAction smoke after legal gate", () => {
  it("legal intent advances draw→plan after flip+draw", () => {
    const state = createGame({ playerNames: ["A", "B"], seed: 11 });
    expect(applyAction(state, { type: "FLIP_EVENT" }).ok).toBe(true);
    expect(applyAction(state, { type: "DRAW_TO_HAND_LIMIT" }).ok).toBe(true);
    expect(state.turnPhase).toBe("plan");
  });
});
