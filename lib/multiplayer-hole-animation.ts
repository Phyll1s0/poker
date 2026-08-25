import { ONLINE_MAX_PLAYERS } from "./online-poker.ts";

export const MULTIPLAYER_HOLE_DEAL_GAP_MS = 140;
export const MULTIPLAYER_HOLE_CARD_ANIMATION_MS = 460;

export type MultiplayerHoleFrame = {
  roomId: string;
  handId: string | null;
  handNo: number | null;
  dealerSeat: number | null;
  seats: readonly number[];
};

export type MultiplayerHoleDeal = {
  roomId: string;
  handId: string;
  seatOrder: readonly number[];
};

function clockwiseAfterDealer(seats: readonly number[], dealerSeat: number) {
  return [...new Set(seats)].sort((left, right) => {
    const leftDistance = (left - dealerSeat + ONLINE_MAX_PLAYERS) % ONLINE_MAX_PLAYERS || ONLINE_MAX_PLAYERS;
    const rightDistance = (right - dealerSeat + ONLINE_MAX_PLAYERS) % ONLINE_MAX_PLAYERS || ONLINE_MAX_PLAYERS;
    return leftDistance - rightDistance;
  });
}

/**
 * Starts a private-card animation only for a hand observed being created while
 * the viewer is already in the same room. Initial hydration and reconnects
 * therefore seed the cursor without replaying an old deal.
 */
export function multiplayerHoleDealTransition(
  previous: MultiplayerHoleFrame | null,
  next: MultiplayerHoleFrame | null,
): MultiplayerHoleDeal | null {
  if (!previous || !next || !next.handId || next.dealerSeat === null) return null;
  if (previous.roomId !== next.roomId || previous.handId === next.handId) return null;
  if (
    previous.handNo !== null
    && (next.handNo === null || next.handNo <= previous.handNo)
  ) return null;

  const seatOrder = clockwiseAfterDealer(
    next.seats.filter((seat) => Number.isInteger(seat) && seat >= 0 && seat < ONLINE_MAX_PLAYERS),
    next.dealerSeat,
  );
  if (seatOrder.length < 2) return null;

  return {
    roomId: next.roomId,
    handId: next.handId,
    seatOrder,
  };
}

/**
 * Texas hold'em is dealt in two full clockwise rounds. This delay maps a seat
 * and card index onto that public dealing order without exposing card values.
 */
export function multiplayerHoleCardDealDelayMs(
  deal: MultiplayerHoleDeal,
  seat: number,
  cardIndex: number,
) {
  if (cardIndex !== 0 && cardIndex !== 1) return null;
  const seatIndex = deal.seatOrder.indexOf(seat);
  if (seatIndex < 0) return null;
  return (cardIndex * deal.seatOrder.length + seatIndex) * MULTIPLAYER_HOLE_DEAL_GAP_MS;
}

export function multiplayerHoleDealDurationMs(deal: MultiplayerHoleDeal) {
  const dealtCardCount = deal.seatOrder.length * 2;
  return Math.max(0, dealtCardCount - 1) * MULTIPLAYER_HOLE_DEAL_GAP_MS
    + MULTIPLAYER_HOLE_CARD_ANIMATION_MS;
}
