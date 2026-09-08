import { describe, expect, it } from "vitest";
import type { GameState } from "@rs/shared";
import { createGame } from "./create-game";
import {
  applyAction,
  playBoostCard,
  playCollabCard,
  playSkillCard,
  useBaseOvertime,
} from "./actions";
import { evaluatePlayerOkr } from "./okr";
import { forceFlipSpecificEvent } from "./events";

function makePlayState(): GameState {
  const state = createGame({
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
    seed: 90210,
  });
  forceFlipSpecificEvent(state, "E-04");
  state.turnPhase = "execute";
  state.currentPlayerIndex = 0;
  for (const p of state.players) {
    p.workHoursRemaining = 40;
    p.workHoursBudget = 40;
    p.seasonPlayedCollab = [];
    p.collabCardsPlayed = 0;
    p.bugsClearedTotal = 0;
    p.neverUsedOvertime = true;
    p.usedOvertime = false;
  }
  return state;
}

describe("OKR 计数器生产路径接线", () => {
  it("PLAY_CARD 协作卡 C-01～C-07 调用 noteCollabCardPlayed（O-05）", () => {
    const state = makePlayState();
    const p1 = state.players[0]!;
    p1.okrId = "O-05";
    p1.hand = ["C-01", "C-02", "C-03", "C-05"];
    p1.collabCardsPlayed = 0;

    const r1 = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "p1",
      cardId: "C-01",
    });
    expect(r1.ok).toBe(true);
    expect(p1.collabCardsPlayed).toBe(1);

    applyAction(state, { type: "PLAY_CARD", playerId: "p1", cardId: "C-02" });
    applyAction(state, { type: "PLAY_CARD", playerId: "p1", cardId: "C-03" });
    applyAction(state, { type: "PLAY_CARD", playerId: "p1", cardId: "C-05" });
    expect(p1.collabCardsPlayed).toBe(4);
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(true);
  });

  it("PLAY_CARD 互动卡 C-12 不计入 O-05 collabCardsPlayed", () => {
    const state = makePlayState();
    const p1 = state.players[0]!;
    p1.okrId = "O-05";
    p1.personalDebt = 1;
    p1.hand = ["C-12", "C-01", "C-02", "C-03"];
    p1.collabCardsPlayed = 0;
    p1.seasonPlayedCollab = [];

    const before = p1.collabCardsPlayed;
    const result = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "p1",
      cardId: "C-12",
      targets: ["p2"],
      dumpKind: "debt",
    });
    expect(result.ok).toBe(true);
    expect(p1.collabCardsPlayed).toBe(before);

    // 关闭 C-14 窗后再打协作卡
    applyAction(state, { type: "DECLINE_C14", playerId: "p2" });
    state.currentPlayerIndex = 0;
    state.turnPhase = "execute";

    playCollabCard(state, "p1", "C-01");
    playCollabCard(state, "p1", "C-02");
    playCollabCard(state, "p1", "C-03");
    expect(p1.collabCardsPlayed).toBe(3);
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(false);
  });

  it("S-03 / S-06 清 Bug 走 PLAY_CARD → noteBugsCleared（O-02）", () => {
    const state = makePlayState();
    const p1 = state.players[0]!;
    p1.okrId = "O-02";
    p1.personalBugs = 5;
    p1.hand = ["S-03", "S-06", "S-01"];
    p1.bugsClearedTotal = 0;

    const r1 = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "p1",
      cardId: "S-03",
    });
    expect(r1.ok).toBe(true);
    expect(p1.bugsClearedTotal).toBe(1);
    expect(p1.personalBugs).toBe(4);

    applyAction(state, { type: "PLAY_CARD", playerId: "p1", cardId: "S-06" });
    expect(p1.bugsClearedTotal).toBe(3);
    expect(p1.personalBugs).toBe(2);

    // 再清两次 S-03 才够 5（手牌补一张）
    p1.hand = ["S-03", "S-03"];
    p1.workHoursRemaining = 40;
    applyAction(state, { type: "PLAY_CARD", playerId: "p1", cardId: "S-03" });
    applyAction(state, { type: "PLAY_CARD", playerId: "p1", cardId: "S-03" });
    expect(p1.bugsClearedTotal).toBe(5);
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(true);
  });

  it("playSkillCard 直接清 Bug 也更新计数", () => {
    const state = makePlayState();
    const p1 = state.players[0]!;
    p1.personalBugs = 2;
    p1.hand = ["S-06"];
    playSkillCard(state, "p1", "S-06");
    expect(p1.bugsClearedTotal).toBe(2);
    expect(p1.personalBugs).toBe(0);
  });

  it("B-04 通宵走 PLAY_CARD → noteOvertimeUsed（破坏 O-06）", () => {
    const state = makePlayState();
    const p1 = state.players[0]!;
    p1.okrId = "O-06";
    p1.breakthroughParticipations = 3;
    p1.neverUsedOvertime = true;
    p1.hand = ["B-04"];
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(true);

    const result = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "p1",
      cardId: "B-04",
    });
    expect(result.ok).toBe(true);
    expect(p1.neverUsedOvertime).toBe(false);
    expect(p1.usedOvertime).toBe(true);
    expect(p1.personalDebt).toBe(2);
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(false);
  });

  it("基础加班 USE_BASE_OVERTIME → noteOvertimeUsed", () => {
    const state = makePlayState();
    const p1 = state.players[0]!;
    p1.okrId = "O-06";
    p1.breakthroughParticipations = 3;
    p1.neverUsedOvertime = true;

    const result = applyAction(state, {
      type: "USE_BASE_OVERTIME",
      playerId: "p1",
    });
    expect(result.ok).toBe(true);
    expect(p1.neverUsedOvertime).toBe(false);
    expect(p1.workHoursRemaining).toBe(48);
    expect(p1.personalDebt).toBe(1);
    expect(evaluatePlayerOkr(state, "p1")?.achieved).toBe(false);
  });

  it("playBoostCard(B-04) / useBaseOvertime 辅助路径一致", () => {
    const a = makePlayState();
    a.players[0]!.hand = ["B-04"];
    playBoostCard(a, "p1", "B-04");
    expect(a.players[0]!.neverUsedOvertime).toBe(false);

    const b = makePlayState();
    useBaseOvertime(b, "p1");
    expect(b.players[0]!.neverUsedOvertime).toBe(false);
  });
});
