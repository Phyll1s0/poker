import assert from "node:assert/strict";
import test from "node:test";

import { choosePokerPolicyAction, evaluatePokerPolicy } from "../lib/poker-policy.ts";

const baseSpot = {
  profile: { aggression: 0.7, looseness: 0.3, bluff: 0.16 },
  street: "turn",
  equity: 0.46,
  handStrength: 0.42,
  draw: 0.16,
  blockers: 0.1,
  pot: 300,
  toCall: 70,
  potOdds: 70 / 370,
  inPosition: true,
  activeOpponents: 1,
  effectiveStackBb: 80,
  startingDepthBb: 100,
  highestBet: 70,
  playerBet: 0,
  playerStack: 800,
  minRaise: 70,
  raiseLocked: false,
  squidPressure: 0,
  bigBlind: 10,
};

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test("samples reproducibly with an injected seeded RNG", () => {
  const firstRandom = seeded(90210);
  const replayRandom = seeded(90210);
  const first = Array.from({ length: 12 }, () => choosePokerPolicyAction(baseSpot, firstRandom));
  const replay = Array.from({ length: 12 }, () => choosePokerPolicyAction(baseSpot, replayRandom));

  assert.deepEqual(first, replay);
});

test("strong shallow low-SPR hands can choose a legal all-in", () => {
  const spot = {
    ...baseSpot,
    street: "flop",
    equity: 0.91,
    handStrength: 0.94,
    draw: 0.05,
    pot: 700,
    toCall: 80,
    potOdds: 80 / 780,
    effectiveStackBb: 35,
    startingDepthBb: 40,
    highestBet: 80,
    playerBet: 0,
    playerStack: 350,
    minRaise: 80,
  };

  const plan = evaluatePokerPolicy(spot);
  const action = choosePokerPolicyAction(spot, () => 0);

  assert.ok(plan.spr < 1);
  assert.ok(plan.shortStackJamFrequency > 0);
  assert.deepEqual(action, { kind: "raise", raiseTo: 350 });
});

test("multiway pots suppress bluffing and probing frequencies", () => {
  const headsUp = evaluatePokerPolicy(baseSpot);
  const fourWay = evaluatePokerPolicy({ ...baseSpot, activeOpponents: 3 });

  assert.ok(fourWay.bluffFrequency < headsUp.bluffFrequency * 0.6);
  assert.ok(fourWay.probeFrequency < headsUp.probeFrequency * 0.6);
  assert.ok(fourWay.valueThreshold > headsUp.valueThreshold);
});

test("reports the executable bet fraction after an all-in cap", () => {
  const plan = evaluatePokerPolicy({
    ...baseSpot,
    pot: 100,
    highestBet: 50,
    minRaise: 200,
    playerBet: 0,
    playerStack: 180,
    effectiveStackBb: 18,
  });

  assert.equal(plan.raiseTo, 180);
  assert.equal(plan.betFraction, 130 / 170);
  assert.equal(plan.balancedBluffRate, (130 / 170) / (1 + 2 * (130 / 170)));
});

test("opens wider in late position and keeps distinct profile ranges", () => {
  const preflopSpot = {
    ...baseSpot,
    street: "preflop",
    equity: 0.34,
    handStrength: 0.5,
    preflopPercentile: 0.77,
    preflopRaiseCount: 0,
    pot: 15,
    toCall: 10,
    potOdds: 0.4,
    highestBet: 10,
    minRaise: 10,
    playerStack: 990,
    effectiveStackBb: 99,
  };
  const early = evaluatePokerPolicy({ ...preflopSpot, preflopPositionFactor: 0.72 });
  const late = evaluatePokerPolicy({ ...preflopSpot, preflopPositionFactor: 1.28 });
  const nit = evaluatePokerPolicy({
    ...preflopSpot,
    profile: { aggression: 0.38, looseness: 0.16, bluff: 0.02 },
    preflopPositionFactor: 1.28,
  });

  assert.ok(late.preflopTargetRange > early.preflopTargetRange);
  assert.ok(late.preflopEnterFrequency > early.preflopEnterFrequency);
  assert.ok(late.preflopTargetRange > nit.preflopTargetRange);
});

test("uses a normal open size and does not open-shove at 40 BB", () => {
  const action = choosePokerPolicyAction({
    ...baseSpot,
    street: "preflop",
    equity: 0.7,
    handStrength: 0.9,
    preflopPercentile: 0.98,
    preflopPositionFactor: 1.28,
    preflopRaiseCount: 0,
    pot: 15,
    toCall: 10,
    potOdds: 0.4,
    highestBet: 10,
    minRaise: 10,
    playerStack: 390,
    effectiveStackBb: 39,
    startingDepthBb: 40,
  }, () => 0);

  assert.deepEqual(action, { kind: "raise", raiseTo: 25 });
});

test("tightens preflop continues when a raise puts the effective stack at risk", () => {
  const facingOpen = {
    ...baseSpot,
    street: "preflop",
    equity: 0.54,
    handStrength: 0.55,
    preflopPercentile: 0.8,
    preflopPositionFactor: 1.28,
    preflopRaiseCount: 1,
    pot: 40,
    toCall: 25,
    potOdds: 25 / 65,
    highestBet: 25,
    minRaise: 15,
    playerStack: 1_000,
    effectiveStackBb: 100,
  };
  const facingJam = {
    ...facingOpen,
    pot: 1_015,
    toCall: 990,
    potOdds: 990 / 2_005,
    highestBet: 1_000,
    minRaise: 990,
    playerStack: 990,
    effectiveStackBb: 99,
  };

  const openPlan = evaluatePokerPolicy(facingOpen);
  const jamPlan = evaluatePokerPolicy(facingJam);
  assert.ok(openPlan.preflopEnterFrequency > jamPlan.preflopEnterFrequency * 10);
  assert.equal(choosePokerPolicyAction(facingOpen, () => 0.2).kind, "call");
  assert.equal(choosePokerPolicyAction(facingJam, () => 0.2).kind, "fold");
});

test("a blocked bluff cannot bypass a clearly losing call", () => {
  const action = choosePokerPolicyAction({
    ...baseSpot,
    street: "river",
    equity: 0.08,
    handStrength: 0.1,
    draw: 0,
    blockers: 0.12,
    pot: 100,
    toCall: 100,
    potOdds: 0.5,
    highestBet: 100,
    playerStack: 100,
    effectiveStackBb: 10,
    raiseLocked: true,
  }, () => 0);

  assert.deepEqual(action, { kind: "fold" });
});

test("uses raise-or-fold when first entering before the big blind", () => {
  const spot = {
    ...baseSpot,
    street: "preflop",
    equity: 0.82,
    handStrength: 0.94,
    preflopPercentile: 1,
    preflopPositionFactor: 0.72,
    preflopRaiseCount: 0,
    pot: 15,
    toCall: 10,
    potOdds: 0.4,
    highestBet: 10,
    minRaise: 10,
    playerStack: 990,
    effectiveStackBb: 99,
  };
  const plan = evaluatePokerPolicy(spot);
  const action = choosePokerPolicyAction(spot, () => 0.99);

  assert.equal(plan.preflopOpenRaiseFrequency, 1);
  assert.ok(plan.preflopThreeBetFrequency < plan.preflopOpenRaiseFrequency);
  assert.equal(action.kind, "raise");
});

test("rounding never lowers a normal raise below the legal floor", () => {
  const plan = evaluatePokerPolicy({
    ...baseSpot,
    profile: { aggression: 0, looseness: 0.3, bluff: 0 },
    street: "preflop",
    pot: 15,
    toCall: 10,
    highestBet: 10,
    minRaise: 16,
    playerStack: 990,
    effectiveStackBb: 99,
    preflopPercentile: 1,
    preflopPositionFactor: 1,
    preflopRaiseCount: 0,
  });

  assert.equal(plan.raiseTo, 26);
});

test("publishes one normalized preflop mix and defends the big blind wider than the small blind", () => {
  const facingButtonOpen = {
    ...baseSpot,
    street: "preflop",
    equity: 0.46,
    handStrength: 0.5,
    preflopPercentile: 0.74,
    preflopRaiseCount: 1,
    preflopOpenerPosition: "BTN",
    pot: 40,
    toCall: 15,
    highestBet: 25,
    playerBet: 10,
    minRaise: 15,
    playerStack: 990,
    effectiveStackBb: 99,
  };
  const bigBlind = evaluatePokerPolicy({
    ...facingButtonOpen,
    preflopPosition: "BB",
    preflopPositionFactor: 1.35,
  });
  const smallBlind = evaluatePokerPolicy({
    ...facingButtonOpen,
    preflopPosition: "SB",
    preflopPositionFactor: 0.9,
    playerBet: 5,
    toCall: 20,
  });

  assert.ok(Math.abs(Object.values(bigBlind.actionFrequencies).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.ok(bigBlind.preflopTargetRange > smallBlind.preflopTargetRange * 1.8);
  assert.ok(bigBlind.actionFrequencies.fold < smallBlind.actionFrequencies.fold);
});

test("uses position ranges for first-in decisions instead of raw pot-odds equity", () => {
  const firstIn = {
    ...baseSpot,
    street: "preflop",
    equity: 0.05,
    handStrength: 0.65,
    preflopPercentile: 0.91,
    preflopRaiseCount: 0,
    preflopPosition: "UTG",
    preflopPositionFactor: 0.72,
    pot: 15,
    toCall: 10,
    highestBet: 10,
    playerBet: 0,
    minRaise: 10,
    playerStack: 990,
    effectiveStackBb: 99,
  };
  const early = evaluatePokerPolicy(firstIn);
  const button = evaluatePokerPolicy({ ...firstIn, preflopPosition: "BTN", preflopPositionFactor: 1.28 });

  assert.equal(early.preflopScenario, "open");
  assert.equal(early.actionFrequencies.call, 0);
  assert.ok(early.actionFrequencies.raise > early.actionFrequencies.fold);
  assert.ok(button.preflopTargetRange > early.preflopTargetRange * 2);
});

test("builds a separate four-bet and shallow-jam branch against a three-bet", () => {
  const aces = {
    highRank: 14,
    lowRank: 14,
    pair: true,
    suited: false,
    gap: 0,
  };
  const facingThreeBet = {
    ...baseSpot,
    street: "preflop",
    equity: 0.82,
    handStrength: 0.98,
    preflopPercentile: 1,
    preflopHand: aces,
    preflopPosition: "BTN",
    preflopPositionFactor: 1.28,
    preflopRaiseCount: 2,
    preflopPreviouslyRaised: true,
    pot: 125,
    toCall: 65,
    highestBet: 90,
    playerBet: 25,
    minRaise: 65,
    playerStack: 975,
    effectiveStackBb: 100,
  };
  const deepEnough = evaluatePokerPolicy(facingThreeBet);
  const shallow = evaluatePokerPolicy({
    ...facingThreeBet,
    startingDepthBb: 40,
    effectiveStackBb: 37.5,
    playerStack: 375,
  });

  assert.equal(deepEnough.preflopScenario, "vs-three-bet");
  assert.ok(deepEnough.actionFrequencies.raise > deepEnough.actionFrequencies.call);
  assert.equal(deepEnough.raiseTo, 200);
  assert.equal(shallow.raiseTo, 400);
  assert.ok(shallow.shortStackJamFrequency > 0.8);
});
