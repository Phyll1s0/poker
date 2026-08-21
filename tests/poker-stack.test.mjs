import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveNextCashGameBankrolls,
  resolvePokerDecisionStacks,
} from "../lib/poker-stack.ts";

test("carries funded stacks and records only sub-big-blind rebuys", () => {
  const next = resolveNextCashGameBankrolls({
    stacks: [1_325, 675, 9],
    cashInvested: [1_000, 1_000, 1_000],
    buyInStack: 1_000,
    bigBlind: 10,
  });

  assert.deepEqual(next.stacks, [1_325, 675, 1_000]);
  assert.deepEqual(next.cashInvested, [1_000, 1_000, 1_991]);
  assert.deepEqual(next.reboughtIds, [2]);
  assert.equal(
    next.stacks.reduce((sum, amount) => sum + amount, 0) - (1_325 + 675 + 9),
    next.cashInvested.reduce((sum, amount) => sum + amount, 0) - 3_000,
  );
});

test("does not rebuy exactly one big blind but fully funds a busted seat", () => {
  const next = resolveNextCashGameBankrolls({
    stacks: [10, 0],
    cashInvested: [1_000, 1_000],
    buyInStack: 1_000,
    bigBlind: 10,
  });

  assert.deepEqual(next.stacks, [10, 1_000]);
  assert.deepEqual(next.cashInvested, [1_000, 2_000]);
  assert.deepEqual(next.reboughtIds, [1]);
});

test("uses the short aggressor for the node and the deep third player for sizing", () => {
  const players = [
    { id: 0, stack: 900, bet: 100, contributed: 100, folded: false },
    { id: 1, stack: 0, bet: 120, contributed: 120, folded: false },
    { id: 2, stack: 500, bet: 0, contributed: 0, folded: false },
  ];
  const stacks = resolvePokerDecisionStacks({
    player: players[0],
    players,
    highestBet: 120,
    lastAggressorId: 1,
  });

  assert.equal(stacks.opponent?.id, 1);
  assert.equal(stacks.decision.effectiveStack, 20);
  assert.equal(stacks.startingDepth, 120);
  assert.equal(stacks.maxContestableTarget, 500);

  const headsUp = resolvePokerDecisionStacks({
    player: players[0],
    players: [players[0], players[1], { ...players[2], folded: true }],
    highestBet: 120,
    lastAggressorId: 1,
  });
  assert.equal(headsUp.maxContestableTarget, 120);
});

test("uses the deepest contestable opponent in an unraised limp pot regardless of seat order", () => {
  const hero = { id: 0, stack: 500, bet: 0, contributed: 0, folded: false };
  const shortLimper = { id: 1, stack: 90, bet: 10, contributed: 10, folded: false };
  const deepBigBlind = { id: 2, stack: 990, bet: 10, contributed: 10, folded: false };
  const resolve = (opponents) => resolvePokerDecisionStacks({
    player: hero,
    players: [hero, ...opponents],
    highestBet: 10,
    lastAggressorId: null,
  });

  const first = resolve([shortLimper, deepBigBlind]);
  const reordered = resolve([deepBigBlind, shortLimper]);

  assert.equal(first.opponent?.id, 2);
  assert.equal(reordered.opponent?.id, 2);
  assert.equal(first.decision.effectiveStack, 500);
  assert.equal(first.startingDepth, 500);
  assert.deepEqual(first, reordered);
});
