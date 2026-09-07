import { describe, expect, it } from "vitest";
import type { GameState } from "@rs/shared";
import { createGame } from "./create-game";
import {
  applyAction,
  forceFlipEvent,
  listLegalActions,
  setupC12Demo,
  setupC13StealDemo,
  setupC14CounterDemo,
  attemptProgressGain,
} from "./actions";
import { completeDarkBidAndSettle, submitDarkBid } from "./milestone";
import { declineC14, playC13FromWindow, respondC14 } from "./interaction";

function makeInteractionState(): GameState {
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
    seed: 99,
  });
  forceFlipEvent(state, "E-03");
  state.turnPhase = "execute";
  state.activeEventFlags.doubleFirstMilestoneThisRound = false;
  state.activeEventFlags.firstMilestoneDoubled = false;
  for (const p of state.players) {
    p.workHoursRemaining = 40;
    p.workHoursBudget = 40;
    p.seasonPlayedCollab = [];
  }
  return state;
}

describe("事件牌", () => {
  it("每 Round 必须翻 1 张事件", () => {
    const state = createGame({
      playerNames: ["A", "B"],
      config: {
        requirementId: "R-01",
        modules: { darkBid: true, interactionCards: true, hiddenOkr: false, continuousSprint: false },
      },
      seed: 1,
    });
    expect(state.eventFlippedThisRound).toBe(false);
    const r = applyAction(state, { type: "FLIP_EVENT" });
    expect(r.ok).toBe(true);
    expect(state.eventFlippedThisRound).toBe(true);
    expect(state.currentEventId).toBeTruthy();

    const again = applyAction(state, { type: "FLIP_EVENT" });
    expect(again.ok).toBe(false);
  });
});

describe("互动卡 C-12～C-14", () => {
  it("TC-632: C-12 拒绝公共债，仅个人债/Bug", () => {
    const state = makeInteractionState();
    setupC12Demo(state);
    expect(state.publicDebt).toBe(3);

    const legal = listLegalActions(state, "p1");
    const publicDump = legal.find((a) => a.label === "C-12 甩公共债");
    expect(publicDump?.enabled).toBe(false);
    expect(publicDump?.reason).toMatch(/仅个人债\/Bug/);

    const personal = legal.find((a) => a.label.startsWith("C-12 甩个人债"));
    expect(personal?.enabled).toBe(true);

    const played = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "p1",
      cardId: "C-12",
      targets: ["p2"],
      dumpKind: "debt",
    });
    expect(played.ok).toBe(true);
    expect(state.pendingInteraction?.type).toBe("C14");
  });

  it("TC-631: C-12 甩 Bug 经 C-14 放弃后转移", () => {
    const state = makeInteractionState();
    setupC12Demo(state);
    applyAction(state, {
      type: "PLAY_CARD",
      playerId: "p1",
      cardId: "C-12",
      targets: ["p2"],
      dumpKind: "bug",
    });
    expect(state.players[0]!.personalBugs).toBe(1);
    const closed = applyAction(state, { type: "DECLINE_C14", playerId: "p2" });
    expect(closed.ok).toBe(true);
    expect(state.players[0]!.personalBugs).toBe(0);
    expect(state.players[1]!.personalBugs).toBe(1);
    expect(state.pendingInteraction).toBeNull();
  });

  it("TC-635: C-14 反制 C-12", () => {
    const state = makeInteractionState();
    const events = setupC14CounterDemo(state);
    expect(events.some((e) => e.includes("C-14"))).toBe(true);
    expect(state.pendingInteraction?.type).toBe("C14");

    const beforeDebt = state.players[0]!.personalDebt;
    const result = applyAction(state, {
      type: "RESPOND_C14",
      playerId: "p2",
      sourceId: "p1",
    });
    expect(result.ok).toBe(true);
    expect(state.players[0]!.personalDebt).toBe(beforeDebt);
    expect(state.players[0]!.performance).toBe(0); // -1 floored at 0 if was 0
    expect(state.pendingInteraction).toBeNull();
  });

  it("C-14 响应窗不可跳过", () => {
    const state = makeInteractionState();
    setupC14CounterDemo(state);
    const skip = applyAction(state, { type: "END_EXECUTE" });
    expect(skip.ok).toBe(false);
    if (!skip.ok) expect(skip.error).toMatch(/互动|C-14/);

    const legal = listLegalActions(state, "p2");
    expect(legal.find((a) => a.label === "跳过 C-14")?.enabled).toBe(false);
  });

  it("TC-634/638: C-13 可截暗标突破者绩效，且不双重结算", () => {
    const state = makeInteractionState();
    setupC13StealDemo(state);

    expect(state.pendingInteraction?.type).toBe("C13_WINDOW");
    expect(state.pendingPerformanceSettlement).not.toBeNull();
    expect(state.progress).toBe(47);

    // 绩效尚未发放
    expect(state.players[0]!.performance).toBe(0);

    const p4Id = state.playerOrder[3]!;
    const steal = applyAction(state, { type: "RESPOND_C13", playerId: p4Id });
    expect(steal.ok).toBe(true);
    expect(state.pendingInteraction?.type).toBe("C14");

    // 被针对者（暗标赢家 p1）放弃 C-14
    const done = applyAction(state, { type: "DECLINE_C14", playerId: "p1" });
    expect(done.ok).toBe(true);

    // M1 突破者 +3，再被截 1 → 2；截取者 +1
    expect(state.players[0]!.performance).toBe(2);
    expect(state.players[3]!.performance).toBe(1);
    expect(state.pendingPerformanceSettlement).toBeNull();
    expect(state.pendingInteraction).toBeNull();

    // 再次结算应被阻断（无挂起）
    expect(state.crossedMilestones).toContain("M1");
  });

  it("TC-636: C-14 反制 C-13 后正常结算且不截绩效", () => {
    const state = makeInteractionState();
    setupC13StealDemo(state);
    const p4Id = state.playerOrder[3]!;
    playC13FromWindow(state, p4Id);

    const breaker = state.players[0]!;
    breaker.hand = ["C-14", ...breaker.hand.filter((id) => id !== "C-14")];
    breaker.seasonPlayedCollab = [];

    respondC14(state, "p1");
    expect(state.players[0]!.performance).toBe(3); // 仅突破分，未被截
    expect(state.players[3]!.performance).toBe(0);
    expect(state.players[3]!.seasonPlayedCollab).toContain("C-13");
  });

  it("TC-637: 季限 1 — 同季第二张互动卡不可打", () => {
    const state = makeInteractionState();
    setupC12Demo(state);
    applyAction(state, {
      type: "PLAY_CARD",
      playerId: "p1",
      cardId: "C-12",
      targets: ["p2"],
      dumpKind: "debt",
    });
    declineC14(state, "p2");

    // 再塞一张 C-12
    state.players[0]!.hand.push("C-12");
    state.players[0]!.personalDebt = 1;
    state.players[0]!.workHoursRemaining = 40;
    const second = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "p1",
      cardId: "C-12",
      targets: ["p2"],
      dumpKind: "debt",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/季|用尽/);
  });

  it("全员弃权 C-13 后结算绩效（暗标并发不双结）", () => {
    const state = makeInteractionState();
    setupC13StealDemo(state);
    expect(state.pendingInteraction?.type).toBe("C13_WINDOW");

    for (const id of ["p2", "p3", "p4"]) {
      applyAction(state, { type: "PASS_C13", playerId: id });
    }
    expect(state.pendingInteraction).toBeNull();
    expect(state.players[0]!.performance).toBe(3);
    expect(state.pendingPerformanceSettlement).toBeNull();
  });
});

describe("暗标 + 互动并发", () => {
  it("暗标完成后才开 C-13，进度只加一次", () => {
    const state = makeInteractionState();
    state.progress = 22;
    state.darkBidUsed = { M1: false, M2: false, M3: false, M4: false };
    state.crossedMilestones = [];

    const result = attemptProgressGain(state, "p1", 25, null);
    expect(result.needsDarkBid).toBe(true);
    expect(state.progress).toBe(22);

    for (const id of state.playerOrder) {
      submitDarkBid(state, id, 0);
    }
    completeDarkBidAndSettle(state);
    expect(state.progress).toBe(47);
    expect(state.pendingInteraction?.type).toBe("C13_WINDOW");
    expect(state.players[0]!.performance).toBe(0);
  });
});
