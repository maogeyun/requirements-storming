/**
 * Steam session-ticket exchange for match-server auth.
 *
 * Production (`RS_STEAM_AUTH=steam` plus `STEAM_WEB_API_KEY` and `STEAM_APP_ID`)
 * calls ISteamUserAuth/AuthenticateUserTicket and only then may a seat be issued.
 * Local / CI default is `dev`: create / join / free-match keep working without a
 * Steam client. Dev mode does not pretend a raw ticket was verified.
 */

export type TicketExchange = {
  steamId: string;
};

export type TicketExchanger = {
  readonly mode: "dev" | "steam";
  exchange(ticket: string): TicketExchange | Promise<TicketExchange>;
};

const DEV_TICKET = /^dev:(\d{17})$/;
const HEX_TICKET = /^[0-9a-fA-F]{32,4096}$/;
const STEAM_ID64 = /^\d{17}$/;

const AUTHENTICATE_USER_TICKET =
  "https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/";

type AuthResponse = {
  response?: {
    params?: {
      result?: string;
      steamid?: string;
    };
    error?: {
      errorcode?: number;
      errordesc?: string;
    };
  };
};

export function devModeExchanger(): TicketExchanger {
  return {
    mode: "dev",
    exchange(ticket: string): TicketExchange {
      const matched = DEV_TICKET.exec(ticket.trim());
      if (!matched?.[1]) {
        throw new Error("dev ticket must look like dev:<17-digit steamid>");
      }
      return { steamId: matched[1] };
    },
  };
}

export function steamWebApiExchanger(options: {
  appId: string;
  webApiKey: string;
  fetchImpl?: typeof fetch;
}): TicketExchanger {
  return {
    mode: "steam",
    exchange(ticket: string) {
      return exchangeSessionTicket({
        ticket,
        appId: options.appId,
        webApiKey: options.webApiKey,
        fetchImpl: options.fetchImpl,
      });
    },
  };
}

/** Steam mode with no publisher key: fail closed. Never fall back to unsigned joins. */
export function unconfiguredSteamExchanger(): TicketExchanger {
  return {
    mode: "steam",
    exchange() {
      return Promise.reject(
        new Error("STEAM_WEB_API_KEY and STEAM_APP_ID are required when RS_STEAM_AUTH=steam"),
      );
    },
  };
}

/**
 * `RS_STEAM_AUTH=steam` requires the Web API publisher key and AppID.
 * `RS_STEAM_AUTH=dev` forces the local exchanger.
 * Unset + key + app id selects Steam. Unset without a key stays dev so local
 * create / join / free-match / disconnect grace keep working.
 */
export function createTicketExchanger(env: NodeJS.ProcessEnv): TicketExchanger {
  const mode = env.RS_STEAM_AUTH?.trim();
  const webApiKey = env.STEAM_WEB_API_KEY?.trim() ?? "";
  const appId = env.STEAM_APP_ID?.trim() ?? "";
  if (mode === "dev") return devModeExchanger();
  if (mode === "steam") {
    if (!webApiKey || !appId) return unconfiguredSteamExchanger();
    return steamWebApiExchanger({ appId, webApiKey });
  }
  if (webApiKey && appId) return steamWebApiExchanger({ appId, webApiKey });
  return devModeExchanger();
}

export function parseAuthenticateUserTicketBody(body: unknown): TicketExchange {
  const response = (body as AuthResponse | null)?.response;
  const steamId = response?.params?.steamid?.trim() ?? "";
  const result = response?.params?.result?.trim() ?? "";
  if (result === "OK" && STEAM_ID64.test(steamId)) {
    return { steamId };
  }
  const desc = response?.error?.errordesc?.trim();
  throw new Error(desc || "Steam rejected the session ticket");
}

export async function exchangeSessionTicket(options: {
  ticket: string;
  appId: string;
  webApiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<TicketExchange> {
  const ticket = options.ticket.trim();
  if (!HEX_TICKET.test(ticket)) {
    throw new Error("Steam session ticket must be hex");
  }
  if (!options.appId.trim() || !options.webApiKey.trim()) {
    throw new Error("STEAM_WEB_API_KEY and STEAM_APP_ID are required");
  }

  const url = new URL(AUTHENTICATE_USER_TICKET);
  url.searchParams.set("key", options.webApiKey);
  url.searchParams.set("appid", options.appId.trim());
  url.searchParams.set("ticket", ticket);

  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Steam Web API HTTP ${res.status}`);
  }
  return parseAuthenticateUserTicketBody(await res.json());
}
