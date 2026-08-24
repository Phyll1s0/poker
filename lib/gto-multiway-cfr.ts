/**
 * Deterministic, full-tree tabular CFR+ for finite games with three or more
 * players.
 *
 * This is infrastructure for small multiway abstractions and regression games,
 * not a claim that CFR+ converges to a Nash equilibrium in general multiplayer
 * games.  In contrast with two-player zero-sum CFR, that guarantee does not
 * carry over to arbitrary multiplayer or general-sum games.  Callers should
 * therefore publish convergence diagnostics and benchmark unilateral deviation
 * gains instead of labelling the returned profile "exact GTO".
 *
 * Assumptions:
 * - the game tree is finite and acyclic;
 * - every player has perfect recall;
 * - every occurrence of an information set exposes the same ordered actions;
 * - chance probabilities sum to one within 1e-9;
 * - terminalUtilities returns one finite utility per player.
 */

export type MultiwayActor = number | "chance" | "terminal";

export interface MultiwayChanceOutcome<Action extends string> {
  action: Action;
  probability: number;
}

export interface TabularMultiwayGame<State, Action extends string> {
  /** CFR's multiplayer layer intentionally requires at least three players. */
  playerCount: number;
  initialState: State;
  currentActor(state: State): MultiwayActor;
  actions(state: State): readonly Action[];
  nextState(state: State, action: Action): State;
  informationSet(state: State, player: number): string;
  chanceOutcomes(state: State): readonly MultiwayChanceOutcome<Action>[];
  terminalUtilities(state: State): readonly number[];
}

export interface MultiwayStrategyEntry<Action extends string> {
  readonly actions: readonly Action[];
  readonly probabilities: readonly number[];
}

export type MultiwayPlayerStrategy<Action extends string> = ReadonlyMap<
  string,
  MultiwayStrategyEntry<Action>
>;

export type MultiwayStrategyProfile<Action extends string> = readonly MultiwayPlayerStrategy<Action>[];

export interface MultiwayCFRPlusRunOptions {
  /** Number of complete alternating updates of all players. */
  iterations: number;
  /** Do not add strategies to the average through this global iteration. */
  averagingDelay?: number;
  /** Weight average strategy at iteration t by t-delay instead of one. */
  linearAveraging?: boolean;
}

export interface MultiwayCFRPlusResult<Action extends string> {
  readonly iterations: number;
  readonly averageStrategy: MultiwayStrategyProfile<Action>;
  readonly currentStrategy: MultiwayStrategyProfile<Action>;
  readonly expectedUtilities: readonly number[];
}

interface InformationNode<Action extends string> {
  readonly player: number;
  readonly informationSet: string;
  readonly actions: readonly Action[];
  readonly regrets: Float64Array;
  readonly strategySum: Float64Array;
}

interface ReachProbabilities {
  readonly players: readonly number[];
  readonly chance: number;
}

const PROBABILITY_TOLERANCE = 1e-9;
const DEFAULT_MAX_DEPTH = 512;

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite; got ${value}.`);
}

function validateNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer; got ${value}.`);
  }
}

function validateGamePlayerCount(playerCount: number): void {
  if (!Number.isSafeInteger(playerCount) || playerCount < 3) {
    throw new Error(`playerCount must be a safe integer of at least 3; got ${playerCount}.`);
  }
}

function validateActor(actor: MultiwayActor, playerCount: number): void {
  if (actor === "chance" || actor === "terminal") return;
  if (!Number.isSafeInteger(actor) || actor < 0 || actor >= playerCount) {
    throw new Error(`Decision actor must be a player in [0, ${playerCount - 1}]; got ${actor}.`);
  }
}

function validateTerminalUtilities(
  utilities: readonly number[],
  playerCount: number,
): void {
  if (utilities.length !== playerCount) {
    throw new Error(
      `terminalUtilities must return ${playerCount} values; got ${utilities.length}.`,
    );
  }
  for (let player = 0; player < utilities.length; player += 1) {
    assertFinite(utilities[player], `Terminal utility for player ${player}`);
  }
}

function validateChanceOutcomes<Action extends string>(
  outcomes: readonly MultiwayChanceOutcome<Action>[],
): void {
  if (outcomes.length === 0) throw new Error("A chance node must have outcomes.");
  const seen = new Set<Action>();
  let total = 0;
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

function uniform(length: number): number[] {
  if (length <= 0) {
    throw new Error("A decision information set must contain at least one action.");
  }
  return Array.from({ length }, () => 1 / length);
}

function regretMatchingPlus(regrets: Float64Array): number[] {
  let total = 0;
  for (const regret of regrets) total += Math.max(0, regret);
  if (total <= 0) return uniform(regrets.length);
  return Array.from(regrets, (regret) => Math.max(0, regret) / total);
}

function nodeKey(player: number, informationSet: string): string {
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

function validateDecisionActions<Action extends string>(
  actions: readonly Action[],
  informationSet: string,
): void {
  if (actions.length === 0) {
    throw new Error(`Information set "${informationSet}" has no legal actions.`);
  }
  if (new Set(actions).size !== actions.length) {
    throw new Error(`Information set "${informationSet}" contains duplicate actions.`);
  }
}

function withPlayerReach(
  reach: ReachProbabilities,
  player: number,
  probability: number,
): ReachProbabilities {
  const players = [...reach.players];
  players[player] *= probability;
  return { players, chance: reach.chance };
}

function counterfactualReach(reach: ReachProbabilities, traverser: number): number {
  let result = reach.chance;
  for (let player = 0; player < reach.players.length; player += 1) {
    if (player !== traverser) result *= reach.players[player];
  }
  return result;
}

/** A runtime read-only Map facade: consumers cannot mutate the exported table. */
class ReadonlyStrategyMap<Action extends string>
  implements ReadonlyMap<string, MultiwayStrategyEntry<Action>>
{
  readonly #map: Map<string, MultiwayStrategyEntry<Action>>;

  constructor(entries: Iterable<readonly [string, MultiwayStrategyEntry<Action>]>) {
    this.#map = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#map.size;
  }

  get(key: string): MultiwayStrategyEntry<Action> | undefined {
    return this.#map.get(key);
  }

  has(key: string): boolean {
    return this.#map.has(key);
  }

  entries(): MapIterator<[string, MultiwayStrategyEntry<Action>]> {
    return this.#map.entries();
  }

  keys(): MapIterator<string> {
    return this.#map.keys();
  }

  values(): MapIterator<MultiwayStrategyEntry<Action>> {
    return this.#map.values();
  }

  forEach(
    callbackfn: (
      value: MultiwayStrategyEntry<Action>,
      key: string,
      map: ReadonlyMap<string, MultiwayStrategyEntry<Action>>,
    ) => void,
    thisArg?: unknown,
  ): void {
    this.#map.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }

  [Symbol.iterator](): MapIterator<[string, MultiwayStrategyEntry<Action>]> {
    return this.#map[Symbol.iterator]();
  }

  get [Symbol.toStringTag](): string {
    return "ReadonlyStrategyMap";
  }
}

function strategyProbabilities<Action extends string>(
  profile: MultiwayStrategyProfile<Action>,
  player: number,
  informationSet: string,
  actions: readonly Action[],
): readonly number[] {
  const playerStrategy = profile[player];
  if (!playerStrategy) {
    throw new Error(`Strategy profile is missing player ${player}.`);
  }
  const entry = playerStrategy.get(informationSet);
  if (!entry) return uniform(actions.length);
  if (entry.actions.length !== entry.probabilities.length) {
    throw new Error(`Strategy at "${informationSet}" has mismatched action/probability lengths.`);
  }

  const byAction = new Map<Action, number>();
  let total = 0;
  for (let index = 0; index < entry.actions.length; index += 1) {
    const action = entry.actions[index];
    const probability = entry.probabilities[index];
    assertFinite(probability, `Strategy probability at "${informationSet}"`);
    if (probability < 0) {
      throw new Error(`Strategy probability at "${informationSet}" cannot be negative.`);
    }
    if (byAction.has(action)) {
      throw new Error(`Strategy at "${informationSet}" contains a duplicate action.`);
    }
    byAction.set(action, probability);
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

/** Exact full-tree expected utility vector under a supplied behavioral profile. */
export function expectedMultiwayUtilities<State, Action extends string>(
  game: TabularMultiwayGame<State, Action>,
  profile: MultiwayStrategyProfile<Action>,
): readonly number[] {
  validateGamePlayerCount(game.playerCount);
  if (profile.length !== game.playerCount) {
    throw new Error(
      `Strategy profile must contain ${game.playerCount} players; got ${profile.length}.`,
    );
  }

  const traverse = (state: State, depth: number): number[] => {
    if (depth > DEFAULT_MAX_DEPTH) {
      throw new Error(`Game tree exceeded maximum depth ${DEFAULT_MAX_DEPTH}.`);
    }
    const actor = game.currentActor(state);
    validateActor(actor, game.playerCount);
    if (actor === "terminal") {
      const utilities = game.terminalUtilities(state);
      validateTerminalUtilities(utilities, game.playerCount);
      return [...utilities];
    }
    if (actor === "chance") {
      const outcomes = game.chanceOutcomes(state);
      validateChanceOutcomes(outcomes);
      const values = Array.from({ length: game.playerCount }, () => 0);
      for (const outcome of outcomes) {
        const child = traverse(game.nextState(state, outcome.action), depth + 1);
        for (let player = 0; player < values.length; player += 1) {
          values[player] += outcome.probability * child[player];
        }
      }
      return values;
    }

    const actions = game.actions(state);
    const informationSet = game.informationSet(state, actor);
    validateDecisionActions(actions, informationSet);
    const probabilities = strategyProbabilities(
      profile,
      actor,
      informationSet,
      actions,
    );
    const values = Array.from({ length: game.playerCount }, () => 0);
    for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
      const child = traverse(game.nextState(state, actions[actionIndex]), depth + 1);
      for (let player = 0; player < values.length; player += 1) {
        values[player] += probabilities[actionIndex] * child[player];
      }
    }
    return values;
  };

  return Object.freeze(traverse(game.initialState, 0));
}

/**
 * Stateful deterministic CFR+ trainer for small multiplayer abstractions.
 * Repeated `run` calls continue the same training state.  Averaging settings are
 * fixed on first use so one-shot and chunked runs are bit-for-bit identical.
 */
export class MultiwayCFRPlusSolver<State, Action extends string> {
  readonly #game: TabularMultiwayGame<State, Action>;
  readonly #nodes = new Map<string, InformationNode<Action>>();
  #iterations = 0;
  #averagingDelay: number | null = null;
  #linearAveraging: boolean | null = null;

  constructor(game: TabularMultiwayGame<State, Action>) {
    validateGamePlayerCount(game.playerCount);
    this.#game = game;
  }

  get iterations(): number {
    return this.#iterations;
  }

  /**
   * Advances regret and average-strategy tables without exporting or
   * evaluating a profile. Worker clients use this for bounded chunks so every
   * progress checkpoint does not pay for current strategy plus a full expected
   * utility traversal.
   */
  train(options: MultiwayCFRPlusRunOptions): number {
    validateNonNegativeInteger(options.iterations, "iterations");
    const averagingDelay = options.averagingDelay ?? 0;
    const linearAveraging = options.linearAveraging ?? true;
    validateNonNegativeInteger(averagingDelay, "averagingDelay");

    if (this.#averagingDelay === null) {
      this.#averagingDelay = averagingDelay;
      this.#linearAveraging = linearAveraging;
    } else if (
      this.#averagingDelay !== averagingDelay ||
      this.#linearAveraging !== linearAveraging
    ) {
      throw new Error(
        "A MultiwayCFRPlusSolver must use the same averaging options across chunked runs.",
      );
    }

    for (let localIteration = 0; localIteration < options.iterations; localIteration += 1) {
      const globalIteration = this.#iterations + 1;
      for (let traverser = 0; traverser < this.#game.playerCount; traverser += 1) {
        this.#updateRegrets(traverser);
      }
      if (globalIteration > averagingDelay) {
        const weight = linearAveraging ? globalIteration - averagingDelay : 1;
        this.#accumulateAverageStrategy(weight);
      }
      this.#iterations = globalIteration;
    }

    return this.#iterations;
  }

  run(options: MultiwayCFRPlusRunOptions): MultiwayCFRPlusResult<Action> {
    this.train(options);
    const averageStrategy = this.averageStrategy();
    return Object.freeze({
      iterations: this.#iterations,
      averageStrategy,
      currentStrategy: this.currentStrategy(),
      expectedUtilities: expectedMultiwayUtilities(this.#game, averageStrategy),
    });
  }

  averageStrategy(): MultiwayStrategyProfile<Action> {
    return this.#exportStrategy(true);
  }

  currentStrategy(): MultiwayStrategyProfile<Action> {
    return this.#exportStrategy(false);
  }

  #node(
    player: number,
    informationSet: string,
    actions: readonly Action[],
  ): InformationNode<Action> {
    validateDecisionActions(actions, informationSet);
    const key = nodeKey(player, informationSet);
    const existing = this.#nodes.get(key);
    if (existing) {
      assertSameOrderedActions(existing.actions, actions, informationSet);
      return existing;
    }
    const node: InformationNode<Action> = {
      player,
      informationSet,
      actions: Object.freeze([...actions]),
      regrets: new Float64Array(actions.length),
      strategySum: new Float64Array(actions.length),
    };
    this.#nodes.set(key, node);
    return node;
  }

  #updateRegrets(traverser: number): void {
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
      validateActor(actor, this.#game.playerCount);
      if (actor === "terminal") {
        const utilities = this.#game.terminalUtilities(state);
        validateTerminalUtilities(utilities, this.#game.playerCount);
        return utilities[traverser];
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
              { players: reach.players, chance: reach.chance * outcome.probability },
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
        strategy = regretMatchingPlus(node.regrets);
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
        let delta = regretDeltas.get(key);
        if (!delta) {
          delta = new Float64Array(actions.length);
          regretDeltas.set(key, delta);
        }
        const reachWeight = counterfactualReach(reach, traverser);
        for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
          delta[actionIndex] += reachWeight * (actionValues[actionIndex] - nodeValue);
        }
      }
      return nodeValue;
    };

    traverse(
      this.#game.initialState,
      {
        players: Array.from({ length: this.#game.playerCount }, () => 1),
        chance: 1,
      },
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
      validateActor(actor, this.#game.playerCount);
      if (actor === "terminal") return;
      if (actor === "chance") {
        const outcomes = this.#game.chanceOutcomes(state);
        validateChanceOutcomes(outcomes);
        for (const outcome of outcomes) {
          traverse(
            this.#game.nextState(state, outcome.action),
            { players: reach.players, chance: reach.chance * outcome.probability },
            depth + 1,
          );
        }
        return;
      }

      const actions = this.#game.actions(state);
      const informationSet = this.#game.informationSet(state, actor);
      const node = this.#node(actor, informationSet, actions);
      const key = nodeKey(actor, informationSet);
      const strategy = regretMatchingPlus(node.regrets);
      if (!seen.has(key)) {
        seen.add(key);
        const weight = iterationWeight * reach.players[actor];
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
      {
        players: Array.from({ length: this.#game.playerCount }, () => 1),
        chance: 1,
      },
      0,
    );
  }

  #exportStrategy(average: boolean): MultiwayStrategyProfile<Action> {
    const players = Array.from(
      { length: this.#game.playerCount },
      () => new Map<string, MultiwayStrategyEntry<Action>>(),
    );
    for (const node of this.#nodes.values()) {
      let probabilities: number[];
      if (average) {
        const total = node.strategySum.reduce((sum, value) => sum + value, 0);
        probabilities =
          total > 0
            ? Array.from(node.strategySum, (value) => value / total)
            : regretMatchingPlus(node.regrets);
      } else {
        probabilities = regretMatchingPlus(node.regrets);
      }
      players[node.player].set(
        node.informationSet,
        Object.freeze({
          actions: Object.freeze([...node.actions]),
          probabilities: Object.freeze(probabilities),
        }),
      );
    }
    return Object.freeze(
      players.map((entries) => new ReadonlyStrategyMap(entries)),
    );
  }
}

/** Solve a multiplayer abstraction in one deterministic CFR+ run. */
export function solveMultiwayCFRPlus<State, Action extends string>(
  game: TabularMultiwayGame<State, Action>,
  options: MultiwayCFRPlusRunOptions,
): MultiwayCFRPlusResult<Action> {
  return new MultiwayCFRPlusSolver(game).run(options);
}
