import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeBoardTexture,
  bestHand,
  bestHandWithCards,
  blockerValue,
  drawPotential,
  estimateEquity,
  makeDeck,
  orderFiveCardHandForDisplay,
  preflopHandFeatures,
  preflopPercentile,
  preflopStrength,
  score,
  scoreFive,
} from "../lib/poker-evaluator.ts";

const c = (rank, suit) => ({ rank, suit });

test("a missed backdoor straight draw expires on the turn", () => {
  const hole = [c(8, "h"), c(10, "d")];
  const flop = [c(6, "s"), c(2, "c"), c(13, "d")];
  assert.ok(drawPotential(hole, flop) > 0);
  assert.equal(drawPotential(hole, [...flop, c(3, "h")]), 0);
  assert.ok(drawPotential(hole, [...flop, c(7, "h")]) > 0);
});

test("side-pot equity pays each eligible layer while retaining every opponent's blockers", () => {
  const hero = [c(13, "s"), c(13, "h")];
  const short = [c(14, "s"), c(14, "h")];
  const deep = [c(12, "s"), c(12, "h")];
  const board = [c(2, "s"), c(3, "h"), c(7, "d"), c(8, "c"), c(9, "s")];
  const exact = (cards) => (candidate) => candidate.every((card) => cards.some((other) => other.rank === card.rank && other.suit === card.suit)) ? 1 : 0;
  const common = { opponents: 2, iterations: 16, random: seeded(17), opponentRanges: [exact(short), exact(deep)] };
  assert.equal(estimateEquity(hero, board, common), 0);
  const layered = estimateEquity(hero, board, {
    ...common,
    potLayers: [{ amount: 300, opponentIndices: [0, 1] }, { amount: 800, opponentIndices: [1] }],
  });
  assert.ok(Math.abs(layered - 800 / 1100) < 1e-12);
  // A hand that conflicts with the short stack is impossible in the deep
  // player's range, even when evaluating only the deep side pot.
  const conflictingAces = exact([c(14, "s"), c(14, "d")]);
  const blockerAware = estimateEquity(hero, board, {
    ...common,
    opponentRanges: [exact(short), (candidate) => conflictingAces(candidate) * 100 + exact(deep)(candidate)],
    potLayers: [{ amount: 1, opponentIndices: [1] }],
  });
  assert.equal(blockerAware, 1);
  const blockedRunout = estimateEquity(hero, [c(2, "s"), c(3, "h"), c(7, "d"), c(8, "c")], {
    ...common, iterations: 4000, random: seeded(38),
    potLayers: [{ amount: 1, opponentIndices: [1] }],
  });
  assert.ok(Math.abs(blockedRunout - 40 / 42) < 0.013, `${blockedRunout}: only the two remaining queens beat KK`);
});

test("heads-up river equity is exact for a supplied range, independent of sample count and RNG", () => {
  const hero = [c(13, "s"), c(13, "h")];
  const board = [c(2, "s"), c(3, "h"), c(7, "d"), c(8, "c"), c(9, "s")];
  const range = (cards) => cards.every((card) => card.rank === 14) ? 3 : cards.every((card) => card.rank === 12) ? 1 : 0;
  for (const iterations of [1, 17, 400]) {
    for (const random of [() => 0, () => 0.9999, seeded(18)]) {
      assert.ok(Math.abs(estimateEquity(hero, board, { opponents: 1, iterations, random, opponentRanges: [range] }) - 0.25) < 1e-12);
    }
  }
});

test("rejects malformed side-pot eligibility instead of returning false equity", () => {
  const hero = [c(13, "s"), c(13, "h")];
  for (const potLayers of [[], [{ amount: 0, opponentIndices: [0] }], [{ amount: 10, opponentIndices: [1] }], [{ amount: 10, opponentIndices: [0, 0] }]]) {
    assert.throws(() => estimateEquity(hero, [], { opponents: 1, potLayers }), /potLayers/);
  }
});

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test("scores all hand classes in strict poker order", () => {
  const hands = [
    [c(14, "♠"), c(11, "♥"), c(9, "♦"), c(6, "♣"), c(3, "♠")],
    [c(14, "♠"), c(14, "♥"), c(9, "♦"), c(6, "♣"), c(3, "♠")],
    [c(14, "♠"), c(14, "♥"), c(9, "♦"), c(9, "♣"), c(3, "♠")],
    [c(14, "♠"), c(14, "♥"), c(14, "♦"), c(6, "♣"), c(3, "♠")],
    [c(9, "♠"), c(8, "♥"), c(7, "♦"), c(6, "♣"), c(5, "♠")],
    [c(14, "♠"), c(11, "♠"), c(9, "♠"), c(6, "♠"), c(3, "♠")],
    [c(14, "♠"), c(14, "♥"), c(14, "♦"), c(9, "♣"), c(9, "♠")],
    [c(14, "♠"), c(14, "♥"), c(14, "♦"), c(14, "♣"), c(9, "♠")],
    [c(9, "♠"), c(8, "♠"), c(7, "♠"), c(6, "♠"), c(5, "♠")],
  ].map(scoreFive);

  assert.deepEqual(hands.map(({ category }) => category), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  for (let index = 1; index < hands.length; index += 1) {
    assert.ok(hands[index].score > hands[index - 1].score);
  }
});

test("handles the wheel and selects the best five cards from seven", () => {
  const wheel = scoreFive([c(14, 0), c(5, 1), c(4, 2), c(3, 3), c(2, 0)]);
  const sixHigh = scoreFive([c(6, 0), c(5, 1), c(4, 2), c(3, 3), c(2, 0)]);
  assert.equal(wheel.name, "顺子");
  assert.ok(sixHigh.score > wheel.score);

  const seven = [c(14, 0), c(14, 1), c(14, 2), c(13, 0), c(13, 1), c(2, 2), c(3, 3)];
  assert.deepEqual(bestHand(seven), score(seven));
  assert.equal(bestHand(seven).name, "葫芦");
});

test("returns the exact five source cards used by the best hand", () => {
  const seven = [c(14, "♠"), c(14, "♥"), c(14, "♦"), c(13, "♠"), c(13, "♥"), c(3, "♣"), c(2, "♦")];
  const result = bestHandWithCards(seven);

  assert.equal(result.name, "葫芦");
  assert.equal(result.cards.length, 5);
  assert.deepEqual(result.cards, seven.slice(0, 5));
  assert.equal(result.score, bestHand(seven).score);
});

test("keeps community cards when an equal best hand plays the board", () => {
  const board = [c(14, "♠"), c(13, "♥"), c(12, "♦"), c(11, "♣"), c(10, "♠")];
  const hole = [c(10, "♥"), c(2, "♦")];
  const result = bestHandWithCards([...board, ...hole]);

  assert.equal(result.name, "顺子");
  assert.deepEqual(result.cards, board);
});

test("bestHandWithCards preserves wheel cards and validates its input", () => {
  const wheelCards = [c(14, 0), c(5, 1), c(4, 2), c(3, 3), c(2, 0), c(13, 1), c(12, 2)];
  const result = bestHandWithCards(wheelCards);

  assert.equal(result.name, "顺子");
  assert.deepEqual(result.cards, wheelCards.slice(0, 5));
  assert.throws(() => bestHandWithCards(wheelCards.slice(0, 4)), /5 到 7 张牌/);
  assert.throws(
    () => bestHandWithCards([c(14, 0), c(14, 0), c(4, 1), c(3, 2), c(2, 3)]),
    /重复牌/,
  );
});

test("orders winning five cards by poker meaning without changing their identity", () => {
  const cases = [
    {
      cards: [c(3, "♣"), c(14, "♠"), c(6, "♥"), c(11, "♦"), c(9, "♣")],
      ranks: [14, 11, 9, 6, 3],
    },
    {
      cards: [c(9, "♦"), c(14, "♠"), c(9, "♣"), c(3, "♥"), c(11, "♦")],
      ranks: [9, 9, 14, 11, 3],
    },
    {
      cards: [c(4, "♠"), c(13, "♦"), c(14, "♣"), c(4, "♥"), c(13, "♣")],
      ranks: [13, 13, 4, 4, 14],
    },
    {
      cards: [c(14, "♠"), c(12, "♥"), c(12, "♦"), c(13, "♣"), c(12, "♠")],
      ranks: [12, 12, 12, 14, 13],
    },
    {
      cards: [c(14, "♣"), c(6, "♦"), c(6, "♠"), c(14, "♥"), c(6, "♥")],
      ranks: [6, 6, 6, 14, 14],
    },
    {
      cards: [c(9, "♥"), c(9, "♣"), c(14, "♦"), c(9, "♠"), c(9, "♦")],
      ranks: [9, 9, 9, 9, 14],
    },
    {
      cards: [c(8, "♠"), c(10, "♥"), c(6, "♣"), c(9, "♦"), c(7, "♠")],
      ranks: [10, 9, 8, 7, 6],
    },
    {
      cards: [c(14, "♠"), c(3, "♥"), c(5, "♦"), c(2, "♣"), c(4, "♠")],
      ranks: [5, 4, 3, 2, 14],
    },
    {
      cards: [c(3, "♥"), c(14, "♥"), c(8, "♥"), c(11, "♥"), c(5, "♥")],
      ranks: [14, 11, 8, 5, 3],
    },
    {
      cards: [c(7, "♠"), c(10, "♠"), c(8, "♠"), c(6, "♠"), c(9, "♠")],
      ranks: [10, 9, 8, 7, 6],
    },
    {
      cards: [c(14, "♦"), c(3, "♦"), c(5, "♦"), c(2, "♦"), c(4, "♦")],
      ranks: [5, 4, 3, 2, 14],
    },
  ];

  for (const { cards, ranks } of cases) {
    const before = [...cards];
    const ordered = orderFiveCardHandForDisplay(cards);
    assert.deepEqual(ordered.map(({ rank }) => rank), ranks);
    assert.deepEqual(cards, before, "不得修改输入数组");
    assert.equal(scoreFive(ordered).score, scoreFive(cards).score);
    for (const card of ordered) assert.ok(cards.includes(card), "必须返回原始牌对象");
  }

  const pairCards = cases[1].cards;
  const stablePair = orderFiveCardHandForDisplay(pairCards);
  assert.equal(stablePair[0], pairCards[0], "同点数牌应保持原输入顺序");
  assert.equal(stablePair[1], pairCards[2], "同点数牌不按花色重新排序");

  const multiplayerCards = [
    { rank: "A", suit: "♣" },
    { rank: "6", suit: "♦" },
    { rank: "6", suit: "♠" },
    { rank: "A", suit: "♥" },
    { rank: "6", suit: "♥" },
  ];
  const orderedMultiplayerCards = orderFiveCardHandForDisplay(multiplayerCards);
  assert.deepEqual(orderedMultiplayerCards.map(({ rank }) => rank), ["6", "6", "6", "A", "A"]);
  assert.equal(orderedMultiplayerCards[0], multiplayerCards[1], "多人字符串牌也必须保留原对象");

  const multiplayerStraight = ["10", "A", "Q", "J", "K"]
    .map((rank, index) => ({ rank, suit: ["♠", "♥", "♦", "♣", "♠"][index] }));
  assert.deepEqual(
    orderFiveCardHandForDisplay(multiplayerStraight).map(({ rank }) => rank),
    ["A", "K", "Q", "J", "10"],
  );

  assert.throws(() => orderFiveCardHandForDisplay(cases[0].cards.slice(0, 4)), /正好 5 张牌/);
});

test("preflop strength and percentile preserve useful ordering", () => {
  const aces = [c(14, 0), c(14, 1)];
  const aceKingSuited = [c(14, 0), c(13, 0)];
  const aceKingOffsuit = [c(14, 0), c(13, 1)];
  const sevenDeuce = [c(7, 0), c(2, 1)];

  assert.ok(preflopStrength(aces) > preflopStrength(aceKingSuited));
  assert.ok(preflopStrength(aceKingSuited) > preflopStrength(aceKingOffsuit));
  assert.equal(preflopPercentile(aces), 1);
  assert.ok(preflopPercentile(aceKingSuited) > preflopPercentile(aceKingOffsuit));
  assert.ok(preflopPercentile(sevenDeuce) < 0.2);
  assert.deepEqual(preflopHandFeatures(aceKingSuited), {
    highRank: 14,
    lowRank: 13,
    pair: false,
    suited: true,
    gap: 1,
  });
});

test("reports player-contributed draws and board-relevant blockers", () => {
  assert.equal(
    drawPotential([c(8, "c"), c(9, "d")], [c(10, "h"), c(11, "c"), c(2, "s")]),
    0.09,
  );
  assert.ok(Math.abs(
    drawPotential([c(14, "s"), c(12, "s")], [c(2, "s"), c(7, "s"), c(13, "d")]) - 0.145,
  ) < 1e-12);
  assert.equal(
    blockerValue([c(14, "s"), c(13, "d")], [c(2, "s"), c(7, "s"), c(11, "s")]),
    0.1,
  );
});

test("does not assign board-only flush or straight draws to the player", () => {
  assert.equal(
    drawPotential([c(2, "h"), c(7, "d")], [c(2, "s"), c(7, "s"), c(11, "s"), c(14, "s")]),
    0,
  );
  assert.equal(
    drawPotential([c(5, "h"), c(13, "d")], [c(5, "s"), c(6, "h"), c(7, "d"), c(8, "c")]),
    0,
  );
});

test("orders contributed combo draws, open-enders, gutshots and backdoors", () => {
  const combo = drawPotential([c(8, "s"), c(9, "s")], [c(6, "s"), c(7, "s"), c(2, "d")]);
  const openEnded = drawPotential([c(8, "h"), c(9, "d")], [c(6, "s"), c(7, "c"), c(2, "d")]);
  const gutshot = drawPotential([c(8, "h"), c(10, "d")], [c(6, "s"), c(7, "c"), c(2, "d")]);
  const backdoor = drawPotential([c(8, "h"), c(10, "d")], [c(6, "s"), c(2, "c"), c(13, "d")]);

  assert.equal(combo, 0.2);
  assert.equal(openEnded, 0.09);
  assert.equal(gutshot, 0.05);
  assert.equal(backdoor, 0.035);
  assert.ok(combo > openEnded && openEnded > gutshot && gutshot > backdoor);
});

test("keeps preflop high-card blockers but ignores unrelated postflop overcards", () => {
  assert.equal(blockerValue([c(14, "s"), c(13, "d")], []), 0.05);
  assert.equal(blockerValue([c(14, "s"), c(13, "d")], [c(2, "c"), c(7, "h"), c(10, "d")]), 0);
  assert.equal(blockerValue([c(13, "s"), c(2, "d")], [c(14, "s"), c(7, "s"), c(11, "s")]), 0.1);
  assert.equal(blockerValue([c(9, "h"), c(2, "d")], [c(5, "s"), c(6, "h"), c(7, "d"), c(8, "c")]), 0.04);
  assert.equal(blockerValue([c(12, "h"), c(3, "d")], [c(12, "s"), c(12, "c"), c(5, "d")]), 0.03);
});

test("describes board texture continuously instead of fixed named buckets", () => {
  const dry = analyzeBoardTexture([c(14, "s"), c(7, "h"), c(2, "d")]);
  const dynamic = analyzeBoardTexture([c(11, "s"), c(10, "s"), c(9, "h")]);
  const paired = analyzeBoardTexture([c(8, "s"), c(8, "h"), c(3, "d")]);
  const monotone = analyzeBoardTexture([c(12, "s"), c(7, "s"), c(2, "s")]);

  assert.ok(dynamic.wetness > dry.wetness);
  assert.ok(paired.pairedness > dry.pairedness);
  assert.equal(monotone.flushPressure, 1);
  assert.equal(dry.highCard, 1);
});

test("equity is deterministic with injected RNG and splits a locked board", () => {
  const lockedBoard = [c(10, "♠"), c(11, "♠"), c(12, "♠"), c(13, "♠"), c(14, "♠")];
  const split = estimateEquity([c(2, "♥"), c(3, "♦")], lockedBoard, {
    opponents: 2,
    iterations: 20,
    random: seeded(7),
  });
  assert.ok(Math.abs(split - 1 / 3) < 1e-12);

  const spot = {
    opponents: 3,
    iterations: 120,
  };
  const first = estimateEquity([c(14, 0), c(13, 0)], [c(12, 0), c(7, 1), c(2, 2)], {
    ...spot,
    random: seeded(90210),
  });
  const replay = estimateEquity([c(14, 0), c(13, 0)], [c(12, 0), c(7, 1), c(2, 2)], {
    ...spot,
    random: seeded(90210),
  });
  assert.equal(first, replay);
  assert.ok(first >= 0 && first <= 1);
});

test("equity never samples known cards and supports both suit formats", () => {
  const symbolNuts = estimateEquity(
    [c(10, "♠"), c(3, "♣")],
    [c(14, "♠"), c(13, "♠"), c(12, "♠"), c(11, "♠"), c(2, "♦")],
    5,
    25,
    seeded(11),
  );
  const numericNuts = estimateEquity(
    [c(10, 0), c(3, 3)],
    [c(14, 0), c(13, 0), c(12, 0), c(11, 0), c(2, 2)],
    5,
    25,
    seeded(11),
  );
  assert.equal(symbolNuts, 1);
  assert.equal(numericNuts, 1);
  assert.equal(makeDeck().length, 52);
  assert.equal(makeDeck([0, 1, 2, 3]).length, 52);
});

test("rejects duplicate cards and invalid equity requests", () => {
  assert.throws(() => scoreFive([c(14, 0), c(14, 0), c(4, 1), c(3, 2), c(2, 3)]), /重复牌/);
  assert.throws(
    () => estimateEquity([c(14, 0), c(13, 0)], [], { opponents: 30, iterations: 1, random: seeded(1) }),
    /剩余牌不足/,
  );
  assert.throws(() => makeDeck([0, 1, 1, 3]), /互不相同/);
});
