import assert from "node:assert/strict";
import test from "node:test";

import { RANGECRAFT_STANDARD_V1 } from "../lib/gto-standard.ts";
import {
  RANGECRAFT_STANDARD_STRATEGY_CONFIG_V2,
  adaptRangeCraftStandardSpotV2,
  rangeCraftStandardPositionMap,
} from "../lib/poker-strategy-adapter.ts";
import { strategyNodeKeyV2 } from "../lib/poker-strategy.ts";

const TABLE_POSITIONS = ["BTN", "SB", "BB", "UTG", "HJ", "CO"];

function facingOpenInput({ bigBlind = 10, ids = [0, 1, 2, 3, 4, 5], explicitPositions = false } = {}) {
  const money = (bb) => bb * bigBlind;
  const states = [
    { stack: 100, street: 0, total: 0 },
    { stack: 99.5, street: 0.5, total: 0.5 },
    { stack: 99, street: 1, total: 1 },
    { stack: 97.5, street: 2.5, total: 2.5 },
    { stack: 100, street: 0, total: 0 },
    { stack: 100, street: 0, total: 0 },
  ];
  return {
    seats: ids.map((id, index) => ({
      id,
      ...(explicitPositions ? { position: TABLE_POSITIONS[index] } : {}),
      startingStack: money(100),
      stack: money(states[index].stack),
      streetCommitted: money(states[index].street),
      totalCommitted: money(states[index].total),
      folded: false,
    })),
    dealerId: ids[0],
    heroId: ids[2],
    heroCards: [
      { rank: 14, suit: "♠" },
      { rank: 10, suit: "hearts" },
    ],
    board: [],
    street: "preflop",
    bigBlind,
    smallBlind: money(0.5),
    ante: 0,
    rake: { percent: 0, cap: 0 },
    pot: money(4),
    toCall: money(1.5),
    minimumRaiseTo: money(4),
    legalActions: [
      { action: "fold" },
      { action: "call" },
      { action: "raise", raiseTo: money(4) },
      { action: "raise", raiseTo: money(10) },
      { action: "raise", raiseTo: money(100), isAllIn: true },
    ],
    actionHistory: [{
      street: "preflop",
      playerId: ids[3],
      action: "raise",
      increment: money(2.5),
      amountTo: money(2.5),
      potBefore: money(1.5),
      potAfter: money(4),
    }],
  };
}

function flopInput(bigBlind = 10) {
  const money = (bb) => bb * bigBlind;
  const folded = new Set([0, 1, 4, 5]);
  const totals = [0, 0.5, 2.5, 2.5, 0, 0];
  return {
    seats: [0, 1, 2, 3, 4, 5].map((id, index) => ({
      id,
      position: TABLE_POSITIONS[index],
      startingStack: money(100),
      stack: money(100 - totals[index]),
      streetCommitted: 0,
      totalCommitted: money(totals[index]),
      folded: folded.has(id),
    })),
    heroId: 2,
    heroCards: [{ rank: 8, suit: "♣" }, { rank: 7, suit: "clubs" }],
    board: [
      { rank: 14, suit: "♥" },
      { rank: 9, suit: "diamonds" },
      { rank: 3, suit: "♠" },
    ],
    street: "flop",
    bigBlind,
    pot: money(5.5),
    toCall: 0,
    minimumRaiseTo: money(1),
    legalActions: [
      { action: "check" },
      { action: "raise", raiseTo: money(2) },
      { action: "raise", raiseTo: money(97.5), isAllIn: true },
    ],
    actionHistory: [
      { street: "preflop", playerId: 3, action: "raise", increment: money(2.5) },
      { street: "preflop", playerId: 4, action: "fold", increment: 0 },
      { street: "preflop", playerId: 5, action: "fold", increment: 0 },
      { street: "preflop", playerId: 0, action: "fold", increment: 0 },
      { street: "preflop", playerId: 1, action: "fold", increment: 0 },
      { street: "preflop", playerId: 2, action: "call", increment: money(1.5) },
    ],
  };
}

test("exports an immutable, no-rake StrategySpotV2 config for RangeCraft Standard v1", () => {
  const config = RANGECRAFT_STANDARD_STRATEGY_CONFIG_V2;
  assert.equal(config.tableSize, 6);
  assert.deepEqual(config.blinds, { smallBb: 0.5, bigBb: 1 });
  assert.deepEqual(config.ante, { kind: "none", amountBb: 0 });
  assert.deepEqual(config.rake, { percent: 0, capBb: 0, noFlopNoDrop: true });
  assert.deepEqual(config.startingStacksBb, { UTG: 100, HJ: 100, CO: 100, BTN: 100, SB: 100, BB: 100 });
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.rake));
});

test("derives Standard positions from a clockwise table without page-private player types", () => {
  const positions = rangeCraftStandardPositionMap(["a", "b", "c", "d", "e", "f"], "c");
  assert.deepEqual(positions, {
    c: "BTN",
    d: "SB",
    e: "BB",
    f: "UTG",
    a: "HJ",
    b: "CO",
  });
  assert.ok(Object.isFrozen(positions));
  assert.throws(() => rangeCraftStandardPositionMap([0, 1, 2], 0), /恰好包含 6 个座位/);
});

test("adapts a serializable solo-table decision and preserves every explicit legal raise size", () => {
  const spot = adaptRangeCraftStandardSpotV2(facingOpenInput());
  assert.equal(spot.gameSpecId, RANGECRAFT_STANDARD_V1.gameSpecId);
  assert.equal(spot.treeId, RANGECRAFT_STANDARD_V1.treeId);
  assert.equal(spot.heroId, "2");
  assert.deepEqual(spot.heroCards, [
    { rank: 14, suit: "spades" },
    { rank: 10, suit: "hearts" },
  ]);
  assert.equal(spot.potBb, 4);
  assert.equal(spot.toCallBb, 1.5);
  assert.equal(spot.minimumRaiseToBb, 4);
  assert.deepEqual(spot.legalActions, [
    { action: "fold" },
    { action: "call" },
    { action: "raise", raiseToBb: 4, isAllIn: false },
    { action: "raise", raiseToBb: 10, isAllIn: false },
    { action: "raise", raiseToBb: 100, isAllIn: true },
  ]);
  assert.deepEqual(spot.actionHistory, [{
    street: "preflop",
    playerId: "3",
    action: "raise",
    amountToBb: 2.5,
    incrementBb: 2.5,
    potAfterBb: 4,
  }]);
  assert.deepEqual(spot.seats.map(({ position }) => position), ["UTG", "HJ", "CO", "BTN", "SB", "BB"]);
  assert.match(strategyNodeKeyV2(spot), /^rc-strategy-node-v2-[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(spot));
  assert.ok(Object.isFrozen(spot.actionHistory));
});

test("canonical node identity survives chip scaling, seat order, transient ids and action ordering", () => {
  const baseline = facingOpenInput({ explicitPositions: true });
  const scaled = facingOpenInput({ bigBlind: 1, explicitPositions: true });
  assert.equal(
    strategyNodeKeyV2(adaptRangeCraftStandardSpotV2(baseline)),
    strategyNodeKeyV2(adaptRangeCraftStandardSpotV2(scaled)),
  );

  const renamed = facingOpenInput({
    ids: ["new-btn", "new-sb", "new-bb", "new-utg", "new-hj", "new-co"],
    explicitPositions: true,
  });
  renamed.seats.reverse();
  renamed.legalActions.reverse();
  renamed.heroCards.reverse();
  assert.equal(
    strategyNodeKeyV2(adaptRangeCraftStandardSpotV2(baseline)),
    strategyNodeKeyV2(adaptRangeCraftStandardSpotV2(renamed)),
  );
});

test("replays a complete multi-street history and resets street commitments", () => {
  const spot = adaptRangeCraftStandardSpotV2(flopInput());
  assert.equal(spot.street, "flop");
  assert.equal(spot.potBb, 5.5);
  assert.equal(spot.toCallBb, 0);
  assert.deepEqual(spot.activePlayerIds, ["3", "2"]);
  assert.deepEqual(spot.legalActions, [
    { action: "check" },
    { action: "raise", raiseToBb: 2, isAllIn: false },
    { action: "raise", raiseToBb: 97.5, isAllIn: true },
  ]);
  assert.equal(spot.actionHistory.at(-1).amountToBb, 2.5);
  assert.equal(spot.actionHistory.at(-1).potAfterBb, 5.5);
  assert.ok(spot.seats.every((seat) => seat.streetCommittedBb === 0));
});

test("forces no-rake, zero ante and exact 100BB Standard-v1 starting stacks", () => {
  const raked = facingOpenInput();
  raked.rake = { percent: 0.05, cap: 3 };
  assert.throws(() => adaptRangeCraftStandardSpotV2(raked), /强制无抽水/);

  const ante = facingOpenInput();
  ante.ante = 1;
  assert.throws(() => adaptRangeCraftStandardSpotV2(ante), /不使用 ante/);

  const short = facingOpenInput();
  short.seats[4].startingStack = 900;
  short.seats[4].stack = 900;
  assert.throws(() => adaptRangeCraftStandardSpotV2(short), /100BB 起始筹码/);
});

test("rejects incomplete or contradictory explicit legal actions", () => {
  const missingCall = facingOpenInput();
  missingCall.legalActions = missingCall.legalActions.filter((action) => action.action !== "call");
  assert.throws(() => adaptRangeCraftStandardSpotV2(missingCall), /缺少必需动作 call/);

  const illegalCheck = facingOpenInput();
  illegalCheck.legalActions.push({ action: "check" });
  assert.throws(() => adaptRangeCraftStandardSpotV2(illegalCheck), /面对下注.*check/);

  const missingRaise = facingOpenInput();
  missingRaise.legalActions = [{ action: "fold" }, { action: "call" }];
  assert.throws(() => adaptRangeCraftStandardSpotV2(missingRaise), /至少一个 raise-to/);

  const belowMinimum = facingOpenInput();
  belowMinimum.legalActions.push({ action: "raise", raiseTo: 35 });
  assert.throws(() => adaptRangeCraftStandardSpotV2(belowMinimum), /不能低于 minimumRaiseTo/);

  const falseAllIn = facingOpenInput();
  falseAllIn.legalActions.at(-1).isAllIn = false;
  assert.throws(() => adaptRangeCraftStandardSpotV2(falseAllIn), /isAllIn.*不一致/);
});

test("rejects incomplete history and any no-rake pot/accounting drift before keying", () => {
  const wrongPot = facingOpenInput();
  wrongPot.pot = 41;
  assert.throws(() => adaptRangeCraftStandardSpotV2(wrongPot), /无抽水底池.*totalCommitted/);

  const wrongHistory = facingOpenInput();
  wrongHistory.actionHistory[0].increment = 20;
  assert.throws(() => adaptRangeCraftStandardSpotV2(wrongHistory), /amountTo.*不一致|actionHistory.*不一致/);

  const omittedHistory = facingOpenInput();
  omittedHistory.actionHistory = [];
  assert.throws(
    () => adaptRangeCraftStandardSpotV2(omittedHistory),
    /(streetCommitted|totalCommitted|pot).*actionHistory/,
  );

  const duplicateId = facingOpenInput();
  duplicateId.seats[5].id = duplicateId.seats[4].id;
  assert.throws(() => adaptRangeCraftStandardSpotV2(duplicateId), /id.*不能重复/);
});
