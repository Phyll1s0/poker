import assert from "node:assert/strict";
import test from "node:test";

import {
  MULTIPLAYER_HOLE_CARD_ANIMATION_MS,
  MULTIPLAYER_HOLE_DEAL_GAP_MS,
  multiplayerHoleCardDealDelayMs,
  multiplayerHoleDealDurationMs,
  multiplayerHoleDealTransition,
} from "../lib/multiplayer-hole-animation.ts";

const lobby = {
  roomId: "room-a",
  handId: null,
  handNo: null,
  dealerSeat: null,
  seats: [],
};

const hand = (handId = "hand-a", overrides = {}) => ({
  roomId: "room-a",
  handId,
  handNo: 1,
  dealerSeat: 2,
  seats: [0, 1, 2, 4],
  ...overrides,
});

test("deals a first hand in two clockwise rounds starting left of the dealer", () => {
  const deal = multiplayerHoleDealTransition(lobby, hand());
  assert.deepEqual(deal, {
    roomId: "room-a",
    handId: "hand-a",
    seatOrder: [4, 0, 1, 2],
  });

  assert.deepEqual(
    [0, 1].flatMap((cardIndex) => deal.seatOrder.map((seat) => ({
      seat,
      cardIndex,
      delay: multiplayerHoleCardDealDelayMs(deal, seat, cardIndex),
    }))),
    [
      { seat: 4, cardIndex: 0, delay: 0 },
      { seat: 0, cardIndex: 0, delay: MULTIPLAYER_HOLE_DEAL_GAP_MS },
      { seat: 1, cardIndex: 0, delay: 2 * MULTIPLAYER_HOLE_DEAL_GAP_MS },
      { seat: 2, cardIndex: 0, delay: 3 * MULTIPLAYER_HOLE_DEAL_GAP_MS },
      { seat: 4, cardIndex: 1, delay: 4 * MULTIPLAYER_HOLE_DEAL_GAP_MS },
      { seat: 0, cardIndex: 1, delay: 5 * MULTIPLAYER_HOLE_DEAL_GAP_MS },
      { seat: 1, cardIndex: 1, delay: 6 * MULTIPLAYER_HOLE_DEAL_GAP_MS },
      { seat: 2, cardIndex: 1, delay: 7 * MULTIPLAYER_HOLE_DEAL_GAP_MS },
    ],
  );
});

test("heads-up deal starts at the big blind and returns to the button/small blind", () => {
  const deal = multiplayerHoleDealTransition(lobby, hand("heads-up", {
    dealerSeat: 3,
    seats: [0, 3],
  }));
  assert.deepEqual(deal?.seatOrder, [0, 3]);
  assert.deepEqual(
    [0, 1].flatMap((cardIndex) => deal.seatOrder.map((seat) => ({
      seat,
      cardIndex,
      delay: multiplayerHoleCardDealDelayMs(deal, seat, cardIndex),
    }))),
    [
      { seat: 0, cardIndex: 0, delay: 0 },
      { seat: 3, cardIndex: 0, delay: MULTIPLAYER_HOLE_DEAL_GAP_MS },
      { seat: 0, cardIndex: 1, delay: 2 * MULTIPLAYER_HOLE_DEAL_GAP_MS },
      { seat: 3, cardIndex: 1, delay: 3 * MULTIPLAYER_HOLE_DEAL_GAP_MS },
    ],
  );
});

test("animates a genuinely new hand but never initial hydration or repeated polls", () => {
  assert.equal(multiplayerHoleDealTransition(null, hand()), null);
  assert.equal(multiplayerHoleDealTransition(hand(), hand()), null);
  assert.equal(multiplayerHoleDealTransition(hand(), lobby), null);
  assert.equal(multiplayerHoleDealTransition(
    hand(),
    hand("hand-b", { roomId: "room-b" }),
  ), null);

  const nextHand = hand("hand-b", { handNo: 2 });
  assert.deepEqual(multiplayerHoleDealTransition(hand(), nextHand), {
    roomId: "room-a",
    handId: "hand-b",
    seatOrder: [4, 0, 1, 2],
  });
  // Polling may first see the new hand after actions have started. The frame
  // intentionally keys only on hand identity, so the deal still runs once.
  assert.equal(multiplayerHoleDealTransition(nextHand, nextHand), null);
  assert.equal(multiplayerHoleDealTransition(
    hand("hand-b", { handNo: 2 }),
    hand("hand-a", { handNo: 1 }),
  ), null);
});

test("bounds invalid card requests and keeps the animation alive through the final card", () => {
  const deal = multiplayerHoleDealTransition(lobby, hand());
  assert.equal(multiplayerHoleCardDealDelayMs(deal, 5, 0), null);
  assert.equal(multiplayerHoleCardDealDelayMs(deal, 4, 2), null);
  assert.equal(
    multiplayerHoleDealDurationMs(deal),
    7 * MULTIPLAYER_HOLE_DEAL_GAP_MS + MULTIPLAYER_HOLE_CARD_ANIMATION_MS,
  );
});
