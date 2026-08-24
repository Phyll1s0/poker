import assert from "node:assert/strict";
import test from "node:test";

import {
  createThreeWayRiverGame,
  createThreeWayRiverSolverSession,
  solveThreeWayRiver,
  threeWayRiverActionEvEntry,
  threeWayRiverStrategyEntry,
} from "../lib/gto-threeway-river.ts";

const card = (rank, suit) => ({ rank, suit });
const holding = (left, right, weight = 1) => ({ cards: [left, right], weight });

const BOARD = [
  card(14, "clubs"),
  card(13, "diamonds"),
  card(7, "spades"),
  card(4, "hearts"),
  card(2, "clubs"),
];

function threeWaySpec(overrides = {}) {
  return {
    board: BOARD,
    ranges: [
      [holding(card(14, "spades"), card(14, "diamonds"))],
      [holding(card(13, "spades"), card(13, "clubs"))],
      [holding(card(12, "spades"), card(11, "spades"))],
    ],
    potBb: 12,
    stackBb: [12, 12, 12],
    bettingTree: { betPotFractions: [1], allInAlwaysAvailable: false },
    ...overrides,
  };
}

function firstDeal(model) {
  return model.game.nextState(model.game.initialState, "deal:0");
}

function play(game, state, ...actions) {
  return actions.reduce((current, action) => game.nextState(current, action), state);
}

function collectInformationSets(model) {
  const result = [new Map(), new Map(), new Map()];
  const visit = (state) => {
    const actor = model.game.currentActor(state);
    if (actor === "terminal") return;
    if (actor === "chance") {
      for (const outcome of model.game.chanceOutcomes(state)) {
        visit(model.game.nextState(state, outcome.action));
      }
      return;
    }
    const informationSet = model.game.informationSet(state, actor);
    const actions = [...model.game.actions(state)];
    const existing = result[actor].get(informationSet);
    if (existing) assert.deepEqual(existing, actions);
    else result[actor].set(informationSet, actions);
    for (const action of actions) visit(model.game.nextState(state, action));
  };
  visit(model.game.initialState);
  return result;
}

function deterministicMixedProfile(informationSets) {
  return informationSets.map((player, playerIndex) => new Map(
    [...player].map(([informationSet, actions], informationSetIndex) => {
      const raw = actions.map((_action, actionIndex) => (
        1 + ((playerIndex + 2) * (informationSetIndex + 3) * (actionIndex + 5)) % 11
      ));
      const total = raw.reduce((sum, value) => sum + value, 0);
      return [informationSet, {
        actions,
        probabilities: raw.map((value) => value / total),
      }];
    }),
  ));
}

function independentlyEvaluateProfile(model, profile) {
  const evaluate = (state) => {
    const actor = model.game.currentActor(state);
    if (actor === "terminal") return [...model.game.terminalUtilities(state)];
    if (actor === "chance") {
      const total = [0, 0, 0];
      for (const outcome of model.game.chanceOutcomes(state)) {
        const child = evaluate(model.game.nextState(state, outcome.action));
        child.forEach((value, player) => { total[player] += outcome.probability * value; });
      }
      return total;
    }
    const actions = model.game.actions(state);
    const informationSet = model.game.informationSet(state, actor);
    const entry = profile[actor].get(informationSet);
    assert.ok(entry, `missing ${informationSet}`);
    const probabilityByAction = new Map(entry.actions.map((action, index) => [action, entry.probabilities[index]]));
    const total = [0, 0, 0];
    for (const action of actions) {
      const probability = probabilityByAction.get(action);
      assert.notEqual(probability, undefined, `missing ${informationSet}.${action}`);
      const child = evaluate(model.game.nextState(state, action));
      child.forEach((value, player) => { total[player] += probability * value; });
    }
    return total;
  };
  return evaluate(model.game.initialState);
}

function independentlyEnumeratedBestResponse(model, profile, player, informationSets) {
  const entries = [...informationSets[player]];
  const policyCount = entries.reduce((count, [, actions]) => count * actions.length, 1);
  assert.ok(policyCount <= 100_000, `pure-policy oracle unexpectedly large: ${policyCount}`);
  let best = Number.NEGATIVE_INFINITY;
  for (let encoded = 0; encoded < policyCount; encoded += 1) {
    let cursor = encoded;
    const response = new Map();
    for (const [informationSet, actions] of entries) {
      const chosenIndex = cursor % actions.length;
      cursor = Math.floor(cursor / actions.length);
      response.set(informationSet, {
        actions,
        probabilities: actions.map((_action, actionIndex) => actionIndex === chosenIndex ? 1 : 0),
      });
    }
    const deviated = profile.map((strategy, index) => index === player ? response : strategy);
    best = Math.max(best, independentlyEvaluateProfile(model, deviated)[player]);
  }
  return best;
}

test("three-way river chance uses product weights, rejects collisions, and hides both opponent holdings", () => {
  const model = createThreeWayRiverGame(threeWaySpec({
    ranges: [
      [
        holding(card(14, "spades"), card(14, "diamonds"), 3),
        holding(card(12, "hearts"), card(11, "hearts"), 1),
      ],
      [
        holding(card(13, "spades"), card(13, "clubs"), 1),
        holding(card(14, "spades"), card(9, "hearts"), 1),
      ],
      [
        holding(card(10, "spades"), card(9, "spades"), 2),
        holding(card(12, "hearts"), card(8, "diamonds"), 1),
      ],
    ],
  }));
  const outcomes = model.game.chanceOutcomes(model.game.initialState);

  assert.equal(model.compatibleDeals, 4);
  assert.ok(Math.abs(outcomes.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) < 1e-12);
  outcomes.map((outcome) => outcome.probability).forEach((probability, index) => {
    assert.ok(Math.abs(probability - [6 / 13, 3 / 13, 2 / 13, 2 / 13][index]) < 1e-12);
  });

  const sameOopA = model.game.nextState(model.game.initialState, "deal:0");
  const sameOopB = model.game.nextState(model.game.initialState, "deal:1");
  const differentOop = model.game.nextState(model.game.initialState, "deal:2");
  assert.equal(model.game.informationSet(sameOopA, 0), model.game.informationSet(sameOopB, 0));
  assert.notEqual(model.game.informationSet(sameOopA, 0), model.game.informationSet(differentOop, 0));
});

test("public action order is OOP to middle to IP, then wraps after a bet without raises", () => {
  const model = createThreeWayRiverGame(threeWaySpec());
  const root = firstDeal(model);
  assert.equal(model.game.currentActor(root), 0);
  assert.deepEqual(model.game.actions(root), ["check", "bet-to:12"]);

  const middle = model.game.nextState(root, "check");
  assert.equal(model.game.currentActor(middle), 1);
  const facingMiddleBet = model.game.nextState(middle, "bet-to:12");
  assert.equal(model.game.currentActor(facingMiddleBet), 2);
  assert.deepEqual(model.game.actions(facingMiddleBet), ["fold", "call"]);
  const oopRespondsLast = model.game.nextState(facingMiddleBet, "fold");
  assert.equal(model.game.currentActor(oopRespondsLast), 0);
  assert.deepEqual(model.game.actions(oopRespondsLast), ["fold", "call"]);
  const terminal = model.game.nextState(oopRespondsLast, "call");
  assert.equal(model.game.currentActor(terminal), "terminal");

  const checkedDown = play(model.game, root, "check", "check", "check");
  assert.equal(model.game.currentActor(checkedDown), "terminal");
});

test("a public prefix makes CFR and audit start at the current conditional node", () => {
  const rootModel = createThreeWayRiverGame(threeWaySpec());
  const currentModel = createThreeWayRiverGame(threeWaySpec({
    startingHistory: ["check", "check"],
  }));
  const current = firstDeal(currentModel);

  assert.equal(currentModel.game.currentActor(current), 2);
  assert.deepEqual(current.history, ["check", "check"]);
  assert.match(currentModel.game.informationSet(current, 2), /\|check>check$/);
  assert.notEqual(currentModel.spotId, rootModel.spotId);
  assert.throws(() => createThreeWayRiverGame(threeWaySpec({
    startingHistory: ["check", "check", "check"],
  })), /已经结束|已经终局/);
  assert.throws(() => createThreeWayRiverGame(threeWaySpec({
    startingHistory: ["bet-to:12", "raise-to:24"],
  })), /不允许动作/);
});

test("three-player utilities are centered zero-sum and settle folds, unequal all-ins, and side pots", () => {
  const model = createThreeWayRiverGame(threeWaySpec({
    potBb: 12,
    stackBb: [12, 4, 12],
  }));
  const root = firstDeal(model);
  const checkdown = play(model.game, root, "check", "check", "check");
  assert.deepEqual(model.terminalUtilities(checkdown), [8, -4, -4]);

  const allCall = play(model.game, root, "bet-to:12", "call", "call");
  const allCallUtilities = model.terminalUtilities(allCall);
  assert.deepEqual(allCallUtilities, [24, -8, -16]);
  assert.equal(allCallUtilities.reduce((sum, utility) => sum + utility, 0), 0);

  const folds = play(model.game, root, "bet-to:12", "fold", "fold");
  assert.deepEqual(model.terminalUtilities(folds), [8, -4, -4], "未跟注下注必须返还给下注者");
});

test("three-way CFR+ publishes fixed-tree diagnostics, action EVs, stable IDs, and immutable strategies", () => {
  const spec = threeWaySpec();
  const solution = solveThreeWayRiver(spec, {
    iterations: 2_000,
    averagingDelay: 50,
    linearAveraging: true,
  });
  const reordered = createThreeWayRiverGame({
    ...spec,
    board: [...spec.board].reverse(),
    ranges: spec.ranges.map((range) => range.map((entry) => ({
      ...entry,
      cards: [...entry.cards].reverse(),
    }))),
  });

  assert.equal(solution.source, "internal-solver");
  assert.equal(solution.accuracyScope, "within-fixed-tree");
  assert.equal(solution.approximation.actionTree, "single-bet-no-raise");
  assert.match(solution.approximation.caveat, /不具有.*收敛保证/);
  assert.match(solution.spotId, /^rc-3way-river-spot-v1-/);
  assert.equal(solution.spotId, reordered.spotId);
  assert.equal(solution.audit.profileValueBb.reduce((sum, value) => sum + value, 0), 0);
  assert.ok(solution.audit.perPlayerGainBb.every((value) => value >= 0));
  assert.ok(solution.audit.nashConvBb < 0.05, JSON.stringify(solution.audit));
  assert.equal(solution.audit.nashConvPotFraction, solution.audit.nashConvBb / spec.potBb);

  for (const strategy of solution.strategies) {
    assert.equal(strategy.actions.length, strategy.frequencies.length);
    assert.ok(Math.abs(strategy.frequencies.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
    assert.ok(strategy.frequencies.every((value) => value >= 0 && value <= 1));
  }
  const oop = threeWayRiverStrategyEntry(solution, "oop", "AsAd");
  assert.ok(oop);
  const oopEv = threeWayRiverActionEvEntry(solution, "oop", "AsAd");
  assert.ok(oopEv);
  assert.deepEqual(oopEv.actions, oop.actions);
  assert.equal(oopEv.actionEvBb.length, oop.actions.length);
  assert.ok(oopEv.actionEvBb.every(Number.isFinite));
  assert.throws(() => solution.averageStrategy[0].clear(), /只读结果/);
  assert.throws(() => solution.strategies.push(solution.strategies[0]), TypeError);
});

test("three-way audit exactly matches an independent exhaustive pure-policy oracle", () => {
  const model = createThreeWayRiverGame(threeWaySpec({
    potBb: 6,
    stackBb: [4, 4, 4],
    ranges: [
      [
        holding(card(14, "spades"), card(14, "diamonds")),
        holding(card(14, "hearts"), card(8, "hearts")),
      ],
      [
        holding(card(13, "spades"), card(13, "clubs")),
        holding(card(13, "hearts"), card(8, "diamonds")),
      ],
      [
        holding(card(12, "spades"), card(11, "spades")),
        holding(card(12, "diamonds"), card(11, "diamonds")),
      ],
    ],
    bettingTree: { betPotFractions: [0.5], allInAlwaysAvailable: false },
  }));
  const informationSets = collectInformationSets(model);
  const profile = deterministicMixedProfile(informationSets);
  const independentProfileValue = independentlyEvaluateProfile(model, profile);
  const independentBestResponses = [0, 1, 2].map((player) =>
    independentlyEnumeratedBestResponse(model, profile, player, informationSets));
  const independentGains = independentBestResponses.map((value, player) => value - independentProfileValue[player]);
  independentGains.forEach((gain) => assert.ok(gain >= -1e-10, `raw best-response gain ${gain}`));
  const audit = model.audit(profile);

  independentProfileValue.forEach((value, player) => {
    assert.ok(Math.abs(value - audit.profileValueBb[player]) < 1e-10);
    assert.ok(Math.abs(independentBestResponses[player] - audit.bestResponseValueBb[player]) < 1e-10);
    assert.ok(Math.abs(independentGains[player] - audit.perPlayerGainBb[player]) < 1e-10);
  });
  assert.ok(Math.abs(independentGains.reduce((sum, gain) => sum + gain, 0) - audit.nashConvBb) < 1e-10);
});

test("resumable three-way sessions match a one-shot solve exactly", () => {
  const spec = threeWaySpec();
  const options = { averagingDelay: 15, linearAveraging: true };
  const session = createThreeWayRiverSolverSession(spec, options);
  const first = session.run(40);
  const second = session.run(60);
  const chunked = session.solution();
  const oneShot = solveThreeWayRiver(spec, { ...options, iterations: 100 });

  assert.equal(first.iterations, 40);
  assert.equal(second.iterations, 100);
  assert.equal(session.iterations, 100);
  assert.deepEqual(chunked.strategies, oneShot.strategies);
  assert.deepEqual(chunked.actionValues, oneShot.actionValues);
  assert.deepEqual(chunked.audit, oneShot.audit);
});
