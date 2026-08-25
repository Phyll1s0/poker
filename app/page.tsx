"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AI_PROFILES,
  adaptAiProfileToHeroImage,
  heroNodePressure,
  heroPublicRangeTendency,
  sampleAiLineup,
  updateHeroTableImage,
  type HeroPressureNode,
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
  orderFiveCardHandForDisplay,
  preflopHandFeatures,
  preflopPercentile,
  preflopStrength,
} from "../lib/poker-evaluator";
import { formatPokerFrequency, formatPokerFrequencyMix } from "../lib/poker-frequency";
import { encodePreflopHandClass } from "../lib/poker-preflop";
import {
  choosePokerPolicyAction,
  evaluatePokerPolicy,
  pokerCallClosesContestableLayers,
  pokerContestablePotAtDecision,
  sixMaxPreflopPosition,
  sixMaxPreflopPositionFactor,
  type PokerPolicyInput,
  type PokerPreflopScenario,
  type PokerPolicyProfile,
} from "../lib/poker-policy";
import { createPublicOpponentRanges, type PublicBettingAction } from "../lib/poker-range";
import {
  solveRiverCoachDecision,
  type RiverCoachRequest,
  type RiverCoachResult,
} from "../lib/poker-river-coach";
import {
  type ThreeWayRiverCoachRequest,
  type ThreeWayRiverCoachResult,
  type ThreeWayRiverCoachProgress,
} from "../lib/poker-threeway-river-coach";
import { solveThreeWayRiverCoachDecisionInWorker } from "../lib/poker-threeway-river-worker-client";
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
import { PokerRulesModal } from "./PokerRulesModal";

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
  handStartStack: number;
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
  solverKind: "heads-up-fixed-tree" | "three-way-approximation" | null;
  solverEvLossBb: number | null;
  solverExploitabilityPotFraction: number | null;
  solverNashConvBb: number | null;
  solverNashConvPotFraction: number | null;
  solverQuickNashConvPotFraction: number | null;
  solverActionRegretDriftPotFraction: number | null;
  solverFrequencyTotalVariation: number | null;
  solverTargetPotFraction: number | null;
  solverTargetMet: boolean | null;
  solverAcceptedForScoring: boolean | null;
  solverIterations: number | null;
  solverQuickIterations: number | null;
  solverRepresentativeCombos: string;
  solverDetails: string;
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
  hintUsed: boolean;
};

type SessionHandResult = {
  hand: number;
  result: string;
  heroStack: number;
  heroCashInvested: number;
  heroNet: number;
  score: number | null;
  decisions: number;
  assistedDecisions: number;
  heroCards: string;
};

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SMALL_BLIND = 5;
const BIG_BLIND = 10;
const SESSION_HANDS = 20;
// Coaching answers stay on the neutral chart anchor. AI personalities may
// deviate from it, but should not leak "ghost" frequencies into a charted pure
// fold/raise decision shown as the training reference.
const COACH_PROFILE: PokerPolicyProfile = { aggression: 0.7, looseness: 0.27, bluff: 0.12 };

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
  isolate: "面对跛入者",
  "check-option": "大盲免费过牌",
  "vs-open": "面对开池",
  "vs-three-bet": "面对 3-bet",
  "vs-four-bet": "面对 4-bet 及以上",
} as const;

function preflopRaiseActionLabel(raiseCount: number) {
  return raiseCount <= 0 ? "开池" : `${raiseCount + 2}-bet`;
}

function preflopPassiveActionLabel(scenario: PokerPreflopScenario) {
  if (scenario === "open") return "Limp（跛入）";
  if (scenario === "isolate") return "跟随跛入";
  return "跟注";
}

function preflopAggressiveActionLabel(scenario: PokerPreflopScenario, raiseCount: number) {
  return scenario === "isolate" ? "隔离加注" : preflopRaiseActionLabel(raiseCount);
}

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

function currentEquity(game: Game, player: Player, iterations = 80, heroImage?: TableImage): number {
  const community = game.street === "preflop" ? [] : game.community;
  const heroTendency = heroImage && player.id !== 0 ? heroPublicRangeTendency(heroImage) : undefined;
  const opponents = createPublicOpponentRanges({
    players: game.players,
    viewerId: player.id,
    community,
    actions: game.actionHistory,
    bigBlind: BIG_BLIND,
    positionFactor: (playerId) => sixMaxPreflopPositionFactor(playerId, game.dealer),
    position: (playerId) => sixMaxPreflopPosition(playerId, game.dealer),
    tendency: heroTendency
      ? (playerId) => playerId === 0 ? heroTendency : undefined
      : undefined,
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
  // Before the flop, players behind may still enter despite having contributed
  // nothing yet. Pot-layer equity would silently exclude them and make an RFI
  // hand look much stronger than its all-live-opponents showdown equity.
  if (game.street !== "preflop" && decisionPot.finalPot > 0 && decisionPot.layers.length > 0) {
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

function heroDecisionPressureNode(game: Game, toCall: number): HeroPressureNode {
  if (game.street === "preflop") return game.raiseCount === 0 ? "preflop_open" : "preflop_reraise";
  return toCall === 0 ? "postflop_bet" : "postflop_raise";
}

function facingHeroPressureNode(game: Game): HeroPressureNode {
  if (game.street === "preflop") return game.raiseCount <= 1 ? "preflop_open" : "preflop_reraise";
  return game.raiseCount <= 1 ? "postflop_bet" : "postflop_raise";
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
  // Position is fixed by seats, not by whether an opponent became all-in on
  // this street. Keeping all non-folded players preserves the original river
  // action order when the current decision is facing an all-in wager.
  const activePlayers = game.players.filter((candidate) => !candidate.folded);
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
    preflopPreviouslyLimped: preflopActions.some((action) => (
      action.playerId === player.id && action.kind === "call" && action.raiseCountBefore === 0
    )),
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
    handStartStack: stacks[id],
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
  const facingHero = game.lastAggressor === 0;
  const equity = currentEquity(game, player, game.street === "preflop" ? 300 : 600, heroImage);
  const adapted = adaptAiProfileToHeroImage(styleKey, heroImage, {
    heroActive: !game.players[0].folded,
    facingHero,
    intensity: mode === "endless" ? 1.5 : 1.05,
    pressureNode: facingHero ? facingHeroPressureNode(game) : undefined,
  });
  const profile: PokerPolicyProfile = {
    aggression: adapted.aggression,
    looseness: adapted.looseness,
    bluff: adapted.bluff,
  };
  // The public hero tendency has already changed the sampled opponent range
  // used by currentEquity. Reapplying the same read as a flat equity bonus
  // would count one observation twice and distort multiway/side-pot decisions.
  return choosePokerPolicyAction(buildPokerPolicyInput(game, player, equity, profile));
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
    const handFeatures = preflopHandFeatures(player.hole)!;
    const handClass = encodePreflopHandClass(
      handFeatures.highRank,
      handFeatures.lowRank,
      handFeatures.suited,
    );
    const positionNode = policyInput.preflopOpenerPosition
      ? `${policyPlan.preflopPosition} 对 ${policyInput.preflopOpenerPosition}`
      : policyPlan.preflopPosition;
    const facingSize = game.raiseCount > 0
      ? ` · 面对 ${(game.highestBet / BIG_BLIND).toFixed(1)} BB`
      : "";
    const rangePercent = Math.round(policyPlan.preflopTargetRange * 100);
    const enterFrequencyLabel = formatPokerFrequency(policyPlan.preflopEnterFrequency);
    note = `${handClass} · ${positionNode} · ${PREFLOP_SCENARIO_LABELS[policyPlan.preflopScenario]}${facingSize}：先按位置、前序行动、加注尺度和有效筹码构建约 ${rangePercent}% 的继续范围；这手牌当前进入范围的混合频率为 ${enterFrequencyLabel}。`;
    if (policyPlan.preflopScenario === "open") {
      note += ` 这是未开池（RFI）节点：当前底池 ${committedPot(game)} 只包含小盲 ${SMALL_BLIND} 与大盲 ${BIG_BLIND}；“Limp（跛入）”表示你主动补齐大盲，不是跟随前方玩家。`;
    } else if (policyPlan.preflopScenario === "isolate") {
      note += ` 前方已有 ${policyInput.preflopLimpers} 位玩家跛入；跟随跛入与隔离加注是两条不同线路。当前频率由六人桌首入池基准结合跛入人数外推，不冒充商业求解器的独立 vs-limp 解。`;
    }
    if (action === "raise") note += ` 主路线为主动加注，尺寸按当前 ${preflopAggressiveActionLabel(policyPlan.preflopScenario, game.raiseCount)} 节点计算。`;
    else if (action === "call") note += policyPlan.preflopScenario === "open"
      ? ` 主路线为主动跛入；这不是面对别人下注后的跟注。`
      : policyPlan.preflopScenario === "isolate"
        ? ` 主路线为跟随跛入，保留可低成本实现权益的组合。`
        : ` 主路线为跟注，保留强牌和部分可实现权益的牌，避免把继续范围全部暴露为加注。`;
    else if (action === "check") note += ` 当前拥有免费过牌权，弱牌无需为了“主动”而制造不必要底池。`;
    else note += ` 当前牌型位于该位置与行动序列的范围外，弃牌来自翻前范围，而不是把翻后胜率公式硬套进来。混合策略既包含混频节点，也允许明显劣势组合采用纯线路；这里使用的是近似基准表，不冒充求解器精确解。`;
    if (game.raiseCount >= 2) {
      note += ` 当前若继续加注将是 ${preflopRaiseActionLabel(game.raiseCount)}，不是面对开池的 3-bet；不要把两个节点的 AT 频率直接比较。`;
    }
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
      note = policyPlan.strong
        ? `估算摊牌权益约 ${estimatedEquity}%，当前组合靠近价值范围顶端，主线用加注获取价值并保留少量慢打。`
        : `估算摊牌权益约 ${estimatedEquity}%；听牌、阻断牌和对手下注尺度共同支持一部分半诈唬/极化加注。`;
    } else {
      note = `直接价格为 ${directPrice}%，估算摊牌权益约 ${estimatedEquity}%；跟注保留对手诈唬，同时把部分强牌与听牌留在加注分支。`;
    }
    if (!terminalCallLine && (action === "fold" || action === "call")) note += chipEvText;
  } else if (action === "raise") {
    note = policyPlan.strong
      ? `当前组合进入价值下注区域；尺度会随 SPR、牌面动态性和河牌极化程度改变，并保留部分强牌过牌。`
      : policyPlan.rangeAdvantage > 0.06
        ? `公开行动、位置与牌面令整体范围保有主动权；当前低摊牌价值组合按听牌、阻断牌和目标诈唬比例混合下注。`
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
  const raiseActionLabel = game.street === "preflop"
    ? preflopAggressiveActionLabel(policyPlan.preflopScenario, game.raiseCount)
    : "加注";
  const callActionLabel = game.street === "preflop"
    ? preflopPassiveActionLabel(policyPlan.preflopScenario)
    : "跟注";
  const labels: Record<ActionKind, string> = { fold: "弃牌", check: "过牌", call: callActionLabel, raise: raiseActionLabel };
  const mix = formatPokerFrequencyMix(
    (Object.entries(frequencies) as [ActionKind, number][])
      .map(([kind, frequency]) => ({ label: labels[kind], frequency })),
  );
  const sizingRoutes = frequencies.raise >= 0.005 && !player.raiseLocked
    ? policyPlan.sizingRoutes
    : [];
  const formatAdviceSizingRoute = (route: (typeof sizingRoutes)[number]) => {
    const formatted = formatPokerSizingRoute(sizingContext, route);
    return game.street === "preflop" && policyPlan.preflopScenario === "isolate"
      ? formatted.replace(/^开池至/, "隔离加注至")
      : formatted;
  };
  const sizingMix = formatPokerFrequencyMix(sizingRoutes.map((route) => ({
    label: formatAdviceSizingRoute(route),
    frequency: route.frequency,
  })));
  const preferredSizingRoute = preferredPokerSizingRoute(sizingRoutes);
  const recommendedRaiseTo = preferredSizingRoute?.target ?? null;
  const recommendedBetFraction = preferredSizingRoute?.fraction ?? null;
  const recommendedLabel = action === "raise" && preferredSizingRoute
    ? formatAdviceSizingRoute(preferredSizingRoute)
    : labels[action];
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
    strategySource: game.street === "preflop"
      ? "本地手工校准 · 六人桌 169 类 · cEV/无抽水近似（非 Solver 解）"
      : "本地范围模型 · cEV/无抽水启发式（非 Solver 解）",
    preflopPosition: policyPlan.preflopPosition,
    preflopScenarioKey: policyPlan.preflopScenario,
    preflopScenario: PREFLOP_SCENARIO_LABELS[policyPlan.preflopScenario],
    preflopLimpers: policyInput.preflopLimpers,
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

type SoloAdvice = ReturnType<typeof getAdvice>;
type DeepRiverCoachResult = RiverCoachResult | ThreeWayRiverCoachResult;
type DeepRiverCoachPlan =
  | Readonly<{ mode: "heads-up"; request: RiverCoachRequest }>
  | Readonly<{ mode: "three-way"; request: ThreeWayRiverCoachRequest }>;
type SolvedRiverAdvice = SoloAdvice & Readonly<{
  riverSolver: DeepRiverCoachResult;
  riverSolverAccepted: boolean;
  riverSolverGradingAccepted: boolean;
  riverSolverFallback: SoloAdvice;
}>;

function buildSoloHeadsUpRiverCoachRequest(
  game: Game,
  hero: Player,
  heroImage: TableImage,
): RiverCoachRequest | null {
  if (
    game.street !== "river"
    || game.status !== "playing"
    || game.current !== hero.id
    || game.community.length !== 5
    || hero.hole.length !== 2
  ) return null;
  const contenders = game.players.filter((player) => !player.folded);
  if (contenders.length !== 2) return null;
  const opponent = contenders.find((player) => player.id !== hero.id);
  if (!opponent) return null;
  const riverActions = game.actionHistory.filter((action) => action.street === "river");
  if (riverActions.some((action) => (
    action.kind === "fold"
    || !contenders.some((player) => player.id === action.playerId)
  ))) return null;

  const publicRangeState = {
    players: game.players,
    community: game.community,
    // The heads-up solver replays the river prefix from its root. Start its
    // input ranges at the turn boundary so the same river action is not used
    // once as a heuristic likelihood and again as solver strategy reach.
    actions: game.actionHistory.filter((action) => action.street !== "river"),
    bigBlind: BIG_BLIND,
    positionFactor: (playerId: number) => sixMaxPreflopPositionFactor(playerId, game.dealer),
    position: (playerId: number) => sixMaxPreflopPosition(playerId, game.dealer),
  };
  const opponentRange = createPublicOpponentRanges({
    ...publicRangeState,
    viewerId: hero.id,
  }).find((range) => range.playerId === opponent.id);
  const heroRange = createPublicOpponentRanges({
    ...publicRangeState,
    viewerId: opponent.id,
    tendency: (playerId) => playerId === hero.id ? heroPublicRangeTendency(heroImage) : undefined,
  }).find((range) => range.playerId === hero.id);
  if (!opponentRange || !heroRange) return null;

  const heroPlayer = isPlayerInPosition(game, hero) ? "ip" : "oop";
  const playerRole = (playerId: number) => {
    const isHero = playerId === hero.id;
    return isHero ? heroPlayer : heroPlayer === "ip" ? "oop" : "ip";
  };
  const heroStreetStart = hero.stack + hero.bet;
  const opponentStreetStart = opponent.stack + opponent.bet;
  const effectiveStackAtStreetStartBb = Math.min(heroStreetStart, opponentStreetStart) / BIG_BLIND;
  if (effectiveStackAtStreetStartBb <= 0 || game.pot <= 0) return null;
  return {
    board: game.community as unknown as readonly [Card, Card, Card, Card, Card],
    suits: ["♠", "♥", "♦", "♣"],
    heroCards: hero.hole as unknown as readonly [Card, Card],
    heroPlayer,
    oopRangeWeight: heroPlayer === "oop" ? heroRange.weight : opponentRange.weight,
    ipRangeWeight: heroPlayer === "ip" ? heroRange.weight : opponentRange.weight,
    potAtStreetStartBb: game.pot / BIG_BLIND,
    effectiveStackAtStreetStartBb,
    publicActions: riverActions.map((action) => ({
      player: playerRole(action.playerId),
      kind: action.kind,
      amountPaidBb: action.amount / BIG_BLIND,
    })),
    canRaise: !hero.raiseLocked && canAnyOpponentRespond(game, hero),
    representativeCombos: 8,
    iterations: 800,
  };
}

function postflopThreeWayOrder(game: Game, contenders: readonly Player[]) {
  const contenderIds = new Set(contenders.map((player) => player.id));
  const orderRank = (player: Player) => {
    const offset = (player.id - game.dealer + game.players.length) % game.players.length;
    return offset === 0 ? game.players.length : offset;
  };
  return game.players
    .filter((player) => contenderIds.has(player.id))
    .sort((left, right) => orderRank(left) - orderRank(right));
}

function buildSoloThreeWayRiverCoachRequest(
  game: Game,
  hero: Player,
  heroImage: TableImage,
): ThreeWayRiverCoachRequest | null {
  if (
    game.street !== "river"
    || game.status !== "playing"
    || game.current !== hero.id
    || game.community.length !== 5
    || hero.hole.length !== 2
  ) return null;
  const contenders = game.players.filter((player) => !player.folded);
  if (contenders.length !== 3 || contenders.some((player) => player.stack + player.bet <= 0)) return null;
  const riverActions = game.actionHistory.filter((action) => action.street === "river");
  if (riverActions.some((action) => (
    action.kind === "fold"
    || action.activeOpponents + 1 > 3
    || !contenders.some((player) => player.id === action.playerId)
  ))) return null;
  if (riverActions.filter((action) => action.kind === "raise").length > 1) return null;
  const priorContributions = contenders.map((player) => player.contributed - player.bet);
  if (Math.max(...priorContributions) - Math.min(...priorContributions) > BIG_BLIND * 0.5) return null;

  const ordered = postflopThreeWayOrder(game, contenders);
  if (ordered.length !== 3) return null;
  const roles = ["oop", "middle", "ip"] as const;
  const roleById = new Map(ordered.map((player, index) => [player.id, roles[index]]));
  const publicRangeState = {
    players: game.players,
    community: game.community,
    // The three-way solver starts directly at this conditional public node;
    // unlike the heads-up full-root solve, it does not multiply the observed
    // prefix's strategy reach. Include river actions once here to form the
    // posterior ranges on arrival at the current node.
    actions: game.actionHistory,
    bigBlind: BIG_BLIND,
    positionFactor: (playerId: number) => sixMaxPreflopPositionFactor(playerId, game.dealer),
    position: (playerId: number) => sixMaxPreflopPosition(playerId, game.dealer),
  };
  const weights = new Map<number, ReturnType<typeof createPublicOpponentRanges>[number]["weight"]>();
  for (const target of ordered) {
    const viewer = ordered.find((player) => player.id !== target.id);
    if (!viewer) return null;
    const publicRange = createPublicOpponentRanges({
      ...publicRangeState,
      viewerId: viewer.id,
      tendency: (playerId) => playerId === hero.id ? heroPublicRangeTendency(heroImage) : undefined,
    }).find((range) => range.playerId === target.id);
    if (!publicRange) return null;
    weights.set(target.id, publicRange.weight);
  }
  const heroPlayer = roleById.get(hero.id);
  if (!heroPlayer) return null;
  return {
    board: game.community as unknown as readonly [Card, Card, Card, Card, Card],
    suits: ["♠", "♥", "♦", "♣"],
    heroCards: hero.hole as unknown as readonly [Card, Card],
    heroPlayer,
    rangeWeights: {
      oop: weights.get(ordered[0].id)!,
      middle: weights.get(ordered[1].id)!,
      ip: weights.get(ordered[2].id)!,
    },
    potAtStreetStartBb: game.pot / BIG_BLIND,
    stackAtStreetStartBb: ordered.map((player) => (
      (player.stack + player.bet) / BIG_BLIND
    )) as [number, number, number],
    publicActions: riverActions.map((action) => ({
      player: roleById.get(action.playerId)!,
      kind: action.kind,
      amountPaidBb: action.amount / BIG_BLIND,
    })),
    representativeCombos: 3,
    iterations: 120,
    maxIterations: 360,
    iterationChunk: 40,
    targetNashConvPotFraction: 0.1,
    targetActionRegretDriftPotFraction: 0.1,
    scoringTargetPotFraction: 0.03,
  };
}

function buildSoloRiverCoachPlan(
  game: Game,
  hero: Player,
  heroImage: TableImage,
): DeepRiverCoachPlan | null {
  const contenders = game.players.filter((player) => !player.folded);
  if (contenders.length === 2) {
    const request = buildSoloHeadsUpRiverCoachRequest(game, hero, heroImage);
    return request ? { mode: "heads-up", request } : null;
  }
  if (contenders.length === 3) {
    const request = buildSoloThreeWayRiverCoachRequest(game, hero, heroImage);
    return request ? { mode: "three-way", request } : null;
  }
  return null;
}

function isThreeWayRiverResult(result: DeepRiverCoachResult): result is ThreeWayRiverCoachResult {
  return result.source === "internal-cfr+-reduced-three-way-river";
}

function solverActionLabel(action: DeepRiverCoachResult["actions"][number]) {
  if (action.action !== "raise") return ACTION_LABELS[action.action];
  return `${action.solverAction.startsWith("bet-to:") ? "下注至" : "加注至"} ${action.raiseToBb?.toFixed(1)} BB`;
}

function applySolvedRiverAdvice(
  base: SoloAdvice,
  result: DeepRiverCoachResult,
  game: Game,
  hero: Player,
): SolvedRiverAdvice {
  const frequencies: Record<ActionKind, number> = { fold: 0, check: 0, call: 0, raise: 0 };
  result.actions.forEach((route) => {
    frequencies[route.action] += route.frequency;
  });
  const action = (Object.entries(frequencies) as [ActionKind, number][])
    .reduce((best, candidate) => candidate[1] > best[1] ? candidate : best)[0];
  const labels: Record<ActionKind, string> = { fold: "弃牌", check: "过牌", call: "跟注", raise: "下注/加注" };
  const mix = formatPokerFrequencyMix(
    (Object.entries(frequencies) as [ActionKind, number][])
      .map(([kind, frequency]) => ({ label: labels[kind], frequency })),
  );
  const sizingContext = pokerSizingContext(game, hero);
  const raiseFrequency = Math.max(Number.EPSILON, frequencies.raise);
  const sizingByTarget = new Map<number, { target: number; fraction: number; frequency: number; allIn: boolean }>();
  for (const route of result.actions) {
    if (route.action !== "raise" || route.raiseToBb === undefined) continue;
    const target = legalPokerRaiseTarget(sizingContext, route.raiseToBb * BIG_BLIND);
    const existing = sizingByTarget.get(target);
    const frequency = route.frequency / raiseFrequency;
    sizingByTarget.set(target, {
      target,
      fraction: pokerRaiseFraction(sizingContext, target),
      frequency: (existing?.frequency ?? 0) + frequency,
      allIn: target === sizingContext.playerBet + sizingContext.playerStack,
    });
  }
  const sizingRoutes = [...sizingByTarget.values()].sort((left, right) => left.target - right.target);
  const sizingMix = formatPokerFrequencyMix(sizingRoutes.map((route) => ({
    label: formatPokerSizingRoute(sizingContext, route),
    frequency: route.frequency,
  })));
  const preferredSizingRoute = preferredPokerSizingRoute(sizingRoutes);
  const recommendedRaiseTo = action === "raise" ? preferredSizingRoute?.target ?? null : null;
  const recommendedBetFraction = action === "raise" ? preferredSizingRoute?.fraction ?? null : null;
  const recommendedLabel = action === "raise" && preferredSizingRoute
    ? formatPokerSizingRoute(sizingContext, preferredSizingRoute)
    : labels[action];
  const bestConditionalEvBb = Math.max(...result.actions.map((route) => route.evBb));
  const evLine = result.actions
    .map((route) => {
      const loss = Math.max(0, bestConditionalEvBb - route.evBb);
      return `${solverActionLabel(route)} ${loss < 0.005 ? "最高/等价" : `较最高 -${loss.toFixed(2)} BB`}`;
    })
    .join(" · ");
  const threeWay = isThreeWayRiverResult(result);
  const accepted = result.acceptedForGuidance;
  if (!accepted) {
    if (!threeWay) {
      const errorPercent = result.exploitabilityPotFraction * 100;
      return {
        ...base,
        note: `${base.note} 单挑河牌 DCFR 实验结果为：${mix}；固定树可剥削度约 ${errorPercent.toFixed(2)}% 底池，仍属实验级，未达到训练提示准入线，因此不覆盖原提示或正式评分。`,
        strategySource: `${base.strategySource}；单挑河牌 DCFR 未通过误差准入门，未接管`,
        riverSolver: result,
        riverSolverAccepted: false,
        riverSolverGradingAccepted: false,
        riverSolverFallback: base,
      };
    }
    const nashConvPercent = result.nashConvPotFraction * 100;
    const targetPercent = result.targetNashConvPotFraction * 100;
    const quickNash = result.quickNashConvPotFraction === null
      ? "未完成"
      : `${(result.quickNashConvPotFraction * 100).toFixed(1)}%`;
    const regretDrift = result.actionRegretDriftPotFraction === null
      ? "未完成"
      : `${(result.actionRegretDriftPotFraction * 100).toFixed(1)}%`;
    return {
      ...base,
      note: `${base.note} 三人河牌高分辨率实验混合为：${mix}；相对最高动作 EV：${evLine}。快速/复核范围的 NashConv 分别为 ${quickNash} / ${nashConvPercent.toFixed(1)}%，跨分辨率动作 regret 差为 ${regretDrift}；未同时达到 ≤${targetPercent.toFixed(0)}% 的实验提示门槛，因此不覆盖原提示或正式评分。`,
      strategySource: `${base.strategySource}；三人多分辨率 CFR+ 未通过稳定性门，未接管`,
      riverSolver: result,
      riverSolverAccepted: false,
      riverSolverGradingAccepted: false,
      riverSolverFallback: base,
    };
  }
  const note = threeWay
    ? `已用每家 ${result.quickRepresentativeCombos?.oop ?? 3}→${result.representativeCombos.oop} 个代表组合交叉求解当前三人河牌节点；核心 CFR+ 在浏览器支持时运行于独立线程，过程可取消。相对最高动作 EV：${evLine}。高分辨率 NashConv ${(result.nashConvPotFraction * 100).toFixed(1)}%，跨分辨率动作 regret 差 ${((result.actionRegretDriftPotFraction ?? 0) * 100).toFixed(1)}%，分别达到 ≤${(result.targetNashConvPotFraction * 100).toFixed(0)}% 与 ≤${(result.targetActionRegretDriftPotFraction * 100).toFixed(0)}% 的实验提示门槛；频率 TV ${((result.frequencyTotalVariation ?? 0) * 100).toFixed(1)}% 仅作诊断，不把近似无差异动作的频率变化误判为错误。${result.acceptedForScoring ? `同时达到 ≤${(result.scoringTargetPotFraction * 100).toFixed(0)}% 的较高稳定性评分门槛，可用于实验动作 EV 评分。` : `尚未达到 ≤${(result.scoringTargetPotFraction * 100).toFixed(0)}% 的较高稳定性评分门槛，因此只接管提示，评分仍采用公开范围启发式。`}固定树仍为单次下注且不含再加注，不是商业全树 GTO。`
    : (() => {
        const errorPercent = result.exploitabilityPotFraction * 100;
        const parameters = result.solverParameters.dcfr;
        const algorithm = parameters
          ? `DCFR(${parameters.alpha}, ${parameters.beta}, ${parameters.gamma})`
          : "CFR+";
        const checkpoint = result.convergence.selectedIterations === result.convergence.trainedIterations
          ? `${result.iterations} 轮`
          : `训练 ${result.convergence.trainedIterations} 轮、采用其中 ${result.iterations} 轮的最低误差检查点`;
        const stability = result.convergence.stopReason === "target-stable"
          ? `连续 ${result.convergence.consecutiveTargetCheckpoints} 次通过误差门槛`
          : "已到本次迭代上限";
        const admission = result.acceptedForScoring
          ? "已达到正式局部 EV 评分门槛"
          : "只达到训练提示门槛，正式评分仍采用公开范围启发式";
        return `已在当前单挑河牌节点用 ${algorithm} ${checkpoint}：底池、有效筹码、完整河牌行动线和合法尺寸均进入求解；${stability}。相对最高动作 EV：${evLine}。固定树可剥削度约 ${errorPercent < 0.01 ? errorPercent.toFixed(3) : errorPercent.toFixed(2)}% 底池；${admission}。这是双方各 ${result.representativeCombos.oop} 个等质量代表组合的缩减范围解，是真实求解器结果，但不冒充商业全组合、全尺寸解。`;
      })();
  return {
    ...base,
    action,
    note,
    frequencies,
    mix,
    sizingContext,
    sizingRoutes,
    sizingMix,
    recommendedRaiseTo,
    recommendedBetFraction,
    recommendedLabel,
    strategySource: threeWay
      ? `三人河牌 CFR+ 近似 · 固定单次下注树 · ${result.representativeCombos.oop}×${result.representativeCombos.middle}×${result.representativeCombos.ip} 代表范围 · cEV/无抽水 · 非精确 GTO`
      : `DCFR(1.5,0,2) 自适应局部求解 · 单挑河牌 · ${result.representativeCombos.oop}×${result.representativeCombos.ip} 代表范围 · 独立 best-response 审计 · cEV/无抽水`,
    riverSolver: result,
    riverSolverAccepted: true,
    riverSolverGradingAccepted: result.acceptedForScoring,
    riverSolverFallback: base,
  };
}

type RiverDeepSolveControl = Readonly<{
  eligible: boolean;
  mode: "heads-up" | "three-way";
  status: "idle" | "running" | "solved" | "error";
  error?: string;
  progress?: ThreeWayRiverCoachProgress;
  nashConvPotFraction?: number;
  quickNashConvPotFraction?: number | null;
  targetNashConvPotFraction?: number;
  actionRegretDriftPotFraction?: number | null;
  targetActionRegretDriftPotFraction?: number;
  frequencyTotalVariation?: number | null;
  acceptedForScoring?: boolean;
  scoringTargetPotFraction?: number;
  quickRepresentativeCombos?: number | null;
  representativeCombos?: number;
  iterations?: number;
  quickIterations?: number | null;
  targetMet?: boolean;
  headsUpExploitabilityPotFraction?: number;
  headsUpTargetExploitabilityPotFraction?: number;
  headsUpTrainedIterations?: number;
  headsUpSelectedIterations?: number;
  headsUpStopReason?: "target-stable" | "iteration-limit" | "fixed-iterations";
  onSolve: () => void;
}>;

type RiverSolveState = Readonly<{
  decisionKey: string;
  status: "running" | "solved" | "error";
  result?: DeepRiverCoachResult;
  progress?: ThreeWayRiverCoachProgress;
  error?: string;
}>;

function AiDecisionHint({
  enabled,
  isHumanTurn,
  advice,
  revealed,
  riverDeepSolve,
  compact = false,
  onReveal,
}: {
  enabled: boolean;
  isHumanTurn: boolean;
  advice: SoloAdvice | SolvedRiverAdvice | null;
  revealed: boolean;
  riverDeepSolve?: RiverDeepSolveControl;
  compact?: boolean;
  onReveal: () => void;
}) {
  const ready = enabled && isHumanTurn && Boolean(advice);
  return (
    <section
      className={`coach-callout coach-hint ${compact ? "coach-hint-compact" : ""} ${ready ? "visible" : "muted"} ${revealed ? "revealed" : "concealed"}`}
      aria-live="polite"
    >
      <div className="coach-icon">◆</div>
      <div className="coach-hint-copy">
        <span>AI 决策提示 · 按需查看</span>
        {!enabled ? (
          <>
            <h3>AI 提示已关闭</h3>
            <p>在牌桌右上角开启“AI 提示”；关闭时仍会正常记录你的决策与赛后复盘。</p>
          </>
        ) : !isHumanTurn || !advice ? (
          <>
            <h3>等待你的下一个行动点</h3>
            <p>轮到你时可以先独立判断，再按需查看当前节点的动作频率和下注尺寸。</p>
          </>
        ) : !revealed ? (
          <>
            <h3>需要一点思路吗？</h3>
            <p>提示默认收起，只针对当前决策；行动后会自动隐藏，不会提前公开对手底牌或风格。</p>
            <button className="coach-hint-button" type="button" onClick={onReveal}>查看本次 AI 提示</button>
          </>
        ) : (
          <>
            <div className="coach-hint-result-heading">
              <h3>优先考虑 · {advice.recommendedLabel}</h3>
              <b>已查看</b>
            </div>
            <p>{advice.mix}。{advice.sizingMix ? `进入加注分支后的尺寸混合：${advice.sizingMix}。` : ""}{advice.note}</p>
            <small className="coach-hint-source">{advice.strategySource} · 保留原始混合频率；仅使用公开行动与范围估算，不读取电脑暗牌</small>
            {riverDeepSolve?.eligible && (
              <div className={`river-deep-solve ${riverDeepSolve.status}`}>
                {riverDeepSolve.status === "idle" && (
                  <>
                    {riverDeepSolve.mode === "three-way" ? (
                      <div><b>可进行三人河牌多分辨率分析</b><span>先用快速代表范围求解，再用更高分辨率重算并检查稳定性；同时检查固定树 NashConv 与动作 regret 漂移。</span></div>
                    ) : (
                      <div><b>可进行河牌深度求解</b><span>单挑河牌使用论文默认 DCFR(1.5,0,2)，分段计算并用独立 best response 检查每个检查点；原 CFR+ 公开基线继续保留作对照。</span></div>
                    )}
                    <button type="button" onClick={riverDeepSolve.onSolve}>{riverDeepSolve.mode === "three-way" ? "运行三人 CFR+ 近似" : "运行 DCFR 深度分析"}</button>
                  </>
                )}
                {riverDeepSolve.status === "running" && (
                  <div><b>{riverDeepSolve.mode === "three-way" && riverDeepSolve.progress?.resolution === "verification" ? "正在用高分辨率范围复核…" : "正在求解当前节点…"}</b><span>{riverDeepSolve.mode === "three-way" && riverDeepSolve.progress
                    ? `${riverDeepSolve.progress.representativeCombos} 个代表组合/人 · ${riverDeepSolve.progress.iterations}/${riverDeepSolve.progress.maxIterations} 轮 · 当前 NashConv ${(riverDeepSolve.progress.nashConvPotFraction * 100).toFixed(1)}%；正在后台分块计算，可随决策变化取消。`
                    : `已锁定当前底池、筹码、行动线与公开范围，${riverDeepSolve.mode === "three-way" ? "三方近似通常需要 2–8 秒。" : "单挑通常需要 1–4 秒。"}`}</span></div>
                )}
                {riverDeepSolve.status === "solved" && (
                  riverDeepSolve.mode === "three-way" ? (
                    <div>
                      <b>{riverDeepSolve.targetMet ? "多分辨率结果已通过实验提示门槛" : "范围复核未通过，仅作实验参考"}</b>
                      <span>{riverDeepSolve.quickRepresentativeCombos ?? 3}→{riverDeepSolve.representativeCombos ?? 5} 组合/人 · NashConv {((riverDeepSolve.quickNashConvPotFraction ?? 0) * 100).toFixed(1)}% / {((riverDeepSolve.nashConvPotFraction ?? 0) * 100).toFixed(1)}% · 动作 regret 差 {((riverDeepSolve.actionRegretDriftPotFraction ?? 0) * 100).toFixed(1)}%（实验目标 ≤{((riverDeepSolve.targetActionRegretDriftPotFraction ?? 0.1) * 100).toFixed(0)}%）· 频率 TV {((riverDeepSolve.frequencyTotalVariation ?? 0) * 100).toFixed(1)}% 仅作诊断；{riverDeepSolve.targetMet
                        ? riverDeepSolve.acceptedForScoring ? "已接管提示与较高稳定性实验 EV 评分。" : "只接管提示，动作评分仍回退公开范围模型。"
                        : "未覆盖原提示或正式评分。"}</span>
                    </div>
                  ) : (
                    <div><b>DCFR 检查点结果已锁定</b><span>训练 {riverDeepSolve.headsUpTrainedIterations ?? "—"} 轮，采用 {riverDeepSolve.headsUpSelectedIterations ?? "—"} 轮检查点；固定树可剥削度 {((riverDeepSolve.headsUpExploitabilityPotFraction ?? 0) * 100).toFixed(3)}%，{riverDeepSolve.headsUpStopReason === "target-stable" ? "已连续通过内部误差门槛" : "在迭代上限内选择历史最低误差"}。这不代表该牌面已与商业数据库逐节点对照。</span></div>
                  )
                )}
                {riverDeepSolve.status === "error" && (
                  <>
                    <div><b>当前节点未能完成求解</b><span>{riverDeepSolve.error ?? "公开行动线超出了当前固定树。"}</span></div>
                    <button type="button" onClick={riverDeepSolve.onSolve}>重试</button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
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
    assistedDecisions: decisions.filter((item) => item.hintUsed).length,
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
      startingStack: player.handStartStack,
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
  const position = sixMaxPreflopPosition(index, game.dealer);
  const role = position === "BTN" ? "D" : position;
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

function HandHistoryReplayTable({
  entry,
  replay,
}: {
  entry: PokerHandHistoryEntry;
  replay: ReturnType<typeof pokerReplayEventsAtStep>;
}) {
  const actionText = replay.table.action?.text ?? replay.current.text;
  return (
    <section className="hand-history-table-replay" aria-label={`第 ${entry.hand} 手牌桌回放`}>
      <div className="hand-history-table-stage">
        <div className="hand-history-poker-table">
          <div className="hand-history-table-rail" />
          <div className="hand-history-table-felt">
            <div className="felt-grain" />
            <div className="hand-history-table-pot">
              <span>{replay.table.settled ? "本手总池" : "当前底池"}</span>
              <strong><i />{replay.table.settled ? entry.totalPot : replay.table.pot}</strong>
              {replay.table.settled && <em>已结算</em>}
            </div>
            <div className="hand-history-table-board" aria-label={`公共牌 ${replay.table.boardCount} 张`}>
              {[0, 1, 2, 3, 4].map((index) => (
                <PlayingCard
                  key={`${entry.id}-replay-board-${index}`}
                  card={index < replay.table.boardCount ? entry.board[index] : undefined}
                  ghost={index >= replay.table.boardCount}
                />
              ))}
            </div>
            <div className="hand-history-table-signature">RANGECRAFT <span>◆</span> HAND REPLAY</div>
          </div>

          {entry.players.map((player, index) => {
            const state = replay.table.players.find((candidate) => candidate.playerId === player.id);
            const role = historySeatRole(player.id, entry.dealer, entry.players.length);
            const isCurrent = replay.table.currentPlayerId === player.id;
            const folded = state?.folded ?? false;
            const winner = state?.isWinner ?? false;
            return (
              <article
                className={`hand-history-table-seat history-seat-${index} ${player.isHuman ? "is-hero" : ""} ${isCurrent ? "is-current" : ""} ${folded ? "is-folded" : ""} ${winner ? "is-winner" : ""}`}
                key={player.id}
                aria-label={`${player.name}${role ? `，${role}` : ""}，筹码 ${state?.stack ?? player.stack}${folded ? "，已弃牌" : ""}${winner ? "，赢家" : ""}`}
              >
                <div className="hand-history-table-hole" aria-label={`${player.name} 的完整底牌`}>
                  {(player.hole.length ? player.hole : [undefined, undefined]).map((card, cardIndex) => (
                    <PlayingCard key={card ? cardKey(card) : `${player.id}-back-${cardIndex}`} card={card} />
                  ))}
                </div>
                <div className="hand-history-table-player-panel">
                  <div className="avatar">{player.monogram}</div>
                  <div className="hand-history-table-player-copy">
                    <div><strong>{player.name}</strong>{role && <span>{role}</span>}</div>
                    <small>{player.isHuman ? "HERO" : `SEAT ${index + 1}`}</small>
                  </div>
                  <div className="hand-history-table-stack"><i />{state?.stack ?? player.stack}</div>
                </div>
                {(state?.streetBet ?? 0) > 0 && <div className="hand-history-table-bet"><i />{state?.streetBet}</div>}
                {isCurrent && replay.table.action && <div className="hand-history-seat-action">{replay.table.action.label}</div>}
                {folded && <div className="hand-history-table-folded">已弃牌</div>}
                {winner && <div className="hand-history-table-winner">赢家</div>}
              </article>
            );
          })}
        </div>
      </div>
      <div className={`hand-history-action-banner ${replay.current.kind}`}>
        <span>{STREET_LABELS[replay.current.street]} · {replay.current.kind === "deal" ? "发牌" : replay.current.kind === "result" ? "结算" : "行动"}</span>
        <strong>{actionText}</strong>
        <small>第 {replay.currentStep + 1}/{replay.events.length} 步 · {replay.table.settled ? `本手争夺 ${entry.totalPot} · 桌上底池 0` : `底池 ${replay.table.pot}`}</small>
      </div>
    </section>
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
          const displayedCards = bestFive ? orderFiveCardHandForDisplay(bestFive.cards) : player.hole;
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
    text: "已加入论文相位的 CFR+、DCFR(1.5,0,2) 和真实 1v1 河牌子博弈，并用独立 best response 审计误差；牌桌未命中已求解节点时仍明确使用本地近似，不把六人动态策略冒充精确解。",
  },
  {
    index: "05",
    eyebrow: "TABLE IMAGE",
    title: "形象与适应",
    text: "你和电脑都可以选择亮牌或盖牌。电脑实战动作按策略频率随机抽样，并从公开行动形成对你松紧、侵略性与欺骗性的判断；持续过度加注会触发更宽防守与更多价值反加注。",
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
    text: "Chrome 或 Edge 可点主页顶栏“安装应用”；Mac Safari 使用“添加到程序坞”，iPhone / iPad 使用“添加到主屏幕”。",
  },
  {
    index: "08",
    eyebrow: "OPEN ANYWHERE",
    title: "直接在线打开",
    text: "正式网址无需启动本地服务器。安装完成后可以像普通软件一样从桌面、程序坞或手机主屏幕直接进入。",
  },
] as const;

function LandingHome({
  onEnterSolo,
  onInstallApp,
  onOpenRules,
  appInstalled,
}: {
  onEnterSolo: () => void;
  onInstallApp: () => void;
  onOpenRules: () => void;
  appInstalled: boolean;
}) {
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
          {!appInstalled && (
            <button className="install-app-button" type="button" onClick={onInstallApp} aria-label="把 RangeCraft 安装到桌面">
              <span>↓</span><b>安装应用</b>
            </button>
          )}
          <button className="icon-button" type="button" aria-label="查看德州扑克规则" title="德州扑克规则" onClick={onOpenRules}>?</button>
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
            <div><small>LOCAL TRAINING</small><h3>单人训练</h3><p>浅筹、标准、深筹与血战鱿鱼；电脑风格每桌随机，逐手、整局和无尽对局都可按需查看 AI 提示。</p></div>
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
        <p>离线求解结果附误差与来源；当前牌桌策略仍明确标为本地近似。</p>
      </footer>
    </main>
  );
}

function SoloTrainer({ onExit }: { onExit: () => void }) {
  const [game, setGame] = useState<Game | null>(null);
  const [training, setTraining] = useState(true);
  const [revealedHintKey, setRevealedHintKey] = useState<string | null>(null);
  const [hintUseCount, setHintUseCount] = useState(0);
  const [raiseTo, setRaiseTo] = useState(BIG_BLIND * 2.5);
  const [riverSolve, setRiverSolve] = useState<RiverSolveState | null>(null);
  const [review, setReview] = useState<Review[]>([]);
  const [feedback, setFeedback] = useState<Review | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [soundOn, setSoundOn] = useState(() => isPokerAudioEnabled());
  const [mode, setMode] = useState<GameMode>("per_hand");
  const [sessionEnded, setSessionEnded] = useState(false);
  const [sessionResults, setSessionResults] = useState<SessionHandResult[]>([]);
  const [runDecisionStats, setRunDecisionStats] = useState(createPokerRunDecisionStats);
  const [heroImage, setHeroImage] = useState<TableImage>({
    loose: 0.5,
    aggressive: 0.5,
    deceptive: 0.5,
    observations: 0,
    pressure: {},
  });
  const [handHistory, setHandHistory] = useState<PokerHandHistoryEntry[]>([]);
  const [sealedRunHistory, setSealedRunHistory] = useState<PokerHandHistoryEntry[]>([]);
  const [historyHydrated, setHistoryHydrated] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [replayStep, setReplayStep] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [historyRunId, setHistoryRunId] = useState(createSoloHistoryRunId);
  const winSoundHand = useRef(0);
  const observedShowdownImageHand = useRef(0);
  const hintedDecisionKeys = useRef<Set<string>>(new Set());
  const soundOnRef = useRef(isPokerAudioEnabled());
  const riverSolveAbortRef = useRef<AbortController | null>(null);

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
    const entry = buildSoloHandHistoryEntry(finishedGame, mode, historyRunId);
    if (mode === "per_hand") {
      setHandHistory((items) => upsertPokerHandHistory(items, entry));
    } else {
      // Full hole cards for review runs stay in memory until the run is over.
      // A refresh therefore cannot turn an unfinished 20-hand/endless run into
      // an unlocked per-hand record.
      setSealedRunHistory((items) => upsertPokerHandHistory(items, entry));
    }
  }, [historyRunId, mode]);

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
    const defaultTarget = game?.street === "preflop" && game.raiseCount === 0
      ? BIG_BLIND * 2.5
      : minTarget;
    const timer = window.setTimeout(() => setRaiseTo(Math.max(minTarget, Math.min(maxTarget, defaultTarget))), 0);
    return () => window.clearTimeout(timer);
  }, [isHumanTurn, minTarget, maxTarget, game?.street, game?.raiseCount]);

  const equity = useMemo(() => {
    if (!game || !human || !isHumanTurn) return 0;
    return currentEquity(game, human, game.street === "preflop" ? 600 : 1_200);
  }, [game, human, isHumanTurn]);

  const baseAdvice = useMemo(() => (
    game && human && isHumanTurn ? getAdvice(game, human, equity) : null
  ), [game, human, isHumanTurn, equity]);
  const hintDecisionKey = game && human && isHumanTurn
    ? `${game.handNo}:${game.street}:${game.actionHistory.length}:${game.highestBet}:${human.bet}`
    : null;
  const riverCoachPlan = useMemo(() => (
    game && human && isHumanTurn ? buildSoloRiverCoachPlan(game, human, heroImage) : null
  ), [game, human, isHumanTurn, heroImage]);
  const currentRiverSolve = hintDecisionKey && riverSolve?.decisionKey === hintDecisionKey
    ? riverSolve
    : null;
  const advice = useMemo(() => {
    if (!baseAdvice) return null;
    if (!game || !human || currentRiverSolve?.status !== "solved" || !currentRiverSolve.result) return baseAdvice;
    return applySolvedRiverAdvice(baseAdvice, currentRiverSolve.result, game, human);
  }, [baseAdvice, currentRiverSolve, game, human]);
  const passiveActionLabel = game?.street === "preflop" && advice
    ? preflopPassiveActionLabel(advice.preflopScenarioKey)
    : "跟注";
  const aggressiveActionLabel = game?.street === "preflop" && advice
    ? preflopAggressiveActionLabel(advice.preflopScenarioKey, game.raiseCount)
    : "加注";
  const hintRevealed = Boolean(hintDecisionKey && revealedHintKey === hintDecisionKey);
  const revealCurrentHint = useCallback(() => {
    if (!hintDecisionKey) return;
    if (!hintedDecisionKeys.current.has(hintDecisionKey)) {
      hintedDecisionKeys.current.add(hintDecisionKey);
      setHintUseCount((count) => count + 1);
    }
    setRevealedHintKey(hintDecisionKey);
  }, [hintDecisionKey]);
  const runRiverDeepSolve = useCallback(() => {
    if (!hintDecisionKey || !riverCoachPlan) return;
    if (
      riverSolve?.decisionKey === hintDecisionKey
      && (riverSolve.status === "running" || riverSolve.status === "solved")
    ) return;
    const decisionKey = hintDecisionKey;
    riverSolveAbortRef.current?.abort();
    const controller = new AbortController();
    riverSolveAbortRef.current = controller;
    setRiverSolve({ decisionKey, status: "running" });
    window.setTimeout(() => {
      void (async () => {
        try {
          const result = riverCoachPlan.mode === "three-way"
            ? await solveThreeWayRiverCoachDecisionInWorker(riverCoachPlan.request, {
                signal: controller.signal,
                onProgress(progress) {
                  setRiverSolve((current) => current?.decisionKey === decisionKey
                    ? { ...current, status: "running", progress }
                    : current);
                },
              })
            : solveRiverCoachDecision(riverCoachPlan.request);
          if (controller.signal.aborted) return;
          setRiverSolve((current) => {
            if (current?.decisionKey !== decisionKey) return current;
            if (current.status === "solved") return current;
            return { decisionKey, status: "solved", result };
          });
        } catch (error) {
          if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
          const message = error instanceof Error ? error.message : "未知求解错误";
          setRiverSolve((current) => (
            current?.decisionKey === decisionKey
              ? { decisionKey, status: "error", error: message }
              : current
          ));
        } finally {
          if (riverSolveAbortRef.current === controller) riverSolveAbortRef.current = null;
        }
      })();
    }, 32);
  }, [hintDecisionKey, riverCoachPlan, riverSolve]);

  useEffect(() => {
    const controller = riverSolveAbortRef.current;
    if (controller && riverSolve?.status === "running" && riverSolve.decisionKey !== hintDecisionKey) {
      controller.abort();
      riverSolveAbortRef.current = null;
    }
  }, [hintDecisionKey, riverSolve]);

  useEffect(() => () => riverSolveAbortRef.current?.abort(), []);
  const riverDeepSolveControl = useMemo<RiverDeepSolveControl | undefined>(() => {
    if (!riverCoachPlan) return undefined;
    const threeWayResult = currentRiverSolve?.result && isThreeWayRiverResult(currentRiverSolve.result)
      ? currentRiverSolve.result
      : null;
    const headsUpResult = currentRiverSolve?.result && !isThreeWayRiverResult(currentRiverSolve.result)
      ? currentRiverSolve.result
      : null;
    return {
      eligible: true,
      mode: riverCoachPlan.mode,
      status: currentRiverSolve?.status ?? "idle",
      error: currentRiverSolve?.error,
      progress: currentRiverSolve?.progress,
      nashConvPotFraction: threeWayResult?.nashConvPotFraction,
      quickNashConvPotFraction: threeWayResult?.quickNashConvPotFraction,
      targetNashConvPotFraction: threeWayResult?.targetNashConvPotFraction,
      actionRegretDriftPotFraction: threeWayResult?.actionRegretDriftPotFraction,
      targetActionRegretDriftPotFraction: threeWayResult?.targetActionRegretDriftPotFraction,
      frequencyTotalVariation: threeWayResult?.frequencyTotalVariation,
      acceptedForScoring: threeWayResult?.acceptedForScoring,
      scoringTargetPotFraction: threeWayResult?.scoringTargetPotFraction,
      quickRepresentativeCombos: threeWayResult?.quickRepresentativeCombos?.oop,
      representativeCombos: threeWayResult?.representativeCombos.oop,
      iterations: threeWayResult?.iterations,
      quickIterations: threeWayResult?.quickIterations,
      targetMet: threeWayResult?.targetMet,
      headsUpExploitabilityPotFraction: headsUpResult?.exploitabilityPotFraction,
      headsUpTargetExploitabilityPotFraction:
        headsUpResult?.convergence.targetExploitabilityPotFraction,
      headsUpTrainedIterations: headsUpResult?.convergence.trainedIterations,
      headsUpSelectedIterations: headsUpResult?.convergence.selectedIterations,
      headsUpStopReason: headsUpResult?.convergence.stopReason,
      onSolve: runRiverDeepSolve,
    };
  }, [riverCoachPlan, currentRiverSolve, runRiverDeepSolve]);

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
    riverSolveAbortRef.current?.abort();
    riverSolveAbortRef.current = null;
    setMode(nextMode);
    setTraining(nextMode === "per_hand");
    setRevealedHintKey(null);
    setHintUseCount(0);
    setRiverSolve(null);
    hintedDecisionKeys.current.clear();
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
    setHeroImage({ loose: 0.5, aggressive: 0.5, deceptive: 0.5, observations: 0, pressure: {} });
    setDealing(false);
    setRaiseTo(BIG_BLIND * 2.5);
    winSoundHand.current = 0;
    observedShowdownImageHand.current = 0;
    setHistoryRunId(createSoloHistoryRunId());
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
    const solvedAdvice = "riverSolver" in advice ? advice as SolvedRiverAdvice : null;
    const sizingContext = pokerSizingContext(game, human);
    const actualRaiseTo = kind === "raise" ? legalPokerRaiseTarget(sizingContext, raiseTo) : null;
    const actualBetFraction = actualRaiseTo === null ? null : pokerRaiseFraction(sizingContext, actualRaiseTo);
    const solvedRoutesForAction = solvedAdvice?.riverSolver.actions.filter((route) => route.action === kind) ?? [];
    const selectedSolverRoute = kind === "raise" && actualRaiseTo !== null
      ? [...solvedRoutesForAction].sort((left, right) => (
          Math.abs((left.raiseToBb ?? 0) - actualRaiseTo / BIG_BLIND)
          - Math.abs((right.raiseToBb ?? 0) - actualRaiseTo / BIG_BLIND)
        ))[0]
      : solvedRoutesForAction[0];
    const solverOffTreeBb = kind === "raise"
      && actualRaiseTo !== null
      && selectedSolverRoute?.raiseToBb !== undefined
        ? Math.abs(actualRaiseTo / BIG_BLIND - selectedSolverRoute.raiseToBb)
        : 0;
    const solverRouteEligible = Boolean(selectedSolverRoute && solverOffTreeBb <= 0.05);
    const gradingAdvice = solvedAdvice
      && (!solvedAdvice.riverSolverGradingAccepted || !solverRouteEligible)
        ? solvedAdvice.riverSolverFallback
        : advice;
    const bestFrequency = Math.max(...Object.values(gradingAdvice.frequencies));
    const selectedFrequency = gradingAdvice.frequencies[kind];
    const relativeFrequency = selectedFrequency / Math.max(0.001, bestFrequency);
    const actionScore = selectedFrequency > 0 ? Math.round(40 + 60 * relativeFrequency) : 30;
    let actionVerdict = selectedFrequency <= Number.EPSILON
      ? "当前模型不支持"
      : selectedFrequency < 0.02
        ? "极低频路线"
        : relativeFrequency >= 0.78
          ? "主频路线"
          : relativeFrequency >= 0.28 || selectedFrequency >= 0.15
            ? "可接受混合"
            : "低频路线";
    const sizeScore = actualRaiseTo === null
      ? null
      : scorePokerRaiseSize(sizingContext, actualRaiseTo, gradingAdvice.sizingRoutes);
    let sizeVerdict = actualRaiseTo === null
      ? ""
      : pokerRaiseSizeVerdict(sizingContext, actualRaiseTo, gradingAdvice.sizingRoutes);
    // A correct conditional size cannot rescue an action that barely exists in
    // the strategy. Size therefore adjusts the action score downward only.
    let score = sizeScore === null
      ? actionScore
      : Math.round(actionScore * (0.65 + 0.35 * sizeScore / 100));
    let solverKind: Review["solverKind"] = null;
    let solverEvLossBb: number | null = null;
    let solverExploitabilityPotFraction: number | null = null;
    let solverNashConvBb: number | null = null;
    let solverNashConvPotFraction: number | null = null;
    let solverQuickNashConvPotFraction: number | null = null;
    let solverActionRegretDriftPotFraction: number | null = null;
    let solverFrequencyTotalVariation: number | null = null;
    let solverTargetPotFraction: number | null = null;
    let solverTargetMet: boolean | null = null;
    let solverAcceptedForScoring: boolean | null = null;
    let solverIterations: number | null = null;
    let solverQuickIterations: number | null = null;
    let solverRepresentativeCombos = "";
    let solverDetails = "";
    if (solvedAdvice) {
      const riverSolver = solvedAdvice.riverSolver;
      const threeWay = isThreeWayRiverResult(riverSolver);
      solverKind = threeWay ? "three-way-approximation" : "heads-up-fixed-tree";
      solverIterations = riverSolver.iterations;
      if (threeWay) {
        solverNashConvBb = riverSolver.nashConvBb;
        solverNashConvPotFraction = riverSolver.nashConvPotFraction;
        solverQuickNashConvPotFraction = riverSolver.quickNashConvPotFraction;
        solverActionRegretDriftPotFraction = riverSolver.actionRegretDriftPotFraction;
        solverFrequencyTotalVariation = riverSolver.frequencyTotalVariation;
        solverTargetPotFraction = riverSolver.targetNashConvPotFraction;
        solverTargetMet = riverSolver.targetMet;
        solverAcceptedForScoring = riverSolver.acceptedForScoring;
        solverQuickIterations = riverSolver.quickIterations;
        solverRepresentativeCombos = `${riverSolver.quickRepresentativeCombos?.oop ?? "—"}→${riverSolver.representativeCombos.oop} / 人`;
      } else {
        solverExploitabilityPotFraction = riverSolver.exploitabilityPotFraction;
        solverRepresentativeCombos = `${riverSolver.representativeCombos.oop}×${riverSolver.representativeCombos.ip}`;
      }
      const selectedRoute = selectedSolverRoute;
      const offTreeBb = solverOffTreeBb;
      if (selectedRoute && solverRouteEligible && solvedAdvice.riverSolverGradingAccepted) {
        const bestEvBb = Math.max(...riverSolver.actions.map((route) => route.evBb));
        solverEvLossBb = Math.max(0, bestEvBb - selectedRoute.evBb);
        const lossPotFraction = solverEvLossBb / Math.max(0.5, committedPot(game) / BIG_BLIND);
        // Whole-range NashConv is an admission diagnostic, not a per-holding
        // confidence interval. For a three-way score use only the observed
        // current-hand action-regret drift across range resolutions as an
        // empirical calibration zone; it is deliberately not described as a
        // mathematical error bound.
        const empiricalDeadZonePotFraction = threeWay
          ? riverSolver.actionRegretDriftPotFraction ?? 0
          : riverSolver.exploitabilityPotFraction;
        const scorableLossPotFraction = Math.max(0, lossPotFraction - empiricalDeadZonePotFraction);
        const evScore = scorableLossPotFraction <= 0.001
          ? 100
          : scorableLossPotFraction <= 0.005
            ? 96
            : scorableLossPotFraction <= 0.015
              ? 86
              : scorableLossPotFraction <= 0.03
                ? 72
                : Math.max(25, Math.round(72 * Math.exp(-(scorableLossPotFraction - 0.03) * 8)));
        score = sizeScore === null
          ? evScore
          : Math.round(evScore * (0.72 + 0.28 * sizeScore / 100));
        actionVerdict = lossPotFraction <= empiricalDeadZonePotFraction
          ? "落在跨分辨率经验稳定区内"
          : scorableLossPotFraction <= 0.005
            ? "极低 EV 损失"
            : scorableLossPotFraction <= 0.015
              ? "可接受的局部解路线"
              : "明显 EV 损失";
        solverDetails = threeWay
          ? `你的动作对应 ${solverActionLabel(selectedRoute)}，相对当前最高动作的 EV 损失为 ${solverEvLossBb.toFixed(2)} BB；全范围 NashConv 只负责准入，评分采用当前手牌跨范围分辨率观察到的 ${(empiricalDeadZonePotFraction * 100).toFixed(1)}% 动作 regret 漂移作经验死区。它是保守校准，不是逐手牌误差上界。`
          : `你的动作对应 ${solverActionLabel(selectedRoute)}，相对当前最高动作的 EV 损失为 ${solverEvLossBb.toFixed(2)} BB；评分先扣除约 ${(empiricalDeadZonePotFraction * 100).toFixed(1)}% 底池的固定树误差校准区。`;
      } else if (selectedRoute && !solverRouteEligible) {
        sizeVerdict += `${sizeVerdict ? "；" : ""}该尺寸与最近固定树节点相差 ${offTreeBb.toFixed(1)} BB，按树外尺寸处理`;
        solverDetails = "你的下注尺寸不在当前固定树中，因此没有映射到最近尺寸计算看似精确的 EV 损失；本次尺寸与动作评分保留公开范围启发式。";
      } else if (threeWay && solvedAdvice.riverSolverAccepted && !solvedAdvice.riverSolverGradingAccepted) {
        solverDetails = `三人多分辨率结果已通过 ≤${(riverSolver.targetNashConvPotFraction * 100).toFixed(0)}% 实验提示门槛，但未通过 ≤${(riverSolver.scoringTargetPotFraction * 100).toFixed(0)}% 较高稳定性评分门槛；提示采用高分辨率混合，分数仍使用公开范围启发式。`;
      } else if (threeWay && !solvedAdvice.riverSolverAccepted) {
        solverDetails = `三人快速/复核 NashConv 与跨分辨率动作 regret 没有同时达到 ≤${(riverSolver.targetNashConvPotFraction * 100).toFixed(0)}% 实验提示门槛；本次仍按公开范围启发式提示与评分。`;
      } else if (!threeWay && solvedAdvice.riverSolverAccepted && !solvedAdvice.riverSolverGradingAccepted) {
        solverDetails = `单挑固定树结果已达到训练提示门槛，但可剥削度尚未进入正式局部 EV 评分级别；提示采用 DCFR 混合，分数仍使用公开范围启发式。`;
      } else if (threeWay && !selectedRoute) {
        solverDetails = "你的动作不在当前单次下注固定树中，因此没有把中心化动作效用映射成 EV 损失；该动作需要保留到更完整的含加注树复盘。";
      }
    }
    const actionLabel = actualRaiseTo === null
      ? game.street === "preflop" && kind === "call"
        ? preflopPassiveActionLabel(gradingAdvice.preflopScenarioKey)
        : ACTION_LABELS[kind]
      : (() => {
          const formatted = formatPokerSizingRoute(sizingContext, {
            target: actualRaiseTo,
            fraction: actualBetFraction ?? 0,
            frequency: 1,
            allIn: actualRaiseTo === sizingContext.playerBet + sizingContext.playerStack,
          });
          return game.street === "preflop" && gradingAdvice.preflopScenarioKey === "isolate"
            ? formatted.replace(/^开池至/, "隔离加注至")
            : formatted;
        })();
    const hintUsedForDecision = Boolean(
      hintDecisionKey && hintedDecisionKeys.current.has(hintDecisionKey),
    );
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
      potOdds: gradingAdvice.potOdds,
      equityRealization: gradingAdvice.equityRealization,
      realizationThreshold: gradingAdvice.realizationThreshold,
      callEv: gradingAdvice.callEv,
      heroStackBb: gradingAdvice.heroStackBb,
      opponentStackBb: gradingAdvice.opponentStackBb,
      opponentName: gradingAdvice.opponentName,
      effectiveStackBb: gradingAdvice.effectiveStackBb,
      startingDepthBb: gradingAdvice.startingDepthBb,
      maxContestableBb: gradingAdvice.maxContestableBb,
      spr: gradingAdvice.spr,
      strategySource: gradingAdvice.strategySource,
      solverKind,
      solverEvLossBb,
      solverExploitabilityPotFraction,
      solverNashConvBb,
      solverNashConvPotFraction,
      solverQuickNashConvPotFraction,
      solverActionRegretDriftPotFraction,
      solverFrequencyTotalVariation,
      solverTargetPotFraction,
      solverTargetMet,
      solverAcceptedForScoring,
      solverIterations,
      solverQuickIterations,
      solverRepresentativeCombos,
      solverDetails,
      preflopPosition: gradingAdvice.preflopPosition,
      preflopScenario: gradingAdvice.preflopScenario,
      preflopTargetRange: gradingAdvice.preflopTargetRange,
      preflopEnterFrequency: gradingAdvice.preflopEnterFrequency,
      action: actionLabel,
      actionKind: kind,
      actualRaiseTo,
      actualBetFraction,
      recommended: gradingAdvice.recommendedLabel,
      recommendedAction: gradingAdvice.action,
      recommendedRaiseTo: gradingAdvice.recommendedRaiseTo,
      recommendedBetFraction: gradingAdvice.recommendedBetFraction,
      mix: gradingAdvice.mix,
      sizingMix: gradingAdvice.sizingMix,
      sizeScore,
      sizeVerdict,
      selectedFrequency,
      actionVerdict,
      score,
      note: `${gradingAdvice.note}${solverDetails ? ` ${solverDetails}` : ""}`,
      hintUsed: hintUsedForDecision,
    };
    setReview((items) => [entry, ...items].slice(0, POKER_RUN_DECISION_HISTORY_LIMIT));
    setRunDecisionStats((stats) => recordPokerRunDecision(stats, game.street, score));
    setFeedback(mode === "per_hand" ? entry : null);
    setHeroImage((image) => {
      const looseSignal = kind === "fold" ? 0.18 : kind === "check" ? 0.4 : kind === "call" ? 0.68 : 0.78;
      const aggressionSignal = kind === "raise" ? 0.9 : kind === "fold" ? 0.34 : 0.24;
      return updateHeroTableImage(
        image,
        { loose: looseSignal, aggressive: aggressionSignal },
        raiseDisabled
          ? undefined
          : { node: heroDecisionPressureNode(game, toCall), aggressive: kind === "raise" },
      );
    });
    setGame((current) => (current ? act(current, human.id, kind, actualRaiseTo ?? undefined) : current));
  }, [game, human, isHumanTurn, advice, raiseTo, toCall, equity, soundOn, mode, hintDecisionKey, raiseDisabled]);

  const toggleSound = useCallback(() => {
    const next = !soundOn;
    setSoundOn(next);
    soundOnRef.current = next;
    void setPokerAudioEnabled(next).then(() => {
      if (next) playPokerSound("call");
    });
  }, [soundOn]);

  const availableHandHistory = useMemo(() => (
    sessionEnded && sealedRunHistory.length
      ? mergePokerHandHistory(handHistory, sealedRunHistory)
      : handHistory
  ), [handHistory, sealedRunHistory, sessionEnded]);
  const currentRunHistory = availableHandHistory.filter((entry) => entry.runId === historyRunId);
  const currentReviewHistory = currentRunHistory.find((entry) => entry.hand === game?.handNo)
    ?? currentRunHistory[0]
    ?? null;
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
      if (historyOpen || rulesOpen) return;
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
  }, [game, dealing, isHumanTurn, toCall, raiseDisabled, handleAction, startNextHand, mode, historyOpen, rulesOpen]);

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
  const reportHintCount = mode === "per_hand"
    ? handReview.filter((item) => item.hintUsed).length
    : hintUseCount;
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
  const heroCounterPressure = Math.max(
    heroNodePressure(heroImage, "preflop_open"),
    heroNodePressure(heroImage, "preflop_reraise"),
    heroNodePressure(heroImage, "postflop_bet"),
    heroNodePressure(heroImage, "postflop_raise"),
  );
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
          <span>盲注 {SMALL_BLIND}/{BIG_BLIND} · 6-MAX · cEV 无抽水</span>
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
          <button className={`sound-toggle ${soundOn ? "on" : ""}`} onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? "关闭牌桌音效" : "开启牌桌音效"}>
            <span>{soundOn ? "♪" : "—"}</span><b>音效</b><em>{soundOn ? "ON" : "OFF"}</em>
          </button>
          <button
            className={`training-toggle ${training ? "on" : ""}`}
            type="button"
            onClick={() => {
              if (training) setRevealedHintKey(null);
              setTraining((value) => !value);
            }}
            aria-pressed={training}
            title={training ? "关闭按需 AI 提示" : "开启按需 AI 提示；完整复盘与对手画像仍在结束后解锁"}
          >
            <span>AI 提示</span><b>{training ? "ON" : "OFF"}</b>
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
                  <button className="next-hand-button" onClick={() => setShowLog(true)}>查看{game.presetKey === "squid" ? "鱿鱼" : ""}整局策略点评</button>
                ) : mode === "endless" && sessionEnded ? (
                  <button className="next-hand-button" onClick={() => setShowLog(true)}>查看无尽对局策略点评</button>
                ) : mode === "endless" ? (
                  <div className="endless-hand-actions">
                    <button className="next-hand-button" onClick={startNextHand}>下一手 · 筹码延续 <kbd>N</kbd></button>
                    <button className="finish-endless-button" onClick={finishEndlessRun}>结束无尽局并生成点评</button>
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
                    <button
                      className="action-button neutral"
                      onClick={() => handleAction("call")}
                      disabled={!isHumanTurn}
                      aria-label={`${passiveActionLabel}，再投入 ${toCall}`}
                    >{passiveActionLabel} {toCall} <kbd>C</kbd></button>
                  )}
                  <button
                    className="action-button raise"
                    onClick={() => handleAction("raise")}
                    disabled={raiseDisabled}
                    title={human.raiseLocked
                      ? "不足额全下未重新开放加注权"
                      : !opponentCanRespond ? "所有对手都已全下，不能继续加注" : undefined}
                    aria-label={`${aggressiveActionLabel}至 ${raiseTo}`}
                  >{aggressiveActionLabel}至 {raiseTo} <kbd>R</kbd></button>
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
                  {game.street === "preflop" && advice?.preflopScenarioKey === "open" && <small className="sizing-basis-note">无人入池：跛入是你主动补齐大盲；开池才是主动加注</small>}
                  {game.street === "preflop" && advice?.preflopScenarioKey === "isolate" && <small className="sizing-basis-note">前方已有 {advice.preflopLimpers} 人跛入：可跟随跛入或隔离加注</small>}
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
                ? game.presetKey === "squid" ? `鱿鱼策略点评 · ${squidAwarded}/${game.squid.total}` : `整局策略点评 · ${completedHands}/${SESSION_HANDS}`
                : mode === "endless" ? `无尽策略点评 · ${completedHands} 手` : `本手策略点评${reviewUnlocked ? " · 已解锁" : ""}`}
            </button>
          </div>

          {!showLog ? isReviewRun ? (
            <div className="analysis-content session-live">
              <section className="session-lock">
                <div className="lock-orbit">◇</div>
                <span>SESSION REVIEW LOCKED</span>
                <h3>{mode === "endless"
                  ? "完整策略点评留到你主动结束之后"
                  : game.presetKey === "squid" ? "完整策略点评留到 9 条鱿鱼发完之后" : "完整策略点评留到第 20 手之后"}</h3>
                <p>{mode === "endless"
                  ? "无尽模式默认关闭提示；需要时可在右上角开启，并只查看当前节点。长期评分、完整决策路径和电脑画像仍在结束后公开。"
                  : "整局模式默认关闭提示；卡住时可在右上角开启，并只查看当前节点。决策分数、完整路径和对手类型仍在整局结束后公开。"}</p>
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
              <AiDecisionHint
                compact
                enabled={training}
                isHumanTurn={isHumanTurn}
                advice={advice}
                revealed={hintRevealed}
                riverDeepSolve={riverDeepSolveControl}
                onReveal={revealCurrentHint}
              />
              <section className="public-state">
                <div className="section-label"><span>公开牌局状态</span><small>提示需主动查看</small></div>
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
                <div className="section-label"><span>{game.street === "preflop" ? "翻前范围节点" : "牌面与行动范围"}</span><b>{isHumanTurn ? "RANGE" : "WAIT"}</b></div>
                <div className="equity-main">
                  <div className="equity-number"><strong>{isHumanTurn
                    ? game.street === "preflop" && advice
                      ? Number((advice.preflopEnterFrequency * 100).toFixed(1))
                      : Math.round(equity * 100)
                    : "—"}</strong><span>%<br />{game.street === "preflop" ? "本手入池频率" : "估算权益"}</span></div>
                  <div className="equity-bars">
                    <span><i style={{ width: `${isHumanTurn
                      ? game.street === "preflop" && advice ? advice.preflopEnterFrequency * 100 : equity * 100
                      : 0}%` }} /></span>
                    <div><b>你的手牌</b><em>{human.hole.map(cardText).join("  ")}</em></div>
                  </div>
                </div>
                <div className="metric-grid">
                  {game.street === "preflop" && advice ? (
                    <div><span>当前节点</span><strong>{advice.preflopPosition} · {advice.preflopScenario}</strong></div>
                  ) : (
                    <div><span>底池赔率</span><strong>{isHumanTurn && advice ? `${Math.round(advice.potOdds * 100)}%` : "—"}</strong></div>
                  )}
                  <div><span>{isHumanTurn && advice ? `你 / ${advice.opponentName}` : "双方后手"}</span><strong>{isHumanTurn && advice ? `${advice.heroStackBb.toFixed(1)} / ${advice.opponentStackBb.toFixed(1)} BB` : "—"}</strong></div>
                  <div><span>有效 / SPR</span><strong>{isHumanTurn && advice ? `${advice.effectiveStackBb.toFixed(1)} / ${advice.spr.toFixed(1)}` : "—"}</strong></div>
                </div>
                <p className="range-note">{isHumanTurn && advice
                  ? game.street === "preflop" && advice.preflopScenarioKey === "open"
                    ? `未开池（RFI）：底池 ${committedPot(game)} 仅由小盲 ${SMALL_BLIND} + 大盲 ${BIG_BLIND} 构成，前面没有玩家 Limp。跛入的 40% 即时价格不能与原始摊牌权益直接比较。`
                    : game.street === "preflop" && advice.preflopScenarioKey === "isolate"
                      ? `前方已有 ${advice.preflopLimpers} 位玩家跛入；当前分开评估跟随跛入与隔离加注，不把它当作普通跟注。`
                      : `${advice.strategySource} · 按位置、完整公开行动线、下注尺度与多人底池动态加权；不会读取电脑暗牌。`
                  : "等待你的行动点后，系统才会生成不读取电脑暗牌的范围估算。"}</p>
              </section>

              <AiDecisionHint
                enabled={training}
                isHumanTurn={isHumanTurn}
                advice={advice}
                revealed={hintRevealed}
                riverDeepSolve={riverDeepSolveControl}
                onReveal={revealCurrentHint}
              />

              {feedback ? (
                <section className="last-decision">
                  <div className="decision-top"><span>上一决策{feedback.hintUsed ? " · 借助提示" : " · 独立完成"}</span><b className={feedback.score >= 85 ? "good" : feedback.score >= 65 ? "ok" : "bad"}>{feedback.score} 分</b></div>
                  <h3>{feedback.score >= 85 ? "线路漂亮，继续保持" : feedback.score >= 65 ? "可执行，但有更优选择" : "这里值得重点复盘"}</h3>
                  <p>你选择了{feedback.action}，属于{feedback.actionVerdict}（{formatPokerFrequency(feedback.selectedFrequency)}）。参考混合：{feedback.mix}。{feedback.sizingMix ? `进入加注分支后的尺寸混合：${feedback.sizingMix}。` : ""}{feedback.sizeVerdict ? `${feedback.sizeVerdict}。` : ""}{feedback.note}</p>
                  <p className="range-note">来源：{feedback.strategySource}。{feedback.solverKind === "three-way-approximation"
                    ? `三人多分辨率 ${feedback.solverRepresentativeCombos} · 快速/复核 ${feedback.solverQuickIterations ?? "—"}/${feedback.solverIterations ?? "—"} 轮 · NashConv ${((feedback.solverQuickNashConvPotFraction ?? 0) * 100).toFixed(1)}% / ${((feedback.solverNashConvPotFraction ?? 0) * 100).toFixed(1)}% · 动作 regret 差 ${((feedback.solverActionRegretDriftPotFraction ?? 0) * 100).toFixed(1)}%；${!feedback.solverTargetMet
                      ? "未通过实验提示门槛，提示和评分都使用公开范围启发式。"
                      : !feedback.solverAcceptedForScoring
                        ? "已接管提示，但未通过较高稳定性评分门槛，分数仍使用公开范围启发式。"
                        : feedback.solverEvLossBb !== null
                        ? `已按相对最高动作 EV 损失 ${feedback.solverEvLossBb.toFixed(2)} BB 评分。`
                        : "求解已达门槛，但你的动作不在固定树中，因此没有按求解器 EV 损失评分。"}`
                    : feedback.solverEvLossBb === null
                      ? "分数表示与当前公开策略频率的匹配程度，不是求解器计算的 EV 损失。"
                      : `分数以局部求解器动作 EV 损失 ${feedback.solverEvLossBb.toFixed(2)} BB 为主；固定树可剥削度约 ${((feedback.solverExploitabilityPotFraction ?? 0) * 100).toFixed(3)}% 底池。`}</p>
                </section>
              ) : (
                <section className="last-decision empty-decision"><span>完成第一个决策后，这里会出现即时反馈。</span></section>
              )}

              <section className="opponent-grid">
                <div className="section-label"><span>对手画像</span><small>牌后解锁</small></div>
                <div className="locked-profile">
                  <span>◇</span>
                  <div><b>本手保持未知</b><p>结束后进入“本手策略点评”，再查看每位电脑的策略倾向。</p></div>
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
                  : mode === "endless" ? "完成本手后可主动结束并生成策略点评" : "本手尚未结束"}</h3>
                <p>{showDecisionPending
                  ? "完成本手的展示决策后再生成报告，避免复盘信息影响你的选择。"
                  : isReviewRun ? mode === "endless" ? "继续对局，或在一手完整结算后点击“结束无尽局并生成点评”。牌桌可按需查看当前提示；完整路径、分数和对手类型仍在结束后公开。" : "整局结束后一次生成完整策略点评；牌桌可按需查看当前提示，但不会提前公开完整路径、分数和对手类型。"
                  : "牌局结束后会自动生成这手牌的决策点评。"}</p>
                <button onClick={() => setShowLog(false)}>回到牌桌</button>
              </section>
            </div>
          ) : (
            <div className="log-content">
              <div className="review-summary unlocked">
                <div>
                  <span>{mode === "session"
                    ? game.presetKey === "squid" ? "鱿鱼整局策略点评已生成" : "20 手整局策略点评已生成"
                    : mode === "endless" ? "无尽对局策略点评已生成" : "本手策略点评已生成"}</span>
                  <h3>{TABLE_PRESETS[game.presetKey].shortLabel} · {isReviewRun ? `${completedHands} 手 · ${runDecisionStats.count} 个决策节点` : `第 ${game.handNo} 手 · ${STREET_LABELS[game.street]}`}</h3>
                </div>
                <strong>{reportScore}<small>{reportReview.length ? reportHintCount ? `策略匹配度 · 提示 ${reportHintCount}` : "策略匹配度 · 独立" : "暂无决策"}</small></strong>
              </div>

              <section className="strategy-review-replay" aria-label="牌桌回放入口">
                <div>
                  <span>VISUAL HAND REPLAY</span>
                  <strong>策略点评看原因，牌桌回放看过程</strong>
                  <p>在原牌桌上逐步查看每位玩家的行动、下注额、剩余筹码与完整赛后底牌。</p>
                </div>
                <button
                  type="button"
                  onClick={() => openHandHistory(currentReviewHistory?.id)}
                  disabled={!historyAccessUnlocked || !currentReviewHistory}
                >
                  打开牌桌回放 <span aria-hidden="true">↗</span>
                </button>
              </section>

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
                    <div><span>近期施压反应</span><strong>{heroCounterPressure > 0.48 ? "强反制" : heroCounterPressure > 0.2 ? "已警觉" : "观察中"}</strong></div>
                    <div><span>画像样本</span><strong>{heroImage.observations} 次</strong></div>
                    <div><span>画像信息边界</span><strong>仅公开行动与亮牌</strong></div>
                    <div><span>使用 AI 提示</span><strong>{hintUseCount} 次</strong></div>
                  </div>
                  <SquidScoreboard game={game} report />
                  <div className="session-hand-list">
                    <div className="section-label"><span>{completedHands > sessionResults.length ? `最近 ${sessionResults.length} 手结果` : "逐手结果"}</span><small>累计统计保留全部样本 · 低于 1 BB 自动补至初始买入</small></div>
                    {[...sessionResults].sort((a, b) => a.hand - b.hand).map((item) => {
                      const historyEntry = currentRunHistory.find((entry) => entry.hand === item.hand);
                      return (
                        <div className="session-hand-result" key={item.hand}>
                          <span>{String(item.hand).padStart(2, "0")}</span>
                          <p><b>{item.heroCards}</b><small>{item.result} · 桌面 {item.heroStack} / 投入 {item.heroCashInvested} / 净 {item.heroNet >= 0 ? "+" : ""}{item.heroNet}{item.assistedDecisions ? ` · 提示 ${item.assistedDecisions}` : " · 独立"}</small></p>
                          <em>{item.score ?? "—"}<small>{item.decisions ? "分" : "无决策"}</small></em>
                          <button
                            className="session-hand-replay"
                            type="button"
                            onClick={() => openHandHistory(historyEntry?.id)}
                            disabled={!historyEntry}
                            aria-label={`回放第 ${item.hand} 手牌桌`}
                          >
                            牌桌回放 <span aria-hidden="true">↗</span>
                          </button>
                        </div>
                      );
                    })}
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
                      <p>你的选择：{item.action}（{item.actionVerdict}，{formatPokerFrequency(item.selectedFrequency)}）；最高频线路：{item.recommended}；{item.hintUsed ? "本节点借助了 AI 提示" : "本节点独立完成"}</p>
                      <p>参考混合：{item.mix}</p>
                      <p>本手起始有效 {item.startingDepthBb.toFixed(1)} BB · 当前后手：你 {item.heroStackBb.toFixed(1)} BB / {item.opponentName} {item.opponentStackBb.toFixed(1)} BB · 本节点有效 {item.effectiveStackBb.toFixed(1)} BB{item.maxContestableBb > item.effectiveStackBb + 0.05 ? ` · 多人加注有效上限 ${item.maxContestableBb.toFixed(1)} BB` : ""}</p>
                      {item.sizingMix && <p>进入加注分支后的尺寸混合：{item.sizingMix}{item.sizeVerdict ? `；${item.sizeVerdict}` : ""}</p>}
                      {item.streetKey === "preflop" ? (
                        <small>{item.preflopPosition} · {item.preflopScenario} · 基准继续范围约 {Math.round(item.preflopTargetRange * 100)}% · 本手进入频率 {formatPokerFrequency(item.preflopEnterFrequency)} · 翻前原始摊牌权益不作为首入池阈值 · 来源：{item.strategySource}。{item.note}</small>
                      ) : (
                        <small>对行动范围估算权益 {Math.round(item.equity * 100)}% / 直接赔率 {Math.round(item.potOdds * 100)}% / 权益实现参考线 {Math.round(item.realizationThreshold * 100)}% · 权益实现估算 {Math.round(item.equityRealization * 100)}% · 有效筹码 {item.effectiveStackBb.toFixed(1)} BB / SPR {item.spr.toFixed(1)}{item.solverKind === "three-way-approximation"
                          ? ` · 三人 ${item.solverRepresentativeCombos} · NashConv ${((item.solverQuickNashConvPotFraction ?? 0) * 100).toFixed(1)}%/${((item.solverNashConvPotFraction ?? 0) * 100).toFixed(1)}% · regret 稳定差 ${((item.solverActionRegretDriftPotFraction ?? 0) * 100).toFixed(1)}%${!item.solverTargetMet ? " · 未接管提示或评分" : !item.solverAcceptedForScoring ? " · 仅接管提示" : item.solverEvLossBb === null ? " · 树外动作无 EV 评分" : ` · 相对最高动作 EV 损失 ${item.solverEvLossBb.toFixed(2)} BB`}`
                          : item.solverEvLossBb !== null
                            ? ` · 局部求解器动作 EV 损失 ${item.solverEvLossBb.toFixed(2)} BB · 固定树可剥削度 ${((item.solverExploitabilityPotFraction ?? 0) * 100).toFixed(3)}%`
                            : item.callEv === null ? "" : ` · 跟注 EV 代理 ${item.callEv >= 0 ? "+" : ""}${Math.round(item.callEv)}`} · 来源：{item.strategySource}。{item.note}</small>
                      )}
                    </div>
                  </div>
                )) : <p className="empty-log">这段练习没有记录到你的决策节点。</p>}
              </div>

              <div className="opponent-review">
                <div className="section-label"><span>对手策略画像</span><small>策略点评时公开</small></div>
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

                <HandHistoryReplayTable entry={selectedHistory} replay={replayState} />

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

      {rulesOpen && <PokerRulesModal onClose={() => setRulesOpen(false)} />}

    </main>
  );
}

function InstallAppModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="info-modal install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭安装说明">×</button>
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
        <button className="modal-primary" type="button" onClick={onClose}>我知道怎么安装了</button>
      </section>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<PortalView>("landing");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [appInstalled, setAppInstalled] = useState(() => typeof window !== "undefined" && (
    window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  ));

  useEffect(() => {
    let removeServiceWorkerListener = () => undefined;
    if ("serviceWorker" in navigator) {
      const serviceWorker = navigator.serviceWorker;
      const hadController = Boolean(serviceWorker.controller);
      let refreshing = false;
      const reloadOnUpgrade = () => {
        if (!hadController || refreshing) return;
        refreshing = true;
        window.location.reload();
      };
      serviceWorker.addEventListener("controllerchange", reloadOnUpgrade);
      removeServiceWorkerListener = () => {
        serviceWorker.removeEventListener("controllerchange", reloadOnUpgrade);
      };
      void serviceWorker.register(`${APP_BASE_PATH}sw.js`, {
        scope: APP_BASE_PATH,
        updateViaCache: "none",
      }).then((registration) => registration.update()).catch(() => undefined);
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
      removeServiceWorkerListener();
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

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

  return (
    <>
      {view === "solo" ? (
        <SoloTrainer onExit={returnToLanding} />
      ) : (
        <LandingHome
          onEnterSolo={enterSolo}
          onInstallApp={() => void installApp()}
          onOpenRules={() => setRulesOpen(true)}
          appInstalled={appInstalled}
        />
      )}
      {view === "landing" && rulesOpen && (
        <PokerRulesModal onClose={() => setRulesOpen(false)} closeLabel="看懂了，回到主页" />
      )}
      {view === "landing" && installHelpOpen && (
        <InstallAppModal onClose={() => setInstallHelpOpen(false)} />
      )}
    </>
  );
}
