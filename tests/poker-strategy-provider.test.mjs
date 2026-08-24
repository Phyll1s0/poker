import assert from "node:assert/strict";
import test from "node:test";

import {
  CompositePokerStrategyProviderV2,
  STATIC_STRATEGY_PACK_SCHEMA_V1,
  StaticStrategyPackSourceV2,
  StrategyPackValidationError,
  parseStaticStrategyPackV1,
} from "../lib/poker-strategy-provider.ts";
import {
  STRATEGY_SCHEMA_VERSION_V2,
  createStrategyResolutionV2,
  strategyConfigKeyV2,
  strategyNodeKeyV2,
} from "../lib/poker-strategy.ts";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function spot() {
  return {
    schemaVersion: STRATEGY_SCHEMA_VERSION_V2,
    gameSpecId: "rc-standard-hu-100bb",
    treeId: "rc-tree-preflop-2.5-10",
    gameConfig: {
      variant: "no-limit-holdem",
      tableSize: 2,
      blinds: { smallBb: 0.5, bigBb: 1 },
      ante: { kind: "none", amountBb: 0 },
      rake: { percent: 0, capBb: 0, noFlopNoDrop: true },
      utility: "chip-ev",
      startingStacksBb: { BTN: 100, BB: 100 },
    },
    street: "preflop",
    heroId: "hero-id",
    heroCards: [
      { rank: 14, suit: "spades" },
      { rank: 10, suit: "spades" },
    ],
    board: [],
    potBb: 4,
    toCallBb: 1.5,
    minimumRaiseToBb: 10,
    seats: [{
      id: "villain-id",
      position: "BTN",
      stackBb: 97.5,
      streetCommittedBb: 2.5,
      totalCommittedBb: 2.5,
      folded: false,
      allIn: false,
    }, {
      id: "hero-id",
      position: "BB",
      stackBb: 99,
      streetCommittedBb: 1,
      totalCommittedBb: 1,
      folded: false,
      allIn: false,
    }],
    activePlayerIds: ["villain-id", "hero-id"],
    legalActions: [
      { action: "fold" },
      { action: "call" },
      { action: "raise", raiseToBb: 10, isAllIn: false },
    ],
    actionHistory: [{
      street: "preflop",
      playerId: "villain-id",
      action: "raise",
      amountToBb: 2.5,
      incrementBb: 2.5,
      potAfterBb: 4,
    }],
  };
}

function actions() {
  return [
    { action: "fold", frequency: 0.2, evBb: -1 },
    { action: "call", frequency: 0.6, evBb: 0.14 },
    { action: "raise", raiseToBb: 10, frequency: 0.2, evBb: 0.12 },
  ];
}

function pack(targetSpot, overrides = {}) {
  return {
    schemaVersion: STATIC_STRATEGY_PACK_SCHEMA_V1,
    packId: "rangecraft-test-pack",
    packVersion: "1.0.0",
    configId: strategyConfigKeyV2(targetSpot.gameConfig),
    gameSpecId: targetSpot.gameSpecId,
    treeId: targetSpot.treeId,
    solver: { name: "RangeCraft CFR+", version: "0.1.0" },
    error: { metric: "exploitability", value: 0.002, unit: "pot-fraction" },
    license: { name: "RangeCraft generated output", redistribution: "allowed" },
    nodes: [{
      nodeKey: strategyNodeKeyV2(targetSpot),
      nodeId: "btn-vs-bb-open",
      legalActions: clone(targetSpot.legalActions),
      actions: actions(),
    }],
    ...overrides,
  };
}

function fallbackProvider(calls = []) {
  return {
    async resolve(targetSpot, context) {
      calls.push(context);
      return createStrategyResolutionV2(targetSpot, {
        resolution: "fallback",
        provenance: {
          kind: "fallback-model",
          packId: "rangecraft-fallback",
          packVersion: "1.0.0",
          nodeId: "policy-node",
          configId: strategyConfigKeyV2(targetSpot.gameConfig),
          solver: { name: "RangeCraft policy", version: "1.0.0" },
          error: { metric: "unmeasured", value: null, unit: "unmeasured" },
          license: { name: "RangeCraft internal", redistribution: "allowed" },
        },
        fallbackReason: { code: context.code, message: context.message },
        actions: actions(),
      });
    },
  };
}

test("a validated static pack supports synchronous exact cache lookup", () => {
  const targetSpot = spot();
  const parsed = parseStaticStrategyPackV1(pack(targetSpot));
  const source = new StaticStrategyPackSourceV2({ initialPacks: [parsed] });
  const exact = source.peekExact(targetSpot);

  assert.equal(exact?.resolution, "exact");
  assert.equal(exact?.nodeKey, strategyNodeKeyV2(targetSpot));
  assert.equal(exact?.provenance.packId, "rangecraft-test-pack");
  assert.equal(exact?.actions[2].raiseToBb, 10);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.nodes[0].actions));
});

test("concurrent asynchronous exact loads are deduplicated and never call fallback", async () => {
  const targetSpot = spot();
  let loaderCalls = 0;
  let releaseLoader;
  const gate = new Promise((resolve) => { releaseLoader = resolve; });
  const exact = new StaticStrategyPackSourceV2({
    loader: async (request) => {
      loaderCalls += 1;
      assert.equal(request.nodeKey, strategyNodeKeyV2(targetSpot));
      await gate;
      return pack(targetSpot);
    },
  });
  const fallbackCalls = [];
  const provider = new CompositePokerStrategyProviderV2({
    exact,
    fallback: fallbackProvider(fallbackCalls),
  });

  const first = provider.resolveDecision("hand-1:decision-1", targetSpot);
  const second = provider.resolveDecision("hand-1:decision-1", targetSpot);
  releaseLoader();
  const [left, right] = await Promise.all([first, second]);

  assert.equal(loaderCalls, 1);
  assert.equal(fallbackCalls.length, 0);
  assert.equal(left, right, "同一决策的并发调用应共享首次结果对象");
  assert.equal(left.resolution, "exact");
  assert.equal(provider.peekDecision("hand-1:decision-1", targetSpot), left);
});

test("a clean cache miss becomes an explicit node-not-found fallback", async () => {
  const targetSpot = spot();
  const fallbackCalls = [];
  const provider = new CompositePokerStrategyProviderV2({
    exact: new StaticStrategyPackSourceV2({ loader: async () => null }),
    fallback: fallbackProvider(fallbackCalls),
  });
  assert.equal(provider.peekDecision("miss", targetSpot), null, "peek 不应提前制造 fallback");
  const result = await provider.resolveDecision("miss", targetSpot);
  assert.equal(result.resolution, "fallback");
  assert.equal(result.fallbackReason.code, "node-not-found");
  assert.equal(fallbackCalls[0].code, "node-not-found");
});

test("loader metadata corruption is isolated behind solver-unavailable fallback", async () => {
  const targetSpot = spot();
  const wrongPack = pack(targetSpot, { treeId: "wrong-tree" });
  const fallbackCalls = [];
  const provider = new CompositePokerStrategyProviderV2({
    exact: new StaticStrategyPackSourceV2({ loader: async () => wrongPack }),
    fallback: fallbackProvider(fallbackCalls),
  });
  const result = await provider.resolveDecision("bad-loader", targetSpot);
  assert.equal(result.resolution, "fallback");
  assert.equal(result.fallbackReason.code, "solver-unavailable");
  assert.ok(fallbackCalls[0].cause instanceof StrategyPackValidationError);
});

test("legal actions are compared strictly, including all-in identity", () => {
  const targetSpot = spot();
  const mismatched = pack(targetSpot);
  mismatched.nodes[0].legalActions[2].isAllIn = true;
  const source = new StaticStrategyPackSourceV2({ initialPacks: [mismatched] });
  assert.throws(() => source.peekExact(targetSpot), /legalActions.*不完全一致/);

  const malformed = pack(targetSpot);
  malformed.nodes[0].actions[2].raiseToBb = 11;
  assert.throws(() => parseStaticStrategyPackV1(malformed), /actions 与 legalActions 不一致/);
});

test("the first fallback stays locked even if an exact pack arrives later", async () => {
  const targetSpot = spot();
  const exact = new StaticStrategyPackSourceV2();
  const provider = new CompositePokerStrategyProviderV2({
    exact,
    fallback: fallbackProvider(),
  });
  const first = await provider.resolveDecision("locked-decision", targetSpot);
  assert.equal(first.resolution, "fallback");

  exact.install(pack(targetSpot));
  const stillFirst = await provider.resolveDecision("locked-decision", targetSpot);
  assert.equal(stillFirst, first);
  assert.equal(stillFirst.resolution, "fallback");

  provider.releaseDecision("locked-decision");
  const afterRelease = provider.peekDecision("locked-decision", targetSpot);
  assert.equal(afterRelease?.resolution, "exact");
});

test("one decision id cannot silently move to a different strategy node", async () => {
  const firstSpot = spot();
  const secondSpot = clone(firstSpot);
  secondSpot.heroCards = [
    { rank: 13, suit: "hearts" },
    { rank: 12, suit: "hearts" },
  ];
  const provider = new CompositePokerStrategyProviderV2({
    exact: new StaticStrategyPackSourceV2(),
    fallback: fallbackProvider(),
  });
  await provider.resolveDecision("stable-id", firstSpot);
  assert.throws(() => provider.peekDecision("stable-id", secondSpot), /已绑定到另一策略节点/);
  assert.throws(() => provider.resolveDecision("stable-id", secondSpot), /已绑定到另一策略节点/);
});

test("an invalid fallback response cannot cross the exact/fallback boundary", async () => {
  const targetSpot = spot();
  const exactResult = createStrategyResolutionV2(targetSpot, {
    resolution: "exact",
    provenance: {
      kind: "solved-pack-node",
      packId: "malicious-exact",
      packVersion: "1",
      nodeId: "wrong-boundary",
      configId: strategyConfigKeyV2(targetSpot.gameConfig),
      solver: { name: "test", version: "1" },
      error: { metric: "exploitability", value: 0.001, unit: "pot-fraction" },
      license: { name: "test", redistribution: "allowed" },
    },
    actions: actions(),
  });
  const provider = new CompositePokerStrategyProviderV2({
    exact: new StaticStrategyPackSourceV2(),
    fallback: { resolve: async () => exactResult },
  });
  await assert.rejects(provider.resolveDecision("bad-fallback", targetSpot), /预期 fallback，实际为 exact/);
});

test("aborting one waiter does not rewrite or cancel the shared decision result", async () => {
  const targetSpot = spot();
  let releaseLoader;
  const gate = new Promise((resolve) => { releaseLoader = resolve; });
  const provider = new CompositePokerStrategyProviderV2({
    exact: new StaticStrategyPackSourceV2({
      loader: async () => {
        await gate;
        return pack(targetSpot);
      },
    }),
    fallback: fallbackProvider(),
  });
  const controller = new AbortController();
  const abandoned = provider.resolveDecision("shared", targetSpot, controller.signal);
  const retained = provider.resolveDecision("shared", targetSpot);
  controller.abort();
  await assert.rejects(abandoned, (error) => error?.name === "AbortError");
  releaseLoader();
  const result = await retained;
  assert.equal(result.resolution, "exact");
  assert.equal(provider.peekDecision("shared", targetSpot), result);
});
