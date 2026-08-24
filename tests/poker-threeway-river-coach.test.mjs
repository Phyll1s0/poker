import assert from "node:assert/strict";
import test from "node:test";

import { solveThreeWayRiverCoachDecision } from "../lib/poker-threeway-river-coach.ts";

const card = (rank, suit) => ({ rank, suit });
const BOARD = [
  card(14, "♣"),
  card(13, "♦"),
  card(7, "♠"),
  card(4, "♥"),
  card(2, "♣"),
];
const SUITS = ["♠", "♥", "♦", "♣"];
const HERO = [card(12, "♠"), card(11, "♠")];
const publicWeight = (hole) => (
  0.2
  + Math.max(hole[0].rank, hole[1].rank) / 14
  + (hole[0].rank === hole[1].rank ? 0.5 : 0)
);

function request(overrides = {}) {
  return {
    board: BOARD,
    suits: SUITS,
    heroCards: HERO,
    heroPlayer: "ip",
    rangeWeights: { oop: publicWeight, middle: publicWeight, ip: publicWeight },
    potAtStreetStartBb: 10,
    stackAtStreetStartBb: [20, 20, 20],
    publicActions: [
      { player: "oop", kind: "check", amountPaidBb: 0 },
      { player: "middle", kind: "check", amountPaidBb: 0 },
    ],
    representativeCombos: 3,
    iterations: 100,
    targetNashConvPotFraction: 0.1,
    ...overrides,
  };
}

test("three-way river coach exposes public-tree frequencies, action EVs, and a measured 10% gate", () => {
  const result = solveThreeWayRiverCoachDecision(request());

  assert.equal(result.source, "internal-cfr+-reduced-three-way-river");
  assert.equal(result.approximation, "experimental-multiplayer-cfr+");
  assert.equal(result.history, "check>check");
  assert.equal(result.heroHolding, "QsJs");
  assert.deepEqual(result.representativeCombos, { oop: 3, middle: 3, ip: 3 });
  assert.ok(result.compatibleDeals >= 6, "interleaved range quadrature should retain useful three-way deals");
  assert.ok(result.actions.some((action) => action.action === "check"));
  assert.ok(result.actions.some((action) => action.action === "raise"));
  assert.ok(Math.abs(result.actions.reduce((sum, action) => sum + action.frequency, 0) - 1) < 1e-12);
  assert.ok(result.actions.every((action) => Number.isFinite(action.evBb)));
  assert.ok(Math.abs(
    result.playerDeviationGainsBb.reduce((sum, value) => sum + value, 0) - result.nashConvBb,
  ) < 1e-9);
  assert.equal(result.targetMet, result.nashConvPotFraction <= result.targetNashConvPotFraction);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.actions));
});

test("one caller does not end a three-way river decision", () => {
  const result = solveThreeWayRiverCoachDecision(request({
    heroPlayer: "ip",
    publicActions: [
      { player: "oop", kind: "raise", amountPaidBb: 5 },
      { player: "middle", kind: "call", amountPaidBb: 5 },
    ],
  }));

  assert.equal(result.history, "bet-to:5>call");
  assert.deepEqual(result.actions.map((action) => action.action), ["fold", "call"]);
});

test("the three-way coach rejects reraises and completed public lines", () => {
  assert.throws(() => solveThreeWayRiverCoachDecision(request({
    heroPlayer: "ip",
    publicActions: [
      { player: "oop", kind: "raise", amountPaidBb: 5 },
      { player: "middle", kind: "raise", amountPaidBb: 15 },
    ],
  })), /不支持再加注/);

  assert.throws(() => solveThreeWayRiverCoachDecision(request({
    publicActions: [
      { player: "oop", kind: "check", amountPaidBb: 0 },
      { player: "middle", kind: "check", amountPaidBb: 0 },
      { player: "ip", kind: "check", amountPaidBb: 0 },
    ],
  })), /已经结束/);
});
