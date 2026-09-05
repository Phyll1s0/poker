import {
  bestHand,
  blockerValue,
  drawPotential,
  preflopPercentile,
  type OpponentRangeWeight,
  type PokerCard,
} from "./poker-evaluator.ts";
import {
  encodePreflopHandClass,
  getPreflopStrategy,
  type PreflopPosition,
  type PreflopResponseRole,
  type PreflopScenario,
} from "./poker-preflop.ts";

export type PublicActionStreet = "preflop" | "flop" | "turn" | "river";
export type PublicActionKind = "fold" | "check" | "call" | "raise";

/** Public table information only. No player's real hole cards belong here. */
export type PublicBettingAction = {
  playerId: number;
  street: PublicActionStreet;
  kind: PublicActionKind;
  amount: number;
  toCall: number;
  /** Chips this player already had in front before this public action. */
  playerBetBefore?: number;
  stackBefore: number;
  /** Remaining chips this player could still contest against the relevant opponent. */
  effectiveStackBefore?: number;
  /** Effective stack at the start of this hand against the relevant opponent. */
  startingDepthBefore?: number;
  /** Public id of the latest aggressor faced at this decision, when one exists. */
  aggressorIdBefore?: number;
  isAllIn: boolean;
  potBefore: number;
  raiseCountBefore: number;
  activeOpponents: number;
  /** Latest preflop raiser this action was facing; derived from public history. */
  aggressorPositionBefore?: PreflopPosition;
  /** Public path into a squeeze response; never depends on hidden cards. */
  responseRoleBefore?: PreflopResponseRole;
};

export type OpponentRangeEvidence = {
  actions: readonly PublicBettingAction[];
  positionFactor: number;
  bigBlind: number;
  position?: PreflopPosition;
  openerPosition?: PreflopPosition;
  tendency?: PublicRangeTendency;
};

export type PublicRangeTendency = {
  preflopOpen: number;
  preflopReraise: number;
  postflopBet: number;
  postflopRaise: number;
  /** Public show/muck and revealed-action evidence; never private cards. */
  publicDeception: number;
};

export type PublicRangePlayer = {
  id: number;
  folded: boolean;
};

export type PublicRangeState = {
  players: readonly PublicRangePlayer[];
  viewerId: number;
  community: readonly PokerCard[];
  actions: readonly PublicBettingAction[];
  bigBlind: number;
  positionFactor: (playerId: number) => number;
  position?: (playerId: number) => PreflopPosition;
  /** Historical public-action reads only; never real hole-card information. */
  tendency?: (playerId: number) => PublicRangeTendency | undefined;
};

const BOARD_CARDS: Record<PublicActionStreet, number> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function sameSuit(left: PokerCard, right: PokerCard) {
  return typeof left.suit === typeof right.suit && left.suit === right.suit;
}

function preflopBluffShape(hole: readonly [PokerCard, PokerCard]) {
  const [high, low] = [...hole].sort((left, right) => right.rank - left.rank);
  const suited = sameSuit(high, low) ? 1 : 0;
  const gap = high.rank - low.rank;
  const connectivity = gap === 1 ? 1 : gap === 2 ? 0.65 : gap === 3 ? 0.25 : 0;
  const aceBlocker = high.rank === 14 ? 1 : 0;
  const broadway = (high.rank >= 11 ? 0.5 : 0) + (low.rank >= 10 ? 0.5 : 0);
  const pairPenalty = high.rank === low.rank ? 0.35 : 1;
  return clamp((suited * 0.34 + connectivity * 0.28 + aceBlocker * 0.25 + broadway * 0.13) * pairPenalty);
}

function madeHandStrength(hole: readonly [PokerCard, PokerCard], board: readonly PokerCard[]) {
  const result = bestHand([...hole, ...board]);
  const categoryBase = [0.08, 0.3, 0.51, 0.63, 0.75, 0.82, 0.91, 0.97, 1][result.category];
  if (result.category === 0) {
    return clamp(categoryBase + Math.max(...hole.map((card) => card.rank)) / 14 * 0.11);
  }
  if (result.category === 1) {
    const boardHigh = Math.max(...board.map((card) => card.rank));
    const topPair = hole.some((card) => card.rank === boardHigh);
    const overPair = hole[0].rank === hole[1].rank && hole[0].rank > boardHigh;
    const kicker = Math.max(...hole.map((card) => card.rank)) / 14;
    return clamp(categoryBase + (overPair ? 0.16 : topPair ? 0.1 : 0.025) + kicker * 0.035);
  }
  return clamp(categoryBase + Math.max(...hole.map((card) => card.rank)) / 14 * 0.025);
}

function preflopActionLikelihood(
  hole: readonly [PokerCard, PokerCard],
  action: PublicBettingAction,
  evidence: OpponentRangeEvidence,
) {
  const { positionFactor, bigBlind } = evidence;
  const percentile = preflopPercentile(hole);
  const callCost = action.kind === "call" ? Math.min(action.toCall, action.amount) : action.toCall;
  const pressure = callCost / Math.max(1, action.potBefore + callCost);
  const wager = Math.max(0, action.amount - action.toCall);
  const raiseFraction = wager / Math.max(bigBlind, action.potBefore + action.toCall);
  const premium = sigmoid((percentile - 0.91) * 34);
  const historicalPressure = action.kind === "raise"
    ? action.raiseCountBefore === 0
      ? clamp(evidence.tendency?.preflopOpen ?? 0)
      : clamp(evidence.tendency?.preflopReraise ?? 0)
    : 0;

  if (action.kind === "check") {
    return clamp(0.78 - percentile * 0.42 + premium * 0.16, 0.08, 1.15);
  }
  if (action.kind === "call" && action.raiseCountBefore === 0) {
    // A limp is not a generic weak call. Weight the public range toward cheap-
    // realization hands while retaining premium traps, so a later limp-reraise
    // remains credible instead of magically creating strength from a range
    // that previously excluded it.
    const [high, low] = [...hole].sort((left, right) => right.rank - left.rank);
    const pair = high.rank === low.rank;
    const suited = sameSuit(high, low);
    const gap = high.rank - low.rank;
    const smallPair = pair && high.rank <= 9 ? 1 : 0;
    const suitedConnector = suited && gap <= 2 && high.rank <= 12 ? (gap === 1 ? 1 : 0.72) : 0;
    const suitedAce = suited && high.rank === 14 && low.rank <= 10 ? 0.9 : 0;
    const suitedBroadway = suited && high.rank >= 11 && low.rank >= 10 ? 0.62 : 0;
    const speculative = Math.max(smallPair, suitedConnector, suitedAce, suitedBroadway);
    const premiumTrap = premium * (
      pair && high.rank >= 12
        ? 1
        : high.rank === 14 && low.rank >= 12
          ? suited ? 0.9 : 0.55
          : 0.18
    );
    const lateOrBlind = evidence.position === "BTN" || evidence.position === "SB" ? 1 : 0;
    const wideLateMix = lateOrBlind * (1 - premium) * clamp(
      (suited ? 0.22 : 0) + preflopBluffShape(hole) * 0.18,
    );
    return clamp(
      0.012 + speculative * 0.72 + premiumTrap * 0.4 + wideLateMix,
      0.012,
      1.25,
    );
  }
  const chartScenario: PreflopScenario | null = action.raiseCountBefore === 0
    ? action.kind === "raise" ? "rfi" : null
    : action.raiseCountBefore === 1
      ? "vs-open"
      : action.raiseCountBefore === 2
        ? "vs-three-bet"
        : "vs-four-bet";
  if (chartScenario && evidence.position) {
    const sorted = [...hole].sort((left, right) => right.rank - left.rank);
    const hand = encodePreflopHandClass(sorted[0].rank, sorted[1].rank, sameSuit(sorted[0], sorted[1]));
    // Reconstruct the actual raise-to price. Fixed 2.5BB/9BB assumptions made
    // an identical 9BB squeeze look different after a 2x open, a 3x open or
    // a cold entry, which then selected the wrong response chart.
    const legacyInvestment = action.raiseCountBefore === 1
      ? evidence.position === "BB" ? 1 : evidence.position === "SB" ? 0.5 : 0
      : action.raiseCountBefore === 2 ? 2.5 : action.raiseCountBefore >= 3 ? 9 : 0;
    const committedBefore = Math.max(0, action.playerBetBefore ?? legacyInvestment * bigBlind);
    const observedTargetBb = action.kind === "raise"
      ? (committedBefore + action.amount) / Math.max(1, bigBlind)
      : (committedBefore + action.toCall) / Math.max(1, bigBlind);
    const strategy = getPreflopStrategy({
      hand,
      scenario: chartScenario,
      heroPosition: evidence.position,
      aggressorPosition: action.aggressorPositionBefore ?? evidence.openerPosition,
      responseRole: chartScenario === "vs-three-bet" ? action.responseRoleBefore : undefined,
      effectiveStackBb: (
        action.startingDepthBefore
        ?? action.effectiveStackBefore
        ?? action.stackBefore
      ) / Math.max(1, bigBlind),
      facingSizeBb: chartScenario === "rfi" ? undefined : observedTargetBb,
    });
    let chartFrequency = action.kind === "raise"
      ? strategy.frequencies.raise
      : strategy.frequencies.call;
    if (action.kind === "raise" && historicalPressure > 0) {
      // A player who repeatedly attacks this exact node is assigned a wider
      // public range. Fringe suited/blocker hands gain likelihood, while value
      // hands already present in the chart remain the strongest candidates.
      const expansionCenter = action.raiseCountBefore === 0 ? 0.54 : 0.72;
      const fringe = clamp(
        sigmoid((percentile - expansionCenter) * 12) * 0.58
          + preflopBluffShape(hole) * 0.42,
      );
      chartFrequency = clamp(
        chartFrequency + historicalPressure * fringe * (1 - chartFrequency) * 0.62,
      );
    }
    const sizePolarization = action.kind === "raise"
      ? 1 + Math.max(0, raiseFraction - 0.65) * premium * 0.22
      : 1;
    return clamp(0.004 + chartFrequency * 1.18 * sizePolarization, 0.004, 1.65);
  }
  if (action.kind === "call") {
    const continuingRange = clamp(
      0.25 * positionFactor
        * Math.pow(0.68, action.raiseCountBefore)
        * (1 - pressure * 0.52),
      0.045,
      0.48,
    );
    const enters = sigmoid((percentile - (1 - continuingRange)) * 28);
    const shortStackFreedom = action.isAllIn && action.amount < action.toCall ? 0.05 : 0;
    return clamp(0.018 + enters * (0.92 - premium * 0.3) + premium * 0.2 + shortStackFreedom, 0.018, 1.08);
  }
  if (action.kind === "raise") {
    const openingRange = action.raiseCountBefore === 0
      ? clamp(0.23 * positionFactor, 0.11, 0.43)
      : clamp(0.085 * positionFactor * Math.pow(0.58, action.raiseCountBefore - 1), 0.025, 0.16);
    const sizeTightening = clamp(1 - Math.max(0, raiseFraction - 0.65) * 0.18, 0.55, 1);
    const valueRange = openingRange * sizeTightening;
    const value = sigmoid((percentile - (1 - valueRange)) * (action.raiseCountBefore > 0 ? 34 : 27));
    const bluff = preflopBluffShape(hole)
      * (action.raiseCountBefore > 0 ? 0.12 : 0.18)
      * clamp(1.15 - raiseFraction * 0.18, 0.42, 1);
    const historicalExpansion = historicalPressure
      * clamp(sigmoid((percentile - (action.raiseCountBefore > 0 ? 0.7 : 0.52)) * 12) * 0.55
        + preflopBluffShape(hole) * 0.45)
      * 0.42;
    return clamp(0.006 + value * (0.92 + raiseFraction * 0.16) + bluff + historicalExpansion, 0.006, 1.65);
  }
  return 0.001;
}

function postflopActionLikelihood(
  hole: readonly [PokerCard, PokerCard],
  board: readonly PokerCard[],
  action: PublicBettingAction,
  tendency?: PublicRangeTendency,
) {
  const made = madeHandStrength(hole, board);
  const draw = clamp(drawPotential(hole, board) / 0.18);
  const blockers = clamp(blockerValue(hole, board) / 0.15);
  const wager = Math.max(0, action.amount - action.toCall);
  const betFraction = wager / Math.max(1, action.potBefore + action.toCall);
  const multiway = Math.max(0, action.activeOpponents - 1);

  if (action.kind === "check") {
    const trap = sigmoid((made - 0.72) * 18) * 0.2;
    return clamp(0.14 + (1 - made) * 0.68 + draw * 0.08 + trap, 0.07, 1.05);
  }
  if (action.kind === "call") {
    const callCost = Math.min(action.toCall, action.amount);
    const potOdds = callCost / Math.max(1, action.potBefore + callCost);
    const continueThreshold = clamp(0.31 + potOdds * 0.72 + multiway * 0.022, 0.34, 0.72);
    const continues = sigmoid((made + draw * 0.17 - continueThreshold) * 15);
    const slowPlay = sigmoid((made - 0.78) * 20) * 0.23;
    return clamp(0.035 + continues * 0.72 + draw * 0.38 + slowPlay, 0.025, 1.35);
  }
  if (action.kind === "raise") {
    const facingBet = action.toCall > 0 ? 0.045 : 0;
    const valueThreshold = 0.43 + facingBet + Math.min(0.14, betFraction * 0.13) + Math.min(0.07, multiway * 0.022);
    const value = sigmoid((made - valueThreshold) * 16);
    const semiBluff = draw * clamp(0.34 - betFraction * 0.07, 0.13, 0.34);
    const blockerBluff = blockers * clamp(0.11 - betFraction * 0.025, 0.035, 0.11);
    const nodePressure = clamp(action.toCall > 0 ? tendency?.postflopRaise ?? 0 : tendency?.postflopBet ?? 0);
    const publicDeception = clamp(tendency?.publicDeception ?? 0);
    const airShape = (1 - made)
      * clamp(0.08 + blockers * 0.34 + draw * (action.street === "river" ? 0 : 0.22))
      * clamp(1.08 - Math.max(0, betFraction - 1) * 0.22, 0.62, 1.08);
    const historicalBluff = airShape * (nodePressure * 0.5 + publicDeception * 0.58);
    return clamp(
      0.008 + value * (0.9 + betFraction * 0.25) + semiBluff + blockerBluff + historicalBluff,
      0.008,
      1.75,
    );
  }
  return 0.001;
}

/**
 * Likelihood of a candidate holding after the opponent's public action line.
 * The result is relative, not a probability; the equity sampler normalizes it.
 */
export function opponentHoldingWeight(
  hole: readonly [PokerCard, PokerCard],
  community: readonly PokerCard[],
  evidence: OpponentRangeEvidence,
) {
  let logWeight = 0;
  for (const action of evidence.actions) {
    const board = community.slice(0, BOARD_CARDS[action.street]);
    const likelihood = action.street === "preflop"
      ? preflopActionLikelihood(hole, action, evidence)
      : board.length >= 3
        ? postflopActionLikelihood(hole, board, action, evidence.tendency)
        : 1;
    logWeight += Math.log(Math.max(0.001, likelihood));
  }
  return Math.exp(clamp(logWeight, -12, 6));
}

export function createOpponentRangeWeight(
  community: readonly PokerCard[],
  evidence: OpponentRangeEvidence,
): OpponentRangeWeight {
  return (hole) => opponentHoldingWeight(hole, community, evidence);
}

/** Builds opponent samplers from public descriptors without touching hidden cards. */
export function createPublicOpponentRanges(state: PublicRangeState) {
  const openingRaise = state.actions.find((action) => (
    action.street === "preflop" && action.kind === "raise" && action.raiseCountBefore === 0
  ));
  let latestPreflopRaiserId: number | null = null;
  let firstPreflopRaiserId: number | null = null;
  const preflopColdCallers = new Set<number>();
  const actionsWithAggressor = state.actions.map((action) => {
    if (action.street !== "preflop") return action;
    const responseRoleBefore: PreflopResponseRole | undefined = action.raiseCountBefore === 2
      ? firstPreflopRaiserId === action.playerId
        ? "opener"
        : preflopColdCallers.has(action.playerId)
          ? "cold-caller"
          : "cold-entry"
      : undefined;
    const enriched = {
      ...action,
      ...(latestPreflopRaiserId === null || !state.position
        ? {}
        : { aggressorPositionBefore: state.position(latestPreflopRaiserId) }),
      ...(responseRoleBefore ? { responseRoleBefore } : {}),
    };
    if (action.kind === "raise") {
      if (firstPreflopRaiserId === null) firstPreflopRaiserId = action.playerId;
      latestPreflopRaiserId = action.playerId;
    } else if (action.kind === "call" && action.raiseCountBefore === 1) {
      preflopColdCallers.add(action.playerId);
    }
    return enriched;
  });
  return state.players
    .filter((player) => !player.folded && player.id !== state.viewerId)
    .map((player) => ({
      playerId: player.id,
      weight: createOpponentRangeWeight(state.community, {
        actions: actionsWithAggressor.filter((action) => action.playerId === player.id),
        positionFactor: state.positionFactor(player.id),
        bigBlind: state.bigBlind,
        position: state.position?.(player.id),
        openerPosition: openingRaise ? state.position?.(openingRaise.playerId) : undefined,
        tendency: state.tendency?.(player.id),
      }),
    }));
}
