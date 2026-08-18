"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playPokerSound, setPokerAudioEnabled, unlockPokerAudio } from "../lib/poker-audio";

type Suit = "♠" | "♥" | "♦" | "♣";
type Street = "preflop" | "flop" | "turn" | "river";
type ActionKind = "fold" | "check" | "call" | "raise";
type GameMode = "hand" | "session";
type TableImage = { loose: number; aggressive: number; deceptive: number };

type Card = { rank: number; suit: Suit };
type Player = {
  id: number;
  name: string;
  monogram: string;
  style: string;
  styleKey: keyof typeof AI_PROFILES | "human";
  stack: number;
  hole: Card[];
  folded: boolean;
  bet: number;
  contributed: number;
  hasActed: boolean;
  raiseLocked: boolean;
  isHuman: boolean;
};

type Game = {
  players: Player[];
  community: Card[];
  deck: Card[];
  pot: number;
  street: Street;
  dealer: number;
  current: number;
  highestBet: number;
  minRaise: number;
  dealFrom: number;
  dealCount: number;
  lastAggressor: number | null;
  winnerIds: number[];
  endedUncontested: boolean;
  shownPlayerIds: number[];
  showChoiceMade: boolean;
  handNo: number;
  status: "playing" | "showdown";
  result: string;
  log: string[];
};

type Review = {
  id: number;
  hand: number;
  street: string;
  cards: string;
  board: string;
  pot: number;
  toCall: number;
  equity: number;
  potOdds: number;
  action: string;
  recommended: string;
  mix: string;
  score: number;
  note: string;
};

type SessionHandResult = {
  hand: number;
  result: string;
  heroStack: number;
  score: number | null;
  decisions: number;
  heroCards: string;
};

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SMALL_BLIND = 5;
const BIG_BLIND = 10;
const STARTING_STACK = 1000;
const SESSION_HANDS = 20;

const AI_PROFILES = {
  gto: { aggression: 0.58, looseness: 0.28, bluff: 0.08 },
  lag: { aggression: 0.78, looseness: 0.4, bluff: 0.2 },
  tag: { aggression: 0.64, looseness: 0.22, bluff: 0.05 },
  adaptive: { aggression: 0.54, looseness: 0.31, bluff: 0.11 },
  nit: { aggression: 0.38, looseness: 0.16, bluff: 0.02 },
};

const AI_REVIEW_NOTES: Record<keyof typeof AI_PROFILES, string> = {
  gto: "频率均衡，下注尺度稳定，很少暴露明显漏洞。",
  lag: "入池范围宽、主动施压多，会用更多边缘牌制造困难。",
  tag: "入池谨慎但进攻坚决，持续下注通常代表较强范围。",
  adaptive: "会根据底池、牌面和行动压力动态调整进攻频率。",
  nit: "范围偏强、诈唬较少，大额投入通常需要认真对待。",
};

const PLAYER_TEMPLATES = [
  { name: "你", monogram: "ME", style: "训练席", styleKey: "human" as const, isHuman: true },
  { name: "ORION", monogram: "OR", style: "GTO 平衡", styleKey: "gto" as const, isHuman: false },
  { name: "SHARK", monogram: "SK", style: "松凶压迫", styleKey: "lag" as const, isHuman: false },
  { name: "IVY", monogram: "IV", style: "紧凶价值", styleKey: "tag" as const, isHuman: false },
  { name: "MIRA", monogram: "MI", style: "动态适应", styleKey: "adaptive" as const, isHuman: false },
  { name: "ROCK", monogram: "RK", style: "稳健保守", styleKey: "nit" as const, isHuman: false },
];

const STREET_LABELS: Record<Street, string> = {
  preflop: "翻牌前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
};

function makeDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

function shuffle<T>(source: T[]): T[] {
  const next = [...source];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function rankLabel(rank: number) {
  return rank <= 10 ? String(rank) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[rank];
}

function cardText(card: Card) {
  return `${rankLabel(card.rank)}${card.suit}`;
}

function cardKey(card: Card) {
  return `${card.rank}-${card.suit}`;
}

function scoreFive(cards: Card[]): { score: number; name: string } {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  ranks.forEach((rank) => counts.set(rank, (counts.get(rank) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = [...new Set(ranks)];
  if (unique[0] === 14) unique.push(1);
  let straightHigh = 0;
  for (let i = 0; i <= unique.length - 5; i += 1) {
    if (unique[i] - unique[i + 4] === 4) {
      straightHigh = unique[i];
      break;
    }
  }
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const pack = (category: number, values: number[]) =>
    [category, ...values, 0, 0, 0, 0, 0].slice(0, 6).reduce((total, value) => total * 15 + value, 0);

  if (flush && straightHigh) return { score: pack(8, [straightHigh]), name: "同花顺" };
  if (groups[0][1] === 4) return { score: pack(7, [groups[0][0], groups[1][0]]), name: "四条" };
  if (groups[0][1] === 3 && groups[1]?.[1] === 2)
    return { score: pack(6, [groups[0][0], groups[1][0]]), name: "葫芦" };
  if (flush) return { score: pack(5, ranks), name: "同花" };
  if (straightHigh) return { score: pack(4, [straightHigh]), name: "顺子" };
  if (groups[0][1] === 3) {
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]);
    return { score: pack(3, [groups[0][0], ...kickers]), name: "三条" };
  }
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const pairs = groups.filter((g) => g[1] === 2).map((g) => g[0]).sort((a, b) => b - a);
    const kicker = groups.find((g) => g[1] === 1)?.[0] ?? 0;
    return { score: pack(2, [pairs[0], pairs[1], kicker]), name: "两对" };
  }
  if (groups[0][1] === 2) {
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]);
    return { score: pack(1, [groups[0][0], ...kickers]), name: "一对" };
  }
  return { score: pack(0, ranks), name: "高牌" };
}

function bestHand(cards: Card[]): { score: number; name: string } {
  let best = { score: -1, name: "" };
  const choose = (start: number, picked: Card[]) => {
    if (picked.length === 5) {
      const result = scoreFive(picked);
      if (result.score > best.score) best = result;
      return;
    }
    for (let i = start; i <= cards.length - (5 - picked.length); i += 1) choose(i + 1, [...picked, cards[i]]);
  };
  choose(0, []);
  return best;
}

function preflopStrength(hole: Card[]): number {
  if (hole.length < 2) return 0;
  const [high, low] = [...hole].sort((a, b) => b.rank - a.rank);
  const pair = high.rank === low.rank;
  const suited = high.suit === low.suit;
  const gap = high.rank - low.rank;
  let value = (high.rank - 2) / 12 * 0.36 + (low.rank - 2) / 12 * 0.18;
  if (pair) value += 0.3 + (high.rank - 2) / 12 * 0.18;
  if (suited) value += 0.08;
  if (gap === 1) value += 0.07;
  else if (gap === 2) value += 0.035;
  if (high.rank === 14) value += 0.08;
  return Math.min(0.98, Math.max(0.08, value));
}

function estimateEquity(hole: Card[], community: Card[], opponents: number, iterations = 90): number {
  if (hole.length !== 2) return 0;
  const known = new Set([...hole, ...community].map(cardKey));
  const available = makeDeck().filter((card) => !known.has(cardKey(card)));
  let share = 0;
  for (let run = 0; run < iterations; run += 1) {
    const sample = shuffle(available).slice(0, 5 - community.length + opponents * 2);
    const board = [...community, ...sample.slice(0, 5 - community.length)];
    let cursor = 5 - community.length;
    const hero = bestHand([...hole, ...board]).score;
    const rivals: number[] = [];
    for (let i = 0; i < opponents; i += 1) {
      rivals.push(bestHand([sample[cursor], sample[cursor + 1], ...board]).score);
      cursor += 2;
    }
    const top = Math.max(hero, ...rivals);
    if (hero === top) share += 1 / (rivals.filter((score) => score === top).length + 1);
  }
  return share / iterations;
}

function currentEquity(game: Game, player: Player, iterations = 80): number {
  const opponents = Math.max(1, game.players.filter((p) => !p.folded && p.id !== player.id).length);
  if (game.street === "preflop") return estimateEquity(player.hole, [], opponents, Math.max(48, iterations));
  return estimateEquity(player.hole, game.community, opponents, iterations);
}

function nextEligible(players: Player[], from: number) {
  for (let step = 1; step <= players.length; step += 1) {
    const index = (from + step) % players.length;
    if (!players[index].folded && players[index].stack > 0) return index;
  }
  return -1;
}

function committedPot(game: Game) {
  return game.pot + game.players.reduce((sum, player) => sum + player.bet, 0);
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function drawPotential(hole: Card[], community: Card[]) {
  if (community.length >= 5) return 0;
  const cards = [...hole, ...community];
  const suits = new Map<Suit, number>();
  cards.forEach((card) => suits.set(card.suit, (suits.get(card.suit) ?? 0) + 1));
  const flushDraw = Math.max(...suits.values()) === 4 ? 0.11 : 0;
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

function blockerValue(hole: Card[], community: Card[]) {
  const suitCounts = new Map<Suit, number>();
  community.forEach((card) => suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1));
  const blockedSuit = [...suitCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const nutSuitBlocker = blockedSuit?.[1] >= 3 && hole.some((card) => card.suit === blockedSuit[0] && card.rank === 14);
  const highBlockers = hole.filter((card) => card.rank >= 13).length;
  return clamp((nutSuitBlocker ? 0.1 : 0) + highBlockers * 0.025, 0, 0.15);
}

function visibleHandStrength(player: Player, community: Card[]) {
  if (community.length + player.hole.length < 5) return preflopStrength(player.hole);
  const category = Math.floor(bestHand([...player.hole, ...community]).score / 15 ** 5);
  return clamp(category / 7 + Math.max(...player.hole.map((card) => card.rank)) / 140, 0, 1);
}

function aiWantsToShow(player: Player, game: Game) {
  if (player.isHuman) return false;
  const strength = visibleHandStrength(player, game.community);
  const weak = strength < 0.42;
  const chances: Record<keyof typeof AI_PROFILES, [number, number]> = {
    gto: [0.045, 0.07],
    lag: [0.58, 0.25],
    tag: [0.025, 0.2],
    adaptive: [0.3, 0.22],
    nit: [0.01, 0.28],
  };
  const [weakChance, strongChance] = chances[player.styleKey as keyof typeof AI_PROFILES];
  return Math.random() < (weak ? weakChance : strongChance);
}

function freshGame(
  previous?: Game,
  options: { resetStacks?: boolean; shuffleStyles?: boolean } = {},
): Game {
  const deck = shuffle(makeDeck());
  const dealer = previous ? (previous.dealer + 1) % PLAYER_TEMPLATES.length : 0;
  const stacks = previous?.players.length && !options.resetStacks
    ? previous.players.map((player) => (player.stack < BIG_BLIND ? STARTING_STACK : player.stack))
    : PLAYER_TEMPLATES.map(() => STARTING_STACK);
  const stylePool = options.shuffleStyles
    ? shuffle(PLAYER_TEMPLATES.slice(1).map(({ style, styleKey }) => ({ style, styleKey })))
    : previous?.players.length
      ? previous.players.slice(1).map(({ style, styleKey }) => ({ style, styleKey }))
      : PLAYER_TEMPLATES.slice(1).map(({ style, styleKey }) => ({ style, styleKey }));
  const players: Player[] = PLAYER_TEMPLATES.map((template, id) => ({
    ...template,
    ...(id > 0 ? stylePool[id - 1] : {}),
    id,
    stack: stacks[id],
    hole: [],
    folded: false,
    bet: 0,
    contributed: 0,
    hasActed: false,
    raiseLocked: false,
  }));
  let cursor = 0;
  for (let round = 0; round < 2; round += 1) {
    for (let offset = 1; offset <= players.length; offset += 1) {
      const seat = (dealer + offset) % players.length;
      players[seat].hole.push(deck[cursor]);
      cursor += 1;
    }
  }
  deck.splice(0, cursor);
  const smallBlind = (dealer + 1) % players.length;
  const bigBlind = (dealer + 2) % players.length;
  players[smallBlind].stack -= SMALL_BLIND;
  players[smallBlind].bet = SMALL_BLIND;
  players[smallBlind].contributed = SMALL_BLIND;
  players[bigBlind].stack -= BIG_BLIND;
  players[bigBlind].bet = BIG_BLIND;
  players[bigBlind].contributed = BIG_BLIND;
  const rebought = previous && !options.resetStacks
    ? previous.players.filter((player) => player.stack < BIG_BLIND).map((player) => player.name)
    : [];
  return {
    players,
    community: [],
    deck,
    pot: 0,
    street: "preflop",
    dealer,
    current: nextEligible(players, bigBlind),
    highestBet: BIG_BLIND,
    minRaise: BIG_BLIND,
    dealFrom: 0,
    dealCount: 0,
    lastAggressor: null,
    winnerIds: [],
    endedUncontested: false,
    shownPlayerIds: [],
    showChoiceMade: true,
    handNo: (previous?.handNo ?? 0) + 1,
    status: "playing",
    result: "",
    log: [
      ...(rebought.length ? [`自动补充筹码：${rebought.join("、")} 回到 ${STARTING_STACK}`] : []),
      `第 ${(previous?.handNo ?? 0) + 1} 手开始 · 盲注 ${SMALL_BLIND}/${BIG_BLIND}`,
    ],
  };
}

function awardUncontested(game: Game, players: Player[]): Game {
  const winner = players.find((player) => !player.folded)!;
  const total = game.pot + players.reduce((sum, player) => sum + player.bet, 0);
  const finalPlayers = players.map((player) =>
    player.id === winner.id ? { ...player, stack: player.stack + total, bet: 0 } : { ...player, bet: 0 },
  );
  const aiShows = !winner.isHuman && aiWantsToShow(winner, game);
  const result = `${winner.name} 收下底池 ${total}${aiShows ? " · 主动亮牌" : ""}`;
  return {
    ...game,
    players: finalPlayers,
    pot: 0,
    current: -1,
    status: "showdown",
    result,
    winnerIds: [winner.id],
    endedUncontested: true,
    shownPlayerIds: aiShows ? [winner.id] : [],
    showChoiceMade: !winner.isHuman,
    log: [result, ...game.log],
  };
}

function settleShowdown(game: Game): Game {
  const total = game.pot + game.players.reduce((sum, player) => sum + player.bet, 0);
  const payouts = new Map<number, number>();
  const levels = [...new Set(game.players.filter((player) => player.contributed > 0).map((player) => player.contributed))].sort((a, b) => a - b);
  let previousLevel = 0;
  let headlineWinners: { player: Player; score: number; name: string }[] = [];
  for (const level of levels) {
    const contributors = game.players.filter((player) => player.contributed >= level);
    const layerAmount = (level - previousLevel) * contributors.length;
    previousLevel = level;
    const eligible = contributors.filter((player) => !player.folded);
    if (!eligible.length || !layerAmount) continue;
    const ranked = eligible.map((player) => ({ player, ...bestHand([...player.hole, ...game.community]) }));
    const topScore = Math.max(...ranked.map((entry) => entry.score));
    const winners = ranked.filter((entry) => entry.score === topScore);
    if (!headlineWinners.length) headlineWinners = winners;
    const share = Math.floor(layerAmount / winners.length);
    let remainder = layerAmount - share * winners.length;
    winners.forEach((winner) => {
      const amount = share + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      payouts.set(winner.player.id, (payouts.get(winner.player.id) ?? 0) + amount);
    });
  }
  const paid = [...payouts.values()].reduce((sum, amount) => sum + amount, 0);
  const finalPlayers = game.players.map((player) => ({
    ...player,
    stack: player.stack + (payouts.get(player.id) ?? 0),
    bet: 0,
  }));
  const result = `${headlineWinners.map((entry) => entry.player.name).join(" / ")} · ${headlineWinners[0]?.name ?? "胜出"} · 赢得 ${paid || total}`;
  return {
    ...game,
    players: finalPlayers,
    pot: 0,
    current: -1,
    status: "showdown",
    result,
    winnerIds: [...payouts.keys()],
    endedUncontested: false,
    shownPlayerIds: game.players.filter((player) => !player.folded).map((player) => player.id),
    showChoiceMade: true,
    log: [result, ...game.log],
  };
}

function advanceStreet(game: Game, players: Player[]): Game {
  const collected = players.reduce((sum, player) => sum + player.bet, 0);
  const resetPlayers = players.map((player) => ({ ...player, bet: 0, hasActed: false, raiseLocked: false }));
  const deck = [...game.deck];
  const community = [...game.community];
  const dealFrom = community.length;
  let nextStreet: Street = game.street;

  if (game.street === "preflop") {
    community.push(deck.shift()!, deck.shift()!, deck.shift()!);
    nextStreet = "flop";
  } else if (game.street === "flop") {
    community.push(deck.shift()!);
    nextStreet = "turn";
  } else if (game.street === "turn") {
    community.push(deck.shift()!);
    nextStreet = "river";
  } else {
    return settleShowdown({ ...game, players: resetPlayers, pot: game.pot + collected });
  }

  const activeWithChips = resetPlayers.filter((player) => !player.folded && player.stack > 0);
  if (activeWithChips.length <= 1) {
    while (community.length < 5) community.push(deck.shift()!);
    return settleShowdown({
      ...game,
      players: resetPlayers,
      deck,
      community,
      street: "river",
      pot: game.pot + collected,
      dealFrom,
      dealCount: community.length - dealFrom,
    });
  }

  return {
    ...game,
    players: resetPlayers,
    deck,
    community,
    pot: game.pot + collected,
    street: nextStreet,
    current: nextEligible(resetPlayers, game.dealer),
    highestBet: 0,
    minRaise: BIG_BLIND,
    lastAggressor: null,
    dealFrom,
    dealCount: community.length - dealFrom,
    log: [`进入${STREET_LABELS[nextStreet]} · 底池 ${game.pot + collected}`, ...game.log],
  };
}

function act(game: Game, playerId: number, kind: ActionKind, raiseTo?: number): Game {
  if (game.status !== "playing" || game.current !== playerId) return game;
  const players = game.players.map((player) => ({ ...player }));
  const player = players[playerId];
  const toCall = Math.max(0, game.highestBet - player.bet);
  let highestBet = game.highestBet;
  let minRaise = game.minRaise;
  let lastAggressor = game.lastAggressor;
  let actionText = "";

  if (kind === "fold") {
    player.folded = true;
    player.hasActed = true;
    actionText = `${player.name} 弃牌`;
  } else if (kind === "check" && toCall === 0) {
    player.hasActed = true;
    actionText = `${player.name} 过牌`;
  } else if (kind === "call") {
    const paid = Math.min(toCall, player.stack);
    player.stack -= paid;
    player.bet += paid;
    player.contributed += paid;
    player.hasActed = true;
    actionText = paid < toCall ? `${player.name} 全下 ${paid}` : `${player.name} 跟注 ${paid}`;
  } else if (kind === "raise") {
    if (player.raiseLocked) return game;
    const maxTarget = player.bet + player.stack;
    const legalFloor = game.highestBet + game.minRaise;
    const target = Math.max(player.bet, Math.min(maxTarget, Math.max(raiseTo ?? legalFloor, Math.min(legalFloor, maxTarget))));
    const paid = target - player.bet;
    const increase = target - game.highestBet;
    player.stack -= paid;
    player.bet = target;
    player.contributed += paid;
    player.hasActed = true;
    if (target > game.highestBet) {
      highestBet = target;
      lastAggressor = player.id;
      const fullRaise = increase >= game.minRaise;
      if (fullRaise) minRaise = increase;
      players.forEach((other) => {
        if (other.id === player.id || other.folded || other.stack <= 0) return;
        if (fullRaise) {
          other.hasActed = false;
          other.raiseLocked = false;
        } else if (other.hasActed) {
          // 多个不足额全下累计达到一个完整加注量时，才重新开放已行动玩家的加注权。
          other.raiseLocked = target - other.bet < game.minRaise;
        }
      });
      actionText = `${player.name} ${player.stack === 0 ? "全下至" : "加注至"} ${target}`;
    } else {
      actionText = `${player.name} 跟注 ${paid}`;
    }
  } else {
    return game;
  }

  const withLog = { ...game, players, highestBet, minRaise, lastAggressor, log: [actionText, ...game.log] };
  const remaining = players.filter((candidate) => !candidate.folded);
  if (remaining.length === 1) return awardUncontested(withLog, players);
  const actors = remaining.filter((candidate) => candidate.stack > 0);
  const roundComplete = actors.every((candidate) => candidate.hasActed && candidate.bet === highestBet);
  if (roundComplete) return advanceStreet(withLog, players);

  return { ...withLog, current: nextEligible(players, playerId) };
}

function chooseAiAction(game: Game, player: Player, heroImage: TableImage): { kind: ActionKind; raiseTo?: number } {
  const profile = AI_PROFILES[player.styleKey as keyof typeof AI_PROFILES];
  const equity = currentEquity(game, player, game.street === "preflop" ? 70 : 82);
  const toCall = Math.max(0, game.highestBet - player.bet);
  const pot = committedPot(game);
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const pressure = toCall / Math.max(1, player.stack + player.bet);
  const draw = drawPotential(player.hole, game.community);
  const blockers = blockerValue(player.hole, game.community);
  const positionOffset = (player.id - game.dealer + game.players.length) % game.players.length;
  const inPosition = player.id === game.dealer || positionOffset === game.players.length - 1;
  const facingHero = game.lastAggressor === 0;
  const heroCallAdjustment = facingHero
    ? (heroImage.deceptive - 0.5) * 0.14 + (heroImage.loose - 0.5) * 0.08 + (heroImage.aggressive - 0.5) * 0.12
    : 0;
  const effectiveEquity = clamp(equity + heroCallAdjustment + (inPosition ? 0.012 : 0), 0.02, 0.98);
  const strategyStrength = game.street === "preflop"
    ? clamp(effectiveEquity * 0.35 + preflopStrength(player.hole) * 0.65, 0.02, 0.98)
    : effectiveEquity;
  const betFraction = clamp((pot * (0.48 + profile.aggression * 0.5)) / Math.max(1, pot), 0.33, 1.1);
  // 河牌均衡 bluff:value 为 b/(1+b)，换算成下注范围中的诈唬占比是 b/(1+2b)。
  const balancedBluffRate = betFraction / (1 + 2 * betFraction);
  const bluffCandidate = draw > 0.03 || blockers > 0.04 || (game.street === "river" && blockers > 0.07);
  const bluffFrequency = balancedBluffRate * (0.42 + profile.bluff * 2.8) * (inPosition ? 1.16 : 0.82);
  const bluffing = bluffCandidate && Math.random() < bluffFrequency;
  const valueThreshold = (game.street === "river" ? 0.61 : 0.57) - profile.aggression * 0.075;
  const strong = strategyStrength + draw * 0.35 > valueThreshold;
  const sizeOptions = game.street === "river" ? [0.5, 0.75, 1] : [0.33, 0.5, 0.75];
  const sizeIndex = strong ? (profile.aggression > 0.68 ? 2 : 1) : blockers > 0.08 ? 2 : 0;
  const raiseSize = Math.max(game.minRaise, Math.round((pot * sizeOptions[sizeIndex]) / BIG_BLIND) * BIG_BLIND);
  const target = Math.min(player.bet + player.stack, game.highestBet + raiseSize);
  const mix = Math.random();

  if (toCall > 0) {
    const continueEdge = strategyStrength + draw + profile.looseness * 0.1 - potOdds - pressure * 0.12;
    if (!bluffing && continueEdge < -0.055) return { kind: "fold" };
    if (!bluffing && continueEdge < 0.015 && mix > 0.28 + profile.looseness * 0.42) return { kind: "fold" };
    const raiseFrequency = strong ? 0.42 + profile.aggression * 0.48 : bluffing ? 0.28 + profile.aggression * 0.36 : 0;
    if (!player.raiseLocked && (strong || bluffing) && target > game.highestBet && mix < raiseFrequency)
      return { kind: "raise", raiseTo: target };
    return { kind: "call" };
  }
  const probe = inPosition && strategyStrength > 0.34 && mix < 0.12 + profile.aggression * 0.12;
  const betFrequency = strong ? 0.48 + profile.aggression * 0.46 : bluffing ? 0.34 + profile.aggression * 0.42 : probe ? 1 : 0;
  if (!player.raiseLocked && (strong || bluffing || probe) && target > game.highestBet && mix < betFrequency)
    return { kind: "raise", raiseTo: target };
  return { kind: "check" };
}

function setHeroShowChoice(game: Game, show: boolean): Game {
  if (!game.endedUncontested || game.winnerIds[0] !== 0 || game.showChoiceMade) return game;
  const text = show ? "你选择亮出手牌" : "你选择盖牌";
  return {
    ...game,
    shownPlayerIds: show ? [...new Set([...game.shownPlayerIds, 0])] : game.shownPlayerIds,
    showChoiceMade: true,
    result: `${game.result} · 你选择${show ? "亮牌" : "盖牌"}`,
    log: [text, ...game.log],
  };
}

function getAdvice(game: Game, player: Player, equity: number) {
  const toCall = Math.max(0, game.highestBet - player.bet);
  const pot = committedPot(game);
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const strategyStrength = game.street === "preflop"
    ? equity * 0.35 + preflopStrength(player.hole) * 0.65
    : equity;
  let action: ActionKind;
  let note: string;
  if (toCall > 0 && equity < potOdds - 0.045) {
    action = "fold";
    note = `胜率约 ${Math.round(equity * 100)}%，低于跟注所需 ${Math.round(potOdds * 100)}%。控制负 EV 跟注。`;
  } else if (!player.raiseLocked && strategyStrength > (toCall > 0 ? 0.57 : 0.51)) {
    action = "raise";
    note = `胜率约 ${Math.round(equity * 100)}%，具备价值下注或保护范围的空间。`;
  } else {
    action = toCall > 0 ? "call" : "check";
    note = player.raiseLocked
      ? `前面的不足额全下没有重新开放加注权；当前只能跟注或弃牌。估算胜率约 ${Math.round(equity * 100)}%。`
      : toCall > 0
      ? `底池赔率需要 ${Math.round(potOdds * 100)}%，当前估算胜率 ${Math.round(equity * 100)}%，继续范围合理。`
      : `中等牌力适合控制底池，保留对手的诈唬范围。`;
  }
  const frequencies: Record<ActionKind, number> = { fold: 0, check: 0, call: 0, raise: 0 };
  if (toCall > 0) {
    if (action === "fold") Object.assign(frequencies, { fold: 0.72, call: player.raiseLocked ? 0.28 : 0.24, raise: player.raiseLocked ? 0 : 0.04 });
    else if (action === "raise") Object.assign(frequencies, { fold: 0.02, call: 0.38, raise: 0.6 });
    else Object.assign(frequencies, { fold: 0.12, call: player.raiseLocked ? 0.88 : 0.68, raise: player.raiseLocked ? 0 : 0.2 });
  } else if (action === "raise") Object.assign(frequencies, { check: 0.36, raise: 0.64 });
  else Object.assign(frequencies, { check: 0.7, raise: player.raiseLocked ? 0 : 0.3 });
  const labels: Record<ActionKind, string> = { fold: "弃牌", check: "过牌", call: "跟注", raise: "加注" };
  const mix = (Object.entries(frequencies) as [ActionKind, number][])
    .filter(([, frequency]) => frequency > 0)
    .map(([kind, frequency]) => `${labels[kind]} ${Math.round(frequency * 100)}%`)
    .join(" · ");
  return { action, note, potOdds, frequencies, mix };
}

const ACTION_LABELS: Record<ActionKind, string> = { fold: "弃牌", check: "过牌", call: "跟注", raise: "加注" };

function PlayingCard({ card, ghost = false, dealDelay }: { card?: Card; ghost?: boolean; dealDelay?: number }) {
  if (!card) return <div className={ghost ? "card card-ghost" : "card card-back"}><span>♠</span></div>;
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div
      className={`card ${red ? "red" : "black"} ${dealDelay !== undefined ? "dealt-card" : ""}`}
      style={dealDelay !== undefined ? { animationDelay: `${dealDelay}ms` } : undefined}
      aria-label={cardText(card)}
    >
      <span className="card-rank">{rankLabel(card.rank)}</span>
      <span className="card-suit">{card.suit}</span>
    </div>
  );
}

function PlayerSeat({ player, game, index, thinking, revealReady }: { player: Player; game: Game; index: number; thinking: boolean; revealReady: boolean }) {
  const reveal = game.status === "showdown" && revealReady && game.shownPlayerIds.includes(player.id);
  const isCurrent = game.current === index;
  const role = index === game.dealer ? "D" : index === (game.dealer + 1) % 6 ? "SB" : index === (game.dealer + 2) % 6 ? "BB" : "";
  return (
    <div className={`player-seat seat-${index} ${isCurrent ? "is-current" : ""} ${player.folded ? "is-folded" : ""}`}>
      <div className={`seat-cards ${reveal || player.isHuman ? "is-revealed" : ""}`} aria-label={reveal ? `${player.name} 的手牌` : `${player.name} 的手牌未公开`}>
        {player.hole.map((card) => (
          <PlayingCard key={cardKey(card)} card={reveal || player.isHuman ? card : undefined} />
        ))}
      </div>
      <div className="player-panel">
        <div className="avatar">{player.monogram}</div>
        <div className="player-copy">
          <div className="player-title">
            <strong>{player.name}</strong>
            {role && <span className="role-chip">{role}</span>}
          </div>
          <span>{player.isHuman ? player.style : "策略隐藏"}</span>
        </div>
        <div className="stack"><i />{player.stack}</div>
      </div>
      {player.bet > 0 && <div className="table-bet"><i />{player.bet}</div>}
      {thinking && isCurrent && <div className="thinking"><b /><b /><b /></div>}
      {player.folded && <div className="fold-label">已弃牌</div>}
    </div>
  );
}

export default function Home() {
  const [game, setGame] = useState<Game | null>(null);
  const [training, setTraining] = useState(true);
  const [raiseTo, setRaiseTo] = useState(30);
  const [review, setReview] = useState<Review[]>([]);
  const [feedback, setFeedback] = useState<Review | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [mode, setMode] = useState<GameMode>("hand");
  const [sessionEnded, setSessionEnded] = useState(false);
  const [sessionResults, setSessionResults] = useState<SessionHandResult[]>([]);
  const [heroImage, setHeroImage] = useState<TableImage>({ loose: 0.5, aggressive: 0.5, deceptive: 0.5 });
  const winSoundHand = useRef(0);
  const soundOnRef = useRef(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setGame(freshGame(undefined, { shuffleStyles: true })), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const human = game?.players[0];
  const isHumanTurn = Boolean(game && human && !dealing && game.status === "playing" && game.current === human.id);
  const thinking = Boolean(game && !dealing && game.status === "playing" && game.current >= 0 && !game.players[game.current]?.isHuman);
  const toCall = game && human ? Math.max(0, game.highestBet - human.bet) : 0;
  const minTarget = game && human ? Math.min(human.bet + human.stack, game.highestBet + game.minRaise) : 0;
  const maxTarget = human ? human.bet + human.stack : 0;
  const raiseDisabled = !game || maxTarget <= game.highestBet || !isHumanTurn || Boolean(human?.raiseLocked);
  const communityLength = game?.community.length ?? 0;
  const dealCount = game?.dealCount ?? 0;
  const currentHandNo = game?.handNo ?? 0;

  useEffect(() => {
    if (communityLength === 0 || dealCount === 0) {
      const idleTimer = window.setTimeout(() => setDealing(false), 0);
      return () => window.clearTimeout(idleTimer);
    }
    const startTimer = window.setTimeout(() => setDealing(true), 0);
    const duration = 520 + Math.max(0, dealCount - 1) * 300;
    if (soundOnRef.current) {
      for (let index = 0; index < dealCount; index += 1) playPokerSound("deal", index * 0.3);
    }
    const timer = window.setTimeout(() => setDealing(false), duration);
    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(timer);
    };
  }, [communityLength, dealCount, currentHandNo]);

  useEffect(() => {
    if (game?.status === "showdown" && !dealing) {
      const timer = window.setTimeout(() => {
        const decisions = review.filter((item) => item.hand === game.handNo);
        const score = decisions.length
          ? Math.round(decisions.reduce((sum, item) => sum + item.score, 0) / decisions.length)
          : null;
        if (mode === "session") {
          setSessionResults((items) => [
            ...items.filter((item) => item.hand !== game.handNo),
            {
              hand: game.handNo,
              result: game.result,
              heroStack: game.players[0].stack,
              score,
              decisions: decisions.length,
              heroCards: game.players[0].hole.map(cardText).join(" "),
            },
          ]);
        }
        if (mode === "hand" && game.showChoiceMade) setShowLog(true);
        if (mode === "session" && game.handNo >= SESSION_HANDS && game.showChoiceMade) {
          setSessionEnded(true);
          setShowLog(true);
        }
        if (soundOnRef.current && winSoundHand.current !== game.handNo) {
          winSoundHand.current = game.handNo;
          playPokerSound("win");
        }
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [game, dealing, mode, review]);

  useEffect(() => {
    if (!isHumanTurn || maxTarget <= 0) return;
    const timer = window.setTimeout(() => setRaiseTo(Math.max(minTarget, Math.min(maxTarget, Math.max(30, minTarget)))), 0);
    return () => window.clearTimeout(timer);
  }, [isHumanTurn, minTarget, maxTarget, game?.street]);

  const equity = useMemo(() => {
    if (!game || !human || !isHumanTurn) return 0;
    return currentEquity(game, human, game.street === "preflop" ? 100 : 110);
  }, [game, human, isHumanTurn]);

  const advice = useMemo(() => (game && human && isHumanTurn ? getAdvice(game, human, equity) : null), [game, human, isHumanTurn, equity]);

  useEffect(() => {
    if (!game || dealing || game.status !== "playing" || game.current < 0) return;
    const player = game.players[game.current];
    if (!player || player.isHuman) return;
    const timer = window.setTimeout(() => {
      const decision = chooseAiAction(game, player, heroImage);
      if (soundOn) playPokerSound(decision.kind);
      setGame((current) => {
        if (!current || current.handNo !== game.handNo || current.status !== "playing" || current.current !== player.id) return current;
        return act(current, player.id, decision.kind, decision.raiseTo);
      });
    }, 520 + Math.random() * 620);
    return () => window.clearTimeout(timer);
  }, [game, dealing, soundOn, heroImage]);

  const startNextHand = useCallback(() => {
    if (mode === "session" && (sessionEnded || (game?.handNo ?? 0) >= SESSION_HANDS)) return;
    setFeedback(null);
    setShowLog(false);
    setGame((current) => freshGame(current ?? undefined, {
      resetStacks: mode === "hand",
      shuffleStyles: mode === "hand",
    }));
  }, [mode, sessionEnded, game?.handNo]);

  const switchMode = useCallback((nextMode: GameMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setTraining(nextMode === "hand");
    setReview([]);
    setFeedback(null);
    setShowLog(false);
    setSessionEnded(false);
    setSessionResults([]);
    setHeroImage({ loose: 0.5, aggressive: 0.5, deceptive: 0.5 });
    winSoundHand.current = 0;
    setGame(freshGame(undefined, { shuffleStyles: true }));
  }, [mode]);

  const chooseHeroShow = useCallback((show: boolean) => {
    if (!game || !game.endedUncontested || game.winnerIds[0] !== 0 || game.showChoiceMade) return;
    const strength = visibleHandStrength(game.players[0], game.community);
    setHeroImage((image) => ({
      loose: clamp(image.loose * 0.82 + (show && strength < 0.45 ? 0.78 : show ? 0.38 : 0.52) * 0.18),
      aggressive: image.aggressive,
      deceptive: clamp(image.deceptive * 0.75 + (show && strength < 0.45 ? 0.92 : show ? 0.28 : 0.62) * 0.25),
    }));
    setGame(setHeroShowChoice(game, show));
  }, [game]);

  const handleAction = useCallback((kind: ActionKind) => {
    if (!game || !human || !isHumanTurn || !advice) return;
    if (soundOn) void unlockPokerAudio().then((ready) => { if (ready) playPokerSound(kind); });
    const bestFrequency = Math.max(...Object.values(advice.frequencies));
    const selectedFrequency = advice.frequencies[kind];
    const score = selectedFrequency > 0 ? Math.round(45 + 55 * selectedFrequency / bestFrequency) : 35;
    const entry: Review = {
      id: Date.now(),
      hand: game.handNo,
      street: STREET_LABELS[game.street],
      cards: human.hole.map(cardText).join(" "),
      board: game.community.length ? game.community.map(cardText).join(" ") : "—",
      pot: committedPot(game),
      toCall,
      equity,
      potOdds: advice.potOdds,
      action: kind === "raise" ? `加注至 ${raiseTo}` : ACTION_LABELS[kind],
      recommended: ACTION_LABELS[advice.action],
      mix: advice.mix,
      score,
      note: advice.note,
    };
    setReview((items) => [entry, ...items].slice(0, 400));
    setFeedback(mode === "hand" ? entry : null);
    setHeroImage((image) => {
      const looseSignal = kind === "fold" ? 0.18 : kind === "check" ? 0.4 : kind === "call" ? 0.68 : 0.78;
      const aggressionSignal = kind === "raise" ? 0.9 : kind === "fold" ? 0.34 : 0.24;
      return {
        loose: clamp(image.loose * 0.88 + looseSignal * 0.12),
        aggressive: clamp(image.aggressive * 0.88 + aggressionSignal * 0.12),
        deceptive: image.deceptive,
      };
    });
    setGame((current) => (current ? act(current, human.id, kind, kind === "raise" ? raiseTo : undefined) : current));
  }, [game, human, isHumanTurn, advice, raiseTo, toCall, equity, soundOn, mode]);

  const toggleSound = useCallback(() => {
    const next = !soundOn;
    setSoundOn(next);
    soundOnRef.current = next;
    void setPokerAudioEnabled(next).then(() => {
      if (next) playPokerSound("call");
    });
  }, [soundOn]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === "INPUT") return;
      const key = event.key.toLowerCase();
      if (game?.status === "showdown" && !dealing && key === "n") {
        if (!game.showChoiceMade) return;
        if (mode === "session" && game.handNo >= SESSION_HANDS) setShowLog(true);
        else startNextHand();
        return;
      }
      if (!isHumanTurn) return;
      if (key === "f") handleAction("fold");
      if (key === "c") handleAction(toCall === 0 ? "check" : "call");
      if (key === "r" && !raiseDisabled) handleAction("raise");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [game, dealing, isHumanTurn, toCall, raiseDisabled, handleAction, startNextHand, mode]);

  if (!game || !human) {
    return (
      <main className="loading-screen">
        <div className="brand-mark">P</div>
        <span>正在洗牌…</span>
      </main>
    );
  }

  const handFinished = game.status === "showdown" && !dealing;
  const sessionScore = review.length ? Math.round(review.reduce((sum, item) => sum + item.score, 0) / review.length) : "—";
  const handReview = review.filter((item) => item.hand === game.handNo);
  const handScore = handReview.length ? Math.round(handReview.reduce((sum, item) => sum + item.score, 0) / handReview.length) : "—";
  const reviewUnlocked = mode === "hand" ? handFinished && game.showChoiceMade : sessionEnded;
  const reportReview = [...(mode === "hand" ? handReview : review)].reverse();
  const reportScore = mode === "hand" ? handScore : sessionScore;
  const completedHands = mode === "session"
    ? Math.max(sessionResults.length, handFinished ? Math.min(game.handNo, SESSION_HANDS) : game.handNo - 1)
    : game.handNo;
  const showDecisionPending = handFinished && game.endedUncontested && game.winnerIds[0] === 0 && !game.showChoiceMade;
  const imageLabel = (value: number, low: string, middle: string, high: string) => value < 0.42 ? low : value > 0.58 ? high : middle;
  const streetScores = (["翻牌前", "翻牌", "转牌", "河牌"] as const).map((street) => {
    const items = review.filter((item) => item.street === street);
    return { street, count: items.length, score: items.length ? Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length) : null };
  });

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div><strong>RANGECRAFT</strong><span>德州扑克训练室</span></div>
        </div>
        <div className="session-meta">
          <span className="status-dot" />
          <span>本地单机</span>
          <i />
          <span>NL10 · 6-MAX</span>
          <i />
          <span>{mode === "session" ? `${Math.min(game.handNo, SESSION_HANDS)} / ${SESSION_HANDS} 手` : `第 ${game.handNo} 手`}</span>
        </div>
        <div className="header-actions">
          <button className={`sound-toggle ${soundOn ? "on" : ""}`} onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? "关闭牌桌音效" : "开启牌桌音效"}>
            <span>{soundOn ? "♪" : "—"}</span><b>音效</b><em>{soundOn ? "ON" : "OFF"}</em>
          </button>
          <button
            className={`training-toggle ${training && mode === "hand" ? "on" : ""}`}
            onClick={() => setTraining((value) => !value)}
            disabled={mode === "session"}
            title={mode === "session" ? "整局模式在第 20 手后统一点评" : undefined}
          >
            <span>{mode === "session" ? "赛后点评" : "训练提示"}</span><b>{mode === "session" ? "LOCK" : training ? "ON" : "OFF"}</b>
          </button>
          <button className="icon-button" aria-label="查看游戏说明" onClick={() => setInfoOpen(true)}>?</button>
        </div>
      </header>

      <div className="workspace">
        <section className="table-zone">
          <div className="table-toolbar">
            <div className="mode-switch" aria-label="训练模式">
              <button className={mode === "hand" ? "active" : ""} aria-pressed={mode === "hand"} onClick={() => switchMode("hand")}>
                <b>单手训练</b><span>每手结束立即点评</span>
              </button>
              <button className={mode === "session" ? "active" : ""} aria-pressed={mode === "session"} onClick={() => switchMode("session")}>
                <b>20 手整局</b><span>结束后统一点评</span>
              </button>
            </div>
            {mode === "session" && <div className="session-progress"><i style={{ width: `${completedHands / SESSION_HANDS * 100}%` }} /><span>{completedHands}/{SESSION_HANDS}</span></div>}
          </div>
          <div className="ambient ambient-one" />
          <div className="ambient ambient-two" />
          <div className="poker-table">
            <div className="table-rail" />
            <div className="table-felt">
              <div className="felt-grain" />
              <div className="pot-display">
                <span>底池</span>
                <strong><i />{committedPot(game)}</strong>
              </div>
              <div className="community-cards">
                {[0, 1, 2, 3, 4].map((index) => {
                  const newlyDealt = index >= game.dealFrom && index < game.dealFrom + game.dealCount;
                  return (
                    <PlayingCard
                      key={index}
                      card={game.community[index]}
                      ghost={!game.community[index]}
                      dealDelay={newlyDealt ? (index - game.dealFrom) * 300 : undefined}
                    />
                  );
                })}
              </div>
              <div className="table-signature">RANGECRAFT <span>◆</span> TRAINING CLUB</div>
            </div>
            {game.players.map((player, index) => <PlayerSeat key={player.id} player={player} game={game} index={index} thinking={thinking} revealReady={!dealing} />)}
          </div>

          <div className={`action-dock ${isHumanTurn ? "active" : ""} ${dealing ? "is-dealing" : ""} ${handFinished ? "hand-ended" : ""}`}>
            {handFinished ? (
              <div className="hand-end-dock">
                <div className="hand-end-copy">
                  <span>{mode === "session" ? `整局进度 ${Math.min(game.handNo, SESSION_HANDS)}/${SESSION_HANDS}` : "本手结束"}</span>
                  <strong>{game.result}</strong>
                  {showDecisionPending && <p>要公开这两张手牌来塑造桌上形象吗？AI 会记住你的选择。</p>}
                </div>
                {showDecisionPending ? (
                  <div className="show-choice">
                    <button className="show-cards" onClick={() => chooseHeroShow(true)}>亮出手牌</button>
                    <button className="muck-cards" onClick={() => chooseHeroShow(false)}>盖牌</button>
                  </div>
                ) : mode === "session" && game.handNo >= SESSION_HANDS ? (
                  <button className="next-hand-button" onClick={() => setShowLog(true)}>查看整局复盘</button>
                ) : (
                  <button className="next-hand-button" onClick={startNextHand}>下一手 <kbd>N</kbd></button>
                )}
              </div>
            ) : (
              <>
                <div className="turn-summary">
                  <div>
                    <span>{dealing ? "正在发牌" : isHumanTurn ? "轮到你行动" : game.status === "showdown" ? "等待摊牌" : "对手思考中"}</span>
                    <strong>{STREET_LABELS[game.street]}</strong>
                  </div>
                  {isHumanTurn && <div className="timer-ring"><span>∞</span></div>}
                </div>
                <div className="primary-actions">
                  <button className="action-button fold" onClick={() => handleAction("fold")} disabled={!isHumanTurn}>弃牌 <kbd>F</kbd></button>
                  {toCall === 0 ? (
                    <button className="action-button neutral" onClick={() => handleAction("check")} disabled={!isHumanTurn}>过牌 <kbd>C</kbd></button>
                  ) : (
                    <button className="action-button neutral" onClick={() => handleAction("call")} disabled={!isHumanTurn}>跟注 {toCall} <kbd>C</kbd></button>
                  )}
                  <button className="action-button raise" onClick={() => handleAction("raise")} disabled={raiseDisabled} title={human.raiseLocked ? "不足额全下未重新开放加注权" : undefined}>加注至 {raiseTo} <kbd>R</kbd></button>
                </div>
                <div className="raise-control">
                  <div className="range-row">
                    <span>{minTarget}</span>
                    <input
                      aria-label="加注金额"
                      type="range"
                      min={Math.max(0, minTarget)}
                      max={Math.max(minTarget, maxTarget)}
                      step={BIG_BLIND}
                      value={Math.min(Math.max(raiseTo, minTarget), Math.max(minTarget, maxTarget))}
                      onChange={(event) => setRaiseTo(Number(event.target.value))}
                      disabled={raiseDisabled}
                    />
                    <span>{maxTarget}</span>
                  </div>
                  <div className="quick-bets">
                    {[0.33, 0.5, 0.75, 1].map((ratio) => (
                      <button key={ratio} disabled={raiseDisabled} onClick={() => setRaiseTo(Math.min(maxTarget, Math.max(minTarget, Math.round((game.highestBet + committedPot(game) * ratio) / 10) * 10)))}>
                        {ratio === 1 ? "底池" : `${Math.round(ratio * 100)}%`}
                      </button>
                    ))}
                    <button disabled={raiseDisabled} onClick={() => setRaiseTo(maxTarget)}>全下</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <aside className="coach-panel">
          <div className="coach-heading">
            <div><span>AI COACH</span><h2>决策实验室</h2></div>
            <div className="score-badge">
              <strong>{mode === "session" && !sessionEnded ? "—" : reportScore}</strong>
              <span>{mode === "session" ? sessionEnded ? "整局匹配度" : "赛后评分" : "本手匹配度"}</span>
            </div>
          </div>

          <div className="tabs" role="tablist">
            <button className={!showLog ? "active" : ""} onClick={() => setShowLog(false)}>{mode === "session" ? "整局进行中" : "实时教练"}</button>
            <button className={showLog ? "active" : ""} onClick={() => setShowLog(true)} aria-disabled={!reviewUnlocked}>
              {mode === "session" ? `整局复盘 · ${completedHands}/${SESSION_HANDS}` : `本手复盘${reviewUnlocked ? " · 已解锁" : ""}`}
            </button>
          </div>

          {!showLog ? mode === "session" ? (
            <div className="analysis-content session-live">
              <section className="session-lock">
                <div className="lock-orbit">◇</div>
                <span>SESSION REVIEW LOCKED</span>
                <h3>答案留到第 20 手之后</h3>
                <p>整局模式不显示实时胜率、推荐动作、决策分数和对手类型，避免答案影响你的下一次判断。</p>
                <div className="session-progress-card">
                  <div><b>{completedHands}</b><span>已完成</span></div>
                  <i><em style={{ width: `${completedHands / SESSION_HANDS * 100}%` }} /></i>
                  <strong>{SESSION_HANDS}</strong>
                </div>
              </section>
              <section className="public-state">
                <div className="section-label"><span>公开牌局状态</span><small>不含策略提示</small></div>
                <div className="metric-grid">
                  <div><span>当前底池</span><strong>{committedPot(game)}</strong></div>
                  <div><span>你的筹码</span><strong>{human.stack}</strong></div>
                  <div><span>当前街</span><strong>{STREET_LABELS[game.street]}</strong></div>
                </div>
              </section>
              <section className="locked-profile">
                <span>◇</span>
                <div><b>桌上形象正在形成</b><p>AI 会根据你的松紧、侵略性和亮牌行为调整应对；具体画像只在整局结束后公开。</p></div>
              </section>
            </div>
          ) : (
            <div className="analysis-content">
              <section className="equity-card">
                <div className="section-label"><span>牌面概览</span><b>{isHumanTurn ? "LIVE" : "WAIT"}</b></div>
                <div className="equity-main">
                  <div className="equity-number"><strong>{isHumanTurn ? Math.round(equity * 100) : "—"}</strong><span>%<br />估算胜率</span></div>
                  <div className="equity-bars">
                    <span><i style={{ width: `${isHumanTurn ? equity * 100 : 0}%` }} /></span>
                    <div><b>你的范围</b><em>{human.hole.map(cardText).join("  ")}</em></div>
                  </div>
                </div>
                <div className="metric-grid">
                  <div><span>底池赔率</span><strong>{isHumanTurn && advice ? `${Math.round(advice.potOdds * 100)}%` : "—"}</strong></div>
                  <div><span>有效筹码</span><strong>{Math.min(...game.players.filter((p) => !p.folded).map((p) => p.stack)) / BIG_BLIND} BB</strong></div>
                  <div><span>SPR</span><strong>{(human.stack / Math.max(1, committedPot(game))).toFixed(1)}</strong></div>
                </div>
              </section>

              <section className={`coach-callout ${training && isHumanTurn ? "visible" : "muted"}`}>
                <div className="coach-icon">◆</div>
                <div>
                  <span>近似 GTO 建议</span>
                  <h3>{training && isHumanTurn && advice ? `优先考虑 · ${ACTION_LABELS[advice.action]}` : training ? "等待你的行动点" : "训练提示已关闭"}</h3>
                  <p>{training && isHumanTurn && advice ? `${advice.mix}。${advice.note}` : training ? "AI 行动结束后，这里会给出范围、赔率与混合频率参考。" : "关闭提示时仍会记录你的决策，方便牌后复盘。"}</p>
                </div>
              </section>

              {feedback ? (
                <section className="last-decision">
                  <div className="decision-top"><span>上一决策</span><b className={feedback.score >= 85 ? "good" : feedback.score >= 65 ? "ok" : "bad"}>{feedback.score} 分</b></div>
                  <h3>{feedback.score >= 85 ? "线路漂亮，继续保持" : feedback.score >= 65 ? "可执行，但有更优选择" : "这里值得重点复盘"}</h3>
                  <p>你选择了{feedback.action}。参考混合：{feedback.mix}。{feedback.note}</p>
                </section>
              ) : (
                <section className="last-decision empty-decision"><span>完成第一个决策后，这里会出现即时反馈。</span></section>
              )}

              <section className="opponent-grid">
                <div className="section-label"><span>对手画像</span><small>牌后解锁</small></div>
                <div className="locked-profile">
                  <span>◇</span>
                  <div><b>本手保持未知</b><p>结束后进入“本手复盘”，再查看每位电脑的策略倾向。</p></div>
                </div>
              </section>
            </div>
          ) : !reviewUnlocked ? (
            <div className="log-content review-pending">
              <section className="session-lock compact">
                <div className="lock-orbit">◇</div>
                <span>REVIEW LOCKED</span>
                <h3>{showDecisionPending ? "请先选择亮牌或盖牌" : mode === "session" ? `还需完成 ${SESSION_HANDS - completedHands} 手` : "本手尚未结束"}</h3>
                <p>{showDecisionPending ? "完成本手的展示决策后再生成报告，避免复盘信息影响你的选择。" : mode === "session" ? "整局结束后一次生成完整报告，不显示中途答案、分数和对手类型。" : "牌局结束后会自动生成这手牌的决策点评。"}</p>
                <button onClick={() => setShowLog(false)}>回到牌桌</button>
              </section>
            </div>
          ) : (
            <div className="log-content">
              <div className="review-summary unlocked">
                <div>
                  <span>{mode === "session" ? "20 手整局报告已生成" : "本手复盘已生成"}</span>
                  <h3>{mode === "session" ? `${SESSION_HANDS} 手 · ${review.length} 个决策节点` : `第 ${game.handNo} 手 · ${STREET_LABELS[game.street]}`}</h3>
                </div>
                <strong>{reportScore}<small>{reportReview.length ? "策略匹配度" : "暂无决策"}</small></strong>
              </div>

              {mode === "session" && (
                <>
                  <div className="session-stats">
                    <div><span>完成手数</span><strong>{sessionResults.length}/{SESSION_HANDS}</strong></div>
                    <div><span>当前筹码</span><strong>{human.stack}</strong></div>
                    <div><span>AI 眼中的松紧</span><strong>{imageLabel(heroImage.loose, "偏紧", "均衡", "偏松")}</strong></div>
                    <div><span>AI 眼中的风格</span><strong>{imageLabel(heroImage.aggressive, "偏被动", "均衡", "偏激进")}</strong></div>
                  </div>
                  <div className="session-hand-list">
                    <div className="section-label"><span>逐手结果</span><small>低于 1 BB 自动补充筹码</small></div>
                    {[...sessionResults].sort((a, b) => a.hand - b.hand).map((item) => (
                      <div key={item.hand}>
                        <span>{String(item.hand).padStart(2, "0")}</span>
                        <p><b>{item.heroCards}</b><small>{item.result}</small></p>
                        <em>{item.score ?? "—"}<small>{item.decisions ? "分" : "无决策"}</small></em>
                      </div>
                    ))}
                  </div>
                  <div className="street-breakdown">
                    <div className="section-label"><span>分街表现</span><small>启发式匹配度</small></div>
                    {streetScores.map((item) => <div key={item.street}><span>{item.street}</span><i><em style={{ width: `${item.score ?? 0}%` }} /></i><strong>{item.score ?? "—"}</strong></div>)}
                  </div>
                </>
              )}

              <div className="review-log">
                <div className="section-label"><span>{mode === "session" ? "整局决策路径" : "你的决策路径"}</span><small>{reportReview.length} 个节点</small></div>
                {reportReview.length ? reportReview.map((item) => (
                  <div className="review-row" key={item.id}>
                    <span className={item.score >= 85 ? "good" : item.score >= 65 ? "ok" : "bad"}>{item.score}</span>
                    <div>
                      <b>{mode === "session" ? `第 ${item.hand} 手 · ` : ""}{item.street} · 手牌 {item.cards}</b>
                      <p>公共牌 {item.board} · 底池 {item.pot} · 面对 {item.toCall}</p>
                      <p>你的选择：{item.action}；最高频线路：{item.recommended}</p>
                      <p>参考混合：{item.mix}</p>
                      <small>估算胜率 {Math.round(item.equity * 100)}% / 所需赔率 {Math.round(item.potOdds * 100)}% · {item.note}</small>
                    </div>
                  </div>
                )) : <p className="empty-log">这段练习没有记录到你的决策节点。</p>}
              </div>

              <div className="opponent-review">
                <div className="section-label"><span>对手策略画像</span><small>复盘时公开</small></div>
                <div className="profile-list revealed">
                  {game.players.slice(1).map((player) => (
                    <div key={player.id}>
                      <span className={`profile-dot p-${player.id}`} />
                      <b>{player.name}</b>
                      <em><strong>{player.style}</strong>{AI_REVIEW_NOTES[player.styleKey as keyof typeof AI_PROFILES]}</em>
                    </div>
                  ))}
                </div>
              </div>

              {mode === "hand" && (
                <div className="hand-log">
                  <div className="section-label"><span>整手行动线</span><small>{game.log.length} 个事件</small></div>
                  {game.log.map((line, index) => <div key={`${line}-${index}`}><time>{String(game.log.length - index).padStart(2, "0")}</time><p>{line}</p></div>)}
                </div>
              )}
            </div>
          )}

          <footer className="coach-footer">
            <span><i /> 本地混合频率引擎</span>
            <button onClick={() => setInfoOpen(true)}>关于 GTO 边界 ↗</button>
          </footer>
        </aside>
      </div>

      {infoOpen && (
        <div className="modal-backdrop">
          <section className="info-modal" role="dialog" aria-modal="true" aria-labelledby="info-title">
            <button className="modal-close" onClick={() => setInfoOpen(false)} aria-label="关闭">×</button>
            <span className="eyebrow">ABOUT THE LAB</span>
            <h2 id="info-title">更强的混合频率对手，<br />但不冒充“完整 GTO”。</h2>
            <p>当前本地引擎综合 Monte Carlo 胜率、底池赔率、位置、听牌、阻断牌、下注尺度与价值/诈唬频率，并根据你的公开行动和亮牌选择调整应对。评分是策略匹配度，不是求解器计算出的精确 EV 损失。</p>
            <div className="modal-grid">
              <div><b>两种训练</b><span>单手模式逐手点评；20 手整局模式隐藏答案，最后统一复盘。</span></div>
              <div><b>完整 GTO 的边界</b><span>任意 6 人动态牌局需要预计算策略库或外部求解服务；现有传输接口可在后续接入。</span></div>
              <div><b>形象博弈</b><span>你和 AI 都可选择亮牌或盖牌；AI 会用可见信息形成对你的松紧、侵略性与欺骗性判断。</span></div>
              <div><b>规则范围</b><span>6 人现金桌、边池、全下跑牌与不足额全下加注权均在本地处理。</span></div>
            </div>
            <button className="modal-primary" onClick={() => setInfoOpen(false)}>回到牌桌</button>
          </section>
        </div>
      )}
    </main>
  );
}
