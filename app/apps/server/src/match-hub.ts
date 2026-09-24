import type { ClientJoin, ClientMessage, ServerMessage } from "@rs/shared";
import { ErrorCode } from "@rs/shared";
import {
  MATCH_BOT_FILL_MS,
  type MatchClock,
  defaultMatchClock,
} from "./clock";
import { pickFakeDisplayNames } from "./fake-names";
import { MatchRoom, type SeatBinding } from "./match-room";
import { devModeExchanger, type TicketExchanger } from "./steam-auth";

export type EmitFn = (connectionId: string, message: ServerMessage) => void;

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Promise<T>).then === "function"
  );
}

function generateRoomCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let code = "";
    for (let i = 0; i < 5; i += 1) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
    if (!existing.has(code)) return code;
  }
  throw new Error("Failed to allocate room code");
}

/**
 * In-memory room registry: create-with-code / join / free-match
 * (humans prefer; after 60s silent Bot fill with fake names).
 */
interface MatchQueueEntry {
  connectionId: string;
  displayName: string;
  enqueuedAt: number;
  /** Set after a dev:/Steam ticket exchange. Null in local dev joins. */
  steamId: string | null;
}

export interface MatchHubOptions {
  seed?: number;
  clock?: MatchClock;
  /** Override 60s for tests */
  botFillMs?: number;
  /**
   * Session-ticket exchanger. Default is dev mode (no Steam client required).
   * Pass a steam-mode exchanger to require AuthenticateUserTicket.
   */
  exchanger?: TicketExchanger;
}

export class MatchHub {
  readonly rooms = new Map<string, MatchRoom>();
  private readonly matchQueue: MatchQueueEntry[] = [];
  private readonly connectionRoom = new Map<string, string>();
  private readonly emit: EmitFn;
  private readonly seed?: number;
  private readonly clock: MatchClock;
  private readonly botFillMs: number;
  private readonly exchanger: TicketExchanger;
  private matchFillTimer: unknown = null;

  constructor(emit: EmitFn, options?: MatchHubOptions) {
    this.emit = emit;
    this.seed = options?.seed;
    this.clock = options?.clock ?? defaultMatchClock;
    this.botFillMs = options?.botFillMs ?? MATCH_BOT_FILL_MS;
    this.exchanger = options?.exchanger ?? devModeExchanger();
  }

  get authMode(): "dev" | "steam" {
    return this.exchanger.mode;
  }

  /** Test/observe: current free-match queue depth. */
  get matchQueueLength(): number {
    return this.matchQueue.length;
  }

  handleMessage(connectionId: string, raw: string): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.emit(connectionId, {
        type: "error",
        error: { code: ErrorCode.INVALID_MESSAGE, message: "Invalid JSON message" },
      });
      return;
    }

    if (!message || typeof message !== "object" || !("type" in message)) {
      this.emit(connectionId, {
        type: "error",
        error: { code: ErrorCode.INVALID_MESSAGE, message: "Missing message type" },
      });
      return;
    }

    if (message.type === "join") {
      this.beginJoin(connectionId, message);
      return;
    }

    // Cancel free-match while still in ambient queue (not yet seated).
    if (message.type === "leave" && !this.connectionRoom.has(connectionId)) {
      this.removeFromMatchQueue(connectionId);
      return;
    }

    const roomCode = this.connectionRoom.get(connectionId);
    if (!roomCode) {
      this.emit(connectionId, {
        type: "error",
        error: { code: ErrorCode.PLAYER_NOT_FOUND, message: "Join a room first" },
      });
      return;
    }

    const room = this.rooms.get(roomCode);
    if (!room) {
      this.emit(connectionId, {
        type: "error",
        error: { code: ErrorCode.PLAYER_NOT_FOUND, message: "Room not found" },
      });
      return;
    }

    room.handleMessage(connectionId, message);

    if (message.type === "leave" && room.phase === "lobby") {
      // Seat removed; drop binding if no longer seated
      const stillSeated = room.seats.some((s) => s.connectionId === connectionId);
      if (!stillSeated) {
        this.connectionRoom.delete(connectionId);
      }
      if (room.seats.length === 0) {
        this.rooms.delete(roomCode);
      }
    }
  }

  onDisconnect(connectionId: string): void {
    this.removeFromMatchQueue(connectionId);
    const roomCode = this.connectionRoom.get(connectionId);
    if (!roomCode) return;
    const room = this.rooms.get(roomCode);
    if (!room) {
      this.connectionRoom.delete(connectionId);
      return;
    }
    room.onDisconnect(connectionId);
    this.connectionRoom.delete(connectionId);
  }

  /**
   * Seat-token reclaim skips a new ticket exchange (disconnect grace).
   * Otherwise steam mode exchanges `sessionTicket` for a SteamID, then seats.
   * Dev mode without a `dev:<steamid>` ticket keeps the pre-Steam join path.
   */
  private beginJoin(connectionId: string, message: ClientJoin): void {
    if (message.seatToken && this.reclaimBySeatToken(connectionId, message)) {
      return;
    }

    const ticket = message.sessionTicket?.trim() ?? "";
    const devTicket = ticket.startsWith("dev:");
    if (this.exchanger.mode === "dev" && !devTicket) {
      this.routeJoin(connectionId, message, null);
      return;
    }
    if (!ticket) {
      this.emit(connectionId, {
        type: "error",
        error: {
          code: ErrorCode.AUTH_REQUIRED,
          message: "Steam session ticket required",
        },
      });
      return;
    }

    let exchanged: ReturnType<TicketExchanger["exchange"]>;
    try {
      exchanged = this.exchanger.exchange(ticket);
    } catch (err) {
      this.emitAuthFailed(connectionId, err);
      return;
    }
    if (isPromise(exchanged)) {
      void exchanged.then(
        (identity) => this.routeJoin(connectionId, message, identity.steamId),
        (err: unknown) => this.emitAuthFailed(connectionId, err),
      );
      return;
    }
    this.routeJoin(connectionId, message, exchanged.steamId);
  }

  private reclaimBySeatToken(connectionId: string, message: ClientJoin): boolean {
    const token = message.seatToken;
    if (!token) return false;
    const located = this.locateSeatToken(token);
    if (!located) return false;
    this.handleJoin(connectionId, {
      type: "join",
      mode: "join",
      roomCode: located.room.roomCode,
      displayName: message.displayName,
      seatToken: token,
      seatCount: message.seatCount,
    });
    return true;
  }

  private routeJoin(
    connectionId: string,
    message: ClientJoin,
    steamId: string | null,
  ): void {
    if (steamId) {
      const existing = this.locateSteamId(steamId);
      if (existing) {
        this.handleJoin(connectionId, {
          type: "join",
          mode: "join",
          roomCode: existing.room.roomCode,
          displayName: message.displayName,
          seatToken: existing.seat.seatToken,
          seatCount: message.seatCount,
        });
        return;
      }
      this.dropOtherQueuedSteamId(steamId, connectionId);
    }

    this.handleJoin(connectionId, message);
    if (!steamId) return;

    const code = this.connectionRoom.get(connectionId);
    if (code) {
      this.rooms.get(code)?.bindSteamId(connectionId, steamId);
      return;
    }
    const queued = this.matchQueue.find((entry) => entry.connectionId === connectionId);
    if (queued) queued.steamId = steamId;
  }

  private emitAuthFailed(connectionId: string, err: unknown): void {
    const detail = err instanceof Error ? err.message : "";
    const safe =
      detail.startsWith("Steam") || detail.startsWith("STEAM_") || detail.startsWith("dev ticket")
        ? detail
        : "Steam session ticket rejected";
    this.emit(connectionId, {
      type: "error",
      error: { code: ErrorCode.AUTH_FAILED, message: safe },
    });
  }

  private locateSeatToken(token: string): { room: MatchRoom; seat: SeatBinding } | null {
    for (const room of this.rooms.values()) {
      const seat = room.seats.find((candidate) => candidate.seatToken === token);
      if (seat) return { room, seat };
    }
    return null;
  }

  private locateSteamId(steamId: string): { room: MatchRoom; seat: SeatBinding } | null {
    for (const room of this.rooms.values()) {
      const seat = room.seats.find((candidate) => candidate.steamId === steamId && !candidate.isBot);
      if (seat) return { room, seat };
    }
    return null;
  }

  private dropOtherQueuedSteamId(steamId: string, exceptConnectionId: string): void {
    const idx = this.matchQueue.findIndex(
      (entry) => entry.steamId === steamId && entry.connectionId !== exceptConnectionId,
    );
    if (idx < 0) return;
    this.matchQueue.splice(idx, 1);
    this.scheduleMatchFill();
  }

  private handleJoin(connectionId: string, message: ClientJoin): void {
    // Leaving match queue when switching into create/join
    this.removeFromMatchQueue(connectionId);

    if (message.mode === "create") {
      const code = generateRoomCode(new Set(this.rooms.keys()));
      const room = new MatchRoom({
        roomCode: code,
        seed: this.seed,
        emit: this.emit,
        clock: this.clock,
      });
      this.rooms.set(code, room);
      this.connectionRoom.set(connectionId, code);
      room.handleMessage(connectionId, { ...message, roomCode: code });
      return;
    }

    if (message.mode === "match") {
      this.enqueueMatch(connectionId, message);
      return;
    }

    // mode: join
    const code = message.roomCode?.trim().toUpperCase();
    if (!code) {
      this.emit(connectionId, {
        type: "error",
        error: { code: ErrorCode.INVALID_MESSAGE, message: "roomCode is required to join" },
      });
      return;
    }

    let room = this.rooms.get(code);
    if (!room && message.seatToken) {
      // Allow reconnect lookup by token across rooms
      for (const candidate of this.rooms.values()) {
        if (candidate.seats.some((s) => s.seatToken === message.seatToken)) {
          room = candidate;
          break;
        }
      }
    }

    if (!room) {
      this.emit(connectionId, {
        type: "error",
        error: { code: ErrorCode.PLAYER_NOT_FOUND, message: `Room ${code} not found` },
      });
      return;
    }

    this.connectionRoom.set(connectionId, room.roomCode);
    room.handleMessage(connectionId, message);
  }

  /**
   * Free-match: prefer humans; stay ambient until 4 humans OR 60s then silent Bot fill.
   * No "queued" / "匹配失败" / Bot countdown frames — client owns wait UX copy.
   */
  private enqueueMatch(connectionId: string, message: ClientJoin): void {
    if (this.matchQueue.some((e) => e.connectionId === connectionId)) return;

    const displayName = message.displayName.trim() || "Player";
    this.matchQueue.push({
      connectionId,
      displayName,
      enqueuedAt: this.clock.now(),
      steamId: null,
    });

    this.flushHumanMatchBatches();
    this.scheduleMatchFill();
  }

  private flushHumanMatchBatches(): void {
    while (this.matchQueue.length >= 4) {
      const batch = this.matchQueue.splice(0, 4);
      this.openMatchRoom(batch, []);
    }
  }

  private scheduleMatchFill(): void {
    if (this.matchFillTimer != null) {
      this.clock.clearTimeout(this.matchFillTimer);
      this.matchFillTimer = null;
    }
    if (this.matchQueue.length === 0 || this.matchQueue.length >= 4) return;

    const oldest = Math.min(...this.matchQueue.map((e) => e.enqueuedAt));
    const elapsed = this.clock.now() - oldest;
    const waitMs = Math.max(0, this.botFillMs - elapsed);

    this.matchFillTimer = this.clock.setTimeout(() => {
      this.matchFillTimer = null;
      this.fillMatchWithBots();
    }, waitMs);
  }

  /** After botFillMs from oldest waiter: fill remaining seats silently and start. */
  private fillMatchWithBots(): void {
    if (this.matchQueue.length === 0) return;
    if (this.matchQueue.length >= 4) {
      this.flushHumanMatchBatches();
      this.scheduleMatchFill();
      return;
    }

    const batch = this.matchQueue.splice(0, this.matchQueue.length);
    const taken = new Set(batch.map((e) => e.displayName));
    const need = 4 - batch.length;
    const botNames = pickFakeDisplayNames(need, taken);
    this.openMatchRoom(batch, botNames);
    this.scheduleMatchFill();
  }

  private openMatchRoom(
    humans: MatchQueueEntry[],
    botNames: string[],
  ): void {
    const code = generateRoomCode(new Set(this.rooms.keys()));
    const room = new MatchRoom({
      roomCode: code,
      seed: this.seed,
      emit: this.emit,
      clock: this.clock,
    });
    this.rooms.set(code, room);

    for (const entry of humans) {
      this.connectionRoom.set(entry.connectionId, code);
      room.handleMessage(entry.connectionId, {
        type: "join",
        mode: "join",
        roomCode: code,
        displayName: entry.displayName,
      });
      if (entry.steamId) room.bindSteamId(entry.connectionId, entry.steamId);
    }

    if (botNames.length > 0 && room.phase === "lobby") {
      room.fillSilentBots(botNames);
    }
  }

  private removeFromMatchQueue(connectionId: string): void {
    const idx = this.matchQueue.findIndex((e) => e.connectionId === connectionId);
    if (idx >= 0) {
      this.matchQueue.splice(idx, 1);
      this.scheduleMatchFill();
    }
  }
}
