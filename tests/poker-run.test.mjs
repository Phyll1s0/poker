import assert from "node:assert/strict";
import test from "node:test";

import {
  createPokerRunDecisionStats,
  pokerRunBbPer100,
  pokerRunCanStartNextHand,
  recordPokerRunDecision,
  upsertPokerRunHand,
} from "../lib/poker-run.ts";

test("keeps lifetime decision aggregates after detailed history is capped", () => {
  let stats = createPokerRunDecisionStats();
  stats = recordPokerRunDecision(stats, "preflop", 80);
  stats = recordPokerRunDecision(stats, "preflop", 100);
  stats = recordPokerRunDecision(stats, "river", 50);

  assert.equal(stats.count, 3);
  assert.equal(stats.scoreTotal, 230);
  assert.deepEqual(stats.byStreet.preflop, { scoreTotal: 180, count: 2 });
  assert.deepEqual(stats.byStreet.river, { scoreTotal: 50, count: 1 });
});

test("calculates cumulative BB per 100 and handles an empty run", () => {
  assert.equal(pokerRunBbPer100(250, 10, 50), 50);
  assert.equal(pokerRunBbPer100(-90, 10, 30), -30);
  assert.equal(pokerRunBbPer100(100, 10, 0), 0);
});

test("does not apply the fixed-session cap to endless play", () => {
  assert.equal(pokerRunCanStartNextHand("session", false, true), false);
  assert.equal(pokerRunCanStartNextHand("endless", false, true), true);
  assert.equal(pokerRunCanStartNextHand("endless", true, false), false);
});

test("deduplicates a settled hand and retains only recent detail", () => {
  let hands = [];
  for (let hand = 1; hand <= 5; hand += 1) hands = upsertPokerRunHand(hands, { hand, net: hand }, 3);
  assert.deepEqual(hands.map((item) => item.hand), [3, 4, 5]);

  hands = upsertPokerRunHand(hands, { hand: 5, net: 99 }, 3);
  assert.equal(hands.length, 3);
  assert.deepEqual(hands.at(-1), { hand: 5, net: 99 });
});
