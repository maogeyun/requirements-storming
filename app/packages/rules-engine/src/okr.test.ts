import { describe, expect, it } from "vitest";
import { getOkrCard } from "@rs/game-data";
import type { GameState, PlayerState } from "@rs/shared";
import { createGame } from "./create-game";
import { consumeInteractionCard } from "./interaction";
import {
  evaluateAllOkrs,
  evaluatePlayerOkr,
  noteBugsCleared,
  noteCollabCardPlayed,
  noteOvertimeUsed,
  settleHiddenOkrs,
} from "./okr";

function makeOkrState(): GameState {
  return createGame({
    playerNames: ["P1", "P2", "P3", "P4"],
    config: {
      requirementId: "R-01",
      modules: {
        darkBid: true,
        interactionCards: true,
        hiddenOkr: true,
        continuousSprint: false,
      },
    },
    seed: 651,
  });
}

function assignOkr(state: GameState, playerId: string, okrId: string): PlayerState {
  const player = state.players.find((p) => p.id === playerId)!;
  player.okrId = okrId;
  return player;
}

/** 与 player-view 一致：仅 okrRevealed 后他座可见 */
function otherSeatVisibleOkr(state: GameState, okrId: string | null): string | null {
  return state.okrRevealed ? okrId : null;
}

describe("隐藏 OKR 发牌与窥视", () => {
  it("开局每人暗抽 1 张 OKR 且互不重复", () => {
    const state = makeOkrState();
    const ids = state.players.map((p) => p.okrId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(state.okrRevealed).toBe(false);
    expect(state.okrSettlements).toBeNull();
  });

  it("亮牌前他座不可见 OKR；本座位自知（TC-657 暗阶段）", () => {
    const state = makeOkrState();
    for (const player of state.players) {
      expect(player.okrId).toBeTruthy();
      expect(otherSeatVisibleOkr(state, player.okrId)).toBeNull();
    }
  });
});

describe("OKR 判定 O-01～O-06（TC-651～656）", () => {
  it("O-01 抢镜狂魔：独揽突破 ≥2", () => {
    const state = makeOkrState();
    const p = assignOkr(state, "p1", "O-01");
    p.milestoneBreakCount = 1;
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(false);
    p.milestoneBreakCount = 2;
    const row = evaluatePlayerOkr(state, "p1")!;
    expect(row.achieved).toBe(true);
    expect(row.reward).toBe(getOkrCard("O-01")!.reward);
  });

  it("O-02 救火队长：累计清 Bug ≥5", () => {
    const state = makeOkrState();
    const p = assignOkr(state, "p1", "O-02");
    p.personalBugs = 6;
    noteBugsCleared(p, 4);
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(false);
    noteBugsCleared(p, 1);
    expect(p.bugsClearedTotal).toBe(5);
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(true);
  });

  it("O-03 逆风翻盘：曾垫底且亮牌前 MVP", () => {
    const state = makeOkrState();
    assignOkr(state, "p1", "O-03");
    state.players[0]!.bottomMarks = 1;
    state.players[0]!.performance = 10;
    state.players[1]!.performance = 8;
    state.players[2]!.performance = 7;
    state.players[3]!.performance = 6;
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(true);

    state.players[0]!.bottomMarks = 0;
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(false);
  });

  it("O-04 零债交付：无个人债且参与 ≥2 突破", () => {
    const state = makeOkrState();
    const p = assignOkr(state, "p1", "O-04");
    p.personalDebt = 0;
    p.breakthroughParticipations = 2;
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(true);
    p.personalDebt = 1;
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(false);
  });

  it("O-05 团队基石：仅计 C-01～C-07，排除 C-12～C-14（TC-655）", () => {
    const state = makeOkrState();
    const p = assignOkr(state, "p1", "O-05");
    p.hand = ["C-01", "C-02", "C-03", "C-12", "C-13"];
    p.workHoursRemaining = 40;
    p.seasonPlayedCollab = [];
    p.collabCardsPlayed = 0;

    noteCollabCardPlayed(p, "C-01");
    noteCollabCardPlayed(p, "C-02");
    noteCollabCardPlayed(p, "C-03");
    expect(p.collabCardsPlayed).toBe(3);

    noteCollabCardPlayed(p, "C-12");
    noteCollabCardPlayed(p, "C-13");
    noteCollabCardPlayed(p, "C-14");
    expect(p.collabCardsPlayed).toBe(3);
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(false);

    noteCollabCardPlayed(p, "C-04");
    expect(p.collabCardsPlayed).toBe(4);
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(true);

    const before = p.collabCardsPlayed;
    p.hand = ["C-12", ...p.hand.filter((id) => id !== "C-12")];
    p.seasonPlayedCollab = [];
    state.turnPhase = "execute";
    consumeInteractionCard(state, "p1", "C-12");
    expect(p.collabCardsPlayed).toBe(before);
  });

  it("O-06 效率之王：从未加班且参与 ≥3 突破", () => {
    const state = makeOkrState();
    const p = assignOkr(state, "p1", "O-06");
    p.neverUsedOvertime = true;
    p.breakthroughParticipations = 3;
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(true);
    noteOvertimeUsed(p);
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(false);
  });
});

describe("总结算亮牌", () => {
  it("settleHiddenOkrs 写入奖励并确定 MVP（TC-657/658）", () => {
    const state = makeOkrState();
    for (const [i, id] of ["O-01", "O-02", "O-03", "O-04"].entries()) {
      assignOkr(state, `p${i + 1}`, id);
    }
    state.players[0]!.milestoneBreakCount = 2;
    state.players[0]!.performance = 5;
    state.players[1]!.bugsClearedTotal = 5;
    state.players[1]!.performance = 4;
    state.players[2]!.bottomMarks = 1;
    state.players[2]!.performance = 9;
    state.players[3]!.personalDebt = 0;
    state.players[3]!.breakthroughParticipations = 2;
    state.players[3]!.performance = 3;

    const before = evaluateAllOkrs(state);
    expect(before.every((r) => r.achieved)).toBe(true);

    const results = settleHiddenOkrs(state);
    expect(state.okrRevealed).toBe(true);
    expect(results).toHaveLength(4);
    expect(state.players[0]!.performance).toBe(5 + getOkrCard("O-01")!.reward);
    expect(state.players[2]!.performance).toBe(9 + getOkrCard("O-03")!.reward);
    expect(state.winnerId).toBe("p3");

    for (const player of state.players) {
      expect(otherSeatVisibleOkr(state, player.okrId)).toBe(player.okrId);
    }
  });
});
