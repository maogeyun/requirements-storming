import type {
  ActionCardDefinition,
  EventCardDefinition,
  GameConstants,
  MilestoneDefinition,
  OkrCardDefinition,
  RequirementCardDefinition,
} from "@rs/shared";
import actionCardsJson from "./data/action-cards.json" with { type: "json" };
import constantsJson from "./data/constants.json" with { type: "json" };
import eventCardsJson from "./data/event-cards.json" with { type: "json" };
import okrCardsJson from "./data/okr-cards.json" with { type: "json" };
import requirementCardsJson from "./data/requirement-cards.json" with { type: "json" };

type RawConstants = Omit<GameConstants, "milestonesStandard" | "milestonesTwoPlayer"> & {
  milestonesStandard: MilestoneDefinition[];
  milestonesTwoPlayer: MilestoneDefinition[];
  p3Milestones: MilestoneDefinition[];
};

export type ActionCardWithMeta = ActionCardDefinition & {
  progressGain?: number;
  collabProgress?: number;
  selfPerformance?: number;
};

const rawConstants = constantsJson as RawConstants;

export const gameConstants: GameConstants = {
  version: rawConstants.version,
  baseWorkHoursPerTurn: rawConstants.baseWorkHoursPerTurn,
  handLimit: rawConstants.handLimit,
  roundsPerSeason: rawConstants.roundsPerSeason,
  defaultSprintCount: rawConstants.defaultSprintCount,
  totalProgressStandard: rawConstants.totalProgressStandard,
  totalProgressTwoPlayer: rawConstants.totalProgressTwoPlayer,
  milestonesStandard: rawConstants.milestonesStandard,
  milestonesTwoPlayer: rawConstants.milestonesTwoPlayer,
  sprintZoneDistance: rawConstants.sprintZoneDistance,
  sprintZoneDistanceTwoPlayer: rawConstants.sprintZoneDistanceTwoPlayer,
  darkBidMax: rawConstants.darkBidMax,
  darkBidMaxReduced: rawConstants.darkBidMaxReduced,
  darkBidTotalCostThreshold: rawConstants.darkBidTotalCostThreshold,
  workHourCaps: rawConstants.workHourCaps,
};

export const p3Milestones = rawConstants.p3Milestones;
export const actionCards = actionCardsJson as ActionCardWithMeta[];
export const eventCards = eventCardsJson as EventCardDefinition[];
export const requirementCards = requirementCardsJson as RequirementCardDefinition[];
export const okrCards = okrCardsJson as OkrCardDefinition[];

const actionCardMap = new Map(actionCards.map((c) => [c.id, c]));
const eventCardMap = new Map(eventCards.map((c) => [c.id, c]));
const okrCardMap = new Map(okrCards.map((c) => [c.id, c]));

export function getActionCard(id: string): ActionCardWithMeta | undefined {
  return actionCardMap.get(id);
}

export function getEventCard(id: string): EventCardDefinition | undefined {
  return eventCardMap.get(id);
}

export function getOkrCard(id: string): OkrCardDefinition | undefined {
  return okrCardMap.get(id);
}

/** O-05 团队基石：仅计 C-01～C-07，不含互动卡 C-12～C-14 */
export const TEAM_FOUNDATION_COLLAB_IDS = [
  "C-01",
  "C-02",
  "C-03",
  "C-04",
  "C-05",
  "C-06",
  "C-07",
] as const;

export type TeamFoundationCollabId = (typeof TEAM_FOUNDATION_COLLAB_IDS)[number];

export function isTeamFoundationCollabId(id: string): id is TeamFoundationCollabId {
  return (TEAM_FOUNDATION_COLLAB_IDS as readonly string[]).includes(id);
}

export const INTERACTION_CARD_IDS = ["C-12", "C-13", "C-14"] as const;
export type InteractionCardId = (typeof INTERACTION_CARD_IDS)[number];

export function isInteractionCardId(id: string): id is InteractionCardId {
  return (INTERACTION_CARD_IDS as readonly string[]).includes(id);
}

export function buildActionDeck(): string[] {
  const deck: string[] = [];
  for (const card of actionCards) {
    for (let i = 0; i < card.copies; i += 1) {
      deck.push(card.id);
    }
  }
  return deck;
}

export function buildEventDeck(): string[] {
  return eventCards.map((c) => c.id);
}

export function buildOkrDeck(): string[] {
  return okrCards.map((c) => c.id);
}

export function buildRequirementDeck(): string[] {
  return requirementCards.map((c) => c.id);
}

export function getMilestonesForPlayerCount(count: number): MilestoneDefinition[] {
  return count === 2 ? gameConstants.milestonesTwoPlayer : gameConstants.milestonesStandard;
}

export function getTotalProgressForPlayerCount(count: number): number {
  return count === 2 ? gameConstants.totalProgressTwoPlayer : gameConstants.totalProgressStandard;
}

export function getSprintZoneDistance(count: number): number {
  return count === 2
    ? gameConstants.sprintZoneDistanceTwoPlayer
    : gameConstants.sprintZoneDistance;
}
