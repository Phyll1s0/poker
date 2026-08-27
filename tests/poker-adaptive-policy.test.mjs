import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_PROFILES,
  AI_STYLE_OPTIONS,
  AI_STYLE_POLICY_BUDGETS,
  adaptAiProfileToHeroImage,
  heroResponseRead,
  updateHeroTableImage,
} from "../lib/poker-ai.ts";
import {
  chooseAdaptivePokerPolicyAction,
  evaluateAdaptivePokerPolicy,
  pokerPolicyTotalVariation,
} from "../lib/poker-adaptive-policy.ts";

const riverResponseContext = {
  node: "river_vs_bet",
  size: "medium",
  position: "oop",
  tableShape: "heads_up",
  depth: "standard",
};

const riverBluffSpot = {
  profile: { ...AI_PROFILES.gto },
  street: "river",
  equity: 0.2,
  handStrength: 0.1,
  draw: 0,
  blockers: 0.13,
  pot: 100,
  toCall: 0,
  potOdds: 0,
  inPosition: true,
  activeOpponents: 1,
  opponentsCanRespond: true,
  callEndsHand: false,
  effectiveStackBb: 70,
  startingDepthBb: 100,
  highestBet: 0,
  playerBet: 0,
  playerStack: 700,
  maxContestableTarget: 700,
  minRaise: 10,
  raiseLocked: false,
  squidPressure: 0,
  bigBlind: 10,
  boardWetness: 0.25,
  boardPairing: 0,
  boardHighCard: 0.8,
  initiative: false,
  streetRaiseCount: 0,
};

function neutralAdaptation(styleKey) {
  return {
    ...AI_PROFILES[styleKey],
    confidence: 0,
    pressureResponse: 0,
    responseConfidence: 0,
    overfoldResponse: 0,
    underfoldResponse: 0,
    counterRaiseResponse: 0,
    exploitWeight: 0,
  };
}

function responseImage(action, count, context = riverResponseContext) {
  let image = {
    loose: 0.5,
    aggressive: 0.5,
    deceptive: 0.5,
    observations: 0,
    pressure: {},
    responses: {},
  };
  for (let index = 0; index < count; index += 1) {
    image = updateHeroTableImage(
      image,
      action === "fold"
        ? { loose: 0.18, aggressive: 0.34 }
        : action === "raise"
          ? { loose: 0.78, aggressive: 0.9 }
          : { loose: 0.68, aggressive: 0.24 },
      undefined,
      { context, action },
    );
  }
  return image;
}

test("anchors every archetype to one balanced policy before expressing style", () => {
  for (const { styleKey } of AI_STYLE_OPTIONS) {
    const plan = evaluateAdaptivePokerPolicy(riverBluffSpot, {
      styleKey,
      adaptedProfile: neutralAdaptation(styleKey),
    });
    const expected = Object.fromEntries(Object.keys(plan.actionFrequencies).map((kind) => [
      kind,
      plan.gtoReference.actionFrequencies[kind] * (1 - AI_STYLE_POLICY_BUDGETS[styleKey].styleExpression)
        + plan.styleReference.actionFrequencies[kind] * AI_STYLE_POLICY_BUDGETS[styleKey].styleExpression,
    ]));
    for (const kind of Object.keys(expected)) {
      assert.ok(Math.abs(plan.actionFrequencies[kind] - expected[kind]) < 1e-12);
    }
    assert.equal(plan.exploitWeight, 0);
  }
});

test("keeps the public exploit overlay inside its declared action-TV trust region", () => {
  const image = responseImage("fold", 50);
  for (const { styleKey } of AI_STYLE_OPTIONS) {
    const adapted = adaptAiProfileToHeroImage(styleKey, image, {
      heroActive: true,
      facingHero: false,
      intensity: 1.5,
      responseContext: riverResponseContext,
    });
    const plan = evaluateAdaptivePokerPolicy(riverBluffSpot, { styleKey, adaptedProfile: adapted });
    const total = Object.values(plan.actionFrequencies).reduce((sum, frequency) => sum + frequency, 0);
    const sizingTotal = plan.sizingRoutes.reduce((sum, route) => sum + route.frequency, 0);
    assert.ok(Math.abs(total - 1) < 1e-12);
    assert.ok(plan.totalVariationFromStyleBaseline <= plan.exploitWeight + 1e-12);
    assert.ok(plan.exploitWeight <= AI_STYLE_POLICY_BUDGETS[styleKey].maxExploit + 1e-12);
    assert.ok(plan.sizingRoutes.every((route) => route.target > riverBluffSpot.highestBet));
    if (plan.actionFrequencies.raise > 0) assert.ok(Math.abs(sizingTotal - 1) < 1e-12);
  }
});

test("all styles attack a proven overfolder while adaptive changes most", () => {
  const image = responseImage("fold", 50);
  const shifts = {};
  for (const { styleKey } of AI_STYLE_OPTIONS) {
    const baseline = evaluateAdaptivePokerPolicy(riverBluffSpot, {
      styleKey,
      adaptedProfile: neutralAdaptation(styleKey),
    });
    const adaptedProfile = adaptAiProfileToHeroImage(styleKey, image, {
      heroActive: true,
      facingHero: false,
      intensity: 1.5,
      responseContext: riverResponseContext,
    });
    const adapted = evaluateAdaptivePokerPolicy(riverBluffSpot, { styleKey, adaptedProfile });
    shifts[styleKey] = pokerPolicyTotalVariation(
      baseline.actionFrequencies,
      adapted.actionFrequencies,
    );
    assert.ok(adapted.actionFrequencies.raise > baseline.actionFrequencies.raise, `${styleKey} 应增加施压`);
    assert.ok(shifts[styleKey] > 0.003, `${styleKey} 应产生可见的最终行动变化`);
  }
  assert.ok(shifts.adaptive > shifts.gto * 2.5);
  assert.ok(shifts.adaptive > shifts.nit * 4);
  assert.ok(shifts.adaptive > shifts.lag);
});

test("learns matching response nodes without leaking the read into another street", () => {
  const image = responseImage("fold", 28);
  const matching = heroResponseRead(image, riverResponseContext);
  const differentSize = heroResponseRead(image, {
    ...riverResponseContext,
    size: "small",
  });
  const differentStreet = heroResponseRead(image, {
    ...riverResponseContext,
    node: "flop_vs_bet",
  });
  assert.ok(matching.fold > 0.75);
  assert.ok(matching.confidence >= 0.7);
  assert.ok(matching.overfold > 0.5);
  assert.ok(matching.fold > differentSize.fold, "细尺度证据应强于同节点的层级回退");
  assert.ok(differentSize.fold > 0.7, "同街道粗节点可以给未见尺度提供有限回退");
  assert.equal(differentStreet.divergence, 0);
  assert.equal(differentStreet.confidence, 0);
});

test("slow and recent evidence can reverse instead of permanently overfitting", () => {
  let image = responseImage("fold", 30);
  const overfolded = heroResponseRead(image, riverResponseContext);
  for (let index = 0; index < 70; index += 1) {
    image = updateHeroTableImage(
      image,
      { loose: 0.68, aggressive: 0.24 },
      undefined,
      { context: riverResponseContext, action: "call" },
    );
  }
  const reversed = heroResponseRead(image, riverResponseContext);
  assert.ok(reversed.overfold < overfolded.overfold * 0.2);
  assert.ok(reversed.underfold > 0.35);
});

test("discounts mature response evidence so a real regime switch remains learnable", () => {
  let image = responseImage("fold", 1_000);
  const before = heroResponseRead(image, riverResponseContext);
  assert.ok(before.fold > 0.92);
  for (let index = 0; index < 100; index += 1) {
    image = updateHeroTableImage(
      image,
      { loose: 0.68, aggressive: 0.24 },
      undefined,
      { context: riverResponseContext, action: "call" },
    );
  }
  const after = heroResponseRead(image, riverResponseContext);
  assert.ok(after.fold < 0.35, `成熟画像换挡后 fold=${after.fold}`);
  assert.ok(after.call > 0.62);
  assert.ok(after.underfold > 0.4);
  assert.ok(before.fold - after.fold > 0.55);

  const generic = image.responses.river_vs_bet;
  const contextual = image.responses["river_vs_bet|medium|oop|heads_up|standard"];
  assert.ok(generic.opportunities <= 120 + 1e-9);
  assert.ok(contextual.opportunities <= 72 + 1e-9);
  assert.ok(Math.abs(generic.folds + generic.calls + generic.raises - generic.opportunities) < 1e-9);
  assert.ok(Math.abs(contextual.folds + contextual.calls + contextual.raises - contextual.opportunities) < 1e-9);
});

test("shrinks tiny response samples and does not count one context observation twice", () => {
  const oneFold = heroResponseRead(responseImage("fold", 1), riverResponseContext);
  const fiveFolds = heroResponseRead(responseImage("fold", 5), riverResponseContext);
  assert.ok(oneFold.fold < 0.56);
  assert.ok(oneFold.confidence < 0.1);
  assert.ok(fiveFolds.fold < 0.7);
  assert.ok(fiveFolds.confidence < 0.35);

  const image = responseImage("fold", 28);
  const matching = heroResponseRead(image, riverResponseContext);
  const genericFallback = heroResponseRead(image, { ...riverResponseContext, size: "small" });
  assert.ok(matching.fold - genericFallback.fold < 0.025);
  assert.ok(matching.fold >= genericFallback.fold);
});

test("reserves the large exploit budget for matching nodes while every style keeps a small global prior", () => {
  const nodeOnlyImage = {
    ...responseImage("fold", 40),
    loose: 0.5,
    aggressive: 0.5,
    deceptive: 0.5,
    observations: 0,
    pressure: {},
  };
  const matching = adaptAiProfileToHeroImage("adaptive", nodeOnlyImage, {
    heroActive: true,
    facingHero: false,
    intensity: 1.5,
    responseContext: riverResponseContext,
  });
  const wrongStreet = adaptAiProfileToHeroImage("adaptive", nodeOnlyImage, {
    heroActive: true,
    facingHero: false,
    intensity: 1.5,
    responseContext: { ...riverResponseContext, node: "flop_vs_bet" },
  });
  assert.ok(matching.exploitWeight > 0.2);
  assert.equal(wrongStreet.exploitWeight, 0);
  const matchingPlan = evaluateAdaptivePokerPolicy(riverBluffSpot, {
    styleKey: "adaptive",
    adaptedProfile: matching,
  });
  const wrongPlan = evaluateAdaptivePokerPolicy(riverBluffSpot, {
    styleKey: "adaptive",
    adaptedProfile: wrongStreet,
  });
  assert.ok(pokerPolicyTotalVariation(
    matchingPlan.actionFrequencies,
    wrongPlan.actionFrequencies,
  ) > 0.02);

  for (const wrongContext of [
    { ...riverResponseContext, size: "small" },
    { ...riverResponseContext, position: "ip" },
    { ...riverResponseContext, tableShape: "multiway" },
    { ...riverResponseContext, depth: "deep" },
  ]) {
    const coarseFallback = adaptAiProfileToHeroImage("adaptive", nodeOnlyImage, {
      heroActive: true,
      facingHero: false,
      intensity: 1.5,
      responseContext: wrongContext,
    });
    assert.ok(coarseFallback.exploitWeight > 0, "同节点粗画像应保留有限共享");
    assert.ok(
      coarseFallback.exploitWeight <= matching.exploitWeight * 0.35,
      "错误尺度/位置/人数/深度不能解锁接近匹配节点的预算",
    );
  }

  const globalOnly = {
    loose: 0.95,
    aggressive: 0.95,
    deceptive: 0.95,
    observations: 500,
    pressure: {},
    responses: {},
  };
  for (const { styleKey } of AI_STYLE_OPTIONS) {
    const adapted = adaptAiProfileToHeroImage(styleKey, globalOnly, {
      heroActive: true,
      facingHero: false,
      intensity: 1.5,
      responseContext: { ...riverResponseContext, node: "flop_vs_bet" },
    });
    assert.ok(adapted.exploitWeight > 0, `${styleKey} 应保留轻微全局画像泛化`);
    assert.ok(
      adapted.exploitWeight <= AI_STYLE_POLICY_BUDGETS[styleKey].maxExploit * 0.12 + 1e-12,
      `${styleKey} 的跨节点预算必须受 12% 先验上限约束`,
    );
  }
});

test("sampling is reproducible and uses the published mixed action and sizing plan", () => {
  const image = responseImage("fold", 50);
  const adaptedProfile = adaptAiProfileToHeroImage("adaptive", image, {
    heroActive: true,
    facingHero: false,
    intensity: 1.5,
    responseContext: riverResponseContext,
  });
  const rolls = [0.1, 0.7, 0.95];
  const first = chooseAdaptivePokerPolicyAction(
    riverBluffSpot,
    { styleKey: "adaptive", adaptedProfile },
    () => rolls.shift() ?? 0,
  );
  const replayRolls = [0.1, 0.7, 0.95];
  const replay = chooseAdaptivePokerPolicyAction(
    riverBluffSpot,
    { styleKey: "adaptive", adaptedProfile },
    () => replayRolls.shift() ?? 0,
  );
  assert.deepEqual(first, replay);
  if (first.kind === "raise") assert.ok(first.raiseTo > riverBluffSpot.highestBet);
});

test("empirical sampling follows both final action and conditional sizing frequencies", () => {
  const image = responseImage("fold", 50);
  const adaptedProfile = adaptAiProfileToHeroImage("adaptive", image, {
    heroActive: true,
    facingHero: false,
    intensity: 1.5,
    responseContext: riverResponseContext,
  });
  const plan = evaluateAdaptivePokerPolicy(riverBluffSpot, {
    styleKey: "adaptive",
    adaptedProfile,
  });
  let seed = 0x6d2b79f5;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const samples = 12_000;
  const actionCounts = { fold: 0, check: 0, call: 0, raise: 0 };
  const sizingCounts = new Map();
  for (let index = 0; index < samples; index += 1) {
    const sampled = chooseAdaptivePokerPolicyAction(
      riverBluffSpot,
      { styleKey: "adaptive", adaptedProfile },
      random,
    );
    actionCounts[sampled.kind] += 1;
    if (sampled.kind === "raise") {
      sizingCounts.set(sampled.raiseTo, (sizingCounts.get(sampled.raiseTo) ?? 0) + 1);
    }
  }
  for (const kind of Object.keys(actionCounts)) {
    assert.ok(
      Math.abs(actionCounts[kind] / samples - plan.actionFrequencies[kind]) < 0.02,
      `${kind} 抽样频率应接近最终混合`,
    );
  }
  const raises = actionCounts.raise;
  assert.ok(raises > 500);
  for (const route of plan.sizingRoutes) {
    assert.ok(
      Math.abs((sizingCounts.get(route.target) ?? 0) / raises - route.frequency) < 0.025,
      `raise-to ${route.target} 的条件尺度频率应接近发布路线`,
    );
  }
});
