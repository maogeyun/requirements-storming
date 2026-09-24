import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_BOT_COPY,
  FREE_MATCH_LABEL,
  FREE_MATCH_QUEUE_SUB,
  assertNoBotCopy,
  freeMatchQueueMain,
} from "./lobby-copy";

describe("lobby free-match copy locks", () => {
  it("queue main/sub never mention Bot, 补位, or 匹配失败", () => {
    const main = freeMatchQueueMain(12);
    expect(main).toBe("正在匹配玩家 · 12s");
    expect(assertNoBotCopy(main)).toBe(true);
    expect(assertNoBotCopy(FREE_MATCH_QUEUE_SUB)).toBe(true);
    expect(assertNoBotCopy(FREE_MATCH_LABEL)).toBe(true);
    expect(assertNoBotCopy("排队入桌 · 无需二次确认")).toBe(true);
    for (const bad of FORBIDDEN_BOT_COPY) {
      expect(main.includes(bad)).toBe(false);
      expect(FREE_MATCH_QUEUE_SUB.includes(bad)).toBe(false);
    }
  });
});
