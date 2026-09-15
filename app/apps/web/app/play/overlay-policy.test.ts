import { createGame } from "@rs/rules-engine";
import { describe, expect, it } from "vitest";
import {
  canTimerDismissInfoTip,
  detectForcedWindow,
  makeRevealTip,
  playNodeKey,
  REVEAL_HOLD_MS,
  shouldAutoDismissSettlement,
  settlementNeedsAction,
  sprintSwitchInfoOpen,
  sprintSwitchKey,
  tipFromForcedTransition,
  tipFromSettlementTransition,
} from "./overlay-policy";

function freshGame() {
  return createGame({
    playerNames: ["A", "B", "C", "D"],
    config: {
      requirementId: "R-01",
      modules: {
        darkBid: true,
        interactionCards: true,
        hiddenOkr: true,
        continuousSprint: true,
      },
    },
    seed: 42,
  });
}

describe("overlay-policy", () => {
  it("playNodeKey changes when phase advances", () => {
    const a = freshGame();
    const b = structuredClone(a);
    // Sets are not cloned by structuredClone into working Set for game — rebuild via mutate
    a.turnPhase = "plan";
    b.turnPhase = "execute";
    b.roundContributors = new Set(a.roundContributors);
    a.roundContributors = new Set(a.roundContributors);
    expect(playNodeKey(a)).not.toBe(playNodeKey(b));
  });

  it("sprint switch is info-open until acked", () => {
    const state = freshGame();
    state.sprintSwitchInfo = {
      fromSprint: 1,
      toSprint: 2,
      previousRequirementId: "R-01",
      nextRequirementId: "R-02",
      cleared: ["进度"],
      carried: ["绩效"],
    };
    const key = sprintSwitchKey(state);
    expect(sprintSwitchInfoOpen(state, null)).toBe(true);
    expect(sprintSwitchInfoOpen(state, key)).toBe(false);
    expect(detectForcedWindow(state)).toBeNull();
  });

  it("never auto-dismisses final victory or unfinished C13", () => {
    const c13 = freshGame();
    c13.pendingInteraction = {
      type: "C13_WINDOW",
      milestoneId: "M1",
      breakerId: "p1",
      collaboratorIds: [],
      passedIds: [],
    };
    expect(settlementNeedsAction(c13, "cross_line")).toBe(true);
    expect(shouldAutoDismissSettlement(c13, "cross_line")).toBe(false);
    expect(shouldAutoDismissSettlement(c13, "okr_reveal")).toBe(false);
    expect(shouldAutoDismissSettlement(freshGame(), "season_end")).toBe(true);
    expect(shouldAutoDismissSettlement(freshGame(), "cross_line")).toBe(true);
  });

  it("reveal tip holds 1s for timer dismiss; hold does not block node-close callers", () => {
    const tip = makeRevealTip("dark_bid_reveal", "x", 1000);
    expect(tip.holdUntilMs).toBe(1000 + REVEAL_HOLD_MS);
    expect(canTimerDismissInfoTip(tip, 1500)).toBe(false);
    expect(canTimerDismissInfoTip(tip, 2000)).toBe(true);
  });

  it("emits dark-bid / C-14 tips only on forced close", () => {
    expect(tipFromForcedTransition("catch_up_dark_bid", null, 0)?.kind).toBe(
      "dark_bid_reveal",
    );
    expect(tipFromForcedTransition("c14", null, 0)?.kind).toBe("c14_explain");
    expect(tipFromForcedTransition(null, "c14", 0)).toBeNull();
    expect(tipFromSettlementTransition(null, "season_end", 0)?.kind).toBe(
      "okr_mid_reveal",
    );
  });
});
