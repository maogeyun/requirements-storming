import type { GameAction, GameConfig, GameModuleFlags, GameState, PlayerState } from "./types.js";
import type { ErrorPayload } from "./errors.js";

export type RoomPhase = "lobby" | "playing" | "finished";

/** 房间配置，与 GameConfig 对齐 */
export interface RoomConfig {
  playerCount: number;
  sprintCount: number;
  modules: GameModuleFlags;
  requirementId?: string;
  darkBidMax?: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
}

export interface LobbyState {
  phase: "lobby";
  roomCode: string;
  hostId: string;
  config: RoomConfig;
  players: LobbyPlayer[];
}

/** 对其他玩家可见的玩家摘要（隐藏手牌/OKR/暗标出价） */
export interface PublicPlayerSummary {
  id: string;
  name: string;
  performance: number;
  handCount: number;
  personalBugs: number;
  personalDebt: number;
  workHoursRemaining: number;
  contributedThisRound: boolean;
  milestoneBreakCount: number;
}

/** 本玩家可见的完整玩家状态 */
export interface SelfPlayerView extends PlayerState {
  isSelf: true;
}

/** 其他玩家的过滤视图 */
export interface OtherPlayerView extends PublicPlayerSummary {
  isSelf: false;
  /** OKR 仅在终局或考核季亮牌时可见 */
  okrId: string | null;
}

export type PlayerViewEntry = SelfPlayerView | OtherPlayerView;

/** 对单个客户端可见的游戏状态 */
export interface PlayerView {
  phase: RoomPhase;
  selfId: string;
  roomCode: string;
  config: RoomConfig;
  /** 公共进度与回合信息 */
  round: number;
  season: number;
  sprint: number;
  progress: number;
  totalProgressTarget: number;
  currentEventId: string | null;
  publicDebt: number;
  turnPhase: GameState["turnPhase"];
  currentPlayerId: string | null;
  players: PlayerViewEntry[];
  /** 本玩家待处理的暗标（若有） */
  pendingDarkBid: {
    milestoneId: string;
    isCatchUp: boolean;
    resolved: boolean;
    /** 仅本玩家可见自己的出价 */
    myBid: number | null;
  } | null;
  gameOver: boolean;
  winnerId: string | null;
}

export interface GameRoomState {
  phase: "playing" | "finished";
  roomCode: string;
  config: RoomConfig;
  gameState: GameState;
}

// --- Client → Server ---

export interface ClientJoinRoom {
  type: "JOIN_ROOM";
  playerName: string;
}

export interface ClientCreateRoom {
  type: "CREATE_ROOM";
  playerName: string;
  config: RoomConfig;
}

export interface ClientStartGame {
  type: "START_GAME";
}

export interface ClientSubmitAction {
  type: "SUBMIT_ACTION";
  action: GameAction;
}

export interface ClientSubmitDarkBid {
  type: "SUBMIT_DARK_BID";
  amount: number;
}

export interface ClientRequestState {
  type: "REQUEST_STATE";
}

export type ClientMessage =
  | ClientJoinRoom
  | ClientCreateRoom
  | ClientStartGame
  | ClientSubmitAction
  | ClientSubmitDarkBid
  | ClientRequestState;

// --- Server → Client ---

export interface ServerRoomState {
  type: "ROOM_STATE";
  lobby?: LobbyState;
  view?: PlayerView;
}

export interface ServerActionResult {
  type: "ACTION_RESULT";
  success: boolean;
  view: PlayerView;
  events?: string[];
}

export interface ServerError {
  type: "ERROR";
  error: ErrorPayload;
}

export interface ServerDarkBidReveal {
  type: "DARK_BID_REVEAL";
  milestoneId: string;
  bids: Record<string, number>;
  crosserId: string | null;
}

export type ServerMessage =
  | ServerRoomState
  | ServerActionResult
  | ServerError
  | ServerDarkBidReveal;

export function roomConfigToGameConfig(config: RoomConfig): GameConfig {
  return {
    playerCount: config.playerCount,
    sprintCount: config.sprintCount,
    modules: config.modules,
    requirementId: config.requirementId,
    darkBidMax: config.darkBidMax,
  };
}
