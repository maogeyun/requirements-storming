import type {
  GameState,
  OtherPlayerView,
  PlayerState,
  PlayerView,
  PlayerViewEntry,
  PublicPlayerSummary,
  RoomConfig,
  RoomPhase,
  SelfPlayerView,
} from "@rs/shared";

export function getDefaultRoomConfig(): RoomConfig {
  return {
    playerCount: 4,
    sprintCount: 1,
    modules: {
      darkBid: true,
      interactionCards: true,
      hiddenOkr: true,
      continuousSprint: false,
    },
    requirementId: "R-01",
  };
}

function toPublicSummary(player: PlayerState): PublicPlayerSummary {
  return {
    id: player.id,
    name: player.name,
    displayName: player.displayName,
    performance: player.performance,
    handCount: player.hand.length,
    personalBugs: player.personalBugs,
    personalDebt: player.personalDebt,
    workHoursRemaining: player.workHoursRemaining,
    contributedThisRound: player.contributedThisRound,
    milestoneBreakCount: player.milestoneBreakCount,
  };
}

function shouldRevealOkr(gameState: GameState): boolean {
  // 仅总结算亮牌后全员可见；gameOver 但互动窗未关时仍保持暗牌
  return gameState.okrRevealed;
}

export function getPlayerView(
  gameState: GameState,
  selfId: string,
  roomCode: string,
  phase: RoomPhase,
  config: RoomConfig = getDefaultRoomConfig(),
): PlayerView {
  const revealOkr = shouldRevealOkr(gameState);
  const pendingDarkBid = gameState.pendingDarkBid;

  const players: PlayerViewEntry[] = gameState.players.map((player) => {
    if (player.id === selfId) {
      const selfView: SelfPlayerView = {
        ...player,
        isSelf: true,
      };
      return selfView;
    }

    const otherView: OtherPlayerView = {
      ...toPublicSummary(player),
      isSelf: false,
      // 亮牌前他座不可窥 OKR
      okrId: revealOkr ? player.okrId : null,
    };
    return otherView;
  });

  return {
    phase,
    selfId,
    roomCode,
    config,
    round: gameState.round,
    season: gameState.season,
    sprint: gameState.sprint,
    progress: gameState.progress,
    totalProgressTarget: gameState.totalProgressTarget,
    currentEventId: gameState.currentEventId,
    publicDebt: gameState.publicDebt,
    turnPhase: gameState.turnPhase,
    currentPlayerId: gameState.playerOrder[gameState.currentPlayerIndex] ?? null,
    players,
    pendingDarkBid: pendingDarkBid
      ? {
          milestoneId: pendingDarkBid.milestoneId,
          isCatchUp: pendingDarkBid.isCatchUp,
          resolved: pendingDarkBid.resolved,
          myBid: pendingDarkBid.bids[selfId] ?? null,
        }
      : null,
    gameOver: gameState.gameOver,
    winnerId: gameState.winnerId,
    okrRevealed: gameState.okrRevealed,
    okrSettlements: revealOkr ? gameState.okrSettlements : null,
  };
}
