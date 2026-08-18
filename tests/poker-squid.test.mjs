import assert from "node:assert/strict";
import test from "node:test";

import { settleSquidRound, squidMultiplier } from "../lib/poker-squid.ts";

test("applies the configured 3/5/7 squid multipliers", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7, 9].map(squidMultiplier),
    [1, 1, 1, 2, 2, 3, 3, 4, 4],
  );
});

test("settles a nine-squid round and accounts for external funding", () => {
  const players = [
    { id: 0, name: "P0", stack: 1000 },
    { id: 1, name: "P1", stack: 1000 },
    { id: 2, name: "P2", stack: 1000 },
    { id: 3, name: "P3", stack: 1000 },
    { id: 4, name: "P4", stack: 1000 },
    { id: 5, name: "P5", stack: 200 },
  ];
  const counts = [3, 2, 2, 1, 1, 0];
  const invested = [1000, 1000, 1000, 1000, 1000, 200];
  const beforeStacks = players.reduce((sum, player) => sum + player.stack, 0);
  const beforeInvested = invested.reduce((sum, amount) => sum + amount, 0);

  const result = settleSquidRound(players, counts, 50, invested);

  assert.equal(counts.reduce((sum, count) => sum + count, 0), 9);
  assert.equal(result.obligationPerPayer, 600);
  assert.equal(result.externalFunding, 400);
  assert.equal(result.players[5].stack, 0);
  assert.equal(result.players[0].stack, 1300);
  assert.equal(result.players.reduce((sum, player) => sum + player.stack, 0), beforeStacks + result.externalFunding);
  assert.equal(result.cashInvested.reduce((sum, amount) => sum + amount, 0), beforeInvested + result.externalFunding);
});

test("does not transfer chips when every player has a squid", () => {
  const players = Array.from({ length: 6 }, (_, id) => ({ id, name: `P${id}`, stack: 1000 }));
  const invested = Array(6).fill(1000);
  const result = settleSquidRound(players, [2, 2, 2, 1, 1, 1], 50, invested);

  assert.equal(result.payers.length, 0);
  assert.equal(result.obligationPerPayer, 0);
  assert.deepEqual(result.players, players);
  assert.deepEqual(result.cashInvested, invested);
});
