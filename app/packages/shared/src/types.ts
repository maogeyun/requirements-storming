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
  /** UI 展示名（如「座位 1 / 产品」）；可见文案一律用此字段，勿用 id */
  displayName: string;
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

/**
 * 跨线补开暗标时，进度结算被挂起，直至暗标完成。
 * 出牌扣工时 / 弃牌已发生；applyProgressGain 尚未执行。
 */
export interface PendingProgressSettlement {
  playerId: string;
  cardId: string | null;
  progressGain: number;
}

/**
 * 跨线后绩效尚未发放：等 C-13 / C-14 窗口关闭后再结算（防与暗标双重结算）。
 */
export interface PendingPerformanceSettlement {
  milestoneId: MilestoneId;
  breakerId: string;
  collaboratorIds: string[];
}

/** 本 Round 生效的事件持续效果（收尾阶段按需清除） */
export interface ActiveEventFlags {
  /** E-05：本 Round 第一次突破绩效翻倍 */
  doubleFirstMilestoneThisRound: boolean;
  /** E-05 是否已触发翻倍 */
  firstMilestoneDoubled: boolean;
  /** E-08：绩效最低者跳过下个 Turn 执行 */
  skipExecutePlayerId: string | null;
  /** E-02：翻开者本 Turn 规划时 -16 工时 */
  firefightingPlayerId: string | null;
  /** E-03：临时轨道剩余进度 */
  sideTrackRemaining: number;
}

/**
 * 互动响应窗：
 * - C13_WINDOW：跨线后、绩效结算前，可打 C-13 或弃权
 * - C14：被针对后必须响应（打出或放弃），不可跳过窗口
 */
export type PendingInteraction =
  | {
      type: "C13_WINDOW";
      milestoneId: MilestoneId;
      breakerId: string;
      collaboratorIds: string[];
      passedIds: string[];
    }
  | {
      type: "C14";
      sourceCardId: "C-12" | "C-13";
      sourceId: string;
      targetId: string;
      milestoneId: MilestoneId | null;
      dumpKind?: "debt" | "bug";
      c13Mode?: "hitch" | "steal";
      deferredSettlement?: PendingPerformanceSettlement;
    };

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
  /** 补开暗标未完成前的挂起进度结算 */
  pendingProgressSettlement: PendingProgressSettlement | null;
  /** 跨线绩效挂起（互动窗未关前不发放） */
  pendingPerformanceSettlement: PendingPerformanceSettlement | null;
  /**
   * 同次跨多线时，后续里程碑的绩效结算队列。
   * 当前线 C-13→C-14→结算完成后，再按序打开下一线的 C-13 窗。
   */
  pendingPerformanceSettlementQueue: PendingPerformanceSettlement[];
  actionDeck: string[];
  actionDiscard: string[];
  eventDeck: string[];
  eventDiscard: string[];
  currentEventId: string | null;
  /** 本 Round 是否已翻事件（未翻不可进入互动/抽卡推进） */
  eventFlippedThisRound: boolean;
  activeEventFlags: ActiveEventFlags;
  publicDebt: number;
  /** 本 Round 加过进度的玩家 */
  roundContributors: Set<string>;
  /** 待响应：C-13 窗 / C-14 必答窗 */
  pendingInteraction: PendingInteraction | null;
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
  | { type: "CONFIRM_PLAN" }
  | { type: "FLIP_EVENT" }
  | {
      type: "PLAY_CARD";
      playerId: string;
      cardId: string;
      targets?: string[];
      /** C-12：甩个人债或 Bug（不可甩公共债） */
      dumpKind?: "debt" | "bug";
    }
  | { type: "SUBMIT_DARK_BID"; playerId: string; amount: number }
  | { type: "RESOLVE_DARK_BID"; crosserId: string }
  | { type: "RESPOND_C13"; playerId: string }
  | { type: "PASS_C13"; playerId: string }
  | { type: "RESPOND_C14"; playerId: string; sourceId: string }
  | { type: "DECLINE_C14"; playerId: string }
  | { type: "END_EXECUTE" }
  | { type: "FINISH_END_PHASE" }
  | { type: "END_TURN" }
  | { type: "END_ROUND" };

/** UI / 校验用：当前可执行动作及禁用原因 */
export interface LegalAction {
  action: GameAction;
  label: string;
  enabled: boolean;
  reason?: string;
}
