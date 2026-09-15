import { describe, expect, it } from "vitest";
import { DISCONNECT_GRACE_MS } from "@rs/shared";
import {
  anchorDisconnectGraceDeadline,
  deadlineFromServerGraceRemainingSec,
  graceSecondsLeft,
} from "./online-disconnect-grace";

describe("anchorDisconnectGraceDeadline (JOJO P2)", () => {
  const now = 1_000_000;

  it("anchors deadline on first disconnect", () => {
    expect(anchorDisconnectGraceDeadline(null, now)).toBe(
      now + DISCONNECT_GRACE_MS,
    );
  });

  it("second onClose does not extend an existing deadline", () => {
    const first = anchorDisconnectGraceDeadline(null, now);
    const later = now + 2_000;
    expect(anchorDisconnectGraceDeadline(first, later)).toBe(first);
    expect(graceSecondsLeft(first, later)).toBe(43);
  });

  it("does not restart after the anchored deadline expires", () => {
    const first = anchorDisconnectGraceDeadline(null, now);
    const afterExpiry = now + DISCONNECT_GRACE_MS + 5_000;
    expect(anchorDisconnectGraceDeadline(first, afterExpiry)).toBe(first);
    expect(graceSecondsLeft(first, afterExpiry)).toBe(0);
  });

  it("aligns display deadline from server graceRemainingSec", () => {
    expect(deadlineFromServerGraceRemainingSec(12, now)).toBe(now + 12_000);
  });
});
