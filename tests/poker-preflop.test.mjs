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

function rfiWeightedThreeBetResponse(heroPosition, aggressorPosition, facingSizeBb = 9) {
  const weighted = { fold: 0, check: 0, call: 0, raise: 0 };
  let openingWeight = 0;
  for (const hand of PREFLOP_HAND_CLASSES) {
    const combos = preflopComboCount(hand);
    const open = getPreflopStrategy({
      hand,
      scenario: "rfi",
      heroPosition,
      effectiveStackBb: 100,
    }).frequencies.raise;
    const weight = combos * open;
    openingWeight += weight;
    const response = getPreflopStrategy({
      hand,
      scenario: "vs-three-bet",
      heroPosition,
      aggressorPosition,
      effectiveStackBb: 100,
      facingSizeBb,
    }).frequencies;
    for (const action of Object.keys(weighted)) weighted[action] += weight * response[action];
  }
  return Object.fromEntries(
    Object.entries(weighted).map(([action, value]) => [action, value / openingWeight]),
  );
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
  const cutoffQueenNineOffsuit = getPreflopStrategy({ hand: "Q9o", scenario: "rfi", heroPosition: "CO" });
  const buttonQueenNineOffsuit = getPreflopStrategy({ hand: "Q9o", scenario: "rfi", heroPosition: "BTN" });
  const utgKingJack = getPreflopStrategy({ hand: "KJo", scenario: "rfi", heroPosition: "UTG" });
  const utgQueenJack = getPreflopStrategy({ hand: "QJo", scenario: "rfi", heroPosition: "UTG" });

  assert.ok(buttonDeuces.frequencies.raise >= 0.95);
  assert.ok(cutoffDeuces.frequencies.raise >= 0.9);
  assert.equal(cutoffQueenNineOffsuit.frequencies.fold, 1);
  assert.equal(cutoffQueenNineOffsuit.enterFrequency, 0);
  assert.ok(buttonQueenNineOffsuit.frequencies.raise >= 0.7);
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

test("ace-ten shifts calls into three-bets only in late-position steal nodes", () => {
  const strategy = (hand, heroPosition, aggressorPosition, effectiveStackBb = 100) => getPreflopStrategy({
    hand,
    scenario: "vs-open",
    heroPosition,
    aggressorPosition,
    effectiveStackBb,
    facingSizeBb: 2.5,
  });

  const earlyOffsuit = strategy("ATo", "HJ", "UTG");
  const buttonOffsuit = strategy("ATo", "BTN", "CO");
  const smallBlindOffsuit = strategy("ATo", "SB", "BTN");
  const smallBlindSuited = strategy("ATs", "SB", "BTN");
  const bigBlindSuited = strategy("ATs", "BB", "BTN");

  assert.ok(earlyOffsuit.frequencies.fold >= 0.8, JSON.stringify(earlyOffsuit));
  assert.ok(earlyOffsuit.raiseFrequency <= 0.04, JSON.stringify(earlyOffsuit));
  assert.ok(buttonOffsuit.raiseFrequency >= 0.2, JSON.stringify(buttonOffsuit));
  assert.ok(smallBlindOffsuit.raiseFrequency >= 0.4, JSON.stringify(smallBlindOffsuit));
  assert.ok(smallBlindOffsuit.frequencies.raise > smallBlindOffsuit.frequencies.call);
  assert.ok(smallBlindSuited.raiseFrequency >= 0.65, JSON.stringify(smallBlindSuited));
  assert.ok(bigBlindSuited.raiseFrequency >= 0.27, JSON.stringify(bigBlindSuited));

  const shallow = strategy("ATo", "SB", "BTN", 40);
  const standard = strategy("ATo", "SB", "BTN", 100);
  const deep = strategy("ATo", "SB", "BTN", 200);
  assert.ok(shallow.raiseFrequency > standard.raiseFrequency);
  assert.ok(standard.raiseFrequency > deep.raiseFrequency);

  const facingFourBet = getPreflopStrategy({
    hand: "ATo",
    scenario: "vs-four-bet",
    heroPosition: "BTN",
    aggressorPosition: "SB",
    effectiveStackBb: 100,
    facingSizeBb: 22,
  });
  assert.equal(facingFourBet.frequencies.fold, 1, "正常 3-bet 节点的调整不得污染面对 4-bet 的纯弃牌");
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

test("button opening range does not massively over-fold to a standard small-blind three-bet", () => {
  const standard = rfiWeightedThreeBetResponse("BTN", "SB", 9);
  assert.ok(standard.fold >= 0.5 && standard.fold <= 0.62, JSON.stringify(standard));
  assert.ok(standard.call >= 0.27 && standard.call <= 0.42, JSON.stringify(standard));
  assert.ok(standard.raise >= 0.08 && standard.raise <= 0.16, JSON.stringify(standard));
  assert.ok(standard.call > standard.raise, JSON.stringify(standard));
  assert.ok(Math.abs(total(standard) - 1) < 1e-12);

  const larger = rfiWeightedThreeBetResponse("BTN", "SB", 12);
  assert.ok(larger.fold > standard.fold + 0.015, `${standard.fold} -> ${larger.fold}`);

  const cutoffOutOfPosition = rfiWeightedThreeBetResponse("CO", "BTN", 9);
  const conditionalFourBet = cutoffOutOfPosition.raise
    / (cutoffOutOfPosition.call + cutoffOutOfPosition.raise);
  assert.ok(
    cutoffOutOfPosition.fold >= 0.5 && cutoffOutOfPosition.fold <= 0.62,
    JSON.stringify(cutoffOutOfPosition),
  );
  assert.ok(
    conditionalFourBet >= 0.3 && conditionalFourBet <= 0.48,
    JSON.stringify(cutoffOutOfPosition),
  );
});

test("an oversized three-bet shove uses a stack-off range instead of the 9BB defense tree", () => {
  const shoved = rfiWeightedThreeBetResponse("BTN", "SB", 100);
  assert.ok(shoved.call + shoved.raise >= 0.03, JSON.stringify(shoved));
  assert.ok(shoved.call + shoved.raise <= 0.065, JSON.stringify(shoved));

  const sizes = [9, 12, 25, 50, 100].map((size) => {
    const response = rfiWeightedThreeBetResponse("BTN", "SB", size);
    return response.call + response.raise;
  });
  for (let index = 1; index < sizes.length; index += 1) {
    assert.ok(sizes[index] < sizes[index - 1], sizes.join(", "));
  }
  const belowBoundary = rfiWeightedThreeBetResponse("BTN", "SB", 11.99);
  const aboveBoundary = rfiWeightedThreeBetResponse("BTN", "SB", 12.01);
  assert.ok(
    Math.abs(
      belowBoundary.call + belowBoundary.raise - aboveBoundary.call - aboveBoundary.raise,
    ) < 0.002,
  );

  const enter = (hand) => getPreflopStrategy({
    hand,
    scenario: "vs-three-bet",
    heroPosition: "BTN",
    aggressorPosition: "SB",
    effectiveStackBb: 100,
    facingSizeBb: 100,
  }).enterFrequency;
  assert.equal(enter("AA"), 1);
  assert.ok(enter("KK") >= 0.95);
  assert.ok(enter("QQ") >= 0.5 && enter("QQ") <= 0.85);
  assert.ok(enter("AKs") >= 0.8);
  assert.ok(enter("AKo") >= 0.45 && enter("AKo") <= 0.8);
  assert.ok(enter("JJ") <= 0.12);
  assert.ok(enter("AQs") <= 0.12);
  for (const hand of ["A5s", "KJs", "QJs", "JTs", "T9s"]) {
    assert.ok(enter(hand) <= 0.02, `${hand}: ${enter(hand)}`);
  }

  const coreHands = new Set(["AA", "KK", "QQ", "AKs", "AKo"]);
  let totalContinueWeight = 0;
  let coreContinueWeight = 0;
  for (const hand of PREFLOP_HAND_CLASSES) {
    const openingWeight = preflopComboCount(hand) * getPreflopStrategy({
      hand,
      scenario: "rfi",
      heroPosition: "BTN",
    }).frequencies.raise;
    const continueWeight = openingWeight * enter(hand);
    totalContinueWeight += continueWeight;
    if (coreHands.has(hand)) coreContinueWeight += continueWeight;
  }
  assert.ok(coreContinueWeight / totalContinueWeight >= 0.95);
});

test("uses position-paired no-rake defense ranges instead of one universally tight chart", () => {
  const summary = (heroPosition, aggressorPosition, facingSizeBb = 2.5) => summarizePreflopRange({
    scenario: "vs-open",
    heroPosition,
    aggressorPosition,
    effectiveStackBb: 100,
    facingSizeBb,
  });
  const bbUtg = summary("BB", "UTG");
  const bbCo = summary("BB", "CO");
  const bbBtn = summary("BB", "BTN");
  const sbBtn = summary("SB", "BTN");

  assert.ok(bbUtg.enterFrequency >= 0.26 && bbUtg.enterFrequency <= 0.35);
  assert.ok(bbCo.enterFrequency >= 0.38 && bbCo.enterFrequency <= 0.48);
  assert.ok(bbBtn.enterFrequency >= 0.45 && bbBtn.enterFrequency <= 0.56);
  assert.ok(sbBtn.enterFrequency >= 0.18 && sbBtn.enterFrequency <= 0.28);
  assert.ok(bbUtg.enterFrequency < bbCo.enterFrequency);
  assert.ok(bbCo.enterFrequency < bbBtn.enterFrequency);
  assert.ok(bbBtn.enterFrequency - sbBtn.enterFrequency >= 0.18);
  assert.ok(bbBtn.enterFrequency - summary("BB", "BTN", 4).enterFrequency >= 0.07);
  assert.ok(summary("BB", "BTN", 6).enterFrequency < 0.28);
  assert.ok(summary("BB", "SB", 6).enterFrequency < 0.3);

  const strategy = (hand, aggressorPosition = "BTN") => getPreflopStrategy({
    hand,
    scenario: "vs-open",
    heroPosition: "BB",
    aggressorPosition,
    effectiveStackBb: 100,
    facingSizeBb: 2.5,
  });
  assert.ok(strategy("K7o").enterFrequency > 0);
  assert.ok(strategy("86o").enterFrequency > 0);
  assert.ok(strategy("K7o").enterFrequency > strategy("K7o", "UTG").enterFrequency);
  assert.equal(strategy("T7o", "UTG").enterFrequency, 0);
  assert.equal(strategy("86o", "UTG").enterFrequency, 0);
  assert.ok(strategy("Q4s").enterFrequency > strategy("86o").enterFrequency);
  assert.ok(strategy("Q4s").enterFrequency > strategy("54o").enterFrequency);
  assert.ok(strategy("55").enterFrequency >= strategy("22").enterFrequency);
  assert.equal(strategy("72o").enterFrequency, 0);
  assert.equal(strategy("AA").enterFrequency, 1);
});
