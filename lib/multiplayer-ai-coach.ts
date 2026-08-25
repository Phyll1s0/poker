import {
  analyzeBoardTexture,
  bestHand,
  blockerValue,
  drawPotential,
  estimateEquity,
  preflopHandFeatures,
  preflopPercentile,
  preflopStrength,
  type PokerCard,
} from "./poker-evaluator.ts";
import {
  evaluatePokerPolicy,
  pokerCallClosesContestableLayers,
  pokerContestablePotAtDecision,
  pokerDecisionStackContext,
  type PokerPolicyActionKind,
  type PokerPreflopPosition,
} from "./poker-policy.ts";
import { encodePreflopHandClass } from "./poker-preflop.ts";
import {
  createPublicOpponentRanges,
  type PublicBettingAction,
} from "./poker-range.ts";
import {
  formatPokerSizingRoute,
  type PokerSizingContext,
} from "./poker-sizing.ts";
import { ONLINE_MAX_PLAYERS } from "./online-poker.ts";

export type MultiplayerCoachCard = {
  rank: string | number;
  suit: string | number;
};

export type MultiplayerCoachPlayer = {
  accountId: string;
  seat: number;
  stack: number;
  committed: number;
  streetCommitted: number;
  status: "waiting" | "active" | "folded" | "all-in" | "out";
};

export type MultiplayerCoachAction = {
  seq: number;
  accountId: string;
  seat: number;
  street: "preflop" | "flop" | "turn" | "river";
  action: "fold" | "check" | "call" | "raise";
  amount?: number | null;
  toAmount?: number | null;
  raiseTo?: number | null;
  potAfter?: number | null;
  stackAfter?: number | null;
};

export type MultiplayerCoachLegalActions = {
  fold: boolean;
  check: boolean;
  callAmount: number | null;
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
  raiseAllInOnly: boolean;
};

export type MultiplayerAiCoachInput = {
  decisionId: string;
  heroAccountId: string;
  heroCards: readonly MultiplayerCoachCard[];
  board: readonly MultiplayerCoachCard[];
  street: "preflop" | "flop" | "turn" | "river";
  pot: number;
  currentBet: number;
  bigBlind: number;
  startingStack: number;
  dealerSeat: number;
  players: readonly MultiplayerCoachPlayer[];
  recentActions: readonly MultiplayerCoachAction[];
  legalActions: MultiplayerCoachLegalActions;
  iterations?: number;
};

export type MultiplayerAiFrequency = {
  action: PokerPolicyActionKind;
  label: string;
  frequency: number;
};

export type MultiplayerAiSizing = {
  target: number;
  frequency: number;
  label: string;
  allIn: boolean;
};

export type MultiplayerAiAnalysis = {
  decisionId: string;
  equity: number;
  potOdds: number;
  equityRealization: number;
  realizationThreshold: number;
  effectiveStackBb: number;
  startingDepthBb: number;
  spr: number;
  inPosition: boolean;
  position: PokerPreflopPosition;
  handLabel: string;
  drawLabel: string;
  boardLabel: string;
  recommendedAction: PokerPolicyActionKind;
  recommendedLabel: string;
  frequencies: MultiplayerAiFrequency[];
  sizing: MultiplayerAiSizing[];
  summary: string;
  factors: string[];
  sourceNote: string;
};

const ACTION_LABELS: Record<PokerPolicyActionKind, string> = {
  fold: "弃牌",
  check: "过牌",
  call: "跟注",
  raise: "下注 / 加注",
};

const POSITION_FACTORS: Record<PokerPreflopPosition, number> = {
  UTG: 0.72,
  HJ: 0.86,
  CO: 1.06,
  BTN: 1.28,
  SB: 0.9,
  BB: 1.35,
};

function integer(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback;
}

function cardRank(rank: string | number) {
  if (typeof rank === "number") return rank;
  const faces: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
  return faces[rank.toUpperCase()] ?? Number(rank);
}

function pokerCard(card: MultiplayerCoachCard): PokerCard {
  return { rank: cardRank(card.rank), suit: card.suit };
}

function clockwiseDistance(seat: number, after: number) {
  const distance = (seat - after + ONLINE_MAX_PLAYERS) % ONLINE_MAX_PLAYERS;
  return distance || ONLINE_MAX_PLAYERS;
}

function activeSeatOrder(players: readonly MultiplayerCoachPlayer[], dealerSeat: number) {
  return players
    .filter((player) => player.status === "active")
    .map((player) => player.seat)
    .sort((left, right) => clockwiseDistance(left, dealerSeat) - clockwiseDistance(right, dealerSeat));
}

/** Maps the actual occupied seats instead of assuming every six-max seat exists. */
export function multiplayerPreflopPosition(
  seat: number,
  dealerSeat: number,
  players: readonly MultiplayerCoachPlayer[],
): PokerPreflopPosition {
  const seats = players
    .filter((player) => player.status !== "out")
    .map((player) => player.seat);
  if (seats.length <= 2) return seat === dealerSeat ? "SB" : "BB";
  if (seat === dealerSeat) return "BTN";
  const order = seats
    .filter((candidate) => candidate !== dealerSeat)
    .sort((left, right) => clockwiseDistance(left, dealerSeat) - clockwiseDistance(right, dealerSeat));
  const index = order.indexOf(seat);
  if (index <= 0) return "SB";
  if (index === 1) return "BB";
  if (index === order.length - 1) return "CO";
  if (index === order.length - 2) return "HJ";
  // The shared policy currently has a six-max position vocabulary. Extra
  // full-ring early positions deliberately inherit the tighter UTG baseline
  // instead of being mislabelled as CO and receiving an unrealistically wide
  // range. A future full-ring solve pack can split UTG+1/UTG+2/LJ explicitly.
  return "UTG";
}

function heroActsLastPostflop(
  heroSeat: number,
  dealerSeat: number,
  players: readonly MultiplayerCoachPlayer[],
) {
  const order = activeSeatOrder(players, dealerSeat);
  return order.at(-1) === heroSeat;
}

function seededRandom(seed: string) {
  let state = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function publicActions(
  input: MultiplayerAiCoachInput,
  position: (seat: number) => PokerPreflopPosition,
): PublicBettingAction[] {
  const sorted = [...input.recentActions].sort((left, right) => left.seq - right.seq);
  const currentBets = new Map<number, number>();
  let activeStreet: MultiplayerCoachAction["street"] | null = null;
  let highestBet = 0;
  let latestAggressor: number | undefined;
  let raiseCount = 0;
  const actions: PublicBettingAction[] = [];
  const activeOpponents = Math.max(1, input.players.filter((player) => (
    player.status !== "folded" && player.status !== "out"
  )).length - 1);

  for (const event of sorted) {
    if (event.street !== activeStreet) {
      activeStreet = event.street;
      currentBets.clear();
      highestBet = 0;
      latestAggressor = undefined;
      raiseCount = 0;
      if (event.street === "preflop") {
        for (const player of input.players) {
          const seatPosition = position(player.seat);
          if (seatPosition === "SB") currentBets.set(player.seat, input.bigBlind / 2);
          if (seatPosition === "BB") currentBets.set(player.seat, input.bigBlind);
        }
        highestBet = input.bigBlind;
      }
    }
    const beforeBet = currentBets.get(event.seat) ?? 0;
    const toCall = Math.max(0, highestBet - beforeBet);
    const amount = integer(event.amount, event.action === "call" ? toCall : 0);
    const player = input.players.find((candidate) => candidate.seat === event.seat);
    const stackAfter = event.stackAfter == null ? player?.stack ?? 0 : integer(event.stackAfter);
    const potAfter = event.potAfter == null ? input.pot : integer(event.potAfter, input.pot);
    actions.push({
      playerId: event.seat,
      street: event.street,
      kind: event.action,
      amount,
      toCall,
      stackBefore: stackAfter + amount,
      startingDepthBefore: input.startingStack,
      aggressorIdBefore: latestAggressor,
      isAllIn: event.action !== "fold" && stackAfter === 0,
      potBefore: Math.max(0, potAfter - amount),
      raiseCountBefore: raiseCount,
      activeOpponents,
      aggressorPositionBefore: latestAggressor === undefined ? undefined : position(latestAggressor),
    });
    if (event.action === "raise") {
      const target = integer(event.raiseTo, integer(event.toAmount, beforeBet + amount));
      currentBets.set(event.seat, target);
      highestBet = Math.max(highestBet, target);
      latestAggressor = event.seat;
      raiseCount += 1;
    } else if (event.action === "call") {
      currentBets.set(event.seat, integer(event.toAmount, beforeBet + amount));
    }
  }
  return actions;
}

function normalizeFrequencies(
  raw: Record<PokerPolicyActionKind, number>,
  legal: MultiplayerCoachLegalActions,
  equity: number,
  potOdds: number,
  callEndsHand: boolean,
) {
  const allowed: Record<PokerPolicyActionKind, boolean> = {
    fold: legal.fold,
    check: legal.check,
    call: legal.callAmount !== null,
    raise: legal.minRaiseTo !== null && legal.maxRaiseTo !== null,
  };
  const frequencies: Record<PokerPolicyActionKind, number> = {
    fold: allowed.fold ? Math.max(0, raw.fold) : 0,
    check: allowed.check ? Math.max(0, raw.check) : 0,
    call: allowed.call ? Math.max(0, raw.call) : 0,
    raise: allowed.raise ? Math.max(0, raw.raise) : 0,
  };

  // Once calling closes the action there is no future realization penalty.
  // A clearly profitable price must never be displayed as a pure fold.
  if (callEndsHand && allowed.call && equity >= potOdds + 0.025) {
    const excessFold = Math.max(0, frequencies.fold - 0.04);
    frequencies.fold -= excessFold;
    frequencies.call += excessFold;
  }
  if (allowed.check && legal.callAmount === null) frequencies.fold = 0;
  let total = Object.values(frequencies).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    const fallback: PokerPolicyActionKind = allowed.check ? "check" : allowed.call ? "call" : allowed.fold ? "fold" : "raise";
    frequencies[fallback] = 1;
    total = 1;
  }
  (Object.keys(frequencies) as PokerPolicyActionKind[]).forEach((action) => {
    frequencies[action] /= total;
  });
  return frequencies;
}

function madeHandLabel(hole: readonly PokerCard[], board: readonly PokerCard[]) {
  if (board.length === 0) {
    const features = preflopHandFeatures(hole);
    if (!features) return "翻前两张牌";
    if (features.pair) return `${features.highRank} 对`;
    return `${features.suited ? "同花" : "非同花"} · 间隔 ${features.gap}`;
  }
  return bestHand([...hole, ...board]).name;
}

function drawDescription(draw: number, boardLength: number) {
  if (boardLength >= 5) return "河牌无后续听牌";
  if (draw >= 0.17) return "复合强听牌";
  if (draw >= 0.1) return "强同花听牌";
  if (draw >= 0.075) return "双头顺子听牌";
  if (draw >= 0.045) return "弱听牌 / 卡顺潜力";
  return "听牌潜力有限";
}

function boardDescription(board: readonly PokerCard[]) {
  if (!board.length) return "翻前节点";
  const texture = analyzeBoardTexture(board);
  const pairing = texture.pairedness >= 0.3 ? "对子面" : "非对子面";
  const dynamic = texture.wetness >= 0.62 ? "高动态" : texture.wetness >= 0.3 ? "中等动态" : "偏干燥";
  return `${pairing} · ${dynamic}`;
}

function frequencyRows(frequencies: Record<PokerPolicyActionKind, number>) {
  return (Object.entries(frequencies) as [PokerPolicyActionKind, number][])
    .filter(([, frequency]) => frequency > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([action, frequency]) => ({
      action,
      label: ACTION_LABELS[action],
      frequency,
    }));
}

export function analyzeMultiplayerDecision(input: MultiplayerAiCoachInput): MultiplayerAiAnalysis {
  if (input.heroCards.length !== 2) throw new RangeError("AI 辅助需要两张自己的手牌");
  const hero = input.players.find((player) => player.accountId === input.heroAccountId);
  if (!hero) throw new RangeError("AI 辅助找不到当前玩家");
  const hole = input.heroCards.map(pokerCard);
  const board = input.board.map(pokerCard);
  const opponents = input.players.filter((player) => (
    player.accountId !== input.heroAccountId
    && player.status !== "folded"
    && player.status !== "out"
  ));
  if (!opponents.length) throw new RangeError("当前没有仍持牌的对手");
  const positionForSeat = (seat: number) => multiplayerPreflopPosition(seat, input.dealerSeat, input.players);
  const heroPosition = positionForSeat(hero.seat);
  const actionEvidence = publicActions(input, positionForSeat);
  const rangeState = {
    players: input.players.map((player) => ({
      id: player.seat,
      folded: player.status === "folded" || player.status === "out",
    })),
    viewerId: hero.seat,
    community: board,
    actions: actionEvidence,
    bigBlind: input.bigBlind,
    positionFactor: (seat: number) => POSITION_FACTORS[positionForSeat(seat)],
    position: positionForSeat,
  };
  const ranges = createPublicOpponentRanges(rangeState).map((range) => range.weight);
  const equity = estimateEquity(hole, board, {
    opponents: opponents.length,
    iterations: input.iterations ?? (input.street === "preflop" ? 320 : 480),
    random: seededRandom(input.decisionId),
    opponentRanges: ranges,
  });
  const toCall = input.legalActions.callAmount ?? 0;
  const decisionPot = pokerContestablePotAtDecision(
    hero.seat,
    hero.committed,
    hero.stack,
    toCall,
    input.players.map((player) => ({
      id: player.seat,
      contributed: player.committed,
      folded: player.status === "folded" || player.status === "out",
    })),
  );
  const potOdds = decisionPot.callCost > 0
    ? decisionPot.callCost / Math.max(1, decisionPot.finalPot)
    : 0;
  const stackOpponents = opponents.map((player) => ({
    id: player.seat,
    stack: player.stack,
    bet: player.streetCommitted,
  }));
  const stackContext = pokerDecisionStackContext(hero.stack, hero.streetCommitted, stackOpponents);
  const heroStart = hero.stack + hero.committed;
  const deepestOpponentStart = Math.max(...opponents.map((player) => player.stack + player.committed));
  const startingDepthBb = Math.min(heroStart, deepestOpponentStart) / Math.max(1, input.bigBlind);
  const effectiveStackBb = stackContext.effectiveStack / Math.max(1, input.bigBlind);
  const callEndsHand = pokerCallClosesContestableLayers(
    hero.seat,
    hero.committed,
    hero.stack,
    toCall,
    input.players.map((player) => ({
      id: player.seat,
      contributed: player.committed,
      folded: player.status === "folded" || player.status === "out",
      stack: player.stack,
    })),
  );
  const draw = drawPotential(hole, board);
  const blockers = blockerValue(hole, board);
  const texture = analyzeBoardTexture(board);
  const handStrength = input.street === "preflop"
    ? preflopStrength(hole)
    : [0.1, 0.34, 0.53, 0.65, 0.76, 0.83, 0.91, 0.97, 1][bestHand([...hole, ...board]).category];
  const currentStreetActions = actionEvidence.filter((action) => action.street === input.street);
  const raises = currentStreetActions.filter((action) => action.kind === "raise");
  const firstRaiseIndex = currentStreetActions.findIndex((action) => action.kind === "raise");
  const preflopLimpers = input.street === "preflop"
    ? currentStreetActions.filter((action, index) => action.kind === "call" && (firstRaiseIndex < 0 || index < firstRaiseIndex)).length
    : 0;
  const preflopColdCallers = input.street === "preflop" && firstRaiseIndex >= 0
    ? currentStreetActions.slice(firstRaiseIndex + 1).filter((action) => action.kind === "call").length
    : 0;
  const lastRaise = raises.at(-1);
  const inPosition = heroActsLastPostflop(hero.seat, input.dealerSeat, input.players);
  const heroPreflopHand = preflopHandFeatures(hole);
  const minimumRaiseIncrement = input.legalActions.minRaiseTo === null
    ? input.bigBlind
    : Math.max(input.bigBlind, input.legalActions.minRaiseTo - input.currentBet);
  const maxContestableTarget = hero.streetCommitted + stackContext.effectiveStack;
  const plan = evaluatePokerPolicy({
    profile: { aggression: 0.7, looseness: 0.27, bluff: 0.12 },
    street: input.street,
    equity,
    handStrength,
    draw,
    blockers,
    pot: decisionPot.currentPot,
    toCall: decisionPot.callCost,
    potOdds,
    inPosition,
    activeOpponents: opponents.length,
    opponentsCanRespond: opponents.some((player) => player.stack > 0),
    callEndsHand,
    effectiveStackBb,
    startingDepthBb,
    highestBet: input.currentBet,
    playerBet: hero.streetCommitted,
    playerStack: hero.stack,
    maxContestableTarget,
    minRaise: minimumRaiseIncrement,
    raiseLocked: input.legalActions.minRaiseTo === null || input.legalActions.maxRaiseTo === null,
    squidPressure: 0,
    bigBlind: input.bigBlind,
    preflopPercentile: preflopPercentile(hole),
    preflopPositionFactor: POSITION_FACTORS[heroPosition],
    preflopRaiseCount: input.street === "preflop" ? raises.length : 0,
    preflopPosition: heroPosition,
    preflopOpenerPosition: lastRaise ? positionForSeat(lastRaise.playerId) : undefined,
    preflopLimpers,
    preflopColdCallers,
    preflopPreviouslyRaised: raises.some((action) => action.playerId === hero.seat),
    preflopPreviouslyLimped: input.street === "preflop" && currentStreetActions.some((action, index) => (
      action.playerId === hero.seat
        && action.kind === "call"
        && (firstRaiseIndex < 0 || index < firstRaiseIndex)
    )),
    preflopHand: heroPreflopHand,
    boardWetness: texture.wetness,
    boardPairing: texture.pairedness,
    boardHighCard: texture.highCard,
    initiative: lastRaise?.playerId === hero.seat,
    streetRaiseCount: raises.length,
  });
  const frequencies = normalizeFrequencies(
    { ...plan.actionFrequencies },
    input.legalActions,
    equity,
    potOdds,
    callEndsHand,
  );
  const rows = frequencyRows(frequencies);
  const recommendedAction = rows[0]?.action ?? "fold";
  const sizingContext: PokerSizingContext = {
    street: input.street,
    pot: decisionPot.currentPot,
    toCall: decisionPot.callCost,
    highestBet: input.currentBet,
    playerBet: hero.streetCommitted,
    playerStack: hero.stack,
    maxContestableTarget,
    minRaise: minimumRaiseIncrement,
    bigBlind: input.bigBlind,
    preflopRaiseCount: input.street === "preflop" ? raises.length : 0,
  };
  const sizingByTarget = new Map<number, MultiplayerAiSizing>();
  if (frequencies.raise >= 0.005 && input.legalActions.minRaiseTo !== null && input.legalActions.maxRaiseTo !== null) {
    for (const route of plan.sizingRoutes) {
      const target = Math.max(
        input.legalActions.minRaiseTo,
        Math.min(input.legalActions.maxRaiseTo, Math.round(route.target)),
      );
      const existing = sizingByTarget.get(target);
      if (existing) existing.frequency += route.frequency;
      else sizingByTarget.set(target, {
        target,
        frequency: route.frequency,
        label: formatPokerSizingRoute(sizingContext, { ...route, target }),
        allIn: target === input.legalActions.maxRaiseTo && target === hero.streetCommitted + hero.stack,
      });
    }
  }
  const sizing = [...sizingByTarget.values()].sort((left, right) => right.frequency - left.frequency);
  const sizingTotal = sizing.reduce((sum, route) => sum + route.frequency, 0);
  sizing.forEach((route) => { route.frequency /= Math.max(1e-9, sizingTotal); });
  const equityPercent = Math.round(equity * 100);
  const pricePercent = Math.round(potOdds * 100);
  const preflopHandClass = heroPreflopHand
    ? encodePreflopHandClass(heroPreflopHand.highRank, heroPreflopHand.lowRank, heroPreflopHand.suited)
    : null;
  const summary = input.street === "preflop"
    ? `${preflopHandClass ?? "翻前手牌"} · ${heroPosition} 翻前节点：结合起始有效筹码、公开加注线和行动尺度，当前主路线为${ACTION_LABELS[recommendedAction]}。`
    : decisionPot.callCost > 0
      ? `对公开行动加权范围的估算胜率约 ${equityPercent}%，直接底池赔率为 ${pricePercent}%；当前主路线为${ACTION_LABELS[recommendedAction]}。`
      : `当前没有直接跟注价格；结合范围胜率、牌面纹理和 SPR，主路线为${ACTION_LABELS[recommendedAction]}。`;
  const factors = [
    `${opponents.length + 1} 人有效底池 · ${inPosition ? "有位置" : "无位置"}`,
    `起始有效 ${startingDepthBb.toFixed(1)} BB · 当前 SPR ${plan.spr.toFixed(1)}`,
    decisionPot.callCost > 0
      ? `${callEndsHand ? "跟注后无后续决策" : `权益实现参考 ${Math.round(plan.equityRealization * 100)}%`}`
      : `${madeHandLabel(hole, board)} · ${drawDescription(draw, board.length)}`,
  ];
  return {
    decisionId: input.decisionId,
    equity,
    potOdds,
    equityRealization: plan.equityRealization,
    realizationThreshold: plan.realizationThreshold,
    effectiveStackBb,
    startingDepthBb,
    spr: plan.spr,
    inPosition,
    position: heroPosition,
    handLabel: madeHandLabel(hole, board),
    drawLabel: drawDescription(draw, board.length),
    boardLabel: boardDescription(board),
    recommendedAction,
    recommendedLabel: recommendedAction === "raise" && sizing[0]
      ? sizing[0].label
      : ACTION_LABELS[recommendedAction],
    frequencies: rows,
    sizing,
    summary,
    factors,
    sourceNote: "RangeCraft 公开信息近似模型 · 权益按对手公开行动加权范围抽样；不是完整 solver 解，也不读取任何对手暗牌。",
  };
}
