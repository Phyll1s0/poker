import assert from "node:assert/strict";
import test from "node:test";

import {
  MultiwayCFRPlusSolver,
  expectedMultiwayUtilities,
  solveMultiwayCFRPlus,
} from "../lib/gto-multiway-cfr.ts";

/**
 * Three-player constant-sum toy game.  Chance first chooses the stakes.  The
 * players then act without observing chance or earlier actions:
 * - player 0 wants its H/T choice to match player 1;
 * - player 1 wants it not to match;
 * - player 2 has a strictly dominant A action;
 * - player 2's payoff is funded equally by players 0 and 1, preserving sum 0.
 */
function threePlayerConstantSumGame() {
  return {
    playerCount: 3,
    initialState: { scale: null, choices: [] },
    currentActor(state) {
      if (state.scale === null) return "chance";
      if (state.choices.length === 3) return "terminal";
      return state.choices.length;
    },
    actions(state) {
      if (state.scale === null) return ["single", "double"];
      return state.choices.length < 2 ? ["H", "T"] : ["A", "B"];
    },
    nextState(state, action) {
      if (state.scale === null) {
        return { scale: action === "single" ? 1 : 2, choices: [] };
      }
      return { scale: state.scale, choices: [...state.choices, action] };
    },
    informationSet(_state, player) {
      return `player-${player}`;
    },
    chanceOutcomes() {
      return [
        { action: "single", probability: 0.75 },
        { action: "double", probability: 0.25 },
      ];
    },
    terminalUtilities(state) {
      const [player0, player1, player2] = state.choices;
      const contest = (player0 === player1 ? 1 : -1) * state.scale;
      const sideGame = (player2 === "A" ? 1 : -1) * state.scale;
      return [contest - sideGame / 2, -contest - sideGame / 2, sideGame];
    },
  };
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

function probability(profile, player, action) {
  const entry = profile[player].get(`player-${player}`);
  assert.ok(entry);
  const index = entry.actions.indexOf(action);
  assert.notEqual(index, -1);
  return entry.probabilities[index];
}

function forceAction(profile, player, chosenAction) {
  return profile.map((strategy, index) => {
    if (index !== player) return strategy;
    const entry = strategy.get(`player-${player}`);
    assert.ok(entry);
    return new Map([
      [
        `player-${player}`,
        {
          actions: [...entry.actions],
          probabilities: entry.actions.map((action) =>
            action === chosenAction ? 1 : 0,
          ),
        },
      ],
    ]);
  });
}

function totalUnilateralDeviationGain(game, profile) {
  const base = expectedMultiwayUtilities(game, profile);
  let total = 0;
  for (let player = 0; player < game.playerCount; player += 1) {
    const entry = profile[player].get(`player-${player}`);
    const actions = entry?.actions ?? (player < 2 ? ["H", "T"] : ["A", "B"]);
    let best = Number.NEGATIVE_INFINITY;
    for (const action of actions) {
      const deviated = forceAction(
        // A zero-iteration profile has no exported nodes, so materialize the
        // toy game's known uniform legal strategy before forcing an action.
        profile.map((strategy, index) =>
          strategy.size > 0
            ? strategy
            : new Map([
                [
                  `player-${index}`,
                  {
                    actions: index < 2 ? ["H", "T"] : ["A", "B"],
                    probabilities: [0.5, 0.5],
                  },
                ],
              ]),
        ),
        player,
        action,
      );
      best = Math.max(best, expectedMultiwayUtilities(game, deviated)[player]);
    }
    total += Math.max(0, best - base[player]);
  }
  return total;
}

test("multiway CFR+ is deterministic and exports normalized runtime-readonly strategies", () => {
  const options = { iterations: 4_000, averagingDelay: 20, linearAveraging: true };
  const first = solveMultiwayCFRPlus(threePlayerConstantSumGame(), options);
  const second = solveMultiwayCFRPlus(threePlayerConstantSumGame(), options);

  assert.deepEqual(
    serializeProfile(first.averageStrategy),
    serializeProfile(second.averageStrategy),
  );
  assert.equal(first.averageStrategy.length, 3);
  assert.ok(Object.isFrozen(first.averageStrategy));

  for (const player of first.averageStrategy) {
    assert.equal(player.size, 1);
    assert.equal(player.set, undefined);
    for (const entry of player.values()) {
      assert.ok(Object.isFrozen(entry));
      assert.ok(Object.isFrozen(entry.actions));
      assert.ok(Object.isFrozen(entry.probabilities));
      assert.ok(entry.probabilities.every((value) => value >= 0 && value <= 1));
      assert.ok(
        Math.abs(entry.probabilities.reduce((sum, value) => sum + value, 0) - 1) <
          1e-12,
      );
    }
  }
});

test("chunked multiplayer CFR+ is bit-for-bit identical to a one-shot run", () => {
  const game = threePlayerConstantSumGame();
  const oneShot = new MultiwayCFRPlusSolver(game).run({
    iterations: 2_000,
    averagingDelay: 25,
  });
  const chunkedSolver = new MultiwayCFRPlusSolver(game);
  chunkedSolver.run({ iterations: 700, averagingDelay: 25 });
  const chunked = chunkedSolver.run({ iterations: 1_300, averagingDelay: 25 });

  assert.deepEqual(
    serializeProfile(chunked.averageStrategy),
    serializeProfile(oneShot.averageStrategy),
  );
  assert.deepEqual(chunked.expectedUtilities, oneShot.expectedUtilities);
});

test("expected multiplayer utilities preserve the toy game's constant sum", () => {
  const solved = solveMultiwayCFRPlus(threePlayerConstantSumGame(), {
    iterations: 2_000,
    averagingDelay: 20,
  });

  assert.ok(
    Math.abs(solved.expectedUtilities.reduce((sum, value) => sum + value, 0)) <
      1e-12,
  );
  assert.ok(probability(solved.averageStrategy, 2, "A") > 0.999);
});

test("training lowers measured unilateral deviation gain on the validation game", () => {
  const game = threePlayerConstantSumGame();
  const uniformProfile = [
    new Map([
      ["player-0", { actions: ["H", "T"], probabilities: [0.5, 0.5] }],
    ]),
    new Map([
      ["player-1", { actions: ["H", "T"], probabilities: [0.5, 0.5] }],
    ]),
    new Map([
      ["player-2", { actions: ["A", "B"], probabilities: [0.5, 0.5] }],
    ]),
  ];
  const solved = solveMultiwayCFRPlus(game, {
    iterations: 4_000,
    averagingDelay: 20,
  });
  const before = totalUnilateralDeviationGain(game, uniformProfile);
  const after = totalUnilateralDeviationGain(game, solved.averageStrategy);

  assert.ok(before > 1.2, `uniform deviation gain ${before}`);
  assert.ok(after < 0.002, `trained deviation gain ${after}`);
  assert.ok(after < before / 500, `${after} should be far below ${before}`);
});

test("the multiplayer layer rejects two-player games and malformed utilities", () => {
  const invalidCount = { ...threePlayerConstantSumGame(), playerCount: 2 };
  assert.throws(
    () => solveMultiwayCFRPlus(invalidCount, { iterations: 1 }),
    /at least 3/,
  );

  const invalidUtility = {
    ...threePlayerConstantSumGame(),
    terminalUtilities() {
      return [1, -1];
    },
  };
  assert.throws(
    () => solveMultiwayCFRPlus(invalidUtility, { iterations: 1 }),
    /must return 3 values/,
  );
});
