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
  const scenarios = ["rfi", "vs-limp", "vs-open", "vs-three-bet", "vs-four-bet"];
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

test("uses coherent nested RFI boundaries for small pairs and offsuit broadways", () => {
  const buttonDeuces = getPreflopStrategy({ hand: "22", scenario: "rfi", heroPosition: "BTN" });
  const cutoffDeuces = getPreflopStrategy({ hand: "22", scenario: "rfi", heroPosition: "CO" });
  const cutoffQueenNineOffsuit = getPreflopStrategy({ hand: "Q9o", scenario: "rfi", heroPosition: "CO" });
  const buttonQueenNineOffsuit = getPreflopStrategy({ hand: "Q9o", scenario: "rfi", heroPosition: "BTN" });
  const utgKingJack = getPreflopStrategy({ hand: "KJo", scenario: "rfi", heroPosition: "UTG" });
  const utgQueenJack = getPreflopStrategy({ hand: "QJo", scenario: "rfi", heroPosition: "UTG" });
  const utgKingQueen = getPreflopStrategy({ hand: "KQo", scenario: "rfi", heroPosition: "UTG" });

  assert.ok(buttonDeuces.frequencies.raise >= 0.95);
  assert.ok(cutoffDeuces.frequencies.raise >= 0.9);
  assert.ok(cutoffQueenNineOffsuit.enterFrequency >= 0.7);
  assert.ok(buttonQueenNineOffsuit.enterFrequency >= cutoffQueenNineOffsuit.enterFrequency);
  assert.ok(utgKingQueen.enterFrequency >= 0.9);
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
  assert.ok(bbBtn.enterFrequency >= 0.54 && bbBtn.enterFrequency <= 0.62);
  assert.ok(sbBtn.enterFrequency >= 0.18 && sbBtn.enterFrequency <= 0.280001);
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
  assert.ok(strategy("T7o", "UTG").enterFrequency <= 0.005);
  assert.ok(strategy("86o", "UTG").enterFrequency <= 0.005);
  assert.ok(strategy("Q4s").enterFrequency > strategy("86o").enterFrequency);
  assert.ok(strategy("Q4s").enterFrequency > strategy("54o").enterFrequency);
  assert.ok(strategy("55").enterFrequency >= strategy("22").enterFrequency);
  assert.equal(strategy("72o").enterFrequency, 0);
  assert.equal(strategy("AA").enterFrequency, 1);
});

test("matches public 100BB chip-EV big-blind size anchors by action", () => {
  const anchors = {
    UTG: {
      2: { fold: 0.423, call: 0.535, raise: 0.042 },
      2.5: { fold: 0.673, call: 0.274, raise: 0.054 },
      3: { fold: 0.778, call: 0.168, raise: 0.054 },
    },
    BTN: {
      2: { fold: 0.213, call: 0.681, raise: 0.106 },
      2.5: { fold: 0.425, call: 0.455, raise: 0.12 },
      3: { fold: 0.592, call: 0.276, raise: 0.132 },
    },
  };
  for (const [aggressorPosition, bySize] of Object.entries(anchors)) {
    let previousCall = Infinity;
    let previousRaise = 0;
    for (const facingSizeBb of [2, 2.5, 3]) {
      const expected = bySize[facingSizeBb];
      const actual = summarizePreflopRange({
        scenario: "vs-open",
        heroPosition: "BB",
        aggressorPosition,
        effectiveStackBb: 100,
        facingSizeBb,
      }).frequencies;
      for (const action of ["fold", "call", "raise"]) {
        assert.ok(Math.abs(actual[action] - expected[action]) <= 0.008, `${aggressorPosition}/${facingSizeBb}/${action}: ${actual[action]}`);
      }
      assert.ok(actual.call < previousCall);
      assert.ok(actual.raise + 0.002 >= previousRaise);
      previousCall = actual.call;
      previousRaise = actual.raise;
    }
  }
});

test("makes standard open defense stack-aware without moving the public 100BB anchor", () => {
  const summarize = (effectiveStackBb, aggressorPosition = "BTN") => summarizePreflopRange({
    scenario: "vs-open",
    heroPosition: "BB",
    aggressorPosition,
    effectiveStackBb,
    facingSizeBb: 2.5,
  }).frequencies;
  const ten = summarize(10);
  const twenty = summarize(20);
  const forty = summarize(40);
  const hundred = summarize(100);
  const twoHundred = summarize(200);

  assert.ok(ten.raise > twenty.raise && twenty.raise > forty.raise && forty.raise > hundred.raise);
  assert.ok(hundred.raise > twoHundred.raise);
  assert.ok(ten.call < hundred.call && hundred.call < twoHundred.call);
  assert.ok(ten.call + ten.raise > hundred.call + hundred.raise);
  assert.ok(Math.abs(hundred.fold - 0.425) <= 0.008);
  assert.ok(Math.abs(hundred.call - 0.455) <= 0.008);
  assert.ok(Math.abs(hundred.raise - 0.12) <= 0.008);

  const tightTen = summarize(10, "UTG");
  const tightHundred = summarize(100, "UTG");
  assert.ok(tightTen.raise > tightHundred.raise + 0.02);
  assert.ok(tightTen.call + tightTen.raise < ten.call + ten.raise - 0.2);
});

test("matches the published 200BB unraked big-blind versus first-position anchors", () => {
  const anchors = {
    2: { fold: 0.453, call: 0.519, raise: 0.028 },
    2.5: { fold: 0.675, call: 0.288, raise: 0.037 },
    3: { fold: 0.772, call: 0.189, raise: 0.039 },
  };
  for (const facingSizeBb of [2, 2.5, 3]) {
    const actual = summarizePreflopRange({
      scenario: "vs-open",
      heroPosition: "BB",
      aggressorPosition: "UTG",
      effectiveStackBb: 200,
      facingSizeBb,
    }).frequencies;
    for (const action of ["fold", "call", "raise"]) {
      assert.ok(
        Math.abs(actual[action] - anchors[facingSizeBb][action]) <= 0.008,
        `${facingSizeBb}/${action}: ${actual[action]}`,
      );
    }
  }
});

test("oversized opens tighten monotonically into a depth-aware stack-off range", () => {
  const range = (effectiveStackBb, aggressorPosition = "BTN", facingSizeBb = effectiveStackBb) => (
    summarizePreflopRange({
      scenario: "vs-open",
      heroPosition: "BB",
      aggressorPosition,
      effectiveStackBb,
      facingSizeBb,
    }).enterFrequency
  );
  const lateJams = [10, 20, 40, 100, 200].map((depth) => range(depth));
  for (let index = 1; index < lateJams.length; index += 1) {
    assert.ok(lateJams[index] < lateJams[index - 1], lateJams.join(", "));
  }
  assert.ok(lateJams[0] >= 0.22 && lateJams[0] <= 0.28, lateJams[0]);
  assert.ok(lateJams[3] >= 0.025 && lateJams[3] <= 0.04, lateJams[3]);
  assert.ok(range(10, "UTG") < range(10, "BTN") - 0.07);

  for (const depth of [10, 20, 40, 100, 200]) {
    for (const hand of PREFLOP_HAND_CLASSES) {
      const sizes = [3, 4, 6, 10, 20, 40, 100, 200].filter((size) => size <= depth);
      let previous = Infinity;
      for (const facingSizeBb of sizes) {
        const current = getPreflopStrategy({
          hand,
          scenario: "vs-open",
          heroPosition: "BB",
          aggressorPosition: "BTN",
          effectiveStackBb: depth,
          facingSizeBb,
        }).enterFrequency;
        assert.ok(current <= previous + 1e-9, `${depth}BB ${hand} @ ${facingSizeBb}: ${previous} -> ${current}`);
        previous = current;
      }
    }
  }

  const stackOff = (hand, effectiveStackBb = 100) => getPreflopStrategy({
    hand,
    scenario: "vs-open",
    heroPosition: "BB",
    aggressorPosition: "BTN",
    effectiveStackBb,
    facingSizeBb: effectiveStackBb,
  }).enterFrequency;
  assert.equal(stackOff("AA"), 1);
  assert.ok(stackOff("KK") > stackOff("AKs"));
  assert.ok(stackOff("AKs") > stackOff("QQ"));
  assert.ok(stackOff("QQ") > stackOff("AKo"));
  assert.ok(stackOff("AKo") > stackOff("JJ"));
  assert.ok(stackOff("22") <= 0.005, stackOff("22"));
  assert.equal(stackOff("76s"), 0);
});

test("the ordinary-open to oversized-open boundary is continuous at every stack depth", () => {
  for (const effectiveStackBb of [10, 20, 100]) {
    for (const hand of ["AA", "AKo", "TT", "A5s", "76s", "22"]) {
      const values = [2.99, 3, 3.01].map((facingSizeBb) => getPreflopStrategy({
        hand,
        scenario: "vs-open",
        heroPosition: "BB",
        aggressorPosition: "BTN",
        effectiveStackBb,
        facingSizeBb,
      }).enterFrequency);
      assert.ok(Math.abs(values[1] - values[0]) <= 0.02, `${effectiveStackBb}/${hand}: ${values}`);
      assert.ok(Math.abs(values[2] - values[1]) <= 0.02, `${effectiveStackBb}/${hand}: ${values}`);
    }
  }
});

test("standard open-size calibration is monotone with a two-point Lipschitz bound", () => {
  const positionPairs = [
    ["BB", "UTG"],
    ["BB", "BTN"],
    ["BB", "SB"],
    ["SB", "BTN"],
    ["BTN", "HJ"],
  ];
  for (const effectiveStackBb of [10, 20, 40]) {
    for (const [heroPosition, aggressorPosition] of positionPairs) {
      for (const hand of PREFLOP_HAND_CLASSES) {
        let previous = null;
        for (let hundredths = 200; hundredths <= 300; hundredths += 1) {
          const facingSizeBb = hundredths / 100;
          const frequencies = getPreflopStrategy({
            hand,
            scenario: "vs-open",
            heroPosition,
            aggressorPosition,
            effectiveStackBb,
            facingSizeBb,
          }).frequencies;
          const current = frequencies.call + frequencies.raise;
          assert.equal(frequencies.check, 0);
          assert.ok(Object.values(frequencies).every((frequency) => Number.isFinite(frequency) && frequency >= 0 && frequency <= 1));
          assert.ok(Math.abs(total(frequencies) - 1) <= 1e-12);
          if (previous !== null) {
            assert.ok(
              current <= previous.enter + 1e-12,
              `${effectiveStackBb}BB ${heroPosition}-${aggressorPosition} ${hand}/${facingSizeBb}: ${previous} -> ${current}`,
            );
            for (const action of ["fold", "call", "raise"]) {
              assert.ok(
                Math.abs(frequencies[action] - previous.frequencies[action]) <= 0.020000001,
                `${effectiveStackBb}BB ${heroPosition}-${aggressorPosition} ${hand}/${facingSizeBb}/${action}`,
              );
            }
          }
          if (hand === "72o") {
            assert.deepEqual(frequencies, { fold: 1, check: 0, call: 0, raise: 0 });
          }
          previous = { enter: current, frequencies };
        }
      }
    }
  }
});

test("big-blind hand and aggregate actions linearly interpolate published size anchors", () => {
  for (const effectiveStackBb of [10, 20, 40, 100, 200]) {
    for (const aggressorPosition of ["UTG", "HJ", "CO", "BTN", "SB"]) {
      for (const [lowerSize, upperSize] of [[2, 2.5], [2.5, 3]]) {
        const lowerSummary = summarizePreflopRange({
          scenario: "vs-open", heroPosition: "BB", aggressorPosition, effectiveStackBb, facingSizeBb: lowerSize,
        });
        const upperSummary = summarizePreflopRange({
          scenario: "vs-open", heroPosition: "BB", aggressorPosition, effectiveStackBb, facingSizeBb: upperSize,
        });
        for (const facingSizeBb of [lowerSize + 0.1, lowerSize + 0.25, lowerSize + 0.4]) {
          const progress = (facingSizeBb - lowerSize) / (upperSize - lowerSize);
          const actualSummary = summarizePreflopRange({
            scenario: "vs-open", heroPosition: "BB", aggressorPosition, effectiveStackBb, facingSizeBb,
          });
          for (const action of ["call", "raise"]) {
            const expected = lowerSummary.frequencies[action]
              + (upperSummary.frequencies[action] - lowerSummary.frequencies[action]) * progress;
            assert.ok(Math.abs(actualSummary.frequencies[action] - expected) <= 1e-10);
          }
          for (const hand of ["AA", "ATo", "96s", "J3s", "74o", "72o"]) {
            const at = (size) => getPreflopStrategy({
              hand, scenario: "vs-open", heroPosition: "BB", aggressorPosition, effectiveStackBb, facingSizeBb: size,
            }).frequencies;
            const lower = at(lowerSize);
            const upper = at(upperSize);
            const actual = at(facingSizeBb);
            for (const action of ["fold", "call", "raise"]) {
              const expected = lower[action] + (upper[action] - lower[action]) * progress;
              assert.ok(Math.abs(actual[action] - expected) <= 1e-10);
            }
          }
        }
      }
    }
  }
});

test("cheap-open support remains smooth for deep in-position and shallow blind defenses", () => {
  for (const query of [
    { hand: "Q8s", heroPosition: "BTN", aggressorPosition: "HJ", effectiveStackBb: 200 },
    { hand: "J3s", heroPosition: "BB", aggressorPosition: "UTG", effectiveStackBb: 20 },
  ]) {
    let previous = null;
    for (let hundredths = 200; hundredths <= 300; hundredths += 1) {
      const facingSizeBb = hundredths / 100;
      const current = getPreflopStrategy({
        ...query,
        scenario: "vs-open",
        facingSizeBb,
      }).enterFrequency;
      if (previous !== null) {
        assert.ok(Math.abs(current - previous) <= 0.04, `${JSON.stringify(query)}/${facingSizeBb}: ${previous} -> ${current}`);
      }
      previous = current;
    }
  }
});

test("rounded calibration keys do not make results depend on query order", async () => {
  const nearFirstModule = await import("../lib/poker-preflop.ts?cache-order=near-first");
  const exactFirstModule = await import("../lib/poker-preflop.ts?cache-order=exact-first");
  const query = (module, effectiveStackBb, facingSizeBb) => module.getPreflopStrategy({
    hand: "KJs",
    scenario: "vs-open",
    heroPosition: "BB",
    aggressorPosition: "BTN",
    effectiveStackBb,
    facingSizeBb,
  }).frequencies;
  query(nearFirstModule, 40.004, 2.504);
  const afterNearbyQuery = query(nearFirstModule, 40, 2.5);
  const exactBeforeNearby = query(exactFirstModule, 40, 2.5);
  query(exactFirstModule, 40.004, 2.504);
  assert.deepEqual(afterNearbyQuery, exactBeforeNearby);
});

test("separates opener, squeezed caller and cold-entry responses to a 3-bet", () => {
  const response = (hand, responseRole) => getPreflopStrategy({
    hand,
    scenario: "vs-three-bet",
    heroPosition: "BTN",
    aggressorPosition: "CO",
    responseRole,
    effectiveStackBb: 100,
    facingSizeBb: 9,
  });
  for (const hand of ["76s", "22"]) {
    const opener = response(hand, "opener").enterFrequency;
    const caller = response(hand, "cold-caller").enterFrequency;
    const cold = response(hand, "cold-entry").enterFrequency;
    assert.ok(opener > caller + 0.2, `${hand}: ${opener}/${caller}/${cold}`);
    assert.ok(caller > cold + 0.2, `${hand}: ${opener}/${caller}/${cold}`);
    assert.ok(cold < 0.08, `${hand}: ${cold}`);
  }
  assert.ok(response("QQ", "cold-entry").enterFrequency >= 0.85);
  assert.ok(response("AKs", "cold-entry").frequencies.raise >= 0.6);
});

test("every squeeze response role tightens continuously as the three-bet grows", () => {
  const enter = (hand, responseRole, facingSizeBb) => getPreflopStrategy({
    hand,
    scenario: "vs-three-bet",
    heroPosition: "BTN",
    aggressorPosition: "SB",
    responseRole,
    effectiveStackBb: 100,
    facingSizeBb,
  }).enterFrequency;
  for (const responseRole of ["opener", "cold-caller", "cold-entry"]) {
    for (const hand of ["QQ", "AKo", "TT", "A5s", "76s"]) {
      const values = [9, 25, 50, 100].map((facingSizeBb) => enter(hand, responseRole, facingSizeBb));
      for (let index = 1; index < values.length; index += 1) {
        assert.ok(values[index] <= values[index - 1] + 1e-9, `${responseRole}/${hand}: ${values}`);
      }
    }
    assert.ok(enter("TT", responseRole, 50) < enter("TT", responseRole, 25) - 0.02);
  }

  for (const responseRole of ["cold-caller", "cold-entry"]) {
    assert.ok(enter("QQ", responseRole, 25) < enter("QQ", responseRole, 9) - 0.02);
    for (const hand of ["QQ", "AKo", "TT"]) {
      const below = enter(hand, responseRole, 8.99);
      const above = enter(hand, responseRole, 9.01);
      assert.ok(Math.abs(above - below) < 0.01, `${responseRole}/${hand}: ${below} -> ${above}`);
    }
  }
});

test("short-stack three-bet and squeeze endpoints retain canonical stack-off hands", () => {
  const enter = (hand, responseRole, effectiveStackBb, facingSizeBb) => getPreflopStrategy({
    hand,
    scenario: "vs-three-bet",
    heroPosition: "BTN",
    aggressorPosition: "SB",
    responseRole,
    effectiveStackBb,
    facingSizeBb,
  }).enterFrequency;

  for (const role of ["opener", "cold-caller", "cold-entry"]) {
    assert.ok(enter("TT", role, 10, 10) >= 0.94, `${role}/TT`);
    assert.ok(enter("JJ", role, 10, 10) >= 0.97, `${role}/JJ`);
    assert.ok(enter("AQs", role, 10, 10) >= 0.96, `${role}/AQs`);
    assert.ok(enter("TT", role, 20, 20) >= 0.85, `${role}/20BB TT`);

    let previous = enter("TT", role, 10, 8.5);
    for (let facingSizeBb = 8.6; facingSizeBb <= 10.0001; facingSizeBb += 0.1) {
      const current = enter("TT", role, 10, facingSizeBb);
      assert.ok(Math.abs(current - previous) <= 0.03, `${role}: ${previous} -> ${current}`);
      previous = current;
    }
  }
  assert.ok(enter("22", "opener", 100, 100) <= 0.005);
});

test("models limped pots independently from unopened RFI charts", () => {
  const rfi = getPreflopStrategy({ hand: "Q9o", scenario: "rfi", heroPosition: "HJ" });
  const isolate = getPreflopStrategy({ hand: "Q9o", scenario: "vs-limp", heroPosition: "CO", limpers: 1 });
  assert.equal(rfi.enterFrequency, 0);
  assert.ok(isolate.enterFrequency >= 0.25 && isolate.enterFrequency <= 0.55, JSON.stringify(isolate));
  assert.ok(isolate.frequencies.call > 0);
  assert.ok(isolate.frequencies.raise > 0);
});

test("keeps positional RFI nesting and a separate small-blind complete strategy", () => {
  for (const hand of ["AA", "KQo", "ATo", "A5s", "65s", "44"]) {
    const entries = ["UTG", "HJ", "CO", "BTN"].map((heroPosition) => getPreflopStrategy({
      hand,
      scenario: "rfi",
      heroPosition,
      effectiveStackBb: 100,
    }).enterFrequency);
    for (let index = 1; index < entries.length; index += 1) {
      assert.ok(entries[index] + 0.01 >= entries[index - 1], `${hand}: ${entries.join(",")}`);
    }
  }
  const sb = summarizePreflopRange({ scenario: "rfi", heroPosition: "SB", effectiveStackBb: 100 });
  assert.ok(sb.enterFrequency >= 0.72 && sb.enterFrequency <= 0.84, JSON.stringify(sb.frequencies));
  assert.ok(sb.frequencies.call >= 0.4 && sb.frequencies.call <= 0.58);
  assert.ok(sb.frequencies.raise >= 0.24 && sb.frequencies.raise <= 0.36);
});

test("keeps adjacent pair and shallow-stack adjustments continuous", () => {
  const enter = (hand, effectiveStackBb) => getPreflopStrategy({
    hand,
    scenario: "vs-three-bet",
    heroPosition: "BTN",
    aggressorPosition: "SB",
    effectiveStackBb,
    facingSizeBb: 12,
  }).enterFrequency;
  assert.ok(enter("77", 400) + 0.01 >= enter("66", 400));
  const twenty = enter("TT", 20);
  const twentyOne = enter("TT", 21);
  assert.ok(Math.abs(twentyOne - twenty) <= 0.04, `${twenty} -> ${twentyOne}`);
});
