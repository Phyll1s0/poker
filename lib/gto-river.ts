import {
  CFRPlusSolver,
  DEFAULT_DCFR_PARAMETERS,
  DEFAULT_PDCFR_PLUS_PARAMETERS,
  DiscountedCFRSolver,
  PredictiveDiscountedCFRPlusSolver,
  exactExploitability as exactSmallGameExploitability,
  expectedValue,
  solveCFRPlus,
  type CFRPlayer,
  type CFRStrategyEntry,
  type CFRStrategyProfile,
  type DiscountedCFRParameters,
  type PredictiveDiscountedCFRPlusParameters,
  type TabularZeroSumGame,
} from "./gto-cfr.ts";
import {
  RANGECRAFT_STANDARD_V1,
  headsUpAccuracyLevel,
  stableGtoHash,
  type HeadsUpAccuracyLevel,
} from "./gto-standard.ts";
import { bestHand } from "./poker-evaluator.ts";
import type { StrategyCard } from "./poker-strategy.ts";

export type HeadsUpRiverPlayer = "oop" | "ip";
export type HeadsUpRiverAction = string;

export type WeightedRiverHolding = Readonly<{
  cards: readonly [StrategyCard, StrategyCard];
  weight: number;
}>;

export type HeadsUpRiverBettingTree = Readonly<{
  betPotFractions: readonly number[];
  raisePotAfterCallFractions: readonly number[];
  /** Raises after the first bet. A value of zero creates a bet/call/fold tree. */
  maxRaises: number;
  allInAlwaysAvailable: boolean;
}>;

export type HeadsUpRiverSpec = Readonly<{
  board: readonly [StrategyCard, StrategyCard, StrategyCard, StrategyCard, StrategyCard];
  oopRange: readonly WeightedRiverHolding[];
  ipRange: readonly WeightedRiverHolding[];
  potBb: number;
  effectiveStackBb: number;
  bettingTree?: Partial<HeadsUpRiverBettingTree>;
}>;

export type NormalizedHeadsUpRiverSpec = Readonly<{
  board: readonly [StrategyCard, StrategyCard, StrategyCard, StrategyCard, StrategyCard];
  oopRange: readonly WeightedRiverHolding[];
  ipRange: readonly WeightedRiverHolding[];
  potBb: number;
  effectiveStackBb: number;
  bettingTree: HeadsUpRiverBettingTree;
}>;

type RiverTerminal = "showdown" | "fold";

export type HeadsUpRiverState =
  | Readonly<{ phase: "chance" }>
  | Readonly<{
      phase: "play";
      dealIndex: number;
      actor: CFRPlayer;
      history: readonly HeadsUpRiverAction[];
      contributions: readonly [number, number];
      checks: 0 | 1;
      raises: number;
      lastFullRaiseBb: number;
      terminal?: RiverTerminal;
      foldedPlayer?: CFRPlayer;
    }>;

type RiverDeal = Readonly<{
  holdingIndices: readonly [number, number];
  probability: number;
}>;

export type HeadsUpRiverStrategy = Readonly<{
  player: HeadsUpRiverPlayer;
  holding: string;
  history: string;
  actions: readonly HeadsUpRiverAction[];
  frequencies: readonly number[];
}>;

/**
 * Acting-player EV for forcing each legal action at one information set and
 * then returning to the solved profile. Values are normalized by chance and
 * opponent counterfactual reach, so the unit remains big blinds. An information
 * set with zero opponent reach reports zero for every action and exposes that
 * fact through `counterfactualReach`.
 */
export type HeadsUpRiverActionEv = Readonly<{
  player: HeadsUpRiverPlayer;
  holding: string;
  history: string;
  actions: readonly HeadsUpRiverAction[];
  actionEvBb: readonly number[];
  counterfactualReach: number;
}>;

export type HeadsUpRiverExploitability = Readonly<{
  profileValueBb: number;
  oopBestResponseValueBb: number;
  ipBestResponseValueForOopBb: number;
  oopDeviationGainBb: number;
  ipDeviationGainBb: number;
  nashConvBb: number;
  exploitabilityBb: number;
  exploitabilityPotFraction: number;
}>;

export type HeadsUpRiverSolverAlgorithm = "cfr+" | "dcfr" | "pdcfr+";

export type HeadsUpRiverConvergenceCheckpoint = Readonly<{
  iterations: number;
  exploitabilityBb: number;
  exploitabilityPotFraction: number;
  targetMet: boolean;
}>;

export type HeadsUpRiverConvergence = Readonly<{
  mode: "fixed" | "adaptive";
  targetExploitabilityPotFraction?: number;
  requiredConsecutiveTargetCheckpoints?: number;
  consecutiveTargetCheckpoints: number;
  trainedIterations: number;
  selectedIterations: number;
  stopReason: "fixed-iterations" | "target-stable" | "iteration-limit";
  checkpoints: readonly HeadsUpRiverConvergenceCheckpoint[];
}>;

export type HeadsUpRiverSolution = Readonly<{
  solverVersion:
    | "rangecraft-cfr+/0.2.0"
    | "rangecraft-dcfr/0.2.0"
    | "rangecraft-pdcfr+/0.1.0";
  resultId: string;
  algorithm: HeadsUpRiverSolverAlgorithm;
  solverParameters: Readonly<{
    updateSchedule: "alternating-player-0-first";
    regretUpdateOrder:
      | "add-then-rm+-clip"
      | "add-then-sign-discount"
      | "discount-add-clip-then-predict";
    averagingSchedule:
      | "alternating-staggered-linear"
      | "paper-polynomial"
      | "alternating-paper-polynomial";
    numericPrecision: "float64";
    averagingDelay?: number;
    linearAveraging?: boolean;
    dcfr?: Readonly<DiscountedCFRParameters>;
    pdcfrPlus?: Readonly<PredictiveDiscountedCFRPlusParameters>;
  }>;
  spotId: string;
  gameSpecId: string;
  treeId: string;
  standardTemplate?: Readonly<{ gameSpecId: string; treeId: string }>;
  source: "internal-solver";
  iterations: number;
  compatibleDeals: number;
  accuracyScope: "within-fixed-tree";
  externalBenchmarkStatus: "not-run";
  accuracyLevel: HeadsUpAccuracyLevel;
  convergence: HeadsUpRiverConvergence;
  exploitability: HeadsUpRiverExploitability;
  strategies: readonly HeadsUpRiverStrategy[];
  actionValues: readonly HeadsUpRiverActionEv[];
  averageStrategy: CFRStrategyProfile<HeadsUpRiverAction>;
}>;

export type SolveHeadsUpRiverOptions =
  | Readonly<{
    algorithm?: "cfr+";
    iterations: number;
    averagingDelay?: number;
    linearAveraging?: boolean;
  }>
  | Readonly<{
    algorithm: "dcfr";
    iterations: number;
    alpha?: number;
    beta?: number;
    gamma?: number;
  }>
  | Readonly<{
    algorithm: "pdcfr+";
    iterations: number;
    alpha?: number;
    gamma?: number;
  }>;

export type SolveHeadsUpRiverAdaptiveOptions = Readonly<{
  algorithm?: HeadsUpRiverSolverAlgorithm;
  maxIterations: number;
  checkpointInterval?: number;
  minimumIterations?: number;
  targetExploitabilityPotFraction?: number;
  requiredConsecutiveTargetCheckpoints?: number;
  averagingDelay?: number;
  linearAveraging?: boolean;
  alpha?: number;
  beta?: number;
  gamma?: number;
}>;

export type HeadsUpRiverGame = Readonly<{
  game: TabularZeroSumGame<HeadsUpRiverState, HeadsUpRiverAction>;
  spec: NormalizedHeadsUpRiverSpec;
  compatibleDeals: number;
  spotId: string;
  gameSpecId: string;
  treeId: string;
  standardTemplate?: Readonly<{ gameSpecId: string; treeId: string }>;
  holdingKey(player: CFRPlayer, holdingIndex: number): string;
  informationSet(player: CFRPlayer, holdingIndex: number, history: readonly string[]): string;
  exploitability(profile: CFRStrategyProfile<HeadsUpRiverAction>): HeadsUpRiverExploitability;
  actionValues(profile: CFRStrategyProfile<HeadsUpRiverAction>): readonly HeadsUpRiverActionEv[];
}>;

const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
const SUIT_SYMBOL: Record<StrategyCard["suit"], string> = {
  spades: "s",
  hearts: "h",
  diamonds: "d",
  clubs: "c",
};
const RANK_SYMBOL: Record<number, string> = {
  14: "A",
  13: "K",
  12: "Q",
  11: "J",
  10: "T",
};
const DEFAULT_RIVER_TREE: HeadsUpRiverBettingTree = Object.freeze({
  betPotFractions: RANGECRAFT_STANDARD_V1.bettingTree.postflop.river.betPotFractions,
  raisePotAfterCallFractions:
    RANGECRAFT_STANDARD_V1.bettingTree.postflop.river.raisePotAfterCallFractions,
  maxRaises: RANGECRAFT_STANDARD_V1.bettingTree.postflop.maxRaisesPerStreet,
  allInAlwaysAvailable: RANGECRAFT_STANDARD_V1.bettingTree.postflop.allInAlwaysAvailable,
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

function cardKey(card: StrategyCard): string {
  return `${RANK_SYMBOL[card.rank] ?? card.rank}${SUIT_SYMBOL[card.suit]}`;
}

function holdingKey(holding: WeightedRiverHolding): string {
  return [...holding.cards]
    .sort((left, right) => right.rank - left.rank || SUITS.indexOf(left.suit) - SUITS.indexOf(right.suit))
    .map(cardKey)
    .join("");
}

function rawCardKey(card: StrategyCard): string {
  return `${card.rank}:${card.suit}`;
}

function assertStandardCard(card: StrategyCard, path: string): void {
  if (!Number.isInteger(card.rank) || card.rank < 2 || card.rank > 14) {
    throw new RangeError(`${path}.rank 必须是 2..14 的整数`);
  }
  if (!SUITS.includes(card.suit)) throw new RangeError(`${path}.suit 不是标准花色`);
}

function assertUniqueCards(cards: readonly StrategyCard[], path: string): void {
  const seen = new Set<string>();
  cards.forEach((card, index) => {
    assertStandardCard(card, `${path}[${index}]`);
    const key = rawCardKey(card);
    if (seen.has(key)) throw new RangeError(`${path} 包含重复牌 ${cardKey(card)}`);
    seen.add(key);
  });
}

function normalizeRange(
  range: readonly WeightedRiverHolding[],
  board: readonly StrategyCard[],
  label: string,
): readonly WeightedRiverHolding[] {
  if (!Array.isArray(range) || range.length === 0) throw new RangeError(`${label} 不能为空`);
  const boardKeys = new Set(board.map(rawCardKey));
  const seen = new Set<string>();
  return Object.freeze(range.map((holding, index) => {
    if (!holding || !Array.isArray(holding.cards) || holding.cards.length !== 2) {
      throw new TypeError(`${label}[${index}].cards 必须正好有两张牌`);
    }
    const cards = holding.cards as readonly StrategyCard[];
    assertUniqueCards(cards, `${label}[${index}].cards`);
    if (cards.some((card: StrategyCard) => boardKeys.has(rawCardKey(card)))) {
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

function normalizeFractions(values: readonly number[], label: string): readonly number[] {
  if (!Array.isArray(values) || values.length === 0) throw new RangeError(`${label} 不能为空`);
  const normalized = [...new Set(values.map((value, index) =>
    normalizeAmount(finitePositive(value, `${label}[${index}]`)),
  ))].sort((left, right) => left - right);
  return Object.freeze(normalized);
}

function normalizeSpec(input: HeadsUpRiverSpec): NormalizedHeadsUpRiverSpec {
  if (!input || !Array.isArray(input.board) || input.board.length !== 5) {
    throw new TypeError("board 必须正好有五张公共牌");
  }
  assertUniqueCards(input.board, "board");
  const board = Object.freeze(
    input.board.map((card) => Object.freeze({ ...card })),
  ) as NormalizedHeadsUpRiverSpec["board"];
  const oopRange = normalizeRange(input.oopRange, board, "oopRange");
  const ipRange = normalizeRange(input.ipRange, board, "ipRange");
  const potBb = finitePositive(input.potBb, "potBb");
  const effectiveStackBb = finitePositive(input.effectiveStackBb, "effectiveStackBb");
  const maxRaises = input.bettingTree?.maxRaises ?? DEFAULT_RIVER_TREE.maxRaises;
  if (!Number.isSafeInteger(maxRaises) || maxRaises < 0 || maxRaises > 4) {
    throw new RangeError("bettingTree.maxRaises 必须是 0..4 的整数");
  }
  const bettingTree = Object.freeze({
    betPotFractions: normalizeFractions(
      input.bettingTree?.betPotFractions ?? DEFAULT_RIVER_TREE.betPotFractions,
      "bettingTree.betPotFractions",
    ),
    raisePotAfterCallFractions: normalizeFractions(
      input.bettingTree?.raisePotAfterCallFractions ?? DEFAULT_RIVER_TREE.raisePotAfterCallFractions,
      "bettingTree.raisePotAfterCallFractions",
    ),
    maxRaises,
    allInAlwaysAvailable:
      input.bettingTree?.allInAlwaysAvailable ?? DEFAULT_RIVER_TREE.allInAlwaysAvailable,
  });
  return Object.freeze({ board, oopRange, ipRange, potBb, effectiveStackBb, bettingTree });
}

function rangesOverlap(left: WeightedRiverHolding, right: WeightedRiverHolding): boolean {
  const leftCards = new Set(left.cards.map(rawCardKey));
  return right.cards.some((card) => leftCards.has(rawCardKey(card)));
}

function buildDeals(spec: NormalizedHeadsUpRiverSpec): readonly RiverDeal[] {
  const raw: Array<{ holdingIndices: readonly [number, number]; logWeight: number }> = [];
  spec.oopRange.forEach((oop, oopIndex) => {
    spec.ipRange.forEach((ip, ipIndex) => {
      if (rangesOverlap(oop, ip)) return;
      raw.push({
        holdingIndices: [oopIndex, ipIndex],
        logWeight: Math.log(oop.weight) + Math.log(ip.weight),
      });
    });
  });
  if (raw.length === 0) throw new RangeError("两个范围之间没有任何合法的兼容发牌");
  const maximumLogWeight = raw.reduce(
    (maximum, { logWeight }) => Math.max(maximum, logWeight),
    Number.NEGATIVE_INFINITY,
  );
  const scaled = raw.map((deal) => ({ ...deal, weight: Math.exp(deal.logWeight - maximumLogWeight) }))
    .filter(({ weight }) => weight > 0);
  const total = scaled.reduce((sum, { weight }) => sum + weight, 0);
  if (!Number.isFinite(total) || total <= 0) throw new RangeError("范围权重无法稳定归一化");
  return Object.freeze(scaled.map(({ holdingIndices, weight }) => Object.freeze({
    holdingIndices,
    probability: weight / total,
  })));
}

function addTargetActions(
  actions: HeadsUpRiverAction[],
  prefix: "bet-to" | "raise-to",
  targets: readonly number[],
  lowerExclusive: number,
  minimumInclusive = lowerExclusive,
): void {
  const existing = new Set(actions);
  for (const rawTarget of targets) {
    const target = normalizeAmount(rawTarget);
    if (target <= lowerExclusive + 1 / AMOUNT_PRECISION) continue;
    if (target + 1 / AMOUNT_PRECISION < minimumInclusive) continue;
    const action = `${prefix}:${amountText(target)}`;
    if (!existing.has(action)) {
      actions.push(action);
      existing.add(action);
    }
  }
}

function publicActions(spec: NormalizedHeadsUpRiverSpec, state: Extract<HeadsUpRiverState, { phase: "play" }>): readonly HeadsUpRiverAction[] {
  if (state.terminal) return [];
  const actor = state.actor;
  const opponent = actor === 0 ? 1 : 0;
  const actorContribution = state.contributions[actor];
  const opponentContribution = state.contributions[opponent];
  const outstanding = opponentContribution - actorContribution;
  if (outstanding <= 1 / AMOUNT_PRECISION) {
    const actions: HeadsUpRiverAction[] = ["check"];
    const targets = spec.bettingTree.betPotFractions.map((fraction) =>
      Math.min(spec.effectiveStackBb, spec.potBb * fraction),
    );
    addTargetActions(
      actions,
      "bet-to",
      targets,
      actorContribution,
      actorContribution + MINIMUM_BET_BB,
    );
    if (spec.bettingTree.allInAlwaysAvailable) {
      addTargetActions(actions, "bet-to", [spec.effectiveStackBb], actorContribution);
    }
    return actions;
  }

  const actions: HeadsUpRiverAction[] = ["fold", "call"];
  if (state.raises >= spec.bettingTree.maxRaises || opponentContribution >= spec.effectiveStackBb) {
    return actions;
  }
  const currentPot = spec.potBb + state.contributions[0] + state.contributions[1];
  const potAfterCall = currentPot + outstanding;
  const targets = spec.bettingTree.raisePotAfterCallFractions.map((fraction) =>
    Math.min(spec.effectiveStackBb, opponentContribution + potAfterCall * fraction),
  );
  const minimumFullRaiseTo = opponentContribution + Math.max(outstanding, state.lastFullRaiseBb);
  addTargetActions(actions, "raise-to", targets, opponentContribution, minimumFullRaiseTo);
  if (spec.bettingTree.allInAlwaysAvailable) {
    addTargetActions(actions, "raise-to", [spec.effectiveStackBb], opponentContribution);
  }
  return actions;
}

function actionAmount(action: HeadsUpRiverAction, prefix: "bet-to" | "raise-to"): number {
  if (!action.startsWith(`${prefix}:`)) throw new Error(`非法动作 ${action}`);
  const amount = Number(action.slice(prefix.length + 1));
  if (!Number.isFinite(amount)) throw new Error(`非法动作金额 ${action}`);
  return amount;
}

function playNextState(
  spec: NormalizedHeadsUpRiverSpec,
  state: Extract<HeadsUpRiverState, { phase: "play" }>,
  action: HeadsUpRiverAction,
): HeadsUpRiverState {
  if (!publicActions(spec, state).includes(action)) throw new Error(`当前节点不允许动作 ${action}`);
  const actor = state.actor;
  const opponent = actor === 0 ? 1 : 0;
  const history = Object.freeze([...state.history, action]);
  if (action === "fold") {
    return { ...state, history, terminal: "fold", foldedPlayer: actor };
  }
  if (action === "call") {
    const contributions: [number, number] = [...state.contributions];
    contributions[actor] = contributions[opponent];
    return { ...state, history, contributions, terminal: "showdown" };
  }
  if (action === "check") {
    if (state.checks === 1) return { ...state, history, terminal: "showdown" };
    return { ...state, actor: opponent, history, checks: 1 };
  }

  const contributions: [number, number] = [...state.contributions];
  if (action.startsWith("bet-to:")) {
    const target = actionAmount(action, "bet-to");
    contributions[actor] = target;
    return {
      ...state,
      actor: opponent,
      history,
      contributions,
      checks: 0,
      lastFullRaiseBb: target - state.contributions[actor],
    };
  }
  const target = actionAmount(action, "raise-to");
  const increment = target - state.contributions[opponent];
  contributions[actor] = target;
  return {
    ...state,
    actor: opponent,
    history,
    contributions,
    raises: state.raises + 1,
    lastFullRaiseBb: increment + 1 / AMOUNT_PRECISION >= state.lastFullRaiseBb
      ? increment
      : state.lastFullRaiseBb,
  };
}

function historyKey(history: readonly HeadsUpRiverAction[]): string {
  return history.length === 0 ? "root" : history.join(">");
}

function strategyProbability(
  profile: CFRStrategyProfile<HeadsUpRiverAction>,
  player: CFRPlayer,
  informationSet: string,
  actions: readonly HeadsUpRiverAction[],
  actionIndex: number,
): number {
  const entry = profile[player].get(informationSet);
  if (!entry) throw new Error(`策略缺少信息集 ${informationSet}`);
  if (entry.actions.length !== entry.probabilities.length) {
    throw new Error(`策略节点 ${informationSet} 的动作与频率长度不同`);
  }
  const byAction = new Map(entry.actions.map((action, index) => [action, entry.probabilities[index]]));
  if (entry.actions.length !== actions.length || byAction.size !== actions.length) {
    throw new Error(`策略节点 ${informationSet} 的动作集合与当前合法动作不一致`);
  }
  const total = entry.probabilities.reduce((sum, value) => sum + value, 0);
  if (entry.probabilities.some((value) => !Number.isFinite(value) || value < 0)
    || Math.abs(total - 1) > PROBABILITY_TOLERANCE) {
    throw new Error(`策略节点 ${informationSet} 的频率无效`);
  }
  const probability = byAction.get(actions[actionIndex]);
  if (probability === undefined) throw new Error(`策略节点 ${informationSet} 缺少动作 ${actions[actionIndex]}`);
  return probability;
}

function isDefaultTree(tree: HeadsUpRiverBettingTree): boolean {
  return stableGtoHash(tree) === stableGtoHash(DEFAULT_RIVER_TREE);
}

/**
 * Builds a finite, exact-card heads-up river game. Chance deals two weighted,
 * collision-aware ranges; an information set contains only the acting player's
 * own holding and the public action history.
 */
export function createHeadsUpRiverGame(input: HeadsUpRiverSpec): HeadsUpRiverGame {
  const spec = normalizeSpec(input);
  const deals = buildDeals(spec);
  const holdingKeys: readonly [readonly string[], readonly string[]] = [
    Object.freeze(spec.oopRange.map(holdingKey)),
    Object.freeze(spec.ipRange.map(holdingKey)),
  ];
  const oopScores = spec.oopRange.map((holding) => bestHand([...spec.board, ...holding.cards]).score);
  const ipScores = spec.ipRange.map((holding) => bestHand([...spec.board, ...holding.cards]).score);
  const showdownSigns = Int8Array.from(deals, (deal) => {
    const oopScore = oopScores[deal.holdingIndices[0]];
    const ipScore = ipScores[deal.holdingIndices[1]];
    return oopScore === ipScore ? 0 : oopScore > ipScore ? 1 : -1;
  });
  const infoKey = (player: CFRPlayer, holdingIndex: number, history: readonly string[]) =>
    `river|P${player}|${holdingKeys[player][holdingIndex]}|${historyKey(history)}`;

  const terminalUtilityForDeal = (
    state: Extract<HeadsUpRiverState, { phase: "play" }>,
    dealIndex: number,
  ): number => {
    if (!state.terminal) throw new Error("只有终局才能计算效用");
    if (state.terminal === "fold") {
      if (state.foldedPlayer === 1) return spec.potBb / 2 + state.contributions[1];
      if (state.foldedPlayer === 0) return -spec.potBb / 2 - state.contributions[0];
      throw new Error("弃牌终局缺少 foldedPlayer");
    }
    if (showdownSigns[dealIndex] > 0) return spec.potBb / 2 + state.contributions[1];
    if (showdownSigns[dealIndex] < 0) return -spec.potBb / 2 - state.contributions[0];
    return (state.contributions[1] - state.contributions[0]) / 2;
  };

  const cachedChanceOutcomes = Object.freeze(
    deals.map((deal, index) => Object.freeze({ action: `deal:${index}`, probability: deal.probability })),
  );
  const game: TabularZeroSumGame<HeadsUpRiverState, HeadsUpRiverAction> = {
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
        return {
          phase: "play",
          dealIndex,
          actor: 0,
          history: [],
          contributions: [0, 0],
          checks: 0,
          raises: 0,
          lastFullRaiseBb: 0,
        };
      }
      return playNextState(spec, state, action);
    },
    informationSet(state, player) {
      if (state.phase !== "play" || state.terminal || state.actor !== player) {
        throw new Error("只有当前行动玩家的非终局节点才有信息集");
      }
      return infoKey(player, deals[state.dealIndex].holdingIndices[player], state.history);
    },
    chanceOutcomes(state) {
      if (state.phase !== "chance") return [];
      return cachedChanceOutcomes;
    },
    terminalUtility(state) {
      if (state.phase !== "play") throw new Error("机会节点没有终局效用");
      return terminalUtilityForDeal(state, state.dealIndex);
    },
  };

  const exploitability = (
    profile: CFRStrategyProfile<HeadsUpRiverAction>,
  ): HeadsUpRiverExploitability => {
    const bestResponse = (responder: CFRPlayer): number => {
      const holdingCount = responder === 0 ? spec.oopRange.length : spec.ipRange.length;
      const recurse = (
        state: Extract<HeadsUpRiverState, { phase: "play" }>,
        opponentReach: Float64Array,
      ): Float64Array => {
        if (state.terminal) {
          return Float64Array.from(deals, (_, dealIndex) => terminalUtilityForDeal(state, dealIndex));
        }
        const actions = publicActions(spec, state);
        if (state.actor === responder) {
          const childValues = actions.map((action) =>
            recurse(playNextState(spec, state, action) as Extract<HeadsUpRiverState, { phase: "play" }>, opponentReach),
          );
          const selected = new Int32Array(holdingCount);
          for (let holdingIndex = 0; holdingIndex < holdingCount; holdingIndex += 1) {
            let bestAction = 0;
            let bestValue = responder === 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
            for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
              let value = 0;
              for (let dealIndex = 0; dealIndex < deals.length; dealIndex += 1) {
                if (deals[dealIndex].holdingIndices[responder] !== holdingIndex) continue;
                value += deals[dealIndex].probability
                  * opponentReach[dealIndex]
                  * childValues[actionIndex][dealIndex];
              }
              if ((responder === 0 && value > bestValue) || (responder === 1 && value < bestValue)) {
                bestValue = value;
                bestAction = actionIndex;
              }
            }
            selected[holdingIndex] = bestAction;
          }
          return Float64Array.from(deals, (deal, dealIndex) =>
            childValues[selected[deal.holdingIndices[responder]]][dealIndex],
          );
        }

        const values = new Float64Array(deals.length);
        for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
          const probabilities = new Float64Array(deals.length);
          const childReach = new Float64Array(deals.length);
          for (let dealIndex = 0; dealIndex < deals.length; dealIndex += 1) {
            const holdingIndex = deals[dealIndex].holdingIndices[state.actor];
            const informationSet = infoKey(state.actor, holdingIndex, state.history);
            const probability = strategyProbability(
              profile,
              state.actor,
              informationSet,
              actions,
              actionIndex,
            );
            probabilities[dealIndex] = probability;
            childReach[dealIndex] = opponentReach[dealIndex] * probability;
          }
          const child = recurse(
            playNextState(spec, state, actions[actionIndex]) as Extract<HeadsUpRiverState, { phase: "play" }>,
            childReach,
          );
          for (let dealIndex = 0; dealIndex < deals.length; dealIndex += 1) {
            values[dealIndex] += probabilities[dealIndex] * child[dealIndex];
          }
        }
        return values;
      };

      const root: Extract<HeadsUpRiverState, { phase: "play" }> = {
        phase: "play",
        dealIndex: 0,
        actor: 0,
        history: [],
        contributions: [0, 0],
        checks: 0,
        raises: 0,
        lastFullRaiseBb: 0,
      };
      const values = recurse(root, new Float64Array(deals.length).fill(1));
      return deals.reduce((sum, deal, index) => sum + deal.probability * values[index], 0);
    };

    const profileValueBb = expectedValue(game, profile, { missingInformationSets: "error" });
    const oopBestResponseValueBb = bestResponse(0);
    const ipBestResponseValueForOopBb = bestResponse(1);
    const rawOopGainBb = oopBestResponseValueBb - profileValueBb;
    const rawIpGainBb = profileValueBb - ipBestResponseValueForOopBb;
    const auditTolerance = Math.max(1, spec.potBb) * 1e-9;
    if (rawOopGainBb < -auditTolerance || rawIpGainBb < -auditTolerance) {
      throw new Error(
        `best-response 审计违反单边改进关系：OOP ${rawOopGainBb} BB / IP ${rawIpGainBb} BB`,
      );
    }
    const oopDeviationGainBb = Math.max(0, rawOopGainBb);
    const ipDeviationGainBb = Math.max(0, rawIpGainBb);
    const nashConvBb = oopDeviationGainBb + ipDeviationGainBb;
    return Object.freeze({
      profileValueBb,
      oopBestResponseValueBb,
      ipBestResponseValueForOopBb,
      oopDeviationGainBb,
      ipDeviationGainBb,
      nashConvBb,
      exploitabilityBb: nashConvBb / 2,
      exploitabilityPotFraction: nashConvBb / 2 / spec.potBb,
    });
  };

  const actionValues = (
    profile: CFRStrategyProfile<HeadsUpRiverAction>,
  ): readonly HeadsUpRiverActionEv[] => {
    const continuationCache = new Map<string, Float64Array>();
    const continuationValues = (
      state: Extract<HeadsUpRiverState, { phase: "play" }>,
    ): Float64Array => {
      const key = historyKey(state.history);
      const cached = continuationCache.get(key);
      if (cached) return cached;
      if (state.terminal) {
        const terminal = Float64Array.from(
          deals,
          (_, dealIndex) => terminalUtilityForDeal(state, dealIndex),
        );
        continuationCache.set(key, terminal);
        return terminal;
      }

      const actions = publicActions(spec, state);
      const values = new Float64Array(deals.length);
      for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
        const child = continuationValues(
          playNextState(spec, state, actions[actionIndex]) as Extract<HeadsUpRiverState, { phase: "play" }>,
        );
        for (let dealIndex = 0; dealIndex < deals.length; dealIndex += 1) {
          const holdingIndex = deals[dealIndex].holdingIndices[state.actor];
          const informationSet = infoKey(state.actor, holdingIndex, state.history);
          const probability = strategyProbability(
            profile,
            state.actor,
            informationSet,
            actions,
            actionIndex,
          );
          values[dealIndex] += probability * child[dealIndex];
        }
      }
      continuationCache.set(key, values);
      return values;
    };

    const result = new Map<string, HeadsUpRiverActionEv>();
    const traverse = (
      state: Extract<HeadsUpRiverState, { phase: "play" }>,
      reaches: readonly [Float64Array, Float64Array],
    ): void => {
      if (state.terminal) return;
      const actor = state.actor;
      const opponent = actor === 0 ? 1 : 0;
      const actions = publicActions(spec, state);
      const childValues = actions.map((action) => continuationValues(
        playNextState(spec, state, action) as Extract<HeadsUpRiverState, { phase: "play" }>,
      ));
      const holdingCount = actor === 0 ? spec.oopRange.length : spec.ipRange.length;
      const utilitySign = actor === 0 ? 1 : -1;

      for (let holdingIndex = 0; holdingIndex < holdingCount; holdingIndex += 1) {
        const informationSet = infoKey(actor, holdingIndex, state.history);
        if (!profile[actor].has(informationSet)) continue;
        let counterfactualReach = 0;
        const sums = new Float64Array(actions.length);
        for (let dealIndex = 0; dealIndex < deals.length; dealIndex += 1) {
          if (deals[dealIndex].holdingIndices[actor] !== holdingIndex) continue;
          const weight = deals[dealIndex].probability * reaches[opponent][dealIndex];
          counterfactualReach += weight;
          for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
            sums[actionIndex] += weight * utilitySign * childValues[actionIndex][dealIndex];
          }
        }
        const [, , holding, history] = informationSet.split("|");
        result.set(informationSet, Object.freeze({
          player: actor === 0 ? "oop" : "ip",
          holding,
          history,
          actions: Object.freeze([...actions]),
          actionEvBb: Object.freeze(Array.from(
            sums,
            (value) => counterfactualReach > 0 ? value / counterfactualReach : 0,
          )),
          counterfactualReach,
        }));
      }

      for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
        const actorReach = Float64Array.from(reaches[actor]);
        for (let dealIndex = 0; dealIndex < deals.length; dealIndex += 1) {
          const holdingIndex = deals[dealIndex].holdingIndices[actor];
          const informationSet = infoKey(actor, holdingIndex, state.history);
          actorReach[dealIndex] *= strategyProbability(
            profile,
            actor,
            informationSet,
            actions,
            actionIndex,
          );
        }
        const childReaches: [Float64Array, Float64Array] = actor === 0
          ? [actorReach, reaches[1]]
          : [reaches[0], actorReach];
        traverse(
          playNextState(spec, state, actions[actionIndex]) as Extract<HeadsUpRiverState, { phase: "play" }>,
          childReaches,
        );
      }
    };

    const root: Extract<HeadsUpRiverState, { phase: "play" }> = {
      phase: "play",
      dealIndex: 0,
      actor: 0,
      history: [],
      contributions: [0, 0],
      checks: 0,
      raises: 0,
      lastFullRaiseBb: 0,
    };
    traverse(root, [
      new Float64Array(deals.length).fill(1),
      new Float64Array(deals.length).fill(1),
    ]);
    return Object.freeze([...result.values()].sort((left, right) =>
      left.player.localeCompare(right.player)
        || left.history.localeCompare(right.history)
        || left.holding.localeCompare(right.holding),
    ));
  };

  const standardTree = isDefaultTree(spec.bettingTree);
  const gameSpecId = `rc-hu-river-game-v1-${stableGtoHash({
    variant: "no-limit-holdem",
    players: 2,
    street: "river",
    utility: "chip-ev",
    rake: { percent: 0, capBb: 0 },
  })}`;
  const treeId = `rc-hu-river-tree-v1-${stableGtoHash(spec.bettingTree)}`;
  const canonicalRange = (range: readonly WeightedRiverHolding[]) => range
    .map((holding) => ({ holding: holdingKey(holding), weight: holding.weight }))
    .sort((left, right) => left.holding.localeCompare(right.holding));
  const spotId = `rc-hu-river-spot-v1-${stableGtoHash({
    gameSpecId,
    treeId,
    board: spec.board.map(cardKey).sort(),
    oopRange: canonicalRange(spec.oopRange),
    ipRange: canonicalRange(spec.ipRange),
    potBb: spec.potBb,
    effectiveStackBb: spec.effectiveStackBb,
  })}`;
  const standardTemplate = standardTree
    ? Object.freeze({
        gameSpecId: RANGECRAFT_STANDARD_V1.gameSpecId,
        treeId: RANGECRAFT_STANDARD_V1.treeId,
      })
    : undefined;
  return Object.freeze({
    game,
    spec,
    compatibleDeals: deals.length,
    spotId,
    gameSpecId,
    treeId,
    ...(standardTemplate ? { standardTemplate } : {}),
    holdingKey(player, holdingIndex) {
      const key = holdingKeys[player][holdingIndex];
      if (!key) throw new RangeError(`玩家 ${player} 没有第 ${holdingIndex} 个组合`);
      return key;
    },
    informationSet: infoKey,
    exploitability,
    actionValues,
  });
}

function exportedStrategies(
  profile: CFRStrategyProfile<HeadsUpRiverAction>,
): readonly HeadsUpRiverStrategy[] {
  const result: HeadsUpRiverStrategy[] = [];
  profile.forEach((playerStrategy, player) => {
    for (const [informationSet, entry] of playerStrategy) {
      const [, , holding, history] = informationSet.split("|");
      result.push(Object.freeze({
        player: player === 0 ? "oop" : "ip",
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

function immutableStrategyProfile(
  profile: CFRStrategyProfile<HeadsUpRiverAction>,
): CFRStrategyProfile<HeadsUpRiverAction> {
  const immutableMap = (source: ReadonlyMap<string, CFRStrategyEntry<HeadsUpRiverAction>>) => {
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
          return (
            callback: (
              value: CFRStrategyEntry<HeadsUpRiverAction>,
              key: string,
              map: ReadonlyMap<string, CFRStrategyEntry<HeadsUpRiverAction>>,
            ) => void,
            thisArg?: unknown,
          ) => target.forEach((value, key) => {
            callback.call(thisArg, value, key, readonlyMap);
          });
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as ReadonlyMap<string, CFRStrategyEntry<HeadsUpRiverAction>>;
    return readonlyMap;
  };
  return Object.freeze([
    immutableMap(profile[0]),
    immutableMap(profile[1]),
  ]) as CFRStrategyProfile<HeadsUpRiverAction>;
}

function completeUniformRiverProfile(
  model: HeadsUpRiverGame,
): CFRStrategyProfile<HeadsUpRiverAction> {
  const players: [
    Map<string, CFRStrategyEntry<HeadsUpRiverAction>>,
    Map<string, CFRStrategyEntry<HeadsUpRiverAction>>,
  ] = [new Map(), new Map()];
  const traverse = (state: HeadsUpRiverState): void => {
    const actor = model.game.currentActor(state);
    if (actor === "terminal") return;
    if (actor === "chance") {
      for (const outcome of model.game.chanceOutcomes(state)) {
        traverse(model.game.nextState(state, outcome.action));
      }
      return;
    }
    const actions = model.game.actions(state);
    const informationSet = model.game.informationSet(state, actor);
    if (!players[actor].has(informationSet)) {
      players[actor].set(informationSet, {
        actions: [...actions],
        probabilities: actions.map(() => 1 / actions.length),
      });
    }
    for (const action of actions) traverse(model.game.nextState(state, action));
  };
  traverse(model.game.initialState);
  return players;
}

function solverVersion(algorithm: HeadsUpRiverSolverAlgorithm): HeadsUpRiverSolution["solverVersion"] {
  if (algorithm === "dcfr") return "rangecraft-dcfr/0.2.0";
  if (algorithm === "pdcfr+") return "rangecraft-pdcfr+/0.1.0";
  return "rangecraft-cfr+/0.2.0";
}

function buildHeadsUpRiverSolution(
  model: HeadsUpRiverGame,
  algorithm: HeadsUpRiverSolverAlgorithm,
  solverParameters: HeadsUpRiverSolution["solverParameters"],
  iterations: number,
  profile: CFRStrategyProfile<HeadsUpRiverAction>,
  convergence: HeadsUpRiverConvergence,
): HeadsUpRiverSolution {
  const averageStrategy = immutableStrategyProfile(
    iterations === 0 ? completeUniformRiverProfile(model) : profile,
  );
  const exploitability = model.exploitability(averageStrategy);
  const actionValues = model.actionValues(averageStrategy);
  const strategies = exportedStrategies(averageStrategy);
  const version = solverVersion(algorithm);
  const frozenSolverParameters = Object.freeze({
    ...solverParameters,
    ...(solverParameters.dcfr
      ? { dcfr: Object.freeze({ ...solverParameters.dcfr }) }
      : {}),
    ...(solverParameters.pdcfrPlus
      ? { pdcfrPlus: Object.freeze({ ...solverParameters.pdcfrPlus }) }
      : {}),
  });
  const resultId = `rc-hu-river-result-v1-${stableGtoHash({
    spotId: model.spotId,
    gameSpecId: model.gameSpecId,
    treeId: model.treeId,
    solverVersion: version,
    algorithm,
    solverParameters: frozenSolverParameters,
    iterations,
    strategies,
  }).slice(0, 24)}`;
  return Object.freeze({
    solverVersion: version,
    resultId,
    algorithm,
    solverParameters: frozenSolverParameters,
    spotId: model.spotId,
    gameSpecId: model.gameSpecId,
    treeId: model.treeId,
    ...(model.standardTemplate ? { standardTemplate: model.standardTemplate } : {}),
    source: "internal-solver",
    iterations,
    compatibleDeals: model.compatibleDeals,
    accuracyScope: "within-fixed-tree",
    externalBenchmarkStatus: "not-run",
    accuracyLevel: headsUpAccuracyLevel(exploitability.exploitabilityPotFraction),
    convergence,
    exploitability,
    strategies,
    actionValues,
    averageStrategy,
  });
}

/** Solves a weighted exact-card heads-up river subgame and audits its exploitability. */
export function solveHeadsUpRiver(
  spec: HeadsUpRiverSpec,
  options: SolveHeadsUpRiverOptions,
): HeadsUpRiverSolution {
  const model = createHeadsUpRiverGame(spec);
  const algorithm = options.algorithm ?? "cfr+";
  if (algorithm === "dcfr") {
    const solver = new DiscountedCFRSolver(model.game, options);
    const solved = solver.run({ iterations: options.iterations });
    const profile = solved.iterations === 0
      ? completeUniformRiverProfile(model)
      : solved.averageStrategy;
    const exploitability = model.exploitability(profile);
    const convergence = Object.freeze({
      mode: "fixed" as const,
      consecutiveTargetCheckpoints: 0,
      trainedIterations: solved.iterations,
      selectedIterations: solved.iterations,
      stopReason: "fixed-iterations" as const,
      checkpoints: Object.freeze([Object.freeze({
        iterations: solved.iterations,
        exploitabilityBb: exploitability.exploitabilityBb,
        exploitabilityPotFraction: exploitability.exploitabilityPotFraction,
        targetMet: false,
      })]),
    });
    return buildHeadsUpRiverSolution(
      model,
      algorithm,
      Object.freeze({
        updateSchedule: "alternating-player-0-first" as const,
        regretUpdateOrder: "add-then-sign-discount" as const,
        averagingSchedule: "paper-polynomial" as const,
        numericPrecision: "float64" as const,
        dcfr: solver.parameters,
      }),
      solved.iterations,
      profile,
      convergence,
    );
  }

  if (algorithm === "pdcfr+") {
    const solver = new PredictiveDiscountedCFRPlusSolver(model.game, options);
    const solved = solver.run({ iterations: options.iterations });
    const profile = solved.iterations === 0
      ? completeUniformRiverProfile(model)
      : solved.averageStrategy;
    const exploitability = model.exploitability(profile);
    const convergence = Object.freeze({
      mode: "fixed" as const,
      consecutiveTargetCheckpoints: 0,
      trainedIterations: solved.iterations,
      selectedIterations: solved.iterations,
      stopReason: "fixed-iterations" as const,
      checkpoints: Object.freeze([Object.freeze({
        iterations: solved.iterations,
        exploitabilityBb: exploitability.exploitabilityBb,
        exploitabilityPotFraction: exploitability.exploitabilityPotFraction,
        targetMet: false,
      })]),
    });
    return buildHeadsUpRiverSolution(
      model,
      algorithm,
      Object.freeze({
        updateSchedule: "alternating-player-0-first" as const,
        regretUpdateOrder: "discount-add-clip-then-predict" as const,
        averagingSchedule: "alternating-paper-polynomial" as const,
        numericPrecision: "float64" as const,
        pdcfrPlus: solver.parameters,
      }),
      solved.iterations,
      profile,
      convergence,
    );
  }

  const solved = solveCFRPlus(model.game, options);
  const profile = solved.iterations === 0
    ? completeUniformRiverProfile(model)
    : solved.averageStrategy;
  const exploitability = model.exploitability(profile);
  const averagingDelay = options.averagingDelay ?? 0;
  const linearAveraging = options.linearAveraging ?? true;
  const convergence = Object.freeze({
    mode: "fixed" as const,
    consecutiveTargetCheckpoints: 0,
    trainedIterations: solved.iterations,
    selectedIterations: solved.iterations,
    stopReason: "fixed-iterations" as const,
    checkpoints: Object.freeze([Object.freeze({
      iterations: solved.iterations,
      exploitabilityBb: exploitability.exploitabilityBb,
      exploitabilityPotFraction: exploitability.exploitabilityPotFraction,
      targetMet: false,
    })]),
  });
  return buildHeadsUpRiverSolution(
    model,
    algorithm,
    Object.freeze({
      updateSchedule: "alternating-player-0-first" as const,
      regretUpdateOrder: "add-then-rm+-clip" as const,
      averagingSchedule: "alternating-staggered-linear" as const,
      numericPrecision: "float64" as const,
      averagingDelay,
      linearAveraging,
    }),
    solved.iterations,
    profile,
    convergence,
  );
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} 必须是正安全整数`);
  }
  return value;
}

/**
 * Runs an auditable checkpointed solve and returns the lowest-exploitability
 * checkpoint observed. Consecutive target passes are an engineering stability
 * gate; exact best-response exploitability remains the mathematical quality
 * certificate for each individual checkpoint.
 */
export function solveHeadsUpRiverAdaptive(
  spec: HeadsUpRiverSpec,
  options: SolveHeadsUpRiverAdaptiveOptions,
): HeadsUpRiverSolution {
  const model = createHeadsUpRiverGame(spec);
  const algorithm = options.algorithm ?? "dcfr";
  const maxIterations = positiveSafeInteger(options.maxIterations, "maxIterations");
  const checkpointInterval = Math.min(
    maxIterations,
    positiveSafeInteger(options.checkpointInterval ?? 100, "checkpointInterval"),
  );
  const minimumIterations = Math.min(
    maxIterations,
    positiveSafeInteger(
      options.minimumIterations ?? Math.min(maxIterations, checkpointInterval * 2),
      "minimumIterations",
    ),
  );
  const requiredConsecutive = positiveSafeInteger(
    options.requiredConsecutiveTargetCheckpoints ?? 3,
    "requiredConsecutiveTargetCheckpoints",
  );
  const target = options.targetExploitabilityPotFraction ?? 0.0024;
  if (!Number.isFinite(target) || target < 0) {
    throw new RangeError("targetExploitabilityPotFraction 必须是非负有限数");
  }

  const averagingDelay = Math.min(
    Math.max(0, Math.round(options.averagingDelay ?? 0)),
    Math.max(0, maxIterations - 1),
  );
  const linearAveraging = options.linearAveraging ?? true;
  const dcfrParameters = Object.freeze({
    alpha: options.alpha ?? DEFAULT_DCFR_PARAMETERS.alpha,
    beta: options.beta ?? DEFAULT_DCFR_PARAMETERS.beta,
    gamma: options.gamma ?? DEFAULT_DCFR_PARAMETERS.gamma,
  });
  const pdcfrPlusParameters = Object.freeze({
    alpha: options.alpha ?? DEFAULT_PDCFR_PLUS_PARAMETERS.alpha,
    gamma: options.gamma ?? DEFAULT_PDCFR_PLUS_PARAMETERS.gamma,
  });
  const cfrPlusSolver = algorithm === "cfr+" ? new CFRPlusSolver(model.game) : null;
  const dcfrSolver = algorithm === "dcfr"
    ? new DiscountedCFRSolver(model.game, dcfrParameters)
    : null;
  const pdcfrPlusSolver = algorithm === "pdcfr+"
    ? new PredictiveDiscountedCFRPlusSolver(model.game, pdcfrPlusParameters)
    : null;
  const checkpoints: HeadsUpRiverConvergenceCheckpoint[] = [];
  let trainedIterations = 0;
  let consecutiveTargetCheckpoints = 0;
  let bestIterations = 0;
  let bestExploitability = Number.POSITIVE_INFINITY;
  let bestProfile: CFRStrategyProfile<HeadsUpRiverAction> | null = null;
  let stopReason: HeadsUpRiverConvergence["stopReason"] = "iteration-limit";

  while (trainedIterations < maxIterations) {
    const additionalIterations = Math.min(
      checkpointInterval,
      maxIterations - trainedIterations,
    );
    const solved = cfrPlusSolver
      ? cfrPlusSolver.run({
        iterations: additionalIterations,
        averagingDelay,
        linearAveraging,
      })
      : dcfrSolver
        ? dcfrSolver.run({ iterations: additionalIterations })
        : pdcfrPlusSolver!.run({ iterations: additionalIterations });
    trainedIterations = solved.iterations;
    const audit = model.exploitability(solved.averageStrategy);
    const profileIsAveraged = algorithm !== "cfr+"
      || trainedIterations > averagingDelay;
    const targetMet = trainedIterations >= minimumIterations
      && profileIsAveraged
      && audit.exploitabilityPotFraction <= target;
    consecutiveTargetCheckpoints = targetMet
      ? consecutiveTargetCheckpoints + 1
      : 0;
    checkpoints.push(Object.freeze({
      iterations: trainedIterations,
      exploitabilityBb: audit.exploitabilityBb,
      exploitabilityPotFraction: audit.exploitabilityPotFraction,
      targetMet,
    }));
    if (profileIsAveraged && audit.exploitabilityPotFraction <= bestExploitability) {
      bestExploitability = audit.exploitabilityPotFraction;
      bestIterations = trainedIterations;
      bestProfile = solved.averageStrategy;
    }
    if (consecutiveTargetCheckpoints >= requiredConsecutive) {
      stopReason = "target-stable";
      break;
    }
  }

  if (!bestProfile) throw new Error("自适应河牌求解没有生成任何检查点");
  const convergence = Object.freeze({
    mode: "adaptive" as const,
    targetExploitabilityPotFraction: target,
    requiredConsecutiveTargetCheckpoints: requiredConsecutive,
    consecutiveTargetCheckpoints,
    trainedIterations,
    selectedIterations: bestIterations,
    stopReason,
    checkpoints: Object.freeze([...checkpoints]),
  });
  return buildHeadsUpRiverSolution(
    model,
    algorithm,
    algorithm === "dcfr"
      ? Object.freeze({
        updateSchedule: "alternating-player-0-first" as const,
        regretUpdateOrder: "add-then-sign-discount" as const,
        averagingSchedule: "paper-polynomial" as const,
        numericPrecision: "float64" as const,
        dcfr: dcfrSolver!.parameters,
      })
      : algorithm === "pdcfr+"
        ? Object.freeze({
          updateSchedule: "alternating-player-0-first" as const,
          regretUpdateOrder: "discount-add-clip-then-predict" as const,
          averagingSchedule: "alternating-paper-polynomial" as const,
          numericPrecision: "float64" as const,
          pdcfrPlus: pdcfrPlusSolver!.parameters,
        })
      : Object.freeze({
        updateSchedule: "alternating-player-0-first" as const,
        regretUpdateOrder: "add-then-rm+-clip" as const,
        averagingSchedule: "alternating-staggered-linear" as const,
        numericPrecision: "float64" as const,
        averagingDelay,
        linearAveraging,
      }),
    bestIterations,
    bestProfile,
    convergence,
  );
}

/**
 * Exposes the exponential exact policy enumerator only for tiny regression
 * games. Real range solves should use the public-tree best-response audit above.
 */
export function exactTinyRiverExploitability(
  model: HeadsUpRiverGame,
  profile: CFRStrategyProfile<HeadsUpRiverAction>,
) {
  return exactSmallGameExploitability(model.game, profile);
}

export function headsUpRiverStrategyEntry(
  solution: HeadsUpRiverSolution,
  player: HeadsUpRiverPlayer,
  holding: string,
  history = "root",
): CFRStrategyEntry<HeadsUpRiverAction> | undefined {
  const informationSet = `river|P${player === "oop" ? 0 : 1}|${holding}|${history}`;
  return solution.averageStrategy[player === "oop" ? 0 : 1].get(informationSet);
}

/** Query one solved information set's acting-player counterfactual action EVs. */
export function headsUpRiverActionEvEntry(
  solution: HeadsUpRiverSolution,
  player: HeadsUpRiverPlayer,
  holding: string,
  history = "root",
): HeadsUpRiverActionEv | undefined {
  return solution.actionValues.find((entry) =>
    entry.player === player && entry.holding === holding && entry.history === history,
  );
}
