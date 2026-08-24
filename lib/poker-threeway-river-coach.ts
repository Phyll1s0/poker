import {
  solveThreeWayRiver,
  threeWayRiverActionEvEntry,
  threeWayRiverStrategyEntry,
  type ThreeWayRiverAction,
  type ThreeWayRiverPlayer,
} from "./gto-threeway-river.ts";
import { type OpponentRangeWeight, type PokerCard, type PokerSuit } from "./poker-evaluator.ts";
import {
  representativeRiverRange,
  riverCoachHoldingKey,
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
  iterations?: number;
  targetNashConvPotFraction?: number;
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

/**
 * Solves a reduced three-player river abstraction and audits the returned
 * profile against exact unilateral best responses inside that same tree.
 * Multiplayer CFR+ has no general Nash-convergence guarantee, so targetMet is
 * a measured training gate rather than a claim of commercial/full-game GTO.
 */
export function solveThreeWayRiverCoachDecision(
  request: ThreeWayRiverCoachRequest,
): ThreeWayRiverCoachResult {
  if (request.board.length !== 5 || request.heroCards.length !== 2) {
    throw new RangeError("三人河牌求解必须包含 5 张公共牌和 2 张英雄手牌");
  }
  const potBb = finiteNonNegative(request.potAtStreetStartBb, "potAtStreetStartBb");
  if (potBb <= 0) throw new RangeError("河牌起始底池必须大于 0");
  const stackBb = request.stackAtStreetStartBb.map((value, index) => (
    finiteNonNegative(value, `stackAtStreetStartBb[${index}]`)
  )) as [number, number, number];
  if (stackBb.some((value) => value <= 0)) throw new RangeError("三位玩家河牌开始时都必须仍有可行动筹码");
  // Three seats multiply compatible chance tuples cubically. Three
  // representatives per seat keeps the on-demand browser solve responsive;
  // the measured NashConv gate below decides whether that coarse run is usable.
  const representativeCombos = request.representativeCombos ?? 3;
  const ranges = PLAYERS.map((player) => diversifiedRepresentativeRange(
    request,
    player,
    representativeCombos,
  )) as [
    ReturnType<typeof representativeRiverRange>,
    ReturnType<typeof representativeRiverRange>,
    ReturnType<typeof representativeRiverRange>,
  ];
  const publicNode = publicHistoryAndTree(request);
  const iterations = Math.max(100, Math.min(5_000, Math.round(request.iterations ?? 120)));
  const solution = solveThreeWayRiver({
    board: Object.freeze(request.board.map(toStrategyCard)) as readonly [
      StrategyCard,
      StrategyCard,
      StrategyCard,
      StrategyCard,
      StrategyCard,
    ],
    ranges,
    potBb,
    stackBb,
    bettingTree: publicNode.bettingTree,
    startingHistory: publicNode.historyActions,
  }, {
    iterations,
    averagingDelay: Math.min(80, Math.max(15, Math.floor(iterations * 0.08))),
    linearAveraging: true,
  });
  const heroHolding = riverCoachHoldingKey(request.heroCards);
  const strategy = threeWayRiverStrategyEntry(solution, request.heroPlayer, heroHolding, publicNode.history);
  const actionValues = threeWayRiverActionEvEntry(solution, request.heroPlayer, heroHolding, publicNode.history);
  if (!strategy || !actionValues) throw new Error("三人求解结果缺少当前手牌信息集");
  const evByAction = new Map(actionValues.actions.map((action, index) => [action, actionValues.actionEvBb[index]]));
  const actions = Object.freeze(strategy.actions.map((solverAction, index) => Object.freeze({
    solverAction,
    ...publicAction(solverAction),
    frequency: strategy.probabilities[index],
    evBb: evByAction.get(solverAction) ?? 0,
  })));
  const targetNashConvPotFraction = Math.max(
    0.01,
    Math.min(1, request.targetNashConvPotFraction ?? 0.1),
  );
  return Object.freeze({
    status: "solved",
    source: "internal-cfr+-reduced-three-way-river",
    scope: "three-way-river-single-bet-representative-ranges",
    approximation: "experimental-multiplayer-cfr+",
    spotId: solution.spotId,
    heroPlayer: request.heroPlayer,
    heroHolding,
    history: publicNode.history,
    actions,
    iterations: solution.iterations,
    representativeCombos: Object.freeze({
      oop: ranges[0].length,
      middle: ranges[1].length,
      ip: ranges[2].length,
    }),
    compatibleDeals: solution.compatibleDeals,
    profileValueBb: solution.audit.profileValueBb,
    playerDeviationGainsBb: solution.audit.perPlayerGainBb,
    nashConvBb: solution.audit.nashConvBb,
    nashConvNormalizationPotBb: solution.audit.normalizationPotBb,
    nashConvPotFraction: solution.audit.nashConvPotFraction,
    targetNashConvPotFraction,
    targetMet: solution.audit.nashConvPotFraction <= targetNashConvPotFraction,
  });
}
