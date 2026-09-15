import { applyAction, createGame, listLegalActions } from "@rs/rules-engine";
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
  ServerMessage,
} from "@rs/shared";
import { ErrorCode, roomConfigToGameConfig } from "@rs/shared";
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
}

export interface MatchRoomOptions {
  roomCode: string;
  seatCount?: number;
  seed?: number;
  emit: EmitFn;
}

function clampSeatCount(n: number | undefined): number {
  if (n == null || Number.isNaN(n)) return 4;
  return Math.min(4, Math.max(2, Math.floor(n)));
}

function newSeatToken(): string {
  return `stub_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export class MatchRoom {
  readonly roomCode: string;
  readonly seatCount: number;
  readonly config: RoomConfig;
  phase: RoomPhase = "lobby";
  seats: SeatBinding[] = [];
  gameState: GameState | null = null;
  private readonly seed: number | undefined;
  private readonly emit: EmitFn;

  constructor(options: MatchRoomOptions) {
    this.roomCode = options.roomCode;
    this.seatCount = clampSeatCount(options.seatCount);
    this.config = getDefaultRoomConfig(this.seatCount);
    this.seed = options.seed;
    this.emit = options.emit;
  }

  get hostSeatId(): string | null {
    return this.seats.find((s) => s.isHost)?.seatId ?? null;
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

  /** 连接断开：V1 仅 stub；Bot 接管后续 PR。 */
  onDisconnect(connectionId: string): void {
    const seat = this.seats.find((s) => s.connectionId === connectionId);
    if (!seat) return;
    seat.connected = false;
    seat.connectionId = null;
    // TODO(disconnect): Bot takeover / reconnect grace — out of scope for V1 skeleton
    if (this.phase === "lobby") {
      this.broadcastLobby();
    }
  }

  private handleJoin(connectionId: string, message: ClientJoin): void {
    const name = message.displayName.trim();
    if (!name) {
      this.sendError(connectionId, ErrorCode.INVALID_MESSAGE, "displayName is required");
      return;
    }

    // Reconnect via stub seatToken
    if (message.seatToken) {
      const existing = this.seats.find((s) => s.seatToken === message.seatToken);
      if (existing) {
        existing.connectionId = connectionId;
        existing.connected = true;
        existing.displayName = name || existing.displayName;
        this.sendSeatSnapshot(connectionId);
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

    if (this.seats.length >= this.seatCount) {
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
    };
    this.seats.push(seat);
    this.broadcastLobby();

    if (this.seats.length >= this.seatCount) {
      this.startGame();
    }
  }

  private startGame(): void {
    if (this.phase !== "lobby" || this.seats.length < 2) return;

    const gameState = createGame({
      playerNames: this.seats.map((s) => s.displayName),
      config: roomConfigToGameConfig({
        ...this.config,
        playerCount: this.seats.length,
      }),
      seed: this.seed,
    });

    // Align seat ids with engine player ids (p1..pn)
    for (let i = 0; i < this.seats.length; i += 1) {
      const enginePlayer = gameState.players[i];
      if (enginePlayer) {
        this.seats[i]!.seatId = enginePlayer.id;
      }
    }

    this.gameState = gameState;
    this.phase = "playing";
    this.broadcastPlaying();
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
  }

  private handleLeave(connectionId: string): void {
    const index = this.seats.findIndex((s) => s.connectionId === connectionId);
    if (index < 0) return;

    if (this.phase === "lobby") {
      this.seats.splice(index, 1);
      if (this.seats.length > 0 && !this.seats.some((s) => s.isHost)) {
        this.seats[0]!.isHost = true;
      }
      this.broadcastLobby();
      return;
    }

    // In-game leave: mark disconnected only (Bot takeover later)
    this.onDisconnect(connectionId);
  }

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

  private sendSeatSnapshot(connectionId: string): void {
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
      });
      return;
    }
    this.pushSeatPlaying(seat);
  }

  private pushSeatPlaying(seat: SeatBinding, events?: string[]): void {
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
}
