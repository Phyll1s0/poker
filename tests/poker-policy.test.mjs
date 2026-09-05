import assert from "node:assert/strict";
import test from "node:test";

import {
  choosePokerPolicyAction,
  evaluatePokerPolicy,
  pokerCallClosesContestableLayers,
  pokerCallClosesAction,
  pokerContestablePotAtDecision,
  pokerDecisionStackContext,
  pokerEffectiveStackAtDecision,
} from "../lib/poker-policy.ts";

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

test("terminal-call recognition respects unfunded seats and pending funded responders", () => {
  const hero = { id: 0, stack: 900, contributed: 100, folded: false };
  const bettor = { id: 1, stack: 800, contributed: 200, folded: false };
  const behind = { id: 2, stack: 900, contributed: 100, folded: false };
  const closes = (players, street) => pokerCallClosesAction(0, 100, 900, 100, players, street);
  assert.equal(closes([hero, bettor], "river"), true);
  assert.equal(closes([hero, bettor], "turn"), false);
  assert.equal(closes([hero, { ...bettor, stack: 0 }], "flop"), true);
  assert.equal(closes([hero, bettor, behind], "river"), false);
  assert.equal(closes([hero, { ...bettor, stack: 0 }, behind], "flop"), false);
  assert.equal(closes([hero, bettor, { ...behind, folded: true }], "river"), true);
});

test("the displayed realization boundary is the actual fold/call indifference point", () => {
  for (const activeOpponents of [1, 2, 4]) {
    for (const playerStack of [100, 300, 1000]) {
      const spot = {
        ...baseSpot, profile: { aggression: 0.7, looseness: 0.27, bluff: 0.12 },
        activeOpponents, playerStack, effectiveStackBb: playerStack / 10,
        handStrength: 0.25, draw: 0, blockers: 0, inPosition: false,
        raiseLocked: true, callEndsHand: false,
      };
      const boundary = evaluatePokerPolicy(spot).realizationThreshold;
      const plan = evaluatePokerPolicy({ ...spot, equity: boundary });
      assert.ok(Math.abs(plan.actionFrequencies.call - 0.5) < 1e-9,
        `${activeOpponents} opponents / ${playerStack} chips: call ${plan.actionFrequencies.call}`);
    }
  }
});

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

test("adds a hand-aware open-jam branch once the starting stack is truly short", () => {
  const plan = evaluatePokerPolicy({
    ...baseSpot,
    street: "preflop",
    equity: 0.82,
    handStrength: 0.92,
    preflopPercentile: 0.99,
    preflopPosition: "BTN",
    preflopPositionFactor: 1.28,
    preflopRaiseCount: 0,
    preflopHand: { highRank: 14, lowRank: 13, pair: false, suited: true, gap: 1 },
    pot: 15,
    toCall: 10,
    highestBet: 10,
    minRaise: 10,
    playerStack: 100,
    maxContestableTarget: 100,
    effectiveStackBb: 9,
    startingDepthBb: 10,
  });
  assert.ok(plan.shortStackJamFrequency >= 0.75);
  assert.ok(plan.sizingRoutes.some((route) => route.allIn && route.frequency >= 0.75));
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

test("uses the 169-class chart for canonical opening and blind-defense hands", () => {
  const chartSpot = {
    ...baseSpot,
    profile: { aggression: 0.7, looseness: 0.27, bluff: 0.12 },
    street: "preflop",
    pot: 15,
    toCall: 10,
    highestBet: 10,
    playerBet: 0,
    minRaise: 10,
    playerStack: 990,
    effectiveStackBb: 99,
    preflopRaiseCount: 0,
  };
  const pairOfDeuces = { highRank: 2, lowRank: 2, pair: true, suited: false, gap: 0 };
  const kingJackOff = { highRank: 13, lowRank: 11, pair: false, suited: false, gap: 2 };
  const queenJackOff = { highRank: 12, lowRank: 11, pair: false, suited: false, gap: 1 };
  const queenNineOff = { highRank: 12, lowRank: 9, pair: false, suited: false, gap: 3 };

  const buttonDeuces = evaluatePokerPolicy({ ...chartSpot, preflopPosition: "BTN", preflopHand: pairOfDeuces });
  const cutoffDeuces = evaluatePokerPolicy({ ...chartSpot, preflopPosition: "CO", preflopHand: pairOfDeuces });
  const cutoffQueenNineOff = evaluatePokerPolicy({ ...chartSpot, preflopPosition: "CO", preflopHand: queenNineOff });
  const utgKingJack = evaluatePokerPolicy({ ...chartSpot, preflopPosition: "UTG", preflopHand: kingJackOff });
  const utgQueenJack = evaluatePokerPolicy({ ...chartSpot, preflopPosition: "UTG", preflopHand: queenJackOff });

  assert.ok(buttonDeuces.actionFrequencies.raise >= 0.8);
  assert.ok(buttonDeuces.actionFrequencies.call >= 0.1);
  assert.ok(cutoffQueenNineOff.actionFrequencies.call + cutoffQueenNineOff.actionFrequencies.raise >= 0.75);
  assert.equal(cutoffQueenNineOff.preflopScenario, "open");
  assert.ok(cutoffDeuces.actionFrequencies.raise >= 0.82);
  assert.ok(cutoffDeuces.actionFrequencies.call >= 0.08);
  assert.ok(utgKingJack.actionFrequencies.fold >= 0.85);
  assert.ok(utgQueenJack.actionFrequencies.fold >= 0.9);

  const bigBlindDefense = evaluatePokerPolicy({
    ...chartSpot,
    preflopPosition: "BB",
    preflopOpenerPosition: "BTN",
    preflopRaiseCount: 1,
    preflopHand: pairOfDeuces,
    pot: 40,
    highestBet: 25,
    playerBet: 10,
    toCall: 15,
    playerStack: 990,
  });
  assert.ok(bigBlindDefense.actionFrequencies.call + bigBlindDefense.actionFrequencies.raise >= 0.88);
  assert.ok(bigBlindDefense.actionFrequencies.call > bigBlindDefense.actionFrequencies.raise);
});

test("mixes protected open limps, overlimps and big-blind isolation raises", () => {
  const common = {
    ...baseSpot,
    profile: { aggression: 0.7, looseness: 0.27, bluff: 0.12 },
    street: "preflop",
    pot: 15,
    highestBet: 10,
    minRaise: 10,
    playerStack: 990,
    effectiveStackBb: 99,
    startingDepthBb: 100,
    preflopRaiseCount: 0,
  };
  const deuces = { highRank: 2, lowRank: 2, pair: true, suited: false, gap: 0 };
  const aces = { highRank: 14, lowRank: 14, pair: true, suited: false, gap: 0 };
  const sevenSixSuited = { highRank: 7, lowRank: 6, pair: false, suited: true, gap: 1 };
  const buttonDeuces = evaluatePokerPolicy({
    ...common,
    preflopPosition: "BTN",
    preflopHand: deuces,
    preflopPercentile: 0.72,
    toCall: 10,
    playerBet: 0,
  });
  const buttonAces = evaluatePokerPolicy({
    ...common,
    preflopPosition: "BTN",
    preflopHand: aces,
    preflopPercentile: 1,
    toCall: 10,
    playerBet: 0,
  });
  const buttonOverlimp = evaluatePokerPolicy({
    ...common,
    preflopPosition: "BTN",
    preflopHand: sevenSixSuited,
    preflopPercentile: 0.8,
    preflopLimpers: 1,
    toCall: 10,
    playerBet: 0,
  });
  const bigBlindIsolation = evaluatePokerPolicy({
    ...common,
    preflopPosition: "BB",
    preflopHand: aces,
    preflopPercentile: 1,
    preflopLimpers: 1,
    toCall: 0,
    playerBet: 10,
  });
  const limpedQueensFacingRaise = evaluatePokerPolicy({
    ...common,
    preflopPosition: "BTN",
    preflopOpenerPosition: "BB",
    preflopHand: { highRank: 12, lowRank: 12, pair: true, suited: false, gap: 0 },
    preflopPercentile: 0.98,
    preflopLimpers: 1,
    preflopRaiseCount: 1,
    preflopPreviouslyLimped: true,
    pot: 60,
    highestBet: 40,
    playerBet: 10,
    toCall: 30,
    minRaise: 30,
  });

  assert.equal(buttonDeuces.preflopScenario, "open");
  assert.ok(buttonDeuces.actionFrequencies.call >= 0.1);
  assert.ok(buttonDeuces.actionFrequencies.raise > buttonDeuces.actionFrequencies.call);
  assert.ok(buttonAces.actionFrequencies.call >= 0.03, "premium traps must protect the limp range");
  assert.ok(buttonAces.actionFrequencies.raise >= 0.9);
  assert.equal(buttonOverlimp.preflopScenario, "isolate");
  assert.ok(buttonOverlimp.actionFrequencies.call >= 0.18);
  assert.ok(buttonOverlimp.actionFrequencies.raise > buttonOverlimp.actionFrequencies.call);
  assert.equal(bigBlindIsolation.preflopScenario, "isolate");
  assert.ok(bigBlindIsolation.actionFrequencies.raise >= 0.85);
  assert.equal(limpedQueensFacingRaise.preflopScenario, "vs-open");
  assert.ok(limpedQueensFacingRaise.actionFrequencies.raise >= 0.82);
});

test("preserves charted ace-five suited bluff branches", () => {
  const aceFiveSuited = { highRank: 14, lowRank: 5, pair: false, suited: true, gap: 9 };
  const facingButtonOpen = evaluatePokerPolicy({
    ...baseSpot,
    profile: { aggression: 0.7, looseness: 0.27, bluff: 0.12 },
    street: "preflop",
    preflopPosition: "SB",
    preflopOpenerPosition: "BTN",
    preflopRaiseCount: 1,
    preflopHand: aceFiveSuited,
    pot: 40,
    highestBet: 25,
    playerBet: 5,
    toCall: 20,
    minRaise: 15,
    playerStack: 995,
    effectiveStackBb: 100,
  });
  const facingThreeBet = evaluatePokerPolicy({
    ...baseSpot,
    profile: { aggression: 0.7, looseness: 0.27, bluff: 0.12 },
    street: "preflop",
    preflopPosition: "BTN",
    preflopOpenerPosition: "SB",
    preflopRaiseCount: 2,
    preflopPreviouslyRaised: true,
    preflopHand: aceFiveSuited,
    pot: 125,
    highestBet: 90,
    playerBet: 25,
    toCall: 65,
    minRaise: 65,
    playerStack: 975,
    effectiveStackBb: 100,
  });

  assert.ok(facingButtonOpen.actionFrequencies.raise >= 0.25);
  assert.ok(facingThreeBet.actionFrequencies.raise >= 0.1);
});

test("gives ace-ten a position-aware three-bet branch without widening early defense", () => {
  const aceTenOffsuit = { highRank: 14, lowRank: 10, pair: false, suited: false, gap: 4 };
  const aceTenSuited = { ...aceTenOffsuit, suited: true };
  const facingOpen = {
    ...baseSpot,
    profile: { aggression: 0.73, looseness: 0.3, bluff: 0.13 },
    street: "preflop",
    preflopRaiseCount: 1,
    preflopPreviouslyRaised: false,
    preflopLimpers: 0,
    preflopColdCallers: 0,
    pot: 40,
    highestBet: 25,
    minRaise: 15,
    effectiveStackBb: 99,
    startingDepthBb: 100,
  };
  const smallBlindOffsuit = evaluatePokerPolicy({
    ...facingOpen,
    preflopPosition: "SB",
    preflopOpenerPosition: "BTN",
    preflopHand: aceTenOffsuit,
    playerBet: 5,
    toCall: 20,
    playerStack: 995,
    inPosition: false,
  });
  const buttonSuited = evaluatePokerPolicy({
    ...facingOpen,
    preflopPosition: "BTN",
    preflopOpenerPosition: "CO",
    preflopHand: aceTenSuited,
    playerBet: 0,
    toCall: 25,
    playerStack: 1_000,
    inPosition: true,
  });
  const hijackOffsuit = evaluatePokerPolicy({
    ...facingOpen,
    preflopPosition: "HJ",
    preflopOpenerPosition: "UTG",
    preflopHand: aceTenOffsuit,
    playerBet: 0,
    toCall: 25,
    playerStack: 1_000,
    inPosition: true,
  });

  assert.equal(smallBlindOffsuit.preflopScenario, "vs-open");
  assert.ok(smallBlindOffsuit.actionFrequencies.raise >= 0.4, JSON.stringify(smallBlindOffsuit.actionFrequencies));
  assert.ok(smallBlindOffsuit.actionFrequencies.raise > smallBlindOffsuit.actionFrequencies.call);
  assert.ok(buttonSuited.actionFrequencies.raise >= 0.4, JSON.stringify(buttonSuited.actionFrequencies));
  assert.ok(hijackOffsuit.actionFrequencies.fold >= 0.8, JSON.stringify(hijackOffsuit.actionFrequencies));
  assert.ok(hijackOffsuit.actionFrequencies.raise <= 0.04);
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

test("policy wiring distinguishes an opener from a squeezed caller and a cold entrant", () => {
  const common = {
    ...baseSpot,
    profile: { aggression: 0.7, looseness: 0.27, bluff: 0.12 },
    street: "preflop",
    preflopPosition: "BTN",
    preflopOpenerPosition: "SB",
    preflopRaiseCount: 2,
    preflopHand: { highRank: 7, lowRank: 6, pair: false, suited: true, gap: 1 },
    preflopLimpers: 0,
    preflopColdCallers: 1,
    pot: 150,
    highestBet: 90,
    playerBet: 25,
    toCall: 65,
    minRaise: 65,
    playerStack: 975,
    effectiveStackBb: 97.5,
    startingDepthBb: 100,
  };
  const opener = evaluatePokerPolicy({
    ...common,
    preflopPreviouslyRaised: true,
    preflopWasPreviousAggressor: true,
  });
  const squeezedCaller = evaluatePokerPolicy({
    ...common,
    preflopPreviouslyRaised: false,
    preflopWasPreviousAggressor: false,
    preflopPreviouslyColdCalled: true,
  });
  const coldEntry = evaluatePokerPolicy({
    ...common,
    playerBet: 0,
    toCall: 90,
    preflopPreviouslyRaised: false,
    preflopWasPreviousAggressor: false,
    preflopPreviouslyColdCalled: false,
  });
  const continues = (plan) => plan.actionFrequencies.call + plan.actionFrequencies.raise;
  assert.ok(continues(opener) > continues(squeezedCaller) + 0.2);
  assert.ok(continues(squeezedCaller) > continues(coldEntry) + 0.18);
  assert.ok(continues(coldEntry) < 0.1);
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

test("keeps public range advantages combo-independent while mixing real air bluffs", () => {
  const publicSpot = {
    ...baseSpot,
    street: "river",
    pot: 300,
    toCall: 0,
    highestBet: 0,
    playerBet: 0,
    minRaise: 10,
    inPosition: true,
    activeOpponents: 1,
    initiative: true,
    boardWetness: 0.28,
    boardPairing: 0,
    boardHighCard: 0.78,
    streetRaiseCount: 0,
    draw: 0,
  };
  const air = evaluatePokerPolicy({
    ...publicSpot,
    equity: 0.08,
    handStrength: 0.1,
    blockers: 0,
  });
  const blockerAir = evaluatePokerPolicy({
    ...publicSpot,
    equity: 0.08,
    handStrength: 0.1,
    blockers: 0.1,
  });
  const value = evaluatePokerPolicy({
    ...publicSpot,
    equity: 0.9,
    handStrength: 0.92,
    blockers: 0,
  });
  const lagAir = evaluatePokerPolicy({
    ...publicSpot,
    profile: { aggression: 0.94, looseness: 0.47, bluff: 0.25 },
    equity: 0.08,
    handStrength: 0.1,
    blockers: 0,
  });
  const nitAir = evaluatePokerPolicy({
    ...publicSpot,
    profile: { aggression: 0.5, looseness: 0.15, bluff: 0.03 },
    equity: 0.08,
    handStrength: 0.1,
    blockers: 0,
  });

  assert.equal(air.rangeAdvantage, value.rangeAdvantage);
  assert.equal(air.nutAdvantage, value.nutAdvantage);
  assert.ok(air.actionFrequencies.raise >= 0.28, JSON.stringify(air.actionFrequencies));
  assert.ok(blockerAir.actionFrequencies.raise > air.actionFrequencies.raise + 0.08);
  assert.ok(value.actionFrequencies.raise > air.actionFrequencies.raise);
  assert.ok(lagAir.actionFrequencies.raise > air.actionFrequencies.raise + 0.04);
  assert.ok(nitAir.actionFrequencies.raise < air.actionFrequencies.raise - 0.02);
});

test("separates semi-bluff raises from losing calls and keeps multiway pressure honest", () => {
  const facingSmallBet = {
    ...baseSpot,
    street: "flop",
    profile: { aggression: 0.73, looseness: 0.3, bluff: 0.13 },
    equity: 0.28,
    handStrength: 0.1,
    draw: 0.16,
    blockers: 0.02,
    pot: 300,
    toCall: 100,
    highestBet: 100,
    playerBet: 0,
    playerStack: 900,
    effectiveStackBb: 90,
    inPosition: true,
    activeOpponents: 1,
    boardWetness: 0.72,
    boardPairing: 0,
    boardHighCard: 0.55,
    initiative: false,
    streetRaiseCount: 1,
  };
  const draw = evaluatePokerPolicy(facingSmallBet);
  const noDraw = evaluatePokerPolicy({ ...facingSmallBet, draw: 0, blockers: 0 });
  const multiway = evaluatePokerPolicy({ ...facingSmallBet, activeOpponents: 3 });

  assert.ok(draw.actionFrequencies.raise > noDraw.actionFrequencies.raise + 0.02);
  assert.ok(draw.actionFrequencies.raise >= 0.06);
  assert.ok(multiway.actionFrequencies.raise < draw.actionFrequencies.raise);
});

test("centers non-terminal fold-call mixing on the published realization threshold", () => {
  const multiwayRiver = {
    ...baseSpot,
    street: "river",
    pot: 840,
    toCall: 225,
    highestBet: 225,
    playerBet: 0,
    playerStack: 900,
    effectiveStackBb: 90,
    activeOpponents: 3,
    inPosition: false,
    callEndsHand: false,
    raiseLocked: true,
    draw: 0,
    blockers: 0,
    boardWetness: 0.65,
    streetRaiseCount: 1,
  };
  const reference = evaluatePokerPolicy({ ...multiwayRiver, equity: 0.3, handStrength: 0.3 });
  assert.ok(reference.equityRealization < 0.9);
  assert.ok(reference.realizationThreshold > 225 / 1_065);

  const below = evaluatePokerPolicy({
    ...multiwayRiver,
    equity: reference.realizationThreshold - 0.02,
    handStrength: reference.realizationThreshold - 0.02,
  });
  const above = evaluatePokerPolicy({
    ...multiwayRiver,
    equity: reference.realizationThreshold + 0.02,
    handStrength: reference.realizationThreshold + 0.02,
  });
  assert.ok(below.actionFrequencies.fold > below.actionFrequencies.call);
  assert.ok(above.actionFrequencies.call > above.actionFrequencies.fold);
});

test("never recommends folding a large equity edge over the direct price", () => {
  const plan = evaluatePokerPolicy({
    ...baseSpot,
    street: "turn",
    equity: 0.44,
    handStrength: 0.42,
    pot: 840,
    toCall: 225,
    highestBet: 225,
    playerBet: 0,
    activeOpponents: 3,
    inPosition: false,
    callEndsHand: false,
    raiseLocked: true,
    boardWetness: 0.75,
    streetRaiseCount: 1,
  });
  assert.ok(plan.realizationThreshold < 0.3);
  assert.ok(plan.actionFrequencies.call > 0.9);
  assert.ok(plan.actionFrequencies.fold < 0.1);
});

test("does not turn a profitable all-in call into a 94% threshold when the bettor has no chips behind", () => {
  const plan = evaluatePokerPolicy({
    ...baseSpot,
    street: "turn",
    equity: 0.44,
    handStrength: 0.5,
    draw: 0.1,
    blockers: 0.05,
    pot: 840,
    toCall: 225,
    highestBet: 225,
    playerBet: 0,
    playerStack: 700,
    effectiveStackBb: 0,
    raiseLocked: true,
    opponentsCanRespond: false,
    callEndsHand: true,
    boardWetness: 0.75,
    boardPairing: 0,
    boardHighCard: 1,
    initiative: false,
    streetRaiseCount: 1,
  });

  assert.equal(plan.pressure, 1);
  assert.ok(Math.abs(plan.realizationThreshold - 225 / 1_065) < 1e-12);
  assert.ok(plan.actionFrequencies.call > 0.99);
  assert.ok(plan.actionFrequencies.fold < 0.01);
  assert.equal(plan.actionFrequencies.raise, 0);
});

test("counts an all-in bettor's unmatched wager in the decision effective stack", () => {
  assert.equal(pokerEffectiveStackAtDecision(700, 0, [{ stack: 0, bet: 225 }]), 225);
  assert.equal(pokerEffectiveStackAtDecision(700, 100, [{ stack: 0, bet: 225 }]), 125);
  assert.equal(pokerEffectiveStackAtDecision(700, 0, [
    { stack: 0, bet: 225 },
    { stack: 500, bet: 225 },
  ]), 700);
});

test("separates the relevant aggressor from the deepest contestable opponent", () => {
  const opponents = [
    { id: 1, stack: 0, bet: 200 },
    { id: 2, stack: 2_000, bet: 0 },
  ];
  const facingShortAggressor = pokerDecisionStackContext(1_970, 30, opponents, 1);
  const deepestContestable = pokerDecisionStackContext(1_970, 30, opponents);

  assert.deepEqual(facingShortAggressor, {
    playerStack: 1_970,
    opponentReach: 170,
    effectiveStack: 170,
    opponentId: 1,
  });
  assert.deepEqual(deepestContestable, {
    playerStack: 1_970,
    opponentReach: 1_970,
    effectiveStack: 1_970,
    opponentId: 2,
  });
});

test("computes a multiway raise cap from each opponent's total street reach", () => {
  const context = pokerDecisionStackContext(900, 100, [
    { id: 1, stack: 0, bet: 120 },
    { id: 2, stack: 500, bet: 0 },
  ]);

  assert.equal(context.opponentId, 2);
  assert.equal(context.effectiveStack, 400);
  assert.equal(100 + context.effectiveStack, 500);
});

test("caps policy sizes at what a live opponent can match without calling it hero all-in", () => {
  const plan = evaluatePokerPolicy({
    ...baseSpot,
    street: "flop",
    pot: 300,
    toCall: 20,
    highestBet: 120,
    playerBet: 100,
    playerStack: 900,
    maxContestableTarget: 500,
    minRaise: 20,
    effectiveStackBb: 2,
    startingDepthBb: 20,
    equity: 0.86,
    handStrength: 0.9,
  });

  assert.equal(plan.maxTarget, 500);
  assert.ok(plan.raiseTo <= 500);
  assert.ok(plan.sizingRoutes.length > 0);
  assert.ok(plan.sizingRoutes.every((route) => route.target <= 500));
  assert.ok(plan.sizingRoutes.every((route) => route.allIn === false));
});

test("selects the preflop chart by hand-start depth, not chips left after betting", () => {
  const fives = { highRank: 5, lowRank: 5, pair: true, suited: false, gap: 0 };
  const spot = {
    ...baseSpot,
    street: "preflop",
    preflopHand: fives,
    preflopPercentile: 0.66,
    preflopPosition: "BTN",
    preflopOpenerPosition: "SB",
    preflopRaiseCount: 2,
    preflopPreviouslyRaised: true,
    pot: 140,
    toCall: 65,
    highestBet: 90,
    playerBet: 25,
    playerStack: 200,
    effectiveStackBb: 20,
  };
  const shallowStart = evaluatePokerPolicy({ ...spot, startingDepthBb: 40 });
  const deepStart = evaluatePokerPolicy({ ...spot, startingDepthBb: 200 });

  assert.notDeepEqual(shallowStart.actionFrequencies, deepStart.actionFrequencies);
  assert.ok(deepStart.preflopEnterFrequency > shallowStart.preflopEnterFrequency);
});

test("keeps chart depth separate from remaining-stack jam pressure", () => {
  const spot = {
    ...baseSpot,
    profile: { aggression: 0.7, looseness: 0.27, bluff: 0.12 },
    street: "preflop",
    preflopHand: { highRank: 5, lowRank: 5, pair: true, suited: false, gap: 0 },
    preflopPercentile: 0.66,
    preflopPosition: "BTN",
    preflopOpenerPosition: "SB",
    preflopRaiseCount: 2,
    preflopPreviouslyRaised: true,
    pot: 140,
    toCall: 65,
    highestBet: 90,
    playerBet: 25,
    playerStack: 975,
    startingDepthBb: 100,
  };
  const shortRemaining = evaluatePokerPolicy({ ...spot, effectiveStackBb: 30 });
  const deepRemaining = evaluatePokerPolicy({ ...spot, effectiveStackBb: 100 });

  assert.deepEqual(shortRemaining.actionFrequencies, deepRemaining.actionFrequencies);
  assert.ok(shortRemaining.shortStackJamFrequency > deepRemaining.shortStackJamFrequency);
  assert.ok(shortRemaining.spr < deepRemaining.spr);
});

test("excludes an oversized all-in wager the short caller cannot win", () => {
  const decisionPot = pokerContestablePotAtDecision(
    0,
    50,
    100,
    1_000,
    [
      { id: 0, contributed: 50, folded: false },
      { id: 1, contributed: 1_050, folded: false },
    ],
  );

  assert.deepEqual(decisionPot, {
    callCost: 100,
    currentPot: 200,
    finalPot: 300,
    layers: [{ amount: 300, opponentIds: [1] }],
  });

  const plan = evaluatePokerPolicy({
    ...baseSpot,
    equity: 0.2,
    pot: decisionPot.currentPot,
    toCall: 1_000,
    playerStack: 100,
    effectiveStackBb: 10,
    opponentsCanRespond: false,
    callEndsHand: true,
  });
  assert.ok(Math.abs(plan.realizationThreshold - 1 / 3) < 1e-12);
  assert.ok(plan.actionFrequencies.fold > 0.99);
  assert.ok(plan.actionFrequencies.call < 0.01);
});

test("splits a terminal decision into the opponent sets eligible for each side-pot layer", () => {
  const decisionPot = pokerContestablePotAtDecision(
    0,
    50,
    200,
    150,
    [
      { id: 0, contributed: 50, folded: false },
      { id: 1, contributed: 200, folded: false },
      { id: 2, contributed: 80, folded: false },
      { id: 3, contributed: 300, folded: true },
    ],
  );

  assert.equal(decisionPot.callCost, 150);
  assert.equal(decisionPot.currentPot, 530);
  assert.equal(decisionPot.finalPot, 680);
  assert.deepEqual(decisionPot.layers, [
    { amount: 320, opponentIds: [1, 2] },
    { amount: 360, opponentIds: [1] },
  ]);
});

test("uses direct chip EV when calling puts the player all-in even if opponents retain chips", () => {
  const plan = evaluatePokerPolicy({
    ...baseSpot,
    equity: 0.36,
    handStrength: 0.28,
    draw: 0.08,
    pot: 200,
    toCall: 1_000,
    playerStack: 100,
    highestBet: 1_000,
    effectiveStackBb: 10,
    opponentsCanRespond: true,
    callEndsHand: true,
    raiseLocked: false,
    boardWetness: 0.9,
  });

  assert.ok(Math.abs(plan.realizationThreshold - 1 / 3) < 1e-12);
  assert.ok(plan.actionFrequencies.call > plan.actionFrequencies.fold);
  assert.equal(plan.actionFrequencies.raise, 0);
});

test("closes an all-in caller's layers only after every funded opponent reaches them", () => {
  const hero = { id: 0, contributed: 100, folded: false, stack: 100 };
  const bettor = { id: 1, contributed: 1_000, folded: false, stack: 500 };
  const trailingPlayer = { id: 2, contributed: 100, folded: false, stack: 900 };

  assert.equal(pokerCallClosesContestableLayers(
    hero.id,
    hero.contributed,
    hero.stack,
    900,
    [hero, bettor],
  ), true);
  assert.equal(pokerCallClosesContestableLayers(
    hero.id,
    hero.contributed,
    hero.stack,
    900,
    [hero, bettor, trailingPlayer],
  ), false);
  assert.equal(pokerCallClosesContestableLayers(
    hero.id,
    hero.contributed,
    hero.stack,
    900,
    [hero, bettor, { ...trailingPlayer, contributed: 200 }],
  ), true);
  assert.equal(pokerCallClosesContestableLayers(
    hero.id,
    hero.contributed,
    hero.stack,
    900,
    [hero, bettor, { ...trailingPlayer, stack: 0 }],
  ), true);
});

test("uses chip-EV rather than opening ranges when a preflop call closes the hand", () => {
  const plan = evaluatePokerPolicy({
    ...baseSpot,
    street: "preflop",
    equity: 0.44,
    handStrength: 0.2,
    preflopPercentile: 0.15,
    pot: 840,
    toCall: 225,
    highestBet: 225,
    playerStack: 700,
    effectiveStackBb: 22.5,
    opponentsCanRespond: false,
    callEndsHand: true,
  });

  assert.ok(Math.abs(plan.realizationThreshold - 225 / 1_065) < 1e-12);
  assert.ok(plan.actionFrequencies.call > 0.99);
  assert.equal(plan.actionFrequencies.raise, 0);
});

test("uses direct showdown price but keeps a legal river value-raise branch", () => {
  const plan = evaluatePokerPolicy({
    ...baseSpot,
    street: "river",
    equity: 0.86,
    handStrength: 0.9,
    draw: 0,
    pot: 840,
    toCall: 225,
    highestBet: 225,
    playerStack: 700,
    effectiveStackBb: 70,
    opponentsCanRespond: true,
    callEndsHand: true,
  });

  assert.ok(Math.abs(plan.realizationThreshold - 225 / 1_065) < 1e-12);
  assert.ok(plan.actionFrequencies.raise > 0);
  assert.ok(plan.actionFrequencies.call + plan.actionFrequencies.raise > 0.99);
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
