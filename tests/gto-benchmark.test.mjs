import assert from "node:assert/strict";
import test from "node:test";

import { benchmarkGtoSolverResults } from "../lib/gto-benchmark.ts";
import { RANGECRAFT_STANDARD_V1, createGtoSolverResult } from "../lib/gto-standard.ts";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function result(nodes, overrides = {}) {
  return createGtoSolverResult({
    schemaVersion: "rangecraft-gto-result/v1",
    gameSpecId: RANGECRAFT_STANDARD_V1.gameSpecId,
    treeId: RANGECRAFT_STANDARD_V1.treeId,
    solveKind: "heads-up",
    participants: ["BTN", "BB"],
    solverVersion: "test-solver/1",
    source: {
      kind: "internal-solver",
      name: "deterministic fixture",
      license: "test-only",
    },
    accuracy: {
      kind: "heads-up-exploitability",
      level: "training",
      value: 0.005,
      unit: "pot-fraction",
      iterations: 10_000,
    },
    nodes,
    ...overrides,
  });
}

const referenceNodes = [{
  nodeId: "river-a",
  street: "river",
  actingPosition: "BTN",
  potBb: 10,
  effectiveStackBb: 30,
  actions: [
    { id: "fold", label: "弃牌" },
    { id: "call", label: "跟注" },
    { id: "raise", label: "加注" },
  ],
  holdings: [{
    holding: "AsKs",
    reachProbability: 0.75,
    frequencies: [0.2, 0.5, 0.3],
    actionEvBb: [0, 1, 2],
  }, {
    holding: "7c2d",
    reachProbability: 0.25,
    frequencies: [1, 0, 0],
    actionEvBb: [0, -1, -2],
  }],
}, {
  nodeId: "river-b",
  street: "river",
  actingPosition: "BB",
  potBb: 14,
  effectiveStackBb: 28,
  actions: [
    { id: "check", label: "过牌" },
    { id: "bet", label: "下注" },
  ],
  holdings: [{
    holding: "AhQh",
    reachProbability: 0.5,
    frequencies: [0.4, 0.6],
    actionEvBb: [1, 1.5],
  }],
}];

const reorderedCandidateNodes = [{
  nodeId: "river-b",
  street: "river",
  actingPosition: "BB",
  potBb: 14,
  effectiveStackBb: 28,
  actions: [
    { id: "bet", label: "Bet" },
    { id: "check", label: "Check" },
  ],
  holdings: [{
    holding: "AhQh",
    reachProbability: 0.1,
    frequencies: [0.3, 0.7],
  }],
}, {
  nodeId: "river-a",
  street: "river",
  actingPosition: "BTN",
  potBb: 10,
  effectiveStackBb: 30,
  actions: [
    { id: "raise", label: "Raise" },
    { id: "fold", label: "Fold" },
    { id: "call", label: "Call" },
  ],
  holdings: [{
    holding: "7c2d",
    reachProbability: 0.9,
    frequencies: [0.1, 0.8, 0.1],
  }, {
    holding: "AsKs",
    reachProbability: 0.1,
    frequencies: [0.3, 0.1, 0.6],
  }],
}];

test("benchmark aligns nodes, actions and holdings by id regardless of serialized order", () => {
  const report = benchmarkGtoSolverResults(result(reorderedCandidateNodes), result(referenceNodes));

  assert.equal(report.sharedNodeCount, 2);
  assert.deepEqual(report.coverage, {
    referenceReachWeight: 1.5,
    coveredReferenceReachWeight: 1.5,
    fraction: 1,
    referenceHoldingCount: 3,
    comparedHoldingCount: 3,
  });
  assert.ok(Math.abs(report.meanTotalVariation - (0.275 / 1.5)) < 1e-12);
  assert.deepEqual(report.maxSingleActionFrequencyError, {
    value: 0.3,
    nodeId: "river-b",
    holding: "AhQh",
    actionId: "bet",
    referenceFrequency: 0.6,
    candidateFrequency: 0.3,
  });
  assert.ok(Math.abs(report.weightedEvRegretBb - (0.85 / 1.5)) < 1e-12);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.coverage));
  assert.ok(Object.isFrozen(report.participants));
});

test("coverage uses reference reach and partial candidates are not mistaken for full coverage", () => {
  const candidate = result([{
    ...referenceNodes[0],
    holdings: [{
      holding: "AsKs",
      reachProbability: 1,
      frequencies: [0.1, 0.6, 0.3],
    }],
  }]);
  const report = benchmarkGtoSolverResults(candidate, result(referenceNodes));

  assert.equal(report.coverage.referenceReachWeight, 1.5);
  assert.equal(report.coverage.coveredReferenceReachWeight, 0.75);
  assert.equal(report.coverage.fraction, 0.5);
  assert.equal(report.coverage.comparedHoldingCount, 1);
  assert.ok(Math.abs(report.meanTotalVariation - 0.1) < 1e-12);
  assert.ok(Math.abs(report.weightedEvRegretBb - 0.8) < 1e-12);
});

test("EV regret is null unless every reference holding has a complete EV vector", () => {
  const missingEv = clone(referenceNodes);
  delete missingEv[1].holdings[0].actionEvBb;
  const report = benchmarkGtoSolverResults(result(reorderedCandidateNodes), result(missingEv));
  assert.equal(report.weightedEvRegretBb, null);
  assert.ok(report.meanTotalVariation > 0);
});

test("different game identity, tree, solve kind or participant order cannot be compared", () => {
  const reference = result(referenceNodes);
  const baseCandidate = clone(result(reorderedCandidateNodes));

  const wrongGame = clone(baseCandidate);
  wrongGame.gameSpecId = "another-game";
  assert.throws(() => benchmarkGtoSolverResults(wrongGame, reference), /gameSpecId 不一致/);

  const wrongTree = clone(baseCandidate);
  wrongTree.treeId = "another-tree";
  assert.throws(() => benchmarkGtoSolverResults(wrongTree, reference), /treeId 不一致/);

  const wrongKind = clone(baseCandidate);
  wrongKind.solveKind = "three-way";
  wrongKind.participants = ["BTN", "SB", "BB"];
  assert.throws(() => benchmarkGtoSolverResults(wrongKind, reference), /solveKind 不一致/);

  const wrongOrder = clone(baseCandidate);
  wrongOrder.participants = ["BB", "BTN"];
  assert.throws(() => benchmarkGtoSolverResults(wrongOrder, reference), /participants 不一致/);
});

test("malformed duplicates and inconsistent shared node definitions fail loudly", () => {
  const reference = result(referenceNodes);

  const duplicateNode = clone(result(reorderedCandidateNodes));
  duplicateNode.nodes.push(clone(duplicateNode.nodes[0]));
  assert.throws(() => benchmarkGtoSolverResults(duplicateNode, reference), /nodes 存在重复 id/);

  const duplicateAction = clone(result(reorderedCandidateNodes));
  duplicateAction.nodes[0].actions[1].id = duplicateAction.nodes[0].actions[0].id;
  assert.throws(() => benchmarkGtoSolverResults(duplicateAction, reference), /actions 存在重复 id/);

  const duplicateHolding = clone(result(reorderedCandidateNodes));
  duplicateHolding.nodes[1].holdings.push(clone(duplicateHolding.nodes[1].holdings[0]));
  assert.throws(() => benchmarkGtoSolverResults(duplicateHolding, reference), /holdings 存在重复 id/);

  const mismatchedActions = clone(result(reorderedCandidateNodes));
  mismatchedActions.nodes[0].actions[0].id = "jam";
  assert.throws(() => benchmarkGtoSolverResults(mismatchedActions, reference), /action id 集合不一致/);
});

test("a benchmark requires a shared node and at least one shared positive-reach holding", () => {
  const reference = result(referenceNodes);
  const differentNode = clone(reorderedCandidateNodes[0]);
  differentNode.nodeId = "unrelated-node";
  assert.throws(() => benchmarkGtoSolverResults(result([differentNode]), reference), /没有共享 nodeId/);

  const noSharedHolding = clone(referenceNodes[0]);
  noSharedHolding.holdings = [{
    holding: "QcJc",
    reachProbability: 1,
    frequencies: [0.3, 0.4, 0.3],
  }];
  assert.throws(
    () => benchmarkGtoSolverResults(result([noSharedHolding]), reference),
    /没有 reference reach 大于 0 的同名 holding/,
  );
});
