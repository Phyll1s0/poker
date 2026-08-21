/**
 * A deterministic, full-tree CFR+ solver for finite two-player zero-sum games.
 *
 * The solver deliberately knows nothing about poker. Games provide chance nodes,
 * information-set keys and terminal utility for player 0; player 1 receives the
 * negated utility. Keeping the core game-independent lets small reference games
 * (for example Kuhn poker) validate the same regret engine that larger poker
 * abstractions use.
 *
 * Assumptions:
 * - the game tree is finite and acyclic;
 * - both players have perfect recall;
 * - every occurrence of an information set exposes the same ordered actions;
 * - chance probabilities are exact enough to sum to one within 1e-9.
 */

export type CFRPlayer = 0 | 1;
export type CFRActor = CFRPlayer | "chance" | "terminal";

export interface CFRChanceOutcome<Action extends string> {
  action: Action;
  probability: number;
}

export interface TabularZeroSumGame<State, Action extends string> {
  initialState: State;
  currentActor(state: State): CFRActor;
  actions(state: State): readonly Action[];
  nextState(state: State, action: Action): State;
  informationSet(state: State, player: CFRPlayer): string;
  chanceOutcomes(state: State): readonly CFRChanceOutcome<Action>[];
  /** Utility to player 0 at a terminal state. Player 1 receives its negation. */
  terminalUtility(state: State): number;
}

export interface CFRStrategyEntry<Action extends string> {
  actions: readonly Action[];
  probabilities: readonly number[];
}

export type CFRPlayerStrategy<Action extends string> = ReadonlyMap<
  string,
  CFRStrategyEntry<Action>
>;

export type CFRStrategyProfile<Action extends string> = readonly [
  CFRPlayerStrategy<Action>,
  CFRPlayerStrategy<Action>,
];

export interface CFRPlusRunOptions {
  /** Number of complete alternating player updates. */
  iterations: number;
  /** Do not add strategies to the average through this global iteration. */
  averagingDelay?: number;
  /** Weight average strategy at iteration t by t-delay instead of one. */
  linearAveraging?: boolean;
}

export interface CFRPlusResult<Action extends string> {
  iterations: number;
  averageStrategy: CFRStrategyProfile<Action>;
  currentStrategy: CFRStrategyProfile<Action>;
  expectedValue: number;
}

export interface ExactExploitabilityOptions {
  /** Safety limit for deterministic best-response policies per player. */
  maxPoliciesPerPlayer?: number;
  /** Safety limit while enumerating the full game tree. */
  maxTreeNodes?: number;
}

export interface ExactExploitabilityResult {
  profileValue: number;
  player0BestResponseValue: number;
  /** Player 1 minimizes this player-0 utility. */
  player1BestResponseValueForPlayer0: number;
  /** Sum of both players' unilateral improvement incentives. */
  nashConv: number;
  /** Conventional two-player exploitability: NashConv / 2. */
  exploitability: number;
  deterministicPolicies: readonly [number, number];
}

interface InformationNode<Action extends string> {
  player: CFRPlayer;
  informationSet: string;
  actions: readonly Action[];
  regrets: Float64Array;
  strategySum: Float64Array;
}

interface ReachProbabilities {
  player0: number;
  player1: number;
  chance: number;
}

const PROBABILITY_TOLERANCE = 1e-9;
const DEFAULT_MAX_DEPTH = 512;

function playerReach(reach: ReachProbabilities, player: CFRPlayer): number {
  return player === 0 ? reach.player0 : reach.player1;
}

function withPlayerReach(
  reach: ReachProbabilities,
  player: CFRPlayer,
  probability: number,
): ReachProbabilities {
  return player === 0
    ? { ...reach, player0: reach.player0 * probability }
    : { ...reach, player1: reach.player1 * probability };
}

function uniform(length: number): number[] {
  if (length <= 0) {
    throw new Error("A decision information set must contain at least one action.");
  }
  return Array.from({ length }, () => 1 / length);
}

function regretMatching(regrets: Float64Array): number[] {
  let sum = 0;
  for (const regret of regrets) sum += Math.max(0, regret);
  if (sum <= 0) return uniform(regrets.length);
  return Array.from(regrets, (regret) => Math.max(0, regret) / sum);
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite; got ${value}.`);
}

function validateIterations(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer; got ${value}.`);
  }
}

function nodeKey(player: CFRPlayer, informationSet: string): string {
  return `${player}\u0000${informationSet}`;
}

function assertSameOrderedActions<Action extends string>(
  expected: readonly Action[],
  actual: readonly Action[],
  informationSet: string,
): void {
  if (
    expected.length !== actual.length ||
    expected.some((action, index) => action !== actual[index])
  ) {
    throw new Error(
      `Information set "${informationSet}" exposed inconsistent ordered actions.`,
    );
  }
}

function validateChanceOutcomes<Action extends string>(
  outcomes: readonly CFRChanceOutcome<Action>[],
): void {
  if (outcomes.length === 0) throw new Error("A chance node must have outcomes.");
  let total = 0;
  const seen = new Set<string>();
  for (const { action, probability } of outcomes) {
    if (seen.has(action)) throw new Error(`Duplicate chance action "${action}".`);
    seen.add(action);
    assertFinite(probability, `Chance probability for "${action}"`);
    if (probability < 0 || probability > 1) {
      throw new Error(`Chance probability for "${action}" must be in [0, 1].`);
    }
    total += probability;
  }
  if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) {
    throw new Error(`Chance probabilities must sum to one; got ${total}.`);
  }
}

/**
 * Stateful CFR+ trainer. `run` may be called repeatedly; iteration weighting and
 * averaging delay use the global iteration count, so chunked and one-shot runs
 * are identical when supplied the same averaging options.
 */
export class CFRPlusSolver<State, Action extends string> {
  readonly #game: TabularZeroSumGame<State, Action>;
  readonly #nodes = new Map<string, InformationNode<Action>>();
  #iterations = 0;
  #averagingDelay: number | null = null;
  #linearAveraging: boolean | null = null;

  constructor(game: TabularZeroSumGame<State, Action>) {
    this.#game = game;
  }

  get iterations(): number {
    return this.#iterations;
  }

  run(options: CFRPlusRunOptions): CFRPlusResult<Action> {
    validateIterations(options.iterations, "iterations");
    const averagingDelay = options.averagingDelay ?? 0;
    const linearAveraging = options.linearAveraging ?? true;
    validateIterations(averagingDelay, "averagingDelay");

    if (this.#averagingDelay === null) {
      this.#averagingDelay = averagingDelay;
      this.#linearAveraging = linearAveraging;
    } else if (
      this.#averagingDelay !== averagingDelay ||
      this.#linearAveraging !== linearAveraging
    ) {
      throw new Error(
        "A CFRPlusSolver must use the same averaging options across chunked runs.",
      );
    }

    for (let localIteration = 0; localIteration < options.iterations; localIteration += 1) {
      const iteration = this.#iterations + 1;
      this.#updateRegrets(0);
      this.#updateRegrets(1);

      if (iteration > averagingDelay) {
        const weight = linearAveraging ? iteration - averagingDelay : 1;
        this.#accumulateAverageStrategy(weight);
      }
      this.#iterations = iteration;
    }

    const averageStrategy = this.averageStrategy();
    return {
      iterations: this.#iterations,
      averageStrategy,
      currentStrategy: this.currentStrategy(),
      expectedValue: expectedValue(this.#game, averageStrategy),
    };
  }

  averageStrategy(): CFRStrategyProfile<Action> {
    return this.#exportStrategy(true);
  }

  currentStrategy(): CFRStrategyProfile<Action> {
    return this.#exportStrategy(false);
  }

  #node(
    player: CFRPlayer,
    informationSet: string,
    actions: readonly Action[],
  ): InformationNode<Action> {
    if (actions.length === 0) {
      throw new Error(`Information set "${informationSet}" has no legal actions.`);
    }
    const key = nodeKey(player, informationSet);
    const existing = this.#nodes.get(key);
    if (existing) {
      assertSameOrderedActions(existing.actions, actions, informationSet);
      return existing;
    }
    const node: InformationNode<Action> = {
      player,
      informationSet,
      actions: [...actions],
      regrets: new Float64Array(actions.length),
      strategySum: new Float64Array(actions.length),
    };
    this.#nodes.set(key, node);
    return node;
  }

  #updateRegrets(traverser: CFRPlayer): void {
    const strategySnapshot = new Map<string, readonly number[]>();
    const regretDeltas = new Map<string, Float64Array>();

    const traverse = (
      state: State,
      reach: ReachProbabilities,
      depth: number,
    ): number => {
      if (depth > DEFAULT_MAX_DEPTH) {
        throw new Error(`Game tree exceeded maximum depth ${DEFAULT_MAX_DEPTH}.`);
      }
      const actor = this.#game.currentActor(state);
      if (actor === "terminal") {
        const utility0 = this.#game.terminalUtility(state);
        assertFinite(utility0, "Terminal utility");
        return traverser === 0 ? utility0 : -utility0;
      }
      if (actor === "chance") {
        const outcomes = this.#game.chanceOutcomes(state);
        validateChanceOutcomes(outcomes);
        let value = 0;
        for (const outcome of outcomes) {
          value +=
            outcome.probability *
            traverse(
              this.#game.nextState(state, outcome.action),
              { ...reach, chance: reach.chance * outcome.probability },
              depth + 1,
            );
        }
        return value;
      }

      const actions = this.#game.actions(state);
      const informationSet = this.#game.informationSet(state, actor);
      const node = this.#node(actor, informationSet, actions);
      const key = nodeKey(actor, informationSet);
      let strategy = strategySnapshot.get(key);
      if (!strategy) {
        strategy = regretMatching(node.regrets);
        strategySnapshot.set(key, strategy);
      }

      const actionValues = new Array<number>(actions.length);
      let nodeValue = 0;
      for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
        const actionValue = traverse(
          this.#game.nextState(state, actions[actionIndex]),
          withPlayerReach(reach, actor, strategy[actionIndex]),
          depth + 1,
        );
        actionValues[actionIndex] = actionValue;
        nodeValue += strategy[actionIndex] * actionValue;
      }

      if (actor === traverser) {
        const counterfactualReach =
          reach.chance * (traverser === 0 ? reach.player1 : reach.player0);
        let delta = regretDeltas.get(key);
        if (!delta) {
          delta = new Float64Array(actions.length);
          regretDeltas.set(key, delta);
        }
        for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
          delta[actionIndex] +=
            counterfactualReach * (actionValues[actionIndex] - nodeValue);
        }
      }
      return nodeValue;
    };

    traverse(
      this.#game.initialState,
      { player0: 1, player1: 1, chance: 1 },
      0,
    );

    for (const [key, delta] of regretDeltas) {
      const node = this.#nodes.get(key);
      if (!node) throw new Error(`Missing CFR node for regret update "${key}".`);
      for (let actionIndex = 0; actionIndex < delta.length; actionIndex += 1) {
        node.regrets[actionIndex] = Math.max(
          0,
          node.regrets[actionIndex] + delta[actionIndex],
        );
      }
    }
  }

  #accumulateAverageStrategy(iterationWeight: number): void {
    const seen = new Set<string>();
    const traverse = (
      state: State,
      reach: ReachProbabilities,
      depth: number,
    ): void => {
      if (depth > DEFAULT_MAX_DEPTH) {
        throw new Error(`Game tree exceeded maximum depth ${DEFAULT_MAX_DEPTH}.`);
      }
      const actor = this.#game.currentActor(state);
      if (actor === "terminal") return;
      if (actor === "chance") {
        const outcomes = this.#game.chanceOutcomes(state);
        validateChanceOutcomes(outcomes);
        for (const outcome of outcomes) {
          traverse(
            this.#game.nextState(state, outcome.action),
            { ...reach, chance: reach.chance * outcome.probability },
            depth + 1,
          );
        }
        return;
      }

      const actions = this.#game.actions(state);
      const informationSet = this.#game.informationSet(state, actor);
      const node = this.#node(actor, informationSet, actions);
      const key = nodeKey(actor, informationSet);
      const strategy = regretMatching(node.regrets);
      if (!seen.has(key)) {
        seen.add(key);
        const weight = iterationWeight * playerReach(reach, actor);
        for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
          node.strategySum[actionIndex] += weight * strategy[actionIndex];
        }
      }
      for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
        traverse(
          this.#game.nextState(state, actions[actionIndex]),
          withPlayerReach(reach, actor, strategy[actionIndex]),
          depth + 1,
        );
      }
    };

    traverse(
      this.#game.initialState,
      { player0: 1, player1: 1, chance: 1 },
      0,
    );
  }

  #exportStrategy(average: boolean): CFRStrategyProfile<Action> {
    const players: [Map<string, CFRStrategyEntry<Action>>, Map<string, CFRStrategyEntry<Action>>] = [
      new Map(),
      new Map(),
    ];
    for (const node of this.#nodes.values()) {
      let probabilities: number[];
      if (average) {
        const total = node.strategySum.reduce((sum, value) => sum + value, 0);
        probabilities =
          total > 0
            ? Array.from(node.strategySum, (value) => value / total)
            : regretMatching(node.regrets);
      } else {
        probabilities = regretMatching(node.regrets);
      }
      players[node.player].set(node.informationSet, {
        actions: [...node.actions],
        probabilities,
      });
    }
    return players;
  }
}

/** Solve a game in one deterministic CFR+ run. */
export function solveCFRPlus<State, Action extends string>(
  game: TabularZeroSumGame<State, Action>,
  options: CFRPlusRunOptions,
): CFRPlusResult<Action> {
  return new CFRPlusSolver(game).run(options);
}

function strategyProbabilities<Action extends string>(
  profile: CFRStrategyProfile<Action>,
  player: CFRPlayer,
  informationSet: string,
  actions: readonly Action[],
): readonly number[] {
  const entry = profile[player].get(informationSet);
  if (!entry) return uniform(actions.length);

  if (entry.actions.length !== entry.probabilities.length) {
    throw new Error(`Strategy at "${informationSet}" has mismatched action/probability lengths.`);
  }
  const byAction = new Map<Action, number>();
  let total = 0;
  for (let index = 0; index < entry.actions.length; index += 1) {
    const probability = entry.probabilities[index];
    assertFinite(probability, `Strategy probability at "${informationSet}"`);
    if (probability < 0) {
      throw new Error(`Strategy probability at "${informationSet}" cannot be negative.`);
    }
    if (byAction.has(entry.actions[index])) {
      throw new Error(`Strategy at "${informationSet}" contains a duplicate action.`);
    }
    byAction.set(entry.actions[index], probability);
    total += probability;
  }
  if (entry.actions.length !== actions.length || byAction.size !== actions.length) {
    throw new Error(
      `Strategy at "${informationSet}" exposes actions that do not exactly match the legal actions.`,
    );
  }
  if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) {
    throw new Error(`Strategy probabilities at "${informationSet}" must sum to one.`);
  }
  return actions.map((action) => {
    const probability = byAction.get(action);
    if (probability === undefined) {
      throw new Error(`Strategy at "${informationSet}" is missing action "${action}".`);
    }
    return probability;
  });
}

/** Exact expected utility to player 0 under a supplied behavioral profile. */
export function expectedValue<State, Action extends string>(
  game: TabularZeroSumGame<State, Action>,
  profile: CFRStrategyProfile<Action>,
): number {
  const traverse = (state: State, depth: number): number => {
    if (depth > DEFAULT_MAX_DEPTH) {
      throw new Error(`Game tree exceeded maximum depth ${DEFAULT_MAX_DEPTH}.`);
    }
    const actor = game.currentActor(state);
    if (actor === "terminal") {
      const utility = game.terminalUtility(state);
      assertFinite(utility, "Terminal utility");
      return utility;
    }
    if (actor === "chance") {
      const outcomes = game.chanceOutcomes(state);
      validateChanceOutcomes(outcomes);
      return outcomes.reduce(
        (sum, outcome) =>
          sum + outcome.probability * traverse(game.nextState(state, outcome.action), depth + 1),
        0,
      );
    }
    const actions = game.actions(state);
    const informationSet = game.informationSet(state, actor);
    const probabilities = strategyProbabilities(profile, actor, informationSet, actions);
    let value = 0;
    for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
      value +=
        probabilities[actionIndex] *
        traverse(game.nextState(state, actions[actionIndex]), depth + 1);
    }
    return value;
  };
  return traverse(game.initialState, 0);
}

interface InformationSetDescription<Action extends string> {
  informationSet: string;
  actions: readonly Action[];
}

function collectInformationSets<State, Action extends string>(
  game: TabularZeroSumGame<State, Action>,
  maxTreeNodes: number,
): readonly [
  readonly InformationSetDescription<Action>[],
  readonly InformationSetDescription<Action>[],
] {
  const players: [Map<string, readonly Action[]>, Map<string, readonly Action[]>] = [
    new Map(),
    new Map(),
  ];
  let visitedNodes = 0;
  const traverse = (state: State, depth: number): void => {
    visitedNodes += 1;
    if (visitedNodes > maxTreeNodes) {
      throw new Error(`Game tree exceeds exact-evaluation limit of ${maxTreeNodes} nodes.`);
    }
    if (depth > DEFAULT_MAX_DEPTH) {
      throw new Error(`Game tree exceeded maximum depth ${DEFAULT_MAX_DEPTH}.`);
    }
    const actor = game.currentActor(state);
    if (actor === "terminal") return;
    if (actor === "chance") {
      const outcomes = game.chanceOutcomes(state);
      validateChanceOutcomes(outcomes);
      for (const outcome of outcomes) {
        traverse(game.nextState(state, outcome.action), depth + 1);
      }
      return;
    }
    const actions = game.actions(state);
    const informationSet = game.informationSet(state, actor);
    const existing = players[actor].get(informationSet);
    if (existing) assertSameOrderedActions(existing, actions, informationSet);
    else players[actor].set(informationSet, [...actions]);
    for (const action of actions) traverse(game.nextState(state, action), depth + 1);
  };
  traverse(game.initialState, 0);
  return players.map((sets) =>
    [...sets].map(([informationSet, actions]) => ({ informationSet, actions })),
  ) as [InformationSetDescription<Action>[], InformationSetDescription<Action>[]];
}

function policyCount<Action extends string>(
  informationSets: readonly InformationSetDescription<Action>[],
): number {
  let count = 1;
  for (const informationSet of informationSets) {
    count *= informationSet.actions.length;
    if (!Number.isSafeInteger(count)) return Number.POSITIVE_INFINITY;
  }
  return count;
}

/**
 * Exact exploitability for small validation games by enumerating deterministic
 * best-response policies. This is intentionally exponential and guarded by a
 * policy cap; large poker abstractions should use a scalable best-response pass.
 */
export function exactExploitability<State, Action extends string>(
  game: TabularZeroSumGame<State, Action>,
  profile: CFRStrategyProfile<Action>,
  options: ExactExploitabilityOptions = {},
): ExactExploitabilityResult {
  const maxPolicies = options.maxPoliciesPerPlayer ?? 1_000_000;
  const maxTreeNodes = options.maxTreeNodes ?? 1_000_000;
  validateIterations(maxPolicies, "maxPoliciesPerPlayer");
  validateIterations(maxTreeNodes, "maxTreeNodes");
  if (maxPolicies === 0 || maxTreeNodes === 0) {
    throw new Error("Exact-evaluation limits must be greater than zero.");
  }

  const informationSets = collectInformationSets(game, maxTreeNodes);
  const counts: [number, number] = [
    policyCount(informationSets[0]),
    policyCount(informationSets[1]),
  ];
  for (const player of [0, 1] as const) {
    if (counts[player] > maxPolicies) {
      throw new Error(
        `Player ${player} has ${counts[player]} deterministic policies; ` +
          `limit is ${maxPolicies}.`,
      );
    }
  }

  const responseValue = (responder: CFRPlayer): number => {
    const policy = new Map<string, Action>();
    const evaluate = (state: State, depth: number): number => {
      if (depth > DEFAULT_MAX_DEPTH) {
        throw new Error(`Game tree exceeded maximum depth ${DEFAULT_MAX_DEPTH}.`);
      }
      const actor = game.currentActor(state);
      if (actor === "terminal") return game.terminalUtility(state);
      if (actor === "chance") {
        const outcomes = game.chanceOutcomes(state);
        return outcomes.reduce(
          (sum, outcome) =>
            sum + outcome.probability * evaluate(game.nextState(state, outcome.action), depth + 1),
          0,
        );
      }
      const actions = game.actions(state);
      const informationSet = game.informationSet(state, actor);
      if (actor === responder) {
        const action = policy.get(informationSet);
        if (action === undefined) {
          throw new Error(`Best-response policy is missing "${informationSet}".`);
        }
        return evaluate(game.nextState(state, action), depth + 1);
      }
      const probabilities = strategyProbabilities(profile, actor, informationSet, actions);
      let value = 0;
      for (let index = 0; index < actions.length; index += 1) {
        value += probabilities[index] * evaluate(game.nextState(state, actions[index]), depth + 1);
      }
      return value;
    };

    let best = responder === 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const enumerate = (informationSetIndex: number): void => {
      if (informationSetIndex === informationSets[responder].length) {
        const value = evaluate(game.initialState, 0);
        best = responder === 0 ? Math.max(best, value) : Math.min(best, value);
        return;
      }
      const informationSet = informationSets[responder][informationSetIndex];
      for (const action of informationSet.actions) {
        policy.set(informationSet.informationSet, action);
        enumerate(informationSetIndex + 1);
      }
      policy.delete(informationSet.informationSet);
    };
    enumerate(0);
    return best;
  };

  const profileValue = expectedValue(game, profile);
  const player0BestResponseValue = responseValue(0);
  const player1BestResponseValueForPlayer0 = responseValue(1);
  const nashConv = player0BestResponseValue - player1BestResponseValueForPlayer0;
  return {
    profileValue,
    player0BestResponseValue,
    player1BestResponseValueForPlayer0,
    nashConv,
    exploitability: nashConv / 2,
    deterministicPolicies: counts,
  };
}
