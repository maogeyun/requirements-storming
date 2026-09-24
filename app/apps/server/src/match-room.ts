import {
  applyAction,
  createGame,
  listBotActorSeats,
  listLegalActions,
  pickHeuristicLegalAction,
} from "@rs/rules-engine";
import type {
  ClientJoin,
  ClientMessage,
  ForceWindow,
  GameAction,
  GameState,
  LobbyPlayer,
  LobbyState,
  RoomConfig,
  RoomPhase,
  SeatPresence,
  ServerMessage,
} from "@rs/shared";
import {
  DISCONNECT_GRACE_MS,
  ErrorCode,
  disconnectGraceRemainingSec,
  roomConfigToGameConfig,
} from "@rs/shared";
import { randomBytes } from "node:crypto";
import { type MatchClock, defaultMatchClock } from "./clock";
import { isLegalIntent } from "./intent";
import {
  getDefaultRoomConfig,
  getForceWindowForSeat,
  getPlayerView,
} from "./player-view";

export type EmitFn = (connectionId: string, message: ServerMessage) => void;

export interface SeatBinding {
  seatId: string;
  displayName: string;
  seatToken: string;
  connectionId: string | null;
  connected: boolean;
  isHost: boolean;
  /**
   * Server-only. Never copy into LobbyPlayer / PlayerView / any client frame.
   * Silent match fill seats pretend to be humans on the wire.
   */
  isBot?: boolean;
  /** Wall-clock when reconnect grace ends; null if connected or not in grace. */
  disconnectGraceUntil: number | null;
  /** Timer handle for grace → hosted transition. */
  graceTimer: unknown | null;
  /**
   * After grace expires: heuristic Bot plays this human seat until seatToken reclaim.
   * Distinct from `isBot` silent-fill — clients may show 托管 for this flag only.
   */
  disconnectHosted: boolean;
  /**
   * Server-only SteamID64 after a session ticket is exchanged.
   * Never copy into LobbyPlayer / PlayerView / presence / any client frame.
   */
  steamId: string | null;
}

/** 联机房间固定满 4 开局（老乔确认：不可不足开局）。 */
export const REQUIRED_SEAT_COUNT = 4;

export interface MatchRoomOptions {
  roomCode: string;
  seed?: number;
  emit: EmitFn;
  clock?: MatchClock;
  /** Override disconnect grace (default DISCONNECT_GRACE_MS = 45s). */
  disconnectGraceMs?: number;
}

/** Opaque reconnect secret. Not a Steam ticket and not a `stub_` placeholder. */
function newSeatToken(): string {
  return `seat_${randomBytes(18).toString("base64url")}`;
}

function emptySeatFlags(): Pick<
  SeatBinding,
  "disconnectGraceUntil" | "graceTimer" | "disconnectHosted" | "steamId"
> {
  return {
    disconnectGraceUntil: null,
    graceTimer: null,
    disconnectHosted: false,
    steamId: null,
  };
}

export class MatchRoom {
  readonly roomCode: string;
  readonly seatCount = REQUIRED_SEAT_COUNT;
  readonly config: RoomConfig;
  readonly disconnectGraceMs: number;
  phase: RoomPhase = "lobby";
  seats: SeatBinding[] = [];
  gameState: GameState | null = null;
  private readonly seed: number | undefined;
  private readonly emit: EmitFn;
  private readonly clock: MatchClock;
  private botTurnTimer: unknown = null;
  private botBusy = false;

  constructor(options: MatchRoomOptions) {
    this.roomCode = options.roomCode;
    this.config = getDefaultRoomConfig(REQUIRED_SEAT_COUNT);
    this.seed = options.seed;
    this.emit = options.emit;
    this.clock = options.clock ?? defaultMatchClock;
    this.disconnectGraceMs = options.disconnectGraceMs ?? DISCONNECT_GRACE_MS;
  }

  get hostSeatId(): string | null {
    return this.seats.find((s) => s.isHost)?.seatId ?? null;
  }

  /** Bind a verified SteamID to the human seat on this connection. Bots are skipped. */
  bindSteamId(connectionId: string, steamId: string): void {
    const seat = this.seats.find((s) => s.connectionId === connectionId && !s.isBot);
    if (!seat) return;
    seat.steamId = steamId;
  }

  /**
   * Seat ids that run heuristic Bot:
   * - silent fill (`isBot`)
   * - disconnect takeover after grace (`disconnectHosted`)
   */
  botSeatIds(): string[] {
    return this.seats
      .filter((s) => s.isBot || s.disconnectHosted)
      .map((s) => s.seatId);
  }

  handleMessage(connectionId: string, message: ClientMessage): void {
    switch (message.type) {
      case "join":
        this.handleJoin(connectionId, message);
        break;
      case "intent":
        this.handleIntent(connectionId, message.action);
        break;
      case "resync":
        this.sendSeatSnapshot(connectionId);
        break;
      case "leave":
        this.handleLeave(connectionId);
        break;
      default:
        this.sendError(connectionId, ErrorCode.INVALID_MESSAGE, "Unknown message type");
    }
  }

  /**
   * Connection dropped (i-pple):
   * - lobby: mark disconnected
   * - playing: retain seat, start grace; after timeout → Bot takeover until reclaim
   */
  onDisconnect(connectionId: string): void {
    const seat = this.seats.find((s) => s.connectionId === connectionId);
    if (!seat) return;
    seat.connected = false;
    seat.connectionId = null;

    if (this.phase === "lobby") {
      this.broadcastLobby();
      return;
    }

    if (this.phase === "playing" && !seat.isBot) {
      this.beginDisconnectGrace(seat);
      this.broadcastPlaying();
    }
  }

  /**
   * Silent match fill: add heuristic Bot seats with human-looking names.
   * Does not emit isBot; lobby/view names look like humans.
   * Starts the game when seated === 4.
   */
  fillSilentBots(displayNames: string[]): void {
    if (this.phase !== "lobby") return;
    for (const name of displayNames) {
      if (this.seats.length >= REQUIRED_SEAT_COUNT) break;
      const seatIndex = this.seats.length;
      this.seats.push({
        seatId: `p${seatIndex + 1}`,
        displayName: name,
        seatToken: newSeatToken(),
        connectionId: null,
        connected: true,
        isHost: false,
        isBot: true,
        ...emptySeatFlags(),
      });
    }
    // Humans already in seats get an updated ring (names look human) then auto-start.
    this.broadcastLobby();
    if (this.seats.length === REQUIRED_SEAT_COUNT) {
      this.startGame();
    }
  }

  private handleJoin(connectionId: string, message: ClientJoin): void {
    const name = message.displayName.trim();
    if (!name) {
      this.sendError(connectionId, ErrorCode.INVALID_MESSAGE, "displayName is required");
      return;
    }

    // 主机不可改规则；座位数固定 4。客户端若传 seatCount 且非 4 → 拒绝。
    if (message.seatCount != null && message.seatCount !== REQUIRED_SEAT_COUNT) {
      this.sendError(
        connectionId,
        ErrorCode.INVALID_MESSAGE,
        `Online rooms require exactly ${REQUIRED_SEAT_COUNT} seats`,
      );
      return;
    }

    // Reconnect via seatToken issued after auth (no second ticket exchange).
    if (message.seatToken) {
      const existing = this.seats.find((s) => s.seatToken === message.seatToken);
      if (existing) {
        const wasAway = !existing.connected || existing.disconnectHosted;
        this.clearDisconnectGrace(existing);
        existing.connectionId = connectionId;
        existing.connected = true;
        existing.disconnectHosted = false;
        existing.displayName = name || existing.displayName;
        this.sendSeatSnapshot(connectionId, { reclaimed: wasAway });
        // Refresh presence for other connected seats
        if (this.phase === "playing") {
          this.broadcastPlayingExcept(connectionId);
          this.queueBotTurns();
        } else if (this.phase === "lobby") {
          this.broadcastLobby();
        }
        return;
      }
    }

    if (this.phase !== "lobby") {
      this.sendError(connectionId, ErrorCode.GAME_ALREADY_STARTED, "Game already started");
      return;
    }

    if (this.seats.some((s) => s.connectionId === connectionId)) {
      this.sendSeatSnapshot(connectionId);
      return;
    }

    if (this.seats.length >= REQUIRED_SEAT_COUNT) {
      this.sendError(connectionId, ErrorCode.ROOM_FULL, "Room is full");
      return;
    }

    const seatIndex = this.seats.length;
    const seat: SeatBinding = {
      seatId: `p${seatIndex + 1}`,
      displayName: name,
      seatToken: newSeatToken(),
      connectionId,
      connected: true,
      isHost: seatIndex === 0,
      ...emptySeatFlags(),
    };
    this.seats.push(seat);
    this.broadcastLobby();

    if (this.seats.length === REQUIRED_SEAT_COUNT) {
      this.startGame();
    }
  }

  /**
   * 仅当 seated === 4 时开局。不足 4 拒绝（含任何主机提前开局路径）。
   * @returns false 表示未开局（人数不足或已开）
   */
  tryStartGame(connectionId?: string): boolean {
    if (this.phase !== "lobby") {
      if (connectionId) {
        this.sendError(connectionId, ErrorCode.GAME_ALREADY_STARTED, "Game already started");
      }
      return false;
    }
    if (this.seats.length !== REQUIRED_SEAT_COUNT) {
      if (connectionId) {
        this.sendError(
          connectionId,
          ErrorCode.INSUFFICIENT_PLAYERS,
          `Need exactly ${REQUIRED_SEAT_COUNT} players to start`,
        );
      }
      return false;
    }
    this.startGame();
    return this.gameState != null;
  }

  private startGame(): void {
    if (this.phase !== "lobby") return;
    if (this.seats.length !== REQUIRED_SEAT_COUNT) {
      // 防御：不允许不足 4 人开局（含主机提前开）
      return;
    }

    const gameState = createGame({
      playerNames: this.seats.map((s) => s.displayName),
      config: roomConfigToGameConfig({
        ...this.config,
        playerCount: REQUIRED_SEAT_COUNT,
      }),
      seed: this.seed,
    });

    // Align seat ids with engine player ids (p1..pn).
    // Online shows nickname-style names (incl. silent-fill fakes), not seat-role labels.
    for (let i = 0; i < this.seats.length; i += 1) {
      const enginePlayer = gameState.players[i];
      const seat = this.seats[i];
      if (enginePlayer && seat) {
        seat.seatId = enginePlayer.id;
        enginePlayer.name = seat.displayName;
        enginePlayer.displayName = seat.displayName;
      }
    }

    this.gameState = gameState;
    this.phase = "playing";
    this.broadcastPlaying();
    this.queueBotTurns();
  }

  private handleIntent(connectionId: string, action: GameAction): void {
    const seat = this.seats.find((s) => s.connectionId === connectionId);
    if (!seat) {
      this.sendError(connectionId, ErrorCode.PLAYER_NOT_FOUND, "Join the room first");
      return;
    }

    if (this.phase !== "playing" || !this.gameState) {
      this.sendError(connectionId, ErrorCode.GAME_NOT_STARTED, "Game has not started");
      return;
    }

    const state = this.gameState;
    const legal = listLegalActions(state, seat.seatId);
    if (!isLegalIntent(legal, action)) {
      this.emit(connectionId, {
        type: "error",
        error: {
          code: ErrorCode.INVALID_ACTION,
          message: "Illegal intent rejected",
        },
        rejectedAction: action,
      });
      return;
    }

    const result = applyAction(state, action);
    if (!result.ok) {
      this.emit(connectionId, {
        type: "error",
        error: {
          code: ErrorCode.INVALID_ACTION,
          message: result.error,
        },
        rejectedAction: action,
      });
      return;
    }

    if (state.gameOver) {
      this.phase = "finished";
    }

    this.broadcastPlaying(result.events);
    this.queueBotTurns();
  }

  private handleLeave(connectionId: string): void {
    const index = this.seats.findIndex((s) => s.connectionId === connectionId);
    if (index < 0) return;

    if (this.phase === "lobby") {
      const [removed] = this.seats.splice(index, 1);
      if (removed) this.clearDisconnectGrace(removed);
      if (this.seats.length > 0 && !this.seats.some((s) => s.isHost)) {
        this.seats[0]!.isHost = true;
      }
      this.broadcastLobby();
      return;
    }

    // In-game leave: same as disconnect (grace → Bot takeover)
    this.onDisconnect(connectionId);
  }

  private beginDisconnectGrace(seat: SeatBinding): void {
    this.clearDisconnectGrace(seat);
    seat.disconnectHosted = false;
    seat.disconnectGraceUntil = this.clock.now() + this.disconnectGraceMs;
    seat.graceTimer = this.clock.setTimeout(() => {
      seat.graceTimer = null;
      seat.disconnectGraceUntil = null;
      seat.disconnectHosted = true;
      this.broadcastPlaying();
      this.queueBotTurns();
    }, this.disconnectGraceMs);
  }

  private clearDisconnectGrace(seat: SeatBinding): void {
    if (seat.graceTimer != null) {
      this.clock.clearTimeout(seat.graceTimer);
      seat.graceTimer = null;
    }
    seat.disconnectGraceUntil = null;
  }

  buildPresence(): Record<string, SeatPresence> {
    const now = this.clock.now();
    const presence: Record<string, SeatPresence> = {};
    for (const seat of this.seats) {
      // Silent-fill bots never expose hosted / grace (free-match non-disclosure).
      if (seat.isBot) {
        presence[seat.seatId] = {
          connected: true,
          graceRemainingSec: null,
          hosted: false,
        };
        continue;
      }
      presence[seat.seatId] = {
        connected: seat.connected,
        graceRemainingSec: seat.disconnectHosted
          ? null
          : disconnectGraceRemainingSec(seat.disconnectGraceUntil, now),
        hosted: seat.disconnectHosted,
      };
    }
    return presence;
  }

  /**
   * Lobby payload for clients — strips server-only isBot.
   * Empty seats are implied by seatCount − players.length (UI draws dashed empties).
   */
  private buildLobbyState(): LobbyState {
    const players: LobbyPlayer[] = this.seats.map((s) => ({
      id: s.seatId,
      name: s.displayName,
      isHost: s.isHost,
      connected: s.connected,
    }));
    return {
      phase: "lobby",
      roomCode: this.roomCode,
      hostId: this.hostSeatId ?? "",
      seatCount: this.seatCount,
      config: this.config,
      players,
    };
  }

  private broadcastLobby(): void {
    for (const seat of this.seats) {
      if (!seat.connectionId) continue;
      this.emit(seat.connectionId, {
        type: "view",
        roomCode: this.roomCode,
        seatId: seat.seatId,
        seatToken: seat.seatToken,
        phase: "lobby",
        lobby: this.buildLobbyState(),
        presence: this.buildPresence(),
      });
    }
  }

  private broadcastPlaying(events?: string[]): void {
    if (!this.gameState) return;
    for (const seat of this.seats) {
      if (!seat.connectionId) continue;
      this.pushSeatPlaying(seat, events);
    }
  }

  private broadcastPlayingExcept(exceptConnectionId: string, events?: string[]): void {
    if (!this.gameState) return;
    for (const seat of this.seats) {
      if (!seat.connectionId || seat.connectionId === exceptConnectionId) continue;
      this.pushSeatPlaying(seat, events);
    }
  }

  private sendSeatSnapshot(
    connectionId: string,
    options?: { reclaimed?: boolean },
  ): void {
    const seat = this.seats.find((s) => s.connectionId === connectionId);
    if (!seat) {
      this.sendError(connectionId, ErrorCode.PLAYER_NOT_FOUND, "Not seated in this room");
      return;
    }
    if (this.phase === "lobby" || !this.gameState) {
      this.emit(connectionId, {
        type: "view",
        roomCode: this.roomCode,
        seatId: seat.seatId,
        seatToken: seat.seatToken,
        phase: "lobby",
        lobby: this.buildLobbyState(),
        presence: this.buildPresence(),
        reclaimed: options?.reclaimed,
      });
      return;
    }
    this.pushSeatPlaying(seat, undefined, options);
  }

  private pushSeatPlaying(
    seat: SeatBinding,
    events?: string[],
    options?: { reclaimed?: boolean },
  ): void {
    if (!seat.connectionId || !this.gameState) return;
    const view = getPlayerView(
      this.gameState,
      seat.seatId,
      this.roomCode,
      this.phase,
      this.config,
    );
    const legalActions = listLegalActions(this.gameState, seat.seatId);
    this.emit(seat.connectionId, {
      type: "view",
      roomCode: this.roomCode,
      seatId: seat.seatId,
      seatToken: seat.seatToken,
      phase: this.phase,
      view,
      legalActions,
      events,
      presence: this.buildPresence(),
      reclaimed: options?.reclaimed,
    });

    const force = getForceWindowForSeat(this.gameState, seat.seatId);
    if (force) {
      this.emitForce(seat.connectionId, seat.seatId, force);
    }
  }

  private emitForce(
    connectionId: string,
    seatId: string,
    window: ForceWindow,
  ): void {
    this.emit(connectionId, {
      type: "force",
      roomCode: this.roomCode,
      seatId,
      window,
    });
  }

  private sendError(
    connectionId: string,
    code: ErrorCode,
    message: string,
  ): void {
    this.emit(connectionId, {
      type: "error",
      error: { code, message },
    });
  }

  /** Schedule heuristic Bot turns for silent-fill + disconnect-hosted seats. */
  private queueBotTurns(): void {
    if (this.botTurnTimer != null) {
      this.clock.clearTimeout(this.botTurnTimer);
      this.botTurnTimer = null;
    }
    if (this.phase === "finished" || !this.gameState) return;
    if (this.botSeatIds().length === 0) return;
    this.botTurnTimer = this.clock.setTimeout(() => {
      this.botTurnTimer = null;
      this.runBotTurns();
    }, 0);
  }

  private runBotTurns(): void {
    if (this.botBusy) return;
    if (!this.gameState || this.phase === "finished") return;
    const botIds = this.botSeatIds();
    if (botIds.length === 0) return;

    this.botBusy = true;
    try {
      let guard = 0;
      const allEvents: string[] = [];
      while (guard < 48 && this.gameState && this.phase !== "finished") {
        guard += 1;
        const actors = listBotActorSeats(this.gameState, botIds);
        if (actors.length === 0) break;

        let progressed = false;
        for (const seatId of actors) {
          const pick = pickHeuristicLegalAction(this.gameState, seatId);
          if (!pick) continue;
          const result = applyAction(this.gameState, pick.action);
          if (!result.ok) continue;
          progressed = true;
          allEvents.push(...result.events);
          if (this.gameState.gameOver) {
            this.phase = "finished";
            break;
          }
        }
        if (!progressed) break;
      }
      if (allEvents.length > 0) {
        this.broadcastPlaying(allEvents);
      }
    } finally {
      this.botBusy = false;
    }
  }
}
