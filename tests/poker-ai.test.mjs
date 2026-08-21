import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_PROFILES,
  adaptAiProfileToHeroImage,
  heroImageConfidence,
  heroNodePressure,
  heroPublicRangeTendency,
  sampleAiLineup,
  updateHeroTableImage,
} from "../lib/poker-ai.ts";
import { evaluatePokerPolicy } from "../lib/poker-policy.ts";

test("samples every AI seat independently and allows repeated styles", () => {
  const lineup = sampleAiLineup(5, () => 0);

  assert.equal(lineup.length, 5);
  assert.deepEqual(lineup.map((entry) => entry.styleKey), Array(5).fill("gto"));
  assert.notEqual(lineup[0], lineup[1]);
});

test("samples the full style range and handles an empty table", () => {
  assert.deepEqual(sampleAiLineup(3, () => 0.9999).map((entry) => entry.styleKey), ["nit", "nit", "nit"]);
  assert.deepEqual(sampleAiLineup(0, () => 0.5), []);
});

test("weights random lineups toward active opponents without removing any archetype", () => {
  const rolls = [0, 0.27, 0.51, 0.71, 0.99];
  assert.deepEqual(
    rolls.map((roll) => sampleAiLineup(1, () => roll)[0].styleKey),
    ["gto", "lag", "tag", "adaptive", "nit"],
  );
});

test("builds confidence gradually and keeps a mature hero image stable", () => {
  const confidences = [0, 12, 24, 100].map((observations) => heroImageConfidence({
    loose: 0.5,
    aggressive: 0.5,
    deceptive: 0.5,
    observations,
  }));
  assert.equal(confidences[0], 0);
  assert.ok(confidences.every((value, index) => index === 0 || value > confidences[index - 1]));
  assert.ok(confidences.at(-1) < 1);

  let image = { loose: 0.5, aggressive: 0.5, deceptive: 0.5, observations: 0 };
  for (let index = 0; index < 80; index += 1) image = updateHeroTableImage(image, { loose: 0.8, aggressive: 0.8 });
  const afterOneFold = updateHeroTableImage(image, { loose: 0.18, aggressive: 0.34 });
  assert.ok(image.loose - afterOneFold.loose < 0.05);
  assert.ok(image.aggressive - afterOneFold.aggressive < 0.05);
});

test("all endless opponents adapt without losing their base archetype", () => {
  const tightPassive = { loose: 0.18, aggressive: 0.2, deceptive: 0.35, observations: 120 };
  for (const styleKey of Object.keys(AI_PROFILES)) {
    const adapted = adaptAiProfileToHeroImage(styleKey, tightPassive, {
      heroActive: true,
      facingHero: false,
      intensity: 1.25,
    });
    assert.ok(adapted.aggression > AI_PROFILES[styleKey].aggression);
    assert.ok(adapted.bluff > AI_PROFILES[styleKey].bluff);
    assert.equal(adapted.pressureResponse, 0);
  }

  const lag = adaptAiProfileToHeroImage("lag", tightPassive, { heroActive: true, facingHero: true, intensity: 1.25 });
  const nit = adaptAiProfileToHeroImage("nit", tightPassive, { heroActive: true, facingHero: true, intensity: 1.25 });
  assert.ok(lag.aggression > nit.aggression);
  assert.ok(lag.looseness > nit.looseness);
  assert.ok(lag.bluff > nit.bluff);
});

test("ignores the hero after they fold and bounds profile counter-adjustments", () => {
  const looseAggressive = { loose: 0.9, aggressive: 0.92, deceptive: 0.82, observations: 200 };
  const inactive = adaptAiProfileToHeroImage("adaptive", looseAggressive, {
    heroActive: false,
    facingHero: true,
    intensity: 1.25,
  });
  assert.deepEqual(
    { aggression: inactive.aggression, looseness: inactive.looseness, bluff: inactive.bluff },
    AI_PROFILES.adaptive,
  );
  assert.equal(inactive.pressureResponse, 0);

  const active = adaptAiProfileToHeroImage("adaptive", looseAggressive, {
    heroActive: true,
    facingHero: true,
    intensity: 1.25,
  });
  assert.ok(active.looseness > AI_PROFILES.adaptive.looseness);
  assert.ok(active.aggression > AI_PROFILES.adaptive.aggression);
  for (const value of [active.aggression, active.looseness, active.bluff, active.confidence]) {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0 && value <= 1);
  }
});

test("repeated hero raises trigger wider defense instead of teaching every AI to fold", () => {
  let image = { loose: 0.5, aggressive: 0.5, deceptive: 0.5, observations: 0 };
  for (let index = 0; index < 40; index += 1) {
    image = updateHeroTableImage(image, { loose: 0.78, aggressive: 0.9 });
  }
  assert.ok(image.loose > 0.68);
  assert.ok(image.aggressive > 0.78);

  for (const styleKey of Object.keys(AI_PROFILES)) {
    const adapted = adaptAiProfileToHeroImage(styleKey, image, {
      heroActive: true,
      facingHero: true,
      intensity: 1.5,
    });
    assert.ok(adapted.looseness > AI_PROFILES[styleKey].looseness, `${styleKey} 应扩大防守范围`);
    assert.ok(adapted.aggression > AI_PROFILES[styleKey].aggression, `${styleKey} 应增加反加注压力`);
  }

  const counter = adaptAiProfileToHeroImage("adaptive", image, {
    heroActive: true,
    facingHero: true,
    intensity: 1.5,
  });
  const q4SuitedFacingButton = {
    profile: { ...AI_PROFILES.adaptive },
    street: "preflop",
    equity: 0.34,
    handStrength: 0.34,
    draw: 0,
    blockers: 0.03,
    pot: 40,
    toCall: 15,
    potOdds: 15 / 55,
    inPosition: false,
    activeOpponents: 1,
    opponentsCanRespond: true,
    callEndsHand: false,
    effectiveStackBb: 99,
    startingDepthBb: 100,
    highestBet: 25,
    playerBet: 10,
    playerStack: 990,
    maxContestableTarget: 1_000,
    minRaise: 15,
    raiseLocked: false,
    squidPressure: 0,
    bigBlind: 10,
    preflopPercentile: 0.55,
    preflopPosition: "BB",
    preflopPositionFactor: 1.35,
    preflopRaiseCount: 1,
    preflopOpenerPosition: "BTN",
    preflopLimpers: 0,
    preflopColdCallers: 0,
    preflopPreviouslyRaised: false,
    preflopHand: { highRank: 12, lowRank: 4, pair: false, suited: true, gap: 8 },
    boardWetness: 0,
    boardPairing: 0,
    boardHighCard: 0,
    initiative: false,
    streetRaiseCount: 1,
  };
  const baselinePlan = evaluatePokerPolicy(q4SuitedFacingButton);
  const counterPlan = evaluatePokerPolicy({
    ...q4SuitedFacingButton,
    profile: {
      aggression: counter.aggression,
      looseness: counter.looseness,
      bluff: counter.bluff,
    },
  });
  const baselineContinue = baselinePlan.actionFrequencies.call + baselinePlan.actionFrequencies.raise;
  const counterContinue = counterPlan.actionFrequencies.call + counterPlan.actionFrequencies.raise;
  assert.ok(counterContinue > baselineContinue + 0.04);
  assert.ok(counterPlan.actionFrequencies.raise > baselinePlan.actionFrequencies.raise);
});

test("reacts quickly to repeated pressure in the matching public node only", () => {
  let image = { loose: 0.5, aggressive: 0.5, deceptive: 0.5, observations: 0, pressure: {} };
  for (let index = 0; index < 5; index += 1) {
    image = updateHeroTableImage(
      image,
      { loose: 0.78, aggressive: 0.9 },
      { node: "preflop_open", aggressive: true },
    );
  }

  const openPressure = heroNodePressure(image, "preflop_open");
  assert.ok(openPressure > 0.4, `${openPressure} 应在五次连续开池后进入明显反制区`);
  assert.equal(heroNodePressure(image, "preflop_reraise"), 0);
  assert.equal(heroNodePressure(image, "postflop_bet"), 0);

  const adapted = adaptAiProfileToHeroImage("adaptive", image, {
    heroActive: true,
    facingHero: true,
    intensity: 1.05,
    pressureNode: "preflop_open",
  });
  const unrelated = adaptAiProfileToHeroImage("adaptive", image, {
    heroActive: true,
    facingHero: true,
    intensity: 1.05,
    pressureNode: "postflop_raise",
  });
  assert.ok(adapted.pressureResponse > 0.4);
  assert.ok(adapted.pressureResponse > unrelated.pressureResponse + 0.4);
  assert.ok(adapted.looseness > unrelated.looseness);
  assert.ok(adapted.aggression > unrelated.aggression);

  const tendency = heroPublicRangeTendency(image);
  assert.equal(tendency.preflopOpen, openPressure);
  assert.equal(tendency.preflopReraise, 0);

  const forcedDecision = updateHeroTableImage(
    image,
    { loose: 0.4, aggressive: 0.24 },
  );
  assert.equal(
    heroNodePressure(forcedDecision, "preflop_open"),
    openPressure,
    "没有合法加注权的强制决定不能冷却该节点",
  );

  let cooled = image;
  for (let index = 0; index < 3; index += 1) {
    cooled = updateHeroTableImage(
      cooled,
      { loose: 0.4, aggressive: 0.24 },
      { node: "preflop_open", aggressive: false },
    );
  }
  assert.ok(heroNodePressure(cooled, "preflop_open") < openPressure * 0.25);
});
