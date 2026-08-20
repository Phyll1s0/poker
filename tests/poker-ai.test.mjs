import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_PROFILES,
  adaptAiProfileToHeroImage,
  heroImageConfidence,
  sampleAiLineup,
  updateHeroTableImage,
} from "../lib/poker-ai.ts";

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
    assert.equal(adapted.equityAdjustment, 0);
  }

  const lag = adaptAiProfileToHeroImage("lag", tightPassive, { heroActive: true, facingHero: true, intensity: 1.25 });
  const nit = adaptAiProfileToHeroImage("nit", tightPassive, { heroActive: true, facingHero: true, intensity: 1.25 });
  assert.ok(lag.aggression > nit.aggression);
  assert.ok(lag.looseness > nit.looseness);
  assert.ok(lag.bluff > nit.bluff);
});

test("ignores the hero after they fold and bounds direct counter-adjustments", () => {
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
  assert.equal(inactive.equityAdjustment, 0);

  const active = adaptAiProfileToHeroImage("adaptive", looseAggressive, {
    heroActive: true,
    facingHero: true,
    intensity: 1.25,
  });
  assert.ok(active.equityAdjustment > 0);
  assert.ok(active.equityAdjustment <= 0.04);
  for (const value of [active.aggression, active.looseness, active.bluff, active.confidence]) {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0 && value <= 1.25);
  }
});
