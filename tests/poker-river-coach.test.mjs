import assert from "node:assert/strict";
import test from "node:test";

import {
  representativeRiverRange,
  riverCoachHoldingKey,
  solveRiverCoachDecision,
} from "../lib/poker-river-coach.ts";

const card = (rank, suit) => ({ rank, suit });
const BOARD = [
  card(14, "♣"),
  card(13, "♦"),
  card(7, "♠"),
  card(4, "♥"),
  card(2, "♣"),
];
const SUITS = ["♠", "♥", "♦", "♣"];
const HERO = [card(14, "♠"), card(14, "♦")];
const publicWeight = (hole) => {
  const high = Math.max(hole[0].rank, hole[1].rank);
  const pair = hole[0].rank === hole[1].rank ? 1.8 : 1;
  const suited = hole[0].suit === hole[1].suit ? 1.25 : 1;
  return (0.2 + high / 14) * pair * suited;
};

test("representative public ranges retain the pinned hero holding without reading a villain hand", () => {
  const range = representativeRiverRange(BOARD, SUITS, publicWeight, 8, HERO);

  assert.equal(range.length, 8);
  assert.ok(range.some((holding) => riverCoachHoldingKey(holding.cards) === "AsAd"));
  assert.equal(new Set(range.map((holding) => riverCoachHoldingKey(holding.cards))).size, 8);
  assert.ok(range.every((holding) => holding.weight === 1));
  assert.ok(Object.isFrozen(range));
});

test("river coach solves the current reduced CFR+ node and exposes frequencies plus action EV", () => {
  const result = solveRiverCoachDecision({
    board: BOARD,
    suits: SUITS,
    heroCards: HERO,
    heroPlayer: "oop",
    oopRangeWeight: publicWeight,
    ipRangeWeight: publicWeight,
    potAtStreetStartBb: 10,
    effectiveStackAtStreetStartBb: 20,
    publicActions: [],
    canRaise: true,
    representativeCombos: 4,
    iterations: 300,
  });

  assert.equal(result.source, "internal-cfr+-reduced-river");
  assert.equal(result.history, "root");
  assert.equal(result.heroHolding, "AsAd");
  assert.ok(result.actions.some((action) => action.action === "check"));
  assert.ok(result.actions.some((action) => action.action === "raise" && action.raiseToBb === 7.5));
  assert.ok(Math.abs(result.actions.reduce((sum, action) => sum + action.frequency, 0) - 1) < 1e-12);
  assert.ok(result.actions.every((action) => Number.isFinite(action.evBb)));
  assert.ok(Number.isFinite(result.exploitabilityPotFraction));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.actions));
});

test("an observed check is reproduced exactly before solving the in-position decision", () => {
  const result = solveRiverCoachDecision({
    board: BOARD,
    suits: SUITS,
    heroCards: [card(12, "♠"), card(11, "♠")],
    heroPlayer: "ip",
    oopRangeWeight: publicWeight,
    ipRangeWeight: publicWeight,
    potAtStreetStartBb: 8,
    effectiveStackAtStreetStartBb: 16,
    publicActions: [{ player: "oop", kind: "check", amountPaidBb: 0 }],
    canRaise: true,
    representativeCombos: 4,
    iterations: 250,
  });

  assert.equal(result.history, "check");
  assert.ok(result.actions.some((action) => action.action === "check"));
  assert.ok(result.actions.some((action) => action.action === "raise"));
});

test("river coach rejects a public line whose actor does not match the heads-up order", () => {
  assert.throws(() => solveRiverCoachDecision({
    board: BOARD,
    suits: SUITS,
    heroCards: HERO,
    heroPlayer: "oop",
    oopRangeWeight: publicWeight,
    ipRangeWeight: publicWeight,
    potAtStreetStartBb: 10,
    effectiveStackAtStreetStartBb: 20,
    publicActions: [{ player: "ip", kind: "check", amountPaidBb: 0 }],
    canRaise: true,
    representativeCombos: 4,
    iterations: 100,
  }), /行动顺序/);
});
