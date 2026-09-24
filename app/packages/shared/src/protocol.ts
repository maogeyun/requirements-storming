import type {
  GameAction,
  GameConfig,
  GameModuleFlags,
  GameState,
  LegalAction,
  MilestoneId,
  OkrEvaluation,
  PlayerState,
} from "./types";
import type { ErrorPayload } from "./errors";

export type RoomPhase = "lobby" | "playing" | "finished";

/**
 * Online disconnect grace before Bot takeover (i-pple).
 * Seat retained; reclaim via seatToken issued after auth. Configurable at room construct.
 */
export const DISCONNECT_GRACE_MS = 45_000;

export function disconnectGraceRemainingSec(
  graceUntilMs: number | null | undefined,
  nowMs: number,
): number | null {
  if (graceUntilMs == null) return null;
  const left = Math.ceil((graceUntilMs - nowMs) / 1000);
  return left > 0 ? left : 0;
}

/** Per-seat connection presence for disconnect UX (no seat-scoped secrets). */
export interface SeatPresence {
  connected: boolean;
  /** Remaining reconnect grace seconds; only while disconnected & before hosted */
  graceRemainingSec: number | null;
  /**
   * True after grace expires: human seat under disconnect Bot takeover.
   * Never set for free-match silent-fill bots (those stay opaque).
   */
  hosted: boolean;
}

/** 房间配置，与 GameConfig 对齐；V1 主机不可改规则，仅服务端默认。 */
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
  /** 目标座位数：联机固定 4（满员才开局） */
  seatCount: number;
  config: RoomConfig;
  players: LobbyPlayer[];
}

/** 对其他玩家可见的玩家摘要（隐藏手牌/OKR/暗标出价） */
export interface PublicPlayerSummary {
  id: string;
  name: string;
  displayName: string;
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

/** 对单个客户端可见的游戏状态（座位作用域） */
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
  /** 总结算是否已亮出隐藏 OKR（全员可见） */
  okrRevealed: boolean;
  /** 亮牌结果；亮牌前为 null，他座不可窥牌 */
  okrSettlements: OkrEvaluation[] | null;
}

export interface GameRoomState {
  phase: "playing" | "finished";
  roomCode: string;
  config: RoomConfig;
  gameState: GameState;
}

// --- RedQueen V1 online protocol (WS JSON frames) ---
// Client → Server: join / intent / resync / leave
// Server → Client: view / force / error

export type JoinMode = "create" | "join" | "match";

/**
 * 创建/加入/简单匹配。
 * 联机鉴权：客户端提交 Steam Web API 会话票据（hex），服务端向
 * ISteamUserAuth/AuthenticateUserTicket 交换后签发 seatToken。
 * 重连只带 seatToken，不必重复交换。开发模式可省略票据。
 */
export interface ClientJoin {
  type: "join";
  mode: JoinMode;
  /** join 必填；create 可省略（服务端生成）；match 可省略 */
  roomCode?: string;
  displayName: string;
  /** 重连时带回已签发的 seatToken。不是 Steam 票据。 */
  seatToken?: string;
  /**
   * GetAuthTicketForWebApi 的票据，十六进制。
   * 仅首次入座需要；seatToken 重连可省略。
   */
  sessionTicket?: string;
  /**
   * 可选；联机固定满 4 开局。若传入且 !== 4，服务端拒绝。
   * 主机不可改规则 / 不可不足人数开局。
   */
  seatCount?: number;
}

/** 客户端意图：权威服务端用 listLegalActions 校验后 applyAction */
export interface ClientIntent {
  type: "intent";
  action: GameAction;
}

/** 请求重新下发本座位 view（及当前 force 窗） */
export interface ClientResync {
  type: "resync";
}

export interface ClientLeave {
  type: "leave";
}

export type ClientMessage =
  | ClientJoin
  | ClientIntent
  | ClientResync
  | ClientLeave;

/** 强制响应窗（暗标补开 / C-13 / C-14） */
export type ForceWindow =
  | {
      kind: "dark_bid";
      milestoneId: MilestoneId;
      isCatchUp: boolean;
      mustRespond: true;
    }
  | {
      kind: "c13";
      milestoneId: MilestoneId;
      breakerId: string;
      mustRespond: true;
    }
  | {
      kind: "c14";
      sourceCardId: "C-12" | "C-13";
      sourceId: string;
      targetId: string;
      mustRespond: true;
    };

/** 座位作用域视图推送 */
export interface ServerView {
  type: "view";
  roomCode: string;
  seatId: string;
  /** 鉴权通过后签发的不透明 seatToken；重连密钥，不是 Steam 票据 */
  seatToken: string;
  phase: RoomPhase;
  lobby?: LobbyState;
  view?: PlayerView;
  /** 当前座位可用动作（enabled 过滤前的 listLegalActions 快照可选） */
  legalActions?: LegalAction[];
  events?: string[];
  /** Per-seat disconnect / grace / hosted flags (i-pple); never leaks hands/OKR */
  presence?: Record<string, SeatPresence>;
  /** True on successful seatToken reclaim after disconnect */
  reclaimed?: boolean;
}

/** 强制窗推送（与 view 一并或单独下发） */
export interface ServerForce {
  type: "force";
  roomCode: string;
  seatId: string;
  window: ForceWindow;
}

export interface ServerError {
  type: "error";
  error: ErrorPayload;
  /** 非法 intent 时带回被拒动作，便于客户端对齐 */
  rejectedAction?: GameAction;
}

export type ServerMessage = ServerView | ServerForce | ServerError;

export function roomConfigToGameConfig(config: RoomConfig): GameConfig {
  return {
    playerCount: config.playerCount,
    sprintCount: config.sprintCount,
    modules: config.modules,
    requirementId: config.requirementId,
    darkBidMax: config.darkBidMax,
  };
}
