import assert from "node:assert/strict";
import test from "node:test";

import {
  RANGECRAFT_STANDARD_V1,
  createGtoSolverResult,
  headsUpAccuracyLevel,
  parseGtoGameSpec,
  parseGtoSolverResult,
  stableGtoHash,
  stableGtoJson,
  threeWayAccuracyLevel,
} from "../lib/gto-standard.ts";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resultInput(overrides = {}) {
  return {
    schemaVersion: "rangecraft-gto-result/v1",
    gameSpecId: RANGECRAFT_STANDARD_V1.gameSpecId,
    treeId: RANGECRAFT_STANDARD_V1.treeId,
    solveKind: "heads-up",
    participants: ["BTN", "BB"],
    solverVersion: "rangecraft-dcfr/0.1.0",
    source: {
      kind: "internal-solver",
      name: "RangeCraft DCFR",
      license: "internal-generated-output",
    },
    accuracy: {
      kind: "heads-up-exploitability",
      level: "commercial-target",
      value: 0.0025,
      unit: "pot-fraction",
      iterations: 2_000_000,
    },
    nodes: [{
      nodeId: "btn-bb-flop-root",
      street: "flop",
      actingPosition: "BB",
      potBb: 5.5,
      effectiveStackBb: 97.5,
      actions: [
        { id: "check", label: "过牌" },
        { id: "bet-33", label: "下注 33%" },
      ],
      holdings: [{
        holding: "AsKs",
        reachProbability: 0.75,
        frequencies: [0.3, 0.7],
        actionEvBb: [1.2, 1.25],
      }],
    }],
    ...overrides,
  };
}

test("Standard v1 is deeply immutable and fixes the complete 6-max baseline", () => {
  assert.equal(RANGECRAFT_STANDARD_V1.tableSize, 6);
  assert.equal(RANGECRAFT_STANDARD_V1.startingStackBb, 100);
  assert.equal(RANGECRAFT_STANDARD_V1.utility, "chip-ev");
  assert.deepEqual(RANGECRAFT_STANDARD_V1.rake, { percent: 0, capBb: 0 });
  assert.equal(RANGECRAFT_STANDARD_V1.bettingTree.preflop.openRaiseToBb, 2.5);
  assert.deepEqual(RANGECRAFT_STANDARD_V1.bettingTree.postflop.flop.betPotFractions, [0.33, 0.75]);
  assert.equal(
    RANGECRAFT_STANDARD_V1.gameSpecId,
    "rc-game-v1-cd6fde5d093d35e0d9fc0201caeb87616e0f8f8aa730156112fb8a7d602c3905",
  );
  assert.equal(
    RANGECRAFT_STANDARD_V1.treeId,
    "rc-tree-v1-0de3aebf5403fb1fa63b41d7ce495e5c6bf1d066017c1c49abf053012f50a1a2",
  );
  assert.ok(Object.isFrozen(RANGECRAFT_STANDARD_V1));
  assert.ok(Object.isFrozen(RANGECRAFT_STANDARD_V1.bettingTree.postflop.flop.betPotFractions));
  assert.throws(() => {
    RANGECRAFT_STANDARD_V1.bettingTree.postflop.flop.betPotFractions[0] = 0.25;
  }, TypeError);
});

test("stable JSON and SHA-256 ignore object insertion order but not array order", () => {
  const left = { z: 1, nested: { b: true, a: "值" }, list: [1, 2] };
  const right = { list: [1, 2], nested: { a: "值", b: true }, z: 1 };
  assert.equal(stableGtoJson(left), stableGtoJson(right));
  assert.equal(stableGtoHash(left), stableGtoHash(right));
  assert.notEqual(stableGtoHash(left), stableGtoHash({ ...right, list: [2, 1] }));
  assert.equal(stableGtoHash({}), "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
  assert.throws(() => stableGtoHash({ invalid: Number.NaN }), /有限数值/);
});

test("game spec parser accepts a serialized copy and rejects silent rule drift", () => {
  const parsed = parseGtoGameSpec(clone(RANGECRAFT_STANDARD_V1));
  assert.deepEqual(parsed, RANGECRAFT_STANDARD_V1);
  assert.ok(Object.isFrozen(parsed.bettingTree.preflop));

  const changedRake = clone(RANGECRAFT_STANDARD_V1);
  changedRake.rake.percent = 0.05;
  assert.throws(() => parseGtoGameSpec(changedRake), /不是 RangeCraft Standard v1/);

  const changedTree = clone(RANGECRAFT_STANDARD_V1);
  changedTree.bettingTree.turn = { betPotFractions: [0.33], raisePotAfterCallFractions: [1] };
  assert.throws(() => parseGtoGameSpec(changedTree), /不是 RangeCraft Standard v1/);
});

test("accuracy levels are derived from measured values for HU and three-way solves", () => {
  assert.equal(headsUpAccuracyLevel(0.003), "commercial-target");
  assert.equal(headsUpAccuracyLevel(0.0031), "training");
  assert.equal(headsUpAccuracyLevel(0.02), "experimental");
  assert.equal(headsUpAccuracyLevel(1.5), "experimental");
  assert.equal(threeWayAccuracyLevel(0.001), "high-confidence-approximation");
  assert.equal(threeWayAccuracyLevel(0.0011), "training-approximation");
  assert.equal(threeWayAccuracyLevel(0.02), "experimental-approximation");
  assert.equal(threeWayAccuracyLevel(1.5), "experimental-approximation");
});

test("solver result creation is deterministic, hashed and deeply immutable", () => {
  const first = createGtoSolverResult(resultInput());
  const replay = createGtoSolverResult(resultInput());
  assert.equal(first.resultId, replay.resultId);
  assert.match(first.resultId, /^rc-result-v1-[a-f0-9]{64}$/);
  assert.deepEqual(parseGtoSolverResult(clone(first)), first);
  assert.ok(Object.isFrozen(first.nodes[0].holdings[0].frequencies));
  assert.throws(() => {
    first.nodes[0].holdings[0].frequencies[0] = 1;
  }, TypeError);
});

test("result schema rejects bad identities, invalid mixes and inconsistent accuracy", () => {
  assert.throws(
    () => createGtoSolverResult(resultInput({ treeId: "unknown-tree" })),
    /下注树不匹配/,
  );
  const badMix = resultInput();
  badMix.nodes[0].holdings[0].frequencies = [0.7, 0.7];
  assert.throws(() => createGtoSolverResult(badMix), /总和必须为 1/);

  const falseAccuracyClaim = resultInput();
  falseAccuracyClaim.accuracy.value = 0.02;
  assert.throws(() => createGtoSolverResult(falseAccuracyClaim), /对应等级应为 experimental/);

  const wrongModeMetric = resultInput({
    solveKind: "three-way",
    participants: ["BTN", "SB", "BB"],
  });
  assert.throws(() => createGtoSolverResult(wrongModeMetric), /three-way-nash-distance/);
});

test("three-way outputs stay explicitly approximate and validate their participant count", () => {
  const threeWay = createGtoSolverResult(resultInput({
    solveKind: "three-way",
    participants: ["BTN", "SB", "BB"],
    accuracy: {
      kind: "three-way-nash-distance",
      level: "training-approximation",
      value: 0.0024,
      unit: "pot-fraction",
      iterations: 5_000_000,
    },
  }));
  assert.equal(threeWay.accuracy.level, "training-approximation");
  assert.throws(
    () => createGtoSolverResult(resultInput({ solveKind: "three-way", participants: ["BTN", "BB"] })),
    /必须有 3 名参与者/,
  );
});

test("stored solver result rejects post-hash tampering and unlicensed-looking empty provenance", () => {
  const stored = clone(createGtoSolverResult(resultInput()));
  stored.nodes[0].holdings[0].frequencies = [0.4, 0.6];
  assert.throws(() => parseGtoSolverResult(stored), /内容哈希不匹配/);

  const missingLicense = resultInput();
  delete missingLicense.source.license;
  assert.throws(() => createGtoSolverResult(missingLicense), /缺少字段 license/);
});
