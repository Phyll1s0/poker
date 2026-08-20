import assert from "node:assert/strict";
import test from "node:test";
import { settlePokerShowdown } from "../lib/poker-settlement.ts";

function sum(entries) {
  return entries.reduce((total, entry) => total + entry.amount, 0);
}

function assertConserved(result) {
  assert.equal(sum(result.payouts), result.totalPot);
  assert.equal(result.totalPot + sum(result.returns), result.totalCommitted);
}

test("settles a three-way main pot and a heads-up side pot independently", () => {
  const result = settlePokerShowdown({
    dealerId: 2,
    players: [
      { id: 0, contributed: 100, folded: false, score: 300 },
      { id: 1, contributed: 200, folded: false, score: 200 },
      { id: 2, contributed: 200, folded: false, score: 100 },
    ],
  });

  assert.deepEqual(result.payouts, [
    { playerId: 0, amount: 300 },
    { playerId: 1, amount: 200 },
  ]);
  assert.deepEqual(result.returns, []);
  assert.deepEqual(result.mainPotWinnerIds, [0]);
  assert.deepEqual(result.winnerIds, [0, 1]);
  assert.deepEqual(result.layers.map((layer) => [layer.kind, layer.amount]), [
    ["pot", 300],
    ["pot", 200],
  ]);
  assertConserved(result);
});

test("keeps folded contributions as dead money and excludes folded hands from side pots", () => {
  const result = settlePokerShowdown({
    dealerId: "C",
    players: [
      { id: "A", contributed: 100, folded: false, score: 20 },
      { id: "B", contributed: 200, folded: false, score: 10 },
      { id: "C", contributed: 200, folded: true },
    ],
  });

  assert.deepEqual(result.payouts, [
    { playerId: "A", amount: 300 },
    { playerId: "B", amount: 200 },
  ]);
  assert.deepEqual(result.layers[1].eligibleIds, ["B"]);
  assertConserved(result);
});

test("returns an unmatched overbet and never calls its recipient a winner", () => {
  const result = settlePokerShowdown({
    dealerId: 0,
    players: [
      { id: 0, contributed: 1_000, folded: false, score: 10 },
      { id: 1, contributed: 10, folded: false, score: 20 },
    ],
  });

  assert.equal(result.totalCommitted, 1_010);
  assert.equal(result.totalPot, 20);
  assert.deepEqual(result.payouts, [{ playerId: 1, amount: 20 }]);
  assert.deepEqual(result.returns, [{ playerId: 0, amount: 990 }]);
  assert.deepEqual(result.winnerIds, [1]);
  assert.deepEqual(result.mainPotWinnerIds, [1]);
  assert.deepEqual(result.layers.at(-1), {
    cap: 1_000,
    amount: 990,
    kind: "return",
    contributorIds: [0],
    eligibleIds: [],
    winnerIds: [],
    returnPlayerId: 0,
  });
  assertConserved(result);
});

test("separates an uncontested winner's matched pot from the uncalled return", () => {
  const result = settlePokerShowdown({
    dealerId: 1,
    players: [
      { id: 0, contributed: 100, folded: false, score: 0 },
      { id: 1, contributed: 10, folded: true },
    ],
  });

  assert.deepEqual(result.payouts, [{ playerId: 0, amount: 20 }]);
  assert.deepEqual(result.returns, [{ playerId: 0, amount: 90 }]);
  assert.deepEqual(result.winnerIds, [0]);
  assert.deepEqual(result.mainPotWinnerIds, [0]);
  assertConserved(result);
});

test("splits tied pots and awards the odd chip clockwise after the dealer", () => {
  const result = settlePokerShowdown({
    dealerId: 0,
    players: [
      { id: 0, contributed: 5, folded: false, score: 50 },
      { id: 1, contributed: 5, folded: false, score: 10 },
      { id: 2, contributed: 5, folded: false, score: 50 },
    ],
  });

  // Seat 2 is encountered before seat 0 when moving clockwise after dealer 0.
  assert.deepEqual(result.layers[0].winnerIds, [2, 0]);
  assert.deepEqual(result.payouts, [
    { playerId: 0, amount: 7 },
    { playerId: 2, amount: 8 },
  ]);
  assert.deepEqual(result.mainPotWinnerIds, [2, 0]);
  assertConserved(result);
});

test("supports a return-only settlement without manufacturing a winner", () => {
  const result = settlePokerShowdown({
    dealerId: 0,
    players: [
      { id: 0, contributed: 75, folded: false, score: 1 },
      { id: 1, contributed: 0, folded: true },
    ],
  });

  assert.deepEqual(result.payouts, []);
  assert.deepEqual(result.returns, [{ playerId: 0, amount: 75 }]);
  assert.deepEqual(result.winnerIds, []);
  assert.deepEqual(result.mainPotWinnerIds, []);
  assertConserved(result);
});

test("does not mutate participant input", () => {
  const players = [
    { id: 0, contributed: 10, folded: false, score: 2 },
    { id: 1, contributed: 10, folded: false, score: 1 },
  ];
  const before = structuredClone(players);

  settlePokerShowdown({ dealerId: 0, players });

  assert.deepEqual(players, before);
});

test("rejects fractional chips, duplicate players and missing live-hand scores", () => {
  assert.throws(() => settlePokerShowdown({
    dealerId: 0,
    players: [{ id: 0, contributed: 1.5, folded: false, score: 1 }],
  }), /非负安全整数/);
  assert.throws(() => settlePokerShowdown({
    dealerId: 0,
    players: [
      { id: 0, contributed: 10, folded: false, score: 1 },
      { id: 0, contributed: 10, folded: false, score: 1 },
    ],
  }), /重复玩家/);
  assert.throws(() => settlePokerShowdown({
    dealerId: 0,
    players: [
      { id: 0, contributed: 10, folded: false },
      { id: 1, contributed: 10, folded: false, score: 1 },
    ],
  }), /牌力分数/);
});
