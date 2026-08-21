export type PokerSuit = string | number;

export type PokerCard = {
  rank: number;
  suit: PokerSuit;
};

export type PokerDisplayCard = {
  rank: number | string;
  suit: PokerSuit;
};

export type PokerHandCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type PokerHandEvaluation = {
  score: number;
  category: PokerHandCategory;
  name: string;
};

export type PokerBestHand<TCard extends PokerCard = PokerCard> = PokerHandEvaluation & {
  /** The exact five source cards used by this evaluation, kept in input order. */
  cards: readonly [TCard, TCard, TCard, TCard, TCard];
};

export type PreflopHandFeatures = {
  highRank: number;
  lowRank: number;
  pair: boolean;
  suited: boolean;
  gap: number;
};

export type PokerBoardTexture = {
  /** Combined straight/flush pressure on the public board, from dry (0) to dynamic (1). */
  wetness: number;
  /** Pairing pressure: unpaired is 0, paired boards rise toward 1. */
  pairedness: number;
  /** Rank pressure of the highest public card, normalized to 0..1. */
  highCard: number;
  /** How close the board is to a single-suit texture. */
  flushPressure: number;
  /** How many ranks occupy the same five-card straight window. */
  connectivity: number;
};

export type PokerRandom = () => number;
export type OpponentRangeWeight = (hole: readonly [PokerCard, PokerCard]) => number;

export type EstimateEquityOptions = {
  /** Number of live opponents. Their cards are uniform unless opponentRanges is supplied. */
  opponents: number;
  /** Monte Carlo samples. Higher values reduce variance but take longer. */
  iterations?: number;
  /** Injectable RNG for deterministic tests and headless simulations. */
  random?: PokerRandom;
  /** Explicit four-suit domain when using a custom string representation. */
  suits?: readonly PokerSuit[];
  /** One public-information range likelihood function per opponent. */
  opponentRanges?: readonly OpponentRangeWeight[];
};

const HAND_NAMES = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"] as const;
const SYMBOL_SUITS = ["♠", "♥", "♦", "♣"] as const;
const STRING_SUIT_DOMAINS: readonly (readonly string[])[] = [
  SYMBOL_SUITS,
  ["s", "h", "d", "c"],
  ["S", "H", "D", "C"],
  ["spades", "hearts", "diamonds", "clubs"],
];
const COMBINATIONS = new Map<number, readonly (readonly number[])[]>();

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function suitKey(suit: PokerSuit) {
  return `${typeof suit}:${String(suit)}`;
}

function cardKey(card: PokerCard) {
  return `${card.rank}|${suitKey(card.suit)}`;
}

function assertCard(card: PokerCard, label = "card") {
  if (!Number.isInteger(card.rank) || card.rank < 2 || card.rank > 14) {
    throw new RangeError(`${label}.rank 必须是 2 到 14 的整数`);
  }
  if (typeof card.suit !== "string" && typeof card.suit !== "number") {
    throw new TypeError(`${label}.suit 必须是 string 或 number`);
  }
  if (typeof card.suit === "string" && card.suit.length === 0) {
    throw new RangeError(`${label}.suit 不能为空字符串`);
  }
}

function assertUniqueCards(cards: readonly PokerCard[]) {
  const keys = new Set<string>();
  cards.forEach((card, index) => {
    assertCard(card, `cards[${index}]`);
    const key = cardKey(card);
    if (keys.has(key)) throw new RangeError(`发现重复牌：rank=${card.rank}, suit=${String(card.suit)}`);
    keys.add(key);
  });
}

function packScore(category: PokerHandCategory, values: readonly number[]) {
  return [category, ...values, 0, 0, 0, 0, 0]
    .slice(0, 6)
    .reduce((total, value) => total * 15 + value, 0);
}

function evaluation(category: PokerHandCategory, values: readonly number[]): PokerHandEvaluation {
  return { score: packScore(category, values), category, name: HAND_NAMES[category] };
}

function combinations(cardCount: number) {
  const cached = COMBINATIONS.get(cardCount);
  if (cached) return cached;
  const result: number[][] = [];
  const choose = (start: number, picked: number[]) => {
    if (picked.length === 5) {
      result.push(picked);
      return;
    }
    for (let index = start; index <= cardCount - (5 - picked.length); index += 1) {
      choose(index + 1, [...picked, index]);
    }
  };
  choose(0, []);
  COMBINATIONS.set(cardCount, result);
  return result;
}

function scoreFiveUnchecked(cards: readonly PokerCard[]): PokerHandEvaluation {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const uniqueRanks = [...new Set(ranks)];
  if (uniqueRanks[0] === 14) uniqueRanks.push(1);
  let straightHigh = 0;
  for (let index = 0; index <= uniqueRanks.length - 5; index += 1) {
    if (uniqueRanks[index] - uniqueRanks[index + 4] === 4) {
      straightHigh = uniqueRanks[index];
      break;
    }
  }
  const flush = cards.every((card) => suitKey(card.suit) === suitKey(cards[0].suit));

  if (flush && straightHigh) return evaluation(8, [straightHigh]);
  if (groups[0][1] === 4) return evaluation(7, [groups[0][0], groups[1][0]]);
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) return evaluation(6, [groups[0][0], groups[1][0]]);
  if (flush) return evaluation(5, ranks);
  if (straightHigh) return evaluation(4, [straightHigh]);
  if (groups[0][1] === 3) {
    return evaluation(3, [groups[0][0], ...groups.filter((group) => group[1] === 1).map((group) => group[0])]);
  }
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const pairs = groups.filter((group) => group[1] === 2).map((group) => group[0]).sort((a, b) => b - a);
    return evaluation(2, [pairs[0], pairs[1], groups.find((group) => group[1] === 1)?.[0] ?? 0]);
  }
  if (groups[0][1] === 2) {
    return evaluation(1, [groups[0][0], ...groups.filter((group) => group[1] === 1).map((group) => group[0])]);
  }
  return evaluation(0, ranks);
}

/** Scores exactly five cards. Larger scores always beat smaller scores. */
export function scoreFive(cards: readonly PokerCard[]): PokerHandEvaluation {
  if (cards.length !== 5) throw new RangeError("scoreFive 必须接收正好 5 张牌");
  assertUniqueCards(cards);
  return scoreFiveUnchecked(cards);
}

function pokerDisplayRankValue(rank: PokerDisplayCard["rank"]): number {
  if (typeof rank === "number") return rank;
  const normalized = rank.trim().toUpperCase();
  const faceRanks: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
  return faceRanks[normalized] ?? Number(normalized);
}

/**
 * Orders an exact five-card hand for human-readable presentation without
 * changing its strength or source-card identity. Made hands lead, kickers
 * follow, and straights run high to low (with the wheel shown as 5-4-3-2-A).
 */
export function orderFiveCardHandForDisplay<TCard extends PokerDisplayCard>(
  cards: readonly TCard[],
): readonly [TCard, TCard, TCard, TCard, TCard] {
  const indexed = cards.map((card, index) => ({
    card,
    index,
    rank: pokerDisplayRankValue(card.rank),
  }));
  const { category } = scoreFive(indexed.map(({ card, rank }) => ({ rank, suit: card.suit })));
  const rankCounts = new Map<number, number>();
  for (const { rank } of indexed) rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);

  const wheel = (category === 4 || category === 8)
    && [14, 5, 4, 3, 2].every((rank) => rankCounts.has(rank));
  indexed.sort((left, right) => {
    if (category === 4 || category === 8) {
      const leftRank = wheel && left.rank === 14 ? 1 : left.rank;
      const rightRank = wheel && right.rank === 14 ? 1 : right.rank;
      return rightRank - leftRank || left.index - right.index;
    }
    return (rankCounts.get(right.rank) ?? 0) - (rankCounts.get(left.rank) ?? 0)
      || right.rank - left.rank
      || left.index - right.index;
  });

  return indexed.map(({ card }) => card) as [TCard, TCard, TCard, TCard, TCard];
}

/** Returns the best five-card Texas Hold'em hand from five to seven cards. */
function bestHandUnchecked(cards: readonly PokerCard[]): PokerHandEvaluation {
  let best: PokerHandEvaluation | undefined;
  for (const indices of combinations(cards.length)) {
    const candidate = scoreFiveUnchecked(indices.map((index) => cards[index]));
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best!;
}

export function bestHand(cards: readonly PokerCard[]): PokerHandEvaluation {
  if (cards.length < 5 || cards.length > 7) throw new RangeError("bestHand 必须接收 5 到 7 张牌");
  assertUniqueCards(cards);
  return bestHandUnchecked(cards);
}

/**
 * Returns both the best evaluation and the exact five cards that make it.
 * Equal-scoring choices keep the first combination, so callers can place
 * community cards first when they want a playing-the-board result to stay visible.
 */
export function bestHandWithCards<TCard extends PokerCard>(cards: readonly TCard[]): PokerBestHand<TCard> {
  if (cards.length < 5 || cards.length > 7) throw new RangeError("bestHandWithCards 必须接收 5 到 7 张牌");
  assertUniqueCards(cards);

  let best: PokerBestHand<TCard> | undefined;
  for (const indices of combinations(cards.length)) {
    const selected: [TCard, TCard, TCard, TCard, TCard] = [
      cards[indices[0]],
      cards[indices[1]],
      cards[indices[2]],
      cards[indices[3]],
      cards[indices[4]],
    ];
    const candidate = scoreFiveUnchecked(selected);
    if (!best || candidate.score > best.score) best = { ...candidate, cards: selected };
  }
  return best!;
}

/** Convenience alias that scores either a five-card hand or a 5–7 card holding. */
export function score(cards: readonly PokerCard[]): PokerHandEvaluation {
  return cards.length === 5 ? scoreFive(cards) : bestHand(cards);
}

export function preflopStrength(hole: readonly PokerCard[]): number {
  if (hole.length !== 2) return 0;
  assertUniqueCards(hole);
  const { highRank, lowRank, pair, suited, gap } = preflopHandFeatures(hole)!;
  let value = (highRank - 2) / 12 * 0.36 + (lowRank - 2) / 12 * 0.18;
  if (pair) value += 0.3 + (highRank - 2) / 12 * 0.18;
  if (suited) value += 0.08;
  if (gap === 1) value += 0.07;
  else if (gap === 2) value += 0.035;
  if (highRank === 14) value += 0.08;
  return clamp(value, 0.08, 0.98);
}

export function preflopHandFeatures(hole: readonly PokerCard[]): PreflopHandFeatures | null {
  if (hole.length !== 2) return null;
  assertUniqueCards(hole);
  const [high, low] = [...hole].sort((a, b) => b.rank - a.rank);
  return {
    highRank: high.rank,
    lowRank: low.rank,
    pair: high.rank === low.rank,
    suited: suitKey(high.suit) === suitKey(low.suit),
    gap: high.rank - low.rank,
  };
}

const PREFLOP_STRENGTH_DISTRIBUTION = (() => {
  const deck = makeDeck([0, 1, 2, 3]);
  const values: number[] = [];
  for (let first = 0; first < deck.length - 1; first += 1) {
    for (let second = first + 1; second < deck.length; second += 1) {
      values.push(preflopStrength([deck[first], deck[second]]));
    }
  }
  return values.sort((a, b) => a - b);
})();

/** Upper-bound percentile (share with strength <= this hand) among all 1,326 combinations. */
export function preflopPercentile(hole: readonly PokerCard[]): number {
  if (hole.length !== 2) return 0;
  const value = preflopStrength(hole);
  let lower = 0;
  let upper = PREFLOP_STRENGTH_DISTRIBUTION.length;
  while (lower < upper) {
    const middle = (lower + upper) >>> 1;
    if (PREFLOP_STRENGTH_DISTRIBUTION[middle] <= value) lower = middle + 1;
    else upper = middle;
  }
  return lower / PREFLOP_STRENGTH_DISTRIBUTION.length;
}

function straightRanks(cards: readonly PokerCard[]) {
  const ranks = new Set(cards.map((card) => card.rank));
  if (ranks.has(14)) ranks.add(1);
  return ranks;
}

function normalizedStraightRank(rank: number) {
  return rank === 1 ? 14 : rank;
}

export function drawPotential(hole: readonly PokerCard[], community: readonly PokerCard[]): number {
  if (community.length >= 5) return 0;
  if (hole.length !== 2) return 0;
  const cards = [...hole, ...community];
  assertUniqueCards(cards);
  const totalSuitCounts = new Map<string, number>();
  const holeSuitCounts = new Map<string, number>();
  for (const card of cards) {
    const key = suitKey(card.suit);
    totalSuitCounts.set(key, (totalSuitCounts.get(key) ?? 0) + 1);
  }
  for (const card of hole) {
    const key = suitKey(card.suit);
    holeSuitCounts.set(key, (holeSuitCounts.get(key) ?? 0) + 1);
  }

  // A four-flush entirely on the board is a public runout, not a personal
  // flush draw. At least one hole card must supply one of the four cards.
  const flushDraw = [...totalSuitCounts.entries()].some(([suit, count]) => (
    count === 4 && (holeSuitCounts.get(suit) ?? 0) > 0
  )) ? 0.11 : 0;

  const totalRanks = straightRanks(cards);
  const boardRanks = straightRanks(community);
  const personalRanks = new Set(
    [...straightRanks(hole)].filter((rank) => !boardRanks.has(rank)),
  );
  const oneCardStraightOuts = new Set<number>();
  let hasContributedThreeCardWindow = false;
  let straightDraw = 0;
  for (let low = 1; low <= 10; low += 1) {
    const window = [low, low + 1, low + 2, low + 3, low + 4];
    const hits = window.filter((rank) => totalRanks.has(rank));
    const holeContributes = hits.some((rank) => personalRanks.has(rank));
    if (!holeContributes) continue;
    if (hits.length === 4) {
      const missing = window.find((rank) => !totalRanks.has(rank));
      if (missing !== undefined) oneCardStraightOuts.add(normalizedStraightRank(missing));
    } else if (hits.length === 3) {
      hasContributedThreeCardWindow = true;
    }
  }
  if (oneCardStraightOuts.size >= 2) straightDraw = 0.09;
  else if (oneCardStraightOuts.size === 1) straightDraw = 0.05;
  else if (hasContributedThreeCardWindow) straightDraw = 0.035;
  return flushDraw + straightDraw;
}

export function blockerValue(hole: readonly PokerCard[], community: readonly PokerCard[]): number {
  if (hole.length !== 2) return 0;
  const cards = [...hole, ...community];
  assertUniqueCards(cards);

  // Before the flop, A/K removal is intrinsically relevant to premium opening
  // and re-raising ranges. Post-flop it is only a blocker when the board makes
  // that specific rank or suit relevant.
  if (community.length === 0) {
    return clamp(hole.reduce((value, card) => (
      value + (card.rank === 14 ? 0.03 : card.rank === 13 ? 0.02 : 0)
    ), 0), 0, 0.15);
  }

  const suitCounts = new Map<string, number>();
  for (const card of community) {
    const key = suitKey(card.suit);
    suitCounts.set(key, (suitCounts.get(key) ?? 0) + 1);
  }
  let value = 0;
  for (const [suit, count] of suitCounts) {
    if (count < 3) continue;
    const boardSuitRanks = new Set(
      community.filter((card) => suitKey(card.suit) === suit).map((card) => card.rank),
    );
    let highestUnseenRank = 14;
    while (highestUnseenRank >= 2 && boardSuitRanks.has(highestUnseenRank)) highestUnseenRank -= 1;
    if (hole.some((card) => suitKey(card.suit) === suit && card.rank === highestUnseenRank)) {
      value += 0.1;
    }
  }

  // On a four-straight board, holding the exact missing rank removes a large
  // share of the opponent's straight value combinations. Unrelated overcards
  // deliberately receive no post-flop blocker credit.
  const boardRanks = straightRanks(community);
  const straightCompletionRanks = new Set<number>();
  for (let low = 1; low <= 10; low += 1) {
    const window = [low, low + 1, low + 2, low + 3, low + 4];
    const hits = window.filter((rank) => boardRanks.has(rank));
    if (hits.length !== 4) continue;
    const missing = window.find((rank) => !boardRanks.has(rank));
    if (missing !== undefined) straightCompletionRanks.add(normalizedStraightRank(missing));
  }
  if (hole.some((card) => straightCompletionRanks.has(card.rank))) value += 0.04;

  const boardRankCounts = new Map<number, number>();
  for (const card of community) boardRankCounts.set(card.rank, (boardRankCounts.get(card.rank) ?? 0) + 1);
  if (hole.some((card) => (boardRankCounts.get(card.rank) ?? 0) >= 2)) value += 0.03;

  return clamp(value, 0, 0.15);
}

/**
 * Reduces public cards to continuous texture features for strategy mixing.
 * This intentionally describes the board rather than assigning it to a small
 * set of named buckets, so nearby runouts do not cause abrupt policy jumps.
 */
export function analyzeBoardTexture(community: readonly PokerCard[]): PokerBoardTexture {
  if (community.length === 0) {
    return { wetness: 0, pairedness: 0, highCard: 0, flushPressure: 0, connectivity: 0 };
  }
  community.forEach((card, index) => assertCard(card, `community[${index}]`));
  const uniqueRanks = [...new Set(community.map((card) => card.rank))];
  const pairedness = clamp(
    (community.length - uniqueRanks.length) / Math.max(1, community.length - 1),
  );
  const suitCounts = new Map<string, number>();
  for (const card of community) {
    const key = suitKey(card.suit);
    suitCounts.set(key, (suitCounts.get(key) ?? 0) + 1);
  }
  const maximumSuitCount = Math.max(...suitCounts.values());
  const flushPressure = community.length < 3
    ? 0
    : clamp((maximumSuitCount - 1) / Math.max(1, Math.min(3, community.length) - 1));
  const straightRanks = new Set(uniqueRanks);
  if (straightRanks.has(14)) straightRanks.add(1);
  let maximumWindowHits = 1;
  for (let low = 1; low <= 10; low += 1) {
    let hits = 0;
    for (let rank = low; rank < low + 5; rank += 1) hits += Number(straightRanks.has(rank));
    maximumWindowHits = Math.max(maximumWindowHits, hits);
  }
  const connectivity = clamp(((maximumWindowHits - 1) / 2) ** 2);
  const highCard = clamp((Math.max(...uniqueRanks) - 8) / 6);
  const wetness = clamp(flushPressure * 0.55 + connectivity * 0.52 - pairedness * 0.16);
  return { wetness, pairedness, highCard, flushPressure, connectivity };
}

export function makeDeck(suits: readonly PokerSuit[] = SYMBOL_SUITS): PokerCard[] {
  if (suits.length !== 4 || new Set(suits.map(suitKey)).size !== 4) {
    throw new RangeError("牌组必须提供 4 个互不相同的花色");
  }
  return suits.flatMap((suit) => Array.from({ length: 13 }, (_, index) => ({ rank: index + 2, suit })));
}

function inferSuits(cards: readonly PokerCard[]) {
  const values = [...new Set(cards.map((card) => card.suit))];
  if (values.every((value) => typeof value === "number")) {
    if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 3)) {
      throw new RangeError("数字花色必须使用 0、1、2、3");
    }
    return [0, 1, 2, 3] as const;
  }
  if (values.some((value) => typeof value !== "string")) {
    throw new TypeError("同一次权益计算不能混用字符串和数字花色");
  }
  const domain = STRING_SUIT_DOMAINS.find((candidate) => values.every((value) => candidate.includes(value as string)));
  if (!domain) throw new RangeError("无法推断自定义字符串花色；请通过 options.suits 提供完整四花色");
  return domain;
}

function unitRandom(random: PokerRandom) {
  return clamp(random(), 0, 1 - Number.EPSILON);
}

function sampleCards(source: readonly PokerCard[], count: number, random: PokerRandom) {
  const cards = [...source];
  for (let index = 0; index < count; index += 1) {
    const selected = index + Math.floor(unitRandom(random) * (cards.length - index));
    [cards[index], cards[selected]] = [cards[selected], cards[index]];
  }
  return cards.slice(0, count);
}

type WeightedHolding = {
  cards: readonly [PokerCard, PokerCard];
  keys: readonly [string, string];
  weight: number;
};

type WeightedRange = {
  holdings: readonly WeightedHolding[];
  totalWeight: number;
};

type WeightedJoint = {
  holes: readonly (readonly [PokerCard, PokerCard])[];
  cumulativeWeight: number;
};

type WeightedJointDistribution = {
  joints: readonly WeightedJoint[];
  totalWeight: number;
};

const EXACT_JOINT_ENUMERATION_LIMIT = 50_000;
const JOINT_CONSTRUCTION_ATTEMPTS = 64;

function buildWeightedRange(
  available: readonly PokerCard[],
  range: OpponentRangeWeight,
  index: number,
): WeightedRange {
  const candidates: Array<{
    cards: readonly [PokerCard, PokerCard];
    keys: readonly [string, string];
    weight: number;
  }> = [];
  let maximumWeight = 0;
  for (let first = 0; first < available.length - 1; first += 1) {
    for (let second = first + 1; second < available.length; second += 1) {
      const cards = [available[first], available[second]] as const;
      const rawWeight = range(cards);
      const weight = Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0;
      if (weight <= 0) continue;
      maximumWeight = Math.max(maximumWeight, weight);
      candidates.push({ cards, keys: [cardKey(cards[0]), cardKey(cards[1])], weight });
    }
  }
  if (maximumWeight <= 0) throw new RangeError(`opponentRanges[${index}] 没有正权重手牌`);

  // Scaling each range by its own maximum does not change the joint
  // distribution and avoids overflow when callers return very large weights.
  let totalWeight = 0;
  const holdings = candidates.map((candidate) => {
    const weight = candidate.weight / maximumWeight;
    totalWeight += weight;
    return { ...candidate, weight };
  });
  return { holdings, totalWeight };
}

function sampleConditionalHolding(
  range: WeightedRange,
  unavailable: ReadonlySet<string>,
  random: PokerRandom,
) {
  let compatibleWeight = 0;
  for (const holding of range.holdings) {
    if (!holding.keys.some((key) => unavailable.has(key))) compatibleWeight += holding.weight;
  }
  if (compatibleWeight <= 0) return undefined;

  let target = unitRandom(random) * compatibleWeight;
  let fallback: WeightedHolding | undefined;
  for (const holding of range.holdings) {
    if (holding.keys.some((key) => unavailable.has(key))) continue;
    fallback = holding;
    target -= holding.weight;
    if (target < 0) return { holding, compatibleWeight };
  }
  return fallback ? { holding: fallback, compatibleWeight } : undefined;
}

function canEnumerateJoint(ranges: readonly WeightedRange[]) {
  let combinations = 1;
  for (const range of ranges) {
    if (combinations > EXACT_JOINT_ENUMERATION_LIMIT / range.holdings.length) return false;
    combinations *= range.holdings.length;
  }
  return true;
}

function enumerateCompatibleJoints(ranges: readonly WeightedRange[]): WeightedJointDistribution {
  const candidates: Array<{
    holes: readonly (readonly [PokerCard, PokerCard])[];
    logWeight: number;
  }> = [];
  const holes: Array<readonly [PokerCard, PokerCard]> = [];
  const unavailable = new Set<string>();

  const visit = (rangeIndex: number, logWeight: number) => {
    if (rangeIndex === ranges.length) {
      candidates.push({ holes: [...holes], logWeight });
      return;
    }
    for (const holding of ranges[rangeIndex].holdings) {
      if (holding.keys.some((key) => unavailable.has(key))) continue;
      holding.keys.forEach((key) => unavailable.add(key));
      holes.push(holding.cards);
      visit(rangeIndex + 1, logWeight + Math.log(holding.weight));
      holes.pop();
      holding.keys.forEach((key) => unavailable.delete(key));
    }
  };
  visit(0, 0);
  if (!candidates.length) throw new RangeError("对手范围之间没有可兼容的正权重手牌");

  // Log weights keep sparse, highly skewed ranges numerically stable.
  const maximumLogWeight = Math.max(...candidates.map((candidate) => candidate.logWeight));
  let totalWeight = 0;
  const joints = candidates.map((candidate) => {
    totalWeight += Math.exp(candidate.logWeight - maximumLogWeight);
    return { holes: candidate.holes, cumulativeWeight: totalWeight };
  });
  return { joints, totalWeight };
}

function sampleEnumeratedJoint(
  distribution: WeightedJointDistribution,
  random: PokerRandom,
): readonly (readonly [PokerCard, PokerCard])[] {
  const target = unitRandom(random) * distribution.totalWeight;
  let lower = 0;
  let upper = distribution.joints.length;
  while (lower < upper) {
    const middle = (lower + upper) >>> 1;
    if (target < distribution.joints[middle].cumulativeWeight) upper = middle;
    else lower = middle + 1;
  }
  return distribution.joints[Math.min(lower, distribution.joints.length - 1)].holes;
}

function sampleJointWithImportanceCorrection(
  ranges: readonly WeightedRange[],
  random: PokerRandom,
  preferredFirstRange: number,
): { holes: readonly (readonly [PokerCard, PokerCard])[]; logImportanceWeight: number } {
  for (let attempt = 0; attempt < JOINT_CONSTRUCTION_ATTEMPTS; attempt += 1) {
    // Rotate which seat samples first, then shuffle the tail. This stratifies
    // collision modes instead of trusting a short Monte Carlo run to discover
    // every important ordering by chance. Each order uses the same valid
    // product-of-compatible-masses importance correction.
    const order = ranges.map((range, index) => ({ range, index }));
    const firstPosition = order.findIndex(({ index }) => index === preferredFirstRange);
    [order[0], order[firstPosition]] = [order[firstPosition], order[0]];
    for (let cursor = order.length - 1; cursor > 1; cursor -= 1) {
      const selected = 1 + Math.floor(unitRandom(random) * cursor);
      [order[cursor], order[selected]] = [order[selected], order[cursor]];
    }
    const unavailable = new Set<string>();
    const holes: Array<readonly [PokerCard, PokerCard]> = Array.from({ length: ranges.length });
    let logImportanceWeight = 0;
    let complete = true;
    for (const { range, index } of order) {
      const sampled = sampleConditionalHolding(range, unavailable, random);
      if (!sampled) {
        complete = false;
        break;
      }
      holes[index] = sampled.holding.cards;
      sampled.holding.keys.forEach((key) => unavailable.add(key));
      logImportanceWeight += Math.log(sampled.compatibleWeight);
    }
    if (complete) return { holes, logImportanceWeight };
  }
  throw new RangeError("无法从对手范围构造互不碰牌的联合手牌；范围可能不兼容");
}

export function estimateEquity(
  hole: readonly PokerCard[],
  community: readonly PokerCard[],
  opponents: number,
  iterations?: number,
  random?: PokerRandom,
): number;
export function estimateEquity(
  hole: readonly PokerCard[],
  community: readonly PokerCard[],
  options: EstimateEquityOptions,
): number;
/**
 * Monte Carlo equity against uniform or public-information-weighted opponent holdings.
 * The API intentionally accepts no real opponent hole cards, preventing hidden-card leakage.
 */
export function estimateEquity(
  hole: readonly PokerCard[],
  community: readonly PokerCard[],
  opponentsOrOptions: number | EstimateEquityOptions,
  positionalIterations = 90,
  positionalRandom: PokerRandom = Math.random,
): number {
  if (hole.length !== 2) return 0;
  if (community.length < 0 || community.length > 5) throw new RangeError("community 必须包含 0 到 5 张牌");
  const known = [...hole, ...community];
  assertUniqueCards(known);
  const options = typeof opponentsOrOptions === "number"
    ? { opponents: opponentsOrOptions, iterations: positionalIterations, random: positionalRandom }
    : opponentsOrOptions;
  const opponents = options.opponents;
  const iterations = options.iterations ?? 90;
  const random = options.random ?? Math.random;
  if (!Number.isInteger(opponents) || opponents < 1) throw new RangeError("opponents 必须是大于 0 的整数");
  if (!Number.isInteger(iterations) || iterations < 1) throw new RangeError("iterations 必须是大于 0 的整数");
  const suits = options.suits ?? inferSuits(known);
  const suitKeys = new Set(suits.map(suitKey));
  if (known.some((card) => !suitKeys.has(suitKey(card.suit)))) {
    throw new RangeError("已知牌的花色不在 options.suits 定义的四花色中");
  }
  const knownKeys = new Set(known.map(cardKey));
  const available = makeDeck(suits).filter((card) => !knownKeys.has(cardKey(card)));
  const boardCardsNeeded = 5 - community.length;
  const cardsNeeded = boardCardsNeeded + opponents * 2;
  if (cardsNeeded > available.length) throw new RangeError("剩余牌不足以完成公共牌和所有随机对手手牌");
  const opponentRanges = options.opponentRanges;
  if (opponentRanges && opponentRanges.length !== opponents) {
    throw new RangeError("opponentRanges 必须为每位对手提供一个范围权重函数");
  }

  if (opponentRanges) {
    const ranges = opponentRanges.map((range, index) => {
      if (typeof range !== "function") throw new TypeError(`opponentRanges[${index}] 必须是函数`);
      return buildWeightedRange(available, range, index);
    });
    const enumeratedJoint = canEnumerateJoint(ranges) ? enumerateCompatibleJoints(ranges) : undefined;
    let maximumLogImportance = -Infinity;
    let totalImportance = 0;
    let squaredImportance = 0;
    let weightedEquity = 0;
    let completedRuns = 0;
    const maximumRuns = enumeratedJoint ? iterations : iterations * 4;
    const targetEffectiveSamples = iterations * 0.6;
    while (
      completedRuns < iterations
      || (!enumeratedJoint
        && completedRuns < maximumRuns
        && totalImportance * totalImportance / Math.max(Number.MIN_VALUE, squaredImportance) < targetEffectiveSamples)
    ) {
      const jointSample = enumeratedJoint
        ? { holes: sampleEnumeratedJoint(enumeratedJoint, random), logImportanceWeight: 0 }
        : sampleJointWithImportanceCorrection(ranges, random, completedRuns % ranges.length);
      completedRuns += 1;
      const opponentHoles = jointSample.holes;
      const unavailable = new Set(opponentHoles.flatMap((holding) => holding.map(cardKey)));
      const runoutPool = available.filter((card) => !unavailable.has(cardKey(card)));
      const board = [...community, ...sampleCards(runoutPool, boardCardsNeeded, random)];
      const heroScore = bestHandUnchecked([...hole, ...board]).score;
      let topScore = heroScore;
      let tiedOpponents = 0;
      for (const opponentHole of opponentHoles) {
        const opponentScore = bestHandUnchecked([...opponentHole, ...board]).score;
        if (opponentScore > topScore) {
          topScore = opponentScore;
          tiedOpponents = 1;
        } else if (opponentScore === topScore) {
          tiedOpponents += 1;
        }
      }
      const equityShare = heroScore === topScore ? 1 / (tiedOpponents + 1) : 0;
      if (jointSample.logImportanceWeight > maximumLogImportance) {
        const scale = maximumLogImportance === -Infinity
          ? 0
          : Math.exp(maximumLogImportance - jointSample.logImportanceWeight);
        totalImportance = totalImportance * scale + 1;
        squaredImportance = squaredImportance * scale * scale + 1;
        weightedEquity = weightedEquity * scale + equityShare;
        maximumLogImportance = jointSample.logImportanceWeight;
      } else {
        const importance = Math.exp(jointSample.logImportanceWeight - maximumLogImportance);
        totalImportance += importance;
        squaredImportance += importance * importance;
        weightedEquity += importance * equityShare;
      }
    }
    return weightedEquity / totalImportance;
  }

  let equityShare = 0;
  for (let run = 0; run < iterations; run += 1) {
    const sampled = sampleCards(available, cardsNeeded, random);
    const board = [...community, ...sampled.slice(0, boardCardsNeeded)];
    // Known cards and the sampling pool were validated once above. Skipping
    // repeated validation here matters for tens-of-thousands-hand arenas.
    const heroScore = bestHandUnchecked([...hole, ...board]).score;
    let topScore = heroScore;
    let tiedOpponents = 0;
    let cursor = boardCardsNeeded;
    for (let opponent = 0; opponent < opponents; opponent += 1) {
      const opponentScore = bestHandUnchecked([sampled[cursor], sampled[cursor + 1], ...board]).score;
      cursor += 2;
      if (opponentScore > topScore) {
        topScore = opponentScore;
        tiedOpponents = 1;
      } else if (opponentScore === topScore) {
        tiedOpponents += 1;
      }
    }
    if (heroScore === topScore) equityShare += 1 / (tiedOpponents + 1);
  }
  return equityShare / iterations;
}
