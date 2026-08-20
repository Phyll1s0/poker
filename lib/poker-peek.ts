export type PokerPeekPlayer = {
  id: number;
  isHuman: boolean;
  hole: readonly unknown[];
};

export function pokerPrivatePeekCandidateIds(
  players: readonly PokerPeekPlayer[],
  publiclyShownPlayerIds: readonly number[],
  viewerId = 0,
) {
  const publiclyShown = new Set(publiclyShownPlayerIds);
  return players
    .filter((player) => (
      player.id !== viewerId
      && !player.isHuman
      && player.hole.length === 2
      && !publiclyShown.has(player.id)
    ))
    .map((player) => player.id);
}

export function selectPokerPrivatePeek(
  peekedPlayerIds: readonly number[],
  targetPlayerId: number,
  candidatePlayerIds: readonly number[],
  limit = 1,
) {
  if (
    peekedPlayerIds.length >= Math.max(0, limit)
    || peekedPlayerIds.includes(targetPlayerId)
    || !candidatePlayerIds.includes(targetPlayerId)
  ) return [...peekedPlayerIds];
  return [...peekedPlayerIds, targetPlayerId];
}
