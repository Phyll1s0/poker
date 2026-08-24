import {
  MultiwayCFRPlusSolver,
  type MultiwayStrategyEntry,
  type MultiwayStrategyProfile,
  type TabularMultiwayGame,
} from "./gto-multiway-cfr.ts";
import { bestHand } from "./poker-evaluator.ts";
import { stableGtoHash } from "./gto-standard.ts";
import type { StrategyCard } from "./poker-strategy.ts";

export type ThreeWayRiverPlayer = "oop" | "middle" | "ip";
export type ThreeWayRiverAction = string;

export type WeightedThreeWayRiverHolding = Readonly<{
  cards: readonly [StrategyCard, StrategyCard];
  weight: number;
}>;

export type ThreeWayRiverBettingTree = Readonly<{
  betPotFractions: readonly number[];
  allInAlwaysAvailable: boolean;
}>;

export type ThreeWayRiverSpec = Readonly<{
  board: readonly [StrategyCard, StrategyCard, StrategyCard, StrategyCard, StrategyCard];
  ranges: readonly [
    readonly WeightedThreeWayRiverHolding[],
    readonly WeightedThreeWayRiverHolding[],
    readonly WeightedThreeWayRiverHolding[],
  ];
  potBb: number;
  /** Remaining river stack for OOP, middle and IP. */
  stackBb: readonly [number, number, number];
  bettingTree?: Partial<ThreeWayRiverBettingTree>;
  /**
   * Optional legal public prefix. When supplied, CFR+ and the unilateral
   * deviation audit both start at this current decision rather than at the
   * river root, so the reported NashConv is conditional on the visible node.
   */
  startingHistory?: readonly ThreeWayRiverAction[];
}>;

export type NormalizedThreeWayRiverSpec = Readonly<{
  board: readonly [StrategyCard, StrategyCard, StrategyCard, StrategyCard, StrategyCard];
  ranges: readonly [
    readonly WeightedThreeWayRiverHolding[],
    readonly WeightedThreeWayRiverHolding[],
    readonly WeightedThreeWayRiverHolding[],
  ];
  potBb: number;
  stackBb: readonly [number, number, number];
  bettingTree: ThreeWayRiverBettingTree;
  startingHistory: readonly ThreeWayRiverAction[];
}>;

type PlayerIndex = 0 | 1 | 2;
type TerminalKind = "showdown" | "fold";

export type ThreeWayRiverState =
  | Readonly<{ phase: "chance" }>
  | Readonly<{
      phase: "play";
      dealIndex: number;
      actor: PlayerIndex;
      history: readonly ThreeWayRiverAction[];
      contributions: readonly [number, number, number];
      live: readonly [boolean, boolean, boolean];
      bettor?: PlayerIndex;
      pending: readonly PlayerIndex[];
      terminal?: TerminalKind;
    }>;

type ThreeWayDeal = Readonly<{
  holdingIndices: readonly [number, number, number];
  probability: number;
}>;

export type ThreeWayRiverStrategy = Readonly<{
  player: ThreeWayRiverPlayer;
  holding: string;
  history: string;
  actions: readonly ThreeWayRiverAction[];
  frequencies: readonly number[];
}>;

export type ThreeWayRiverActionEv = Readonly<{
  player: ThreeWayRiverPlayer;
  holding: string;
  history: string;
  actions: readonly ThreeWayRiverAction[];
  actionEvBb: readonly number[];
  counterfactualReach: number;
}>;

export type ThreeWayRiverAudit = Readonly<{
  profileValueBb: readonly [number, number, number];
  bestResponseValueBb: readonly [number, number, number];
  perPlayerGainBb: readonly [number, number, number];
  nashConvBb: number;
  /** Pot visible at the conditional solve root, including the public prefix. */
  normalizationPotBb: number;
  nashConvPotFraction: number;
}>;

export type ThreeWayRiverApproximation = Readonly<{
  equilibrium: "three-player-cfr+-approximation";
  cards: "exact-card-collision-aware";
  ranges: "independent-input-weights-conditioned-on-compatible-deals";
  actionTree: "single-bet-no-raise";
  actionSet: "check-bet-fold-call";
  stacks: "individual-caps-with-side-pots";
  startingPot: "single-common-pot-no-preexisting-side-pots";
  caveat: string;
}>;

export type ThreeWayRiverSolution = Readonly<{
  solverVersion: "rangecraft-multiway-cfr+/0.1.0";
  source: "internal-solver";
  spotId: string;
  gameSpecId: string;
  treeId: string;
  iterations: number;
  compatibleDeals: number;
  accuracyScope: "within-fixed-tree";
  approximation: ThreeWayRiverApproximation;
  audit: ThreeWayRiverAudit;
  strategies: readonly ThreeWayRiverStrategy[];
  actionValues: readonly ThreeWayRiverActionEv[];
  averageStrategy: MultiwayStrategyProfile<ThreeWayRiverAction>;
}>;

export type SolveThreeWayRiverOptions = Readonly<{
  iterations: number;
  averagingDelay?: number;
  linearAveraging?: boolean;
}>;

export type ThreeWayRiverSolverSessionOptions = Readonly<{
  averagingDelay?: number;
  linearAveraging?: boolean;
}>;

export type ThreeWayRiverCheckpoint = Readonly<{
  iterations: number;
  audit: ThreeWayRiverAudit;
  averageStrategy: MultiwayStrategyProfile<ThreeWayRiverAction>;
}>;

export type ThreeWayRiverSolverSession = Readonly<{
  readonly iterations: number;
  run(additionalIterations: number): ThreeWayRiverCheckpoint;
  solution(): ThreeWayRiverSolution;
}>;

export type ThreeWayRiverGame = Readonly<{
  game: TabularMultiwayGame<ThreeWayRiverState, ThreeWayRiverAction>;
  spec: NormalizedThreeWayRiverSpec;
  compatibleDeals: number;
  spotId: string;
  gameSpecId: string;
  treeId: string;
  holdingKey(player: PlayerIndex, holdingIndex: number): string;
  informationSet(player: PlayerIndex, holdingIndex: number, history: readonly string[]): string;
  terminalUtilities(state: Extract<ThreeWayRiverState, { phase: "play" }>): readonly [number, number, number];
  audit(profile: MultiwayStrategyProfile<ThreeWayRiverAction>): ThreeWayRiverAudit;
  actionValues(profile: MultiwayStrategyProfile<ThreeWayRiverAction>): readonly ThreeWayRiverActionEv[];
}>;

const PLAYERS = [0, 1, 2] as const;
const PLAYER_NAMES: readonly ThreeWayRiverPlayer[] = ["oop", "middle", "ip"];
const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
const SUIT_SYMBOL: Record<StrategyCard["suit"], string> = {
  spades: "s",
  hearts: "h",
  diamonds: "d",
  clubs: "c",
};
const RANK_SYMBOL: Record<number, string> = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "T" };
const DEFAULT_TREE: ThreeWayRiverBettingTree = Object.freeze({
  betPotFractions: Object.freeze([0.5, 1]),
  allInAlwaysAvailable: true,
});
const AMOUNT_PRECISION = 1_000_000;
const PROBABILITY_TOLERANCE = 1e-9;
const MINIMUM_BET_BB = 1;

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} 必须是正的有限数值`);
  return value;
}

function normalizeAmount(value: number): number {
  return Math.round(value * AMOUNT_PRECISION) / AMOUNT_PRECISION;
}

function amountText(value: number): string {
  return String(normalizeAmount(value));
}

function rawCardKey(card: StrategyCard): string {
  return `${card.rank}:${card.suit}`;
}

function cardKey(card: StrategyCard): string {
  return `${RANK_SYMBOL[card.rank] ?? card.rank}${SUIT_SYMBOL[card.suit]}`;
}

function holdingKey(holding: WeightedThreeWayRiverHolding): string {
  return [...holding.cards]
    .sort((left, right) => right.rank - left.rank || SUITS.indexOf(left.suit) - SUITS.indexOf(right.suit))
    .map(cardKey)
    .join("");
}

function assertCard(card: StrategyCard, path: string): void {
  if (!Number.isInteger(card.rank) || card.rank < 2 || card.rank > 14) {
    throw new RangeError(`${path}.rank 必须是 2..14 的整数`);
  }
  if (!SUITS.includes(card.suit)) throw new RangeError(`${path}.suit 不是标准花色`);
}

function assertUniqueCards(cards: readonly StrategyCard[], path: string): void {
  const seen = new Set<string>();
  cards.forEach((card, index) => {
    assertCard(card, `${path}[${index}]`);
    const key = rawCardKey(card);
    if (seen.has(key)) throw new RangeError(`${path} 包含重复牌 ${cardKey(card)}`);
    seen.add(key);
  });
}

function normalizeRange(
  range: readonly WeightedThreeWayRiverHolding[],
  boardKeys: ReadonlySet<string>,
  label: string,
): readonly WeightedThreeWayRiverHolding[] {
  if (!Array.isArray(range) || range.length === 0) throw new RangeError(`${label} 不能为空`);
  const seen = new Set<string>();
  return Object.freeze(range.map((holding, index) => {
    if (!holding || !Array.isArray(holding.cards) || holding.cards.length !== 2) {
      throw new TypeError(`${label}[${index}].cards 必须正好有两张牌`);
    }
    const cards = holding.cards as readonly [StrategyCard, StrategyCard];
    assertUniqueCards(cards, `${label}[${index}].cards`);
    if (cards.some((card) => boardKeys.has(rawCardKey(card)))) {
      throw new RangeError(`${label}[${index}] 与公共牌冲突`);
    }
    finitePositive(holding.weight, `${label}[${index}].weight`);
    const key = holdingKey(holding);
    if (seen.has(key)) throw new RangeError(`${label} 包含重复组合 ${key}`);
    seen.add(key);
    return Object.freeze({
      cards: Object.freeze(cards.map((card) => Object.freeze({ ...card }))) as readonly [StrategyCard, StrategyCard],
      weight: holding.weight,
    });
  }));
}

function normalizeSpec(input: ThreeWayRiverSpec): NormalizedThreeWayRiverSpec {
  if (!input || !Array.isArray(input.board) || input.board.length !== 5) {
    throw new TypeError("board 必须正好有五张公共牌");
  }
  if (!Array.isArray(input.ranges) || input.ranges.length !== 3) {
    throw new TypeError("ranges 必须正好包含 OOP、中间位和 IP 三个范围");
  }
  if (!Array.isArray(input.stackBb) || input.stackBb.length !== 3) {
    throw new TypeError("stackBb 必须正好包含三位玩家的河牌可用筹码");
  }
  assertUniqueCards(input.board, "board");
  const board = Object.freeze(input.board.map((card) => Object.freeze({ ...card }))) as NormalizedThreeWayRiverSpec["board"];
  const boardKeys = new Set(board.map(rawCardKey));
  const ranges = Object.freeze(PLAYERS.map((player) =>
    normalizeRange(input.ranges[player], boardKeys, `ranges[${player}]`),
  )) as NormalizedThreeWayRiverSpec["ranges"];
  const stackBb = Object.freeze(PLAYERS.map((player) =>
    finitePositive(input.stackBb[player], `stackBb[${player}]`),
  )) as NormalizedThreeWayRiverSpec["stackBb"];
  const rawFractions = input.bettingTree?.betPotFractions ?? DEFAULT_TREE.betPotFractions;
  if (!Array.isArray(rawFractions) || rawFractions.length === 0) {
    throw new RangeError("bettingTree.betPotFractions 不能为空");
  }
  const betPotFractions = Object.freeze([...new Set(rawFractions.map((fraction, index) =>
    normalizeAmount(finitePositive(fraction, `bettingTree.betPotFractions[${index}]`)),
  ))].sort((left, right) => left - right));
  return Object.freeze({
    board,
    ranges,
    potBb: finitePositive(input.potBb, "potBb"),
    stackBb,
    startingHistory: Object.freeze([...(input.startingHistory ?? [])]),
    bettingTree: Object.freeze({
      betPotFractions,
      allInAlwaysAvailable: input.bettingTree?.allInAlwaysAvailable ?? DEFAULT_TREE.allInAlwaysAvailable,
    }),
  });
}

function overlaps(left: WeightedThreeWayRiverHolding, right: WeightedThreeWayRiverHolding): boolean {
  const keys = new Set(left.cards.map(rawCardKey));
  return right.cards.some((card) => keys.has(rawCardKey(card)));
}

function buildDeals(spec: NormalizedThreeWayRiverSpec): readonly ThreeWayDeal[] {
  const raw: Array<{ holdingIndices: readonly [number, number, number]; logWeight: number }> = [];
  spec.ranges[0].forEach((oop, oopIndex) => {
    spec.ranges[1].forEach((middle, middleIndex) => {
      if (overlaps(oop, middle)) return;
      spec.ranges[2].forEach((ip, ipIndex) => {
        if (overlaps(oop, ip) || overlaps(middle, ip)) return;
        raw.push({
          holdingIndices: [oopIndex, middleIndex, ipIndex],
          logWeight: Math.log(oop.weight) + Math.log(middle.weight) + Math.log(ip.weight),
        });
      });
    });
  });
  if (raw.length === 0) throw new RangeError("三个范围之间没有任何合法的兼容发牌");
  const maximum = raw.reduce((result, deal) => Math.max(result, deal.logWeight), Number.NEGATIVE_INFINITY);
  const scaled = raw.map((deal) => ({ ...deal, weight: Math.exp(deal.logWeight - maximum) }))
    .filter((deal) => deal.weight > 0);
  const total = scaled.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(total) || total <= 0) throw new RangeError("范围权重无法稳定归一化");
  return Object.freeze(scaled.map((deal) => Object.freeze({
    holdingIndices: deal.holdingIndices,
    probability: deal.weight / total,
  })));
}

function historyKey(history: readonly string[]): string {
  return history.length === 0 ? "root" : history.join(">");
}

function orderedOthersAfter(player: PlayerIndex): readonly PlayerIndex[] {
  return Object.freeze([
    ((player + 1) % 3) as PlayerIndex,
    ((player + 2) % 3) as PlayerIndex,
  ]);
}

function liveCount(live: readonly boolean[]): number {
  return live.reduce((sum, value) => sum + Number(value), 0);
}

function publicActions(
  spec: NormalizedThreeWayRiverSpec,
  state: Extract<ThreeWayRiverState, { phase: "play" }>,
): readonly ThreeWayRiverAction[] {
  if (state.terminal) return [];
  if (state.bettor !== undefined) return Object.freeze(["fold", "call"]);
  const actions: ThreeWayRiverAction[] = ["check"];
  const targets = spec.bettingTree.betPotFractions.map((fraction) =>
    Math.min(spec.stackBb[state.actor], spec.potBb * fraction),
  );
  if (spec.bettingTree.allInAlwaysAvailable) targets.push(spec.stackBb[state.actor]);
  for (const target of [...new Set(targets.map(normalizeAmount))].sort((left, right) => left - right)) {
    if (target + 1 / AMOUNT_PRECISION < Math.min(MINIMUM_BET_BB, spec.stackBb[state.actor])) continue;
    const action = `bet-to:${amountText(target)}`;
    if (!actions.includes(action)) actions.push(action);
  }
  return Object.freeze(actions);
}

function playNextState(
  spec: NormalizedThreeWayRiverSpec,
  state: Extract<ThreeWayRiverState, { phase: "play" }>,
  action: ThreeWayRiverAction,
): Extract<ThreeWayRiverState, { phase: "play" }> {
  if (!publicActions(spec, state).includes(action)) throw new Error(`当前节点不允许动作 ${action}`);
  const history = Object.freeze([...state.history, action]);
  if (action === "check") {
    if (state.actor === 2) return { ...state, history, terminal: "showdown" };
    return { ...state, actor: (state.actor + 1) as PlayerIndex, history };
  }
  if (action.startsWith("bet-to:")) {
    const target = Number(action.slice("bet-to:".length));
    if (!Number.isFinite(target)) throw new Error(`非法下注金额 ${action}`);
    const contributions = [...state.contributions] as [number, number, number];
    contributions[state.actor] = target;
    const pending = orderedOthersAfter(state.actor);
    return {
      ...state,
      actor: pending[0],
      bettor: state.actor,
      contributions: Object.freeze(contributions),
      pending,
      history,
    };
  }

  const live = [...state.live] as [boolean, boolean, boolean];
  const contributions = [...state.contributions] as [number, number, number];
  if (action === "fold") live[state.actor] = false;
  else if (action === "call") {
    const betTarget = state.bettor === undefined ? 0 : state.contributions[state.bettor];
    contributions[state.actor] = Math.min(betTarget, spec.stackBb[state.actor]);
  }
  const pending = state.pending.slice(1) as readonly PlayerIndex[];
  if (liveCount(live) === 1) {
    return { ...state, history, live: Object.freeze(live), contributions: Object.freeze(contributions), pending, terminal: "fold" };
  }
  if (pending.length === 0) {
    return { ...state, history, live: Object.freeze(live), contributions: Object.freeze(contributions), pending, terminal: "showdown" };
  }
  return {
    ...state,
    actor: pending[0],
    history,
    live: Object.freeze(live),
    contributions: Object.freeze(contributions),
    pending,
  };
}

function strategyProbability(
  profile: MultiwayStrategyProfile<ThreeWayRiverAction>,
  player: PlayerIndex,
  informationSet: string,
  actions: readonly ThreeWayRiverAction[],
  actionIndex: number,
): number {
  const entry = profile[player].get(informationSet);
  if (!entry) return 1 / actions.length;
  if (entry.actions.length !== entry.probabilities.length) throw new Error(`策略节点 ${informationSet} 的动作与频率长度不同`);
  const byAction = new Map(entry.actions.map((action, index) => [action, entry.probabilities[index]]));
  const total = entry.probabilities.reduce((sum, value) => sum + value, 0);
  if (byAction.size !== actions.length || entry.actions.length !== actions.length
    || entry.probabilities.some((value) => !Number.isFinite(value) || value < 0)
    || Math.abs(total - 1) > PROBABILITY_TOLERANCE) {
    throw new Error(`策略节点 ${informationSet} 的动作或频率无效`);
  }
  const probability = byAction.get(actions[actionIndex]);
  if (probability === undefined) throw new Error(`策略节点 ${informationSet} 缺少动作 ${actions[actionIndex]}`);
  return probability;
}

function immutableStrategyProfile(
  profile: MultiwayStrategyProfile<ThreeWayRiverAction>,
): MultiwayStrategyProfile<ThreeWayRiverAction> {
  const maps = profile.map((source) => {
    const copied = new Map([...source].map(([informationSet, entry]) => [
      informationSet,
      Object.freeze({
        actions: Object.freeze([...entry.actions]),
        probabilities: Object.freeze([...entry.probabilities]),
      }),
    ]));
    const readonlyMap = new Proxy(copied, {
      get(target, property) {
        if (property === "set" || property === "delete" || property === "clear") {
          return () => { throw new TypeError("求解策略是只读结果"); };
        }
        if (property === "forEach") {
          return (callback: (
            value: MultiwayStrategyEntry<ThreeWayRiverAction>,
            key: string,
            map: ReadonlyMap<string, MultiwayStrategyEntry<ThreeWayRiverAction>>,
          ) => void, thisArg?: unknown) => target.forEach((value, key) => callback.call(thisArg, value, key, readonlyMap));
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ReadonlyMap<string, MultiwayStrategyEntry<ThreeWayRiverAction>>;
    return readonlyMap;
  });
  return Object.freeze(maps) as MultiwayStrategyProfile<ThreeWayRiverAction>;
}

/** Builds a three-player exact-card river game with a single-bet/no-raise public tree. */
export function createThreeWayRiverGame(input: ThreeWayRiverSpec): ThreeWayRiverGame {
  const spec = normalizeSpec(input);
  const deals = buildDeals(spec);
  const holdingKeys = Object.freeze(PLAYERS.map((player) =>
    Object.freeze(spec.ranges[player].map(holdingKey)),
  ));
  const scores = Object.freeze(PLAYERS.map((player) =>
    spec.ranges[player].map((holding) => bestHand([...spec.board, ...holding.cards]).score),
  ));
  const infoKey = (player: PlayerIndex, holdingIndex: number, history: readonly string[]) =>
    `river3|P${player}|${holdingKeys[player][holdingIndex]}|${historyKey(history)}`;

  const stateAtPublicStart = (
    dealIndex: number,
  ): Extract<ThreeWayRiverState, { phase: "play" }> => {
    let state: Extract<ThreeWayRiverState, { phase: "play" }> = {
      phase: "play",
      dealIndex,
      actor: 0,
      history: [],
      contributions: [0, 0, 0],
      live: [true, true, true],
      pending: [],
    };
    for (const [index, action] of spec.startingHistory.entries()) {
      if (state.terminal) throw new Error(`startingHistory 在第 ${index + 1} 个动作前已经终局`);
      state = playNextState(spec, state, action);
    }
    if (state.terminal) throw new Error("startingHistory 不能指向已经结束的河牌节点");
    return state;
  };
  // Validate the public prefix even when no compatible chance deal happens to
  // use index zero later in a caller-provided evaluator.
  stateAtPublicStart(0);

  const terminalForDeal = (
    state: Extract<ThreeWayRiverState, { phase: "play" }>,
    dealIndex: number,
  ): readonly [number, number, number] => {
    if (!state.terminal) throw new Error("只有终局才能计算效用");
    const deal = deals[dealIndex];
    if (!deal) throw new RangeError(`未知发牌 ${dealIndex}`);
    const payouts = [0, 0, 0];
    const award = (amount: number, eligible: readonly PlayerIndex[]) => {
      if (eligible.length === 0) throw new Error("边池没有符合资格的玩家");
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const player of eligible) bestScore = Math.max(bestScore, scores[player][deal.holdingIndices[player]]);
      const winners = eligible.filter((player) => scores[player][deal.holdingIndices[player]] === bestScore);
      for (const winner of winners) payouts[winner] += amount / winners.length;
    };

    const livePlayers = PLAYERS.filter((player) => state.live[player]);
    award(spec.potBb, livePlayers);
    const levels = [...new Set(state.contributions.filter((amount) => amount > 0))].sort((left, right) => left - right);
    let previous = 0;
    for (const level of levels) {
      const contributors = PLAYERS.filter((player) => state.contributions[player] + 1 / AMOUNT_PRECISION >= level);
      const amount = (level - previous) * contributors.length;
      const eligible = contributors.filter((player) => state.live[player]);
      if (eligible.length === 0) throw new Error("边池没有存活玩家");
      award(amount, eligible);
      previous = level;
    }
    const utilities = PLAYERS.map((player) =>
      payouts[player] - spec.potBb / 3 - state.contributions[player],
    ) as [number, number, number];
    const zeroSumError = utilities.reduce((sum, value) => sum + value, 0);
    if (Math.abs(zeroSumError) > 1e-8) throw new Error(`三人终局效用不是常和中心化结果：${zeroSumError}`);
    return Object.freeze(utilities);
  };

  const cachedChanceOutcomes = Object.freeze(deals.map((deal, index) =>
    Object.freeze({ action: `deal:${index}`, probability: deal.probability }),
  ));
  const game: TabularMultiwayGame<ThreeWayRiverState, ThreeWayRiverAction> = {
    playerCount: 3,
    initialState: { phase: "chance" },
    currentActor(state) {
      if (state.phase === "chance") return "chance";
      return state.terminal ? "terminal" : state.actor;
    },
    actions(state) {
      return state.phase === "chance" ? [] : publicActions(spec, state);
    },
    nextState(state, action) {
      if (state.phase === "chance") {
        if (!action.startsWith("deal:")) throw new Error(`非法机会动作 ${action}`);
        const dealIndex = Number(action.slice(5));
        if (!Number.isSafeInteger(dealIndex) || !deals[dealIndex]) throw new Error(`未知发牌 ${action}`);
        return stateAtPublicStart(dealIndex);
      }
      return playNextState(spec, state, action);
    },
    informationSet(state, player) {
      if (state.phase !== "play" || state.terminal || state.actor !== player) {
        throw new Error("只有当前行动玩家的非终局节点才有信息集");
      }
      return infoKey(
        player as PlayerIndex,
        deals[state.dealIndex].holdingIndices[player],
        state.history,
      );
    },
    chanceOutcomes(state) {
      return state.phase === "chance" ? cachedChanceOutcomes : [];
    },
    terminalUtilities(state) {
      if (state.phase !== "play") throw new Error("机会节点没有终局效用");
      return terminalForDeal(state, state.dealIndex);
    },
  };

  const root = (): Extract<ThreeWayRiverState, { phase: "play" }> => stateAtPublicStart(0);

  const continuationValues = (
    profile: MultiwayStrategyProfile<ThreeWayRiverAction>,
  ) => {
    const cache = new Map<string, readonly [Float64Array, Float64Array, Float64Array]>();
    const recurse = (state: Extract<ThreeWayRiverState, { phase: "play" }>): readonly [Float64Array, Float64Array, Float64Array] => {
      const key = historyKey(state.history);
      const cached = cache.get(key);
      if (cached) return cached;
      if (state.terminal) {
        const terminal = Object.freeze(PLAYERS.map((player) =>
          Float64Array.from(deals, (_, dealIndex) => terminalForDeal(state, dealIndex)[player]),
        )) as readonly [Float64Array, Float64Array, Float64Array];
        cache.set(key, terminal);
        return terminal;
      }
      const actions = publicActions(spec, state);
      const values = PLAYERS.map(() => new Float64Array(deals.length)) as [Float64Array, Float64Array, Float64Array];
      for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
        const child = recurse(playNextState(spec, state, actions[actionIndex]));
        for (let dealIndex = 0; dealIndex < deals.length; dealIndex += 1) {
          const holdingIndex = deals[dealIndex].holdingIndices[state.actor];
          const probability = strategyProbability(
            profile,
            state.actor,
            infoKey(state.actor, holdingIndex, state.history),
            actions,
            actionIndex,
          );
          for (const player of PLAYERS) values[player][dealIndex] += probability * child[player][dealIndex];
        }
      }
      const frozen = Object.freeze(values) as readonly [Float64Array, Float64Array, Float64Array];
      cache.set(key, frozen);
      return frozen;
    };
    return recurse;
  };

  const audit = (profile: MultiwayStrategyProfile<ThreeWayRiverAction>): ThreeWayRiverAudit => {
    const continuation = continuationValues(profile);
    const profileByDeal = continuation(root());
    const profileValues = PLAYERS.map((player) => deals.reduce(
      (sum, deal, dealIndex) => sum + deal.probability * profileByDeal[player][dealIndex],
      0,
    )) as [number, number, number];

    const bestResponse = (responder: PlayerIndex): number => {
      const recurse = (
        state: Extract<ThreeWayRiverState, { phase: "play" }>,
        opponentsReach: Float64Array,
      ): Float64Array => {
        if (state.terminal) return Float64Array.from(deals, (_, dealIndex) => terminalForDeal(state, dealIndex)[responder]);
        const actions = publicActions(spec, state);
        if (state.actor === responder) {
          const children = actions.map((action) => recurse(playNextState(spec, state, action), opponentsReach));
          const selected = new Int32Array(spec.ranges[responder].length);
          for (let holdingIndex = 0; holdingIndex < selected.length; holdingIndex += 1) {
            let bestAction = 0;
            let bestValue = Number.NEGATIVE_INFINITY;
            for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
              let value = 0;
              for (let dealIndex = 0; dealIndex < deals.length; dealIndex += 1) {
                if (deals[dealIndex].holdingIndices[responder] !== holdingIndex) continue;
                value += deals[dealIndex].probability * opponentsReach[dealIndex] * children[actionIndex][dealIndex];
              }
              if (value > bestValue) {
                bestValue = value;
                bestAction = actionIndex;
              }
            }
            selected[holdingIndex] = bestAction;
          }
          return Float64Array.from(deals, (deal, dealIndex) =>
            children[selected[deal.holdingIndices[responder]]][dealIndex],
          );
        }

        const values = new Float64Array(deals.length);
        for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
          const probabilities = new Float64Array(deals.length);
          const childReach = new Float64Array(deals.length);
          for (let dealIndex = 0; dealIndex < deals.length; dealIndex += 1) {
            const holdingIndex = deals[dealIndex].holdingIndices[state.actor];
            const probability = strategyProbability(
              profile,
              state.actor,
              infoKey(state.actor, holdingIndex, state.history),
              actions,
              actionIndex,
            );
            probabilities[dealIndex] = probability;
            childReach[dealIndex] = opponentsReach[dealIndex] * probability;
          }
          const child = recurse(playNextState(spec, state, actions[actionIndex]), childReach);
          for (let dealIndex = 0; dealIndex < deals.length; dealIndex += 1) {
            values[dealIndex] += probabilities[dealIndex] * child[dealIndex];
          }
        }
        return values;
      };
      const values = recurse(root(), new Float64Array(deals.length).fill(1));
      return deals.reduce((sum, deal, index) => sum + deal.probability * values[index], 0);
    };

    const bestResponseValues = PLAYERS.map(bestResponse) as [number, number, number];
    const gains = PLAYERS.map((player) => Math.max(0, bestResponseValues[player] - profileValues[player])) as [number, number, number];
    const nashConvBb = gains.reduce((sum, value) => sum + value, 0);
    const publicStart = root();
    const currentPotBb = spec.potBb + publicStart.contributions.reduce((sum, value) => sum + value, 0);
    return Object.freeze({
      profileValueBb: Object.freeze(profileValues),
      bestResponseValueBb: Object.freeze(bestResponseValues),
      perPlayerGainBb: Object.freeze(gains),
      nashConvBb,
      normalizationPotBb: currentPotBb,
      nashConvPotFraction: nashConvBb / currentPotBb,
    });
  };

  const actionValues = (
    profile: MultiwayStrategyProfile<ThreeWayRiverAction>,
  ): readonly ThreeWayRiverActionEv[] => {
    const continuation = continuationValues(profile);
    const result = new Map<string, ThreeWayRiverActionEv>();
    const traverse = (
      state: Extract<ThreeWayRiverState, { phase: "play" }>,
      reaches: readonly [Float64Array, Float64Array, Float64Array],
    ): void => {
      if (state.terminal) return;
      const actor = state.actor;
      const actions = publicActions(spec, state);
      const children = actions.map((action) => continuation(playNextState(spec, state, action)));
      for (let holdingIndex = 0; holdingIndex < spec.ranges[actor].length; holdingIndex += 1) {
        const informationSet = infoKey(actor, holdingIndex, state.history);
        if (!profile[actor].has(informationSet)) continue;
        let counterfactualReach = 0;
        const sums = new Float64Array(actions.length);
        for (let dealIndex = 0; dealIndex < deals.length; dealIndex += 1) {
          if (deals[dealIndex].holdingIndices[actor] !== holdingIndex) continue;
          let weight = deals[dealIndex].probability;
          for (const player of PLAYERS) if (player !== actor) weight *= reaches[player][dealIndex];
          counterfactualReach += weight;
          for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
            sums[actionIndex] += weight * children[actionIndex][actor][dealIndex];
          }
        }
        const [, , holding, history] = informationSet.split("|");
        result.set(informationSet, Object.freeze({
          player: PLAYER_NAMES[actor],
          holding,
          history,
          actions: Object.freeze([...actions]),
          actionEvBb: Object.freeze(Array.from(sums, (value) => counterfactualReach > 0 ? value / counterfactualReach : 0)),
          counterfactualReach,
        }));
      }

      for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
        const actorReach = Float64Array.from(reaches[actor]);
        for (let dealIndex = 0; dealIndex < deals.length; dealIndex += 1) {
          const holdingIndex = deals[dealIndex].holdingIndices[actor];
          actorReach[dealIndex] *= strategyProbability(
            profile,
            actor,
            infoKey(actor, holdingIndex, state.history),
            actions,
            actionIndex,
          );
        }
        const childReaches = [...reaches] as [Float64Array, Float64Array, Float64Array];
        childReaches[actor] = actorReach;
        traverse(playNextState(spec, state, actions[actionIndex]), childReaches);
      }
    };
    traverse(root(), [
      new Float64Array(deals.length).fill(1),
      new Float64Array(deals.length).fill(1),
      new Float64Array(deals.length).fill(1),
    ]);
    return Object.freeze([...result.values()].sort((left, right) =>
      left.player.localeCompare(right.player)
        || left.history.localeCompare(right.history)
        || left.holding.localeCompare(right.holding),
    ));
  };

  const canonicalRange = (range: readonly WeightedThreeWayRiverHolding[]) => range
    .map((holding) => ({ holding: holdingKey(holding), weight: holding.weight }))
    .sort((left, right) => left.holding.localeCompare(right.holding));
  const gameSpecId = `rc-3way-river-game-v1-${stableGtoHash({
    variant: "no-limit-holdem",
    players: 3,
    street: "river",
    utility: "chip-ev",
    rake: { percent: 0, capBb: 0 },
  })}`;
  const treeId = `rc-3way-river-tree-v1-${stableGtoHash({
    ...spec.bettingTree,
    raises: 0,
    actionOrder: ["oop", "middle", "ip"],
  })}`;
  const spotId = `rc-3way-river-spot-v1-${stableGtoHash({
    gameSpecId,
    treeId,
    board: spec.board.map(cardKey).sort(),
    ranges: spec.ranges.map(canonicalRange),
    potBb: spec.potBb,
    stackBb: spec.stackBb,
    startingHistory: spec.startingHistory,
  })}`;

  return Object.freeze({
    game,
    spec,
    compatibleDeals: deals.length,
    spotId,
    gameSpecId,
    treeId,
    holdingKey(player, holdingIndex) {
      const key = holdingKeys[player][holdingIndex];
      if (!key) throw new RangeError(`玩家 ${player} 没有第 ${holdingIndex} 个组合`);
      return key;
    },
    informationSet: infoKey,
    terminalUtilities(state) {
      return terminalForDeal(state, state.dealIndex);
    },
    audit,
    actionValues,
  });
}

function exportedStrategies(
  profile: MultiwayStrategyProfile<ThreeWayRiverAction>,
): readonly ThreeWayRiverStrategy[] {
  const result: ThreeWayRiverStrategy[] = [];
  profile.forEach((playerStrategy, player) => {
    for (const [informationSet, entry] of playerStrategy) {
      const [, , holding, history] = informationSet.split("|");
      result.push(Object.freeze({
        player: PLAYER_NAMES[player],
        holding,
        history,
        actions: Object.freeze([...entry.actions]),
        frequencies: Object.freeze([...entry.probabilities]),
      }));
    }
  });
  return Object.freeze(result.sort((left, right) =>
    left.player.localeCompare(right.player)
      || left.history.localeCompare(right.history)
      || left.holding.localeCompare(right.holding),
  ));
}

function buildThreeWayRiverSolution(
  model: ThreeWayRiverGame,
  iterations: number,
  averageStrategy: MultiwayStrategyProfile<ThreeWayRiverAction>,
): ThreeWayRiverSolution {
  const approximation: ThreeWayRiverApproximation = Object.freeze({
    equilibrium: "three-player-cfr+-approximation",
    cards: "exact-card-collision-aware",
    ranges: "independent-input-weights-conditioned-on-compatible-deals",
    actionTree: "single-bet-no-raise",
    actionSet: "check-bet-fold-call",
    stacks: "individual-caps-with-side-pots",
    startingPot: "single-common-pot-no-preexisting-side-pots",
    caveat: "多人 CFR+ 不具有两人零和 CFR 的一般收敛保证；NashConv 仅审计本固定下注树与输入范围。",
  });
  return Object.freeze({
    solverVersion: "rangecraft-multiway-cfr+/0.1.0",
    source: "internal-solver",
    spotId: model.spotId,
    gameSpecId: model.gameSpecId,
    treeId: model.treeId,
    iterations,
    compatibleDeals: model.compatibleDeals,
    accuracyScope: "within-fixed-tree",
    approximation,
    audit: model.audit(averageStrategy),
    strategies: exportedStrategies(averageStrategy),
    actionValues: model.actionValues(averageStrategy),
    averageStrategy,
  });
}

class StatefulThreeWayRiverSolverSession implements ThreeWayRiverSolverSession {
  readonly #model: ThreeWayRiverGame;
  readonly #solver: MultiwayCFRPlusSolver<ThreeWayRiverState, ThreeWayRiverAction>;
  readonly #averagingDelay: number;
  readonly #linearAveraging: boolean;
  #averageStrategy: MultiwayStrategyProfile<ThreeWayRiverAction> | null = null;

  constructor(spec: ThreeWayRiverSpec, options: ThreeWayRiverSolverSessionOptions) {
    this.#model = createThreeWayRiverGame(spec);
    this.#solver = new MultiwayCFRPlusSolver(this.#model.game);
    this.#averagingDelay = options.averagingDelay ?? 0;
    this.#linearAveraging = options.linearAveraging ?? true;
  }

  get iterations(): number {
    return this.#solver.iterations;
  }

  run(additionalIterations: number): ThreeWayRiverCheckpoint {
    const iterations = this.#solver.train({
      iterations: additionalIterations,
      averagingDelay: this.#averagingDelay,
      linearAveraging: this.#linearAveraging,
    });
    const averageStrategy = immutableStrategyProfile(this.#solver.averageStrategy());
    this.#averageStrategy = averageStrategy;
    return Object.freeze({
      iterations,
      audit: this.#model.audit(averageStrategy),
      averageStrategy,
    });
  }

  solution(): ThreeWayRiverSolution {
    if (!this.#averageStrategy) {
      throw new Error("三人河牌求解会话尚未运行任何检查点");
    }
    return buildThreeWayRiverSolution(this.#model, this.iterations, this.#averageStrategy);
  }
}

/**
 * Creates a resumable three-player river solve. The same regret tables are
 * preserved across run() calls, allowing UI clients to yield between bounded
 * chunks, report measured progress, and stop once their training gate is met.
 */
export function createThreeWayRiverSolverSession(
  spec: ThreeWayRiverSpec,
  options: ThreeWayRiverSolverSessionOptions = {},
): ThreeWayRiverSolverSession {
  return Object.freeze(new StatefulThreeWayRiverSolverSession(spec, options));
}

export function solveThreeWayRiver(
  spec: ThreeWayRiverSpec,
  options: SolveThreeWayRiverOptions,
): ThreeWayRiverSolution {
  const session = createThreeWayRiverSolverSession(spec, options);
  session.run(options.iterations);
  return session.solution();
}

function playerIndex(player: ThreeWayRiverPlayer): PlayerIndex {
  return PLAYER_NAMES.indexOf(player) as PlayerIndex;
}

export function threeWayRiverStrategyEntry(
  solution: ThreeWayRiverSolution,
  player: ThreeWayRiverPlayer,
  holding: string,
  history = "root",
): MultiwayStrategyEntry<ThreeWayRiverAction> | undefined {
  const index = playerIndex(player);
  return solution.averageStrategy[index].get(`river3|P${index}|${holding}|${history}`);
}

export function threeWayRiverActionEvEntry(
  solution: ThreeWayRiverSolution,
  player: ThreeWayRiverPlayer,
  holding: string,
  history = "root",
): ThreeWayRiverActionEv | undefined {
  return solution.actionValues.find((entry) =>
    entry.player === player && entry.holding === holding && entry.history === history,
  );
}
