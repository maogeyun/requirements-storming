import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ActionCardDefinition,
  EventCardDefinition,
  GameConstants,
  MilestoneDefinition,
  OkrCardDefinition,
  RequirementCardDefinition,
} from "@rs/shared";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(dataDir, file), "utf-8")) as T;
}

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

const rawConstants = loadJson<RawConstants>("constants.json");

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
export const actionCards = loadJson<ActionCardWithMeta[]>("action-cards.json");
export const eventCards = loadJson<EventCardDefinition[]>("event-cards.json");
export const requirementCards = loadJson<RequirementCardDefinition[]>("requirement-cards.json");
export const okrCards = loadJson<OkrCardDefinition[]>("okr-cards.json");

const actionCardMap = new Map(actionCards.map((c) => [c.id, c]));

export function getActionCard(id: string): ActionCardWithMeta | undefined {
  return actionCardMap.get(id);
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
