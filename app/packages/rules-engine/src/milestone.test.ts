import { describe, expect, it } from "vitest";
import { gameConstants } from "@rs/game-data";
import type { GameState } from "@rs/shared";
import { createGame } from "./create-game.js";
import {
  applyProgressGain,
  detectDarkBidTrigger,
  isInSprintZone,
  openDarkBid,
  resolveDarkBidBids,
  resolveDarkBidPriorityOnTie,
  submitDarkBid,
} from "./milestone.js";
import { playSkillCard } from "./index.js";

function makeDarkBidState(progress: number): GameState {
  const state = createGame({
    playerNames: ["P1", "P2", "P3", "P4"],
    config: {
      requirementId: "R-01",
      modules: {
        darkBid: true,
        interactionCards: true,
        hiddenOkr: false,
        continuousSprint: false,
      },
    },
    seed: 42,
  });
  state.progress = progress;
  state.turnPhase = "execute";
  for (const player of state.players) {
    player.workHoursRemaining = gameConstants.baseWorkHoursPerTurn;
    player.workHoursBudget = gameConstants.baseWorkHoursPerTurn;
  }
  return state;
}

describe("FIX-01 暗标冲刺", () => {
  it("TC-610: 进度 22 单卡 +25 跨至 47 须跨线补开暗标", () => {
    const state = makeDarkBidState(22);
    const trigger = detectDarkBidTrigger(state, 25);
    expect(trigger).not.toBeNull();
    expect(trigger?.milestoneId).toBe("M1");
    expect(trigger?.isCatchUp).toBe(true);
    expect(state.darkBidUsed.M1).toBe(false);
  });

  it("TC-701: 进度 24→25 进入冲刺区触发正常暗标", () => {
    const state = makeDarkBidState(24);
    expect(isInSprintZone(25, 40, 15)).toBe(true);
    const trigger = detectDarkBidTrigger(state, 1);
    expect(trigger).not.toBeNull();
    expect(trigger?.milestoneId).toBe("M1");
    expect(trigger?.isCatchUp).toBe(false);
  });

  it("TC-703: 跨线补开从剩余工时扣押注", () => {
    const state = makeDarkBidState(22);
    const p1 = state.players[0];
    p1.workHoursRemaining = 8;
    p1.workHoursBudget = 8;

    openDarkBid(state, { milestoneId: "M1", isCatchUp: true });
    submitDarkBid(state, "p1", 6);
    submitDarkBid(state, "p2", 0);
    submitDarkBid(state, "p3", 0);
    submitDarkBid(state, "p4", 0);

    resolveDarkBidBids(state);
    expect(p1.workHoursRemaining).toBe(2);
  });

  it("TC-705: 暗标优先权顶替跨线者为突破者", () => {
    const state = makeDarkBidState(38);
    state.players[3].hand = ["S-04"];

    const result = playSkillCard(state, "p4", "S-04", {
      p1: 8,
      p2: 3,
      p3: 0,
      p4: 6,
    });

    const m1 = result.settlements.find((s) => s.milestoneId === "M1");
    expect(m1).toBeDefined();
    expect(m1?.breakerId).toBe("p1");
  });

  it("TC-706: 押注平局时跨线者优先", () => {
    const state = makeDarkBidState(28);
    openDarkBid(state, { milestoneId: "M1", isCatchUp: false });
    submitDarkBid(state, "p1", 6);
    submitDarkBid(state, "p2", 6);
    submitDarkBid(state, "p3", 0);
    submitDarkBid(state, "p4", 0);
    resolveDarkBidBids(state);
    const priority = resolveDarkBidPriorityOnTie(state, "p2");
    expect(priority).toBe("p2");
  });

  it("每个里程碑暗标仅 1 次", () => {
    const state = makeDarkBidState(22);
    openDarkBid(state, { milestoneId: "M1", isCatchUp: true });
    submitDarkBid(state, "p1", 0);
    submitDarkBid(state, "p2", 0);
    submitDarkBid(state, "p3", 0);
    submitDarkBid(state, "p4", 0);
    resolveDarkBidBids(state);
    resolveDarkBidPriorityOnTie(state, "p1");
    applyProgressGain(state, "p1", 25);
    expect(state.darkBidUsed.M1).toBe(true);

    const second = detectDarkBidTrigger(state, 0);
    expect(second).toBeNull();
  });
});

describe("createGame", () => {
  it("4 人局 R-01 正确初始化", () => {
    const state = createGame({
      playerNames: ["A", "B", "C", "D"],
      config: { requirementId: "R-01" },
      seed: 1,
    });
    expect(state.players).toHaveLength(4);
    expect(state.requirementId).toBe("R-01");
    expect(state.totalProgressTarget).toBe(200);
    expect(state.players.every((p) => p.hand.length === 5)).toBe(true);
  });

  it("R-06 开局 3 公共技术债", () => {
    const state = createGame({
      playerNames: ["A", "B", "C"],
      config: { requirementId: "R-06" },
      seed: 1,
    });
    expect(state.publicDebt).toBe(3);
  });
});
