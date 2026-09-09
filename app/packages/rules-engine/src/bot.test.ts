import { describe, expect, it } from "vitest";
import type { GameState } from "@rs/shared";
import { createGame } from "./create-game";
import {
  applyAction,
  forceCatchUpProgressAttempt,
  listLegalActions,
  setupC14CounterDemo,
} from "./actions";
import { listBotActorSeats, pickHeuristicLegalAction } from "./bot";
import { getCurrentPlayerId } from "./turn";

function makeGame(playerCount = 4): GameState {
  const names = Array.from({ length: playerCount }, (_, i) => `P${i + 1}`);
  return createGame({
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
    seed: 77,
  });
}

describe("pickHeuristicLegalAction", () => {
  it("picks mid dark-bid amount for catch-up window", () => {
    const state = makeGame();
    forceCatchUpProgressAttempt(state, "p1", 25);
    expect(state.pendingDarkBid && !state.pendingDarkBid.resolved).toBe(true);

    const pick = pickHeuristicLegalAction(state, "p2");
    expect(pick?.action.type).toBe("SUBMIT_DARK_BID");
    if (pick?.action.type === "SUBMIT_DARK_BID") {
      const max = state.config.darkBidMax ?? state.constants.darkBidMax;
      expect(pick.action.amount).toBe(Math.floor(max / 2));
    }
  });

  it("declines C-14 when targeted (simple heuristic)", () => {
    const state = makeGame();
    setupC14CounterDemo(state);
    const pick = pickHeuristicLegalAction(state, "p2");
    expect(pick?.action.type).toBe("DECLINE_C14");
  });

  it("prefers progress skill plays over ending execute", () => {
    const state = makeGame();
    applyAction(state, { type: "FLIP_EVENT" });
    applyAction(state, { type: "DRAW_TO_HAND_LIMIT" });
    applyAction(state, { type: "CONFIRM_PLAN" });
    const seat = getCurrentPlayerId(state);
    const player = state.players.find((p) => p.id === seat)!;
    player.hand = ["S-01", "S-07"];
    player.workHoursRemaining = 40;

    const pick = pickHeuristicLegalAction(state, seat);
    expect(pick?.action.type).toBe("PLAY_CARD");
    if (pick?.action.type === "PLAY_CARD") {
      expect(pick.action.cardId).toBe("S-07");
    }
  });

  it("advances draw/plan/end phases with bookkeeping actions", () => {
    const state = makeGame();
    const seat = getCurrentPlayerId(state);
    expect(pickHeuristicLegalAction(state, seat)?.action.type).toBe("FLIP_EVENT");
    applyAction(state, { type: "FLIP_EVENT" });
    expect(pickHeuristicLegalAction(state, seat)?.action.type).toBe(
      "DRAW_TO_HAND_LIMIT",
    );
  });
});

describe("listBotActorSeats", () => {
  it("returns current seat when it is a bot turn", () => {
    const state = makeGame();
    const current = getCurrentPlayerId(state);
    expect(listBotActorSeats(state, ["p2", "p3", "p4"])).toEqual(
      current === "p1" ? [] : [current],
    );
    expect(listBotActorSeats(state, [current])).toEqual([current]);
  });

  it("lists bots that still owe dark bids", () => {
    const state = makeGame();
    forceCatchUpProgressAttempt(state, "p1", 25);
    applyAction(state, { type: "SUBMIT_DARK_BID", playerId: "p2", amount: 0 });
    expect(listBotActorSeats(state, ["p2", "p3", "p4"])).toEqual(["p3", "p4"]);
  });

  it("lists C-14 target bot only", () => {
    const state = makeGame();
    setupC14CounterDemo(state);
    expect(listBotActorSeats(state, ["p2", "p3", "p4"])).toEqual(["p2"]);
    expect(listBotActorSeats(state, ["p3", "p4"])).toEqual([]);
  });

  it("only returns enabled legal actions for heuristic picks", () => {
    const state = makeGame();
    const seat = getCurrentPlayerId(state);
    const pick = pickHeuristicLegalAction(state, seat);
    expect(pick).not.toBeNull();
    const legal = listLegalActions(state, seat);
    expect(legal.some((a) => a.enabled && a.action.type === pick!.action.type)).toBe(
      true,
    );
  });
});

describe("vs-bot smoke: bots can auto-play without human clicks", () => {
  it("runs several bot turns until human seat again or forced human window", () => {
    const state = makeGame(4);
    const humanId = "p1";
    const botIds = state.playerOrder.filter((id) => id !== humanId);
    let guard = 0;
    while (guard++ < 80) {
      if (state.gameOver) break;
      const actors = listBotActorSeats(state, botIds);
      if (actors.length === 0) break;
      const seat = actors[0]!;
      const pick = pickHeuristicLegalAction(state, seat);
      expect(pick).not.toBeNull();
      const result = applyAction(state, pick!.action);
      expect(result.ok).toBe(true);
    }
    const actorsLeft = listBotActorSeats(state, botIds);
    expect(actorsLeft.length === 0 || state.progress >= 0).toBe(true);
  });

  it("4p all-heuristic can reach sprint switch or endgame without demo helpers", () => {
    const state = makeGame(4);
    const allSeats = [...state.playerOrder];
    let guard = 0;
    let sawSprintSwitch = false;

    while (guard++ < 2500 && !state.gameOver) {
      if (state.sprintSwitchInfo) {
        sawSprintSwitch = true;
        break;
      }

      const interaction = state.pendingInteraction;
      let seat: string | null = null;
      if (interaction?.type === "C14") {
        seat = interaction.targetId;
      } else if (interaction?.type === "C13_WINDOW") {
        seat =
          allSeats.find(
            (id) =>
              id !== interaction.breakerId &&
              !interaction.passedIds.includes(id),
          ) ?? null;
      } else if (state.pendingDarkBid && !state.pendingDarkBid.resolved) {
        seat =
          allSeats.find((id) => !(id in state.pendingDarkBid!.bids)) ?? null;
      } else {
        seat = getCurrentPlayerId(state);
      }

      expect(seat).not.toBeNull();
      const pick = pickHeuristicLegalAction(state, seat!);
      expect(pick, `no legal pick for ${seat} @ step ${guard}`).not.toBeNull();
      const result = applyAction(state, pick!.action);
      expect(result.ok, result.ok ? "" : result.error).toBe(true);
    }

    expect(sawSprintSwitch || state.gameOver || state.sprint >= 2).toBe(true);
  });
});
