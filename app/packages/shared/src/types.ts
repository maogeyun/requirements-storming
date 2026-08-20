export type Rarity = "N" | "R" | "E";
export type CardCategory = "skill" | "boost" | "collab" | "event" | "requirement" | "okr";

export type MilestoneId = "M1" | "M2" | "M3" | "M4";

export interface MilestoneDefinition {
  id: MilestoneId;
  threshold: number;
  name: string;
  breakerPerformance: number;
  collaboratorPerformance: number;
}

export interface ActionCardDefinition {
  id: string;
  name: string;
  category: "skill" | "boost" | "collab";
  rarity: Rarity;
  workHours: number;
  effectText: string;
  copies: number;
  /** 每考核季限打 1 次 */
  seasonLimit?: boolean;
  /** 每局限 1 次 */
  gameLimit?: boolean;
  /** 互动卡 C-12~C-14 */
  isInteraction?: boolean;
}

export interface EventCardDefinition {
  id: string;
  name: string;
  trigger: string;
  effectText: string;
}

export interface RequirementCardDefinition {
  id: string;
  name: string;
  difficulty: number;
  mechanismText: string;
  triggerText: string;
}

export interface OkrCardDefinition {
  id: string;
  name: string;
  conditionText: string;
  reward: number;
}

export interface GameConstants {
  version: string;
  baseWorkHoursPerTurn: number;
  handLimit: number;
  roundsPerSeason: number;
  defaultSprintCount: number;
  totalProgressStandard: number;
  totalProgressTwoPlayer: number;
  milestonesStandard: MilestoneDefinition[];
  milestonesTwoPlayer: MilestoneDefinition[];
  sprintZoneDistance: number;
  sprintZoneDistanceTwoPlayer: number;
  darkBidMax: number;
  darkBidMaxReduced: number;
  darkBidTotalCostThreshold: number;
  workHourCaps: Record<string, number>;
}

export type TurnPhase = "draw" | "plan" | "execute" | "end";

export type GameModuleFlags = {
  darkBid: boolean;
  interactionCards: boolean;
  hiddenOkr: boolean;
  continuousSprint: boolean;
};

export interface PlayerState {
  id: string;
  name: string;
  performance: number;
  hand: string[];
  okrId: string | null;
  personalBugs: number;
  personalDebt: number;
  /** 本 Turn 剩余可用工时（含暗标消耗后） */
  workHoursRemaining: number;
  /** 本 Turn 初始预算（领 40 后） */
  workHoursBudget: number;
  /** 本 Turn 是否已用加班额度 */
  usedOvertime: boolean;
  /** 下 Turn 额外工时（C-03 等） */
  nextTurnBonusHours: number;
  /** 下 Turn 手牌上限修正 */
  handLimitModifier: number;
  /** 划水预警：下季首 Round 手牌 -1 */
  slackingNextSeason: boolean;
  /** FIX-07 垫底标记 */
  bottomMarks: number;
  /** 本 Round 是否加过进度 */
  contributedThisRound: boolean;
  /** 本考核季已打的协作/互动卡 id */
  seasonPlayedCollab: string[];
  /** 本局限 1 次卡是否已用 */
  gameLimitUsed: Record<string, boolean>;
  milestoneBreakCount: number;
  bugsClearedTotal: number;
  collabCardsPlayed: number;
  breakthroughParticipations: number;
  neverUsedOvertime: boolean;
}

export interface GameConfig {
  playerCount: number;
  sprintCount: number;
  modules: GameModuleFlags;
  requirementId?: string;
  darkBidMax?: number;
}

export interface DarkBidState {
  milestoneId: MilestoneId;
  /** 是否跨线瞬间补开 */
  isCatchUp: boolean;
  resolved: boolean;
  bids: Record<string, number>;
  priorityHolderId: string | null;
  crosserId: string | null;
}

export interface GameState {
  config: GameConfig;
  constants: GameConstants;
  players: PlayerState[];
  playerOrder: string[];
  currentPlayerIndex: number;
  turnPhase: TurnPhase;
  round: number;
  season: number;
  sprint: number;
  progress: number;
  totalProgressTarget: number;
  milestones: MilestoneDefinition[];
  requirementId: string;
  /** 已突破的里程碑 */
  crossedMilestones: MilestoneId[];
  /** 每个里程碑是否已暗标 */
  darkBidUsed: Record<MilestoneId, boolean>;
  pendingDarkBid: DarkBidState | null;
  actionDeck: string[];
  actionDiscard: string[];
  eventDeck: string[];
  eventDiscard: string[];
  currentEventId: string | null;
  publicDebt: number;
  /** 本 Round 加过进度的玩家 */
  roundContributors: Set<string>;
  /** 待响应：C-13 目标等 */
  pendingInteraction: {
    type: "C-13" | "C-14";
    sourceId: string;
    targetId: string;
    milestoneId: MilestoneId;
  } | null;
  /** 暗标总消耗（FIX-05 追踪） */
  darkBidTotalSpent: number;
  usedRequirementIds: string[];
  gameOver: boolean;
  winnerId: string | null;
  rngSeed: number;
}

export type GameAction =
  | { type: "START_TURN" }
  | { type: "DRAW_TO_HAND_LIMIT" }
  | { type: "PLAY_CARD"; playerId: string; cardId: string; targets?: string[] }
  | { type: "SUBMIT_DARK_BID"; playerId: string; amount: number }
  | { type: "RESOLVE_DARK_BID"; crosserId: string }
  | { type: "RESPOND_C13"; playerId: string }
  | { type: "RESPOND_C14"; playerId: string; sourceId: string }
  | { type: "END_TURN" }
  | { type: "END_ROUND" };
