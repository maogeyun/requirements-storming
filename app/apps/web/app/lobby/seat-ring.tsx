"use client";

import type { LobbyPlayer, LobbyState } from "@rs/shared";

type SeatRingProps = {
  seatCount: number;
  players: LobbyPlayer[];
  selfId?: string | null;
  roomCode?: string;
};

/**
 * Waiting seat ring: empty = dashed; filled = nickname; self highlighted.
 * Never labels Bot — names come from lobby as-is.
 */
export function LobbySeatRing({
  seatCount,
  players,
  selfId,
  roomCode,
}: SeatRingProps) {
  const slots = Array.from({ length: seatCount }, (_, index) => {
    const player = players[index] ?? null;
    return { index, player };
  });

  return (
    <div className="lobby-seat-ring" aria-label="座位环">
      {roomCode ? (
        <p className="lobby-room-code">
          房间码 <span>{roomCode}</span>
        </p>
      ) : null}
      <ul className="lobby-seat-slots">
        {slots.map(({ index, player }) => {
          if (!player) {
            return (
              <li key={`empty-${index}`} className="lobby-seat empty">
                <span className="lobby-seat-label">空位</span>
              </li>
            );
          }
          const isSelf = selfId != null && player.id === selfId;
          return (
            <li
              key={player.id}
              className={`lobby-seat seated${isSelf ? " self" : ""}${
                player.connected ? "" : " away"
              }`}
            >
              <span className="lobby-seat-name">{player.name}</span>
              {player.isHost ? <span className="lobby-seat-host">房主</span> : null}
              {isSelf ? <span className="lobby-seat-self">本座</span> : null}
            </li>
          );
        })}
      </ul>
      <p className="lobby-seat-hint muted">满 {seatCount} 人自动开局</p>
    </div>
  );
}

export function lobbyFromPartial(
  lobby: LobbyState | null | undefined,
): { seatCount: number; players: LobbyPlayer[]; roomCode: string } {
  return {
    seatCount: lobby?.seatCount ?? 4,
    players: lobby?.players ?? [],
    roomCode: lobby?.roomCode ?? "",
  };
}
