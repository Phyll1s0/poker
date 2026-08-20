import assert from "node:assert/strict";
import test from "node:test";

import {
  PREFLOP_HAND_CLASSES,
  PREFLOP_POSITIONS,
  encodePreflopHandClass,
  getPreflopStrategy,
  preflopComboCount,
  summarizePreflopRange,
} from "../lib/poker-preflop.ts";

function total(frequencies) {
  return Object.values(frequencies).reduce((sum, value) => sum + value, 0);
}

test("encodes all 169 hand classes with the correct 1,326 combo weights", () => {
  assert.equal(PREFLOP_HAND_CLASSES.length, 169);
  assert.equal(new Set(PREFLOP_HAND_CLASSES).size, 169);
  assert.equal(PREFLOP_HAND_CLASSES.reduce((sum, hand) => sum + preflopComboCount(hand), 0), 1326);
  assert.equal(encodePreflopHandClass(14, 5, true), "A5s");
  assert.equal(encodePreflopHandClass("5", "A", false), "A5o");
  assert.equal(encodePreflopHandClass("Q", "Q"), "QQ");
});

test("every published strategy is legal, normalized and bounded", () => {
  const scenarios = ["rfi", "vs-open", "vs-three-bet", "vs-four-bet"];
  for (const scenario of scenarios) {
    for (const heroPosition of PREFLOP_POSITIONS) {
      for (const hand of PREFLOP_HAND_CLASSES) {
        const strategy = getPreflopStrategy({
          hand,
          scenario,
          heroPosition,
          aggressorPosition: "BTN",
          effectiveStackBb: 100,
        });
        assert.ok(Math.abs(total(strategy.frequencies) - 1) < 1e-12);
        for (const frequency of Object.values(strategy.frequencies)) assert.ok(frequency >= 0 && frequency <= 1);
        assert.ok(Math.abs(strategy.enterFrequency - strategy.frequencies.call - strategy.frequencies.raise) < 1e-12);
      }
    }
  }
});

test("fixes canonical RFI errors for small pairs and early offsuit broadways", () => {
  const buttonDeuces = getPreflopStrategy({ hand: "22", scenario: "rfi", heroPosition: "BTN" });
  const cutoffDeuces = getPreflopStrategy({ hand: "22", scenario: "rfi", heroPosition: "CO" });
  const utgKingJack = getPreflopStrategy({ hand: "KJo", scenario: "rfi", heroPosition: "UTG" });
  const utgQueenJack = getPreflopStrategy({ hand: "QJo", scenario: "rfi", heroPosition: "UTG" });

  assert.ok(buttonDeuces.frequencies.raise >= 0.95);
  assert.ok(cutoffDeuces.frequencies.raise >= 0.9);
  assert.ok(utgKingJack.enterFrequency <= 0.1);
  assert.ok(utgQueenJack.enterFrequency <= 0.1);
});

test("big blind continues pocket deuces at high frequency against a button open", () => {
  const strategy = getPreflopStrategy({
    hand: "22",
    scenario: "vs-open",
    heroPosition: "BB",
    aggressorPosition: "BTN",
    effectiveStackBb: 100,
    facingSizeBb: 2.5,
  });
  assert.ok(strategy.enterFrequency >= 0.9, JSON.stringify(strategy));
  assert.ok(strategy.frequencies.call > strategy.frequencies.raise);
});

test("ace-five suited retains both three-bet and four-bet bluff branches", () => {
  const threeBet = getPreflopStrategy({
    hand: "A5s",
    scenario: "vs-open",
    heroPosition: "SB",
    aggressorPosition: "BTN",
    effectiveStackBb: 100,
    facingSizeBb: 2.5,
  });
  const fourBet = getPreflopStrategy({
    hand: "A5s",
    scenario: "vs-three-bet",
    heroPosition: "BTN",
    aggressorPosition: "SB",
    effectiveStackBb: 100,
    facingSizeBb: 9,
  });
  assert.ok(threeBet.raiseFrequency >= 0.25, JSON.stringify(threeBet));
  assert.ok(fourBet.raiseFrequency >= 0.1, JSON.stringify(fourBet));
});

test("aces always remain a high-frequency value raise", () => {
  for (const scenario of ["rfi", "vs-open", "vs-three-bet", "vs-four-bet"]) {
    for (const effectiveStackBb of [20, 40, 100, 200, 400]) {
      const strategy = getPreflopStrategy({
        hand: "AA",
        scenario,
        heroPosition: scenario === "rfi" ? "UTG" : "BB",
        aggressorPosition: "BTN",
        effectiveStackBb,
      });
      assert.ok(strategy.enterFrequency >= 0.995, `${scenario}/${effectiveStackBb}`);
      assert.ok(strategy.raiseFrequency >= 0.85, `${scenario}/${effectiveStackBb}`);
    }
  }
});

test("non-ace premiums respond to an extreme all-in price instead of being force-continued", () => {
  for (const hand of ["KK", "QQ", "AKs", "AKo"]) {
    const byDepth = [40, 100, 200, 400].map((effectiveStackBb) => getPreflopStrategy({
      hand,
      scenario: "vs-four-bet",
      heroPosition: "BTN",
      aggressorPosition: "SB",
      effectiveStackBb,
      facingSizeBb: effectiveStackBb,
    }).enterFrequency);
    for (let index = 1; index < byDepth.length; index += 1) {
      assert.ok(byDepth[index] < byDepth[index - 1], `${hand}: ${byDepth.join(", ")}`);
    }
    assert.ok(byDepth.at(-1) < 0.9, `${hand} at 400BB: ${byDepth.at(-1)}`);
  }

  const aces = getPreflopStrategy({
    hand: "AA",
    scenario: "vs-four-bet",
    heroPosition: "BTN",
    aggressorPosition: "SB",
    effectiveStackBb: 400,
    facingSizeBb: 400,
  });
  assert.equal(aces.enterFrequency, 1);
});

test("larger opens tighten defense continuously and deeper stacks help speculative hands", () => {
  const sizes = [2, 2.5, 3, 4].map((facingSizeBb) => getPreflopStrategy({
    hand: "76s",
    scenario: "vs-open",
    heroPosition: "BB",
    aggressorPosition: "BTN",
    effectiveStackBb: 100,
    facingSizeBb,
  }).enterFrequency);
  for (let index = 1; index < sizes.length; index += 1) assert.ok(sizes[index] < sizes[index - 1]);

  const shallow = getPreflopStrategy({ hand: "55", scenario: "vs-three-bet", heroPosition: "BTN", aggressorPosition: "SB", effectiveStackBb: 40 }).enterFrequency;
  const deep = getPreflopStrategy({ hand: "55", scenario: "vs-three-bet", heroPosition: "BTN", aggressorPosition: "SB", effectiveStackBb: 200 }).enterFrequency;
  assert.ok(deep > shallow);
});

test("combo-weighted range summaries are normalized and position ordered", () => {
  const utg = summarizePreflopRange({ scenario: "rfi", heroPosition: "UTG" });
  const cutoff = summarizePreflopRange({ scenario: "rfi", heroPosition: "CO" });
  const button = summarizePreflopRange({ scenario: "rfi", heroPosition: "BTN" });
  for (const summary of [utg, cutoff, button]) {
    assert.ok(Math.abs(total(summary.frequencies) - 1) < 1e-12);
    assert.ok(Math.abs(summary.foldCombos + summary.checkCombos + summary.callCombos + summary.raiseCombos - 1326) < 1e-8);
    assert.ok(Math.abs(summary.enterCombos / 1326 - summary.enterFrequency) < 1e-12);
  }
  assert.ok(utg.enterFrequency < cutoff.enterFrequency);
  assert.ok(cutoff.enterFrequency < button.enterFrequency);
  assert.ok(utg.enterFrequency > 0.12 && utg.enterFrequency < 0.24);
  assert.ok(button.enterFrequency > 0.4 && button.enterFrequency < 0.65);
});
