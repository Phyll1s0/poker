export type MultiplayerBoardFrame = {
  roomId: string;
  handId: string;
  boardCount: number;
};

export type MultiplayerBoardDeal = {
  roomId: string;
  handId: string;
  dealFrom: number;
  dealCount: number;
};

/**
 * Infers newly dealt community cards between two snapshots of the same hand.
 * Initial hydration and unrelated or non-forward transitions must not replay
 * an animation.
 */
export function multiplayerBoardDealTransition(
  previous: MultiplayerBoardFrame | null,
  next: MultiplayerBoardFrame | null,
): MultiplayerBoardDeal | null {
  if (!previous || !next) return null;
  if (previous.roomId !== next.roomId || previous.handId !== next.handId) return null;

  const dealCount = next.boardCount - previous.boardCount;
  if (dealCount <= 0) return null;

  return {
    roomId: next.roomId,
    handId: next.handId,
    dealFrom: previous.boardCount,
    dealCount,
  };
}
