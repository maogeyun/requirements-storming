import type {
  ForceWindow,
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

/** V1 主机不可改规则：固定默认模块；联机人数固定 4。 */
export function getDefaultRoomConfig(playerCount = 4): RoomConfig {
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

/**
 * Seat-scoped view：剥离他座手牌 / OKR / 暗标出价等秘密。
 * 公开：performance、debt、bugs、handCount 等。
 */
export function getPlayerView(
  gameState: GameState,
  selfId: string,
  roomCode: string,
  phase: RoomPhase,
  config: RoomConfig = getDefaultRoomConfig(gameState.config.playerCount),
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

/** 对指定座位是否存在必须响应的强制窗；无关座位返回 null。 */
export function getForceWindowForSeat(
  state: GameState,
  seatId: string,
): ForceWindow | null {
  const interaction = state.pendingInteraction;
  if (interaction?.type === "C14") {
    if (interaction.targetId !== seatId) return null;
    return {
      kind: "c14",
      sourceCardId: interaction.sourceCardId,
      sourceId: interaction.sourceId,
      targetId: interaction.targetId,
      mustRespond: true,
    };
  }

  if (interaction?.type === "C13_WINDOW") {
    if (
      seatId === interaction.breakerId ||
      interaction.passedIds.includes(seatId)
    ) {
      return null;
    }
    return {
      kind: "c13",
      milestoneId: interaction.milestoneId,
      breakerId: interaction.breakerId,
      mustRespond: true,
    };
  }

  const pending = state.pendingDarkBid;
  if (pending && !pending.resolved) {
    if (seatId in pending.bids) return null;
    return {
      kind: "dark_bid",
      milestoneId: pending.milestoneId,
      isCatchUp: pending.isCatchUp,
      mustRespond: true,
    };
  }

  return null;
}
