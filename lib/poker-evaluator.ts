export type PokerSuit = string | number;

export type PokerCard = {
  rank: number;
  suit: PokerSuit;
};

export type PokerHandCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type PokerHandEvaluation = {
  score: number;
  category: PokerHandCategory;
  name: string;
};

export type PokerRandom = () => number;

export type EstimateEquityOptions = {
  /** Number of live opponents. Their unknown cards are sampled uniformly. */
  opponents: number;
  /** Monte Carlo samples. Higher values reduce variance but take longer. */
  iterations?: number;
  /** Injectable RNG for deterministic tests and headless simulations. */
  random?: PokerRandom;
  /** Explicit four-suit domain when using a custom string representation. */
  suits?: readonly PokerSuit[];
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

/** Convenience alias that scores either a five-card hand or a 5–7 card holding. */
export function score(cards: readonly PokerCard[]): PokerHandEvaluation {
  return cards.length === 5 ? scoreFive(cards) : bestHand(cards);
}

export function preflopStrength(hole: readonly PokerCard[]): number {
  if (hole.length !== 2) return 0;
  assertUniqueCards(hole);
  const [high, low] = [...hole].sort((a, b) => b.rank - a.rank);
  const pair = high.rank === low.rank;
  const suited = suitKey(high.suit) === suitKey(low.suit);
  const gap = high.rank - low.rank;
  let value = (high.rank - 2) / 12 * 0.36 + (low.rank - 2) / 12 * 0.18;
  if (pair) value += 0.3 + (high.rank - 2) / 12 * 0.18;
  if (suited) value += 0.08;
  if (gap === 1) value += 0.07;
  else if (gap === 2) value += 0.035;
  if (high.rank === 14) value += 0.08;
  return clamp(value, 0.08, 0.98);
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

export function drawPotential(hole: readonly PokerCard[], community: readonly PokerCard[]): number {
  if (community.length >= 5) return 0;
  if (hole.length !== 2) return 0;
  const cards = [...hole, ...community];
  assertUniqueCards(cards);
  const suitCounts = new Map<string, number>();
  for (const card of cards) {
    const key = suitKey(card.suit);
    suitCounts.set(key, (suitCounts.get(key) ?? 0) + 1);
  }
  const flushDraw = Math.max(0, ...suitCounts.values()) === 4 ? 0.11 : 0;
  const ranks = [...new Set(cards.map((card) => card.rank))];
  if (ranks.includes(14)) ranks.push(1);
  let straightDraw = 0;
  for (let low = 1; low <= 10; low += 1) {
    const hits = [low, low + 1, low + 2, low + 3, low + 4].filter((rank) => ranks.includes(rank)).length;
    if (hits >= 4) straightDraw = Math.max(straightDraw, 0.09);
    else if (hits === 3) straightDraw = Math.max(straightDraw, 0.035);
  }
  return flushDraw + straightDraw;
}

export function blockerValue(hole: readonly PokerCard[], community: readonly PokerCard[]): number {
  if (hole.length !== 2) return 0;
  const cards = [...hole, ...community];
  assertUniqueCards(cards);
  const suitCounts = new Map<string, number>();
  for (const card of community) {
    const key = suitKey(card.suit);
    suitCounts.set(key, (suitCounts.get(key) ?? 0) + 1);
  }
  const blockedSuit = [...suitCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const nutSuitBlocker = blockedSuit?.[1] >= 3
    && hole.some((card) => suitKey(card.suit) === blockedSuit[0] && card.rank === 14);
  const highBlockers = hole.filter((card) => card.rank >= 13).length;
  return clamp((nutSuitBlocker ? 0.1 : 0) + highBlockers * 0.025, 0, 0.15);
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
 * Monte Carlo equity against uniformly sampled unknown opponent holdings.
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
