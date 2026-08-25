import assert from "node:assert/strict";
import test from "node:test";

import {
  CFRPlusSolver,
  DiscountedCFRSolver,
  exactExploitability,
  expectedValue,
  solveCFRPlus,
  solveDiscountedCFR,
} from "../lib/gto-cfr.ts";

const CARDS = ["J", "Q", "K"];
const DEALS = ["JQ", "JK", "QJ", "QK", "KJ", "KQ"];
const TERMINAL_HISTORIES = new Set(["pp", "bp", "bb", "pbp", "pbb"]);

function kuhnGame() {
  return {
    initialState: { cards: null, history: "" },
    currentActor(state) {
      if (state.cards === null) return "chance";
      if (TERMINAL_HISTORIES.has(state.history)) return "terminal";
      return state.history === "" || state.history === "pb" ? 0 : 1;
    },
    actions(state) {
      if (state.cards === null) return DEALS;
      return ["p", "b"];
    },
    nextState(state, action) {
      if (state.cards === null) {
        return { cards: [action[0], action[1]], history: "" };
      }
      return { cards: state.cards, history: state.history + action };
    },
    informationSet(state, player) {
      return `${state.cards[player]}:${state.history}`;
    },
    chanceOutcomes() {
      return DEALS.map((action) => ({ action, probability: 1 / DEALS.length }));
    },
    terminalUtility(state) {
      const [player0Card, player1Card] = state.cards;
      if (state.history === "bp") return 1;
      if (state.history === "pbp") return -1;
      const player0Wins = CARDS.indexOf(player0Card) > CARDS.indexOf(player1Card);
      const stake = state.history === "pp" ? 1 : 2;
      return player0Wins ? stake : -stake;
    },
  };
}

function probability(profile, player, informationSet, action) {
  const entry = profile[player].get(informationSet);
  assert.ok(entry, `missing information set ${informationSet}`);
  const index = entry.actions.indexOf(action);
  assert.notEqual(index, -1, `missing action ${action}`);
  return entry.probabilities[index];
}

function serializeProfile(profile) {
  return profile.map((player) =>
    [...player].map(([informationSet, entry]) => [
      informationSet,
      [...entry.actions],
      [...entry.probabilities],
    ]),
  );
}

function asymmetricMatrixGame() {
  const payoff = [[3, 0], [0, 1]];
  return {
    initialState: { row: null, column: null },
    currentActor(state) {
      if (state.row === null) return 0;
      if (state.column === null) return 1;
      return "terminal";
    },
    actions() {
      return ["0", "1"];
    },
    nextState(state, action) {
      return state.row === null
        ? { row: Number(action), column: null }
        : { row: state.row, column: Number(action) };
    },
    informationSet(_state, player) {
      return `matrix:p${player}`;
    },
    chanceOutcomes() {
      return [];
    },
    terminalUtility(state) {
      return payoff[state.row][state.column];
    },
  };
}

test("CFR+ is deterministic and emits normalized behavioral strategies", () => {
  const options = { iterations: 20_000, averagingDelay: 100, linearAveraging: true };
  const first = solveCFRPlus(kuhnGame(), options);
  const second = solveCFRPlus(kuhnGame(), options);

  assert.deepEqual(
    serializeProfile(first.averageStrategy),
    serializeProfile(second.averageStrategy),
  );
  assert.equal(first.iterations, 20_000);

  for (const player of first.averageStrategy) {
    assert.equal(player.size, 6);
    for (const { actions, probabilities } of player.values()) {
      assert.equal(actions.length, probabilities.length);
      assert.ok(probabilities.every((value) => value >= 0 && value <= 1));
      assert.ok(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
    }
  }
});

test("chunked CFR+ training is bit-for-bit identical to a one-shot run", () => {
  const oneShot = new CFRPlusSolver(kuhnGame()).run({
    iterations: 12_000,
    averagingDelay: 50,
  });
  const chunkedSolver = new CFRPlusSolver(kuhnGame());
  chunkedSolver.run({ iterations: 4_000, averagingDelay: 50 });
  const chunked = chunkedSolver.run({ iterations: 8_000, averagingDelay: 50 });

  assert.deepEqual(
    serializeProfile(chunked.averageStrategy),
    serializeProfile(oneShot.averageStrategy),
  );
});

test("CFR+ converges to Kuhn poker's known value with low exact exploitability", () => {
  const solved = solveCFRPlus(kuhnGame(), {
    iterations: 60_000,
    averagingDelay: 100,
    linearAveraging: true,
  });
  const value = expectedValue(kuhnGame(), solved.averageStrategy);
  const audit = exactExploitability(kuhnGame(), solved.averageStrategy);

  // With a one-chip ante and one-chip bet, player 0's Nash value is -1/18.
  assert.ok(Math.abs(value - -1 / 18) < 8e-4, `value ${value}`);
  assert.ok(audit.exploitability < 0.0025, `exploitability ${audit.exploitability}`);
  assert.ok(audit.nashConv < 0.005, `NashConv ${audit.nashConv}`);
  assert.deepEqual(audit.deterministicPolicies, [64, 64]);

  // Known qualitative Kuhn equilibrium: J opens rarely, K opens often, and Q
  // never calls with certainty. Exact frequencies need not be unique.
  assert.ok(probability(solved.averageStrategy, 0, "J:", "b") < 0.5);
  assert.ok(probability(solved.averageStrategy, 0, "K:", "b") > 0.5);
  assert.ok(probability(solved.averageStrategy, 1, "Q:b", "b") < 0.7);
});

test("one alternating CFR+ round uses the proved staggered average phase", () => {
  const solved = solveCFRPlus(asymmetricMatrixGame(), {
    iterations: 1,
    averagingDelay: 0,
    linearAveraging: true,
  });

  assert.deepEqual(
    solved.averageStrategy[0].get("matrix:p0").probabilities,
    [1, 0],
  );
  assert.deepEqual(
    solved.averageStrategy[1].get("matrix:p1").probabilities,
    [0.5, 0.5],
  );
  assert.deepEqual(solved.currentStrategy[0].get("matrix:p0").probabilities, [1, 0]);
  assert.deepEqual(solved.currentStrategy[1].get("matrix:p1").probabilities, [0, 1]);
});

test("DCFR(1.5, 0, 2) is deterministic and chunked training equals one shot", () => {
  const first = solveDiscountedCFR(kuhnGame(), { iterations: 12_000 });
  const second = solveDiscountedCFR(kuhnGame(), { iterations: 12_000 });
  const chunkedSolver = new DiscountedCFRSolver(kuhnGame());
  chunkedSolver.run({ iterations: 4_000 });
  const chunked = chunkedSolver.run({ iterations: 8_000 });

  assert.deepEqual(
    serializeProfile(first.averageStrategy),
    serializeProfile(second.averageStrategy),
  );
  assert.deepEqual(
    serializeProfile(chunked.averageStrategy),
    serializeProfile(first.averageStrategy),
  );
  assert.deepEqual(first.parameters, { alpha: 1.5, beta: 0, gamma: 2 });
  assert.ok(Object.isFrozen(first.parameters));
});

test("paper-default DCFR converges to Kuhn poker's equilibrium", () => {
  const solved = solveDiscountedCFR(kuhnGame(), { iterations: 30_000 });
  const value = expectedValue(kuhnGame(), solved.averageStrategy);
  const audit = exactExploitability(kuhnGame(), solved.averageStrategy);

  assert.ok(Math.abs(value - -1 / 18) < 8e-4, `value ${value}`);
  assert.ok(audit.exploitability < 0.0025, `exploitability ${audit.exploitability}`);
  assert.ok(audit.nashConv < 0.005, `NashConv ${audit.nashConv}`);
});

test("DCFR recurrence keeps negative regret and applies quadratic iterate weights", () => {
  const first = solveDiscountedCFR(asymmetricMatrixGame(), { iterations: 1 });
  const second = solveDiscountedCFR(asymmetricMatrixGame(), { iterations: 2 });

  assert.deepEqual(first.averageStrategy[0].get("matrix:p0").probabilities, [0.5, 0.5]);
  assert.deepEqual(first.averageStrategy[1].get("matrix:p1").probabilities, [0.5, 0.5]);
  assert.deepEqual(second.averageStrategy[0].get("matrix:p0").probabilities, [0.9, 0.1]);
  assert.deepEqual(second.averageStrategy[1].get("matrix:p1").probabilities, [0.1, 0.9]);
  assert.deepEqual(second.currentStrategy[0].get("matrix:p0").probabilities, [0.25, 0.75]);
  assert.deepEqual(second.currentStrategy[1].get("matrix:p1").probabilities, [0, 1]);
});

test("DCFR rejects non-finite paper parameters", () => {
  assert.throws(
    () => new DiscountedCFRSolver(kuhnGame(), { alpha: Number.POSITIVE_INFINITY }),
    /alpha must be finite/,
  );
  assert.throws(
    () => solveDiscountedCFR(kuhnGame(), { iterations: 1, gamma: Number.NaN }),
    /gamma must be finite/,
  );
});

test("exact exploitability detects the uniform Kuhn strategy as exploitable", () => {
  const unsolved = solveCFRPlus(kuhnGame(), { iterations: 0 });
  assert.throws(
    () => exactExploitability(kuhnGame(), unsolved.averageStrategy),
    /missing information set/,
  );
  const audit = exactExploitability(kuhnGame(), unsolved.averageStrategy, {
    missingInformationSets: "uniform",
  });

  assert.ok(Math.abs(audit.profileValue - 0.125) < 1e-12);
  assert.ok(audit.exploitability > 0.4);
  assert.ok(audit.player0BestResponseValue > audit.profileValue);
  assert.ok(audit.player1BestResponseValueForPlayer0 < audit.profileValue);
});

test("strategy evaluation rejects extra, duplicate and missing legal actions", () => {
  const profile = (actions, probabilities) => [
    new Map([["J:", { actions, probabilities }]]),
    new Map(),
  ];

  assert.throws(
    () => expectedValue(kuhnGame(), profile(["p", "b", "x"], [0.5, 0.5, 0])),
    /do not exactly match the legal actions/,
  );
  assert.throws(
    () => expectedValue(kuhnGame(), profile(["p", "p"], [0.5, 0.5])),
    /duplicate action/,
  );
  assert.throws(
    () => expectedValue(kuhnGame(), profile(["p"], [1])),
    /do not exactly match the legal actions/,
  );
});
