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
  preflopHandFeatures,
  preflopPercentile,
  preflopStrength,
  score,
  scoreFive,
} from "../lib/poker-evaluator.ts";

const c = (rank, suit) => ({ rank, suit });

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
