import { describe, expect, it } from "vitest";
import { DISCONNECT_GRACE_MS } from "@rs/shared";
import {
  anchorDisconnectGraceDeadline,
  disconnectDisplayFromPresence,
  graceSecondsLeft,
  syncDisplayDeadlineFromServerRemaining,
} from "./online-disconnect-grace";

describe("disconnect grace display (JOJO P2 / RedQueen)", () => {
  const now = 1_000_000;

  it("anchors local display deadline on first disconnect only", () => {
    expect(anchorDisconnectGraceDeadline(null, now)).toBe(
      now + DISCONNECT_GRACE_MS,
    );
  });

  it("second onClose does not reset/fake-extend the display deadline", () => {
    const first = anchorDisconnectGraceDeadline(null, now);
    const later = now + 2_000;
    expect(anchorDisconnectGraceDeadline(first, later)).toBe(first);
    expect(graceSecondsLeft(first, later)).toBe(43);
  });

  it("does not restart display countdown after local deadline expires", () => {
    const first = anchorDisconnectGraceDeadline(null, now);
    const afterExpiry = now + DISCONNECT_GRACE_MS + 5_000;
    expect(anchorDisconnectGraceDeadline(first, afterExpiry)).toBe(first);
    expect(graceSecondsLeft(first, afterExpiry)).toBe(0);
  });

  it("syncs display deadline from server graceRemainingSec (server wins)", () => {
    const local = anchorDisconnectGraceDeadline(null, now);
    const fromServer = syncDisplayDeadlineFromServerRemaining(12, now + 5_000);
    expect(fromServer).toBe(now + 5_000 + 12_000);
    expect(fromServer).not.toBe(local);
  });

  it("maps presence.graceRemainingSec / hosted to display (no second clock)", () => {
    expect(
      disconnectDisplayFromPresence({
        connected: false,
        graceRemainingSec: 30,
        hosted: false,
      }),
    ).toEqual({ kind: "grace", remainingSec: 30 });
    expect(
      disconnectDisplayFromPresence({
        connected: false,
        graceRemainingSec: 0,
        hosted: false,
      }),
    ).toEqual({ kind: "hosted" });
    expect(
      disconnectDisplayFromPresence({
        connected: false,
        graceRemainingSec: null,
        hosted: true,
      }),
    ).toEqual({ kind: "hosted" });
    expect(
      disconnectDisplayFromPresence({
        connected: true,
        graceRemainingSec: null,
        hosted: false,
      }),
    ).toEqual({ kind: "ok" });
  });
});
