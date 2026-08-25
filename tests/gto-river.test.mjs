import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeadsUpRiverGame,
  exactTinyRiverExploitability,
  headsUpRiverActionEvEntry,
  headsUpRiverStrategyEntry,
  solveHeadsUpRiver,
  solveHeadsUpRiverAdaptive,
} from "../lib/gto-river.ts";
import { RANGECRAFT_STANDARD_V1 } from "../lib/gto-standard.ts";

const card = (rank, suit) => ({ rank, suit });
const holding = (left, right, weight = 1) => ({ cards: [left, right], weight });

const BOARD = [
  card(14, "clubs"),
  card(13, "diamonds"),
  card(7, "spades"),
  card(4, "hearts"),
  card(2, "clubs"),
];

function riverSpec(overrides = {}) {
  return {
    board: BOARD,
    oopRange: [
      holding(card(14, "spades"), card(14, "diamonds")),
      holding(card(12, "spades"), card(11, "spades")),
    ],
    ipRange: [
      holding(card(13, "spades"), card(13, "clubs")),
      holding(card(10, "hearts"), card(9, "hearts")),
    ],
    potBb: 10,
    effectiveStackBb: 10,
    bettingTree: {
      betPotFractions: [1],
      raisePotAfterCallFractions: [1],
      maxRaises: 0,
      allInAlwaysAvailable: false,
    },
    ...overrides,
  };
}

function play(game, state, ...actions) {
  return actions.reduce((current, action) => game.nextState(current, action), state);
}

test("river chance deals weighted collision-aware ranges without leaking the opponent holding", () => {
  const model = createHeadsUpRiverGame(riverSpec({
    oopRange: [
      holding(card(14, "spades"), card(14, "diamonds"), 3),
      holding(card(12, "spades"), card(11, "spades"), 1),
    ],
    ipRange: [
      holding(card(13, "spades"), card(13, "clubs")),
      holding(card(14, "spades"), card(9, "hearts")),
    ],
  }));
  const outcomes = model.game.chanceOutcomes(model.game.initialState);

  assert.equal(model.compatibleDeals, 3);
  outcomes.map(({ probability }) => probability).forEach((probability, index) => {
    assert.ok(Math.abs(probability - [0.6, 0.2, 0.2][index]) < 1e-12);
  });

  const sameOopHoldingA = model.game.nextState(model.game.initialState, "deal:1");
  const sameOopHoldingB = model.game.nextState(model.game.initialState, "deal:2");
  const otherOopHolding = model.game.nextState(model.game.initialState, "deal:0");
  assert.equal(
    model.game.informationSet(sameOopHoldingA, 0),
    model.game.informationSet(sameOopHoldingB, 0),
    "OOP 信息集不得包含 IP 暗牌",
  );
  assert.notEqual(
    model.game.informationSet(sameOopHoldingA, 0),
    model.game.informationSet(otherOopHolding, 0),
  );
});

test("terminal utilities are zero-sum centered and return uncalled wagers", () => {
  const model = createHeadsUpRiverGame(riverSpec());
  const strong = model.game.nextState(model.game.initialState, "deal:0");
  const weakIntoSet = model.game.nextState(model.game.initialState, "deal:2");

  assert.equal(model.game.terminalUtility(play(model.game, strong, "check", "check")), 5);
  assert.equal(model.game.terminalUtility(play(model.game, weakIntoSet, "check", "check")), -5);
  assert.equal(model.game.terminalUtility(play(model.game, strong, "bet-to:10", "call")), 15);
  assert.equal(
    model.game.terminalUtility(play(model.game, strong, "bet-to:10", "fold")),
    5,
    "对手弃牌时自己的未跟注下注应原样退回",
  );
});

test("real river CFR+ converges and its scalable best response matches exact tiny-game enumeration", () => {
  const solution = solveHeadsUpRiver(riverSpec(), {
    iterations: 5_000,
    averagingDelay: 100,
    linearAveraging: true,
  });
  const model = createHeadsUpRiverGame(riverSpec());
  const exact = exactTinyRiverExploitability(model, solution.averageStrategy);

  assert.ok(solution.exploitability.exploitabilityPotFraction < 0.005, JSON.stringify(solution.exploitability));
  assert.ok(solution.exploitability.oopDeviationGainBb >= 0);
  assert.ok(solution.exploitability.ipDeviationGainBb >= 0);
  assert.ok(Math.abs(
    solution.exploitability.nashConvBb
      - solution.exploitability.oopDeviationGainBb
      - solution.exploitability.ipDeviationGainBb,
  ) < 1e-12);
  assert.ok(Math.abs(solution.exploitability.profileValueBb - exact.profileValue) < 1e-10);
  assert.ok(Math.abs(solution.exploitability.oopBestResponseValueBb - exact.player0BestResponseValue) < 1e-10);
  assert.ok(
    Math.abs(solution.exploitability.ipBestResponseValueForOopBb - exact.player1BestResponseValueForPlayer0) < 1e-10,
  );
  assert.equal(solution.source, "internal-solver");
  assert.equal(solution.algorithm, "cfr+");
  assert.equal(solution.solverParameters.updateSchedule, "alternating-player-0-first");
  assert.equal(solution.solverParameters.regretUpdateOrder, "add-then-rm+-clip");
  assert.match(solution.resultId, /^rc-hu-river-result-v1-/);
  assert.match(solution.spotId, /^rc-hu-river-spot-v1-/);
  assert.match(solution.gameSpecId, /^rc-hu-river-game-v1-/);
  assert.match(solution.treeId, /^rc-hu-river-tree-v1-/);
  assert.equal(solution.accuracyScope, "within-fixed-tree");
  assert.equal(solution.externalBenchmarkStatus, "not-run");

  for (const strategy of solution.strategies) {
    assert.equal(strategy.actions.length, strategy.frequencies.length);
    assert.ok(Math.abs(strategy.frequencies.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
    assert.ok(strategy.frequencies.every((value) => value >= 0 && value <= 1));
  }

  const strongOop = headsUpRiverStrategyEntry(solution, "oop", "AsAd");
  const weakOop = headsUpRiverStrategyEntry(solution, "oop", "QsJs");
  assert.ok(strongOop);
  assert.ok(weakOop);
  assert.ok(strongOop.probabilities[strongOop.actions.indexOf("bet-to:10")] > 0.5);
  assert.ok(weakOop.probabilities[weakOop.actions.indexOf("bet-to:10")] < 0.8);
  assert.throws(() => solution.averageStrategy[0].clear(), /只读结果/);
  assert.throws(
    () => solution.averageStrategy[0].forEach((_value, _key, exposedMap) => {
      exposedMap.set("injected", { actions: ["check"], probabilities: [1] });
    }),
    /只读结果/,
  );
  assert.equal(solution.averageStrategy[0].has("injected"), false);
});

test("river DCFR exposes paper parameters and converges on the same audited tree", () => {
  const solution = solveHeadsUpRiver(riverSpec(), {
    algorithm: "dcfr",
    iterations: 500,
  });

  assert.equal(solution.algorithm, "dcfr");
  assert.equal(solution.solverVersion, "rangecraft-dcfr/0.2.0");
  assert.equal(solution.solverParameters.averagingSchedule, "paper-polynomial");
  assert.equal(solution.solverParameters.regretUpdateOrder, "add-then-sign-discount");
  assert.equal(solution.solverParameters.numericPrecision, "float64");
  assert.deepEqual(solution.solverParameters.dcfr, { alpha: 1.5, beta: 0, gamma: 2 });
  assert.ok(solution.exploitability.exploitabilityPotFraction < 0.005);
  assert.equal(solution.convergence.mode, "fixed");
  assert.equal(solution.convergence.checkpoints.length, 1);
});

test("river PDCFR+ exposes paper parameters and is certified by exact best response", () => {
  const solution = solveHeadsUpRiver(riverSpec(), {
    algorithm: "pdcfr+",
    iterations: 100,
  });
  const exact = exactTinyRiverExploitability(
    createHeadsUpRiverGame(riverSpec()),
    solution.averageStrategy,
  );

  assert.equal(solution.algorithm, "pdcfr+");
  assert.equal(solution.solverVersion, "rangecraft-pdcfr+/0.1.0");
  assert.equal(
    solution.solverParameters.averagingSchedule,
    "alternating-paper-polynomial",
  );
  assert.equal(
    solution.solverParameters.regretUpdateOrder,
    "discount-add-clip-then-predict",
  );
  assert.deepEqual(solution.solverParameters.pdcfrPlus, { alpha: 2.3, gamma: 5 });
  assert.ok(solution.exploitability.exploitabilityPotFraction < 0.0001);
  assert.ok(Math.abs(
    solution.exploitability.exploitabilityBb - exact.exploitability,
  ) < 1e-10);
});

test("adaptive river PDCFR+ keeps checkpoint provenance and stops only after stable audits", () => {
  const solution = solveHeadsUpRiverAdaptive(riverSpec(), {
    algorithm: "pdcfr+",
    maxIterations: 100,
    checkpointInterval: 25,
    minimumIterations: 25,
    targetExploitabilityPotFraction: 0.001,
    requiredConsecutiveTargetCheckpoints: 2,
  });

  assert.equal(solution.algorithm, "pdcfr+");
  assert.equal(solution.solverVersion, "rangecraft-pdcfr+/0.1.0");
  assert.deepEqual(solution.solverParameters.pdcfrPlus, { alpha: 2.3, gamma: 5 });
  assert.equal(solution.convergence.mode, "adaptive");
  assert.equal(solution.convergence.stopReason, "target-stable");
  assert.equal(solution.convergence.consecutiveTargetCheckpoints, 2);
  assert.equal(solution.convergence.checkpoints.at(-1).targetMet, true);
  assert.ok(solution.convergence.trainedIterations >= 50);
  assert.ok(solution.exploitability.exploitabilityPotFraction <= 0.001);
});

test("adaptive river DCFR requires repeated audited passes and returns its best checkpoint", () => {
  const options = {
    algorithm: "dcfr",
    maxIterations: 600,
    checkpointInterval: 100,
    minimumIterations: 100,
    targetExploitabilityPotFraction: 0.005,
    requiredConsecutiveTargetCheckpoints: 2,
  };
  const first = solveHeadsUpRiverAdaptive(riverSpec(), options);
  const second = solveHeadsUpRiverAdaptive(riverSpec(), options);
  const minimumObserved = Math.min(
    ...first.convergence.checkpoints.map((checkpoint) => checkpoint.exploitabilityPotFraction),
  );

  assert.equal(first.convergence.mode, "adaptive");
  assert.equal(first.convergence.stopReason, "target-stable");
  assert.ok(first.convergence.consecutiveTargetCheckpoints >= 2);
  assert.ok(first.convergence.trainedIterations <= 600);
  assert.ok(first.iterations <= first.convergence.trainedIterations);
  assert.ok(Math.abs(first.exploitability.exploitabilityPotFraction - minimumObserved) < 1e-15);
  assert.deepEqual(first.convergence, second.convergence);
  assert.deepEqual(first.strategies, second.strategies);
  assert.ok(Object.isFrozen(first.convergence));
  assert.ok(Object.isFrozen(first.convergence.checkpoints));
});

test("adaptive CFR+ cannot pass its target before delayed averaging starts", () => {
  const solution = solveHeadsUpRiverAdaptive(riverSpec(), {
    algorithm: "cfr+",
    maxIterations: 100,
    checkpointInterval: 10,
    minimumIterations: 10,
    targetExploitabilityPotFraction: 100,
    requiredConsecutiveTargetCheckpoints: 1,
    averagingDelay: 99,
    linearAveraging: true,
  });

  assert.equal(solution.convergence.stopReason, "target-stable");
  assert.equal(solution.convergence.trainedIterations, 100);
  assert.equal(solution.convergence.selectedIterations, 100);
  assert.equal(solution.convergence.checkpoints.at(-2).targetMet, false);
  assert.equal(solution.convergence.checkpoints.at(-1).targetMet, true);
});

test("river solution reports immutable acting-player counterfactual action EVs", () => {
  const solution = solveHeadsUpRiver(riverSpec(), {
    iterations: 5_000,
    averagingDelay: 100,
    linearAveraging: true,
  });
  const informationSetCount = solution.averageStrategy[0].size + solution.averageStrategy[1].size;

  assert.equal(solution.actionValues.length, informationSetCount);
  assert.ok(Object.isFrozen(solution.actionValues));
  for (const actionValue of solution.actionValues) {
    const strategy = headsUpRiverStrategyEntry(
      solution,
      actionValue.player,
      actionValue.holding,
      actionValue.history,
    );
    assert.ok(strategy);
    assert.deepEqual(actionValue.actions, strategy.actions);
    assert.equal(actionValue.actionEvBb.length, strategy.probabilities.length);
    assert.ok(actionValue.actionEvBb.every(Number.isFinite));
    assert.ok(actionValue.counterfactualReach >= 0 && actionValue.counterfactualReach <= 1);
    assert.ok(Object.isFrozen(actionValue));
    assert.ok(Object.isFrozen(actionValue.actions));
    assert.ok(Object.isFrozen(actionValue.actionEvBb));
  }

  const acesFacingBet = headsUpRiverActionEvEntry(
    solution,
    "oop",
    "AsAd",
    "check>bet-to:10",
  );
  assert.ok(acesFacingBet);
  const bestIndex = acesFacingBet.actionEvBb.indexOf(Math.max(...acesFacingBet.actionEvBb));
  assert.equal(acesFacingBet.actions[bestIndex], "call");
  assert.ok(Math.abs(acesFacingBet.actionEvBb[acesFacingBet.actions.indexOf("fold")] - -5) < 1e-12);
  assert.ok(Math.abs(acesFacingBet.actionEvBb[acesFacingBet.actions.indexOf("call")] - 15) < 1e-12);
  assert.throws(() => {
    acesFacingBet.actionEvBb[0] = 0;
  }, TypeError);
  assert.throws(() => solution.actionValues.push(acesFacingBet), TypeError);
});

test("default river abstraction references Standard v1 as a template without impersonating its identity", () => {
  const model = createHeadsUpRiverGame({
    ...riverSpec(),
    effectiveStackBb: 100,
    bettingTree: undefined,
  });
  const firstDeal = model.game.nextState(model.game.initialState, "deal:0");

  assert.notEqual(model.gameSpecId, RANGECRAFT_STANDARD_V1.gameSpecId);
  assert.notEqual(model.treeId, RANGECRAFT_STANDARD_V1.treeId);
  assert.deepEqual(model.standardTemplate, {
    gameSpecId: RANGECRAFT_STANDARD_V1.gameSpecId,
    treeId: RANGECRAFT_STANDARD_V1.treeId,
  });
  assert.deepEqual(model.game.actions(firstDeal), ["check", "bet-to:7.5", "bet-to:12.5", "bet-to:100"]);
});

test("spot identity covers board, ranges, weights, pot and stack while ignoring serialization order", () => {
  const base = riverSpec();
  const first = createHeadsUpRiverGame(base);
  const reordered = createHeadsUpRiverGame({
    ...base,
    board: [...base.board].reverse(),
    oopRange: [...base.oopRange].reverse().map((entry) => ({
      ...entry,
      cards: [...entry.cards].reverse(),
    })),
    ipRange: [...base.ipRange].reverse(),
  });
  assert.equal(first.spotId, reordered.spotId);
  assert.notEqual(first.spotId, createHeadsUpRiverGame({ ...base, potBb: 11 }).spotId);
  assert.notEqual(first.spotId, createHeadsUpRiverGame({ ...base, effectiveStackBb: 9 }).spotId);
  assert.notEqual(first.spotId, createHeadsUpRiverGame({
    ...base,
    oopRange: base.oopRange.map((entry, index) => ({ ...entry, weight: index === 0 ? 2 : 1 })),
  }).spotId);
});

test("custom trees enforce minimum bets and full raises, while allowing a short all-in", () => {
  const noTinyBet = createHeadsUpRiverGame(riverSpec({
    potBb: 0.5,
    effectiveStackBb: 10,
    bettingTree: {
      betPotFractions: [0.5],
      raisePotAfterCallFractions: [0.01],
      maxRaises: 1,
      allInAlwaysAvailable: false,
    },
  }));
  const tinyRoot = noTinyBet.game.nextState(noTinyBet.game.initialState, "deal:0");
  assert.deepEqual(noTinyBet.game.actions(tinyRoot), ["check"]);

  const fullRaiseOnly = createHeadsUpRiverGame(riverSpec({
    potBb: 1,
    effectiveStackBb: 100,
    bettingTree: {
      betPotFractions: [1],
      raisePotAfterCallFractions: [0.01],
      maxRaises: 1,
      allInAlwaysAvailable: false,
    },
  }));
  const fullRaiseRoot = fullRaiseOnly.game.nextState(fullRaiseOnly.game.initialState, "deal:0");
  const facingBet = fullRaiseOnly.game.nextState(fullRaiseRoot, "bet-to:1");
  assert.deepEqual(fullRaiseOnly.game.actions(facingBet), ["fold", "call"]);

  const shortAllIn = createHeadsUpRiverGame(riverSpec({
    potBb: 1,
    effectiveStackBb: 1.5,
    bettingTree: {
      betPotFractions: [1],
      raisePotAfterCallFractions: [0.01],
      maxRaises: 2,
      allInAlwaysAvailable: true,
    },
  }));
  const shortRoot = shortAllIn.game.nextState(shortAllIn.game.initialState, "deal:0");
  const shortFacingBet = shortAllIn.game.nextState(shortRoot, "bet-to:1");
  assert.deepEqual(shortAllIn.game.actions(shortFacingBet), ["fold", "call", "raise-to:1.5"]);
  const facingShortRaise = shortAllIn.game.nextState(shortFacingBet, "raise-to:1.5");
  assert.deepEqual(shortAllIn.game.actions(facingShortRaise), ["fold", "call"]);
});

test("unconverged deep solutions remain experimental even above one pot of exploitability", () => {
  const solution = solveHeadsUpRiver({
    ...riverSpec(),
    potBb: 1,
    effectiveStackBb: 100,
    bettingTree: undefined,
  }, { iterations: 0 });

  assert.ok(solution.exploitability.exploitabilityPotFraction > 1);
  assert.equal(solution.accuracyLevel, "experimental");
});

test("river solver rejects card collisions, duplicate combos and impossible ranges", () => {
  assert.throws(
    () => createHeadsUpRiverGame(riverSpec({
      oopRange: [holding(card(14, "clubs"), card(14, "diamonds"))],
    })),
    /公共牌冲突/,
  );
  assert.throws(
    () => createHeadsUpRiverGame(riverSpec({
      oopRange: [
        holding(card(14, "spades"), card(14, "diamonds")),
        holding(card(14, "diamonds"), card(14, "spades")),
      ],
    })),
    /重复组合/,
  );
  assert.throws(
    () => createHeadsUpRiverGame(riverSpec({
      oopRange: [holding(card(14, "spades"), card(14, "diamonds"))],
      ipRange: [holding(card(14, "spades"), card(14, "diamonds"))],
    })),
    /没有任何合法的兼容发牌/,
  );

  const mutableBoardCard = card(14, "clubs");
  const immutable = createHeadsUpRiverGame(riverSpec({
    board: [mutableBoardCard, ...BOARD.slice(1)],
  }));
  mutableBoardCard.rank = 2;
  assert.equal(immutable.spec.board[0].rank, 14);
  assert.ok(Object.isFrozen(immutable.spec.board[0]));
  assert.ok(Object.isFrozen(immutable.spec.oopRange[0].cards[0]));

  const root = immutable.game.nextState(immutable.game.initialState, "deal:0");
  const rootInformationSet = immutable.game.informationSet(root, 0);
  const profileWithIllegalAction = [
    new Map([[rootInformationSet, {
      actions: ["check", "bet-to:10", "jam"],
      probabilities: [0.5, 0.5, 0],
    }]]),
    new Map(),
  ];
  assert.throws(
    () => immutable.exploitability(profileWithIllegalAction),
    /合法动作|legal actions/,
  );
  assert.throws(
    () => immutable.exploitability([new Map(), new Map()]),
    /missing information set|缺少信息集/,
  );
});
