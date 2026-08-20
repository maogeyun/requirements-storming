import type * as Party from "partykit/server";
import { createGame } from "@rs/rules-engine";
import type {
  ClientMessage,
  GameState,
  LobbyPlayer,
  LobbyState,
  RoomConfig,
  RoomPhase,
  ServerMessage,
} from "@rs/shared";
import { ErrorCode, roomConfigToGameConfig } from "@rs/shared";
import { getDefaultRoomConfig, getPlayerView } from "./player-view.js";

interface ConnectionMeta {
  playerId: string | null;
  playerName: string | null;
}

interface RoomStorage {
  phase: RoomPhase;
  hostConnectionId: string | null;
  config: RoomConfig;
  lobbyPlayers: LobbyPlayer[];
  connectionPlayers: Record<string, string>;
  gameState: GameState | null;
}

function defaultStorage(): RoomStorage {
  return {
    phase: "lobby",
    hostConnectionId: null,
    config: getDefaultRoomConfig(),
    lobbyPlayers: [],
    connectionPlayers: {},
    gameState: null,
  };
}

function send(conn: Party.Connection, message: ServerMessage): void {
  conn.send(JSON.stringify(message));
}

function sendError(conn: Party.Connection, code: ErrorCode, message: string): void {
  send(conn, { type: "ERROR", error: { code, message } });
}

function broadcast(room: Party.Room, message: ServerMessage, except?: Party.Connection): void {
  const payload = JSON.stringify(message);
  for (const conn of room.getConnections()) {
    if (except && conn.id === except.id) {
      continue;
    }
    conn.send(payload);
  }
}

export default class GameRoom implements Party.Server {
  storage: RoomStorage;

  constructor(readonly room: Party.Room) {
    this.storage = defaultStorage();
  }

  onConnect(conn: Party.Connection): void {
    send(conn, {
      type: "ROOM_STATE",
      lobby: this.buildLobbyState(),
    });
  }

  onClose(conn: Party.Connection): void {
    const playerId = this.storage.connectionPlayers[conn.id];
    if (!playerId) {
      return;
    }

    this.storage.lobbyPlayers = this.storage.lobbyPlayers.map((player) =>
      player.id === playerId ? { ...player, connected: false } : player,
    );
    delete this.storage.connectionPlayers[conn.id];

    if (this.storage.phase === "lobby") {
      this.broadcastLobby();
    }
  }

  onMessage(raw: string, sender: Party.Connection): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      sendError(sender, ErrorCode.INVALID_MESSAGE, "Invalid JSON message");
      return;
    }

    switch (message.type) {
      case "JOIN_ROOM":
        this.handleJoin(message.playerName, sender);
        break;
      case "CREATE_ROOM":
        this.handleCreateRoom(message.playerName, message.config, sender);
        break;
      case "START_GAME":
        this.handleStartGame(sender);
        break;
      case "SUBMIT_ACTION":
        this.handleSubmitAction(message.action, sender);
        break;
      case "SUBMIT_DARK_BID":
        this.handleSubmitDarkBid(message.amount, sender);
        break;
      case "REQUEST_STATE":
        this.sendStateTo(sender);
        break;
      default:
        sendError(sender, ErrorCode.INVALID_MESSAGE, "Unknown message type");
    }
  }

  private handleJoin(playerName: string, sender: Party.Connection): void {
    if (this.storage.phase !== "lobby") {
      this.sendStateTo(sender);
      return;
    }

    const trimmed = playerName.trim();
    if (!trimmed) {
      sendError(sender, ErrorCode.INVALID_MESSAGE, "Player name is required");
      return;
    }

    if (this.storage.lobbyPlayers.length >= this.storage.config.playerCount) {
      sendError(sender, ErrorCode.ROOM_FULL, "Room is full");
      return;
    }

    const existing = Object.entries(this.storage.connectionPlayers).find(
      ([connectionId]) => connectionId === sender.id,
    );
    if (existing) {
      this.sendStateTo(sender);
      return;
    }

    const playerId = `p${this.storage.lobbyPlayers.length + 1}`;
    const isHost = this.storage.lobbyPlayers.length === 0;

    if (isHost) {
      this.storage.hostConnectionId = sender.id;
    }

    const lobbyPlayer: LobbyPlayer = {
      id: playerId,
      name: trimmed,
      isHost,
      connected: true,
    };

    this.storage.lobbyPlayers.push(lobbyPlayer);
    this.storage.connectionPlayers[sender.id] = playerId;

    this.broadcastLobby();
  }

  private handleCreateRoom(
    playerName: string,
    config: RoomConfig,
    sender: Party.Connection,
  ): void {
    if (this.storage.phase !== "lobby" || this.storage.lobbyPlayers.length > 0) {
      sendError(sender, ErrorCode.GAME_ALREADY_STARTED, "Room already initialized");
      return;
    }

    this.storage.config = config;
    this.handleJoin(playerName, sender);
  }

  private handleStartGame(sender: Party.Connection): void {
    if (sender.id !== this.storage.hostConnectionId) {
      sendError(sender, ErrorCode.NOT_HOST, "Only host can start the game");
      return;
    }

    if (this.storage.phase !== "lobby") {
      sendError(sender, ErrorCode.GAME_ALREADY_STARTED, "Game already started");
      return;
    }

    const connectedPlayers = this.storage.lobbyPlayers.filter((player) => player.connected);
    if (connectedPlayers.length < 2) {
      sendError(sender, ErrorCode.INSUFFICIENT_PLAYERS, "Need at least 2 players");
      return;
    }

    const gameState = createGame({
      playerNames: connectedPlayers.map((player) => player.name),
      config: roomConfigToGameConfig(this.storage.config),
    });

    for (let index = 0; index < connectedPlayers.length; index += 1) {
      const lobbyPlayer = connectedPlayers[index];
      const enginePlayer = gameState.players[index];
      if (!enginePlayer) {
        continue;
      }
      const connectionId = Object.entries(this.storage.connectionPlayers).find(
        ([, playerId]) => playerId === lobbyPlayer.id,
      )?.[0];
      if (connectionId) {
        this.storage.connectionPlayers[connectionId] = enginePlayer.id;
      }
    }

    this.storage.gameState = gameState;
    this.storage.phase = "playing";
    this.broadcastGameViews();
  }

  private handleSubmitAction(action: ClientMessage & { type: "SUBMIT_ACTION" }["action"], sender: Party.Connection): void {
    const playerId = this.storage.connectionPlayers[sender.id];
    if (!playerId) {
      sendError(sender, ErrorCode.PLAYER_NOT_FOUND, "Join the room first");
      return;
    }

    if (this.storage.phase !== "playing" || !this.storage.gameState) {
      sendError(sender, ErrorCode.GAME_NOT_STARTED, "Game has not started");
      return;
    }

    const state = this.storage.gameState;

    try {
      if (action.type === "START_TURN") {
        state.turnPhase = "plan";
      } else if (action.type === "END_TURN") {
        state.currentPlayerIndex =
          (state.currentPlayerIndex + 1) % state.playerOrder.length;
        state.turnPhase = "draw";
      } else {
        sendError(sender, ErrorCode.INVALID_ACTION, `Unsupported action: ${action.type}`);
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Action failed";
      sendError(sender, ErrorCode.INVALID_ACTION, message);
      return;
    }

    send(sender, {
      type: "ACTION_RESULT",
      success: true,
      view: getPlayerView(state, playerId, this.room.id, this.storage.phase),
      events: [action.type],
    });
    this.broadcastGameViews(sender);
  }

  private handleSubmitDarkBid(amount: number, sender: Party.Connection): void {
    const playerId = this.storage.connectionPlayers[sender.id];
    if (!playerId || !this.storage.gameState?.pendingDarkBid) {
      sendError(sender, ErrorCode.INVALID_ACTION, "No pending dark bid");
      return;
    }

    this.storage.gameState.pendingDarkBid.bids[playerId] = amount;
    send(sender, {
      type: "ACTION_RESULT",
      success: true,
      view: getPlayerView(
        this.storage.gameState,
        playerId,
        this.room.id,
        this.storage.phase,
      ),
    });
  }

  private buildLobbyState(): LobbyState {
    return {
      phase: "lobby",
      roomCode: this.room.id,
      hostId: this.storage.lobbyPlayers.find((player) => player.isHost)?.id ?? "",
      config: this.storage.config,
      players: this.storage.lobbyPlayers,
    };
  }

  private broadcastLobby(): void {
    const lobby = this.buildLobbyState();
    broadcast(this.room, { type: "ROOM_STATE", lobby });
  }

  private broadcastGameViews(except?: Party.Connection): void {
    if (!this.storage.gameState) {
      return;
    }

    for (const conn of this.room.getConnections()) {
      if (except && conn.id === except.id) {
        continue;
      }
      this.sendStateTo(conn);
    }
  }

  private sendStateTo(conn: Party.Connection): void {
    const playerId = this.storage.connectionPlayers[conn.id];

    if (this.storage.phase === "lobby" || !this.storage.gameState || !playerId) {
      send(conn, { type: "ROOM_STATE", lobby: this.buildLobbyState() });
      return;
    }

    send(conn, {
      type: "ROOM_STATE",
      view: getPlayerView(
        this.storage.gameState,
        playerId,
        this.room.id,
        this.storage.phase,
      ),
    });
  }
}
