import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGY_SCHEMA_VERSION_V2,
  canonicalStrategyConfigV2,
  canonicalStrategyNodeV2,
  createStrategyResolutionV2,
  normalizeStrategyActionsV2,
  strategyConfigKeyV2,
  strategyNodeKeyV2,
} from "../lib/poker-strategy.ts";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function gameConfig() {
  return {
    variant: "no-limit-holdem",
    tableSize: 2,
    blinds: { smallBb: 0.5, bigBb: 1 },
    ante: { kind: "none", amountBb: 0 },
    rake: { percent: 0, capBb: 0, noFlopNoDrop: true },
    utility: "chip-ev",
    startingStacksBb: { BTN: 100, BB: 100 },
  };
}

function spot() {
  return {
    schemaVersion: STRATEGY_SCHEMA_VERSION_V2,
    gameSpecId: "rc-standard-hu-100bb",
    treeId: "rc-tree-preflop-2.5-10",
    gameConfig: gameConfig(),
    street: "preflop",
    heroId: "hero-session-id",
    heroCards: [
      { rank: 14, suit: "spades" },
      { rank: 10, suit: "spades" },
    ],
    board: [],
    potBb: 4,
    toCallBb: 1.5,
    minimumRaiseToBb: 10,
    seats: [
      {
        id: "villain-session-id",
        position: "BTN",
        stackBb: 97.5,
        streetCommittedBb: 2.5,
        totalCommittedBb: 2.5,
        folded: false,
        allIn: false,
      },
      {
        id: "hero-session-id",
        position: "BB",
        stackBb: 99,
        streetCommittedBb: 1,
        totalCommittedBb: 1,
        folded: false,
        allIn: false,
      },
    ],
    activePlayerIds: ["villain-session-id", "hero-session-id"],
    legalActions: [
      { action: "fold" },
      { action: "call" },
      { action: "raise", raiseToBb: 10, isAllIn: false },
    ],
    actionHistory: [{
      street: "preflop",
      playerId: "villain-session-id",
      action: "raise",
      amountToBb: 2.5,
      incrementBb: 2.5,
      potAfterBb: 4,
    }],
  };
}

function provenance(targetSpot, kind = "solved-pack-node") {
  return {
    kind,
    packId: kind === "solved-pack-node" ? "rangecraft-standard-hu" : "rangecraft-policy-fallback",
    packVersion: "1.0.0",
    nodeId: kind === "solved-pack-node" ? "hu-btn-bb-open-2.5" : "generated-fallback-node",
    configId: strategyConfigKeyV2(targetSpot.gameConfig),
    solver: { name: kind === "solved-pack-node" ? "RangeCraft CFR+" : "RangeCraft policy", version: "0.1.0" },
    error: kind === "solved-pack-node"
      ? { metric: "exploitability", value: 0.002, unit: "pot-fraction" }
      : { metric: "unmeasured", value: null, unit: "unmeasured" },
    license: { name: "RangeCraft generated output", redistribution: "allowed" },
  };
}

function weightedActions() {
  return [
    { action: "fold", frequency: 20, evBb: -1 },
    { action: "call", frequency: 60, evBb: 0.14 },
    { action: "raise", raiseToBb: 10, frequency: 20, evBb: 0.12 },
  ];
}

test("V2 normalizes action weights without losing raise-to sizes or EV", () => {
  const normalized = normalizeStrategyActionsV2(weightedActions());
  assert.ok(Math.abs(normalized.reduce((sum, action) => sum + action.frequency, 0) - 1) < 1e-12);
  assert.deepEqual(normalized.map((action) => action.frequency), [0.2, 0.6, 0.2]);
  assert.equal(normalized[2].raiseToBb, 10);
  assert.equal(normalized[1].evBb, 0.14);
  assert.ok(Object.isFrozen(normalized));
  assert.throws(() => normalizeStrategyActionsV2([
    { action: "fold", frequency: 0, evBb: 0 },
    { action: "call", frequency: 0, evBb: 0 },
  ]), /总和必须大于 0/);
});

test("config and node canonicalization are stable across object insertion order", () => {
  const original = spot();
  const reordered = clone(original);
  reordered.gameConfig.startingStacksBb = { BB: 100, BTN: 100 };
  reordered.gameConfig.rake = { noFlopNoDrop: true, capBb: 0, percent: 0 };
  reordered.legalActions.reverse();
  reordered.activePlayerIds.reverse();
  reordered.heroCards.reverse();
  reordered.seats.reverse();

  assert.equal(canonicalStrategyConfigV2(original.gameConfig), canonicalStrategyConfigV2(reordered.gameConfig));
  assert.equal(strategyConfigKeyV2(original.gameConfig), strategyConfigKeyV2(reordered.gameConfig));
  assert.equal(canonicalStrategyNodeV2(original), canonicalStrategyNodeV2(reordered));
  assert.equal(strategyNodeKeyV2(original), strategyNodeKeyV2(reordered));
  assert.match(strategyNodeKeyV2(original), /^rc-strategy-node-v2-[a-f0-9]{64}$/);
});

test("node keys use positions rather than transient player or nickname ids", () => {
  const original = spot();
  const rejoined = clone(original);
  rejoined.heroId = "new-hero-token";
  rejoined.seats[0].id = "new-villain-token";
  rejoined.seats[1].id = "new-hero-token";
  rejoined.activePlayerIds = ["new-villain-token", "new-hero-token"];
  rejoined.actionHistory[0].playerId = "new-villain-token";
  assert.equal(strategyNodeKeyV2(original), strategyNodeKeyV2(rejoined));
});

test("every strategy-relevant config change produces a different key", () => {
  const baseline = gameConfig();
  const baselineKey = strategyConfigKeyV2(baseline);
  const mutations = [
    (config) => { config.tableSize = 3; config.startingStacksBb.SB = 100; },
    (config) => { config.blinds.smallBb = 0.4; },
    (config) => { config.blinds.bigBb = 2; },
    (config) => { config.ante = { kind: "per-player", amountBb: 0.1 }; },
    (config) => { config.rake.percent = 0.05; },
    (config) => { config.rake.capBb = 3; },
    (config) => { config.rake.noFlopNoDrop = false; },
    (config) => { config.startingStacksBb.BB = 200; },
  ];
  for (const mutate of mutations) {
    const changed = clone(baseline);
    mutate(changed);
    assert.notEqual(strategyConfigKeyV2(changed), baselineKey, JSON.stringify(changed));
  }
});

test("stacks, legal sizing, action line and tree identity cannot falsely hit the same node", () => {
  const baseline = spot();
  const baselineKey = strategyNodeKeyV2(baseline);
  const mutations = [
    (value) => { value.seats[1].stackBb = 98; },
    (value) => { value.legalActions[2].raiseToBb = 11; },
    (value) => { value.actionHistory[0].amountToBb = 3; },
    (value) => { value.actionHistory[0].incrementBb = 3; },
    (value) => { value.actionHistory[0].potAfterBb = 4.5; value.potBb = 4.5; },
    (value) => { value.treeId = "different-tree"; },
    (value) => { value.gameSpecId = "different-game"; },
    (value) => { value.toCallBb = 2; },
  ];
  for (const mutate of mutations) {
    const changed = clone(baseline);
    mutate(changed);
    assert.notEqual(strategyNodeKeyV2(changed), baselineKey, JSON.stringify(changed));
  }
});

test("exact resolutions are immutable, normalized and provenance-bound to the node config", () => {
  const targetSpot = spot();
  const result = createStrategyResolutionV2(targetSpot, {
    resolution: "exact",
    provenance: provenance(targetSpot),
    actions: weightedActions(),
  });
  assert.equal(result.resolution, "exact");
  assert.equal(result.nodeKey, strategyNodeKeyV2(targetSpot));
  assert.equal(result.actions.reduce((sum, action) => sum + action.frequency, 0), 1);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.provenance.solver));

  const wrongConfig = provenance(targetSpot);
  wrongConfig.configId = "another-config";
  assert.throws(() => createStrategyResolutionV2(targetSpot, {
    resolution: "exact",
    provenance: wrongConfig,
    actions: weightedActions(),
  }), /configId.*不匹配/);
});

test("fallback must explain itself and cannot borrow exact-solution provenance", () => {
  const targetSpot = spot();
  const validFallback = createStrategyResolutionV2(targetSpot, {
    resolution: "fallback",
    provenance: provenance(targetSpot, "fallback-model"),
    fallbackReason: { code: "node-not-found", message: "当前精确动作线尚未进入解库" },
    actions: weightedActions(),
  });
  assert.equal(validFallback.resolution, "fallback");
  assert.equal(validFallback.fallbackReason.code, "node-not-found");

  assert.throws(() => createStrategyResolutionV2(targetSpot, {
    resolution: "fallback",
    provenance: provenance(targetSpot, "fallback-model"),
    actions: weightedActions(),
  }), /fallbackReason/);
  assert.throws(() => createStrategyResolutionV2(targetSpot, {
    resolution: "fallback",
    provenance: provenance(targetSpot, "solved-pack-node"),
    fallbackReason: { code: "node-not-found", message: "missing" },
    actions: weightedActions(),
  }), /fallback-model provenance/);
  assert.throws(() => createStrategyResolutionV2(targetSpot, {
    resolution: "exact",
    provenance: {
      ...provenance(targetSpot),
      error: { metric: "unmeasured", value: null, unit: "unmeasured" },
    },
    actions: weightedActions(),
  }), /必须声明已测量误差/);
});

test("a response cannot silently omit or substitute a legal action size", () => {
  const targetSpot = spot();
  assert.throws(() => createStrategyResolutionV2(targetSpot, {
    resolution: "exact",
    provenance: provenance(targetSpot),
    actions: [
      { action: "fold", frequency: 0.2, evBb: -1 },
      { action: "call", frequency: 0.6, evBb: 0.14 },
      { action: "raise", raiseToBb: 11, frequency: 0.2, evBb: 0.12 },
    ],
  }), /legalActions 完全一致/);
});
