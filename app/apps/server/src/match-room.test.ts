import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@rs/shared";
import { ErrorCode } from "@rs/shared";
import { isLegalIntent } from "./intent";
import { MatchHub } from "./match-hub";
import { MatchRoom } from "./match-room";
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

describe("MatchRoom intent validation", () => {
  it("rejects illegal intent and accepts legal FLIP_EVENT", () => {
    const { inbox, emit } = collectEmit();
    const room = new MatchRoom({
      roomCode: "TEST1",
      seatCount: 2,
      seed: 42,
      emit,
    });

    room.handleMessage("c1", {
      type: "join",
      mode: "create",
      displayName: "Alice",
      seatCount: 2,
    });
    room.handleMessage("c2", {
      type: "join",
      mode: "join",
      roomCode: "TEST1",
      displayName: "Bob",
    });

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
      seatCount: 4,
      seed: 77,
      emit,
    });
    // Override config modules via starting a 4p room then mutating state
    for (const [cid, name] of [
      ["c1", "A"],
      ["c2", "B"],
      ["c3", "C"],
      ["c4", "D"],
    ] as const) {
      room.handleMessage(cid, {
        type: "join",
        mode: cid === "c1" ? "create" : "join",
        roomCode: "FORCE",
        displayName: name,
        seatCount: 4,
      });
    }

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
  it("creates a room code and lets a second client join", () => {
    const { inbox, emit } = collectEmit();
    const hub = new MatchHub(emit, { seed: 99 });

    hub.handleMessage(
      "c1",
      JSON.stringify({
        type: "join",
        mode: "create",
        displayName: "Host",
        seatCount: 2,
      }),
    );

    const hostMsgs = inbox.get("c1") ?? [];
    const hostView = hostMsgs.find((m) => m.type === "view");
    expect(hostView?.type).toBe("view");
    if (hostView?.type !== "view") return;
    const code = hostView.roomCode;
    expect(code.length).toBeGreaterThanOrEqual(4);

    hub.handleMessage(
      "c2",
      JSON.stringify({
        type: "join",
        mode: "join",
        roomCode: code,
        displayName: "Guest",
      }),
    );

    const room = hub.rooms.get(code);
    expect(room?.phase).toBe("playing");
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
