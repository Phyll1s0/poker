import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateEquity,
  makeDeck,
  preflopPercentile,
} from "../lib/poker-evaluator.ts";
import {
  createPublicOpponentRanges,
  opponentHoldingWeight,
} from "../lib/poker-range.ts";
import { getPreflopStrategy } from "../lib/poker-preflop.ts";

const c = (rank, suit) => ({ rank, suit });

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function action(overrides = {}) {
  return {
    playerId: 1,
    street: "preflop",
    kind: "raise",
    amount: 30,
    toCall: 10,
    stackBefore: 1000,
    isAllIn: false,
    potBefore: 15,
    raiseCountBefore: 0,
    activeOpponents: 5,
    ...overrides,
  };
}

function weightedMeanPreflopPercentile(evidence) {
  const deck = makeDeck([0, 1, 2, 3]);
  let weightedTotal = 0;
  let totalWeight = 0;
  for (let first = 0; first < deck.length - 1; first += 1) {
    for (let second = first + 1; second < deck.length; second += 1) {
      const hole = [deck[first], deck[second]];
      const weight = opponentHoldingWeight(hole, [], evidence);
      weightedTotal += preflopPercentile(hole) * weight;
      totalWeight += weight;
    }
  }
  return weightedTotal / totalWeight;
}

function holdingKey(cards) {
  return cards.map((card) => `${card.rank}:${card.suit}`).sort().join("|");
}

function onlyHolding(cards) {
  const expected = holdingKey(cards);
  return (candidate) => holdingKey(candidate) === expected ? 1 : 0;
}

function weightedRange(entries, floor = 0) {
  const weights = new Map(entries.map(([cards, weight]) => [holdingKey(cards), weight]));
  return (candidate) => weights.get(holdingKey(candidate)) ?? floor;
}

test("preflop raises narrow the range while retaining bluff candidates", () => {
  const smallRaise = {
    actions: [action()],
    positionFactor: 0.86,
    bigBlind: 10,
  };
  const largeRaise = {
    ...smallRaise,
    actions: [action({ amount: 100 })],
  };
  const aces = [c(14, 0), c(14, 1)];
  const aceFiveSuited = [c(14, 0), c(5, 0)];
  const sevenDeuce = [c(7, 0), c(2, 1)];

  assert.ok(opponentHoldingWeight(aces, [], smallRaise) > opponentHoldingWeight(sevenDeuce, [], smallRaise));
  assert.ok(opponentHoldingWeight(aceFiveSuited, [], smallRaise) > 0);
  assert.ok(weightedMeanPreflopPercentile(largeRaise) > weightedMeanPreflopPercentile(smallRaise));
});

test("infers a protected speculative limp range instead of a generic weak call", () => {
  const limp = {
    actions: [action({ kind: "call", amount: 10, toCall: 10, raiseCountBefore: 0 })],
    positionFactor: 1.28,
    position: "BTN",
    bigBlind: 10,
  };
  const deuces = [c(2, "♠"), c(2, "♥")];
  const sevenSixSuited = [c(7, "♠"), c(6, "♠")];
  const aces = [c(14, "♠"), c(14, "♥")];
  const sevenDeuce = [c(7, "♠"), c(2, "♥")];

  assert.ok(opponentHoldingWeight(deuces, [], limp) > opponentHoldingWeight(sevenDeuce, [], limp) * 10);
  assert.ok(opponentHoldingWeight(sevenSixSuited, [], limp) > opponentHoldingWeight(sevenDeuce, [], limp) * 10);
  assert.ok(opponentHoldingWeight(aces, [], limp) > opponentHoldingWeight(sevenDeuce, [], limp) * 5);
  assert.ok(opponentHoldingWeight(deuces, [], limp) > opponentHoldingWeight(aces, [], limp));
});

test("matching historical pressure widens the public raising range without reading cards", () => {
  const baseline = {
    actions: [action({ amount: 25 })],
    positionFactor: 1.28,
    position: "BTN",
    bigBlind: 10,
  };
  const pressured = {
    ...baseline,
    tendency: {
      preflopOpen: 0.7,
      preflopReraise: 0,
      postflopBet: 0,
      postflopRaise: 0,
      publicDeception: 0,
    },
  };
  const aces = [c(14, "♠"), c(14, "♥")];
  const sevenDeuce = [c(7, "♠"), c(2, "♥")];
  const baselineRatio = opponentHoldingWeight(sevenDeuce, [], baseline)
    / opponentHoldingWeight(aces, [], baseline);
  const pressuredRatio = opponentHoldingWeight(sevenDeuce, [], pressured)
    / opponentHoldingWeight(aces, [], pressured);

  assert.ok(pressuredRatio > baselineRatio * 1.15, `${pressuredRatio} 应高于 ${baselineRatio}`);
  assert.ok(opponentHoldingWeight(aces, [], pressured) > opponentHoldingWeight(sevenDeuce, [], pressured));
});

test("preflop range inference follows the same position chart as coaching", () => {
  const deuces = [c(2, "♠"), c(2, "♥")];
  const kingJackOff = [c(13, "♠"), c(11, "♥")];
  const buttonOpen = {
    actions: [action()],
    positionFactor: 1.28,
    position: "BTN",
    bigBlind: 10,
  };
  const underTheGunOpen = {
    ...buttonOpen,
    positionFactor: 0.72,
    position: "UTG",
  };
  assert.ok(
    opponentHoldingWeight(deuces, [], buttonOpen)
      > opponentHoldingWeight(deuces, [], underTheGunOpen) * 1.15,
  );
  const kingQueenOff = [c(13, "♠"), c(12, "♥")];
  assert.ok(
    opponentHoldingWeight(kingQueenOff, [], underTheGunOpen)
      > opponentHoldingWeight(kingJackOff, [], underTheGunOpen) * 2,
  );
  assert.ok(
    opponentHoldingWeight(deuces, [], underTheGunOpen)
      < opponentHoldingWeight(kingQueenOff, [], underTheGunOpen),
  );

  const bigBlindCall = {
    actions: [action({ kind: "call", amount: 15, toCall: 15, potBefore: 40, raiseCountBefore: 1 })],
    positionFactor: 1.35,
    position: "BB",
    openerPosition: "BTN",
    bigBlind: 10,
  };
  assert.ok(
    opponentHoldingWeight(deuces, [], bigBlindCall)
      > opponentHoldingWeight([c(7, "♠"), c(2, "♥")], [], bigBlindCall) * 8,
  );
});

test("range inference reconstructs the real total price after nonstandard prior investments", () => {
  const queens = [c(12, "♠"), c(12, "♥")];
  const openerCall = action({
    kind: "call",
    amount: 70,
    toCall: 70,
    playerBetBefore: 20,
    raiseCountBefore: 2,
    aggressorPositionBefore: "SB",
    responseRoleBefore: "opener",
    startingDepthBefore: 1_000,
  });
  const expectedOpener = getPreflopStrategy({
    hand: "QQ",
    scenario: "vs-three-bet",
    heroPosition: "BTN",
    aggressorPosition: "SB",
    responseRole: "opener",
    effectiveStackBb: 100,
    facingSizeBb: 9,
  }).frequencies.call;
  const actualOpener = opponentHoldingWeight(queens, [], {
    actions: [openerCall],
    positionFactor: 1.28,
    position: "BTN",
    bigBlind: 10,
  });
  assert.ok(Math.abs(actualOpener - Math.min(1.65, 0.004 + expectedOpener * 1.18)) < 1e-9);

  const aceKing = [c(14, "♠"), c(13, "♥")];
  const coldCall = { ...openerCall, amount: 90, toCall: 90, playerBetBefore: 0, responseRoleBefore: "cold-entry" };
  const expectedCold = getPreflopStrategy({
    hand: "AKo",
    scenario: "vs-three-bet",
    heroPosition: "BTN",
    aggressorPosition: "SB",
    responseRole: "cold-entry",
    effectiveStackBb: 100,
    facingSizeBb: 9,
  }).frequencies.call;
  const actualCold = opponentHoldingWeight(aceKing, [], {
    actions: [coldCall],
    positionFactor: 1.28,
    position: "BTN",
    bigBlind: 10,
  });
  assert.ok(Math.abs(actualCold - Math.min(1.65, 0.004 + expectedCold * 1.18)) < 1e-9);
});

test("range inference uses the latest raiser position after a three-bet", () => {
  const open = action({ playerId: 1, kind: "raise", amount: 25, toCall: 10, raiseCountBefore: 0 });
  const threeBet = action({ playerId: 2, kind: "raise", amount: 85, toCall: 20, potBefore: 55, raiseCountBefore: 1 });
  const callThreeBet = action({ playerId: 1, kind: "call", amount: 65, toCall: 65, potBefore: 140, raiseCountBefore: 2 });
  const positions = new Map([[0, "BB"], [1, "CO"], [2, "SB"]]);
  const state = {
    players: [
      { id: 0, folded: false },
      { id: 1, folded: false },
      { id: 2, folded: false },
    ],
    viewerId: 0,
    community: [],
    actions: [open, threeBet, callThreeBet],
    bigBlind: 10,
    positionFactor: () => 1,
    position: (playerId) => positions.get(playerId),
  };
  const inferredButton = createPublicOpponentRanges(state).find((range) => range.playerId === 1);
  const candidate = [c(14, "♠"), c(5, "♠")];
  const expected = opponentHoldingWeight(candidate, [], {
    actions: [open, { ...callThreeBet, aggressorPositionBefore: "SB" }],
    positionFactor: 1,
    position: "CO",
    openerPosition: "CO",
    bigBlind: 10,
  });
  const wrongOpeningRaiser = opponentHoldingWeight(candidate, [], {
    actions: [open, { ...callThreeBet, aggressorPositionBefore: "CO" }],
    positionFactor: 1,
    position: "CO",
    openerPosition: "CO",
    bigBlind: 10,
  });

  assert.equal(inferredButton.weight(candidate), expected);
  assert.notEqual(expected, wrongOpeningRaiser);
});

test("range inference preserves a cold caller's role through a squeeze", () => {
  const open = action({
    playerId: 1,
    kind: "raise",
    amount: 25,
    toCall: 10,
    raiseCountBefore: 0,
  });
  const coldCall = action({
    playerId: 2,
    kind: "call",
    amount: 25,
    toCall: 25,
    potBefore: 40,
    raiseCountBefore: 1,
  });
  const squeeze = action({
    playerId: 3,
    kind: "raise",
    amount: 85,
    toCall: 20,
    potBefore: 65,
    raiseCountBefore: 1,
  });
  const callSqueeze = action({
    playerId: 2,
    kind: "call",
    amount: 65,
    toCall: 65,
    potBefore: 150,
    raiseCountBefore: 2,
  });
  const positions = new Map([[0, "BB"], [1, "HJ"], [2, "BTN"], [3, "SB"]]);
  const state = {
    players: [0, 1, 2, 3].map((id) => ({ id, folded: false })),
    viewerId: 0,
    community: [],
    actions: [open, coldCall, squeeze, callSqueeze],
    bigBlind: 10,
    positionFactor: () => 1,
    position: (playerId) => positions.get(playerId),
  };
  const inferred = createPublicOpponentRanges(state).find((range) => range.playerId === 2);
  const candidate = [c(7, "♠"), c(6, "♠")];
  const enrichedCall = {
    ...callSqueeze,
    aggressorPositionBefore: "SB",
    responseRoleBefore: "cold-caller",
  };
  const expected = opponentHoldingWeight(candidate, [], {
    actions: [
      { ...coldCall, aggressorPositionBefore: "HJ" },
      enrichedCall,
    ],
    positionFactor: 1,
    position: "BTN",
    openerPosition: "HJ",
    bigBlind: 10,
  });
  const mistakenForOpener = opponentHoldingWeight(candidate, [], {
    actions: [
      { ...coldCall, aggressorPositionBefore: "HJ" },
      { ...enrichedCall, responseRoleBefore: "opener" },
    ],
    positionFactor: 1,
    position: "BTN",
    openerPosition: "HJ",
    bigBlind: 10,
  });

  assert.equal(inferred.weight(candidate), expected);
  assert.ok(expected < mistakenForOpener * 0.75, `${expected}/${mistakenForOpener}`);
});

test("range inference uses recorded hand-start effective depth", () => {
  const fives = [c(5, "♠"), c(5, "♥")];
  const facingThreeBet = action({
    kind: "call",
    amount: 65,
    toCall: 65,
    potBefore: 140,
    raiseCountBefore: 2,
    stackBefore: 1_975,
    aggressorPositionBefore: "SB",
  });
  const evidence = {
    positionFactor: 1,
    position: "BTN",
    openerPosition: "SB",
    bigBlind: 10,
  };
  const shallow = opponentHoldingWeight(fives, [], {
    ...evidence,
    actions: [{ ...facingThreeBet, startingDepthBefore: 400 }],
  });
  const deep = opponentHoldingWeight(fives, [], {
    ...evidence,
    actions: [{ ...facingThreeBet, startingDepthBefore: 2_000 }],
  });

  assert.ok(deep > shallow, `${deep} should exceed ${shallow}`);
});

test("postflop betting is polarized between value and live bluffs", () => {
  const board = [c(13, "♠"), c(7, "♠"), c(2, "♦")];
  const evidence = {
    actions: [action({ street: "flop", amount: 75, toCall: 0, potBefore: 100 })],
    positionFactor: 1,
    bigBlind: 10,
  };
  const value = opponentHoldingWeight([c(13, "♣"), c(13, "♦")], board, evidence);
  const flushDraw = opponentHoldingWeight([c(14, "♠"), c(12, "♠")], board, evidence);
  const air = opponentHoldingWeight([c(9, "♣"), c(3, "♥")], board, evidence);

  assert.ok(value > flushDraw);
  assert.ok(flushDraw > air);
  assert.ok(air > 0, "pure bluffs must retain non-zero posterior mass");
});

test("public aggression and deception evidence increase air density in the matching postflop range", () => {
  const board = [c(14, "♠"), c(9, "♥"), c(6, "♦"), c(3, "♣"), c(2, "♠")];
  const baseline = {
    actions: [action({ street: "river", amount: 100, toCall: 0, potBefore: 100, activeOpponents: 1 })],
    positionFactor: 1,
    bigBlind: 10,
  };
  const pressured = {
    ...baseline,
    tendency: {
      preflopOpen: 0,
      preflopReraise: 0,
      postflopBet: 0.8,
      postflopRaise: 0,
      publicDeception: 0.7,
    },
  };
  const value = [c(14, "♦"), c(13, "♦")];
  const blockerAir = [c(13, "♠"), c(7, "♠")];
  const baselineRatio = opponentHoldingWeight(blockerAir, board, baseline)
    / opponentHoldingWeight(value, board, baseline);
  const pressuredRatio = opponentHoldingWeight(blockerAir, board, pressured)
    / opponentHoldingWeight(value, board, pressured);

  assert.ok(pressuredRatio > baselineRatio * 3, `${pressuredRatio} 应显著高于 ${baselineRatio}`);
  assert.ok(opponentHoldingWeight(value, board, pressured) > opponentHoldingWeight(blockerAir, board, pressured));
});

test("calling a larger wager concentrates the continuing range", () => {
  const board = [c(13, "♠"), c(7, "♠"), c(2, "♦")];
  const smallCall = {
    actions: [action({ street: "flop", kind: "call", amount: 33, toCall: 33, potBefore: 100, activeOpponents: 1 })],
    positionFactor: 1,
    bigBlind: 10,
  };
  const largeCall = {
    ...smallCall,
    actions: [action({ street: "flop", kind: "call", amount: 125, toCall: 125, potBefore: 100, activeOpponents: 1 })],
  };
  const set = [c(13, "♣"), c(13, "♦")];
  const secondPair = [c(7, "♣"), c(6, "♥")];
  const smallRatio = opponentHoldingWeight(set, board, smallCall) / opponentHoldingWeight(secondPair, board, smallCall);
  const largeRatio = opponentHoldingWeight(set, board, largeCall) / opponentHoldingWeight(secondPair, board, largeCall);
  assert.ok(largeRatio > smallRatio);
});

test("weighted equity uses every opponent range and rejects card collisions", () => {
  const hero = [c(14, "♥"), c(12, "♥")];
  const board = [c(14, "♣"), c(13, "♣"), c(7, "♠"), c(4, "♦"), c(2, "♠")];
  const aceJack = [c(14, "♦"), c(11, "♦")];
  const sevens = [c(7, "♣"), c(7, "♦")];

  assert.equal(estimateEquity(hero, board, {
    opponents: 1,
    iterations: 4,
    random: seeded(1),
    opponentRanges: [onlyHolding(aceJack)],
  }), 1);
  assert.equal(estimateEquity(hero, board, {
    opponents: 2,
    iterations: 4,
    random: seeded(1),
    opponentRanges: [onlyHolding(aceJack), onlyHolding(sevens)],
  }), 0);
  assert.throws(() => estimateEquity(hero, board, {
    opponents: 2,
    iterations: 1,
    random: seeded(1),
    opponentRanges: [onlyHolding(aceJack), onlyHolding([c(14, "♦"), c(10, "♦")])],
  }), /正权重手牌/);
});

test("multiway range equity is deterministic with an injected RNG", () => {
  const hero = [c(11, 0), c(10, 0)];
  const board = [c(9, 1), c(7, 2), c(2, 3)];
  const ranges = [
    (hole) => 0.05 + preflopPercentile(hole) ** 3,
    (hole) => 0.05 + (hole[0].suit === hole[1].suit ? 0.8 : 0.15),
  ];
  const first = estimateEquity(hero, board, {
    opponents: 2,
    iterations: 180,
    random: seeded(90210),
    opponentRanges: ranges,
  });
  const replay = estimateEquity(hero, board, {
    opponents: 2,
    iterations: 180,
    random: seeded(90210),
    opponentRanges: ranges,
  });
  assert.equal(first, replay);
  assert.ok(first >= 0 && first <= 1);
});

test("multiway weighted sampling uses a product joint range without seat-order bias", () => {
  const hero = [c(14, "s"), c(14, "h")];
  const board = [c(2, "c"), c(3, "d"), c(7, "d"), c(9, "c"), c(11, "c")];
  const firstRange = weightedRange([
    [[c(11, "d"), c(11, "h")], 100],
    [[c(12, "d"), c(13, "d")], 1],
  ]);
  const secondRange = weightedRange([
    [[c(11, "d"), c(4, "h")], 100],
    [[c(4, "s"), c(5, "s")], 1],
  ]);
  const options = {
    opponents: 2,
    iterations: 10_000,
    random: seeded(1),
    suits: ["s", "h", "d", "c"],
    opponentRanges: [firstRange, secondRange],
  };
  const forward = estimateEquity(hero, board, options);
  const reversed = estimateEquity(hero, board, {
    ...options,
    random: seeded(1),
    opponentRanges: [secondRange, firstRange],
  });
  const exactHeroEquity = 101 / 201;

  assert.ok(Math.abs(forward - exactHeroEquity) < 0.025, `${forward} should be near ${exactHeroEquity}`);
  assert.ok(Math.abs(reversed - exactHeroEquity) < 0.025, `${reversed} should be near ${exactHeroEquity}`);
  assert.ok(Math.abs(forward - reversed) < 0.025, `${forward} and ${reversed} should agree`);
});

test("importance-corrected broad ranges recover collision modes across seat orders", () => {
  const hero = [c(14, "s"), c(14, "h")];
  const board = [c(2, "c"), c(3, "d"), c(7, "d"), c(9, "c"), c(11, "c")];
  const firstRange = weightedRange([
    [[c(11, "d"), c(11, "h")], 100],
    [[c(12, "d"), c(13, "d")], 1],
  ], 1e-10);
  const secondRange = weightedRange([
    [[c(11, "d"), c(4, "h")], 100],
    [[c(4, "s"), c(5, "s")], 1],
  ], 1e-10);
  const estimates = Array.from({ length: 12 }, (_, index) => estimateEquity(hero, board, {
    opponents: 2,
    iterations: 110,
    random: seeded(index + 1),
    suits: ["s", "h", "d", "c"],
    opponentRanges: [firstRange, secondRange],
  }));
  const mean = estimates.reduce((total, value) => total + value, 0) / estimates.length;

  assert.ok(Math.abs(mean - 101 / 201) < 0.04, `${mean} should recover both collision modes`);
});

test("a feasible sparse joint range never fails because an early draw blocks a later seat", () => {
  const hero = [c(14, "s"), c(14, "h")];
  const board = [c(2, "c"), c(3, "d"), c(7, "d"), c(9, "c"), c(11, "c")];
  const sometimesBlocking = weightedRange([
    [[c(11, "d"), c(11, "h")], 1_000_000],
    [[c(12, "d"), c(13, "d")], 1],
  ]);
  const laterSeat = onlyHolding([c(11, "d"), c(4, "h")]);

  assert.equal(estimateEquity(hero, board, {
    opponents: 2,
    iterations: 20,
    random: () => 0,
    suits: ["s", "h", "d", "c"],
    opponentRanges: [sometimesBlocking, laterSeat],
  }), 1);
});

test("weighted equity splits ties between hero and every tied opponent", () => {
  const hero = [c(2, "h"), c(3, "d")];
  const board = [c(10, "s"), c(11, "s"), c(12, "s"), c(13, "s"), c(14, "s")];
  const opponent = [c(4, "h"), c(5, "d")];

  assert.equal(estimateEquity(hero, board, {
    opponents: 1,
    iterations: 3,
    random: seeded(5),
    suits: ["s", "h", "d", "c"],
    opponentRanges: [onlyHolding(opponent)],
  }), 0.5);
});

test("broad, strongly overlapping multiway ranges do not fail on card collisions", () => {
  const hero = [c(14, "s"), c(14, "h")];
  const board = [c(2, "c"), c(3, "d"), c(7, "d"), c(9, "c"), c(11, "c")];
  const favorite = holdingKey([c(13, "h"), c(13, "d")]);
  const concentrated = (candidate) => holdingKey(candidate) === favorite ? 1 : 1e-8;
  const equity = estimateEquity(hero, board, {
    opponents: 5,
    iterations: 4,
    random: seeded(77),
    suits: ["s", "h", "d", "c"],
    opponentRanges: Array.from({ length: 5 }, () => concentrated),
  });

  assert.ok(Number.isFinite(equity));
  assert.ok(equity >= 0 && equity <= 1);
});

test("public range inference never reads real opponent hole cards", () => {
  const guardedOpponent = { id: 1, folded: false };
  Object.defineProperty(guardedOpponent, "hole", {
    get() { throw new Error("hidden cards were read"); },
  });
  const publicState = {
    players: [{ id: 0, folded: false }, guardedOpponent],
    viewerId: 0,
    community: [c(13, "♠"), c(7, "♠"), c(2, "♦")],
    actions: [action({ street: "flop", amount: 66, toCall: 0, potBefore: 100 })],
    bigBlind: 10,
    positionFactor: () => 1,
  };
  const inferred = createPublicOpponentRanges(publicState);
  assert.equal(inferred.length, 1);
  assert.ok(inferred[0].weight([c(14, "♠"), c(12, "♠")]) > 0);

  const withSecretAces = { ...guardedOpponent, hole: [c(14, 0), c(14, 1)] };
  const withSecretTrash = { ...guardedOpponent, hole: [c(7, 0), c(2, 1)] };
  const first = createPublicOpponentRanges({ ...publicState, players: [publicState.players[0], withSecretAces] });
  const second = createPublicOpponentRanges({ ...publicState, players: [publicState.players[0], withSecretTrash] });
  const candidate = [c(13, "♣"), c(13, "♦")];
  assert.equal(first[0].weight(candidate), second[0].weight(candidate));
});
