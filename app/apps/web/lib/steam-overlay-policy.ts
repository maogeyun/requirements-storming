/**
 * Steam overlay chrome must stay out of the play surface.
 * The shell opens the Steam client overlay; it does not add a capturing layer
 * over click-to-play cards or forced windows.
 */
export const STEAM_OVERLAY_CHROME = {
  className: "steam-shell-chrome",
  position: "static",
  pointerEvents: "none",
  blocksPlayTargets: false,
  mustNotCover: [".hand-card", ".forced-window"],
} as const;

/** Human-vs-AI uses the local rules engine and does not wait on Steam. */
export function soloPlayRequiresSteam(): boolean {
  return false;
}

export function steamOverlayBlocksPlay(): boolean {
  return (
    STEAM_OVERLAY_CHROME.blocksPlayTargets ||
    STEAM_OVERLAY_CHROME.position !== "static" ||
    STEAM_OVERLAY_CHROME.pointerEvents !== "none"
  );
}
