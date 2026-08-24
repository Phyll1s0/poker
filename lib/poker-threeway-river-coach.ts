import {
  createThreeWayRiverSolverSession,
  solveThreeWayRiver,
  threeWayRiverActionEvEntry,
  threeWayRiverStrategyEntry,
  type ThreeWayRiverAction,
  type ThreeWayRiverCheckpoint,
  type ThreeWayRiverPlayer,
  type ThreeWayRiverSolution,
  type ThreeWayRiverSpec,
} from "./gto-threeway-river.ts";
import { type OpponentRangeWeight, type PokerCard, type PokerSuit } from "./poker-evaluator.ts";
import {
  materializeRiverRangeWeight,
  rangeWeightFromMaterialized,
  representativeRiverRange,
  riverCoachHoldingKey,
  type MaterializedRiverRangeWeight,
} from "./poker-river-coach.ts";
import type { WeightedRiverHolding } from "./gto-river.ts";
import type { StrategyAction, StrategyCard } from "./poker-strategy.ts";

export type ThreeWayRiverCoachPublicAction = Readonly<{
  player: ThreeWayRiverPlayer;
  kind: StrategyAction;
  /** Chips added by this action, expressed in big blinds. */
  amountPaidBb: number;
}>;

export type ThreeWayRiverCoachRequest = Readonly<{
  board: readonly [PokerCard, PokerCard, PokerCard, PokerCard, PokerCard];
  suits: readonly [PokerSuit, PokerSuit, PokerSuit, PokerSuit];
  heroCards: readonly [PokerCard, PokerCard];
  heroPlayer: ThreeWayRiverPlayer;
  rangeWeights: Readonly<Record<ThreeWayRiverPlayer, OpponentRangeWeight>>;
  /** Pot carried into the river. River wagers in publicActions are not included. */
  potAtStreetStartBb: number;
  /** River-start chips available to OOP, middle and IP respectively. */
  stackAtStreetStartBb: readonly [number, number, number];
  publicActions: readonly ThreeWayRiverCoachPublicAction[];
  representativeCombos?: number;
  /** Minimum iterations before an adaptive solve may be accepted. */
  iterations?: number;
  /** Upper bound for adaptive browser solving. Defaults to 360. */
  maxIterations?: number;
  /** Work per cooperative chunk before yielding to the UI. */
  iterationChunk?: number;
  targetNashConvPotFraction?: number;
  /** Maximum cross-resolution action-regret drift, as a fraction of the pot. */
  targetActionRegretDriftPotFraction?: number;
  /** Stricter stability gate required before experimental solver EV may grade an action. */
  scoringTargetPotFraction?: number;
}>;

export type MaterializedThreeWayRiverCoachRequest = Readonly<{
  board: readonly [PokerCard, PokerCard, PokerCard, PokerCard, PokerCard];
  suits: readonly [PokerSuit, PokerSuit, PokerSuit, PokerSuit];
  heroCards: readonly [PokerCard, PokerCard];
  heroPlayer: ThreeWayRiverPlayer;
  rangeWeights: Readonly<Record<ThreeWayRiverPlayer, readonly MaterializedRiverRangeWeight[]>>;
  potAtStreetStartBb: number;
  stackAtStreetStartBb: readonly [number, number, number];
  publicActions: readonly ThreeWayRiverCoachPublicAction[];
  representativeCombos?: number;
  iterations?: number;
  maxIterations?: number;
  iterationChunk?: number;
  targetNashConvPotFraction?: number;
  targetActionRegretDriftPotFraction?: number;
  scoringTargetPotFraction?: number;
}>;

export type ThreeWayRiverCoachCheckpoint = Readonly<{
  resolution: "quick" | "verification";
  representativeCombos: number;
  iterations: number;
  nashConvPotFraction: number;
}>;

export type ThreeWayRiverCoachProgress = Readonly<{
  resolution: "quick" | "verification";
  representativeCombos: number;
  iterations: number;
  maxIterations: number;
  nashConvPotFraction: number;
  targetNashConvPotFraction: number;
}>;

export type ThreeWayRiverCoachAsyncOptions = Readonly<{
  signal?: AbortSignal;
  onProgress?: (progress: ThreeWayRiverCoachProgress) => void;
  /** Test hook; production defaults to yielding one macrotask between chunks. */
  yieldControl?: () => Promise<void>;
}>;

export type ThreeWayRiverCoachAction = Readonly<{
  solverAction: ThreeWayRiverAction;
  action: StrategyAction;
  raiseToBb?: number;
  frequency: number;
  evBb: number;
}>;

export type ThreeWayRiverCoachResult = Readonly<{
  status: "solved";
  source: "internal-cfr+-reduced-three-way-river";
  scope: "three-way-river-single-bet-representative-ranges";
  approximation: "experimental-multiplayer-cfr+";
  spotId: string;
  heroPlayer: ThreeWayRiverPlayer;
  heroHolding: string;
  history: string;
  actions: readonly ThreeWayRiverCoachAction[];
  iterations: number;
  representativeCombos: Readonly<{ oop: number; middle: number; ip: number }>;
  compatibleDeals: number;
  profileValueBb: readonly [number, number, number];
  playerDeviationGainsBb: readonly [number, number, number];
  nashConvBb: number;
  nashConvNormalizationPotBb: number;
  nashConvPotFraction: number;
  targetNashConvPotFraction: number;
  quickSpotId: string | null;
  quickIterations: number | null;
  quickRepresentativeCombos: Readonly<{ oop: number; middle: number; ip: number }> | null;
  quickCompatibleDeals: number | null;
  quickNashConvPotFraction: number | null;
  actionRegretDriftPotFraction: number | null;
  frequencyTotalVariation: number | null;
  targetActionRegretDriftPotFraction: number;
  scoringTargetPotFraction: number;
  acceptedForGuidance: boolean;
  acceptedForScoring: boolean;
  checkpoints: readonly ThreeWayRiverCoachCheckpoint[];
  solveMode: "fixed" | "adaptive";
  stopReason: "fixed-iterations" | "target-met" | "iteration-limit" | "abstraction-unstable";
  targetMet: boolean;
}>;

const PLAYERS = ["oop", "middle", "ip"] as const;
const EPSILON = 1e-7;

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} 必须是非负有限数`);
  return value;
}

function normalizedAmount(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function actionTarget(action: ThreeWayRiverAction): number | undefined {
  if (!action.startsWith("bet-to:")) return undefined;
  const target = Number(action.slice("bet-to:".length));
  return Number.isFinite(target) ? target : undefined;
}

function toStrategyCard(card: PokerCard): StrategyCard {
  const suits: Readonly<Record<string, StrategyCard["suit"]>> = {
    "♠": "spades",
    "♥": "hearts",
    "♦": "diamonds",
    "♣": "clubs",
    spades: "spades",
    hearts: "hearts",
    diamonds: "diamonds",
    clubs: "clubs",
  };
  const suit = suits[String(card.suit)];
  if (!suit) throw new RangeError(`不支持的花色 ${String(card.suit)}`);
  if (!Number.isInteger(card.rank) || card.rank < 2 || card.rank > 14) {
    throw new RangeError(`不支持的点数 ${card.rank}`);
  }
  return Object.freeze({ rank: card.rank, suit });
}

function publicHistoryAndTree(request: ThreeWayRiverCoachRequest) {
  const contributions: [number, number, number] = [0, 0, 0];
  const live: [boolean, boolean, boolean] = [true, true, true];
  let actor: 0 | 1 | 2 = 0;
  let bettor: 0 | 1 | 2 | null = null;
  let pending: Array<0 | 1 | 2> = [];
  const history: string[] = [];
  const observedBetFractions: number[] = [];

  for (const [index, action] of request.publicActions.entries()) {
    const expected = PLAYERS[actor];
    if (action.player !== expected) throw new Error(`三人河牌行动 ${index + 1} 的行动顺序不合法`);
    const paid = finiteNonNegative(action.amountPaidBb, `publicActions[${index}].amountPaidBb`);
    if (action.kind === "check") {
      if (bettor !== null || paid > EPSILON) throw new Error("面对下注时不能过牌");
      history.push("check");
      if (actor === 2) throw new Error("三人都过牌后河牌已经结束");
      actor = (actor + 1) as 1 | 2;
      continue;
    }
    if (action.kind === "raise") {
      if (bettor !== null) throw new Error("当前三人固定树不支持再加注");
      const target = normalizedAmount(contributions[actor] + paid);
      if (target <= EPSILON || target > request.stackAtStreetStartBb[actor] + EPSILON) {
        throw new Error("三人河牌下注金额超出可用筹码");
      }
      contributions[actor] = target;
      history.push(`bet-to:${target}`);
      observedBetFractions.push(target / request.potAtStreetStartBb);
      bettor = actor;
      pending = [((actor + 1) % 3) as 0 | 1 | 2, ((actor + 2) % 3) as 0 | 1 | 2];
      actor = pending[0];
      continue;
    }
    if (bettor === null || pending[0] !== actor) throw new Error("没有面对下注时不能跟注或弃牌");
    if (action.kind === "fold") {
      if (paid > EPSILON) throw new Error("弃牌动作不能新增投入");
      live[actor] = false;
      history.push("fold");
    } else {
      const target = Math.min(contributions[bettor], request.stackAtStreetStartBb[actor]);
      const expectedPaid = normalizedAmount(target - contributions[actor]);
      if (Math.abs(expectedPaid - paid) > 0.051) throw new Error("跟注金额与公开下注线不一致");
      contributions[actor] = target;
      history.push("call");
    }
    pending.shift();
    if (live.filter(Boolean).length <= 1 || pending.length === 0) {
      throw new Error("该公开行动后河牌已经结束");
    }
    actor = pending[0];
  }

  if (PLAYERS[actor] !== request.heroPlayer) throw new Error("当前行动人与三人河牌公开行动线不一致");
  const betPotFractions = [...new Set([0.5, 1, ...observedBetFractions]
    .filter((fraction) => Number.isFinite(fraction) && fraction > EPSILON)
    .map(normalizedAmount))]
    .sort((left, right) => left - right);
  return Object.freeze({
    history: history.length ? history.join(">") : "root",
    historyActions: Object.freeze([...history]),
    bettingTree: Object.freeze({
      betPotFractions: Object.freeze(betPotFractions),
      allInAlwaysAvailable: true,
    }),
  });
}

function publicAction(action: ThreeWayRiverAction): Pick<ThreeWayRiverCoachAction, "action" | "raiseToBb"> {
  if (action === "fold" || action === "check" || action === "call") return { action };
  return { action: "raise", raiseToBb: actionTarget(action) };
}

/**
 * Three independently sampled but identical ranges would otherwise select the
 * same strength-stratum representatives and discard most chance tuples through
 * card collision. A larger common quadrature pool is split into one local
 * group around each desired strength quantile. Seat offsets rotate by group,
 * so every seat receives one lower/middle/upper neighbour equally often rather
 * than systematically making IP stronger than OOP.
 */
function diversifiedRepresentativeRange(
  request: ThreeWayRiverCoachRequest,
  player: ThreeWayRiverPlayer,
  count: number,
): readonly WeightedRiverHolding[] {
  const seat = PLAYERS.indexOf(player);
  const pinned = request.heroPlayer === player ? request.heroCards : undefined;
  const poolCount = Math.min(24, Math.max(count, count * PLAYERS.length));
  const pool = representativeRiverRange(
    request.board,
    request.suits,
    request.rangeWeights[player],
    poolCount,
    pinned,
  );
  const selected = Array.from({ length: count }, (_, bucket) => {
    const rotatedSeat = (seat + bucket) % PLAYERS.length;
    return pool[bucket * PLAYERS.length + rotatedSeat];
  }).filter((holding): holding is WeightedRiverHolding => Boolean(holding));
  if (pinned) {
    const pinnedKey = riverCoachHoldingKey(pinned);
    const pinnedHolding = pool.find((holding) => riverCoachHoldingKey(holding.cards) === pinnedKey);
    if (!pinnedHolding) throw new Error("三人代表范围没有保留英雄当前手牌");
    if (!selected.some((holding) => riverCoachHoldingKey(holding.cards) === pinnedKey)) {
      selected[Math.max(0, selected.length - 1)] = pinnedHolding;
    }
  }
  for (const holding of pool) {
    if (selected.length >= count) break;
    const key = riverCoachHoldingKey(holding.cards);
    if (!selected.some((candidate) => riverCoachHoldingKey(candidate.cards) === key)) selected.push(holding);
  }
  if (selected.length < count) throw new Error("三人公开范围的代表组合不足");
  return Object.freeze(selected);
}

type PreparedThreeWayRiverCoachLevel = Readonly<{
  resolution: "quick" | "verification";
  representativeCombos: number;
  ranges: readonly [
    readonly WeightedRiverHolding[],
    readonly WeightedRiverHolding[],
    readonly WeightedRiverHolding[],
  ];
  spec: ThreeWayRiverSpec;
}>;

type PreparedThreeWayRiverCoachPlan = Readonly<{
  heroPlayer: ThreeWayRiverPlayer;
  heroHolding: string;
  history: string;
  quick: PreparedThreeWayRiverCoachLevel;
  verification: PreparedThreeWayRiverCoachLevel;
  minIterations: number;
  maxIterations: number;
  iterationChunk: number;
  targetNashConvPotFraction: number;
  targetActionRegretDriftPotFraction: number;
  scoringTargetPotFraction: number;
}>;

function boundedFraction(value: number | undefined, fallback: number, label: string): number {
  const candidate = value ?? fallback;
  if (!Number.isFinite(candidate) || candidate <= 0 || candidate > 1) {
    throw new RangeError(`${label} 必须位于 (0, 1]`);
  }
  return candidate;
}

function prepareThreeWayRiverCoachPlan(
  request: ThreeWayRiverCoachRequest,
  multiResolution = true,
): PreparedThreeWayRiverCoachPlan {
  if (request.board.length !== 5 || request.heroCards.length !== 2) {
    throw new RangeError("三人河牌求解必须包含 5 张公共牌和 2 张英雄手牌");
  }
  const potBb = finiteNonNegative(request.potAtStreetStartBb, "potAtStreetStartBb");
  if (potBb <= 0) throw new RangeError("河牌起始底池必须大于 0");
  const stackBb = request.stackAtStreetStartBb.map((value, index) => (
    finiteNonNegative(value, `stackAtStreetStartBb[${index}]`)
  )) as [number, number, number];
  if (stackBb.some((value) => value <= 0)) throw new RangeError("三位玩家河牌开始时都必须仍有可行动筹码");
  const publicNode = publicHistoryAndTree(request);
  const board = Object.freeze(request.board.map(toStrategyCard)) as readonly [
    StrategyCard,
    StrategyCard,
    StrategyCard,
    StrategyCard,
    StrategyCard,
  ];
  const quickCombos = request.representativeCombos ?? 3;
  if (!Number.isSafeInteger(quickCombos) || quickCombos < 2 || quickCombos > 12) {
    throw new RangeError("三人快速范围代表组合必须是 2..12 的整数");
  }
  const verificationCombos = Math.min(24, Math.max(quickCombos + 2, Math.ceil(quickCombos * 5 / 3)));
  const makeLevel = (
    resolution: PreparedThreeWayRiverCoachLevel["resolution"],
    representativeCombos: number,
  ): PreparedThreeWayRiverCoachLevel => {
    const ranges = PLAYERS.map((player) => diversifiedRepresentativeRange(
      request,
      player,
      representativeCombos,
    )) as [
      ReturnType<typeof representativeRiverRange>,
      ReturnType<typeof representativeRiverRange>,
      ReturnType<typeof representativeRiverRange>,
    ];
    return Object.freeze({
      resolution,
      representativeCombos,
      ranges: Object.freeze(ranges),
      spec: Object.freeze({
        board,
        ranges,
        potBb,
        stackBb: Object.freeze(stackBb),
        bettingTree: publicNode.bettingTree,
        startingHistory: publicNode.historyActions,
      }),
    });
  };
  const minIterations = Math.max(40, Math.min(5_000, Math.round(request.iterations ?? 120)));
  const maxIterations = Math.max(
    minIterations,
    Math.min(5_000, Math.round(request.maxIterations ?? 360)),
  );
  const iterationChunk = Math.max(
    20,
    Math.min(maxIterations, Math.round(request.iterationChunk ?? 40)),
  );
  const quick = makeLevel("quick", quickCombos);
  const verification = multiResolution
    ? makeLevel("verification", verificationCombos)
    : quick;
  return Object.freeze({
    heroPlayer: request.heroPlayer,
    heroHolding: riverCoachHoldingKey(request.heroCards),
    history: publicNode.history,
    quick,
    verification,
    minIterations,
    maxIterations,
    iterationChunk,
    targetNashConvPotFraction: boundedFraction(
      request.targetNashConvPotFraction,
      0.1,
      "targetNashConvPotFraction",
    ),
    targetActionRegretDriftPotFraction: boundedFraction(
      request.targetActionRegretDriftPotFraction,
      0.1,
      "targetActionRegretDriftPotFraction",
    ),
    scoringTargetPotFraction: boundedFraction(
      request.scoringTargetPotFraction,
      0.03,
      "scoringTargetPotFraction",
    ),
  });
}

function coachActions(
  solution: ThreeWayRiverSolution,
  plan: PreparedThreeWayRiverCoachPlan,
): readonly ThreeWayRiverCoachAction[] {
  const strategy = threeWayRiverStrategyEntry(solution, plan.heroPlayer, plan.heroHolding, plan.history);
  const actionValues = threeWayRiverActionEvEntry(solution, plan.heroPlayer, plan.heroHolding, plan.history);
  if (!strategy || !actionValues) throw new Error("三人求解结果缺少当前手牌信息集");
  const evByAction = new Map(actionValues.actions.map((action, index) => [action, actionValues.actionEvBb[index]]));
  return Object.freeze(strategy.actions.map((solverAction, index) => Object.freeze({
    solverAction,
    ...publicAction(solverAction),
    frequency: strategy.probabilities[index],
    evBb: evByAction.get(solverAction) ?? 0,
  })));
}

function crossResolutionDiagnostics(
  quick: readonly ThreeWayRiverCoachAction[],
  verification: readonly ThreeWayRiverCoachAction[],
  normalizationPotBb: number,
): Readonly<{ actionRegretDriftPotFraction: number; frequencyTotalVariation: number }> {
  const quickByAction = new Map(quick.map((action) => [action.solverAction, action]));
  const verificationByAction = new Map(verification.map((action) => [action.solverAction, action]));
  if (quickByAction.size !== verificationByAction.size
    || [...quickByAction.keys()].some((action) => !verificationByAction.has(action))) {
    throw new Error("两档三人范围分辨率的合法动作集合不一致");
  }
  const quickBest = Math.max(...quick.map((action) => action.evBb));
  const verificationBest = Math.max(...verification.map((action) => action.evBb));
  let maximumRegretDrift = 0;
  let frequencyDifference = 0;
  for (const [solverAction, quickAction] of quickByAction) {
    const verificationAction = verificationByAction.get(solverAction)!;
    const quickRegret = quickBest - quickAction.evBb;
    const verificationRegret = verificationBest - verificationAction.evBb;
    maximumRegretDrift = Math.max(maximumRegretDrift, Math.abs(quickRegret - verificationRegret));
    frequencyDifference += Math.abs(quickAction.frequency - verificationAction.frequency);
  }
  return Object.freeze({
    actionRegretDriftPotFraction: maximumRegretDrift / normalizationPotBb,
    frequencyTotalVariation: frequencyDifference / 2,
  });
}

function buildCoachResult(
  plan: PreparedThreeWayRiverCoachPlan,
  finalSolution: ThreeWayRiverSolution,
  quickSolution: ThreeWayRiverSolution | null,
  checkpoints: readonly ThreeWayRiverCoachCheckpoint[],
  solveMode: ThreeWayRiverCoachResult["solveMode"],
  stopReason: ThreeWayRiverCoachResult["stopReason"],
): ThreeWayRiverCoachResult {
  const actions = coachActions(finalSolution, plan);
  const quickActions = quickSolution ? coachActions(quickSolution, plan) : null;
  const crossResolution = quickActions
    ? crossResolutionDiagnostics(
        quickActions,
        actions,
        finalSolution.audit.normalizationPotBb,
      )
    : null;
  const quickNashConv = quickSolution?.audit.nashConvPotFraction ?? null;
  const actionRegretDrift = crossResolution?.actionRegretDriftPotFraction ?? null;
  const acceptedForGuidance = finalSolution.audit.nashConvPotFraction <= plan.targetNashConvPotFraction
    && (quickNashConv === null || quickNashConv <= plan.targetNashConvPotFraction)
    && (actionRegretDrift === null || actionRegretDrift <= plan.targetActionRegretDriftPotFraction);
  const uncertainty = Math.max(
    finalSolution.audit.nashConvPotFraction,
    quickNashConv ?? 0,
    actionRegretDrift ?? 0,
  );
  const acceptedForScoring = quickSolution !== null
    && acceptedForGuidance
    && uncertainty <= plan.scoringTargetPotFraction;
  const finalRanges = quickSolution ? plan.verification.ranges : plan.quick.ranges;
  return Object.freeze({
    status: "solved",
    source: "internal-cfr+-reduced-three-way-river",
    scope: "three-way-river-single-bet-representative-ranges",
    approximation: "experimental-multiplayer-cfr+",
    spotId: finalSolution.spotId,
    heroPlayer: plan.heroPlayer,
    heroHolding: plan.heroHolding,
    history: plan.history,
    actions,
    iterations: finalSolution.iterations,
    representativeCombos: Object.freeze({
      oop: finalRanges[0].length,
      middle: finalRanges[1].length,
      ip: finalRanges[2].length,
    }),
    compatibleDeals: finalSolution.compatibleDeals,
    profileValueBb: finalSolution.audit.profileValueBb,
    playerDeviationGainsBb: finalSolution.audit.perPlayerGainBb,
    nashConvBb: finalSolution.audit.nashConvBb,
    nashConvNormalizationPotBb: finalSolution.audit.normalizationPotBb,
    nashConvPotFraction: finalSolution.audit.nashConvPotFraction,
    targetNashConvPotFraction: plan.targetNashConvPotFraction,
    quickSpotId: quickSolution?.spotId ?? null,
    quickIterations: quickSolution?.iterations ?? null,
    quickRepresentativeCombos: quickSolution ? Object.freeze({
      oop: plan.quick.ranges[0].length,
      middle: plan.quick.ranges[1].length,
      ip: plan.quick.ranges[2].length,
    }) : null,
    quickCompatibleDeals: quickSolution?.compatibleDeals ?? null,
    quickNashConvPotFraction: quickNashConv,
    actionRegretDriftPotFraction: actionRegretDrift,
    frequencyTotalVariation: crossResolution?.frequencyTotalVariation ?? null,
    targetActionRegretDriftPotFraction: plan.targetActionRegretDriftPotFraction,
    scoringTargetPotFraction: plan.scoringTargetPotFraction,
    acceptedForGuidance,
    acceptedForScoring,
    checkpoints: Object.freeze([...checkpoints]),
    solveMode,
    stopReason,
    targetMet: acceptedForGuidance,
  });
}

/** Creates a structured-clone-safe request for the river solver Worker. */
export function materializeThreeWayRiverCoachRequest(
  request: ThreeWayRiverCoachRequest,
): MaterializedThreeWayRiverCoachRequest {
  return Object.freeze({
    ...request,
    rangeWeights: Object.freeze({
      oop: materializeRiverRangeWeight(request.board, request.suits, request.rangeWeights.oop),
      middle: materializeRiverRangeWeight(request.board, request.suits, request.rangeWeights.middle),
      ip: materializeRiverRangeWeight(request.board, request.suits, request.rangeWeights.ip),
    }),
  });
}

function hydrateThreeWayRiverCoachRequest(
  request: MaterializedThreeWayRiverCoachRequest,
): ThreeWayRiverCoachRequest {
  return {
    ...request,
    rangeWeights: {
      oop: rangeWeightFromMaterialized(request.rangeWeights.oop),
      middle: rangeWeightFromMaterialized(request.rangeWeights.middle),
      ip: rangeWeightFromMaterialized(request.rangeWeights.ip),
    },
  };
}

function fixedSolutionForPlan(plan: PreparedThreeWayRiverCoachPlan): ThreeWayRiverSolution {
  return solveThreeWayRiver(plan.quick.spec, {
    iterations: plan.minIterations,
    averagingDelay: Math.min(80, Math.max(15, Math.floor(plan.minIterations * 0.08))),
    linearAveraging: true,
  });
}

/**
 * Backwards-compatible one-resolution solve for deterministic tests and
 * non-browser callers. Browser training uses the adaptive Worker path below.
 */
export function solveThreeWayRiverCoachDecision(
  request: ThreeWayRiverCoachRequest,
): ThreeWayRiverCoachResult {
  const plan = prepareThreeWayRiverCoachPlan(request, false);
  const solution = fixedSolutionForPlan(plan);
  return buildCoachResult(
    plan,
    solution,
    null,
    [Object.freeze({
      resolution: "quick",
      representativeCombos: plan.quick.representativeCombos,
      iterations: solution.iterations,
      nashConvPotFraction: solution.audit.nashConvPotFraction,
    })],
    "fixed",
    "fixed-iterations",
  );
}

function abortError(): Error {
  const error = new Error("三人河牌求解已取消");
  error.name = "AbortError";
  return error;
}

async function yieldMacrotask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function solveAdaptiveLevel(
  plan: PreparedThreeWayRiverCoachPlan,
  level: PreparedThreeWayRiverCoachLevel,
  checkpoints: ThreeWayRiverCoachCheckpoint[],
  options: ThreeWayRiverCoachAsyncOptions,
): Promise<ThreeWayRiverSolution> {
  const session = createThreeWayRiverSolverSession(level.spec, {
    averagingDelay: Math.min(80, Math.max(15, Math.floor(plan.minIterations * 0.08))),
    linearAveraging: true,
  });
  const yieldControl = options.yieldControl ?? yieldMacrotask;
  // Keep training past the looser guidance gate when the caller requested a
  // stricter EV-scoring gate. Otherwise a 9% checkpoint would stop a solve
  // that still had budget to reach the published 3% scoring threshold.
  const trainingTarget = Math.min(
    plan.targetNashConvPotFraction,
    plan.scoringTargetPotFraction,
  );
  while (session.iterations < plan.maxIterations) {
    if (options.signal?.aborted) throw abortError();
    await yieldControl();
    if (options.signal?.aborted) throw abortError();
    const additionalIterations = Math.min(
      plan.iterationChunk,
      plan.maxIterations - session.iterations,
    );
    const checkpoint: ThreeWayRiverCheckpoint = session.run(additionalIterations);
    const progress = Object.freeze({
      resolution: level.resolution,
      representativeCombos: level.representativeCombos,
      iterations: checkpoint.iterations,
      maxIterations: plan.maxIterations,
      nashConvPotFraction: checkpoint.audit.nashConvPotFraction,
      targetNashConvPotFraction: plan.targetNashConvPotFraction,
    });
    checkpoints.push(Object.freeze({
      resolution: level.resolution,
      representativeCombos: level.representativeCombos,
      iterations: checkpoint.iterations,
      nashConvPotFraction: checkpoint.audit.nashConvPotFraction,
    }));
    options.onProgress?.(progress);
    if (
      checkpoint.iterations >= plan.minIterations
      && checkpoint.audit.nashConvPotFraction <= trainingTarget
    ) break;
  }
  return session.solution();
}

/**
 * Worker-friendly adaptive solve. It first converges a quick 3-combo panel,
 * then independently verifies the same node at a higher range resolution.
 * Guidance is accepted only when both trees converge and their per-action
 * regret vectors agree within the published pot-fraction bound. Frequency TV
 * remains diagnostic because near-indifferent equilibria may legitimately use
 * very different mixes.
 */
export async function solveMaterializedThreeWayRiverCoachDecision(
  request: MaterializedThreeWayRiverCoachRequest,
  options: ThreeWayRiverCoachAsyncOptions = {},
): Promise<ThreeWayRiverCoachResult> {
  const plan = prepareThreeWayRiverCoachPlan(hydrateThreeWayRiverCoachRequest(request));
  const checkpoints: ThreeWayRiverCoachCheckpoint[] = [];
  const quickSolution = await solveAdaptiveLevel(plan, plan.quick, checkpoints, options);
  const verificationSolution = await solveAdaptiveLevel(plan, plan.verification, checkpoints, options);
  const provisional = buildCoachResult(
    plan,
    verificationSolution,
    quickSolution,
    checkpoints,
    "adaptive",
    "iteration-limit",
  );
  const bothTreesConverged = quickSolution.audit.nashConvPotFraction <= plan.targetNashConvPotFraction
    && verificationSolution.audit.nashConvPotFraction <= plan.targetNashConvPotFraction;
  const stopReason: ThreeWayRiverCoachResult["stopReason"] = provisional.acceptedForGuidance
    ? "target-met"
    : bothTreesConverged ? "abstraction-unstable" : "iteration-limit";
  return buildCoachResult(
    plan,
    verificationSolution,
    quickSolution,
    checkpoints,
    "adaptive",
    stopReason,
  );
}
