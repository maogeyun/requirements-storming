import { describe, expect, it } from "vitest";
import { gameConstants, getTotalProgressForPlayerCount } from "@rs/game-data";
import type { GameState } from "@rs/shared";
import { createGame } from "./create-game";
import { finalizeGameIfComplete, settleHiddenOkrs } from "./okr";
import {
  advanceToNextSprint,
  canAdvanceSprint,
  drawNextRequirementId,
} from "./sprint";
import { createRng } from "./rng";

function makeContinuousState(playerCount = 4, seed = 621): GameState {
  const names = Array.from({ length: playerCount }, (_, i) => `P${i + 1}`);
  return createGame({
    playerNames: names,
    config: {
      requirementId: "R-01",
      modules: {
        darkBid: false,
        interactionCards: false,
        hiddenOkr: true,
        continuousSprint: true,
      },
    },
    seed,
  });
}

/** 把 Sprint 推到「达标且无挂起」以便 finalize 切换 */
function reachSprintTarget(state: GameState): void {
  state.progress = state.totalProgressTarget;
  state.pendingInteraction = null;
  state.pendingPerformanceSettlement = null;
  state.pendingPerformanceSettlementQueue = [];
  state.pendingDarkBid = null;
  state.pendingProgressSettlement = null;
}

describe("连续 Sprint×2（TC-621～628）", () => {
  it("开局：continuousSprint 默认 sprintCount=2，Sprint1=R-01", () => {
    const state = makeContinuousState(4);
    expect(state.config.modules.continuousSprint).toBe(true);
    expect(state.config.sprintCount).toBe(gameConstants.defaultSprintCount);
    expect(state.config.sprintCount).toBe(2);
    expect(state.sprint).toBe(1);
    expect(state.requirementId).toBe("R-01");
    expect(state.usedRequirementIds).toEqual(["R-01"]);
    expect(state.totalProgressTarget).toBe(200);
    expect(state.sprintSwitchInfo).toBeNull();
  });

  it("TC-621：达 200 → Sprint2 + 进度 0，不终局", () => {
    const state = makeContinuousState(4);
    reachSprintTarget(state);
    const events = finalizeGameIfComplete(state);

    expect(state.gameOver).toBe(false);
    expect(state.sprint).toBe(2);
    expect(state.progress).toBe(0);
    expect(state.okrRevealed).toBe(false);
    expect(events.some((e) => e.includes("进入 Sprint 2"))).toBe(true);
    expect(state.sprintSwitchInfo?.fromSprint).toBe(1);
    expect(state.sprintSwitchInfo?.toSprint).toBe(2);
  });

  it("TC-622：绩效跨 Sprint 累计不清零", () => {
    const state = makeContinuousState(4);
    state.players[0]!.performance = 18;
    state.players[1]!.performance = 14;
    reachSprintTarget(state);
    finalizeGameIfComplete(state);

    expect(state.sprint).toBe(2);
    expect(state.players[0]!.performance).toBe(18);
    expect(state.players[1]!.performance).toBe(14);

    state.players[0]!.performance += 5;
    expect(state.players[0]!.performance).toBe(23);
  });

  it("TC-623：债 / Bug 在 Sprint 切换时清空", () => {
    const state = makeContinuousState(4);
    state.players[0]!.personalDebt = 2;
    state.players[0]!.personalBugs = 1;
    state.players[1]!.personalDebt = 1;
    state.publicDebt = 2;
    reachSprintTarget(state);
    finalizeGameIfComplete(state);

    expect(state.sprint).toBe(2);
    for (const p of state.players) {
      expect(p.personalDebt).toBe(0);
      expect(p.personalBugs).toBe(0);
    }
    // 上一 Sprint 公共债已清；若新需求为 R-06 则按机制重新挂 3
    expect(state.publicDebt).toBe(state.requirementId === "R-06" ? 3 : 0);
    expect(state.sprintSwitchInfo?.cleared).toEqual(
      expect.arrayContaining(["进度", "个人技术债", "个人 Bug", "公共债"]),
    );
  });

  it("TC-624：Sprint2 需求从剩余池抽取，禁重复", () => {
    const state = makeContinuousState(4, 624);
    expect(state.requirementId).toBe("R-01");
    reachSprintTarget(state);
    finalizeGameIfComplete(state);

    expect(state.sprint).toBe(2);
    expect(state.requirementId).not.toBe("R-01");
    expect(state.usedRequirementIds).toContain("R-01");
    expect(state.usedRequirementIds).toContain(state.requirementId);
    expect(state.usedRequirementIds).toHaveLength(2);
    expect(new Set(state.usedRequirementIds).size).toBe(2);

    // 直接抽池也永不命中已用
    const next = drawNextRequirementId(state.usedRequirementIds, createRng(99));
    expect(state.usedRequirementIds).not.toContain(next);
  });

  it("TC-625：OKR 计数器跨 Sprint 累计（O-02 清 Bug）", () => {
    const state = makeContinuousState(4);
    const p2 = state.players[1]!;
    p2.okrId = "O-02";
    p2.bugsClearedTotal = 3;
    reachSprintTarget(state);
    finalizeGameIfComplete(state);

    expect(state.sprint).toBe(2);
    expect(p2.bugsClearedTotal).toBe(3);
    // Sprint2 再清 2 → 跨 Sprint 累计达 5
    p2.bugsClearedTotal += 2;
    expect(p2.bugsClearedTotal).toBe(5);
  });

  it("TC-627：全部 Sprint 结束后按总绩效定系列 MVP", () => {
    const state = makeContinuousState(4, 627);
    // Sprint1 → 2
    state.players[0]!.performance = 18;
    state.players[1]!.performance = 14;
    reachSprintTarget(state);
    finalizeGameIfComplete(state);
    expect(state.sprint).toBe(2);
    expect(state.gameOver).toBe(false);

    // Sprint2 再加分后达标终局
    state.players[0]!.performance += 4; // 22
    state.players[1]!.performance += 10; // 24 → 系列最高
    reachSprintTarget(state);
    const events = finalizeGameIfComplete(state);

    expect(state.gameOver).toBe(true);
    expect(canAdvanceSprint(state)).toBe(false);
    expect(state.okrRevealed).toBe(true);
    expect(state.winnerId).toBe("p2");
    expect(events.some((e) => e.includes("系列 MVP"))).toBe(true);
  });

  it("TC-628：2 人局每 Sprint 目标进度 100，绩效仍累计", () => {
    const state = makeContinuousState(2, 628);
    expect(state.totalProgressTarget).toBe(getTotalProgressForPlayerCount(2));
    expect(state.totalProgressTarget).toBe(100);
    expect(state.config.sprintCount).toBe(2);

    state.players[0]!.performance = 10;
    state.players[1]!.performance = 7;
    reachSprintTarget(state);
    finalizeGameIfComplete(state);

    expect(state.sprint).toBe(2);
    expect(state.progress).toBe(0);
    expect(state.totalProgressTarget).toBe(100);
    expect(state.players[0]!.performance).toBe(10);
    expect(state.gameOver).toBe(false);

    reachSprintTarget(state);
    finalizeGameIfComplete(state);
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBe("p1");
  });

  it("advanceToNextSprint：里程碑与暗标标记重置", () => {
    const state = makeContinuousState(4);
    state.crossedMilestones = ["M1", "M2", "M3", "M4"];
    state.darkBidUsed = { M1: true, M2: true, M3: true, M4: true };
    reachSprintTarget(state);
    advanceToNextSprint(state);

    expect(state.crossedMilestones).toEqual([]);
    expect(state.darkBidUsed).toEqual({ M1: false, M2: false, M3: false, M4: false });
    expect(state.sprintSwitchInfo?.carried).toEqual(
      expect.arrayContaining(["绩效", "OKR 计数器"]),
    );
  });

  it("无 continuousSprint 时达标仍直接终局", () => {
    const state = createGame({
      playerNames: ["A", "B", "C", "D"],
      config: {
        requirementId: "R-01",
        modules: {
          darkBid: false,
          interactionCards: false,
          hiddenOkr: false,
          continuousSprint: false,
        },
      },
      seed: 1,
    });
    reachSprintTarget(state);
    finalizeGameIfComplete(state);
    expect(state.sprint).toBe(1);
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBeTruthy();
  });

  it("系列末 Sprint 亮牌后 settle 幂等", () => {
    const state = makeContinuousState(4, 700);
    state.sprint = 2;
    state.config.sprintCount = 2;
    reachSprintTarget(state);
    state.players[0]!.performance = 30;
    finalizeGameIfComplete(state);
    const first = state.okrSettlements;
    const again = settleHiddenOkrs(state);
    expect(again).toEqual(first);
  });
});
