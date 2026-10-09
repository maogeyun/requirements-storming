import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tailwindConfig from "../tailwind.config";
import {
  ACTION_YELLOW_PLACES,
  BANNED_MATERIALS,
  FORCED_OVERLAY_SELECTED_STROKE,
  GLASS_ALPHA,
  METAL_PLACES,
  REVOKED_HEX,
  REVEAL_BID_PILL,
  frostedGlass,
  glassOutlineColor,
  paletteAliases,
  selectedYellowStrokeOpacity,
  workplaceColors,
  workplacePalette,
} from "./workplace-palette";

const LOCKED_HEX = {
  desk: "#2C3036",
  deskSheen: "#3E444C",
  ritual: "#14100C",
  glass: "#C5C9CE",
  action: "#F5C518",
  metal: "#C4A35A",
  metalHighlight: "#E8D5A3",
  score: "#E85D04",
  status: "#6B8F71",
  ink: "#E8E4D9",
  inkMuted: "#9A9488",
} as const;

describe("workplace palette tokens", () => {
  it("matches the locked 2026-10-09 hexes", () => {
    expect(workplacePalette).toEqual(LOCKED_HEX);
    expect(GLASS_ALPHA).toBe(0.28);
    expect(glassOutlineColor()).toBe("rgb(197 201 206 / 28%)");
  });

  it("keeps reveal and bid pills on exclusive action yellow", () => {
    expect(REVEAL_BID_PILL).toBe("#F5C518");
    expect(workplacePalette.action).toBe("#F5C518");
    expect(ACTION_YELLOW_PLACES).toEqual([
      "primary-action-pill",
      "selected-stroke",
      "bid-pill",
    ]);
    const others = Object.entries(workplacePalette).filter(([key]) => key !== "action");
    for (const [, hex] of others) {
      expect(hex).not.toBe("#F5C518");
    }
  });

  it("turns selected yellow stroke off under a forced overlay", () => {
    expect(FORCED_OVERLAY_SELECTED_STROKE.opacity).toBe(0);
    expect(FORCED_OVERLAY_SELECTED_STROKE.scrimDoesNotReplace).toBe(true);
    expect(FORCED_OVERLAY_SELECTED_STROKE.scrimOpacityAssist.floor).toBe(0.72);
    expect(selectedYellowStrokeOpacity(true)).toBe(0);
    expect(selectedYellowStrokeOpacity(false)).toBe(1);
  });

  it("limits metal to three places and keeps glass optional", () => {
    expect(METAL_PLACES).toEqual([
      "dark-bid",
      "forced-dialog-chrome",
      "nameplate",
    ]);
    expect(frostedGlass.optional).toBe(true);
    expect(frostedGlass.hex).toBe("#C5C9CE");
    expect(frostedGlass.alpha).toBe(0.28);
    expect(frostedGlass.appliesTo).toEqual([
      "card-base",
      "forced-dialog-light-outline",
    ]);
  });

  it("does not revive velvet green", () => {
    expect(BANNED_MATERIALS).toEqual([
      "velvet-green",
      "wood-grain",
      "crt",
      "neon",
      "full-screen-glass",
    ]);
    const active = new Set(Object.values(workplacePalette).map((hex) => hex.toUpperCase()));
    for (const revoked of REVOKED_HEX) {
      expect(active.has(revoked)).toBe(false);
    }
  });

  it("reuses locked hexes for the P0 aliases", () => {
    expect(paletteAliases.seatFocusEdge).toBe("#E8E4D9");
    expect(paletteAliases.cardFaceLight).toBe("#E8E4D9");
    expect(paletteAliases.cardInkOnLight).toBe("#2C3036");
  });

  it("publishes the same hexes as CSS variables and Tailwind ws colors", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "workplace-palette.css"),
      "utf8",
    );
    const declared: Record<string, string> = {
      "--ws-desk": LOCKED_HEX.desk,
      "--ws-desk-sheen": LOCKED_HEX.deskSheen,
      "--ws-ritual": LOCKED_HEX.ritual,
      "--ws-glass": LOCKED_HEX.glass,
      "--ws-action": LOCKED_HEX.action,
      "--ws-metal": LOCKED_HEX.metal,
      "--ws-metal-highlight": LOCKED_HEX.metalHighlight,
      "--ws-score": LOCKED_HEX.score,
      "--ws-status": LOCKED_HEX.status,
      "--ws-ink": LOCKED_HEX.ink,
      "--ws-ink-muted": LOCKED_HEX.inkMuted,
    };
    for (const [name, hex] of Object.entries(declared)) {
      expect(css).toContain(`${name}: ${hex};`);
    }
    expect(css).toContain("--ws-glass-alpha: 0.28;");
    expect(css).toContain(`--ws-glass-outline: ${glassOutlineColor()};`);
    expect(css).toContain("--ws-selected-stroke-under-overlay: 0;");

    const colors = tailwindConfig.theme?.extend?.colors as {
      brand: { DEFAULT: string; dark: string };
      ws: typeof workplaceColors;
    };
    expect(colors.brand).toEqual({ DEFAULT: "#2563eb", dark: "#1d4ed8" });
    expect(colors.ws).toEqual(workplaceColors);
    expect(colors.ws.action).toBe("#F5C518");
    expect(colors.ws.desk).toBe("#2C3036");
    expect(colors.ws["desk-sheen"]).toBe("#3E444C");
  });
});
