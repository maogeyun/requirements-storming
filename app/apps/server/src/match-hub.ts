import type { ClientJoin, ClientMessage, ServerMessage } from "@rs/shared";
import { ErrorCode } from "@rs/shared";
import { MatchRoom } from "./match-room";

export type EmitFn = (connectionId: string, message: ServerMessage) => void;

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(existing: Set<string>): string {
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
 * In-memory room registry: create-with-code / join / simple match (start at 4).
 */
interface MatchQueueEntry {
  connectionId: string;
  displayName: string;
}

export class MatchHub {
  readonly rooms = new Map<string, MatchRoom>();
  private readonly matchQueue: MatchQueueEntry[] = [];
  private readonly connectionRoom = new Map<string, string>();
  private readonly emit: EmitFn;
  private readonly seed?: number;

  constructor(emit: EmitFn, options?: { seed?: number }) {
    this.emit = emit;
    this.seed = options?.seed;
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
      this.handleJoin(connectionId, message);
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

  private handleJoin(connectionId: string, message: ClientJoin): void {
    if (message.mode === "create") {
      const code = generateRoomCode(new Set(this.rooms.keys()));
      const room = new MatchRoom({
        roomCode: code,
        seed: this.seed,
        emit: this.emit,
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

  /** Simple matchmaking: fill a 4-seat room then auto-start. */
  private enqueueMatch(connectionId: string, message: ClientJoin): void {
    if (this.matchQueue.some((e) => e.connectionId === connectionId)) return;

    const displayName = message.displayName.trim() || "Player";
    this.matchQueue.push({ connectionId, displayName });

    while (this.matchQueue.length >= 4) {
      const batch = this.matchQueue.splice(0, 4);
      const code = generateRoomCode(new Set(this.rooms.keys()));
      const room = new MatchRoom({
        roomCode: code,
        seed: this.seed,
        emit: this.emit,
      });
      this.rooms.set(code, room);

      for (const entry of batch) {
        this.connectionRoom.set(entry.connectionId, code);
        room.handleMessage(entry.connectionId, {
          type: "join",
          mode: "join",
          roomCode: code,
          displayName: entry.displayName,
        });
      }
    }
    // Spec has no "queued" frame — stay silent until exactly 4 seats fill.
  }

  private removeFromMatchQueue(connectionId: string): void {
    const idx = this.matchQueue.findIndex((e) => e.connectionId === connectionId);
    if (idx >= 0) this.matchQueue.splice(idx, 1);
  }
}
