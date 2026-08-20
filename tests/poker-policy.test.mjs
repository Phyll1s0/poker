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

function totalVariation(left, right) {
  return Object.keys(left).reduce((sum, key) => sum + Math.abs(left[key] - right[key]), 0) / 2;
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

  assert.equal(action.kind, "raise");
  assert.ok(action.raiseTo >= 20 && action.raiseTo <= 30);
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
  assert.equal(shallow.raiseTo, 200);
  assert.ok(shallow.shortStackJamFrequency > 0.7);
  assert.deepEqual(choosePokerPolicyAction({
    ...facingThreeBet,
    startingDepthBb: 40,
    effectiveStackBb: 37.5,
    playerStack: 375,
  }, () => 0), { kind: "raise", raiseTo: 400 });
});

test("publishes one legal normalized postflop mix for AI, coaching and review", () => {
  const plan = evaluatePokerPolicy({
    ...baseSpot,
    boardWetness: 0.62,
    boardPairing: 0,
    boardHighCard: 0.5,
    initiative: false,
    streetRaiseCount: 1,
  });
  const total = Object.values(plan.actionFrequencies).reduce((sum, frequency) => sum + frequency, 0);

  assert.ok(Math.abs(total - 1) < 1e-12);
  assert.equal(plan.actionFrequencies.check, 0);
  assert.ok(plan.actionFrequencies.call > plan.actionFrequencies.raise);
  assert.ok(plan.actionFrequencies.raise > plan.actionFrequencies.fold);

  const locked = evaluatePokerPolicy({ ...baseSpot, raiseLocked: true });
  assert.equal(locked.actionFrequencies.raise, 0);
  assert.deepEqual(locked.sizingRoutes, []);
  assert.ok(Math.abs(locked.actionFrequencies.fold + locked.actionFrequencies.call - 1) < 1e-12);
});

test("moves postflop frequencies smoothly for nearby equities and former depth cutoffs", () => {
  const lower = evaluatePokerPolicy({ ...baseSpot, equity: 0.459 });
  const upper = evaluatePokerPolicy({ ...baseSpot, equity: 0.461 });
  const justShallower = evaluatePokerPolicy({ ...baseSpot, effectiveStackBb: 44.9 });
  const justDeeper = evaluatePokerPolicy({ ...baseSpot, effectiveStackBb: 45.1 });

  assert.ok(totalVariation(lower.actionFrequencies, upper.actionFrequencies) < 0.02);
  assert.ok(totalVariation(justShallower.actionFrequencies, justDeeper.actionFrequencies) < 0.02);
});

test("responds continuously to price, board texture, initiative and number of opponents", () => {
  const facingSmall = evaluatePokerPolicy({ ...baseSpot, pot: 300, toCall: 50, highestBet: 50 });
  const facingLarge = evaluatePokerPolicy({ ...baseSpot, pot: 300, toCall: 180, highestBet: 180 });
  assert.ok(facingLarge.actionFrequencies.fold > facingSmall.actionFrequencies.fold);

  const checkedTo = {
    ...baseSpot,
    street: "flop",
    equity: 0.42,
    handStrength: 0.35,
    draw: 0.05,
    blockers: 0.03,
    pot: 100,
    toCall: 0,
    highestBet: 0,
    initiative: true,
    streetRaiseCount: 0,
  };
  const dryHeadsUp = evaluatePokerPolicy({
    ...checkedTo,
    boardWetness: 0.05,
    boardPairing: 0,
    boardHighCard: 1,
  });
  const wetHeadsUp = evaluatePokerPolicy({
    ...checkedTo,
    boardWetness: 0.95,
    boardPairing: 0,
    boardHighCard: 0.4,
  });
  const dryMultiway = evaluatePokerPolicy({
    ...checkedTo,
    boardWetness: 0.05,
    boardPairing: 0,
    boardHighCard: 1,
    activeOpponents: 3,
  });

  assert.ok(dryHeadsUp.actionFrequencies.raise > wetHeadsUp.actionFrequencies.raise);
  assert.ok(dryHeadsUp.sizingIntents[0].frequency > wetHeadsUp.sizingIntents[0].frequency);
  assert.ok(dryMultiway.actionFrequencies.raise < dryHeadsUp.actionFrequencies.raise * 0.6);
});

test("categorical sampling matches the published postflop frequencies", () => {
  const random = seeded(777);
  const samples = 12_000;
  const counts = { fold: 0, check: 0, call: 0, raise: 0 };
  const plan = evaluatePokerPolicy(baseSpot);
  for (let index = 0; index < samples; index += 1) {
    counts[choosePokerPolicyAction(baseSpot, random).kind] += 1;
  }
  for (const kind of Object.keys(counts)) {
    assert.ok(Math.abs(counts[kind] / samples - plan.actionFrequencies[kind]) < 0.02);
  }
});

test("raise sampling matches the published conditional sizing mix", () => {
  const spot = {
    ...baseSpot,
    street: "river",
    equity: 0.88,
    handStrength: 0.9,
    draw: 0,
    blockers: 0.12,
    toCall: 0,
    highestBet: 0,
    minRaise: 10,
    pot: 300,
    initiative: true,
    boardWetness: 0.4,
    boardPairing: 0,
    boardHighCard: 0.8,
    streetRaiseCount: 0,
  };
  const plan = evaluatePokerPolicy(spot);
  const counts = new Map(plan.sizingRoutes.map((route) => [route.target, 0]));
  const random = seeded(1847);
  let raises = 0;
  for (let index = 0; index < 16_000; index += 1) {
    const action = choosePokerPolicyAction(spot, random);
    if (action.kind !== "raise") continue;
    raises += 1;
    counts.set(action.raiseTo, (counts.get(action.raiseTo) ?? 0) + 1);
  }

  assert.ok(raises > 8_000);
  for (const route of plan.sizingRoutes) {
    assert.ok(Math.abs((counts.get(route.target) ?? 0) / raises - route.frequency) < 0.025);
  }
});

test("an injected upper-bound RNG still selects the final legal branches", () => {
  const spot = {
    ...baseSpot,
    street: "river",
    equity: 0.95,
    handStrength: 0.96,
    draw: 0,
    blockers: 0.12,
    toCall: 0,
    highestBet: 0,
    minRaise: 10,
    pot: 300,
    initiative: true,
  };
  const plan = evaluatePokerPolicy(spot);
  const rolls = [1, 0, 0];
  const action = choosePokerPolicyAction(spot, () => rolls.shift() ?? 0);
  const finalSizingBranch = [...plan.sizingRoutes]
    .filter((route) => route.frequency > 0)
    .sort((left, right) => right.frequency - left.frequency)
    .at(-1);

  assert.ok(finalSizingBranch);
  assert.equal(action.kind, "raise");
  assert.equal(action.raiseTo, finalSizingBranch.target);
});

test("modal size crossings do not create action-frequency cliffs", () => {
  const spot = {
    ...baseSpot,
    street: "flop",
    equity: 0.52,
    handStrength: 0.45,
    draw: 0.08,
    blockers: 0.05,
    toCall: 0,
    highestBet: 0,
    minRaise: 10,
    pot: 200,
    initiative: true,
    boardPairing: 0,
    boardHighCard: 0.7,
    streetRaiseCount: 0,
  };
  let previous = evaluatePokerPolicy({ ...spot, boardWetness: 0 });
  let maximumStep = 0;
  for (let step = 1; step <= 1_000; step += 1) {
    const current = evaluatePokerPolicy({ ...spot, boardWetness: step / 1_000 });
    maximumStep = Math.max(maximumStep, totalVariation(previous.actionFrequencies, current.actionFrequencies));
    previous = current;
  }
  assert.ok(maximumStep < 0.01);
});
