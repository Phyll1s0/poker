"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AI_PROFILES, sampleAiLineup } from "../lib/poker-ai";
import { playPokerSound, setPokerAudioEnabled, unlockPokerAudio } from "../lib/poker-audio";
import {
  bestHand,
  blockerValue,
  drawPotential,
  estimateEquity,
  preflopPercentile,
  preflopStrength,
} from "../lib/poker-evaluator";
import {
  choosePokerPolicyAction,
  evaluatePokerPolicy,
  sixMaxPreflopPositionFactor,
  type PokerPolicyInput,
  type PokerPolicyProfile,
} from "../lib/poker-policy";
import { createPublicOpponentRanges, type PublicBettingAction } from "../lib/poker-range";
import {
  buildPokerSizingRoutes,
  formatPokerSizingRoute,
  legalPokerRaiseTarget,
  pokerRaiseFraction,
  pokerRaiseSizeVerdict,
  pokerRaiseTargetForFraction,
  pokerSizingMaxTarget,
  preferredPokerSizingRoute,
  roundedPokerRaiseTarget,
  scorePokerRaiseSize,
  type PokerSizingContext,
} from "../lib/poker-sizing";
import { settleSquidRound, squidMultiplier } from "../lib/poker-squid";

type Suit = "♠" | "♥" | "♦" | "♣";
type Street = "preflop" | "flop" | "turn" | "river";
type ActionKind = "fold" | "check" | "call" | "raise";
type GameMode = "hand" | "session";
type TablePresetKey = "short" | "standard" | "deep" | "squid";
type TableImage = { loose: number; aggressive: number; deceptive: number };
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const APP_BASE_PATH = import.meta.env.BASE_URL || "/";
const ONLINE_MULTIPLAYER_URL = "https://rangecraft-poker-trainer.pigstd.chatgpt.site/multiplayer";

type PortalView = "landing" | "solo";

function multiplayerEntryHref() {
  return APP_BASE_PATH === "/" ? "/multiplayer" : ONLINE_MULTIPLAYER_URL;
}

function portalViewFromHash(hash: string): PortalView {
  return hash === "#/solo" || hash === "#solo" ? "solo" : "landing";
}

type SquidState = {
  round: number;
  total: number;
  remaining: number;
  counts: number[];
  bounty: number;
  settled: boolean;
  lastSettlement: string;
};

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
  presetKey: TablePresetKey;
  startingStack: number;
  cashInvested: number[];
  squid: SquidState;
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
  raiseCount: number;
  winnerIds: number[];
  endedUncontested: boolean;
  shownPlayerIds: number[];
  showChoiceMade: boolean;
  handNo: number;
  status: "playing" | "showdown";
  result: string;
  log: string[];
  actionHistory: PublicBettingAction[];
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
  actionKind: ActionKind;
  actualRaiseTo: number | null;
  actualBetFraction: number | null;
  recommended: string;
  recommendedAction: ActionKind;
  recommendedRaiseTo: number | null;
  recommendedBetFraction: number | null;
  mix: string;
  sizingMix: string;
  sizeScore: number | null;
  sizeVerdict: string;
  score: number;
  note: string;
};

type SessionHandResult = {
  hand: number;
  result: string;
  heroStack: number;
  heroCashInvested: number;
  heroNet: number;
  score: number | null;
  decisions: number;
  heroCards: string;
};

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SMALL_BLIND = 5;
const BIG_BLIND = 10;
const SESSION_HANDS = 20;
const COACH_PROFILE: PokerPolicyProfile = { aggression: 0.62, looseness: 0.3, bluff: 0.16 };

const TABLE_PRESETS: Record<TablePresetKey, {
  label: string;
  shortLabel: string;
  description: string;
  stackBb: number;
  squid: boolean;
}> = {
  short: { label: "浅筹现金 · 40 BB", shortLabel: "浅筹 40BB", description: "更频繁面对全下与低 SPR 决策", stackBb: 40, squid: false },
  standard: { label: "标准现金 · 100 BB", shortLabel: "标准 100BB", description: "常规六人桌训练深度", stackBb: 100, squid: false },
  deep: { label: "深筹现金 · 200 BB", shortLabel: "深筹 200BB", description: "更多转牌、河牌与大底池决策", stackBb: 200, squid: false },
  squid: { label: "血战鱿鱼 · 200 BB", shortLabel: "血战鱿鱼", description: "9 条鱿鱼 · 基础价值 5 BB", stackBb: 200, squid: true },
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
  { name: "ATLAS", monogram: "AT", style: "松凶压迫", styleKey: "lag" as const, isHuman: false },
  { name: "IVY", monogram: "IV", style: "紧凶价值", styleKey: "tag" as const, isHuman: false },
  { name: "MIRA", monogram: "MI", style: "动态适应", styleKey: "adaptive" as const, isHuman: false },
  { name: "NOVA", monogram: "NV", style: "稳健保守", styleKey: "nit" as const, isHuman: false },
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

function currentEquity(game: Game, player: Player, iterations = 80): number {
  const community = game.street === "preflop" ? [] : game.community;
  const opponents = createPublicOpponentRanges({
    players: game.players,
    viewerId: player.id,
    community,
    actions: game.actionHistory,
    bigBlind: BIG_BLIND,
    positionFactor: (playerId) => sixMaxPreflopPositionFactor(playerId, game.dealer),
  });
  if (!opponents.length) return 1;
  return estimateEquity(player.hole, community, {
    opponents: opponents.length,
    iterations: game.street === "preflop" ? Math.max(48, iterations) : iterations,
    opponentRanges: opponents.map((opponent) => opponent.weight),
  });
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

function visibleHandStrength(player: Player, community: Card[]) {
  if (community.length + player.hole.length < 5) return preflopStrength(player.hole);
  const category = bestHand([...player.hole, ...community]).category;
  return clamp(category / 7 + Math.max(...player.hole.map((card) => card.rank)) / 140, 0, 1);
}

function pokerSizingContext(game: Game, player: Player): PokerSizingContext {
  return {
    street: game.street,
    pot: committedPot(game),
    toCall: Math.max(0, game.highestBet - player.bet),
    highestBet: game.highestBet,
    playerBet: player.bet,
    playerStack: player.stack,
    minRaise: game.minRaise,
    bigBlind: BIG_BLIND,
    preflopRaiseCount: game.raiseCount,
  };
}

function isPlayerInPosition(game: Game, player: Player) {
  if (game.street === "preflop") return player.id === game.dealer;
  const activePlayers = game.players.filter((candidate) => !candidate.folded && candidate.stack > 0);
  const actionOrderRank = (candidate: Player) => {
    const offset = (candidate.id - game.dealer + game.players.length) % game.players.length;
    return offset === 0 ? game.players.length : offset;
  };
  const lastPostflopActor = [...activePlayers]
    .sort((left, right) => actionOrderRank(left) - actionOrderRank(right))
    .at(-1);
  return lastPostflopActor?.id === player.id;
}

function playerSquidPressure(game: Game, player: Player) {
  if (game.presetKey !== "squid") return 0;
  const squidCount = game.squid.counts[player.id] ?? 0;
  const squidProgress = game.squid.total ? 1 - game.squid.remaining / game.squid.total : 0;
  const nextSquidHitsMultiplier = squidCount === 2 || squidCount === 4 || squidCount === 6;
  return squidCount === 0 ? 0.035 + squidProgress * 0.07 : nextSquidHitsMultiplier ? 0.055 : 0.018;
}

function buildPokerPolicyInput(
  game: Game,
  player: Player,
  equity: number,
  profile: PokerPolicyProfile,
): PokerPolicyInput {
  const context = pokerSizingContext(game, player);
  const opponentStacks = game.players
    .filter((candidate) => !candidate.folded && candidate.id !== player.id)
    .map((candidate) => candidate.stack);
  const effectiveStack = Math.min(player.stack, Math.max(0, ...opponentStacks));
  return {
    profile,
    street: game.street,
    equity,
    handStrength: game.street === "preflop" ? preflopStrength(player.hole) : visibleHandStrength(player, game.community),
    draw: drawPotential(player.hole, game.community),
    blockers: blockerValue(player.hole, game.community),
    pot: context.pot,
    toCall: context.toCall,
    potOdds: context.toCall > 0 ? context.toCall / (context.pot + context.toCall) : 0,
    inPosition: isPlayerInPosition(game, player),
    activeOpponents: game.players.filter((candidate) => !candidate.folded && candidate.id !== player.id).length,
    effectiveStackBb: effectiveStack / BIG_BLIND,
    startingDepthBb: game.startingStack / BIG_BLIND,
    highestBet: game.highestBet,
    playerBet: player.bet,
    playerStack: player.stack,
    minRaise: game.minRaise,
    raiseLocked: player.raiseLocked,
    squidPressure: playerSquidPressure(game, player),
    bigBlind: BIG_BLIND,
    preflopPercentile: preflopPercentile(player.hole),
    preflopPositionFactor: sixMaxPreflopPositionFactor(player.id, game.dealer),
    preflopRaiseCount: game.raiseCount,
  };
}

function aiWantsToShow(player: Player, game: Game) {
  if (player.isHuman) return false;
  if (game.presetKey === "squid" && game.squid.remaining > 0) {
    const alreadyHasSquid = game.squid.counts[player.id] > 0;
    return Math.random() < (alreadyHasSquid ? 0.76 : 0.94);
  }
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

function grantSquid(game: Game, players: Player[], winnerId: number) {
  if (game.presetKey !== "squid" || game.squid.remaining <= 0) {
    return { players, cashInvested: game.cashInvested, squid: game.squid, message: "" };
  }

  const counts = [...game.squid.counts];
  counts[winnerId] += 1;
  const remaining = game.squid.remaining - 1;
  const winner = players[winnerId];
  let nextPlayers = players;
  let cashInvested = [...game.cashInvested];
  let message = `${winner.name} 获得 1 条鱿鱼（共 ${counts[winnerId]} 条）`;
  let settled = false;
  let lastSettlement = "";

  if (remaining === 0) {
    settled = true;
    const payers = players.filter((player) => counts[player.id] === 0);
    const holders = players.filter((player) => counts[player.id] > 0);
    if (payers.length === 0) {
      lastSettlement = `第 ${game.squid.round} 轮结束 · 全桌都拿到过鱿鱼，无人支付`;
    } else {
      const settlement = settleSquidRound(players, counts, game.squid.bounty, cashInvested);
      nextPlayers = settlement.players;
      cashInvested = settlement.cashInvested;
      const holderSummary = holders
        .map((holder) => `${holder.name} +${(settlement.holderUnits.get(holder.id) ?? 0) * game.squid.bounty * payers.length}`)
        .join("、");
      lastSettlement = `第 ${game.squid.round} 轮结算 · ${payers.map((payer) => payer.name).join("、")} 每人支付 ${settlement.obligationPerPayer} · ${holderSummary}`;
    }
    message = `${message} · ${lastSettlement}`;
  }

  return {
    players: nextPlayers,
    cashInvested,
    squid: { ...game.squid, counts, remaining, settled, lastSettlement },
    message,
  };
}

function freshGame(
  previous?: Game,
  options: { resetStacks?: boolean; shuffleStyles?: boolean; presetKey?: TablePresetKey } = {},
): Game {
  const presetKey = options.presetKey ?? previous?.presetKey ?? "standard";
  const preset = TABLE_PRESETS[presetKey];
  const startingStack = preset.stackBb * BIG_BLIND;
  const deck = shuffle(makeDeck());
  const dealer = previous ? (previous.dealer + 1) % PLAYER_TEMPLATES.length : 0;
  const stacks = previous?.players.length && !options.resetStacks
    ? previous.players.map((player) => (player.stack < BIG_BLIND ? startingStack : player.stack))
    : PLAYER_TEMPLATES.map(() => startingStack);
  const cashInvested = previous?.players.length && !options.resetStacks
    ? previous.players.map((player, id) => (
        (previous.cashInvested[id] ?? previous.startingStack)
        + (player.stack < BIG_BLIND ? startingStack - player.stack : 0)
      ))
    : PLAYER_TEMPLATES.map(() => startingStack);
  const stylePool = options.shuffleStyles
    ? sampleAiLineup(PLAYER_TEMPLATES.length - 1)
    : previous?.players.length
      ? previous.players.slice(1).map(({ style, styleKey }) => ({ style, styleKey }))
      : sampleAiLineup(PLAYER_TEMPLATES.length - 1);
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
  const previousSquid = previous?.presetKey === "squid" ? previous.squid : undefined;
  const squid: SquidState = preset.squid
    ? previousSquid && !previousSquid.settled
      ? { ...previousSquid, counts: [...previousSquid.counts] }
      : {
          round: (previousSquid?.round ?? 0) + 1,
          total: PLAYER_TEMPLATES.length + 3,
          remaining: PLAYER_TEMPLATES.length + 3,
          counts: PLAYER_TEMPLATES.map(() => 0),
          bounty: BIG_BLIND * 5,
          settled: false,
          lastSettlement: "",
        }
    : {
        round: 0,
        total: 0,
        remaining: 0,
        counts: PLAYER_TEMPLATES.map(() => 0),
        bounty: 0,
        settled: false,
        lastSettlement: "",
      };
  return {
    presetKey,
    startingStack,
    cashInvested,
    squid,
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
    raiseCount: 0,
    winnerIds: [],
    endedUncontested: false,
    shownPlayerIds: [],
    showChoiceMade: true,
    handNo: (previous?.handNo ?? 0) + 1,
    status: "playing",
    result: "",
    log: [
      ...(rebought.length ? [`自动补充筹码：${rebought.join("、")} 回到 ${startingStack}`] : []),
      `第 ${(previous?.handNo ?? 0) + 1} 手开始 · ${preset.shortLabel} · 盲注 ${SMALL_BLIND}/${BIG_BLIND}`,
    ],
    actionHistory: [],
  };
}

function awardUncontested(game: Game, players: Player[]): Game {
  const winner = players.find((player) => !player.folded)!;
  const total = game.pot + players.reduce((sum, player) => sum + player.bet, 0);
  const finalPlayers = players.map((player) =>
    player.id === winner.id ? { ...player, stack: player.stack + total, bet: 0 } : { ...player, bet: 0 },
  );
  const aiShows = !winner.isHuman && aiWantsToShow(winner, game);
  const squidAward = !winner.isHuman && aiShows
    ? grantSquid(game, finalPlayers, winner.id)
    : { players: finalPlayers, cashInvested: game.cashInvested, squid: game.squid, message: "" };
  const result = `${winner.name} 收下底池 ${total}${aiShows ? " · 主动亮牌" : ""}${squidAward.message ? ` · ${squidAward.message}` : ""}`;
  return {
    ...game,
    players: squidAward.players,
    cashInvested: squidAward.cashInvested,
    squid: squidAward.squid,
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
  const mainWinnerIds = headlineWinners.map((entry) => entry.player.id);
  const squidAward = mainWinnerIds.length === 1
    ? grantSquid(game, finalPlayers, mainWinnerIds[0])
    : { players: finalPlayers, cashInvested: game.cashInvested, squid: game.squid, message: "" };
  const squidTieMessage = game.presetKey === "squid" && mainWinnerIds.length > 1 ? " · 主池平分，本手鱿鱼不发" : "";
  const result = `${headlineWinners.map((entry) => entry.player.name).join(" / ")} · ${headlineWinners[0]?.name ?? "胜出"} · 赢得 ${paid || total}${squidAward.message ? ` · ${squidAward.message}` : ""}${squidTieMessage}`;
  return {
    ...game,
    players: squidAward.players,
    cashInvested: squidAward.cashInvested,
    squid: squidAward.squid,
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
    raiseCount: 0,
    dealFrom,
    dealCount: community.length - dealFrom,
    log: [`进入${STREET_LABELS[nextStreet]} · 底池 ${game.pot + collected}`, ...game.log],
  };
}

function act(game: Game, playerId: number, kind: ActionKind, raiseTo?: number): Game {
  if (game.status !== "playing" || game.current !== playerId) return game;
  const players = game.players.map((player) => ({ ...player }));
  const player = players[playerId];
  const stackBefore = player.stack;
  const toCall = Math.max(0, game.highestBet - player.bet);
  let highestBet = game.highestBet;
  let minRaise = game.minRaise;
  let lastAggressor = game.lastAggressor;
  let raiseCount = game.raiseCount;
  let actionText = "";
  let resolvedKind: ActionKind | null = null;
  let amount = 0;

  if (kind === "fold") {
    player.folded = true;
    player.hasActed = true;
    actionText = `${player.name} 弃牌`;
    resolvedKind = "fold";
  } else if (kind === "check" && toCall === 0) {
    player.hasActed = true;
    actionText = `${player.name} 过牌`;
    resolvedKind = "check";
  } else if (kind === "call") {
    const paid = Math.min(toCall, player.stack);
    player.stack -= paid;
    player.bet += paid;
    player.contributed += paid;
    player.hasActed = true;
    actionText = paid < toCall ? `${player.name} 全下 ${paid}` : `${player.name} 跟注 ${paid}`;
    resolvedKind = "call";
    amount = paid;
  } else if (kind === "raise") {
    if (player.raiseLocked) return game;
    const target = legalPokerRaiseTarget(
      pokerSizingContext(game, player),
      raiseTo ?? game.highestBet + game.minRaise,
    );
    const paid = target - player.bet;
    const increase = target - game.highestBet;
    player.stack -= paid;
    player.bet = target;
    player.contributed += paid;
    player.hasActed = true;
    if (target > game.highestBet) {
      highestBet = target;
      lastAggressor = player.id;
      raiseCount += 1;
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
      resolvedKind = "raise";
      amount = paid;
    } else {
      actionText = `${player.name} 跟注 ${paid}`;
      resolvedKind = "call";
      amount = paid;
    }
  } else {
    return game;
  }

  const observedAction: PublicBettingAction = {
    playerId,
    street: game.street,
    kind: resolvedKind!,
    amount,
    toCall,
    stackBefore,
    isAllIn: resolvedKind !== "fold" && player.stack === 0,
    potBefore: committedPot(game),
    raiseCountBefore: game.raiseCount,
    activeOpponents: game.players.filter((candidate) => !candidate.folded && candidate.id !== playerId).length,
  };
  const withLog = {
    ...game,
    players,
    highestBet,
    minRaise,
    lastAggressor,
    raiseCount,
    log: [actionText, ...game.log],
    actionHistory: [...game.actionHistory, observedAction],
  };
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
  const facingHero = game.lastAggressor === 0;
  const heroCallAdjustment = facingHero
    ? (heroImage.deceptive - 0.5) * 0.14 + (heroImage.loose - 0.5) * 0.08 + (heroImage.aggressive - 0.5) * 0.12
    : 0;
  const effectiveEquity = clamp(equity + heroCallAdjustment, 0.02, 0.98);
  return choosePokerPolicyAction(buildPokerPolicyInput(game, player, effectiveEquity, profile));
}

function setHeroShowChoice(game: Game, show: boolean): Game {
  if (!game.endedUncontested || game.winnerIds[0] !== 0 || game.showChoiceMade) return game;
  const text = show ? "你选择亮出手牌" : "你选择盖牌";
  const squidAward = show
    ? grantSquid(game, game.players, 0)
    : { players: game.players, cashInvested: game.cashInvested, squid: game.squid, message: "" };
  return {
    ...game,
    players: squidAward.players,
    cashInvested: squidAward.cashInvested,
    squid: squidAward.squid,
    shownPlayerIds: show ? [...new Set([...game.shownPlayerIds, 0])] : game.shownPlayerIds,
    showChoiceMade: true,
    result: `${game.result} · 你选择${show ? "亮牌" : "盖牌"}${squidAward.message ? ` · ${squidAward.message}` : ""}`,
    log: [squidAward.message ? `${text} · ${squidAward.message}` : text, ...game.log],
  };
}

function getAdvice(game: Game, player: Player, equity: number) {
  const toCall = Math.max(0, game.highestBet - player.bet);
  const pot = committedPot(game);
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const sizingContext = pokerSizingContext(game, player);
  const policyPlan = evaluatePokerPolicy(buildPokerPolicyInput(game, player, equity, COACH_PROFILE));
  const squidCount = game.squid.counts[player.id] ?? 0;
  const squidProgress = game.squid.total ? 1 - game.squid.remaining / game.squid.total : 0;
  const squidIncentive = game.presetKey === "squid"
    ? squidCount === 0 ? 0.035 + squidProgress * 0.065 : (squidCount === 2 || squidCount === 4 || squidCount === 6) ? 0.05 : 0.015
    : 0;
  const startingDepthBb = game.startingStack / BIG_BLIND;
  const depthThreshold = startingDepthBb <= 45 ? -0.025 : startingDepthBb >= 180 ? 0.018 : 0;
  const decisionEquity = clamp(equity + squidIncentive, 0, 1);
  const strategyStrength = (game.street === "preflop"
    ? equity * 0.35 + preflopStrength(player.hole) * 0.65
    : equity) + squidIncentive;
  let action: ActionKind;
  let note: string;
  if (toCall > 0 && decisionEquity < potOdds - 0.045) {
    action = "fold";
    note = `按对手行动范围估算胜率约 ${Math.round(equity * 100)}%，低于跟注所需 ${Math.round(potOdds * 100)}%。控制负 EV 跟注。`;
  } else if (!player.raiseLocked && strategyStrength > (toCall > 0 ? 0.57 : 0.51) + depthThreshold) {
    action = "raise";
    note = `按对手行动范围估算胜率约 ${Math.round(equity * 100)}%，具备价值下注或保护范围的空间。`;
  } else {
    action = toCall > 0 ? "call" : "check";
    note = player.raiseLocked
      ? `前面的不足额全下没有重新开放加注权；当前只能跟注或弃牌。范围胜率约 ${Math.round(equity * 100)}%。`
      : toCall > 0
      ? `底池赔率需要 ${Math.round(potOdds * 100)}%，当前范围胜率 ${Math.round(equity * 100)}%，继续范围合理。`
      : `中等牌力适合控制底池，保留对手的诈唬范围。`;
  }
  if (game.presetKey === "squid") {
    note += squidCount === 0
      ? ` 你还没有鱿鱼，越接近发完，争夺主池的附加价值越高。`
      : ` 你已有 ${squidCount} 条鱿鱼，当前倍率为 ×${squidMultiplier(squidCount)}。`;
  }
  if (game.presetKey === "short") {
    note += ` 当前为 40 BB 浅筹，低 SPR 下强成牌与高权益听牌可以更早进入承诺线。`;
  } else if (game.presetKey === "deep" || game.presetKey === "squid") {
    note += ` 当前为 200 BB 深筹，边缘成牌要控制大底池，坚果优势与位置价值更高。`;
  }
  const frequencies: Record<ActionKind, number> = { fold: 0, check: 0, call: 0, raise: 0 };
  if (toCall > 0) {
    if (action === "fold") Object.assign(frequencies, { fold: 0.72, call: player.raiseLocked ? 0.28 : 0.24, raise: player.raiseLocked ? 0 : 0.04 });
    else if (action === "raise") Object.assign(frequencies, { fold: 0.02, call: 0.38, raise: 0.6 });
    else Object.assign(frequencies, { fold: 0.12, call: player.raiseLocked ? 0.88 : 0.68, raise: player.raiseLocked ? 0 : 0.2 });
  } else if (action === "raise") Object.assign(frequencies, { check: 0.36, raise: 0.64 });
  else Object.assign(frequencies, { check: 0.7, raise: player.raiseLocked ? 0 : 0.3 });
  if (squidIncentive > 0) {
    const shift = Math.min(frequencies.fold, 0.05 + squidIncentive * 0.4);
    frequencies.fold -= shift;
    if (toCall > 0) {
      frequencies.call += player.raiseLocked ? shift : shift * 0.65;
      if (!player.raiseLocked) frequencies.raise += shift * 0.35;
    } else if (!player.raiseLocked) {
      const pressureShift = Math.min(frequencies.check, 0.04 + squidIncentive * 0.35);
      frequencies.check -= pressureShift;
      frequencies.raise += pressureShift;
    }
  }
  const labels: Record<ActionKind, string> = { fold: "弃牌", check: "过牌", call: "跟注", raise: "加注" };
  const mix = (Object.entries(frequencies) as [ActionKind, number][])
    .filter(([, frequency]) => frequency > 0)
    .map(([kind, frequency]) => `${labels[kind]} ${Math.round(frequency * 100)}%`)
    .join(" · ");
  const sizingRoutes = frequencies.raise > 0 && !player.raiseLocked
    ? buildPokerSizingRoutes(sizingContext, policyPlan.raiseTo, policyPlan.shortStackJamFrequency)
    : [];
  const sizingMix = sizingRoutes
    .map((route) => `${formatPokerSizingRoute(sizingContext, route)} ${Math.round(route.frequency * 100)}%`)
    .join(" · ");
  const preferredSizingRoute = preferredPokerSizingRoute(sizingRoutes);
  const recommendedRaiseTo = preferredSizingRoute?.target ?? null;
  const recommendedBetFraction = preferredSizingRoute?.fraction ?? null;
  const recommendedLabel = action === "raise" && preferredSizingRoute
    ? formatPokerSizingRoute(sizingContext, preferredSizingRoute)
    : ACTION_LABELS[action];
  return {
    action,
    note,
    potOdds,
    frequencies,
    mix,
    sizingContext,
    sizingRoutes,
    sizingMix,
    recommendedRaiseTo,
    recommendedBetFraction,
    recommendedLabel,
  };
}

const ACTION_LABELS: Record<ActionKind, string> = { fold: "弃牌", check: "过牌", call: "跟注", raise: "加注" };

function isSessionComplete(game: Game) {
  return game.presetKey === "squid" ? game.squid.settled : game.handNo >= SESSION_HANDS;
}

function buildSessionHandResult(game: Game, review: Review[]): SessionHandResult {
  const decisions = review.filter((item) => item.hand === game.handNo);
  const score = decisions.length
    ? Math.round(decisions.reduce((sum, item) => sum + item.score, 0) / decisions.length)
    : null;
  const heroStack = game.players[0].stack;
  const heroCashInvested = game.cashInvested[0];
  return {
    hand: game.handNo,
    result: game.result,
    heroStack,
    heroCashInvested,
    heroNet: heroStack - heroCashInvested,
    score,
    decisions: decisions.length,
    heroCards: game.players[0].hole.map(cardText).join(" "),
  };
}

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
        {game.presetKey === "squid" && (
          <div className={`squid-seat-badge ${game.squid.counts[player.id] > 0 ? "has-squid" : ""}`} title={`${player.name} 已获得 ${game.squid.counts[player.id]} 条鱿鱼`}>
            <span>🦑</span><b>{game.squid.counts[player.id]}</b>
          </div>
        )}
      </div>
      {player.bet > 0 && <div className="table-bet"><i />{player.bet}</div>}
      {thinking && isCurrent && <div className="thinking"><b /><b /><b /></div>}
      {player.folded && <div className="fold-label">已弃牌</div>}
    </div>
  );
}

function WinningHands({ game }: { game: Game }) {
  if (game.status !== "showdown" || game.winnerIds.length === 0) return null;

  const winners = game.winnerIds
    .map((winnerId) => game.players.find((player) => player.id === winnerId))
    .filter((player): player is Player => Boolean(player));

  if (winners.length === 0) return null;

  return (
    <section className="winning-hands" aria-label="本手赢家手牌">
      <div className="winning-hands-heading">
        <span>WINNING HAND</span>
        <strong>赢家手牌</strong>
      </div>
      <div className="winning-hand-list">
        {winners.map((player) => {
          const publiclyShown = game.shownPlayerIds.includes(player.id);
          const visibleToHero = player.isHuman || publiclyShown;
          const cards = [...player.hole, ...game.community];
          const handName = !game.endedUncontested && cards.length >= 5 ? bestHand(cards).name : "未摊牌赢池";
          return (
            <article className="winning-hand" key={player.id}>
              <div className="winning-hand-player">
                <strong>{player.name}</strong>
                <span>{visibleToHero ? handName : "手牌未公开"}</span>
                {player.isHuman && !publiclyShown && <em>仅你可见</em>}
              </div>
              {visibleToHero ? (
                <div className="winning-hand-cards" aria-label={`${player.name} 的赢家手牌`}>
                  {player.hole.map((card) => <PlayingCard key={cardKey(card)} card={card} />)}
                </div>
              ) : (
                <div className="winning-hand-hidden" aria-label={`${player.name} 选择盖牌`}>
                  <span /><span /><b>已盖牌</b>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SquidScoreboard({ game, report = false }: { game: Game; report?: boolean }) {
  if (game.presetKey !== "squid") return null;
  return (
    <section className={`squid-scoreboard ${report ? "is-report" : ""}`}>
      <div className="section-label">
        <span>血战鱿鱼计分</span>
        <small>公开附加赛 · 第 {game.squid.round} 轮</small>
      </div>
      <div className="squid-score-meta">
        <div><span>待争夺</span><strong>{game.squid.remaining}<small> / {game.squid.total}</small></strong></div>
        <div><span>基础价值</span><strong>{game.squid.bounty / BIG_BLIND}<small> BB</small></strong></div>
        <div><span>倍率门槛</span><strong>3 / 5 / 7<small> 条</small></strong></div>
      </div>
      <div className="squid-count-grid">
        {game.players.map((player) => {
          const count = game.squid.counts[player.id] ?? 0;
          return (
            <div className={count > 0 ? "has-squid" : ""} key={player.id}>
              <span>{player.monogram}</span>
              <b>{player.name}</b>
              <strong>🦑 {count}</strong>
              <small>{count > 0 ? `当前 ×${squidMultiplier(count)}` : "尚未获得"}</small>
            </div>
          );
        })}
      </div>
      <p className="squid-rule-note">独赢主池获得鱿鱼；无人跟注时必须亮牌，平分主池不发。9 条发完后，零条玩家按持有数量与倍率向持有者结算。</p>
      {game.squid.lastSettlement && <div className="squid-settlement">{game.squid.lastSettlement}</div>}
    </section>
  );
}

function LandingHome({ onEnterSolo }: { onEnterSolo: () => void }) {
  const multiplayerHref = multiplayerEntryHref();

  return (
    <main className="landing-shell">
      <div className="landing-glow landing-glow-one" aria-hidden="true" />
      <div className="landing-glow landing-glow-two" aria-hidden="true" />

      <header className="landing-nav">
        <div className="brand landing-brand">
          <div className="brand-mark">P</div>
          <div><strong>RANGECRAFT</strong><span>德州扑克训练室</span></div>
        </div>
        <nav className="landing-nav-actions" aria-label="主页导航">
          <a href={multiplayerHref}>多人模式</a>
          <a className="landing-account-link" href={multiplayerHref}>注册 / 登录</a>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-eyebrow"><i /> RANGE DECISION LAB</span>
          <h1>把每一手牌，<br />练成真正的判断力。</h1>
          <p>在不泄露电脑底牌的前提下，训练范围、赔率、下注尺度与诈唬频率。单手即时点评，整局结束后再揭晓完整策略画像。</p>
          <div className="landing-hero-actions">
            <button type="button" onClick={onEnterSolo}>进入单人训练 <span>→</span></button>
            <a href={multiplayerHref}>进入多人模式 <span>↗</span></a>
          </div>
          <div className="landing-signals" aria-label="训练功能">
            <span><i /> 本地即可练习</span>
            <span><i /> 6-MAX 混合频率 AI</span>
            <span><i /> 逐街决策复盘</span>
          </div>
        </div>

        <div className="landing-table-card" aria-label="RangeCraft 训练牌桌预览">
          <div className="landing-card-heading">
            <div><span>LIVE TRAINING</span><strong>标准现金 · 100 BB</strong></div>
            <em><i /> READY</em>
          </div>
          <div className="landing-table-preview" aria-hidden="true">
            <span className="preview-seat preview-seat-top">OR</span>
            <span className="preview-seat preview-seat-left">AT</span>
            <span className="preview-seat preview-seat-right">IV</span>
            <div className="preview-board">
              <small>底池 145</small>
              <div><b>A<span>♠</span></b><b>J<span className="red">♥</span></b><b>7<span>♣</span></b></div>
            </div>
            <div className="preview-hero">
              <div><b>K<span>♠</span></b><b>Q<span className="red">♦</span></b></div>
              <strong>你的行动</strong>
            </div>
          </div>
          <div className="landing-card-footer">
            <div><span>范围胜率</span><strong>48%</strong></div>
            <div><span>参考线路</span><strong>跟注 63% · 加注 24%</strong></div>
          </div>
        </div>
      </section>

      <section className="landing-modes" aria-labelledby="mode-heading">
        <div className="landing-section-heading">
          <span>CHOOSE YOUR TABLE</span>
          <h2 id="mode-heading">选择你的练习方式</h2>
        </div>
        <div className="landing-mode-grid">
          <a
            className="landing-mode-card solo"
            href="#/solo"
            onClick={(event) => {
              event.preventDefault();
              onEnterSolo();
            }}
          >
            <span className="mode-index">01</span>
            <div><small>LOCAL TRAINING</small><h3>单人训练</h3><p>浅筹、标准、深筹与血战鱿鱼；电脑风格每桌随机，支持单手即时指导与整局统一复盘。</p></div>
            <strong>立即开始 <span>→</span></strong>
          </a>
          <a className="landing-mode-card multiplayer" href={multiplayerHref}>
            <span className="mode-index">02</span>
            <div><small>ONLINE TABLE</small><h3>多人模式</h3><p>注册或登录后进入在线大厅，与真实玩家同桌。账号、房间和战绩由在线服务保存。</p></div>
            <strong>前往大厅 <span>↗</span></strong>
          </a>
        </div>
      </section>

      <footer className="landing-footer">
        <span>RANGECRAFT · DECISION FIRST</span>
        <p>近似 GTO 训练工具，不代表求解器给出的精确 EV。</p>
      </footer>
    </main>
  );
}

function SoloTrainer({ onExit }: { onExit: () => void }) {
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
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [appInstalled, setAppInstalled] = useState(() => typeof window !== "undefined" && (
    window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  ));
  const winSoundHand = useRef(0);
  const soundOnRef = useRef(true);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register(`${APP_BASE_PATH}sw.js`, { scope: APP_BASE_PATH }).catch(() => undefined);
    }

    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setAppInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setGame(freshGame(undefined, { shuffleStyles: true, presetKey: "standard" })), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const human = game?.players[0];
  const isHumanTurn = Boolean(game && human && !dealing && game.status === "playing" && game.current === human.id);
  const thinking = Boolean(game && !dealing && game.status === "playing" && game.current >= 0 && !game.players[game.current]?.isHuman);
  const toCall = game && human ? Math.max(0, game.highestBet - human.bet) : 0;
  const humanSizingContext = game && human ? pokerSizingContext(game, human) : null;
  const minTarget = humanSizingContext
    ? legalPokerRaiseTarget(humanSizingContext, humanSizingContext.highestBet + humanSizingContext.minRaise)
    : 0;
  const maxTarget = humanSizingContext ? pokerSizingMaxTarget(humanSizingContext) : 0;
  const quickRaiseOptions = game && humanSizingContext
    ? game.street === "preflop"
      ? [2.5, 3, 4, 5].map((multiple) => ({
          label: game.raiseCount === 0 ? `${multiple}BB` : `${multiple}×`,
          target: roundedPokerRaiseTarget(
            humanSizingContext,
            (game.raiseCount === 0 ? BIG_BLIND : game.highestBet) * multiple,
          ),
        }))
      : [0.33, 0.5, 0.75, 1].map((ratio) => ({
          label: ratio === 1 ? "底池" : `${Math.round(ratio * 100)}%`,
          target: pokerRaiseTargetForFraction(humanSizingContext, ratio),
        }))
    : [];
  const raiseDisabled = !game || maxTarget <= game.highestBet || !isHumanTurn || Boolean(human?.raiseLocked);
  const communityLength = game?.community.length ?? 0;
  const dealCount = game?.dealCount ?? 0;
  const currentHandNo = game?.handNo ?? 0;
  const currentPresetKey = game?.presetKey ?? "standard";

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

  const recordSessionHand = useCallback((finishedGame: Game) => {
    if (mode !== "session" || finishedGame.status !== "showdown" || !finishedGame.showChoiceMade) return;
    const entry = buildSessionHandResult(finishedGame, review);
    setSessionResults((items) => [
      ...items.filter((item) => item.hand !== finishedGame.handNo),
      entry,
    ]);
  }, [mode, review]);

  useEffect(() => {
    if (game?.status === "showdown" && !dealing) {
      const timer = window.setTimeout(() => {
        recordSessionHand(game);
        if (mode === "hand" && game.showChoiceMade) setShowLog(true);
        if (mode === "session" && isSessionComplete(game) && game.showChoiceMade) {
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
  }, [game, dealing, mode, recordSessionHand]);

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
    if (mode === "session" && (sessionEnded || (game ? isSessionComplete(game) : false))) return;
    if (game) recordSessionHand(game);
    setFeedback(null);
    setShowLog(false);
    setGame((current) => freshGame(current ?? undefined, {
      resetStacks: mode === "hand",
      shuffleStyles: mode === "hand",
    }));
  }, [mode, sessionEnded, game, recordSessionHand]);

  const resetRun = useCallback((nextMode: GameMode, nextPreset: TablePresetKey) => {
    setMode(nextMode);
    setTraining(nextMode === "hand");
    setReview([]);
    setFeedback(null);
    setShowLog(false);
    setSessionEnded(false);
    setSessionResults([]);
    setHeroImage({ loose: 0.5, aggressive: 0.5, deceptive: 0.5 });
    setDealing(false);
    setRaiseTo(BIG_BLIND * 3);
    winSoundHand.current = 0;
    setGame(freshGame(undefined, { shuffleStyles: true, presetKey: nextPreset }));
  }, []);

  const hasRunProgress = Boolean(game && (
    game.handNo > 1
    || game.status === "showdown"
    || game.community.length > 0
    || game.players.some((player) => player.hasActed)
    || review.length > 0
    || sessionResults.length > 0
  ));

  const exitToLanding = useCallback(() => {
    if (hasRunProgress && !window.confirm("返回主页会结束当前练习，确定继续吗？")) return;
    onExit();
  }, [hasRunProgress, onExit]);

  const switchMode = useCallback((nextMode: GameMode) => {
    if (nextMode === mode || (currentPresetKey === "squid" && nextMode === "hand")) return;
    if (hasRunProgress && !window.confirm("切换训练模式会重新开始当前练习，确定继续吗？")) return;
    resetRun(nextMode, currentPresetKey);
  }, [mode, currentPresetKey, hasRunProgress, resetRun]);

  const switchPreset = useCallback((nextPreset: TablePresetKey) => {
    if (nextPreset === currentPresetKey) return;
    if (hasRunProgress && !window.confirm("切换桌型会清空当前牌局、复盘和桌上形象，确定继续吗？")) return;
    const nextMode: GameMode = nextPreset === "squid" ? "session" : mode;
    resetRun(nextMode, nextPreset);
  }, [mode, currentPresetKey, hasRunProgress, resetRun]);

  const restartCurrentRun = useCallback(() => {
    resetRun(currentPresetKey === "squid" ? "session" : mode, currentPresetKey);
  }, [currentPresetKey, mode, resetRun]);

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
    const actionScore = selectedFrequency > 0 ? Math.round(45 + 55 * selectedFrequency / bestFrequency) : 35;
    const sizingContext = pokerSizingContext(game, human);
    const actualRaiseTo = kind === "raise" ? legalPokerRaiseTarget(sizingContext, raiseTo) : null;
    const actualBetFraction = actualRaiseTo === null ? null : pokerRaiseFraction(sizingContext, actualRaiseTo);
    const sizeScore = actualRaiseTo === null
      ? null
      : scorePokerRaiseSize(sizingContext, actualRaiseTo, advice.sizingRoutes);
    const sizeVerdict = actualRaiseTo === null
      ? ""
      : pokerRaiseSizeVerdict(sizingContext, actualRaiseTo, advice.sizingRoutes);
    const score = sizeScore === null ? actionScore : Math.round(actionScore * 0.6 + sizeScore * 0.4);
    const actionLabel = actualRaiseTo === null
      ? ACTION_LABELS[kind]
      : formatPokerSizingRoute(sizingContext, {
          target: actualRaiseTo,
          fraction: actualBetFraction ?? 0,
          frequency: 1,
          allIn: actualRaiseTo === pokerSizingMaxTarget(sizingContext),
        });
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
      action: actionLabel,
      actionKind: kind,
      actualRaiseTo,
      actualBetFraction,
      recommended: advice.recommendedLabel,
      recommendedAction: advice.action,
      recommendedRaiseTo: advice.recommendedRaiseTo,
      recommendedBetFraction: advice.recommendedBetFraction,
      mix: advice.mix,
      sizingMix: advice.sizingMix,
      sizeScore,
      sizeVerdict,
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
    setGame((current) => (current ? act(current, human.id, kind, actualRaiseTo ?? undefined) : current));
  }, [game, human, isHumanTurn, advice, raiseTo, toCall, equity, soundOn, mode]);

  const toggleSound = useCallback(() => {
    const next = !soundOn;
    setSoundOn(next);
    soundOnRef.current = next;
    void setPokerAudioEnabled(next).then(() => {
      if (next) playPokerSound("call");
    });
  }, [soundOn]);

  const installApp = useCallback(async () => {
    if (!installPrompt) {
      setInfoOpen(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setAppInstalled(true);
    setInstallPrompt(null);
  }, [installPrompt]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const targetTag = (event.target as HTMLElement)?.tagName;
      if (targetTag === "INPUT" || targetTag === "SELECT") return;
      const key = event.key.toLowerCase();
      if (game?.status === "showdown" && !dealing && key === "n") {
        if (!game.showChoiceMade) return;
        if (mode === "session" && isSessionComplete(game)) setShowLog(true);
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
    ? Math.max(sessionResults.length, handFinished ? game.handNo : game.handNo - 1)
    : game.handNo;
  const squidAwarded = game.squid.total - game.squid.remaining;
  const sessionProgressDone = game.presetKey === "squid" ? squidAwarded : Math.min(completedHands, SESSION_HANDS);
  const sessionProgressGoal = game.presetKey === "squid" ? game.squid.total : SESSION_HANDS;
  const sessionIsComplete = isSessionComplete(game);
  const heroNet = human.stack - game.cashInvested[0];
  const showDecisionPending = handFinished && game.endedUncontested && game.winnerIds[0] === 0 && !game.showChoiceMade;
  const imageLabel = (value: number, low: string, middle: string, high: string) => value < 0.42 ? low : value > 0.58 ? high : middle;
  const streetScores = (["翻牌前", "翻牌", "转牌", "河牌"] as const).map((street) => {
    const items = review.filter((item) => item.street === street);
    return { street, count: items.length, score: items.length ? Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length) : null };
  });

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="table-brand-group">
          <button className="table-home-button" type="button" onClick={exitToLanding} aria-label="返回 RangeCraft 主页">←</button>
          <div className="brand">
            <div className="brand-mark">P</div>
            <div><strong>RANGECRAFT</strong><span>德州扑克训练室</span></div>
          </div>
        </div>
        <div className="session-meta">
          <span className="status-dot" />
          <span>本地单机</span>
          <i />
          <span>盲注 {SMALL_BLIND}/{BIG_BLIND} · 6-MAX</span>
          <i />
          <span>{TABLE_PRESETS[game.presetKey].shortLabel} · {mode === "session" ? game.presetKey === "squid" ? `第 ${game.handNo} 手 · 剩余 ${game.squid.remaining} 条` : `${Math.min(game.handNo, SESSION_HANDS)} / ${SESSION_HANDS} 手` : `第 ${game.handNo} 手`}</span>
        </div>
        <div className="header-actions">
          {!appInstalled && (
            <button className="install-app-button" onClick={() => void installApp()} aria-label="把 RangeCraft 安装到桌面">
              <span>↓</span><b>安装应用</b>
            </button>
          )}
          <button className={`sound-toggle ${soundOn ? "on" : ""}`} onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? "关闭牌桌音效" : "开启牌桌音效"}>
            <span>{soundOn ? "♪" : "—"}</span><b>音效</b><em>{soundOn ? "ON" : "OFF"}</em>
          </button>
          <button
            className={`training-toggle ${training && mode === "hand" ? "on" : ""}`}
            onClick={() => setTraining((value) => !value)}
            disabled={mode === "session"}
            title={mode === "session" ? game.presetKey === "squid" ? "鱿鱼整局在 9 条发完后统一点评" : "整局模式在第 20 手后统一点评" : undefined}
          >
            <span>{mode === "session" ? "赛后点评" : "训练提示"}</span><b>{mode === "session" ? "LOCK" : training ? "ON" : "OFF"}</b>
          </button>
          <button className="icon-button" aria-label="查看游戏说明" onClick={() => setInfoOpen(true)}>?</button>
        </div>
      </header>

      <div className="workspace">
        <section className="table-zone">
          <div className="table-toolbar">
            <div className="table-setup-row">
              <label className="preset-select">
                <span>桌型</span>
                <select value={currentPresetKey} onChange={(event) => switchPreset(event.target.value as TablePresetKey)} aria-label="选择牌桌类型">
                  {(Object.entries(TABLE_PRESETS) as [TablePresetKey, (typeof TABLE_PRESETS)[TablePresetKey]][]).map(([key, preset]) => (
                    <option key={key} value={key}>{preset.label}</option>
                  ))}
                </select>
                <small>{TABLE_PRESETS[currentPresetKey].description}</small>
              </label>
              <div className="mode-switch" aria-label="训练模式">
                <button
                  className={mode === "hand" ? "active" : ""}
                  aria-pressed={mode === "hand"}
                  onClick={() => switchMode("hand")}
                  disabled={currentPresetKey === "squid"}
                  title={currentPresetKey === "squid" ? "血战鱿鱼需要跨手记录，使用整局模式" : undefined}
                >
                  <b>单手训练</b><span>每手结束立即点评</span>
                </button>
                <button className={mode === "session" ? "active" : ""} aria-pressed={mode === "session"} onClick={() => switchMode("session")}>
                  <b>{currentPresetKey === "squid" ? "鱿鱼整局" : "20 手整局"}</b><span>{currentPresetKey === "squid" ? "9 条发完统一点评" : "结束后统一点评"}</span>
                </button>
              </div>
            </div>
            <div className="table-status-row">
              {mode === "session" && <div className="session-progress"><i style={{ width: `${sessionProgressDone / Math.max(1, sessionProgressGoal) * 100}%` }} /><span>{sessionProgressDone}/{sessionProgressGoal}</span></div>}
              {game.presetKey === "squid" && (
                <div className="squid-race-status"><span>🦑 第 {game.squid.round} 轮</span><b>剩余 {game.squid.remaining}/{game.squid.total}</b><em>基础 {game.squid.bounty / BIG_BLIND} BB</em></div>
              )}
            </div>
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
                  <span>{mode === "session" ? game.presetKey === "squid" ? `第 ${game.handNo} 手 · 本轮已发 ${squidAwarded}/${game.squid.total}` : `整局进度 ${Math.min(game.handNo, SESSION_HANDS)}/${SESSION_HANDS}` : "本手结束"}</span>
                  <strong>{game.result}</strong>
                  {showDecisionPending && (
                    <p>{game.presetKey === "squid" ? "亮牌可获得本手鱿鱼；盖牌能隐藏信息，但会放弃这条鱿鱼。" : "要公开这两张手牌来塑造桌上形象吗？AI 会记住你的选择。"}</p>
                  )}
                </div>
                {showDecisionPending ? (
                  <div className="show-choice">
                    <button className="show-cards" onClick={() => chooseHeroShow(true)}>亮出手牌</button>
                    <button className="muck-cards" onClick={() => chooseHeroShow(false)}>盖牌</button>
                  </div>
                ) : mode === "session" && sessionIsComplete ? (
                  <button className="next-hand-button" onClick={() => setShowLog(true)}>查看{game.presetKey === "squid" ? "鱿鱼" : ""}整局复盘</button>
                ) : (
                  <button className="next-hand-button" onClick={startNextHand}>下一手 <kbd>N</kbd></button>
                )}
                <WinningHands game={game} />
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
                      step={Math.max(1, BIG_BLIND / 2)}
                      value={Math.min(Math.max(raiseTo, minTarget), Math.max(minTarget, maxTarget))}
                      onChange={(event) => setRaiseTo(Number(event.target.value))}
                      disabled={raiseDisabled}
                    />
                    <span>{maxTarget}</span>
                  </div>
                  <div className="quick-bets">
                    {quickRaiseOptions.map((option) => (
                      <button
                        key={option.label}
                        disabled={raiseDisabled || !humanSizingContext}
                        onClick={() => setRaiseTo(option.target)}
                      >
                        {option.label}
                      </button>
                    ))}
                    <button disabled={raiseDisabled} onClick={() => setRaiseTo(maxTarget)}>全下</button>
                  </div>
                  {toCall > 0 && game.street !== "preflop" && <small className="sizing-basis-note">快捷百分比按跟注后的底池计算</small>}
                  {game.street === "preflop" && game.raiseCount > 0 && <small className="sizing-basis-note">快捷倍数按对手当前加注额计算</small>}
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
              {mode === "session" ? game.presetKey === "squid" ? `鱿鱼复盘 · ${squidAwarded}/${game.squid.total}` : `整局复盘 · ${completedHands}/${SESSION_HANDS}` : `本手复盘${reviewUnlocked ? " · 已解锁" : ""}`}
            </button>
          </div>

          {!showLog ? mode === "session" ? (
            <div className="analysis-content session-live">
              <section className="session-lock">
                <div className="lock-orbit">◇</div>
                <span>SESSION REVIEW LOCKED</span>
                <h3>{game.presetKey === "squid" ? "答案留到 9 条鱿鱼发完之后" : "答案留到第 20 手之后"}</h3>
                <p>整局模式不显示实时胜率、推荐动作、决策分数和对手类型，避免答案影响你的下一次判断。</p>
                <div className="session-progress-card">
                  <div><b>{sessionProgressDone}</b><span>{game.presetKey === "squid" ? "已发出" : "已完成"}</span></div>
                  <i><em style={{ width: `${sessionProgressDone / Math.max(1, sessionProgressGoal) * 100}%` }} /></i>
                  <strong>{sessionProgressGoal}</strong>
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
              <SquidScoreboard game={game} />
              <section className="locked-profile">
                <span>◇</span>
                <div><b>桌上形象正在形成</b><p>AI 会根据你的松紧、侵略性和亮牌行为调整应对；具体画像只在整局结束后公开。</p></div>
              </section>
            </div>
          ) : (
            <div className="analysis-content">
              <section className="equity-card">
                <div className="section-label"><span>牌面与行动范围</span><b>{isHumanTurn ? "RANGE" : "WAIT"}</b></div>
                <div className="equity-main">
                  <div className="equity-number"><strong>{isHumanTurn ? Math.round(equity * 100) : "—"}</strong><span>%<br />范围胜率</span></div>
                  <div className="equity-bars">
                    <span><i style={{ width: `${isHumanTurn ? equity * 100 : 0}%` }} /></span>
                    <div><b>你的手牌</b><em>{human.hole.map(cardText).join("  ")}</em></div>
                  </div>
                </div>
                <div className="metric-grid">
                  <div><span>底池赔率</span><strong>{isHumanTurn && advice ? `${Math.round(advice.potOdds * 100)}%` : "—"}</strong></div>
                  <div><span>有效筹码</span><strong>{Math.min(...game.players.filter((p) => !p.folded).map((p) => p.stack)) / BIG_BLIND} BB</strong></div>
                  <div><span>SPR</span><strong>{(human.stack / Math.max(1, committedPot(game))).toFixed(1)}</strong></div>
                </div>
                <p className="range-note">按位置、行动顺序、下注尺度、跟注价格与多人底池动态加权；不会读取电脑暗牌。</p>
              </section>

              <section className={`coach-callout ${training && isHumanTurn ? "visible" : "muted"}`}>
                <div className="coach-icon">◆</div>
                <div>
                  <span>近似 GTO 建议</span>
                  <h3>{training && isHumanTurn && advice ? `优先考虑 · ${advice.recommendedLabel}` : training ? "等待你的行动点" : "训练提示已关闭"}</h3>
                  <p>{training && isHumanTurn && advice
                    ? `${advice.mix}。${advice.sizingMix ? `加注尺寸路线：${advice.sizingMix}。` : ""}${advice.note}`
                    : training ? "AI 行动结束后，这里会给出范围、赔率、动作频率与加注尺寸参考。" : "关闭提示时仍会记录你的决策，方便牌后复盘。"}</p>
                </div>
              </section>

              {feedback ? (
                <section className="last-decision">
                  <div className="decision-top"><span>上一决策</span><b className={feedback.score >= 85 ? "good" : feedback.score >= 65 ? "ok" : "bad"}>{feedback.score} 分</b></div>
                  <h3>{feedback.score >= 85 ? "线路漂亮，继续保持" : feedback.score >= 65 ? "可执行，但有更优选择" : "这里值得重点复盘"}</h3>
                  <p>你选择了{feedback.action}。参考混合：{feedback.mix}。{feedback.sizingMix ? `加注尺寸路线：${feedback.sizingMix}。` : ""}{feedback.sizeVerdict ? `${feedback.sizeVerdict}。` : ""}{feedback.note}</p>
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
                <h3>{showDecisionPending ? "请先选择亮牌或盖牌" : mode === "session" ? game.presetKey === "squid" ? `还剩 ${game.squid.remaining} 条鱿鱼` : `还需完成 ${Math.max(0, SESSION_HANDS - completedHands)} 手` : "本手尚未结束"}</h3>
                <p>{showDecisionPending ? "完成本手的展示决策后再生成报告，避免复盘信息影响你的选择。" : mode === "session" ? "整局结束后一次生成完整报告，不显示中途答案、分数和对手类型。" : "牌局结束后会自动生成这手牌的决策点评。"}</p>
                <button onClick={() => setShowLog(false)}>回到牌桌</button>
              </section>
            </div>
          ) : (
            <div className="log-content">
              <div className="review-summary unlocked">
                <div>
                  <span>{mode === "session" ? game.presetKey === "squid" ? "鱿鱼整局报告已生成" : "20 手整局报告已生成" : "本手复盘已生成"}</span>
                  <h3>{TABLE_PRESETS[game.presetKey].shortLabel} · {mode === "session" ? `${sessionResults.length} 手 · ${review.length} 个决策节点` : `第 ${game.handNo} 手 · ${STREET_LABELS[game.street]}`}</h3>
                </div>
                <strong>{reportScore}<small>{reportReview.length ? "策略匹配度" : "暂无决策"}</small></strong>
              </div>

              {mode === "session" && (
                <>
                  <div className="session-stats">
                    <div><span>完成手数</span><strong>{sessionResults.length}{game.presetKey === "squid" ? "" : `/${SESSION_HANDS}`}</strong></div>
                    <div><span>桌面筹码</span><strong>{human.stack}</strong></div>
                    <div><span>本局总投入</span><strong>{game.cashInvested[0]}</strong></div>
                    <div><span>净结果（含鱿鱼）</span><strong className={heroNet >= 0 ? "good" : "bad"}>{heroNet >= 0 ? "+" : ""}{heroNet}</strong></div>
                    <div><span>AI 眼中的松紧</span><strong>{imageLabel(heroImage.loose, "偏紧", "均衡", "偏松")}</strong></div>
                    <div><span>AI 眼中的风格</span><strong>{imageLabel(heroImage.aggressive, "偏被动", "均衡", "偏激进")}</strong></div>
                  </div>
                  <SquidScoreboard game={game} report />
                  <div className="session-hand-list">
                    <div className="section-label"><span>逐手结果</span><small>低于 1 BB 自动补至当前桌型</small></div>
                    {[...sessionResults].sort((a, b) => a.hand - b.hand).map((item) => (
                      <div key={item.hand}>
                        <span>{String(item.hand).padStart(2, "0")}</span>
                        <p><b>{item.heroCards}</b><small>{item.result} · 桌面 {item.heroStack} / 投入 {item.heroCashInvested} / 净 {item.heroNet >= 0 ? "+" : ""}{item.heroNet}</small></p>
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
                      {item.sizingMix && <p>加注尺寸路线：{item.sizingMix}{item.sizeVerdict ? `；${item.sizeVerdict}` : ""}</p>}
                      <small>范围胜率 {Math.round(item.equity * 100)}% / 所需赔率 {Math.round(item.potOdds * 100)}% · {item.note}</small>
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

              {mode === "session" && (
                <button className="session-restart" onClick={restartCurrentRun}>
                  {game.presetKey === "squid" ? "开始新一轮鱿鱼" : "开始新的 20 手整局"}
                </button>
              )}

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
              <div><b>四种桌型</b><span>浅筹 40 BB、标准 100 BB、深筹 200 BB，以及 200 BB 的血战鱿鱼。</span></div>
              <div><b>两种训练</b><span>单手模式逐手点评；常规整局固定 20 手，鱿鱼整局以 9 条全部发完为终点，答案都在结束后统一公开。</span></div>
              <div><b>血战鱿鱼</b><span>六人桌争夺 9 条；3/5/7 条触发 ×2/×3/×4。无人跟注时亮牌才获得。</span></div>
              <div><b>完整 GTO 的边界</b><span>任意 6 人动态牌局需要预计算策略库或外部求解服务；现有传输接口可在后续接入。</span></div>
              <div><b>形象博弈</b><span>你和 AI 都可选择亮牌或盖牌；AI 会用可见信息形成对你的松紧、侵略性与欺骗性判断。</span></div>
              <div><b>规则范围</b><span>6 人现金桌、边池、全下跑牌、不足额全下加注权与鱿鱼跨手结算均在本地处理。</span></div>
              <div><b>安装成应用</b><span>Chrome 或 Edge 点顶栏“安装应用”；Mac Safari 选“文件 → 添加到程序坞”，iPhone/iPad 选“分享 → 添加到主屏幕”。</span></div>
              <div><b>如何打开</b><span>线上地址无需启动服务器；本地地址只有运行开发服务时可用。安装后可直接从桌面或程序坞点图标进入。</span></div>
            </div>
            <button className="modal-primary" onClick={() => setInfoOpen(false)}>回到牌桌</button>
          </section>
        </div>
      )}
    </main>
  );
}

export default function Home() {
  const [view, setView] = useState<PortalView>("landing");

  useEffect(() => {
    const syncView = () => setView(portalViewFromHash(window.location.hash));
    const timer = window.setTimeout(syncView, 0);
    window.addEventListener("hashchange", syncView);
    window.addEventListener("popstate", syncView);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", syncView);
      window.removeEventListener("popstate", syncView);
    };
  }, []);

  const enterSolo = useCallback(() => {
    const url = new URL(window.location.href);
    url.hash = "/solo";
    window.history.pushState({ rangeCraftView: "solo" }, "", `${url.pathname}${url.search}${url.hash}`);
    setView("solo");
  }, []);

  const returnToLanding = useCallback(() => {
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState({ rangeCraftView: "landing" }, "", `${url.pathname}${url.search}`);
    setView("landing");
  }, []);

  return view === "solo"
    ? <SoloTrainer onExit={returnToLanding} />
    : <LandingHome onEnterSolo={enterSolo} />;
}
