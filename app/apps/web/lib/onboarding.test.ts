import { describe, expect, it } from "vitest";
import { DISCONNECT_GRACE_MS } from "@rs/shared";
import { assertNoBotCopy, FORBIDDEN_BOT_COPY } from "./lobby-copy";
import { disconnectTopBar } from "./online-disconnect-copy";
import {
  ENTRY_GUIDE,
  ONBOARDING_DONE_KEY,
  ONBOARDING_TIPS_KEY,
  ONLINE_HINT,
  STEP1_LINE,
  applyBeginReplay,
  applyCompleteConfirm,
  applySkip,
  armOnlineHint,
  coachContextFromLocalTable,
  coachContextFromOnline,
  coachTipCopy,
  consumeOnlineHint,
  dismissOnlineHint,
  defaultDisconnectGraceSec,
  freeMatchGuideBlurb,
  readDone,
  readTips,
  selectCoachTip,
  softTipsAllowed,
  writeTip,
  type CoachContext,
  type CoachTipId,
  type Kv,
} from "./onboarding";

function memoryKv(): Kv {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function ctx(partial: Partial<CoachContext> = {}): CoachContext {
  return {
    inMatchQueue: false,
    endgameBoard: false,
    inOwnActionArea: false,
    ownOkrVisible: false,
    forcedBid: false,
    c14Window: false,
    sprintSwitch: false,
    disconnectBar: false,
    disconnectGraceSec: 45,
    allowSoft: true,
    ...partial,
  };
}

describe("onboarding persistence", () => {
  it("skip and replay do not clear tip.seen", () => {
    const local = memoryKv();
    const session = memoryKv();
    writeTip(local, "tip.forced_bid");
    writeTip(local, "tip.c14");
    applyBeginReplay(session);
    expect(readTips(local)).toEqual(["tip.forced_bid", "tip.c14"]);
    expect(readDone(local)).toBe(false);
    expect(local.getItem(ONBOARDING_TIPS_KEY)).toContain("tip.c14");

    applySkip(local, session);
    expect(readDone(local)).toBe(true);
    expect(local.getItem(ONBOARDING_DONE_KEY)).toBe("1");
    expect(readTips(local)).toEqual(["tip.forced_bid", "tip.c14"]);
    expect(session.getItem("onboarding.v1.replay")).toBeNull();
  });

  it("开局 writes done and keeps tips; same session still allows soft tips", () => {
    const local = memoryKv();
    const session = memoryKv();
    writeTip(local, "tip.sprint_switch");
    applyCompleteConfirm(local, session);
    expect(readDone(local)).toBe(true);
    expect(readTips(local)).toEqual(["tip.sprint_switch"]);
    expect(softTipsAllowed(local, session)).toBe(true);
    expect(softTipsAllowed(local, memoryKv())).toBe(false);
  });

  it("prefer-AI hint is once and survives replay", () => {
    const local = memoryKv();
    const session = memoryKv();
    armOnlineHint(local, session);
    expect(consumeOnlineHint(local, session)).toBe(ONLINE_HINT);
    expect(consumeOnlineHint(local, session)).toBe(ONLINE_HINT);
    dismissOnlineHint(session);
    expect(consumeOnlineHint(local, session)).toBeNull();
    applyBeginReplay(session);
    armOnlineHint(local, session);
    expect(consumeOnlineHint(local, session)).toBeNull();
  });
});

describe("coach tip selection", () => {
  it("suppresses tips during match queue, idle opponent turns, and the MVP board", () => {
    const seen = new Set<string>();
    expect(
      selectCoachTip(ctx({ inMatchQueue: true, forcedBid: true, disconnectBar: true }), seen),
    ).toBeNull();
    expect(
      selectCoachTip(ctx({ endgameBoard: true, sprintSwitch: true, disconnectBar: true }), seen),
    ).toBeNull();
    expect(
      selectCoachTip(ctx({ allowSoft: true, inOwnActionArea: false, ownOkrVisible: true }), seen),
    ).toBeNull();
  });

  it("shows each tip at most once and prefers the forced window over soft tips", () => {
    const seen = new Set<string>();
    const both = ctx({
      allowSoft: true,
      inOwnActionArea: true,
      ownOkrVisible: true,
      forcedBid: true,
    });
    expect(selectCoachTip(both, seen)).toBe("tip.forced_bid");
    seen.add("tip.forced_bid");
    expect(selectCoachTip(both, seen)).toBe("tip.turn_phases");
    seen.add("tip.turn_phases");
    expect(selectCoachTip(both, seen)).toBe("tip.okr_private");
    seen.add("tip.okr_private");
    expect(selectCoachTip(both, seen)).toBeNull();
  });

  it("after done, only unseen forced-window tips auto-open", () => {
    const seen = new Set<string>();
    const later = ctx({
      allowSoft: false,
      inOwnActionArea: true,
      ownOkrVisible: true,
      c14Window: true,
      disconnectBar: true,
    });
    expect(selectCoachTip(later, seen)).toBe("tip.c14");
    seen.add("tip.c14");
    expect(selectCoachTip(later, seen)).toBe("tip.disconnect");
    seen.add("tip.disconnect");
    expect(selectCoachTip(ctx({ allowSoft: false, inOwnActionArea: true, ownOkrVisible: true }), seen)).toBeNull();
  });

  it("maps the local table: bot turn is idle, human forced bid is not", () => {
    const idle = coachContextFromLocalTable({
      allowSoft: true,
      gameOver: false,
      endgameRitual: false,
      vsBot: true,
      humanTurn: false,
      actionLocked: true,
      showForced: false,
      forced: null,
      sprintSwitch: false,
      okrVisible: true,
    });
    expect(selectCoachTip(idle, new Set())).toBeNull();

    const bid = coachContextFromLocalTable({
      allowSoft: false,
      gameOver: false,
      endgameRitual: false,
      vsBot: true,
      humanTurn: false,
      actionLocked: true,
      showForced: true,
      forced: "catch_up_dark_bid",
      sprintSwitch: false,
      okrVisible: true,
    });
    expect(selectCoachTip(bid, new Set())).toBe("tip.forced_bid");
  });

  it("maps online disconnect seconds and ignores match queue", () => {
    const queued = coachContextFromOnline({
      allowSoft: true,
      inMatchQueue: true,
      gameOver: false,
      disconnectBar: true,
      graceSec: 45,
      forceKind: null,
      ownTurn: true,
    });
    expect(selectCoachTip(queued, new Set())).toBeNull();

    const dropped = coachContextFromOnline({
      allowSoft: false,
      inMatchQueue: false,
      gameOver: false,
      disconnectBar: true,
      graceSec: 30,
      forceKind: null,
      ownTurn: false,
    });
    expect(selectCoachTip(dropped, new Set())).toBe("tip.disconnect");
    expect(dropped.disconnectGraceSec).toBe(30);
  });
});

describe("onboarding copy locks", () => {
  it("step 1 does not explain rooms, match, or disconnect", () => {
    expect(STEP1_LINE).toBe("半合作推需求上线，绩效比拼当 MVP。");
    expect(STEP1_LINE.includes("建房")).toBe(false);
    expect(STEP1_LINE.includes("匹配")).toBe(false);
    expect(STEP1_LINE.includes("断线")).toBe(false);
  });

  it("free-match guide blurb never leaks Bot fill", () => {
    const line = freeMatchGuideBlurb();
    expect(line).toBe("排队凑桌，无需房号");
    expect(assertNoBotCopy(line)).toBe(true);
    expect(assertNoBotCopy(ENTRY_GUIDE.local)).toBe(true);
    for (const bad of FORBIDDEN_BOT_COPY) {
      expect(line.includes(bad)).toBe(false);
    }
  });

  it("disconnect tip matches the top bar seconds and stays distinct from fill copy", () => {
    expect(defaultDisconnectGraceSec()).toBe(45);
    expect(DISCONNECT_GRACE_MS).toBe(45_000);
    const tip = coachTipCopy("tip.disconnect", 45);
    expect(tip.title).toBe("连接中断");
    expect(tip.body).toBe("45 秒内可回；超时本座托管；回连夺回。");
    expect(disconnectTopBar(45)).toBe("连接中断 · 45 秒内可回");
    expect(tip.body.startsWith("45 秒内可回")).toBe(true);
    expect(assertNoBotCopy(tip.body)).toBe(true);
    expect(tip.body.includes("补位")).toBe(false);

    const server = coachTipCopy("tip.disconnect", 12);
    expect(server.body.startsWith("12 秒内可回")).toBe(true);
    expect(disconnectTopBar(12)).toContain("12 秒内可回");
  });

  it("every coach title is at most 8 characters and includes 知道了 copy", () => {
    const ids: CoachTipId[] = [
      "tip.turn_phases",
      "tip.okr_private",
      "tip.forced_bid",
      "tip.c14",
      "tip.sprint_switch",
      "tip.disconnect",
    ];
    for (const id of ids) {
      const copy = coachTipCopy(id, 45);
      expect(Array.from(copy.title).length).toBeLessThanOrEqual(8);
      expect(copy.body.length).toBeGreaterThan(0);
    }
    expect(coachTipCopy("tip.forced_bid").body.includes("0–8")).toBe(true);
    expect(coachTipCopy("tip.okr_private").body).toBe("自己的 OKR 保密，结算才亮。");
  });
});
