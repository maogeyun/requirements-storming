/**
 * Locked workplace palette (2026-10-09).
 * Tokens and handoff only. Play surfaces still paint from app/globals.css.
 */

export const WORKPLACE_PALETTE_VERSION = "2026-10-09" as const;

/** One role, one hex. Do not add colors that are not in this set. */
export const workplacePalette = {
  /** Graphite matte desk. Desk field only. */
  desk: "#2C3036",
  /** Matte-board sheen. Desk edge / lamp falloff only. Same material as desk. */
  deskSheen: "#3E444C",
  /** Deep warm ritual ground. Forced dialog, dark-bid reveal, final board. */
  ritual: "#14100C",
  /** Thin frosted glass. Optional. Card base / forced-dialog light outline only. */
  glass: "#C5C9CE",
  /** Exclusive action yellow. Bid pills and primary actions. */
  action: "#F5C518",
  /** Ceremonial metal. Not an action color. */
  metal: "#C4A35A",
  /** Metal highlight, inside the three metal places only. */
  metalHighlight: "#E8D5A3",
  /** Score / performance. Not action yellow. */
  score: "#E85D04",
  /** Non-action status: disconnect, bot host, match queue. */
  status: "#6B8F71",
  /** Body text and nameplate fill. */
  ink: "#E8E4D9",
  /** Secondary copy and disabled label text. */
  inkMuted: "#9A9488",
} as const;

export const GLASS_ALPHA = 0.28;

/** Tailwind `theme.extend.colors.ws`. Hex strings only; glass alpha stays on the CSS token. */
export const workplaceColors = {
  desk: workplacePalette.desk,
  "desk-sheen": workplacePalette.deskSheen,
  ritual: workplacePalette.ritual,
  glass: workplacePalette.glass,
  action: workplacePalette.action,
  metal: workplacePalette.metal,
  "metal-highlight": workplacePalette.metalHighlight,
  score: workplacePalette.score,
  status: workplacePalette.status,
  ink: workplacePalette.ink,
  "ink-muted": workplacePalette.inkMuted,
} as const;

/**
 * Optional material. Not required to paint in the tokens-only handoff.
 * Card base and the forced dialog's light outline only — never a full-screen sheet.
 */
export const frostedGlass = {
  optional: true,
  hex: workplacePalette.glass,
  alpha: GLASS_ALPHA,
  appliesTo: ["card-base", "forced-dialog-light-outline"] as const,
} as const;

/** Metal is allowed in these three places and nowhere else. */
export const METAL_PLACES = [
  "dark-bid",
  "forced-dialog-chrome",
  "nameplate",
] as const;

/** The only places action yellow may appear. */
export const ACTION_YELLOW_PLACES = [
  "primary-action-pill",
  "selected-stroke",
  "bid-pill",
] as const;

/**
 * Reveal / bid pill stays exclusive action yellow, including the dark-bid reveal.
 * This is the pill on the ritual, not the selected stroke hidden under an overlay.
 */
export const REVEAL_BID_PILL = workplacePalette.action;

/**
 * Acceptance: a forced overlay or dialog must turn the selected yellow
 * stroke/outline under it off. Dimming that stroke with the scrim is not enough.
 * Close the overlay to restore it. The reveal bid pill stays REVEAL_BID_PILL.
 */
export const FORCED_OVERLAY_SELECTED_STROKE = {
  opacity: 0 as const,
  scrimDoesNotReplace: true as const,
  /** Assist only. Keeping or raising the scrim does not clear the stroke. */
  scrimOpacityAssist: { floor: 0.72, optionalRaise: [0.75, 0.8] as const },
} as const;

export function selectedYellowStrokeOpacity(forcedOverlayOpen: boolean): 0 | 1 {
  return forcedOverlayOpen ? FORCED_OVERLAY_SELECTED_STROKE.opacity : 1;
}

export function glassOutlineColor(): string {
  const hex = workplacePalette.glass.slice(1);
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const pct = Math.round(GLASS_ALPHA * 100);
  return `rgb(${r} ${g} ${b} / ${pct}%)`;
}

export const BANNED_MATERIALS = [
  "velvet-green",
  "wood-grain",
  "crt",
  "neon",
  "full-screen-glass",
] as const;

/** Revoked felt greens. Must not re-enter the active palette. */
export const REVOKED_HEX = ["#1A2E1C", "#2A4A32"] as const;

/** P0-approved reuse of locked hexes. Not additional colors. */
export const paletteAliases = {
  seatFocusEdge: workplacePalette.ink,
  cardInkOnLight: workplacePalette.desk,
  cardFaceLight: workplacePalette.ink,
} as const;
