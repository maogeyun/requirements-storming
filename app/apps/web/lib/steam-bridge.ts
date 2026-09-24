export type SteamShellStatus = {
  build: "steam" | "stub";
  ready: boolean;
  steamId: string | null;
  overlayEnabled: boolean;
  message: string | null;
};

type TauriInternals = {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
};

const HEX_TICKET = /^[0-9a-fA-F]{32,4096}$/;

function tauriInvoke(): TauriInternals["invoke"] | null {
  if (typeof window === "undefined") return null;
  const internals = (window as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!internals?.invoke) return null;
  return internals.invoke.bind(internals);
}

export function readInjectedSteamStatus(): SteamShellStatus | null {
  if (typeof window === "undefined") return null;
  const raw = (window as { __RS_STEAM__?: unknown }).__RS_STEAM__;
  return parseSteamStatus(raw);
}

export function parseSteamStatus(raw: unknown): SteamShellStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.build !== "steam" && row.build !== "stub") return null;
  return {
    build: row.build,
    ready: row.ready === true,
    steamId: typeof row.steamId === "string" && row.steamId ? row.steamId : null,
    overlayEnabled: row.overlayEnabled === true,
    message: typeof row.message === "string" && row.message.trim() ? row.message : null,
  };
}

async function invoke<T>(cmd: string): Promise<T | null> {
  const call = tauriInvoke();
  if (!call) return null;
  return (await call(cmd)) as T;
}

export async function refreshSteamStatus(): Promise<SteamShellStatus | null> {
  try {
    const invoked = parseSteamStatus(await invoke<unknown>("steam_status"));
    if (invoked) return invoked;
  } catch {
    // Fall through to the script the shell injected before page load.
  }
  return readInjectedSteamStatus();
}

/** Hex Web API session ticket, or null when Steam is absent (solo / browser / dev). */
export async function fetchSteamSessionTicket(): Promise<string | null> {
  try {
    const ticket = await invoke<unknown>("steam_session_ticket");
    if (typeof ticket !== "string" || !HEX_TICKET.test(ticket)) return null;
    return ticket;
  } catch {
    return null;
  }
}

export async function activateSteamOverlay(): Promise<string | null> {
  try {
    const call = tauriInvoke();
    if (!call) return "现在不能打开 Steam 浮层。人机对局不需要浮层。";
    await call("steam_activate_overlay");
    return null;
  } catch (err) {
    if (typeof err === "string" && err.trim()) return err;
    if (err instanceof Error && err.message.trim()) return err.message;
    return "现在不能打开 Steam 浮层。人机对局不需要浮层，点选出牌和强制窗不受影响。";
  }
}
