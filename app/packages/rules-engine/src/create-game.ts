import {
  buildActionDeck,
  buildEventDeck,
  buildOkrDeck,
  buildRequirementDeck,
  gameConstants,
  getMilestonesForPlayerCount,
  getSprintZoneDistance,
  getTotalProgressForPlayerCount,
} from "@rs/game-data";
import type { GameConfig, GameState, MilestoneId, PlayerState } from "@rs/shared";
import { createRng, drawOne, shuffle } from "./rng.js";

const ALL_MILESTONE_IDS: MilestoneId[] = ["M1", "M2", "M3", "M4"];

export interface CreateGameOptions {
  playerNames: string[];
  config?: Partial<GameConfig>;
  seed?: number;
}

export function createDefaultConfig(playerCount: number): GameConfig {
  return {
    playerCount,
    sprintCount: 1,
    modules: {
      darkBid: true,
      interactionCards: true,
      hiddenOkr: true,
      continuousSprint: false,
    },
  };
}

export function createGame(options: CreateGameOptions): GameState {
  const { playerNames, seed = Date.now() } = options;
  const playerCount = playerNames.length;
  if (playerCount < 2 || playerCount > 5) {
    throw new Error("Player count must be between 2 and 5");
  }

  const config: GameConfig = {
    ...createDefaultConfig(playerCount),
    ...options.config,
    playerCount,
  };

  const rng = createRng(seed);
  const milestones = getMilestonesForPlayerCount(playerCount);
  const totalProgressTarget = getTotalProgressForPlayerCount(playerCount);

  let requirementDeck = shuffle(buildRequirementDeck(), rng);
  const requirementPick = config.requirementId
    ? { item: config.requirementId, rest: requirementDeck.filter((id) => id !== config.requirementId) }
    : drawOne(requirementDeck, rng);
  requirementDeck = requirementPick.rest;

  let okrPool = shuffle(buildOkrDeck(), rng);
  const players: PlayerState[] = playerNames.map((name, index) => {
    let okrId: string | null = null;
    if (config.modules.hiddenOkr && okrPool.length > 0) {
      const pick = drawOne(okrPool, rng);
      okrId = pick.item;
      okrPool = pick.rest;
    }
    return createPlayer(`p${index + 1}`, name, okrId);
  });

  const actionDeck = shuffle(buildActionDeck(), rng);
  const eventDeck = shuffle(buildEventDeck(), rng);

  const state: GameState = {
    config,
    constants: gameConstants,
    players,
    playerOrder: players.map((p) => p.id),
    currentPlayerIndex: 0,
    turnPhase: "draw",
    round: 1,
    season: 1,
    sprint: 1,
    progress: 0,
    totalProgressTarget,
    milestones,
    requirementId: requirementPick.item,
    crossedMilestones: [],
    darkBidUsed: { M1: false, M2: false, M3: false, M4: false },
    pendingDarkBid: null,
    actionDeck,
    actionDiscard: [],
    eventDeck,
    eventDiscard: [],
    currentEventId: null,
    publicDebt: requirementPick.item === "R-06" ? 3 : 0,
    roundContributors: new Set(),
    pendingInteraction: null,
    darkBidTotalSpent: 0,
    usedRequirementIds: [requirementPick.item],
    gameOver: false,
    winnerId: null,
    rngSeed: seed,
  };

  dealOpeningHands(state, rng);
  return state;
}

function createPlayer(id: string, name: string, okrId: string | null): PlayerState {
  return {
    id,
    name,
    performance: 0,
    hand: [],
    okrId,
    personalBugs: 0,
    personalDebt: 0,
    workHoursRemaining: gameConstants.baseWorkHoursPerTurn,
    workHoursBudget: gameConstants.baseWorkHoursPerTurn,
    usedOvertime: false,
    nextTurnBonusHours: 0,
    handLimitModifier: 0,
    slackingNextSeason: false,
    bottomMarks: 0,
    contributedThisRound: false,
    seasonPlayedCollab: [],
    gameLimitUsed: {},
    milestoneBreakCount: 0,
    bugsClearedTotal: 0,
    collabCardsPlayed: 0,
    breakthroughParticipations: 0,
    neverUsedOvertime: true,
  };
}

function dealOpeningHands(state: GameState, rng: () => number): void {
  for (const player of state.players) {
    while (player.hand.length < gameConstants.handLimit && state.actionDeck.length > 0) {
      const { item, rest } = drawOne(state.actionDeck, rng);
      state.actionDeck = rest;
      player.hand.push(item);
    }
  }
}

export function getPlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`Player not found: ${playerId}`);
  }
  return player;
}

export function getSprintZoneDistanceForState(state: GameState): number {
  return getSprintZoneDistance(state.config.playerCount);
}

export function resetDarkBidFlags(state: GameState): void {
  for (const id of ALL_MILESTONE_IDS) {
    state.darkBidUsed[id] = false;
  }
}
