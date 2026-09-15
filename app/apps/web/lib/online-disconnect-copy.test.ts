import { describe, expect, it } from "vitest";
import { DISCONNECT_GRACE_MS } from "@rs/shared";
import { assertNoBotCopy } from "./lobby-copy";
import {
  DISCONNECT_HOSTED_HINT,
  DISCONNECT_RECLAIM_TOAST,
  disconnectTopBar,
} from "./online-disconnect-copy";

describe("online disconnect copy (i-pple)", () => {
  it("top bar uses locked grace wording", () => {
    expect(disconnectTopBar(45)).toBe("连接中断 · 45 秒内可回");
    expect(disconnectTopBar(0)).toBe("连接中断 · 0 秒内可回");
    expect(DISCONNECT_GRACE_MS).toBe(45_000);
  });

  it("post-timeout hosted hint and reclaim toast are locked", () => {
    expect(DISCONNECT_HOSTED_HINT).toBe("本座已托管");
    expect(DISCONNECT_RECLAIM_TOAST).toBe("座位已收回");
  });

  it("free-match copy lock still forbids Bot reveal (unchanged)", () => {
    // Online disconnect may say 托管; free-match ambient must not.
    expect(assertNoBotCopy("正在匹配玩家 · 12s")).toBe(true);
    expect(assertNoBotCopy("预计不久开局")).toBe(true);
  });
});
