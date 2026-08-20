"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AI_PROFILES,
  adaptAiProfileToHeroImage,
  sampleAiLineup,
  updateHeroTableImage,
  type HeroTableImage,
} from "../lib/poker-ai";
import { isPokerAudioEnabled, playPokerSound, setPokerAudioEnabled, unlockPokerAudio } from "../lib/poker-audio";
import {
  analyzeBoardTexture,
  bestHand,
  bestHandWithCards,
  blockerValue,
  drawPotential,
  estimateEquity,
  preflopHandFeatures,
  preflopPercentile,
  preflopStrength,
} from "../lib/poker-evaluator";
import {
  choosePokerPolicyAction,
  evaluatePokerPolicy,
  pokerCallClosesContestableLayers,
  pokerContestablePotAtDecision,
  sixMaxPreflopPosition,
  sixMaxPreflopPositionFactor,
  type PokerPolicyInput,
  type PokerPolicyProfile,
} from "../lib/poker-policy";
import { createPublicOpponentRanges, type PublicBettingAction } from "../lib/poker-range";
import {
  POKER_RUN_DECISION_HISTORY_LIMIT,
  POKER_RUN_HAND_HISTORY_LIMIT,
  createPokerRunDecisionStats,
  pokerRunBbPer100,
  pokerRunCanStartNextHand,
  recordPokerRunDecision,
  upsertPokerRunHand,
} from "../lib/poker-run";
import { pokerPrivatePeekCandidateIds, selectPokerPrivatePeek } from "../lib/poker-peek";
import {
  POKER_HAND_HISTORY_LIMIT,
  POKER_HAND_HISTORY_STORAGE_KEY,
  buildPokerReplayEvents,
  mergePokerHandHistory,
  parsePokerHandHistoryJson,
  pokerReplayEventsAtStep,
  upsertPokerHandHistory,
  type PokerHandHistoryEntry,
  type PokerHistoryAction,
} from "../lib/poker-history";
import { settlePokerShowdown } from "../lib/poker-settlement";
import { resolveNextCashGameBankrolls, resolvePokerDecisionStacks } from "../lib/poker-stack";
import {
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
type GameMode = "per_hand" | "session" | "endless";
type TablePresetKey = "short" | "standard" | "deep" | "squid";
type TableImage = HeroTableImage;
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const APP_BASE_PATH = import.meta.env.BASE_URL || "/";
type PortalView = "landing" | "solo";

function multiplayerEntryHref() {
  return "#/multiplayer";
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
  mainPotWinnerIds: number[];
  payouts: Array<{ playerId: number; amount: number }>;
  returns: Array<{ playerId: number; amount: number }>;
  endedUncontested: boolean;
  shownPlayerIds: number[];
  peekedPlayerIds: number[];
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
  streetKey: Street;
  street: string;
  cards: string;
  board: string;
  pot: number;
  toCall: number;
  equity: number;
  potOdds: number;
  equityRealization: number;
  realizationThreshold: number;
  callEv: number | null;
  heroStackBb: number;
  opponentStackBb: number;
  opponentName: string;
  effectiveStackBb: number;
  startingDepthBb: number;
  maxContestableBb: number;
  spr: number;
  strategySource: string;
  preflopPosition: string;
  preflopScenario: string;
  preflopTargetRange: number;
  preflopEnterFrequency: number;
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
  selectedFrequency: number;
  actionVerdict: string;
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
const COACH_PROFILE: PokerPolicyProfile = { ...AI_PROFILES.gto };

const TABLE_PRESETS: Record<TablePresetKey, {
  label: string;
  shortLabel: string;
  description: string;
  stackBb: number;
  squid: boolean;
}> = {
  short: { label: "浅筹现金 · 初始 40 BB", shortLabel: "浅筹桌 · 初始 40BB", description: "初始买入 40 BB；更频繁面对全下与低 SPR 决策", stackBb: 40, squid: false },
  standard: { label: "标准现金 · 初始 100 BB", shortLabel: "标准桌 · 初始 100BB", description: "初始买入 100 BB；之后按实际筹码深度训练", stackBb: 100, squid: false },
  deep: { label: "深筹现金 · 初始 200 BB", shortLabel: "深筹桌 · 初始 200BB", description: "初始买入 200 BB；更多转牌、河牌与大底池决策", stackBb: 200, squid: false },
  squid: { label: "血战鱿鱼 · 初始 200 BB", shortLabel: "血战鱿鱼 · 初始 200BB", description: "初始买入 200 BB · 9 条鱿鱼 · 基础价值 5 BB", stackBb: 200, squid: true },
};

const AI_REVIEW_NOTES: Record<keyof typeof AI_PROFILES, string> = {
  gto: "以 169 手牌翻前表和混合频率为锚点，翻后保持多尺度与诈唬比例；这是本地近似策略，不冒充求解器解。",
  lag: "在同一基准策略上扩大边缘入池与再加注分支，主动施压更多，但仍受位置、价格和阻断牌约束。",
  tag: "在同一基准策略上收紧边缘继续范围，价值区间进攻坚决，低权益诈唬明显减少。",
  adaptive: "会随已观察到的松紧、侵略性和亮牌信息逐步调整，样本少时仍以均衡基准为主。",
  nit: "明显压缩边缘范围并降低诈唬率；面对其大额投入应尊重范围，但它仍会保留少量混合。",
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

const PREFLOP_SCENARIO_LABELS = {
  open: "首入池",
  isolate: "隔离跛入者",
  "check-option": "大盲免费过牌",
  "vs-open": "面对开池",
  "vs-three-bet": "面对 3-bet",
  "vs-four-bet": "面对 4-bet 及以上",
} as const;

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

function seededSpotRandom(seed: string) {
  let state = 2166136261;
  for (const character of seed) {
    state ^= character.codePointAt(0) ?? 0;
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
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
    position: (playerId) => sixMaxPreflopPosition(playerId, game.dealer),
  });
  if (!opponents.length) return 1;
  const publicSeed = [
    game.handNo,
    player.id,
    player.hole.map(cardKey).join(","),
    community.map(cardKey).join(","),
    game.players.map((candidate) => `${candidate.id}:${Number(candidate.folded)}:${candidate.stack}:${candidate.bet}:${candidate.contributed}`).join("|"),
    game.actionHistory.map((action) => `${action.playerId}:${action.street}:${action.kind}:${action.amount}`).join("|"),
  ].join(";");
  // Main pots and side pots can have different opponent ranges even before the
  // action closes (for example, one short stack is all-in while a deeper side
  // pot remains live). Price every eligible layer separately instead of
  // applying one aggregate multiway equity to the whole pot.
  const toCall = Math.max(0, game.highestBet - player.bet);
  const decisionPot = pokerContestablePotAtDecision(
    player.id,
    player.contributed,
    player.stack,
    toCall,
    game.players,
  );
  if (decisionPot.finalPot > 0 && decisionPot.layers.length > 0) {
    const rangeByPlayer = new Map(opponents.map((opponent) => [opponent.playerId, opponent.weight]));
    const layerIterations = Math.max(48, Math.floor(iterations / decisionPot.layers.length));
    const expectedPayout = decisionPot.layers.reduce((sum, layer, index) => {
      const layerRanges = layer.opponentIds
        .map((playerId) => rangeByPlayer.get(playerId))
        .filter((weight): weight is NonNullable<typeof weight> => Boolean(weight));
      if (!layerRanges.length) return sum + layer.amount;
      const layerEquity = estimateEquity(player.hole, community, {
        opponents: layerRanges.length,
        iterations: layerIterations,
        opponentRanges: layerRanges,
        random: seededSpotRandom(`${publicSeed};layer:${index}:${layer.opponentIds.join(",")}`),
      });
      return sum + layer.amount * layerEquity;
    }, 0);
    return expectedPayout / decisionPot.finalPot;
  }
  return estimateEquity(player.hole, community, {
    opponents: opponents.length,
    iterations: game.street === "preflop" ? Math.max(48, iterations) : iterations,
    opponentRanges: opponents.map((opponent) => opponent.weight),
    random: seededSpotRandom(publicSeed),
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

function soloDecisionStackContext(game: Game, player: Player) {
  return resolvePokerDecisionStacks({
    player,
    players: game.players,
    highestBet: game.highestBet,
    lastAggressorId: game.lastAggressor,
  });
}

function pokerSizingContext(game: Game, player: Player): PokerSizingContext {
  const stacks = soloDecisionStackContext(game, player);
  return {
    street: game.street,
    pot: committedPot(game),
    toCall: Math.max(0, game.highestBet - player.bet),
    highestBet: game.highestBet,
    playerBet: player.bet,
    playerStack: player.stack,
    maxContestableTarget: stacks.maxContestableTarget,
    minRaise: game.minRaise,
    bigBlind: BIG_BLIND,
    preflopRaiseCount: game.raiseCount,
  };
}

function canAnyOpponentRespond(game: Game, player: Player) {
  return game.players.some((candidate) => (
    candidate.id !== player.id && !candidate.folded && candidate.stack > 0
  ));
}

function callClosesPlayerAction(game: Game, player: Player) {
  const toCall = Math.max(0, game.highestBet - player.bet);
  if (toCall <= 0) return false;
  if (pokerCallClosesContestableLayers(
    player.id,
    player.contributed,
    player.stack,
    toCall,
    game.players,
  )) return true;
  const fundedOpponents = game.players.filter((candidate) => (
    candidate.id !== player.id && !candidate.folded && candidate.stack > 0
  ));
  if (!fundedOpponents.length) return true;
  if (game.street !== "river") return false;
  return fundedOpponents.every((candidate) => (
    candidate.hasActed && candidate.bet === game.highestBet
  ));
}

function isPlayerInPosition(game: Game, player: Player) {
  if (game.street === "preflop") {
    if (game.lastAggressor !== null && game.lastAggressor !== player.id) {
      const positionOrder: Record<ReturnType<typeof sixMaxPreflopPosition>, number> = {
        SB: 0,
        BB: 1,
        UTG: 2,
        HJ: 3,
        CO: 4,
        BTN: 5,
      };
      return positionOrder[sixMaxPreflopPosition(player.id, game.dealer)]
        > positionOrder[sixMaxPreflopPosition(game.lastAggressor, game.dealer)];
    }
    return player.id === game.dealer;
  }
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

type SoloPokerPolicyInput = PokerPolicyInput & {
  heroStackBb: number;
  opponentStackBb: number;
  opponentName: string;
  maxContestableBb: number;
};

function buildPokerPolicyInput(
  game: Game,
  player: Player,
  equity: number,
  profile: PokerPolicyProfile,
): SoloPokerPolicyInput {
  const context = pokerSizingContext(game, player);
  const preflopActions = game.actionHistory.filter((action) => action.street === "preflop");
  const latestPreflopRaise = [...preflopActions].reverse().find((action) => action.kind === "raise");
  const latestAggressiveAction = [...game.actionHistory].reverse().find((action) => action.kind === "raise");
  const boardTexture = analyzeBoardTexture(game.community);
  const stacks = soloDecisionStackContext(game, player);
  const decisionPot = pokerContestablePotAtDecision(
    player.id,
    player.contributed,
    player.stack,
    context.toCall,
    game.players,
  );
  const policyPot = context.toCall > 0 ? decisionPot.currentPot : context.pot;
  return {
    profile,
    street: game.street,
    equity,
    handStrength: game.street === "preflop" ? preflopStrength(player.hole) : visibleHandStrength(player, game.community),
    draw: drawPotential(player.hole, game.community),
    blockers: blockerValue(player.hole, game.community),
    pot: policyPot,
    toCall: context.toCall,
    potOdds: decisionPot.callCost > 0
      ? decisionPot.callCost / Math.max(1, decisionPot.finalPot)
      : 0,
    inPosition: isPlayerInPosition(game, player),
    activeOpponents: game.players.filter((candidate) => !candidate.folded && candidate.id !== player.id).length,
    opponentsCanRespond: canAnyOpponentRespond(game, player),
    callEndsHand: callClosesPlayerAction(game, player),
    effectiveStackBb: stacks.decision.effectiveStack / BIG_BLIND,
    startingDepthBb: stacks.startingDepth / BIG_BLIND,
    highestBet: game.highestBet,
    playerBet: player.bet,
    playerStack: player.stack,
    maxContestableTarget: context.maxContestableTarget,
    minRaise: game.minRaise,
    raiseLocked: player.raiseLocked,
    squidPressure: playerSquidPressure(game, player),
    bigBlind: BIG_BLIND,
    preflopPercentile: preflopPercentile(player.hole),
    preflopHand: preflopHandFeatures(player.hole),
    preflopPosition: sixMaxPreflopPosition(player.id, game.dealer),
    preflopPositionFactor: sixMaxPreflopPositionFactor(player.id, game.dealer),
    preflopRaiseCount: game.raiseCount,
    // At vs-open this is the opener; at later nodes it must be the latest
    // raiser (3-bettor/4-bettor), not the first player who opened the pot.
    preflopOpenerPosition: latestPreflopRaise
      ? sixMaxPreflopPosition(latestPreflopRaise.playerId, game.dealer)
      : undefined,
    preflopLimpers: preflopActions.filter((action) => action.kind === "call" && action.raiseCountBefore === 0).length,
    preflopColdCallers: preflopActions.filter((action) => action.kind === "call" && action.raiseCountBefore > 0).length,
    preflopPreviouslyRaised: preflopActions.some((action) => action.playerId === player.id && action.kind === "raise"),
    boardWetness: boardTexture.wetness,
    boardPairing: boardTexture.pairedness,
    boardHighCard: boardTexture.highCard,
    initiative: latestAggressiveAction?.playerId === player.id,
    streetRaiseCount: game.raiseCount,
    heroStackBb: player.stack / BIG_BLIND,
    opponentStackBb: (stacks.opponent?.stack ?? 0) / BIG_BLIND,
    opponentName: stacks.opponent?.name ?? "主要对手",
    maxContestableBb: stacks.contestable.effectiveStack / BIG_BLIND,
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
  const carriedBankrolls = previous?.players.length && !options.resetStacks
    ? resolveNextCashGameBankrolls({
        stacks: previous.players.map((player) => player.stack),
        cashInvested: previous.cashInvested,
        buyInStack: startingStack,
        bigBlind: BIG_BLIND,
      })
    : null;
  const stacks = carriedBankrolls?.stacks ?? PLAYER_TEMPLATES.map(() => startingStack);
  const cashInvested = carriedBankrolls?.cashInvested ?? PLAYER_TEMPLATES.map(() => startingStack);
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
  const rebought = carriedBankrolls
    ? carriedBankrolls.reboughtIds.map((playerId) => previous!.players[playerId].name)
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
    mainPotWinnerIds: [],
    payouts: [],
    returns: [],
    endedUncontested: false,
    shownPlayerIds: [],
    peekedPlayerIds: [],
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
  const settlement = settlePokerShowdown({
    dealerId: game.dealer,
    players: players.map((player) => ({
      id: player.id,
      contributed: player.contributed,
      folded: player.folded,
      score: player.id === winner.id ? 0 : undefined,
    })),
  });
  const payouts = new Map(settlement.payouts.map((entry) => [entry.playerId, entry.amount]));
  const returns = new Map(settlement.returns.map((entry) => [entry.playerId, entry.amount]));
  const finalPlayers = players.map((player) => ({
    ...player,
    stack: player.stack + (payouts.get(player.id) ?? 0) + (returns.get(player.id) ?? 0),
    bet: 0,
  }));
  const aiShows = !winner.isHuman && aiWantsToShow(winner, game);
  const squidAward = !winner.isHuman && aiShows
    ? grantSquid(game, finalPlayers, winner.id)
    : { players: finalPlayers, cashInvested: game.cashInvested, squid: game.squid, message: "" };
  const returnText = settlement.returns.length
    ? ` · 未跟注退回 ${settlement.returns.map((entry) => `${players.find((player) => player.id === entry.playerId)?.name ?? entry.playerId} ${entry.amount}`).join(" / ")}`
    : "";
  const result = `${winner.name} 收下争夺底池 ${settlement.totalPot}${returnText}${aiShows ? " · 主动亮牌" : ""}${squidAward.message ? ` · ${squidAward.message}` : ""}`;
  return {
    ...game,
    players: squidAward.players,
    cashInvested: squidAward.cashInvested,
    squid: squidAward.squid,
    pot: 0,
    current: -1,
    status: "showdown",
    result,
    winnerIds: settlement.winnerIds.length ? settlement.winnerIds : [winner.id],
    mainPotWinnerIds: settlement.mainPotWinnerIds.length ? settlement.mainPotWinnerIds : [winner.id],
    payouts: settlement.payouts,
    returns: settlement.returns,
    endedUncontested: true,
    shownPlayerIds: aiShows ? [winner.id] : [],
    showChoiceMade: !winner.isHuman,
    log: [result, ...game.log],
  };
}

function settleShowdown(game: Game): Game {
  const ranked = new Map(game.players
    .filter((player) => !player.folded)
    .map((player) => [player.id, bestHand([...player.hole, ...game.community])]));
  const settlement = settlePokerShowdown({
    dealerId: game.dealer,
    players: game.players.map((player) => ({
      id: player.id,
      contributed: player.contributed,
      folded: player.folded,
      score: ranked.get(player.id)?.score,
    })),
  });
  const payouts = new Map(settlement.payouts.map((entry) => [entry.playerId, entry.amount]));
  const returns = new Map(settlement.returns.map((entry) => [entry.playerId, entry.amount]));
  const finalPlayers = game.players.map((player) => ({
    ...player,
    stack: player.stack + (payouts.get(player.id) ?? 0) + (returns.get(player.id) ?? 0),
    bet: 0,
  }));
  const mainWinnerIds = settlement.mainPotWinnerIds;
  const squidAward = mainWinnerIds.length === 1
    ? grantSquid(game, finalPlayers, mainWinnerIds[0])
    : { players: finalPlayers, cashInvested: game.cashInvested, squid: game.squid, message: "" };
  const squidTieMessage = game.presetKey === "squid" && mainWinnerIds.length > 1 ? " · 主池平分，本手鱿鱼不发" : "";
  const headlinePlayers = mainWinnerIds
    .map((winnerId) => game.players.find((player) => player.id === winnerId))
    .filter((player): player is Player => Boolean(player));
  const headlineHand = headlinePlayers[0] ? ranked.get(headlinePlayers[0].id)?.name ?? "胜出" : "胜出";
  const payoutText = settlement.payouts.length > 1
    ? ` · 分池 ${settlement.payouts.map((entry) => `${game.players[entry.playerId].name} +${entry.amount}`).join(" / ")}`
    : "";
  const returnText = settlement.returns.length
    ? ` · 未跟注退回 ${settlement.returns.map((entry) => `${game.players[entry.playerId].name} ${entry.amount}`).join(" / ")}`
    : "";
  const result = `${headlinePlayers.map((player) => player.name).join(" / ")} · ${headlineHand} · 争夺底池 ${settlement.totalPot}${payoutText}${returnText}${squidAward.message ? ` · ${squidAward.message}` : ""}${squidTieMessage}`;
  return {
    ...game,
    players: squidAward.players,
    cashInvested: squidAward.cashInvested,
    squid: squidAward.squid,
    pot: 0,
    current: -1,
    status: "showdown",
    result,
    winnerIds: settlement.winnerIds,
    mainPotWinnerIds: settlement.mainPotWinnerIds,
    payouts: settlement.payouts,
    returns: settlement.returns,
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
  const stackContextBefore = soloDecisionStackContext(game, game.players[playerId]);
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
    actionText = player.stack === 0
      ? paid < toCall ? `${player.name} 不足额全下 ${paid}` : `${player.name} 全下跟注 ${paid}`
      : `${player.name} 跟注 ${paid}`;
    resolvedKind = "call";
    amount = paid;
  } else if (kind === "raise") {
    if (player.raiseLocked || !canAnyOpponentRespond(game, player)) return game;
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
    effectiveStackBefore: stackContextBefore.decision.effectiveStack,
    startingDepthBefore: stackContextBefore.startingDepth,
    aggressorIdBefore: game.lastAggressor ?? undefined,
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

function chooseAiAction(
  game: Game,
  player: Player,
  heroImage: TableImage,
  mode: GameMode,
): { kind: ActionKind; raiseTo?: number } {
  const styleKey = player.styleKey as keyof typeof AI_PROFILES;
  const equity = currentEquity(game, player, game.street === "preflop" ? 300 : 600);
  const facingHero = game.lastAggressor === 0;
  const adapted = adaptAiProfileToHeroImage(styleKey, heroImage, {
    heroActive: !game.players[0].folded,
    facingHero,
    intensity: mode === "endless" ? 1.25 : 0.7,
  });
  const profile: PokerPolicyProfile = {
    aggression: adapted.aggression,
    looseness: adapted.looseness,
    bluff: adapted.bluff,
  };
  const effectiveEquity = clamp(equity + adapted.equityAdjustment, 0.02, 0.98);
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

function privatelyPeekOpponent(game: Game, playerId: number): Game {
  if (game.status !== "showdown" || !game.showChoiceMade) return game;
  const candidates = pokerPrivatePeekCandidateIds(game.players, game.shownPlayerIds);
  const peekedPlayerIds = selectPokerPrivatePeek(game.peekedPlayerIds, playerId, candidates);
  if (peekedPlayerIds.length === game.peekedPlayerIds.length) return game;
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) return game;
  return {
    ...game,
    peekedPlayerIds,
  };
}

function formatFrequencyMix(items: Array<{ label: string; frequency: number }>) {
  const visible = items.filter((item) => item.frequency >= 0.005);
  if (!visible.length) return "";
  const total = visible.reduce((sum, item) => sum + item.frequency, 0);
  const exact = visible.map((item) => item.frequency / total * 100);
  const percentages = exact.map(Math.floor);
  let remainder = 100 - percentages.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - percentages[index] }))
    .sort((left, right) => right.fraction - left.fraction);
  for (let cursor = 0; remainder > 0; cursor += 1, remainder -= 1) {
    percentages[order[cursor % order.length].index] += 1;
  }
  return visible.map((item, index) => `${item.label} ${percentages[index]}%`).join(" · ");
}

function getAdvice(game: Game, player: Player, equity: number) {
  const toCall = Math.max(0, game.highestBet - player.bet);
  const decisionPot = pokerContestablePotAtDecision(
    player.id,
    player.contributed,
    player.stack,
    toCall,
    game.players,
  );
  const callCost = decisionPot.callCost;
  const potOdds = callCost > 0 ? callCost / Math.max(1, decisionPot.finalPot) : 0;
  const terminalCall = callClosesPlayerAction(game, player);
  const sizingContext = pokerSizingContext(game, player);
  const policyInput = buildPokerPolicyInput(game, player, equity, COACH_PROFILE);
  const policyPlan = evaluatePokerPolicy(policyInput);
  const callEv = callCost > 0
    ? equity * policyPlan.equityRealization * decisionPot.finalPot - callCost
    : null;
  const squidCount = game.squid.counts[player.id] ?? 0;
  const frequencies: Record<ActionKind, number> = { ...policyPlan.actionFrequencies };
  const action = (Object.entries(frequencies) as [ActionKind, number][])
    .reduce((best, candidate) => candidate[1] > best[1] ? candidate : best)[0];
  let note: string;
  if (game.street === "preflop") {
    const rangePercent = Math.round(policyPlan.preflopTargetRange * 100);
    const enterPercent = Math.round(policyPlan.preflopEnterFrequency * 100);
    note = `${policyPlan.preflopPosition} ${PREFLOP_SCENARIO_LABELS[policyPlan.preflopScenario]}节点：先按位置、前序行动、加注尺度和有效筹码构建约 ${rangePercent}% 的继续范围；这手牌当前进入范围的混合频率约 ${enterPercent}%。`;
    if (action === "raise") note += ` 主路线为主动加注，尺寸按当前 ${game.raiseCount === 0 ? "开池" : game.raiseCount === 1 ? "3-bet" : game.raiseCount === 2 ? "4-bet" : "再加注"}节点计算。`;
    else if (action === "call") note += ` 主路线为跟注，保留强牌和部分可实现权益的牌，避免把继续范围全部暴露为加注。`;
    else if (action === "check") note += ` 当前拥有免费过牌权，弱牌无需为了“主动”而制造不必要底池。`;
    else note += ` 当前牌型位于该位置与行动序列的范围外，弃牌来自翻前范围，而不是把翻后胜率公式硬套进来。`;
  } else if (toCall > 0) {
    const directPrice = Math.round(potOdds * 100);
    const realizationPrice = Math.round(policyPlan.realizationThreshold * 100);
    const estimatedEquity = Math.round(equity * 100);
    const immediateChipEv = Math.round(equity * decisionPot.finalPot - callCost);
    const realizedCallEv = Math.round(callEv ?? immediateChipEv);
    const chipEvText = terminalCall
      ? `，按可争夺底池计算的即时筹码 EV 约 ${immediateChipEv >= 0 ? "+" : ""}${immediateChipEv}`
      : `，计入约 ${Math.round(policyPlan.equityRealization * 100)}% 权益实现后的跟注 EV 代理约 ${realizedCallEv >= 0 ? "+" : ""}${realizedCallEv}`;
    const terminalCallLine = terminalCall && (action === "call" || action === "fold");
    if (terminalCallLine) {
      const squidAdjustment = game.presetKey === "squid" && ((immediateChipEv >= 0) !== (action === "call"));
      const closingLead = callCost === player.stack && canAnyOpponentRespond(game, player)
        ? "这次跟注会让你全下，之后不再有决策；按当前已形成的可争夺底池直接比较"
        : "跟注后将直接进入摊牌";
      note = `${closingLead}：当前价格需要 ${directPrice}% 权益，估算摊牌权益约 ${estimatedEquity}%${chipEvText}；${squidAdjustment ? "纯筹码 EV 与鱿鱼附加价值方向不同，当前主线已计入鱿鱼规则" : `因此${action === "call" ? "跟注是主线" : "当前权益不足，应当弃牌"}`}。`;
    } else if (player.raiseLocked) {
      note = `不足额全下没有重新开放加注权；模型只在弃牌和跟注之间重算。估算摊牌权益约 ${estimatedEquity}%，启发式继续参考线约 ${realizationPrice}%。`;
    } else if (action === "fold") {
      note = game.street === "river"
        ? `估算摊牌权益约 ${estimatedEquity}%，直接价格为 ${directPrice}%；当前倾向弃牌。`
        : `直接价格为 ${directPrice}%；再计入位置和后续行动风险，启发式继续参考线约 ${realizationPrice}%，当前倾向弃牌。`;
    } else if (action === "raise") {
      note = policyPlan.nutAdvantage >= 0.55
        ? `估算摊牌权益约 ${estimatedEquity}%，当前组合靠近价值范围顶端，主线用加注获取价值并保留少量慢打。`
        : `估算摊牌权益约 ${estimatedEquity}%；听牌、阻断牌和对手下注尺度共同支持一部分半诈唬/极化加注。`;
    } else {
      note = `直接价格为 ${directPrice}%，估算摊牌权益约 ${estimatedEquity}%；跟注保留对手诈唬，同时把部分强牌与听牌留在加注分支。`;
    }
    if (!terminalCallLine && (action === "fold" || action === "call")) note += chipEvText;
  } else if (action === "raise") {
    note = policyPlan.rangeAdvantage > 0.06 && policyPlan.nutAdvantage < 0.55
      ? `当前组合权益、位置、主动权与牌面纹理共同支持多尺度下注；中等牌力仍保留过牌保护。`
      : policyPlan.nutAdvantage >= 0.55
        ? `当前组合靠近价值范围顶端，价值下注是主线；尺度会随 SPR、牌面动态性和河牌极化程度改变。`
        : `听牌与关键阻断牌支持低到中频进攻，剩余组合进入过牌范围。`;
  } else {
    note = `当前组合更适合进入过牌分支，并为整体过牌范围保留一定强牌；并非所有可下注组合都使用同一固定频率。`;
  }
  if (game.street !== "preflop") {
    note += terminalCall && (action === "call" || action === "fold")
      ? ` 该跟注线路没有后续下注，不再叠加位置或权益实现惩罚。`
      : ` 动作混合由估算摊牌权益、价格、位置、SPR、牌面纹理、阻断牌和行动压力连续计算。`;
  }
  const excludedPot = Math.max(0, committedPot(game) - decisionPot.currentPot);
  if (toCall > 0 && excludedPot > 0) {
    note += ` 另有 ${excludedPot} 筹码属于你无资格争夺的高层边池或未匹配下注，未计入你的底池赔率。`;
  }
  if (game.presetKey === "squid") {
    note += squidCount === 0
      ? ` 你还没有鱿鱼，越接近发完，争夺主池的附加价值越高。`
      : ` 你已有 ${squidCount} 条鱿鱼，当前倍率为 ×${squidMultiplier(squidCount)}。`;
  }
  const actualStartingDepth = policyInput.startingDepthBb;
  if (actualStartingDepth <= 55) {
    note += game.street === "preflop"
      ? ` 本手起始有效 ${actualStartingDepth.toFixed(1)} BB，属于浅筹节点；面对再加注时减少纯跟注，并让强牌更频繁进入承诺线。`
      : ` 本手起始有效 ${actualStartingDepth.toFixed(1)} BB，低 SPR 下强成牌与高权益听牌可以更早进入承诺线。`;
  } else if (actualStartingDepth >= 140) {
    note += game.street === "preflop"
      ? ` 本手起始有效 ${actualStartingDepth.toFixed(1)} BB，属于深筹节点；位置、同花连张和隐含赔率更重要，但边缘牌面对再加注仍需保持纪律。`
      : ` 本手起始有效 ${actualStartingDepth.toFixed(1)} BB，深筹下边缘成牌要控制大底池，坚果优势与位置价值更高。`;
  }
  const nominalDepth = game.startingStack / BIG_BLIND;
  if (Math.abs(nominalDepth - actualStartingDepth) >= 10) {
    note += ` 桌型的补款基准是 ${nominalDepth.toFixed(0)} BB，但本手策略按实际 ${actualStartingDepth.toFixed(1)} BB 节点计算。`;
  }
  note += ` 当前双方后手：你 ${policyInput.heroStackBb.toFixed(1)} BB / ${policyInput.opponentName} ${policyInput.opponentStackBb.toFixed(1)} BB；与该对手剩余可争夺的有效筹码为 ${policyInput.effectiveStackBb.toFixed(1)} BB。`;
  if (policyInput.maxContestableBb > policyInput.effectiveStackBb + 0.05) {
    note += ` 多人底池中仍有更深对手，加注的有效上限按 ${policyInput.maxContestableBb.toFixed(1)} BB 计算。`;
  }
  const labels: Record<ActionKind, string> = { fold: "弃牌", check: "过牌", call: "跟注", raise: "加注" };
  const mix = formatFrequencyMix(
    (Object.entries(frequencies) as [ActionKind, number][])
      .map(([kind, frequency]) => ({ label: labels[kind], frequency })),
  );
  const sizingRoutes = frequencies.raise >= 0.005 && !player.raiseLocked
    ? policyPlan.sizingRoutes
    : [];
  const sizingMix = formatFrequencyMix(sizingRoutes.map((route) => ({
    label: formatPokerSizingRoute(sizingContext, route),
    frequency: route.frequency,
  })));
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
    equityRealization: policyPlan.equityRealization,
    realizationThreshold: policyPlan.realizationThreshold,
    callEv,
    heroStackBb: policyInput.heroStackBb,
    opponentStackBb: policyInput.opponentStackBb,
    opponentName: policyInput.opponentName,
    effectiveStackBb: policyInput.effectiveStackBb,
    startingDepthBb: policyInput.startingDepthBb,
    maxContestableBb: policyInput.maxContestableBb,
    spr: policyPlan.spr,
    strategySource: game.street === "preflop" ? "六人桌 169 手牌基准表" : "行动加权范围启发式模型",
    preflopPosition: policyPlan.preflopPosition,
    preflopScenario: PREFLOP_SCENARIO_LABELS[policyPlan.preflopScenario],
    preflopTargetRange: policyPlan.preflopTargetRange,
    preflopEnterFrequency: policyPlan.preflopEnterFrequency,
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

function createSoloHistoryRunId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `solo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function fallbackHistoryActionText(action: PublicBettingAction, playerName: string) {
  if (action.kind === "fold") return `${playerName} 弃牌`;
  if (action.kind === "check") return `${playerName} 过牌`;
  if (action.kind === "call") return `${playerName} ${action.isAllIn ? "全下跟注" : "跟注"} ${action.amount}`;
  return `${playerName} ${action.isAllIn ? "全下加注" : "加注"} · 本次投入 ${action.amount}`;
}

function buildSoloHandHistoryEntry(game: Game, mode: GameMode, runId: string): PokerHandHistoryEntry {
  const chronologicalLog = [...game.log].reverse();
  const actionLines = chronologicalLog.filter((line) => (
    / (?:弃牌|过牌|跟注|加注至|全下至|全下跟注|不足额全下)(?: |$)/.test(line)
  ));
  const actions: PokerHistoryAction[] = game.actionHistory.map((action, index) => ({
    playerId: action.playerId,
    street: action.street,
    kind: action.kind,
    amount: action.amount,
    toCall: action.toCall,
    stackBefore: action.stackBefore,
    potBefore: action.potBefore,
    isAllIn: action.isAllIn,
    description: actionLines[index] ?? fallbackHistoryActionText(action, game.players[action.playerId]?.name ?? `座位 ${action.playerId + 1}`),
  }));
  const returned = game.returns.reduce((sum, entry) => sum + entry.amount, 0);
  const payoutTotal = game.payouts.reduce((sum, entry) => sum + entry.amount, 0);
  const contributed = game.players.reduce((sum, player) => sum + player.contributed, 0);
  return {
    id: `${runId}:${game.handNo}`,
    runId,
    hand: game.handNo,
    completedAt: Date.now(),
    mode,
    presetKey: game.presetKey,
    result: game.result,
    finalStreet: game.street,
    totalPot: payoutTotal || Math.max(0, contributed - returned),
    board: game.community.map((card) => ({ ...card })),
    dealer: game.dealer,
    winnerIds: [...game.winnerIds],
    mainPotWinnerIds: [...game.mainPotWinnerIds],
    payouts: game.payouts.map((entry) => ({ ...entry })),
    returns: game.returns.map((entry) => ({ ...entry })),
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      monogram: player.monogram,
      hole: player.hole.map((card) => ({ ...card })),
      folded: player.folded,
      contributed: player.contributed,
      stack: player.stack,
      isHuman: player.isHuman,
    })),
    actions,
    log: chronologicalLog,
  };
}

function historySeatRole(playerId: number, dealer: number, playerCount: number) {
  if (playerId === dealer) return "D";
  if (playerId === (dealer + 1) % playerCount) return "SB";
  if (playerId === (dealer + 2) % playerCount) return "BB";
  return "";
}

function historyModeLabel(mode: GameMode) {
  if (mode === "session") return "20 手整局";
  if (mode === "endless") return "无尽对局";
  return "逐手训练";
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
  const privatelyPeeked = game.peekedPlayerIds.includes(player.id);
  const reveal = game.status === "showdown" && revealReady && (game.shownPlayerIds.includes(player.id) || privatelyPeeked);
  const isCurrent = game.current === index;
  const role = index === game.dealer ? "D" : index === (game.dealer + 1) % 6 ? "SB" : index === (game.dealer + 2) % 6 ? "BB" : "";
  return (
    <div className={`player-seat seat-${index} ${isCurrent ? "is-current" : ""} ${player.folded ? "is-folded" : ""} ${privatelyPeeked ? "is-private-peek" : ""}`}>
      <div className={`seat-cards ${reveal || player.isHuman ? "is-revealed" : ""}`} aria-label={privatelyPeeked ? `你私下偷看的 ${player.name} 手牌` : reveal ? `${player.name} 的手牌` : `${player.name} 的手牌未公开`}>
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
      {privatelyPeeked && <div className="private-peek-label">偷看 · 仅你可见</div>}
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
          const privatelyPeeked = game.peekedPlayerIds.includes(player.id);
          const visibleToHero = player.isHuman || publiclyShown || privatelyPeeked;
          const cards = [...game.community, ...player.hole];
          const bestFive = visibleToHero && cards.length >= 5 ? bestHandWithCards(cards) : null;
          const displayedCards = bestFive?.cards ?? player.hole;
          const holeCardKeys = new Set(player.hole.map(cardKey));
          const handName = bestFive
            ? `${game.endedUncontested ? "未摊牌赢池 · " : ""}${bestFive.name}`
            : game.endedUncontested ? "未摊牌赢池" : "公开底牌";
          const payout = game.payouts.find((entry) => entry.playerId === player.id)?.amount ?? 0;
          const potLabel = game.mainPotWinnerIds.includes(player.id) ? "主池" : "边池";
          return (
            <article className="winning-hand" key={player.id}>
              <div className="winning-hand-player">
                <strong>{player.name}</strong>
                <span>{visibleToHero ? handName : "手牌未公开"}</span>
                <em>{potLabel} +{payout}{privatelyPeeked ? " · 偷看，仅你可见" : player.isHuman && !publiclyShown ? " · 仅你可见" : ""}</em>
              </div>
              {visibleToHero ? (
                <div className="winning-hand-card-group">
                  <span>{bestFive ? "BEST FIVE · 最佳五张" : "公开底牌 · 未形成五张牌"}</span>
                  <div
                    className={`winning-hand-cards ${bestFive ? "is-best-five" : "is-hole-only"}`}
                    aria-label={bestFive
                      ? `${player.name} 的最佳五张：${displayedCards.map((card) => `${cardText(card)}（${holeCardKeys.has(cardKey(card)) ? "底牌" : "公共牌"}）`).join("、")}`
                      : `${player.name} 的公开底牌`}
                  >
                    {displayedCards.map((card) => {
                      const source = holeCardKeys.has(cardKey(card)) ? "hole" : "board";
                      return (
                        <div className="winning-card-source" data-source={source} key={cardKey(card)}>
                          <PlayingCard card={card} />
                          <small>{source === "hole" ? "底牌" : "公共"}</small>
                        </div>
                      );
                    })}
                  </div>
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

function PrivatePeekOpportunity({ game, onPeek }: { game: Game; onPeek: (playerId: number) => void }) {
  if (game.status !== "showdown" || !game.showChoiceMade) return null;
  const peekedPlayer = game.peekedPlayerIds.length
    ? game.players.find((player) => player.id === game.peekedPlayerIds[0])
    : undefined;
  const candidates = pokerPrivatePeekCandidateIds(game.players, game.shownPlayerIds);

  return (
    <section className={`private-peek ${peekedPlayer ? "is-used" : ""}`} aria-label="牌后私密偷看机会">
      <div className="private-peek-copy">
        <span>PRIVATE PEEK · 每手一次</span>
        <strong>{peekedPlayer ? `偷看到 ${peekedPlayer.name}` : candidates.length ? "选择一位未公开手牌的电脑" : "本手其余手牌均已公开"}</strong>
        <small>只对你可见，不算公开亮牌，也不会改变 AI 对你的画像。</small>
      </div>
      {peekedPlayer ? (
        <div className="private-peek-result">
          <div className="private-peek-cards">
            {peekedPlayer.hole.map((card) => <PlayingCard key={cardKey(card)} card={card} />)}
          </div>
          <em>机会已使用</em>
        </div>
      ) : candidates.length ? (
        <div className="private-peek-targets">
          {candidates.map((playerId) => {
            const player = game.players.find((candidate) => candidate.id === playerId)!;
            return <button key={player.id} type="button" onClick={() => onPeek(player.id)}>偷看 {player.name}</button>;
          })}
        </div>
      ) : (
        <div className="private-peek-empty">无需偷看</div>
      )}
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

const LANDING_GUIDE_ITEMS = [
  {
    index: "01",
    eyebrow: "TABLE DEPTH",
    title: "四种桌型",
    text: "浅筹、标准、深筹分别以 40 / 100 / 200 BB 开始；血战鱿鱼以 200 BB 开始。筹码跨手延续，每手策略按当时双方的实际有效筹码计算。",
  },
  {
    index: "02",
    eyebrow: "TRAINING FLOW",
    title: "三种训练",
    text: "逐手训练即时点评；常规整局固定 20 手；无尽模式保留筹码、对手与玩家画像，主动结束后统计累计收益和 BB/100。浏览器保存最近 30 手牌谱。",
  },
  {
    index: "03",
    eyebrow: "SQUID SIDE GAME",
    title: "血战鱿鱼",
    text: "六人桌争夺 9 条鱿鱼，持有 3 / 5 / 7 条时触发 ×2 / ×3 / ×4。无人跟注时必须亮牌才能获得，主池平分则不发。",
  },
  {
    index: "04",
    eyebrow: "STRATEGY BOUNDARY",
    title: "完整 GTO 的边界",
    text: "当前是 169 手牌基准表、行动加权范围与连续混频构成的本地近似策略，不冒充求解器精确解。任意六人动态牌局仍需要预计算策略库或外部求解服务。",
  },
  {
    index: "05",
    eyebrow: "TABLE IMAGE",
    title: "形象与适应",
    text: "你和电脑都可以选择亮牌或盖牌。电脑会从公开行动形成对你松紧、侵略性与欺骗性的判断；无尽模式会随样本增加持续调整反制。",
  },
  {
    index: "06",
    eyebrow: "RULE COVERAGE",
    title: "支持的规则范围",
    text: "六人无限注现金桌、主池与边池、全下跑牌、未跟注筹码退回和不足额全下后的加注权都按牌局状态处理；鱿鱼结算属于额外训练玩法。",
  },
  {
    index: "07",
    eyebrow: "INSTALL APP",
    title: "安装成应用",
    text: "Chrome 或 Edge 可点牌桌顶栏“安装应用”；Mac Safari 使用“添加到程序坞”，iPhone / iPad 使用“添加到主屏幕”。",
  },
  {
    index: "08",
    eyebrow: "OPEN ANYWHERE",
    title: "直接在线打开",
    text: "正式网址无需启动本地服务器。安装完成后可以像普通软件一样从桌面、程序坞或手机主屏幕直接进入。",
  },
] as const;

const POKER_HAND_RANKS = [
  ["01", "同花顺", "同一花色的五张连续牌；A-K-Q-J-10 是最大的同花顺"],
  ["02", "四条", "四张相同点数的牌，再比较第五张踢脚牌"],
  ["03", "葫芦", "三张相同点数加一对；先比较三条的点数"],
  ["04", "同花", "五张同一花色但不连续，从最高张依次比较"],
  ["05", "顺子", "五张连续点数、花色不限；A-2-3-4-5 是最小顺子"],
  ["06", "三条", "三张相同点数，再依次比较两张踢脚牌"],
  ["07", "两对", "先比较较大的一对，再比较较小的一对和踢脚牌"],
  ["08", "一对", "一组对子，再依次比较三张踢脚牌"],
  ["09", "高牌", "没有组成以上牌型时，从最高张开始依次比较"],
] as const;

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
          <a href="#about-range-craft">训练说明</a>
          <a href={multiplayerHref}>多人模式</a>
          <a className="landing-account-link" href={multiplayerHref}>免注册入桌</a>
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
            <div><span>LIVE TRAINING</span><strong>标准现金 · 初始 100 BB</strong></div>
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
            <div><span>估算摊牌权益</span><strong>48%</strong></div>
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
            <div><small>LOCAL TRAINING</small><h3>单人训练</h3><p>浅筹、标准、深筹与血战鱿鱼；电脑风格每桌随机，支持逐手、整局与画像自适应无尽对局。</p></div>
            <strong>立即开始 <span>→</span></strong>
          </a>
          <a className="landing-mode-card multiplayer" href={multiplayerHref}>
            <span className="mode-index">02</span>
            <div><small>ONLINE TABLE</small><h3>多人模式</h3><p>只填一个昵称就能创建或加入私人牌桌；邀请码、筹码和底牌由服务器保护。</p></div>
            <strong>前往大厅 <span>↗</span></strong>
          </a>
        </div>
      </section>

      <section className="landing-about" id="about-range-craft" aria-labelledby="about-heading">
        <div className="landing-about-heading">
          <div>
            <span>ABOUT RANGECRAFT</span>
            <h2 id="about-heading">开始之前，先知道这里能练什么。</h2>
          </div>
          <p>训练模式、策略边界、规则覆盖和安装方式都放在主页。进入牌桌后，“？”只负责解释真正的德州扑克规则。</p>
        </div>
        <div className="landing-about-grid">
          {LANDING_GUIDE_ITEMS.map((item) => (
            <article className="landing-about-card" key={item.index}>
              <div><span>{item.index}</span><small>{item.eyebrow}</small></div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
        <div className="landing-about-cta">
          <div><span>READY TO PRACTICE</span><strong>规则看懂以后，用真实决策把它练成习惯。</strong></div>
          <button type="button" onClick={onEnterSolo}>进入单人训练 <span>→</span></button>
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
  const [rulesOpen, setRulesOpen] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [soundOn, setSoundOn] = useState(() => isPokerAudioEnabled());
  const [mode, setMode] = useState<GameMode>("per_hand");
  const [sessionEnded, setSessionEnded] = useState(false);
  const [sessionResults, setSessionResults] = useState<SessionHandResult[]>([]);
  const [runDecisionStats, setRunDecisionStats] = useState(createPokerRunDecisionStats);
  const [heroImage, setHeroImage] = useState<TableImage>({ loose: 0.5, aggressive: 0.5, deceptive: 0.5, observations: 0 });
  const [handHistory, setHandHistory] = useState<PokerHandHistoryEntry[]>([]);
  const [sealedRunHistory, setSealedRunHistory] = useState<PokerHandHistoryEntry[]>([]);
  const [historyHydrated, setHistoryHydrated] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [replayStep, setReplayStep] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [appInstalled, setAppInstalled] = useState(() => typeof window !== "undefined" && (
    window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  ));
  const winSoundHand = useRef(0);
  const observedShowdownImageHand = useRef(0);
  const soundOnRef = useRef(isPokerAudioEnabled());
  const historyRunId = useRef(createSoloHistoryRunId());

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
    const timer = window.setTimeout(() => {
      setHandHistory(parsePokerHandHistoryJson(window.localStorage.getItem(POKER_HAND_HISTORY_STORAGE_KEY)));
      setHistoryHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!historyHydrated) return;
    try {
      window.localStorage.setItem(POKER_HAND_HISTORY_STORAGE_KEY, JSON.stringify(handHistory));
    } catch {
      // The trainer still works if browser storage is disabled or full.
    }
  }, [handHistory, historyHydrated]);

  useEffect(() => {
    if (!sessionEnded || sealedRunHistory.length === 0) return;
    const timer = window.setTimeout(() => {
      setHandHistory((entries) => mergePokerHandHistory(entries, sealedRunHistory));
      setSealedRunHistory([]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sessionEnded, sealedRunHistory]);

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
  const opponentCanRespond = Boolean(game && human && canAnyOpponentRespond(game, human));
  const raiseDisabled = !game
    || maxTarget <= game.highestBet
    || !isHumanTurn
    || !opponentCanRespond
    || Boolean(human?.raiseLocked);
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

  const recordRunHand = useCallback((finishedGame: Game) => {
    if (mode === "per_hand" || finishedGame.status !== "showdown" || !finishedGame.showChoiceMade) return;
    const entry = buildSessionHandResult(finishedGame, review);
    setSessionResults((items) => upsertPokerRunHand(items, entry, POKER_RUN_HAND_HISTORY_LIMIT));
  }, [mode, review]);

  const recordSoloHandHistory = useCallback((finishedGame: Game) => {
    if (finishedGame.status !== "showdown" || !finishedGame.showChoiceMade) return;
    const entry = buildSoloHandHistoryEntry(finishedGame, mode, historyRunId.current);
    if (mode === "per_hand") {
      setHandHistory((items) => upsertPokerHandHistory(items, entry));
    } else {
      // Full hole cards for review runs stay in memory until the run is over.
      // A refresh therefore cannot turn an unfinished 20-hand/endless run into
      // an unlocked per-hand record.
      setSealedRunHistory((items) => upsertPokerHandHistory(items, entry));
    }
  }, [mode]);

  useEffect(() => {
    if (game?.status === "showdown" && !dealing) {
      const timer = window.setTimeout(() => {
        recordRunHand(game);
        if (game.showChoiceMade) recordSoloHandHistory(game);
        if (mode === "per_hand" && game.showChoiceMade) setShowLog(true);
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
  }, [game, dealing, mode, recordRunHand, recordSoloHandHistory]);

  useEffect(() => {
    if (
      !game
      || dealing
      || game.status !== "showdown"
      || game.endedUncontested
      || !game.shownPlayerIds.includes(0)
      || observedShowdownImageHand.current === game.handNo
    ) return;
    observedShowdownImageHand.current = game.handNo;
    const strength = visibleHandStrength(game.players[0], game.community);
    const heroRaised = game.actionHistory.some((action) => action.playerId === 0 && action.kind === "raise");
    setHeroImage((image) => updateHeroTableImage(image, {
      loose: strength < 0.45 ? 0.72 : strength > 0.72 ? 0.38 : 0.52,
      deceptive: heroRaised && strength < 0.45 ? 0.86 : heroRaised && strength > 0.72 ? 0.34 : 0.5,
    }));
  }, [game, dealing]);

  useEffect(() => {
    if (!isHumanTurn || maxTarget <= 0) return;
    const timer = window.setTimeout(() => setRaiseTo(Math.max(minTarget, Math.min(maxTarget, Math.max(30, minTarget)))), 0);
    return () => window.clearTimeout(timer);
  }, [isHumanTurn, minTarget, maxTarget, game?.street]);

  const equity = useMemo(() => {
    if (!game || !human || !isHumanTurn) return 0;
    return currentEquity(game, human, game.street === "preflop" ? 600 : 1_200);
  }, [game, human, isHumanTurn]);

  const advice = useMemo(() => (game && human && isHumanTurn ? getAdvice(game, human, equity) : null), [game, human, isHumanTurn, equity]);

  useEffect(() => {
    if (!game || dealing || game.status !== "playing" || game.current < 0) return;
    const player = game.players[game.current];
    if (!player || player.isHuman) return;
    const timer = window.setTimeout(() => {
      const decision = chooseAiAction(game, player, heroImage, mode);
      if (soundOn) playPokerSound(decision.kind);
      setGame((current) => {
        if (!current || current.handNo !== game.handNo || current.status !== "playing" || current.current !== player.id) return current;
        return act(current, player.id, decision.kind, decision.raiseTo);
      });
    }, 520 + Math.random() * 620);
    return () => window.clearTimeout(timer);
  }, [game, dealing, soundOn, heroImage, mode]);

  const startNextHand = useCallback(() => {
    if (!pokerRunCanStartNextHand(mode, sessionEnded, game ? isSessionComplete(game) : false)) return;
    if (game) {
      recordRunHand(game);
      recordSoloHandHistory(game);
    }
    setFeedback(null);
    setShowLog(false);
    setGame((current) => freshGame(current ?? undefined, {
      resetStacks: false,
      shuffleStyles: false,
    }));
  }, [mode, sessionEnded, game, recordRunHand, recordSoloHandHistory]);

  const finishEndlessRun = useCallback(() => {
    if (mode !== "endless" || !game || game.status !== "showdown" || !game.showChoiceMade || sessionEnded) return;
    recordRunHand(game);
    recordSoloHandHistory(game);
    setSessionEnded(true);
    setShowLog(true);
  }, [mode, game, sessionEnded, recordRunHand, recordSoloHandHistory]);

  const resetRun = useCallback((nextMode: GameMode, nextPreset: TablePresetKey) => {
    setMode(nextMode);
    setTraining(nextMode === "per_hand");
    setReview([]);
    setFeedback(null);
    setShowLog(false);
    setSessionEnded(false);
    setSessionResults([]);
    setSealedRunHistory([]);
    setHistoryOpen(false);
    setSelectedHistoryId(null);
    setReplayPlaying(false);
    setReplayStep(0);
    setRunDecisionStats(createPokerRunDecisionStats());
    setHeroImage({ loose: 0.5, aggressive: 0.5, deceptive: 0.5, observations: 0 });
    setDealing(false);
    setRaiseTo(BIG_BLIND * 3);
    winSoundHand.current = 0;
    observedShowdownImageHand.current = 0;
    historyRunId.current = createSoloHistoryRunId();
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
    if (nextMode === mode || (currentPresetKey === "squid" && nextMode !== "session")) return;
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
    setHeroImage((image) => updateHeroTableImage(image, {
      loose: show && strength < 0.45 ? 0.78 : show ? 0.38 : 0.52,
      deceptive: show && strength < 0.45 ? 0.92 : show ? 0.28 : 0.62,
    }));
    setGame(setHeroShowChoice(game, show));
  }, [game]);

  const choosePrivatePeek = useCallback((playerId: number) => {
    setGame((current) => current ? privatelyPeekOpponent(current, playerId) : current);
  }, []);

  const handleAction = useCallback((kind: ActionKind) => {
    if (!game || !human || !isHumanTurn || !advice) return;
    if (soundOn) void unlockPokerAudio().then((ready) => { if (ready) playPokerSound(kind); });
    const bestFrequency = Math.max(...Object.values(advice.frequencies));
    const selectedFrequency = advice.frequencies[kind];
    const relativeFrequency = selectedFrequency / Math.max(0.001, bestFrequency);
    const actionScore = selectedFrequency > 0 ? Math.round(40 + 60 * relativeFrequency) : 30;
    const actionVerdict = selectedFrequency <= 0.005
      ? "当前模型不支持"
      : relativeFrequency >= 0.78
        ? "主频路线"
        : relativeFrequency >= 0.28 || selectedFrequency >= 0.15
          ? "可接受混合"
          : "低频路线";
    const sizingContext = pokerSizingContext(game, human);
    const actualRaiseTo = kind === "raise" ? legalPokerRaiseTarget(sizingContext, raiseTo) : null;
    const actualBetFraction = actualRaiseTo === null ? null : pokerRaiseFraction(sizingContext, actualRaiseTo);
    const sizeScore = actualRaiseTo === null
      ? null
      : scorePokerRaiseSize(sizingContext, actualRaiseTo, advice.sizingRoutes);
    const sizeVerdict = actualRaiseTo === null
      ? ""
      : pokerRaiseSizeVerdict(sizingContext, actualRaiseTo, advice.sizingRoutes);
    // A correct conditional size cannot rescue an action that barely exists in
    // the strategy. Size therefore adjusts the action score downward only.
    const score = sizeScore === null
      ? actionScore
      : Math.round(actionScore * (0.65 + 0.35 * sizeScore / 100));
    const actionLabel = actualRaiseTo === null
      ? ACTION_LABELS[kind]
      : formatPokerSizingRoute(sizingContext, {
          target: actualRaiseTo,
          fraction: actualBetFraction ?? 0,
          frequency: 1,
          allIn: actualRaiseTo === sizingContext.playerBet + sizingContext.playerStack,
        });
    const entry: Review = {
      id: Date.now(),
      hand: game.handNo,
      streetKey: game.street,
      street: STREET_LABELS[game.street],
      cards: human.hole.map(cardText).join(" "),
      board: game.community.length ? game.community.map(cardText).join(" ") : "—",
      pot: committedPot(game),
      toCall,
      equity,
      potOdds: advice.potOdds,
      equityRealization: advice.equityRealization,
      realizationThreshold: advice.realizationThreshold,
      callEv: advice.callEv,
      heroStackBb: advice.heroStackBb,
      opponentStackBb: advice.opponentStackBb,
      opponentName: advice.opponentName,
      effectiveStackBb: advice.effectiveStackBb,
      startingDepthBb: advice.startingDepthBb,
      maxContestableBb: advice.maxContestableBb,
      spr: advice.spr,
      strategySource: advice.strategySource,
      preflopPosition: advice.preflopPosition,
      preflopScenario: advice.preflopScenario,
      preflopTargetRange: advice.preflopTargetRange,
      preflopEnterFrequency: advice.preflopEnterFrequency,
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
      selectedFrequency,
      actionVerdict,
      score,
      note: advice.note,
    };
    setReview((items) => [entry, ...items].slice(0, POKER_RUN_DECISION_HISTORY_LIMIT));
    setRunDecisionStats((stats) => recordPokerRunDecision(stats, game.street, score));
    setFeedback(mode === "per_hand" ? entry : null);
    setHeroImage((image) => {
      const looseSignal = kind === "fold" ? 0.18 : kind === "check" ? 0.4 : kind === "call" ? 0.68 : 0.78;
      const aggressionSignal = kind === "raise" ? 0.9 : kind === "fold" ? 0.34 : 0.24;
      return updateHeroTableImage(image, { loose: looseSignal, aggressive: aggressionSignal });
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
      setInstallHelpOpen(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setAppInstalled(true);
    setInstallPrompt(null);
  }, [installPrompt]);

  const availableHandHistory = useMemo(() => (
    sessionEnded && sealedRunHistory.length
      ? mergePokerHandHistory(handHistory, sealedRunHistory)
      : handHistory
  ), [handHistory, sealedRunHistory, sessionEnded]);
  const selectedHistory = useMemo(() => (
    availableHandHistory.find((entry) => entry.id === selectedHistoryId) ?? availableHandHistory[0] ?? null
  ), [availableHandHistory, selectedHistoryId]);
  const historyReviewUnlocked = mode === "per_hand"
    ? Boolean(game && game.status === "showdown" && !dealing && game.showChoiceMade)
    : sessionEnded;
  const historyAccessUnlocked = availableHandHistory.length > 0 && historyReviewUnlocked;
  const replayState = useMemo(() => (
    selectedHistory ? pokerReplayEventsAtStep(selectedHistory, replayStep) : null
  ), [selectedHistory, replayStep]);
  const replayEventCount = replayState?.events.length ?? 0;

  const selectHistoryHand = useCallback((entry: PokerHandHistoryEntry) => {
    setSelectedHistoryId(entry.id);
    setReplayPlaying(false);
    setReplayStep(Math.max(0, buildPokerReplayEvents(entry).length - 1));
  }, []);

  const openHandHistory = useCallback((entryId?: string) => {
    if (!historyAccessUnlocked) return;
    const entry = availableHandHistory.find((item) => item.id === entryId) ?? availableHandHistory[0];
    if (!entry) return;
    selectHistoryHand(entry);
    setHistoryOpen(true);
  }, [availableHandHistory, historyAccessUnlocked, selectHistoryHand]);

  const closeHandHistory = useCallback(() => {
    setHistoryOpen(false);
    setReplayPlaying(false);
  }, []);

  useEffect(() => {
    if (!historyOpen || !replayPlaying || replayEventCount <= 0) return;
    const timer = window.setTimeout(() => {
      setReplayStep((step) => {
        if (step >= replayEventCount - 1) {
          setReplayPlaying(false);
          return step;
        }
        return step + 1;
      });
    }, 850);
    return () => window.clearTimeout(timer);
  }, [historyOpen, replayPlaying, replayEventCount, replayStep]);

  useEffect(() => {
    if (!historyOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeHandHistory();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeHandHistory, historyOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (historyOpen) return;
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
  }, [game, dealing, isHumanTurn, toCall, raiseDisabled, handleAction, startNextHand, mode, historyOpen]);

  if (!game || !human) {
    return (
      <main className="loading-screen">
        <div className="brand-mark">P</div>
        <span>正在洗牌…</span>
      </main>
    );
  }

  const handFinished = game.status === "showdown" && !dealing;
  const isReviewRun = mode !== "per_hand";
  const sessionScore = runDecisionStats.count
    ? Math.round(runDecisionStats.scoreTotal / runDecisionStats.count)
    : "—";
  const handReview = review.filter((item) => item.hand === game.handNo);
  const handScore = handReview.length ? Math.round(handReview.reduce((sum, item) => sum + item.score, 0) / handReview.length) : "—";
  const reviewUnlocked = historyReviewUnlocked;
  const reportReview = [...(mode === "per_hand" ? handReview : review)].reverse();
  const reportScore = mode === "per_hand" ? handScore : sessionScore;
  const completedHands = isReviewRun
    ? Math.max(0, handFinished ? game.handNo : game.handNo - 1)
    : game.handNo;
  const squidAwarded = game.squid.total - game.squid.remaining;
  const sessionProgressDone = game.presetKey === "squid" ? squidAwarded : Math.min(completedHands, SESSION_HANDS);
  const sessionProgressGoal = game.presetKey === "squid" ? game.squid.total : SESSION_HANDS;
  const sessionIsComplete = mode === "session" && isSessionComplete(game);
  const heroNet = human.stack - game.cashInvested[0];
  const heroNetBb = heroNet / BIG_BLIND;
  const heroBbPer100 = pokerRunBbPer100(heroNet, BIG_BLIND, completedHands);
  const showDecisionPending = handFinished && game.endedUncontested && game.winnerIds[0] === 0 && !game.showChoiceMade;
  const imageLabel = (value: number, low: string, middle: string, high: string) => value < 0.42 ? low : value > 0.58 ? high : middle;
  const streetScores = (["翻牌前", "翻牌", "转牌", "河牌"] as const).map((street) => {
    const streetKey = ({ 翻牌前: "preflop", 翻牌: "flop", 转牌: "turn", 河牌: "river" } as const)[street];
    const aggregate = runDecisionStats.byStreet[streetKey];
    const items = handReview.filter((item) => item.street === street);
    const count = isReviewRun ? aggregate.count : items.length;
    const score = count
      ? Math.round((isReviewRun ? aggregate.scoreTotal : items.reduce((sum, item) => sum + item.score, 0)) / count)
      : null;
    return { street, count, score };
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
          <span>{TABLE_PRESETS[game.presetKey].shortLabel} · {mode === "session"
            ? game.presetKey === "squid" ? `第 ${game.handNo} 手 · 剩余 ${game.squid.remaining} 条` : `${Math.min(game.handNo, SESSION_HANDS)} / ${SESSION_HANDS} 手`
            : mode === "endless" ? `无尽对局 · 第 ${game.handNo} 手` : `第 ${game.handNo} 手`}</span>
        </div>
        <div className="header-actions">
          <button
            className="hand-history-button"
            type="button"
            onClick={() => openHandHistory()}
            disabled={!historyAccessUnlocked}
            title={!historyReviewUnlocked
              ? mode === "per_hand" ? "本手结束后可查看完整牌谱" : "本轮结束后解锁完整牌谱"
              : availableHandHistory.length === 0 ? "完成一手后开始记录" : "查看本地最近 30 手牌谱"}
            aria-label={historyAccessUnlocked ? `查看最近 ${availableHandHistory.length} 手牌谱` : "牌谱尚未解锁"}
          >
            <span>↺</span><b>牌谱</b><em>{availableHandHistory.length}/{POKER_HAND_HISTORY_LIMIT}</em>
          </button>
          {!appInstalled && (
            <button className="install-app-button" onClick={() => void installApp()} aria-label="把 RangeCraft 安装到桌面">
              <span>↓</span><b>安装应用</b>
            </button>
          )}
          <button className={`sound-toggle ${soundOn ? "on" : ""}`} onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? "关闭牌桌音效" : "开启牌桌音效"}>
            <span>{soundOn ? "♪" : "—"}</span><b>音效</b><em>{soundOn ? "ON" : "OFF"}</em>
          </button>
          <button
            className={`training-toggle ${training && !isReviewRun ? "on" : ""}`}
            onClick={() => setTraining((value) => !value)}
            disabled={isReviewRun}
            title={mode === "session"
              ? game.presetKey === "squid" ? "鱿鱼整局在 9 条发完后统一点评" : "整局模式在第 20 手后统一点评"
              : mode === "endless" ? "无尽对局在你主动结束后统一点评" : undefined}
          >
            <span>{isReviewRun ? "赛后点评" : "训练提示"}</span><b>{isReviewRun ? "LOCK" : training ? "ON" : "OFF"}</b>
          </button>
          <button className="icon-button" aria-label="查看德州扑克规则" title="德州扑克规则" onClick={() => setRulesOpen(true)}>?</button>
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
                  className={mode === "per_hand" ? "active" : ""}
                  aria-pressed={mode === "per_hand"}
                  onClick={() => switchMode("per_hand")}
                  disabled={currentPresetKey === "squid"}
                  title={currentPresetKey === "squid" ? "血战鱿鱼需要跨手记录，使用整局模式" : undefined}
                >
                  <b>逐手训练</b><span>筹码延续 · 每手即时点评</span>
                </button>
                <button className={mode === "session" ? "active" : ""} aria-pressed={mode === "session"} onClick={() => switchMode("session")}>
                  <b>{currentPresetKey === "squid" ? "鱿鱼整局" : "20 手整局"}</b><span>{currentPresetKey === "squid" ? "9 条发完统一点评" : "结束后统一点评"}</span>
                </button>
                <button
                  className={mode === "endless" ? "active" : ""}
                  aria-pressed={mode === "endless"}
                  onClick={() => switchMode("endless")}
                  disabled={currentPresetKey === "squid"}
                  title={currentPresetKey === "squid" ? "血战鱿鱼有固定结算终点，使用鱿鱼整局模式" : undefined}
                >
                  <b>无尽对局</b><span>画像自适应 · 主动结束复盘</span>
                </button>
              </div>
            </div>
            <div className="table-status-row">
              {mode === "session" && <div className="session-progress"><i style={{ width: `${sessionProgressDone / Math.max(1, sessionProgressGoal) * 100}%` }} /><span>{sessionProgressDone}/{sessionProgressGoal}</span></div>}
              {mode === "endless" && (
                <div className="endless-run-status">
                  <span>∞ 无尽对局</span><b>已完成 {completedHands} 手</b><em>当前净收益 {heroNet >= 0 ? "+" : ""}{heroNet}</em>
                </div>
              )}
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
                  <span>{mode === "session"
                    ? game.presetKey === "squid" ? `第 ${game.handNo} 手 · 本轮已发 ${squidAwarded}/${game.squid.total}` : `整局进度 ${Math.min(game.handNo, SESSION_HANDS)}/${SESSION_HANDS}`
                    : mode === "endless" ? `无尽对局 · 已完成 ${game.handNo} 手` : "本手结束"}</span>
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
                ) : mode === "endless" && sessionEnded ? (
                  <button className="next-hand-button" onClick={() => setShowLog(true)}>查看无尽对局复盘</button>
                ) : mode === "endless" ? (
                  <div className="endless-hand-actions">
                    <button className="next-hand-button" onClick={startNextHand}>下一手 · 筹码延续 <kbd>N</kbd></button>
                    <button className="finish-endless-button" onClick={finishEndlessRun}>结束无尽局并复盘</button>
                  </div>
                ) : (
                  <button className="next-hand-button" onClick={startNextHand}>下一手 · 筹码延续 <kbd>N</kbd></button>
                )}
                <PrivatePeekOpportunity game={game} onPeek={choosePrivatePeek} />
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
                  <button
                    className="action-button raise"
                    onClick={() => handleAction("raise")}
                    disabled={raiseDisabled}
                    title={human.raiseLocked
                      ? "不足额全下未重新开放加注权"
                      : !opponentCanRespond ? "所有对手都已全下，不能继续加注" : undefined}
                  >加注至 {raiseTo} <kbd>R</kbd></button>
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
              <strong>{isReviewRun && !sessionEnded ? "—" : reportScore}</strong>
              <span>{isReviewRun ? sessionEnded ? mode === "endless" ? "长期匹配度" : "整局匹配度" : "赛后评分" : "本手匹配度"}</span>
            </div>
          </div>

          <div className="tabs" role="tablist">
            <button className={!showLog ? "active" : ""} onClick={() => setShowLog(false)}>{mode === "session" ? "整局进行中" : mode === "endless" ? "无尽对局中" : "实时教练"}</button>
            <button className={showLog ? "active" : ""} onClick={() => setShowLog(true)} aria-disabled={!reviewUnlocked}>
              {mode === "session"
                ? game.presetKey === "squid" ? `鱿鱼复盘 · ${squidAwarded}/${game.squid.total}` : `整局复盘 · ${completedHands}/${SESSION_HANDS}`
                : mode === "endless" ? `无尽复盘 · ${completedHands} 手` : `本手复盘${reviewUnlocked ? " · 已解锁" : ""}`}
            </button>
          </div>

          {!showLog ? isReviewRun ? (
            <div className="analysis-content session-live">
              <section className="session-lock">
                <div className="lock-orbit">◇</div>
                <span>SESSION REVIEW LOCKED</span>
                <h3>{mode === "endless"
                  ? "答案留到你主动结束之后"
                  : game.presetKey === "squid" ? "答案留到 9 条鱿鱼发完之后" : "答案留到第 20 手之后"}</h3>
                <p>{mode === "endless"
                  ? "无尽模式不显示实时胜率、推荐动作、决策分数和对手类型；电脑会持续学习你的公开行为，但具体画像只在结束后公开。"
                  : "整局模式不显示实时胜率、推荐动作、决策分数和对手类型，避免答案影响你的下一次判断。"}</p>
                {mode === "endless" ? (
                  <div className="session-progress-card endless-progress-card">
                    <div><b>{completedHands}</b><span>已完成</span></div>
                    <i><em /></i>
                    <strong>∞</strong>
                  </div>
                ) : (
                  <div className="session-progress-card">
                    <div><b>{sessionProgressDone}</b><span>{game.presetKey === "squid" ? "已发出" : "已完成"}</span></div>
                    <i><em style={{ width: `${sessionProgressDone / Math.max(1, sessionProgressGoal) * 100}%` }} /></i>
                    <strong>{sessionProgressGoal}</strong>
                  </div>
                )}
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
                <div><b>桌上形象正在形成</b><p>AI 会根据你的松紧、侵略性和亮牌行为渐进调整应对；样本越多，反制越稳定，具体画像只在结束后公开。</p></div>
              </section>
            </div>
          ) : (
            <div className="analysis-content">
              <section className="equity-card">
                <div className="section-label"><span>牌面与行动范围</span><b>{isHumanTurn ? "RANGE" : "WAIT"}</b></div>
                <div className="equity-main">
                  <div className="equity-number"><strong>{isHumanTurn ? Math.round(equity * 100) : "—"}</strong><span>%<br />估算权益</span></div>
                  <div className="equity-bars">
                    <span><i style={{ width: `${isHumanTurn ? equity * 100 : 0}%` }} /></span>
                    <div><b>你的手牌</b><em>{human.hole.map(cardText).join("  ")}</em></div>
                  </div>
                </div>
                <div className="metric-grid">
                  <div><span>底池赔率</span><strong>{isHumanTurn && advice ? `${Math.round(advice.potOdds * 100)}%` : "—"}</strong></div>
                  <div><span>{isHumanTurn && advice ? `你 / ${advice.opponentName}` : "双方后手"}</span><strong>{isHumanTurn && advice ? `${advice.heroStackBb.toFixed(1)} / ${advice.opponentStackBb.toFixed(1)} BB` : "—"}</strong></div>
                  <div><span>有效 / SPR</span><strong>{isHumanTurn && advice ? `${advice.effectiveStackBb.toFixed(1)} / ${advice.spr.toFixed(1)}` : "—"}</strong></div>
                </div>
                <p className="range-note">{isHumanTurn && advice
                  ? `${advice.strategySource} · 按位置、完整公开行动线、下注尺度与多人底池动态加权；不会读取电脑暗牌。`
                  : "等待你的行动点后，系统才会生成不读取电脑暗牌的范围估算。"}</p>
              </section>

              <section className={`coach-callout ${training && isHumanTurn ? "visible" : "muted"}`}>
                <div className="coach-icon">◆</div>
                <div>
                  <span>近似 GTO 建议</span>
                  <h3>{training && isHumanTurn && advice ? `优先考虑 · ${advice.recommendedLabel}` : training ? "等待你的行动点" : "训练提示已关闭"}</h3>
                  <p>{training && isHumanTurn && advice
                    ? `${advice.mix}。${advice.sizingMix ? `进入加注分支后的尺寸混合：${advice.sizingMix}。` : ""}${advice.note}`
                    : training ? "AI 行动结束后，这里会给出范围、赔率、动作频率与加注尺寸参考。" : "关闭提示时仍会记录你的决策，方便牌后复盘。"}</p>
                </div>
              </section>

              {feedback ? (
                <section className="last-decision">
                  <div className="decision-top"><span>上一决策</span><b className={feedback.score >= 85 ? "good" : feedback.score >= 65 ? "ok" : "bad"}>{feedback.score} 分</b></div>
                  <h3>{feedback.score >= 85 ? "线路漂亮，继续保持" : feedback.score >= 65 ? "可执行，但有更优选择" : "这里值得重点复盘"}</h3>
                  <p>你选择了{feedback.action}，属于{feedback.actionVerdict}（约 {Math.round(feedback.selectedFrequency * 100)}%）。参考混合：{feedback.mix}。{feedback.sizingMix ? `进入加注分支后的尺寸混合：${feedback.sizingMix}。` : ""}{feedback.sizeVerdict ? `${feedback.sizeVerdict}。` : ""}{feedback.note}</p>
                  <p className="range-note">来源：{feedback.strategySource}。分数表示与当前公开策略频率的匹配程度，不是求解器计算的 EV 损失。</p>
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
                <h3>{showDecisionPending
                  ? "请先选择亮牌或盖牌"
                  : mode === "session" ? game.presetKey === "squid" ? `还剩 ${game.squid.remaining} 条鱿鱼` : `还需完成 ${Math.max(0, SESSION_HANDS - completedHands)} 手`
                  : mode === "endless" ? "完成本手后可主动结束并生成复盘" : "本手尚未结束"}</h3>
                <p>{showDecisionPending
                  ? "完成本手的展示决策后再生成报告，避免复盘信息影响你的选择。"
                  : isReviewRun ? mode === "endless" ? "继续对局，或在一手完整结算后点击“结束无尽局并复盘”。中途不公开答案、分数和对手类型。" : "整局结束后一次生成完整报告，不显示中途答案、分数和对手类型。"
                  : "牌局结束后会自动生成这手牌的决策点评。"}</p>
                <button onClick={() => setShowLog(false)}>回到牌桌</button>
              </section>
            </div>
          ) : (
            <div className="log-content">
              <div className="review-summary unlocked">
                <div>
                  <span>{mode === "session"
                    ? game.presetKey === "squid" ? "鱿鱼整局报告已生成" : "20 手整局报告已生成"
                    : mode === "endless" ? "无尽对局报告已生成" : "本手复盘已生成"}</span>
                  <h3>{TABLE_PRESETS[game.presetKey].shortLabel} · {isReviewRun ? `${completedHands} 手 · ${runDecisionStats.count} 个决策节点` : `第 ${game.handNo} 手 · ${STREET_LABELS[game.street]}`}</h3>
                </div>
                <strong>{reportScore}<small>{reportReview.length ? "策略匹配度" : "暂无决策"}</small></strong>
              </div>

              {isReviewRun && (
                <>
                  <div className="session-stats">
                    <div><span>完成手数</span><strong>{completedHands}{mode === "session" && game.presetKey !== "squid" ? `/${SESSION_HANDS}` : ""}</strong></div>
                    <div><span>桌面筹码</span><strong>{human.stack}</strong></div>
                    <div><span>累计投入</span><strong>{game.cashInvested[0]}</strong></div>
                    <div><span>{game.presetKey === "squid" ? "净结果（含鱿鱼）" : "累计净收益"}</span><strong className={heroNet >= 0 ? "good" : "bad"}>{heroNet >= 0 ? "+" : ""}{heroNet}</strong></div>
                    <div><span>净收益（BB）</span><strong className={heroNet >= 0 ? "good" : "bad"}>{heroNetBb >= 0 ? "+" : ""}{heroNetBb.toFixed(1)}</strong></div>
                    <div><span>BB / 100</span><strong className={heroBbPer100 >= 0 ? "good" : "bad"}>{heroBbPer100 >= 0 ? "+" : ""}{heroBbPer100.toFixed(1)}</strong></div>
                    <div><span>AI 眼中的松紧</span><strong>{imageLabel(heroImage.loose, "偏紧", "均衡", "偏松")}</strong></div>
                    <div><span>AI 眼中的风格</span><strong>{imageLabel(heroImage.aggressive, "偏被动", "均衡", "偏激进")}</strong></div>
                    <div><span>AI 眼中的欺骗性</span><strong>{imageLabel(heroImage.deceptive, "偏直白", "均衡", "难预测")}</strong></div>
                    <div><span>画像样本</span><strong>{heroImage.observations} 次</strong></div>
                  </div>
                  <SquidScoreboard game={game} report />
                  <div className="session-hand-list">
                    <div className="section-label"><span>{completedHands > sessionResults.length ? `最近 ${sessionResults.length} 手结果` : "逐手结果"}</span><small>累计统计保留全部样本 · 低于 1 BB 自动补至初始买入</small></div>
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
                <div className="section-label"><span>{mode === "session" ? "整局决策路径" : mode === "endless" ? "最近决策路径" : "你的决策路径"}</span><small>{reportReview.length}{isReviewRun && runDecisionStats.count > reportReview.length ? ` / 累计 ${runDecisionStats.count}` : ""} 个节点</small></div>
                {reportReview.length ? reportReview.map((item) => (
                  <div className="review-row" key={item.id}>
                    <span className={item.score >= 85 ? "good" : item.score >= 65 ? "ok" : "bad"}>{item.score}</span>
                    <div>
                      <b>{isReviewRun ? `第 ${item.hand} 手 · ` : ""}{item.street} · 手牌 {item.cards}</b>
                      <p>公共牌 {item.board} · 底池 {item.pot} · 面对 {item.toCall}</p>
                      <p>你的选择：{item.action}（{item.actionVerdict}，约 {Math.round(item.selectedFrequency * 100)}%）；最高频线路：{item.recommended}</p>
                      <p>参考混合：{item.mix}</p>
                      <p>本手起始有效 {item.startingDepthBb.toFixed(1)} BB · 当前后手：你 {item.heroStackBb.toFixed(1)} BB / {item.opponentName} {item.opponentStackBb.toFixed(1)} BB · 本节点有效 {item.effectiveStackBb.toFixed(1)} BB{item.maxContestableBb > item.effectiveStackBb + 0.05 ? ` · 多人加注有效上限 ${item.maxContestableBb.toFixed(1)} BB` : ""}</p>
                      {item.sizingMix && <p>进入加注分支后的尺寸混合：{item.sizingMix}{item.sizeVerdict ? `；${item.sizeVerdict}` : ""}</p>}
                      {item.streetKey === "preflop" ? (
                        <small>{item.preflopPosition} · {item.preflopScenario} · 基准继续范围约 {Math.round(item.preflopTargetRange * 100)}% · 本手进入频率约 {Math.round(item.preflopEnterFrequency * 100)}% · 来源：{item.strategySource}。{item.note}</small>
                      ) : (
                        <small>对行动范围估算权益 {Math.round(item.equity * 100)}% / 直接赔率 {Math.round(item.potOdds * 100)}% / 权益实现参考线 {Math.round(item.realizationThreshold * 100)}% · 权益实现估算 {Math.round(item.equityRealization * 100)}% · 有效筹码 {item.effectiveStackBb.toFixed(1)} BB / SPR {item.spr.toFixed(1)}{item.callEv === null ? "" : ` · 跟注 EV 代理 ${item.callEv >= 0 ? "+" : ""}${Math.round(item.callEv)}`} · 来源：{item.strategySource}。{item.note}</small>
                      )}
                    </div>
                  </div>
                )) : <p className="empty-log">这段练习没有记录到你的决策节点。</p>}
              </div>

              <div className="opponent-review">
                <div className="section-label"><span>对手策略画像</span><small>复盘时公开</small></div>
                {mode === "endless" && <p className="range-note">以下是每位电脑的基准风格；无尽对局中它们都依据你的累计画像渐进调整了进攻、入池、诈唬与直接对抗频率，但不会因此收敛成同一种打法。</p>}
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

              {isReviewRun && (
                <button className="session-restart" onClick={restartCurrentRun}>
                  {mode === "endless" ? "开始新的无尽对局" : game.presetKey === "squid" ? "开始新一轮鱿鱼" : "开始新的 20 手整局"}
                </button>
              )}

              {mode === "per_hand" && (
                <div className="hand-log">
                  <div className="section-label"><span>整手行动线</span><small>{game.log.length} 个事件</small></div>
                  {game.log.map((line, index) => <div key={`${line}-${index}`}><time>{String(game.log.length - index).padStart(2, "0")}</time><p>{line}</p></div>)}
                </div>
              )}
            </div>
          )}

          <footer className="coach-footer">
            <span><i /> 本地混合频率引擎</span>
            <button onClick={() => setRulesOpen(true)}>德州扑克规则 ↗</button>
          </footer>
        </aside>
      </div>

      {historyOpen && selectedHistory && replayState && (
        <div className="modal-backdrop">
          <section className="hand-history-modal" role="dialog" aria-modal="true" aria-labelledby="hand-history-title">
            <button className="modal-close" onClick={closeHandHistory} aria-label="关闭牌谱">×</button>
            <header className="hand-history-heading">
              <div>
                <span>LOCAL HAND HISTORY · LAST {POKER_HAND_HISTORY_LIMIT}</span>
                <h2 id="hand-history-title">最近 30 手牌谱与回放</h2>
              </div>
              <p>所有底牌只来自已结束的本地单人牌局；20 手整局和无尽模式会在本轮结束后一次性解锁并写入浏览器。</p>
            </header>
            <div className="hand-history-layout">
              <nav className="hand-history-sidebar" aria-label="最近牌谱列表">
                <div><span>由新到旧</span><small>{availableHandHistory.length}/{POKER_HAND_HISTORY_LIMIT} 手</small></div>
                <div className="hand-history-list">
                  {availableHandHistory.map((entry) => {
                    const heroCards = entry.players.find((player) => player.isHuman)?.hole.map(cardText).join(" ") ?? "—";
                    return (
                      <button
                        className={entry.id === selectedHistory.id ? "active" : ""}
                        type="button"
                        key={entry.id}
                        onClick={() => selectHistoryHand(entry)}
                        aria-pressed={entry.id === selectedHistory.id}
                      >
                        <strong>#{entry.hand}</strong>
                        <span>{heroCards} · {historyModeLabel(entry.mode)}</span>
                        <small>{new Date(entry.completedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</small>
                        <em>{entry.result}</em>
                      </button>
                    );
                  })}
                </div>
              </nav>

              <article className="hand-history-detail">
                <header className="hand-history-detail-head">
                  <div>
                    <small>{historyModeLabel(selectedHistory.mode)} · {TABLE_PRESETS[selectedHistory.presetKey].shortLabel} · 第 {selectedHistory.hand} 手</small>
                    <h3>{selectedHistory.result}</h3>
                    <p>{new Date(selectedHistory.completedAt).toLocaleString("zh-CN")} · 所有电脑底牌已在赛后记录中公开</p>
                  </div>
                  <div className="hand-history-pot"><span>争夺底池</span><strong>{selectedHistory.totalPot}</strong></div>
                </header>

                <section className="hand-history-board" aria-label="回放公共牌">
                  <div className="hand-history-board-copy">
                    <span>{STREET_LABELS[replayState.current.street]}</span>
                    <strong>公共牌 {replayState.boardCount}/5</strong>
                    <em>第 {replayState.currentStep + 1}/{replayState.events.length} 步</em>
                  </div>
                  <div className="hand-history-board-cards">
                    {[0, 1, 2, 3, 4].map((index) => (
                      <PlayingCard
                        key={`${selectedHistory.id}-board-${index}`}
                        card={index < replayState.boardCount ? selectedHistory.board[index] : undefined}
                        ghost={index >= replayState.boardCount}
                      />
                    ))}
                  </div>
                </section>

                <section className="hand-history-players" aria-label="本手所有玩家底牌">
                  {selectedHistory.players.map((player) => {
                    const payout = selectedHistory.payouts.find((entry) => entry.playerId === player.id)?.amount ?? 0;
                    const returned = selectedHistory.returns.find((entry) => entry.playerId === player.id)?.amount ?? 0;
                    const winner = selectedHistory.winnerIds.includes(player.id);
                    const mainPotWinner = selectedHistory.mainPotWinnerIds.includes(player.id);
                    const role = historySeatRole(player.id, selectedHistory.dealer, selectedHistory.players.length);
                    const completeCards = [...player.hole, ...selectedHistory.board];
                    const finalHand = completeCards.length >= 5 ? bestHand(completeCards).name : "翻牌前手牌";
                    return (
                      <article className={`hand-history-player ${winner ? "is-winner" : ""} ${player.folded ? "is-folded" : ""}`} key={player.id}>
                        <div className="hand-history-player-copy">
                          <span>{player.isHuman ? "HERO" : `SEAT ${player.id + 1}`}{role ? ` · ${role}` : ""}</span>
                          <strong>{player.name}</strong>
                          <em>{winner ? mainPotWinner ? "主池赢家" : "边池赢家" : player.folded ? "已弃牌" : "摊牌未胜"} · {finalHand}</em>
                        </div>
                        <div className="hand-history-hole" aria-label={`${player.name} 的完整底牌`}>
                          {player.hole.map((card) => <PlayingCard key={cardKey(card)} card={card} />)}
                        </div>
                        <div className="hand-history-player-stats">
                          <span>投入 {player.contributed}</span>
                          {payout > 0 && <span>赢得 {payout}</span>}
                          {returned > 0 && <span>退回 {returned}</span>}
                          <span>终局筹码 {player.stack}</span>
                        </div>
                      </article>
                    );
                  })}
                </section>

                <section className="hand-history-replay" aria-label="牌局逐步回放">
                  <div className="hand-history-controls">
                    <div><span>回放进度</span><strong>{replayState.currentStep + 1}/{replayState.events.length}</strong></div>
                    <i><em style={{ width: `${(replayState.currentStep + 1) / Math.max(1, replayState.events.length) * 100}%` }} /></i>
                    <div className="hand-history-control-buttons">
                      <button
                        type="button"
                        onClick={() => { setReplayStep(0); setReplayPlaying(true); }}
                        title="从头自动回放"
                      >从头</button>
                      <button type="button" onClick={() => { setReplayPlaying(false); setReplayStep((step) => Math.max(0, step - 1)); }} disabled={replayState.currentStep === 0}>上一步</button>
                      <button
                        className="primary"
                        type="button"
                        onClick={() => {
                          if (replayPlaying) {
                            setReplayPlaying(false);
                            return;
                          }
                          if (replayState.currentStep >= replayState.events.length - 1) setReplayStep(0);
                          setReplayPlaying(true);
                        }}
                      >{replayPlaying ? "暂停" : "播放"}</button>
                      <button type="button" onClick={() => { setReplayPlaying(false); setReplayStep((step) => Math.min(replayState.events.length - 1, step + 1)); }} disabled={replayState.currentStep >= replayState.events.length - 1}>下一步</button>
                    </div>
                  </div>
                  <div className="hand-history-timeline">
                    <div className="hand-history-current-event">
                      <span>{STREET_LABELS[replayState.current.street]} · {replayState.current.kind === "deal" ? "发牌" : replayState.current.kind === "result" ? "结算" : "行动"}</span>
                      <strong>{replayState.current.text}</strong>
                    </div>
                    <div className="hand-history-event-list">
                      {replayState.visible.map((event, index) => (
                        <div className={index === replayState.currentStep ? "active" : ""} key={event.id}>
                          <time>{String(index + 1).padStart(2, "0")}</time><span>{event.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </article>
            </div>
          </section>
        </div>
      )}

      {rulesOpen && (
        <div className="modal-backdrop">
          <section className="info-modal poker-rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title">
            <button className="modal-close" onClick={() => setRulesOpen(false)} aria-label="关闭德州扑克规则">×</button>
            <span className="eyebrow">TEXAS HOLD&apos;EM RULEBOOK</span>
            <h2 id="rules-title">先看懂一手牌，<br />再练好每个决定。</h2>
            <p>每位玩家拿两张只有自己可见的底牌，桌面最多发出五张公共牌。你可以使用两张、一张或完全不用自己的底牌，从七张牌里组成最强的五张牌；也可以在摊牌前让所有对手弃牌，直接赢下底池。</p>

            <div className="poker-rule-basics">
              <div><span>牌桌位置</span><strong>D 庄位 → SB 小盲 → BB 大盲</strong><small>庄位每手顺时针移动；盲注是发牌前必须投入的筹码。</small></div>
              <div><span>翻牌前</span><strong>每人 2 张底牌</strong><small>从大盲左侧开始行动；大盲在无人加注时拥有最后过牌选择。</small></div>
              <div><span>翻牌</span><strong>一次发出 3 张公共牌</strong><small>仍在牌局中的玩家进入第二轮下注。</small></div>
              <div><span>转牌</span><strong>再发 1 张公共牌</strong><small>第三轮下注，底池通常开始明显变大。</small></div>
              <div><span>河牌与摊牌</span><strong>最后 1 张 · 比较最佳五张</strong><small>最后一轮下注结束后，未弃牌玩家公开手牌决定赢家。</small></div>
            </div>

            <section className="poker-rule-section" aria-labelledby="action-rules-title">
              <div className="poker-rule-section-heading"><span>ACTIONS</span><h3 id="action-rules-title">轮到你时可以做什么</h3></div>
              <div className="poker-action-rules">
                <div><b>弃牌</b><span>放弃本手；已经投入底池的筹码不会退回。</span><kbd>F</kbd></div>
                <div><b>过牌</b><span>当前无需补筹码时把行动交给下一位玩家。</span><kbd>C</kbd></div>
                <div><b>跟注</b><span>补齐当前最高投入；筹码不足时可以用剩余筹码全下跟注。</span><kbd>C</kbd></div>
                <div><b>下注 / 加注</b><span>没人下注时建立价格；已有下注时提高到新的总额。界面显示的是“加注至”。</span><kbd>R</kbd></div>
                <div><b>全下</b><span>投入全部剩余筹码；只能赢取每位对手与你等额匹配的部分。</span><em>ALL-IN</em></div>
              </div>
            </section>

            <section className="poker-rule-section" aria-labelledby="hand-ranks-title">
              <div className="poker-rule-section-heading"><span>HAND RANKINGS · STRONG TO WEAK</span><h3 id="hand-ranks-title">牌型从大到小</h3></div>
              <div className="poker-hand-ranks">
                {POKER_HAND_RANKS.map(([index, name, description]) => (
                  <div key={index}><span>{index}</span><strong>{name}</strong><small>{description}</small></div>
                ))}
              </div>
              <p className="poker-tie-rule">同牌型按组成牌型的点数和踢脚牌逐级比较；花色不分大小。若双方最好的五张牌完全相同，则平分相应底池。</p>
            </section>

            <div className="poker-rule-details">
              <div><span>主池、边池与退回</span><strong>全下金额不同，会按可匹配额度分层。</strong><p>每个边池只有投入到该层且没有弃牌的玩家有资格争夺；弃牌前投入仍是死钱。没人能够跟上的超额筹码会原样退回，不算奖金。</p></div>
              <div><span>加注权</span><strong>完整加注会重新开放行动，不足额全下不一定会。</strong><p>短码全下若没有达到一个完整最小加注量，已经行动过的玩家通常只能跟注或弃牌；多个不足额加注累计达到完整增量后才重新开放。</p></div>
              <div><span>这张训练桌</span><strong>6-MAX · 盲注 5/10 · 无限注现金桌规则</strong><p>F 弃牌、C 过牌或跟注、R 加注、N 下一手。浅筹 / 标准 / 深筹只是初始买入深度；“血战鱿鱼”是附加训练玩法，不是标准德州扑克规则。</p></div>
            </div>

            <button className="modal-primary" onClick={() => setRulesOpen(false)}>看懂了，回到牌桌</button>
          </section>
        </div>
      )}

      {installHelpOpen && (
        <div className="modal-backdrop">
          <section className="info-modal install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title">
            <button className="modal-close" onClick={() => setInstallHelpOpen(false)} aria-label="关闭安装说明">×</button>
            <span className="eyebrow">INSTALL RANGECRAFT</span>
            <h2 id="install-title">把 RangeCraft<br />放到桌面或主屏幕</h2>
            <p>当前浏览器没有提供直接安装弹窗。游戏本身没有出错，请在系统浏览器中按下面对应的一项操作。</p>
            <div className="install-guide">
              <div className="install-guide-primary">
                <b>Chrome / Edge · 电脑</b>
                <strong>右上角 ⋮ → 投放、保存和分享 → 将网页安装为应用</strong>
                <span>如果地址栏右侧直接出现安装图标，也可以点图标后确认安装。</span>
              </div>
              <div>
                <b>Safari · Mac</b>
                <strong>点工具栏“分享” → 添加到程序坞</strong>
                <span>也可以使用菜单栏“文件 → 添加到程序坞”。</span>
              </div>
              <div>
                <b>Safari · iPhone / iPad</b>
                <strong>点“分享” → 添加到主屏幕 → 添加</strong>
                <span>安装后会像普通 App 一样从主屏幕启动。</span>
              </div>
              <div>
                <b>ChatGPT / 微信等内置浏览器</b>
                <strong>先选择“在 Safari 中打开”或“在 Chrome 中打开”</strong>
                <span>内置浏览器通常不会提供网页应用安装权限。</span>
              </div>
            </div>
            <button className="modal-primary" onClick={() => setInstallHelpOpen(false)}>我知道怎么安装了</button>
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
