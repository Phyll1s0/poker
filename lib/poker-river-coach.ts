import {
  headsUpRiverActionEvEntry,
  headsUpRiverStrategyEntry,
  solveHeadsUpRiverAdaptive,
  type HeadsUpRiverAction,
  type HeadsUpRiverPlayer,
  type HeadsUpRiverSolution,
  type WeightedRiverHolding,
} from "./gto-river.ts";
import { bestHand, type OpponentRangeWeight, type PokerCard, type PokerSuit } from "./poker-evaluator.ts";
import type { StrategyAction, StrategyCard } from "./poker-strategy.ts";

export type RiverCoachPublicAction = Readonly<{
  player: HeadsUpRiverPlayer;
  kind: StrategyAction;
  /** Chips added by this action, expressed in big blinds. */
  amountPaidBb: number;
}>;

export type RiverCoachRequest = Readonly<{
  board: readonly [PokerCard, PokerCard, PokerCard, PokerCard, PokerCard];
  suits: readonly [PokerSuit, PokerSuit, PokerSuit, PokerSuit];
  heroCards: readonly [PokerCard, PokerCard];
  heroPlayer: HeadsUpRiverPlayer;
  oopRangeWeight: OpponentRangeWeight;
  ipRangeWeight: OpponentRangeWeight;
  potAtStreetStartBb: number;
  effectiveStackAtStreetStartBb: number;
  publicActions: readonly RiverCoachPublicAction[];
  canRaise: boolean;
  representativeCombos?: number;
  iterations?: number;
}>;

export type RiverCoachAction = Readonly<{
  solverAction: HeadsUpRiverAction;
  action: StrategyAction;
  raiseToBb?: number;
  frequency: number;
  evBb: number;
}>;

export type RiverCoachResult = Readonly<{
  status: "solved";
  source: "internal-dcfr-reduced-river";
  scope: "heads-up-river-fixed-tree-representative-ranges";
  acceptedForGuidance: boolean;
  acceptedForScoring: boolean;
  solverVersion: HeadsUpRiverSolution["solverVersion"];
  resultId: string;
  algorithm: HeadsUpRiverSolution["algorithm"];
  solverParameters: HeadsUpRiverSolution["solverParameters"];
  convergence: HeadsUpRiverSolution["convergence"];
  spotId: string;
  heroPlayer: HeadsUpRiverPlayer;
  heroHolding: string;
  history: string;
  actions: readonly RiverCoachAction[];
  iterations: number;
  representativeCombos: Readonly<{ oop: number; ip: number }>;
  compatibleDeals: number;
  exploitabilityBb: number;
  exploitabilityPotFraction: number;
  accuracyLevel: HeadsUpRiverSolution["accuracyLevel"];
}>;

export function headsUpRiverCoachAdmission(
  accuracyLevel: HeadsUpRiverSolution["accuracyLevel"],
): Readonly<{ acceptedForGuidance: boolean; acceptedForScoring: boolean }> {
  return Object.freeze({
    acceptedForGuidance: accuracyLevel !== "experimental",
    acceptedForScoring: accuracyLevel === "commercial-target",
  });
}

const LONG_SUIT: Readonly<Record<string, StrategyCard["suit"]>> = Object.freeze({
  "♠": "spades",
  "♥": "hearts",
  "♦": "diamonds",
  "♣": "clubs",
  spades: "spades",
  hearts: "hearts",
  diamonds: "diamonds",
  clubs: "clubs",
});
const SUIT_SYMBOL: Readonly<Record<StrategyCard["suit"], string>> = Object.freeze({
  spades: "s",
  hearts: "h",
  diamonds: "d",
  clubs: "c",
});
const RANK_SYMBOL: Readonly<Record<number, string>> = Object.freeze({
  14: "A",
  13: "K",
  12: "Q",
  11: "J",
  10: "T",
});
const SOLVER_SUIT_ORDER: readonly StrategyCard["suit"][] = Object.freeze([
  "spades",
  "hearts",
  "diamonds",
  "clubs",
]);
const EPSILON = 1e-9;

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} 必须是非负有限数`);
  return value;
}

function rawCardKey(card: PokerCard): string {
  return `${card.rank}:${String(card.suit)}`;
}

function toStrategyCard(card: PokerCard): StrategyCard {
  const suit = LONG_SUIT[String(card.suit)];
  if (!suit) throw new RangeError(`不支持的花色 ${String(card.suit)}`);
  if (!Number.isInteger(card.rank) || card.rank < 2 || card.rank > 14) {
    throw new RangeError(`不支持的点数 ${card.rank}`);
  }
  return Object.freeze({ rank: card.rank, suit });
}

export function riverCoachHoldingKey(cards: readonly [PokerCard, PokerCard]): string {
  return cards
    .map(toStrategyCard)
    .sort((left, right) => (
      right.rank - left.rank
      || SOLVER_SUIT_ORDER.indexOf(left.suit) - SOLVER_SUIT_ORDER.indexOf(right.suit)
    ))
    .map((card) => `${RANK_SYMBOL[card.rank] ?? card.rank}${SUIT_SYMBOL[card.suit]}`)
    .join("");
}

export type MaterializedRiverRangeWeight = Readonly<{
  holding: string;
  weight: number;
}>;

/**
 * Converts a public range-weight callback into cloneable plain data. This is
 * intentionally only public range evidence: no opponent hole cards are read
 * or included. The materialized table can safely cross a Web Worker boundary.
 */
export function materializeRiverRangeWeight(
  board: readonly PokerCard[],
  suits: readonly PokerSuit[],
  rangeWeight: OpponentRangeWeight,
): readonly MaterializedRiverRangeWeight[] {
  if (suits.length !== 4 || new Set(suits.map(String)).size !== 4) {
    throw new RangeError("求解需要四种不同花色");
  }
  const boardKeys = new Set(board.map(rawCardKey));
  const deck: PokerCard[] = [];
  for (const suit of suits) {
    for (let rank = 2; rank <= 14; rank += 1) {
      const card = { rank, suit };
      if (!boardKeys.has(rawCardKey(card))) deck.push(card);
    }
  }
  const result: MaterializedRiverRangeWeight[] = [];
  for (let left = 0; left < deck.length; left += 1) {
    for (let right = left + 1; right < deck.length; right += 1) {
      const cards = [deck[left], deck[right]] as const;
      const rawWeight = rangeWeight(cards);
      const weight = Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0;
      if (weight <= 0) continue;
      result.push(Object.freeze({ holding: riverCoachHoldingKey(cards), weight }));
    }
  }
  return Object.freeze(result);
}

export function rangeWeightFromMaterialized(
  entries: readonly MaterializedRiverRangeWeight[],
): OpponentRangeWeight {
  const weights = new Map<string, number>();
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry.holding !== "string" || entry.holding.length < 4) {
      throw new TypeError(`materializedRange[${index}] 的手牌键无效`);
    }
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) {
      throw new RangeError(`materializedRange[${index}] 的权重必须为正有限数`);
    }
    if (weights.has(entry.holding)) throw new RangeError(`materializedRange 包含重复手牌 ${entry.holding}`);
    weights.set(entry.holding, entry.weight);
  }
  if (weights.size === 0) throw new RangeError("materializedRange 不能为空");
  return (cards) => weights.get(riverCoachHoldingKey(cards)) ?? 0;
}

type WeightedCandidate = Readonly<{
  cards: readonly [PokerCard, PokerCard];
  weight: number;
  score: number;
  key: string;
}>;

/**
 * Deterministic weighted quadrature over a complete public range. Each item
 * represents one equal-mass strength stratum. If supplied, the hero's actual
 * holding replaces the representative of its own stratum, so its strategy can
 * be queried without changing the public range model.
 */
export function representativeRiverRange(
  board: readonly PokerCard[],
  suits: readonly PokerSuit[],
  rangeWeight: OpponentRangeWeight,
  count: number,
  pinnedHolding?: readonly [PokerCard, PokerCard],
): readonly WeightedRiverHolding[] {
  if (!Number.isSafeInteger(count) || count < 2 || count > 24) {
    throw new RangeError("representativeCombos 必须是 2..24 的整数");
  }
  if (suits.length !== 4 || new Set(suits.map(String)).size !== 4) {
    throw new RangeError("求解需要四种不同花色");
  }
  const boardKeys = new Set(board.map(rawCardKey));
  const deck: PokerCard[] = [];
  for (const suit of suits) {
    for (let rank = 2; rank <= 14; rank += 1) {
      const card = { rank, suit };
      if (!boardKeys.has(rawCardKey(card))) deck.push(card);
    }
  }
  const candidates: WeightedCandidate[] = [];
  for (let left = 0; left < deck.length; left += 1) {
    for (let right = left + 1; right < deck.length; right += 1) {
      const cards = [deck[left], deck[right]] as const;
      const rawWeight = rangeWeight(cards);
      const weight = Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0;
      if (weight <= 0) continue;
      candidates.push(Object.freeze({
        cards,
        weight,
        score: bestHand([...board, ...cards]).score,
        key: riverCoachHoldingKey(cards),
      }));
    }
  }
  if (candidates.length < count) throw new RangeError("公开范围中可用组合不足");
  candidates.sort((left, right) => left.score - right.score || left.key.localeCompare(right.key));
  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) throw new RangeError("公开范围权重无法归一化");

  const cumulativeMidpoints: number[] = [];
  let cumulative = 0;
  for (const candidate of candidates) {
    cumulativeMidpoints.push(cumulative + candidate.weight / 2);
    cumulative += candidate.weight;
  }
  const pinnedKey = pinnedHolding ? riverCoachHoldingKey(pinnedHolding) : null;
  const pinnedIndex = pinnedKey === null ? -1 : candidates.findIndex((candidate) => candidate.key === pinnedKey);
  if (pinnedHolding && pinnedIndex < 0) throw new RangeError("指定手牌与公共牌冲突或不在范围内");
  const pinnedBucket = pinnedIndex < 0
    ? -1
    : Math.min(count - 1, Math.floor(cumulativeMidpoints[pinnedIndex] / totalWeight * count));

  const representatives: WeightedRiverHolding[] = [];
  const used = new Set<string>();
  for (let bucket = 0; bucket < count; bucket += 1) {
    const target = totalWeight * (bucket + 0.5) / count;
    let selectedIndex = bucket === pinnedBucket ? pinnedIndex : 0;
    if (bucket !== pinnedBucket) {
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < candidates.length; index += 1) {
        if (used.has(candidates[index].key) || index === pinnedIndex) continue;
        const distance = Math.abs(cumulativeMidpoints[index] - target);
        if (distance < bestDistance) {
          bestDistance = distance;
          selectedIndex = index;
        }
      }
    }
    const selected = candidates[selectedIndex];
    used.add(selected.key);
    representatives.push(Object.freeze({
      cards: Object.freeze(selected.cards.map(toStrategyCard)) as readonly [StrategyCard, StrategyCard],
      // Equal-mass strata preserve the coarse public range distribution.
      weight: 1,
    }));
  }
  return Object.freeze(representatives);
}

function normalizedAmount(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function actionTarget(action: HeadsUpRiverAction): number | undefined {
  if (!action.startsWith("bet-to:") && !action.startsWith("raise-to:")) return undefined;
  const target = Number(action.slice(action.indexOf(":") + 1));
  return Number.isFinite(target) ? target : undefined;
}

function publicHistoryAndTree(request: RiverCoachRequest) {
  const contributions: [number, number] = [0, 0];
  let actor: 0 | 1 = 0;
  let checks = 0;
  let reraises = 0;
  const history: string[] = [];
  const observedBetFractions: number[] = [];
  const observedRaiseFractions: number[] = [];
  const playerIndex: Readonly<Record<HeadsUpRiverPlayer, 0 | 1>> = { oop: 0, ip: 1 };

  for (const [index, action] of request.publicActions.entries()) {
    const expected = actor === 0 ? "oop" : "ip";
    if (action.player !== expected) throw new Error(`河牌行动 ${index + 1} 的行动顺序不合法`);
    const paid = finiteNonNegative(action.amountPaidBb, `publicActions[${index}].amountPaidBb`);
    const opponent: 0 | 1 = actor === 0 ? 1 : 0;
    const outstanding = contributions[opponent] - contributions[actor];
    if (action.kind === "fold") throw new Error("终局弃牌后不会再有当前决策");
    if (action.kind === "check") {
      if (outstanding > EPSILON || paid > EPSILON) throw new Error("非法过牌记录");
      history.push("check");
      checks += 1;
      if (checks >= 2) throw new Error("两次过牌后河牌已经结束");
    } else if (action.kind === "call") {
      if (outstanding <= EPSILON) throw new Error("没有面对下注时不能跟注");
      contributions[actor] = normalizedAmount(contributions[actor] + paid);
      history.push("call");
      throw new Error("跟注后河牌已经结束");
    } else {
      const target = normalizedAmount(contributions[actor] + paid);
      if (target <= contributions[opponent] + EPSILON) throw new Error("加注记录没有超过当前下注");
      if (outstanding <= EPSILON) {
        history.push(`bet-to:${target}`);
        observedBetFractions.push(target / request.potAtStreetStartBb);
      } else {
        const currentPot = request.potAtStreetStartBb + contributions[0] + contributions[1];
        const potAfterCall = currentPot + outstanding;
        history.push(`raise-to:${target}`);
        observedRaiseFractions.push((target - contributions[opponent]) / potAfterCall);
        reraises += 1;
      }
      contributions[actor] = target;
      checks = 0;
    }
    actor = opponent;
  }
  if (playerIndex[request.heroPlayer] !== actor) throw new Error("当前行动人与河牌公开行动线不一致");

  const uniquePositive = (values: readonly number[]) => [...new Set(values
    .filter((value) => Number.isFinite(value) && value > EPSILON)
    .map(normalizedAmount))].sort((left, right) => left - right);
  return Object.freeze({
    history: history.length ? history.join(">") : "root",
    bettingTree: Object.freeze({
      betPotFractions: Object.freeze(uniquePositive([0.75, 1.25, ...observedBetFractions])),
      raisePotAfterCallFractions: Object.freeze(uniquePositive([0.75, ...observedRaiseFractions])),
      maxRaises: Math.min(2, reraises + (request.canRaise ? 1 : 0)),
      allInAlwaysAvailable: true,
    }),
  });
}

function publicAction(action: HeadsUpRiverAction): Pick<RiverCoachAction, "action" | "raiseToBb"> {
  if (action === "fold" || action === "check" || action === "call") return { action };
  return { action: "raise", raiseToBb: actionTarget(action) };
}

/**
 * Solves the exact reduced river game represented by the supplied public
 * ranges and action tree. It is a real checkpointed DCFR solve, but deliberately does not
 * claim that eight representative combos equal the full commercial game.
 */
export function solveRiverCoachDecision(request: RiverCoachRequest): RiverCoachResult {
  if (request.board.length !== 5 || request.heroCards.length !== 2) {
    throw new RangeError("河牌求解必须包含 5 张公共牌和 2 张英雄手牌");
  }
  const potBb = finiteNonNegative(request.potAtStreetStartBb, "potAtStreetStartBb");
  const effectiveStackBb = finiteNonNegative(
    request.effectiveStackAtStreetStartBb,
    "effectiveStackAtStreetStartBb",
  );
  if (potBb <= 0 || effectiveStackBb <= 0) throw new RangeError("底池与有效筹码必须大于 0");
  const representativeCombos = request.representativeCombos ?? 8;
  const oopRange = representativeRiverRange(
    request.board,
    request.suits,
    request.oopRangeWeight,
    representativeCombos,
    request.heroPlayer === "oop" ? request.heroCards : undefined,
  );
  const ipRange = representativeRiverRange(
    request.board,
    request.suits,
    request.ipRangeWeight,
    representativeCombos,
    request.heroPlayer === "ip" ? request.heroCards : undefined,
  );
  const publicNode = publicHistoryAndTree(request);
  const iterations = Math.max(100, Math.min(10_000, Math.round(request.iterations ?? 800)));
  const solution = solveHeadsUpRiverAdaptive({
    board: Object.freeze(request.board.map(toStrategyCard)) as readonly [
      StrategyCard,
      StrategyCard,
      StrategyCard,
      StrategyCard,
      StrategyCard,
    ],
    oopRange,
    ipRange,
    potBb,
    effectiveStackBb,
    bettingTree: publicNode.bettingTree,
  }, {
    algorithm: "dcfr",
    maxIterations: iterations,
    checkpointInterval: Math.min(100, iterations),
    minimumIterations: Math.min(200, iterations),
    targetExploitabilityPotFraction: 0.0024,
    requiredConsecutiveTargetCheckpoints: 3,
  });
  const heroHolding = riverCoachHoldingKey(request.heroCards);
  const strategy = headsUpRiverStrategyEntry(solution, request.heroPlayer, heroHolding, publicNode.history);
  const actionValues = headsUpRiverActionEvEntry(solution, request.heroPlayer, heroHolding, publicNode.history);
  if (!strategy || !actionValues) throw new Error("求解结果缺少当前手牌信息集");
  const evByAction = new Map(actionValues.actions.map((action, index) => [action, actionValues.actionEvBb[index]]));
  const actions = Object.freeze(strategy.actions.map((solverAction, index) => Object.freeze({
    solverAction,
    ...publicAction(solverAction),
    frequency: strategy.probabilities[index],
    evBb: evByAction.get(solverAction) ?? 0,
  })));
  const admission = headsUpRiverCoachAdmission(solution.accuracyLevel);
  return Object.freeze({
    status: "solved",
    source: "internal-dcfr-reduced-river",
    scope: "heads-up-river-fixed-tree-representative-ranges",
    ...admission,
    solverVersion: solution.solverVersion,
    resultId: solution.resultId,
    algorithm: solution.algorithm,
    solverParameters: solution.solverParameters,
    convergence: solution.convergence,
    spotId: solution.spotId,
    heroPlayer: request.heroPlayer,
    heroHolding,
    history: publicNode.history,
    actions,
    iterations: solution.iterations,
    representativeCombos: Object.freeze({ oop: oopRange.length, ip: ipRange.length }),
    compatibleDeals: solution.compatibleDeals,
    exploitabilityBb: solution.exploitability.exploitabilityBb,
    exploitabilityPotFraction: solution.exploitability.exploitabilityPotFraction,
    accuracyLevel: solution.accuracyLevel,
  });
}
