"use client";

import { useEffect, useState } from "react";
import {
  activateSteamOverlay,
  refreshSteamStatus,
  type SteamShellStatus,
} from "../lib/steam-bridge";
import {
  STEAM_OVERLAY_CHROME,
  steamOverlayBlocksPlay,
} from "../lib/steam-overlay-policy";

/**
 * In-flow Steam status. Not a modal and not a click shield:
 * `pointer-events: none` except the overlay button, `position: static`.
 */
export function SteamShellChrome() {
  const [status, setStatus] = useState<SteamShellStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void refreshSteamStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;

  return (
    <aside
      className={STEAM_OVERLAY_CHROME.className}
      data-blocks-play={steamOverlayBlocksPlay() ? "1" : "0"}
      aria-label="Steam"
    >
      {status.message ? (
        <p className="steam-shell-message" role="alert">
          {status.message}
        </p>
      ) : null}
      {status.ready && status.steamId ? (
        <p className="steam-shell-id" role="status">
          SteamID {status.steamId}
        </p>
      ) : null}
      {status.build === "steam" ? (
        <button
          type="button"
          className="ghost"
          onClick={(event) => {
            event.stopPropagation();
            void activateSteamOverlay().then((error) => setNote(error));
          }}
        >
          打开 Steam 浮层
        </button>
      ) : null}
      {note ? (
        <p className="steam-shell-message" role="status">
          {note}
        </p>
      ) : null}
    </aside>
  );
}
