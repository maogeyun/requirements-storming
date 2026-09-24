import { afterEach, describe, expect, it } from "vitest";
import { matchWsUrl } from "./match-client";

type DesktopGlobal = {
  window?: { __RS_WS_URL?: string };
};

function desktopGlobal(): DesktopGlobal {
  return globalThis as DesktopGlobal;
}

describe("matchWsUrl", () => {
  const previous = process.env.NEXT_PUBLIC_WS_URL;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_WS_URL;
    } else {
      process.env.NEXT_PUBLIC_WS_URL = previous;
    }
    delete desktopGlobal().window;
  });

  it("defaults to the local match-server", () => {
    delete process.env.NEXT_PUBLIC_WS_URL;
    expect(matchWsUrl()).toBe("ws://localhost:8787");
  });

  it("uses NEXT_PUBLIC_WS_URL when the shell did not inject one", () => {
    process.env.NEXT_PUBLIC_WS_URL = "wss://gateway.example/match";
    expect(matchWsUrl()).toBe("wss://gateway.example/match");
  });

  it("prefers the desktop shell injection", () => {
    process.env.NEXT_PUBLIC_WS_URL = "ws://localhost:8787";
    desktopGlobal().window = { __RS_WS_URL: "ws://10.0.0.8:8787" };
    expect(matchWsUrl()).toBe("ws://10.0.0.8:8787");
  });

  it("ignores a non-websocket injection", () => {
    delete process.env.NEXT_PUBLIC_WS_URL;
    desktopGlobal().window = { __RS_WS_URL: "http://localhost:8787" };
    expect(matchWsUrl()).toBe("ws://localhost:8787");
  });
});
