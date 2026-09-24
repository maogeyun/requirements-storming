import { describe, expect, it } from "vitest";
import { multiplayerAuthErrorCopy } from "./steam-auth-copy";
import { parseSteamStatus } from "./steam-bridge";

describe("steam shell status", () => {
  it("parses the injected failure when the Steam client is not running", () => {
    const status = parseSteamStatus({
      build: "steam",
      ready: false,
      steamId: null,
      overlayEnabled: false,
      message: "Steam 客户端未运行。请先启动 Steam 并登录，再重新打开游戏。人机对局仍可开始；联机鉴权不可用。",
    });
    expect(status?.ready).toBe(false);
    expect(status?.message).toContain("Steam 客户端未运行");
    expect(status?.message).toContain("人机对局仍可开始");
  });

  it("parses a ready SteamID", () => {
    expect(
      parseSteamStatus({
        build: "steam",
        ready: true,
        steamId: "76561198000000001",
        overlayEnabled: true,
        message: null,
      })?.steamId,
    ).toBe("76561198000000001");
  });

  it("ignores a browser page with no shell injection", () => {
    expect(parseSteamStatus(undefined)).toBeNull();
    expect(parseSteamStatus({ build: "nope" })).toBeNull();
  });
});

describe("multiplayer auth copy", () => {
  it("explains a missing or rejected session ticket without blocking solo play", () => {
    expect(multiplayerAuthErrorCopy("AUTH_REQUIRED")).toContain("人机对局不需要 Steam");
    expect(multiplayerAuthErrorCopy("AUTH_FAILED")).toContain("票据校验失败");
    expect(multiplayerAuthErrorCopy("ROOM_FULL")).toBeNull();
  });
});
