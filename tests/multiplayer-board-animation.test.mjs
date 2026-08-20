import assert from "node:assert/strict";
import test from "node:test";

import { multiplayerBoardDealTransition } from "../lib/multiplayer-board-animation.ts";

const frame = (boardCount, overrides = {}) => ({
  roomId: "room-a",
  handId: "hand-a",
  boardCount,
  ...overrides,
});

test("infers the three-card flop as one staggered deal", () => {
  assert.deepEqual(multiplayerBoardDealTransition(frame(0), frame(3)), {
    roomId: "room-a",
    handId: "hand-a",
    dealFrom: 0,
    dealCount: 3,
  });
});

test("infers turn and river as one newly dealt card", () => {
  assert.deepEqual(multiplayerBoardDealTransition(frame(3), frame(4)), {
    roomId: "room-a",
    handId: "hand-a",
    dealFrom: 3,
    dealCount: 1,
  });
  assert.deepEqual(multiplayerBoardDealTransition(frame(4), frame(5)), {
    roomId: "room-a",
    handId: "hand-a",
    dealFrom: 4,
    dealCount: 1,
  });
});

test("infers a complete all-in runout from an empty board", () => {
  assert.deepEqual(multiplayerBoardDealTransition(frame(0), frame(5)), {
    roomId: "room-a",
    handId: "hand-a",
    dealFrom: 0,
    dealCount: 5,
  });
});

test("does not animate initial hydration, unchanged polls, or a board rollback", () => {
  assert.equal(multiplayerBoardDealTransition(null, frame(3)), null);
  assert.equal(multiplayerBoardDealTransition(frame(3), null), null);
  assert.equal(multiplayerBoardDealTransition(frame(3), frame(3)), null);
  assert.equal(multiplayerBoardDealTransition(frame(4), frame(3)), null);
});

test("does not carry an animation across rooms or hands", () => {
  assert.equal(multiplayerBoardDealTransition(
    frame(0),
    frame(3, { roomId: "room-b" }),
  ), null);
  assert.equal(multiplayerBoardDealTransition(
    frame(0),
    frame(3, { handId: "hand-b" }),
  ), null);
});
