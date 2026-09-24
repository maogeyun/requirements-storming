import { describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@rs/shared";
import { ErrorCode } from "@rs/shared";
import { createFakeClock } from "./clock";
import { leaksBotMarker } from "./fake-names";
import { MatchHub } from "./match-hub";
import {
  createTicketExchanger,
  devModeExchanger,
  exchangeSessionTicket,
  parseAuthenticateUserTicketBody,
  type TicketExchanger,
} from "./steam-auth";

const ALICE = "76561198000000001";
const BOB = "76561198000000002";
const CARA = "76561198000000003";
const DREW = "76561198000000004";

function collectEmit() {
  const inbox = new Map<string, ServerMessage[]>();
  const emit = (connectionId: string, message: ServerMessage) => {
    const list = inbox.get(connectionId) ?? [];
    list.push(message);
    inbox.set(connectionId, list);
  };
  return { inbox, emit };
}

function mapExchanger(map: Record<string, string>): TicketExchanger {
  return {
    mode: "steam",
    exchange(ticket: string) {
      const steamId = map[ticket];
      if (!steamId) throw new Error("Steam session ticket rejected");
      return { steamId };
    },
  };
}

function join(
  hub: MatchHub,
  connectionId: string,
  message: Record<string, unknown>,
): void {
  hub.handleMessage(connectionId, JSON.stringify({ seatCount: 4, ...message }));
}

describe("createTicketExchanger", () => {
  it("stays in dev when Steam publisher credentials are absent", () => {
    expect(createTicketExchanger({}).mode).toBe("dev");
    expect(createTicketExchanger({ RS_STEAM_AUTH: "dev", STEAM_WEB_API_KEY: "k" }).mode).toBe(
      "dev",
    );
  });

  it("selects steam when the publisher key and app id are set", () => {
    expect(
      createTicketExchanger({ STEAM_WEB_API_KEY: "publisher", STEAM_APP_ID: "480" }).mode,
    ).toBe("steam");
  });

  it("fails closed when steam mode is requested without a key", async () => {
    const exchanger = createTicketExchanger({ RS_STEAM_AUTH: "steam" });
    expect(exchanger.mode).toBe("steam");
    await expect(exchanger.exchange("ab".repeat(16))).rejects.toThrow(/STEAM_WEB_API_KEY/);
  });
});

describe("AuthenticateUserTicket exchange", () => {
  it("reads steamid from an OK payload", () => {
    expect(
      parseAuthenticateUserTicketBody({
        response: {
          params: { result: "OK", steamid: ALICE, ownersteamid: ALICE },
        },
      }),
    ).toEqual({ steamId: ALICE });
  });

  it("rejects an error payload", () => {
    expect(() =>
      parseAuthenticateUserTicketBody({
        response: { error: { errorcode: 101, errordesc: "Invalid ticket" } },
      }),
    ).toThrow(/Invalid ticket/);
  });

  it("does not call Steam for a non-hex ticket", async () => {
    const fetchImpl = vi.fn();
    await expect(
      exchangeSessionTicket({
        ticket: "dev:76561198000000001",
        appId: "480",
        webApiKey: "secret",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/hex/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("exchanges a hex ticket and returns the steamid", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(
        "https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/",
      );
      expect(url.searchParams.get("appid")).toBe("480");
      expect(url.searchParams.get("key")).toBe("publisher");
      expect(url.searchParams.get("ticket")).toBe("ab".repeat(32));
      return new Response(
        JSON.stringify({
          response: { params: { result: "OK", steamid: ALICE } },
        }),
        { status: 200 },
      );
    });
    await expect(
      exchangeSessionTicket({
        ticket: "ab".repeat(32),
        appId: "480",
        webApiKey: "publisher",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ steamId: ALICE });
  });
});

describe("steam session ticket replaces placeholder join auth", () => {
  it("refuses create/join/match without a ticket", () => {
    const { inbox, emit } = collectEmit();
    const hub = new MatchHub(emit, { seed: 1, exchanger: mapExchanger({ "aa": ALICE }) });

    join(hub, "c1", { type: "join", mode: "create", displayName: "Host" });
    join(hub, "c2", { type: "join", mode: "join", roomCode: "AAAAA", displayName: "B" });
    join(hub, "c3", { type: "join", mode: "match", displayName: "C" });

    expect(hub.rooms.size).toBe(0);
    expect(hub.matchQueueLength).toBe(0);
    for (const id of ["c1", "c2", "c3"]) {
      const err = (inbox.get(id) ?? []).find((message) => message.type === "error");
      expect(err?.type === "error" && err.error.code).toBe(ErrorCode.AUTH_REQUIRED);
    }
  });

  it("exchanges a ticket for a seatToken and hides the steam id", () => {
    const { inbox, emit } = collectEmit();
    const hub = new MatchHub(emit, {
      seed: 2,
      exchanger: mapExchanger({ ticket_alice: ALICE }),
    });
    join(hub, "c1", {
      type: "join",
      mode: "create",
      displayName: "Host",
      sessionTicket: "ticket_alice",
    });

    const view = (inbox.get("c1") ?? []).find((message) => message.type === "view");
    expect(view?.type).toBe("view");
    if (view?.type !== "view") return;
    expect(view.seatToken.startsWith("seat_")).toBe(true);
    expect(view.seatToken.startsWith("stub_")).toBe(false);
    const room = hub.rooms.get(view.roomCode);
    expect(room?.seats[0]?.steamId).toBe(ALICE);
    expect(JSON.stringify(inbox.get("c1"))).not.toContain(ALICE);
  });

  it("create and join still start at exactly 4 authenticated humans", () => {
    const { emit } = collectEmit();
    const tickets: Record<string, string> = {
      t1: ALICE,
      t2: BOB,
      t3: CARA,
      t4: DREW,
    };
    const hub = new MatchHub(emit, { seed: 3, exchanger: mapExchanger(tickets) });
    join(hub, "c1", { type: "join", mode: "create", displayName: "A", sessionTicket: "t1" });
    const code = [...hub.rooms.keys()][0]!;
    expect(hub.rooms.get(code)?.phase).toBe("lobby");
    join(hub, "c2", {
      type: "join",
      mode: "join",
      roomCode: code,
      displayName: "B",
      sessionTicket: "t2",
    });
    join(hub, "c3", {
      type: "join",
      mode: "join",
      roomCode: code,
      displayName: "C",
      sessionTicket: "t3",
    });
    expect(hub.rooms.get(code)?.phase).toBe("lobby");
    join(hub, "c4", {
      type: "join",
      mode: "join",
      roomCode: code,
      displayName: "D",
      sessionTicket: "t4",
    });
    expect(hub.rooms.get(code)?.phase).toBe("playing");
    expect(hub.rooms.get(code)?.seats).toHaveLength(4);
  });

  it("free-match still fills silently and does not leak steam ids or bots", () => {
    const { inbox, emit } = collectEmit();
    const clock = createFakeClock();
    const hub = new MatchHub(emit, {
      seed: 4,
      clock,
      botFillMs: 60_000,
      exchanger: mapExchanger({ t1: ALICE, t2: BOB }),
    });
    join(hub, "c1", { type: "join", mode: "match", displayName: "Alice", sessionTicket: "t1" });
    join(hub, "c2", { type: "join", mode: "match", displayName: "Bob", sessionTicket: "t2" });
    expect(hub.rooms.size).toBe(0);
    clock.tick(60_000);

    const room = [...hub.rooms.values()][0]!;
    expect(room.phase).toBe("playing");
    expect(room.seats).toHaveLength(4);
    expect(room.botSeatIds()).toHaveLength(2);
    expect(room.seats.find((seat) => seat.connectionId === "c1")?.steamId).toBe(ALICE);
    expect(room.seats.filter((seat) => seat.isBot).every((seat) => seat.steamId === null)).toBe(
      true,
    );
    const payload = JSON.stringify(inbox.get("c1") ?? []);
    expect(leaksBotMarker(payload)).toBe(false);
    expect(payload).not.toContain(ALICE);
    expect(payload).not.toContain('"isBot"');
  });

  it("45s disconnect reclaim still works with the issued seatToken and no new ticket", () => {
    const { inbox, emit } = collectEmit();
    const clock = createFakeClock();
    const hub = new MatchHub(emit, {
      seed: 5,
      clock,
      exchanger: mapExchanger({ t1: ALICE, t2: BOB, t3: CARA, t4: DREW }),
    });
    const people = [
      ["c1", "A", "t1"],
      ["c2", "B", "t2"],
      ["c3", "C", "t3"],
      ["c4", "D", "t4"],
    ] as const;
    join(hub, people[0][0], {
      type: "join",
      mode: "create",
      displayName: people[0][1],
      sessionTicket: people[0][2],
    });
    const code = [...hub.rooms.keys()][0]!;
    for (const [id, name, ticket] of people.slice(1)) {
      join(hub, id, {
        type: "join",
        mode: "join",
        roomCode: code,
        displayName: name,
        sessionTicket: ticket,
      });
    }
    const room = hub.rooms.get(code)!;
    expect(room.phase).toBe("playing");
    const seat = room.seats.find((candidate) => candidate.connectionId === "c2")!;
    const token = seat.seatToken;

    inbox.clear();
    hub.onDisconnect("c2");
    const presence = (inbox.get("c1") ?? []).find((message) => message.type === "view");
    expect(presence?.type === "view" && presence.presence?.[seat.seatId]?.graceRemainingSec).toBe(
      45,
    );
    expect(seat.disconnectHosted).toBe(false);

    clock.tick(45_000);
    expect(seat.disconnectHosted).toBe(true);

    inbox.clear();
    join(hub, "c2-back", {
      type: "join",
      mode: "join",
      roomCode: code,
      displayName: "B",
      seatToken: token,
    });
    expect(seat.connected).toBe(true);
    expect(seat.disconnectHosted).toBe(false);
    expect(seat.steamId).toBe(BOB);
    const snap = (inbox.get("c2-back") ?? []).find((message) => message.type === "view");
    expect(snap?.type === "view" && snap.reclaimed).toBe(true);
    expect(snap?.type === "view" && snap.seatToken).toBe(token);
  });

  it("a fresh ticket for the same SteamID reclaims the disconnected seat", () => {
    const { emit } = collectEmit();
    const hub = new MatchHub(emit, {
      seed: 6,
      exchanger: mapExchanger({ first: ALICE, second: ALICE }),
    });
    join(hub, "c1", {
      type: "join",
      mode: "create",
      displayName: "Host",
      sessionTicket: "first",
    });
    const room = [...hub.rooms.values()][0]!;
    const token = room.seats[0]!.seatToken;
    hub.onDisconnect("c1");
    join(hub, "c1-new", {
      type: "join",
      mode: "create",
      displayName: "Host",
      sessionTicket: "second",
    });
    expect(hub.rooms.size).toBe(1);
    expect(room.seats).toHaveLength(1);
    expect(room.seats[0]?.connectionId).toBe("c1-new");
    expect(room.seats[0]?.seatToken).toBe(token);
    expect(room.seats[0]?.steamId).toBe(ALICE);
  });

  it("waits for an async Web API exchange before creating a room", async () => {
    const { emit } = collectEmit();
    let resolveTicket: (value: { steamId: string }) => void = () => {};
    const exchanger: TicketExchanger = {
      mode: "steam",
      exchange() {
        return new Promise((resolve) => {
          resolveTicket = resolve;
        });
      },
    };
    const hub = new MatchHub(emit, { seed: 7, exchanger });
    join(hub, "c1", {
      type: "join",
      mode: "create",
      displayName: "Host",
      sessionTicket: "ab".repeat(20),
    });
    expect(hub.rooms.size).toBe(0);
    resolveTicket({ steamId: ALICE });
    await vi.waitFor(() => expect(hub.rooms.size).toBe(1));
    expect([...hub.rooms.values()][0]?.seats[0]?.steamId).toBe(ALICE);
  });
});

describe("dev mode keeps local multiplayer working without Steam", () => {
  it("creates a room with no ticket and does not invent a steam id", () => {
    const { emit } = collectEmit();
    const hub = new MatchHub(emit, { seed: 8, exchanger: devModeExchanger() });
    join(hub, "c1", { type: "join", mode: "create", displayName: "Host" });
    const room = [...hub.rooms.values()][0]!;
    expect(room.phase).toBe("lobby");
    expect(room.seats[0]?.steamId).toBeNull();
    expect(room.seats[0]?.seatToken.startsWith("stub_")).toBe(false);
  });

  it("binds a dev: ticket without calling Steam", () => {
    const { inbox, emit } = collectEmit();
    const hub = new MatchHub(emit, { seed: 9, exchanger: devModeExchanger() });
    join(hub, "c1", {
      type: "join",
      mode: "create",
      displayName: "Host",
      sessionTicket: `dev:${ALICE}`,
    });
    expect([...hub.rooms.values()][0]?.seats[0]?.steamId).toBe(ALICE);
    expect(JSON.stringify(inbox.get("c1"))).not.toContain(ALICE);
  });
});
