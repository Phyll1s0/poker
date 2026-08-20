import { buildPokerSizingRoutes, type PokerSizingRoute } from "./poker-sizing.ts";

export type PokerPolicyActionKind = "fold" | "check" | "call" | "raise";
export type PokerPolicyStreet = "preflop" | "flop" | "turn" | "river";

export type PokerPolicyProfile = {
  aggression: number;
  looseness: number;
  bluff: number;
};

export type PokerPreflopPosition = "UTG" | "HJ" | "CO" | "BTN" | "SB" | "BB";

export type PokerPreflopHand = {
  highRank: number;
  lowRank: number;
  pair: boolean;
  suited: boolean;
  gap: number;
};

export type PokerPolicyActionFrequencies = Record<PokerPolicyActionKind, number>;

export type PokerPreflopScenario = "open" | "isolate" | "check-option" | "vs-open" | "vs-three-bet" | "vs-four-bet";

/**
 * Everything the policy needs after cards and public state have been reduced to
 * numeric features. `activeOpponents` is the number of non-folded opponents,
 * excluding the acting player. Supplying `bigBlind` makes SPR exact; the
 * fallback is retained so older/headless callers can migrate incrementally.
 */
export type PokerPolicyInput = {
  profile: PokerPolicyProfile;
  street: PokerPolicyStreet;
  equity: number;
  handStrength: number;
  draw: number;
  blockers: number;
  pot: number;
  toCall: number;
  potOdds: number;
  inPosition: boolean;
  activeOpponents: number;
  /** Whether at least one live opponent still has chips to respond to a raise. */
  opponentsCanRespond?: boolean;
  /** Whether calling leaves this player with no later decision (closed action or all-in). */
  callEndsHand?: boolean;
  effectiveStackBb: number;
  startingDepthBb: number;
  highestBet: number;
  playerBet: number;
  playerStack: number;
  minRaise: number;
  raiseLocked: boolean;
  squidPressure: number;
  bigBlind?: number;
  preflopPercentile?: number;
  preflopPositionFactor?: number;
  preflopRaiseCount?: number;
  preflopPosition?: PokerPreflopPosition;
  preflopOpenerPosition?: PokerPreflopPosition;
  preflopLimpers?: number;
  preflopColdCallers?: number;
  preflopPreviouslyRaised?: boolean;
  preflopHand?: PokerPreflopHand | null;
  /** Continuous public-board features; ignored before the flop. */
  boardWetness?: number;
  boardPairing?: number;
  boardHighCard?: number;
  /** Whether the player owns the most recent aggressive action in the public line. */
  initiative?: boolean;
  /** Raises already made on the current street. */
  streetRaiseCount?: number;
};

export type PokerPolicyAction = {
  kind: PokerPolicyActionKind;
  raiseTo?: number;
};

/** Deterministic policy values exposed for simulations, tuning and regression tests. */
export type PokerPolicyPlan = {
  strategyStrength: number;
  valueThreshold: number;
  strong: boolean;
  bluffCandidate: boolean;
  bluffFrequency: number;
  multiwayBluffFactor: number;
  probeFrequency: number;
  raiseFrequencyWhenStrong: number;
  raiseFrequencyWhenBluffing: number;
  intendedBetFraction: number;
  /** The actual extra chips above the current high bet, divided by the current pot. */
  betFraction: number;
  balancedBluffRate: number;
  raiseTo: number;
  maxTarget: number;
  spr: number;
  pressure: number;
  shortStackJamFrequency: number;
  continueEdge: number;
  preflopTargetRange: number;
  preflopEnterFrequency: number;
  preflopOpenRaiseFrequency: number;
  preflopThreeBetFrequency: number;
  preflopRaiseFrequency: number;
  preflopScenario: PokerPreflopScenario;
  preflopPosition: PokerPreflopPosition;
  rangeAdvantage: number;
  nutAdvantage: number;
  realizationThreshold: number;
  /** Conditional size mix after the raise/bet branch has been selected. */
  sizingIntents: Array<{ fraction?: number; target?: number; frequency: number }>;
  /** Legalized and merged conditional size routes consumed by both UI and AI. */
  sizingRoutes: PokerSizingRoute[];
  actionFrequencies: PokerPolicyActionFrequencies;
};

export type PokerPolicyRng = () => number;

// Seat offsets from the dealer in a six-max game:
// BTN, SB, BB, UTG, HJ, CO. Blinds defend wider, while early position opens
// tighter. Keeping this here prevents the UI and the headless arena drifting.
const SIX_MAX_PREFLOP_POSITIONS = ["BTN", "SB", "BB", "UTG", "HJ", "CO"] as const;
const SIX_MAX_PREFLOP_POSITION_FACTORS = [1.28, 0.9, 1.35, 0.72, 0.86, 1.06] as const;

export function sixMaxPreflopPosition(playerId: number, dealerId: number): PokerPreflopPosition {
  const offset = ((playerId - dealerId) % 6 + 6) % 6;
  return SIX_MAX_PREFLOP_POSITIONS[offset];
}

export function sixMaxPreflopPositionFactor(playerId: number, dealerId: number) {
  const offset = ((playerId - dealerId) % 6 + 6) % 6;
  return SIX_MAX_PREFLOP_POSITION_FACTORS[offset];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function nonNegative(value: number) {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

/**
 * Chips that can still be contested from the acting player's point of view.
 * An opponent's outstanding bet is part of the effective stack even when that
 * bet left them with zero chips behind (the common all-in decision case).
 */
export function pokerEffectiveStackAtDecision(
  playerStack: number,
  playerBet: number,
  opponents: readonly { stack: number; bet: number }[],
) {
  const available = nonNegative(playerStack);
  const alreadyMatched = nonNegative(playerBet);
  const deepestOpponentReach = Math.max(0, ...opponents.map((opponent) => (
    nonNegative(opponent.stack) + Math.max(0, nonNegative(opponent.bet) - alreadyMatched)
  )));
  return Math.min(available, deepestOpponentReach);
}

export type PokerDecisionPotLayer = {
  amount: number;
  opponentIds: number[];
};

export type PokerDecisionPot = {
  callCost: number;
  currentPot: number;
  finalPot: number;
  layers: PokerDecisionPotLayer[];
};

/**
 * Returns only the chips the acting player can win after calling. Contributions
 * above that player's post-call total belong to an unmatched wager or a higher
 * side pot and therefore must not improve their displayed price.
 */
export function pokerContestablePotAtDecision(
  playerId: number,
  playerContribution: number,
  playerStack: number,
  toCall: number,
  players: readonly { id: number; contributed: number; folded: boolean }[],
): PokerDecisionPot {
  const callCost = Math.min(nonNegative(toCall), nonNegative(playerStack));
  const finalContribution = nonNegative(playerContribution) + callCost;
  const contributions = players.map((player) => ({
    ...player,
    contributed: player.id === playerId
      ? finalContribution
      : nonNegative(player.contributed),
  }));
  const levels = [...new Set(
    contributions
      .map((player) => Math.min(player.contributed, finalContribution))
      .filter((level) => level > 0),
  )].sort((left, right) => left - right);
  const layers: PokerDecisionPotLayer[] = [];
  let previousLevel = 0;
  for (const level of levels) {
    const contributors = contributions.filter((player) => player.contributed >= level);
    const amount = (level - previousLevel) * contributors.length;
    previousLevel = level;
    if (amount <= 0) continue;
    layers.push({
      amount,
      opponentIds: contributors
        .filter((player) => player.id !== playerId && !player.folded)
        .map((player) => player.id),
    });
  }
  const finalPot = layers.reduce((sum, layer) => sum + layer.amount, 0);
  return {
    callCost,
    currentPot: Math.max(0, finalPot - callCost),
    finalPot,
    layers,
  };
}

/**
 * An all-in call can use terminal chip EV only when every funded live opponent
 * has already contributed through the caller's final eligible level. A player
 * still below that level may later call or fold, changing both the pot layer
 * and the opponent range, so that decision is not terminal yet.
 */
export function pokerCallClosesContestableLayers(
  playerId: number,
  playerContribution: number,
  playerStack: number,
  toCall: number,
  players: readonly { id: number; contributed: number; folded: boolean; stack: number }[],
) {
  const available = nonNegative(playerStack);
  const callCost = Math.min(nonNegative(toCall), available);
  if (available <= 0 || callCost < available) return false;
  const finalContribution = nonNegative(playerContribution) + callCost;
  return players.every((player) => (
    player.id === playerId
    || player.folded
    || nonNegative(player.stack) <= 0
    || nonNegative(player.contributed) >= finalContribution
  ));
}

function decisionPressure(toCall: number, playerStack: number, effectiveStackChips: number) {
  const available = nonNegative(playerStack);
  const callCost = Math.min(nonNegative(toCall), available);
  const contestableStack = Math.max(
    callCost,
    Math.min(available, nonNegative(effectiveStackChips)),
  );
  return callCost / Math.max(1, contestableStack);
}

function unitRandom(random: PokerPolicyRng) {
  return clamp(random(), 0, 1 - Number.EPSILON);
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function softmax(values: readonly number[], temperature = 1) {
  if (!values.length) return [];
  const safeTemperature = Math.max(0.08, temperature);
  const maximum = Math.max(...values);
  const weights = values.map((value) => Math.exp((value - maximum) / safeTemperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / Math.max(Number.EPSILON, total));
}

function softmaxLegalActions(
  logits: Partial<PokerPolicyActionFrequencies>,
  input: {
    toCall: number;
    raiseLocked: boolean;
    highestBet: number;
    playerBet: number;
    playerStack: number;
    opponentsCanRespond?: boolean;
  },
  temperature = 1,
) {
  const canRaise = input.opponentsCanRespond !== false
    && !input.raiseLocked
    && input.playerBet + input.playerStack > input.highestBet;
  const legal: PokerPolicyActionKind[] = input.toCall > 0
    ? canRaise ? ["fold", "call", "raise"] : ["fold", "call"]
    : canRaise ? ["check", "raise"] : ["check"];
  const probabilities = softmax(legal.map((kind) => logits[kind] ?? -20), temperature);
  const frequencies: PokerPolicyActionFrequencies = { fold: 0, check: 0, call: 0, raise: 0 };
  legal.forEach((kind, index) => { frequencies[kind] = probabilities[index]; });
  return frequencies;
}

const POSITION_OPEN_RANGES: Record<PokerPreflopPosition, number> = {
  UTG: 0.18,
  HJ: 0.22,
  CO: 0.3,
  BTN: 0.45,
  SB: 0.42,
  BB: 0.3,
};

const POSITION_DEFEND_VS_OPEN: Record<PokerPreflopPosition, number> = {
  UTG: 0.12,
  HJ: 0.16,
  CO: 0.2,
  BTN: 0.27,
  SB: 0.2,
  BB: 0.43,
};

function positionFromFactor(factor: number): PokerPreflopPosition {
  let bestIndex = 0;
  for (let index = 1; index < SIX_MAX_PREFLOP_POSITION_FACTORS.length; index += 1) {
    if (Math.abs(factor - SIX_MAX_PREFLOP_POSITION_FACTORS[index]) < Math.abs(factor - SIX_MAX_PREFLOP_POSITION_FACTORS[bestIndex])) {
      bestIndex = index;
    }
  }
  return SIX_MAX_PREFLOP_POSITIONS[bestIndex];
}

function rangeFrequency(percentile: number, targetRange: number, steepness = 26) {
  return clamp(sigmoid((percentile - (1 - targetRange)) * steepness), 0.002, 0.998);
}

function preflopBluffShape(input: {
  blockers: number;
  preflopHand: PokerPreflopHand | null;
}) {
  const hand = input.preflopHand;
  if (!hand) return clamp(input.blockers / 0.15, 0, 1);
  if (hand.pair) return clamp((hand.highRank - 2) / 12 * 0.24, 0, 0.24);
  const aceWheel = hand.suited && hand.highRank === 14 && hand.lowRank <= 5 ? 1 : 0;
  const suitedBroadway = hand.suited && hand.highRank >= 11 && hand.lowRank >= 10 ? 0.86 : 0;
  const suitedConnector = hand.suited && hand.gap <= 2 && hand.highRank <= 12 ? (hand.gap === 1 ? 0.78 : 0.56) : 0;
  const aceBlocker = hand.highRank === 14 ? (hand.suited ? 0.72 : 0.38) : 0;
  const kingBlocker = hand.highRank === 13 && hand.suited ? 0.42 : 0;
  return clamp(Math.max(aceWheel, suitedBroadway, suitedConnector, aceBlocker, kingBlocker, input.blockers / 0.15), 0, 1);
}

function preflopPremiumValue(input: { preflopPercentile: number; preflopHand: PokerPreflopHand | null }) {
  const hand = input.preflopHand;
  if (!hand) return sigmoid((input.preflopPercentile - 0.95) * 52);
  if (hand.pair) return sigmoid((hand.highRank - 10.7) * 1.35);
  if (hand.highRank === 14 && hand.lowRank === 13) return hand.suited ? 0.92 : 0.82;
  if (hand.highRank === 14 && hand.lowRank === 12) return hand.suited ? 0.5 : 0.32;
  if (hand.highRank === 14 && hand.lowRank === 11) return hand.suited ? 0.27 : 0.14;
  if (hand.highRank === 13 && hand.lowRank === 12) return hand.suited ? 0.3 : 0.16;
  return sigmoid((input.preflopPercentile - 0.975) * 58) * 0.42;
}

function normalizeActionFrequencies(
  raw: Partial<PokerPolicyActionFrequencies>,
  input: {
    toCall: number;
    raiseLocked: boolean;
    highestBet: number;
    playerBet: number;
    playerStack: number;
    opponentsCanRespond?: boolean;
  },
) {
  const frequencies: PokerPolicyActionFrequencies = {
    fold: nonNegative(raw.fold ?? 0),
    check: nonNegative(raw.check ?? 0),
    call: nonNegative(raw.call ?? 0),
    raise: nonNegative(raw.raise ?? 0),
  };
  const canRaise = input.opponentsCanRespond !== false
    && !input.raiseLocked
    && input.playerBet + input.playerStack > input.highestBet;
  if (input.toCall > 0) {
    frequencies.fold += frequencies.check;
    frequencies.check = 0;
  } else {
    frequencies.check += frequencies.fold + frequencies.call;
    frequencies.fold = 0;
    frequencies.call = 0;
  }
  if (!canRaise) {
    if (input.toCall > 0) frequencies.call += frequencies.raise;
    else frequencies.check += frequencies.raise;
    frequencies.raise = 0;
  }
  const total = Object.values(frequencies).reduce((sum, frequency) => sum + frequency, 0);
  if (total <= 0) return input.toCall > 0
    ? { fold: 1, check: 0, call: 0, raise: 0 }
    : { fold: 0, check: 1, call: 0, raise: 0 };
  return Object.fromEntries(
    Object.entries(frequencies).map(([kind, frequency]) => [kind, frequency / total]),
  ) as PokerPolicyActionFrequencies;
}

function buildPreflopFrequencies(input: {
  profile: PokerPolicyProfile;
  blockers: number;
  preflopPercentile: number;
  preflopPositionFactor: number;
  preflopRaiseCount: number;
  preflopPosition: PokerPreflopPosition;
  preflopOpenerPosition?: PokerPreflopPosition;
  preflopLimpers: number;
  preflopColdCallers: number;
  preflopPreviouslyRaised: boolean;
  preflopHand: PokerPreflopHand | null;
  bigBlind: number;
  highestBet: number;
  playerBet: number;
  playerStack: number;
  toCall: number;
  effectiveStackBb: number;
  raiseLocked: boolean;
  opponentsCanRespond: boolean;
  squidPressure: number;
}) {
  const position = input.preflopPosition;
  const percentile = input.preflopPercentile;
  const profileRangeFactor = 0.5 + input.profile.looseness * 1.85;
  const aggressionFactor = clamp(0.82 + input.profile.aggression * 0.28, 0.82, 1.1);
  const bluffShape = preflopBluffShape(input);
  const premiumValue = preflopPremiumValue(input);
  const maxTarget = input.playerBet + input.playerStack;
  const canRaise = input.opponentsCanRespond && !input.raiseLocked && maxTarget > input.highestBet;
  const pressure = decisionPressure(
    input.toCall,
    input.playerStack,
    input.effectiveStackBb * input.bigBlind,
  );
  let scenario: PokerPreflopScenario;
  let targetRange: number;
  let enterFrequency: number;
  let openRaiseFrequency = 0;
  let threeBetFrequency = 0;
  let raiseFrequency = 0;
  let shortStackJamFrequency = 0;
  let raw: Partial<PokerPolicyActionFrequencies>;

  if (input.preflopRaiseCount === 0) {
    scenario = input.preflopLimpers > 0 ? "isolate" : position === "BB" && input.toCall === 0 ? "check-option" : "open";
    const limperTightening = clamp(1 - input.preflopLimpers * 0.055, 0.72, 1);
    if (position === "SB" && input.preflopLimpers === 0) {
      const raiseRange = clamp(POSITION_OPEN_RANGES.SB * profileRangeFactor, 0.3, 0.58);
      const completeRange = clamp(0.68 * profileRangeFactor, raiseRange, 0.82);
      const raiseEntry = rangeFrequency(percentile, raiseRange);
      const totalEntry = rangeFrequency(percentile, completeRange, 23);
      const raiseShare = raiseEntry * clamp(0.78 + input.profile.aggression * 0.18, 0.78, 0.96);
      targetRange = completeRange;
      enterFrequency = totalEntry;
      openRaiseFrequency = clamp(raiseShare / Math.max(0.001, totalEntry), 0, 1);
      raiseFrequency = openRaiseFrequency;
      raw = { fold: 1 - totalEntry, call: Math.max(0, totalEntry - raiseShare), raise: raiseShare };
    } else {
      targetRange = clamp(POSITION_OPEN_RANGES[position] * profileRangeFactor * limperTightening, 0.08, 0.58);
      enterFrequency = rangeFrequency(percentile, targetRange);
      openRaiseFrequency = position === "BB"
        ? clamp(0.78 + input.profile.aggression * 0.18, 0.78, 0.96)
        : 1;
      raiseFrequency = openRaiseFrequency;
      const selectedRaise = enterFrequency * openRaiseFrequency;
      raw = position === "BB" && input.toCall === 0
        ? { check: 1 - selectedRaise, raise: selectedRaise }
        : { fold: 1 - selectedRaise, raise: selectedRaise };
    }
  } else if (input.preflopRaiseCount === 1) {
    scenario = "vs-open";
    const openerRange = POSITION_OPEN_RANGES[input.preflopOpenerPosition ?? "CO"];
    const openerFactor = clamp(Math.sqrt(openerRange / POSITION_OPEN_RANGES.CO), 0.78, 1.24);
    const openSizeBb = input.highestBet / Math.max(1, input.bigBlind);
    const sizeFactor = clamp(Math.pow(2.5 / Math.max(1, openSizeBb), 0.78), 0.52, 1.3);
    const pressureFactor = clamp(1 - Math.pow(pressure, 0.72) * 0.62, 0.28, 1);
    const coldCallFactor = clamp(1 + input.preflopColdCallers * 0.045, 1, 1.16);
    targetRange = clamp(
      POSITION_DEFEND_VS_OPEN[position] * profileRangeFactor * openerFactor * sizeFactor * pressureFactor * coldCallFactor,
      0.035,
      0.56,
    );
    enterFrequency = rangeFrequency(percentile, targetRange);
    const premium = premiumValue;
    const strong = sigmoid((percentile - 0.9) * 40);
    const positionRaiseFactor = position === "SB" ? 1.18 : position === "BB" ? 0.78 : 1;
    threeBetFrequency = clamp(
      (0.04 + premium * 0.68 + strong * 0.06 + bluffShape * input.profile.bluff * 0.32 * (1 - premium))
        * aggressionFactor * positionRaiseFactor,
      0.025,
      0.92,
    );
    raiseFrequency = threeBetFrequency;
    const selectedRaise = canRaise ? enterFrequency * threeBetFrequency : 0;
    raw = { fold: 1 - enterFrequency, call: enterFrequency - selectedRaise, raise: selectedRaise };
    const shallowJamRamp = sigmoid((24 - input.effectiveStackBb) / 4.5);
    shortStackJamFrequency = clamp(
      shallowJamRamp * (premium * 0.82 + strong * 0.2),
      0,
      0.92,
    );
  } else if (input.preflopRaiseCount === 2) {
    scenario = "vs-three-bet";
    const threeBetSizeBb = input.highestBet / Math.max(1, input.bigBlind);
    const sizeFactor = clamp(Math.pow(9 / Math.max(3, threeBetSizeBb), 0.8), 0.48, 1.3);
    const pressureFactor = clamp(1 - Math.pow(pressure, 0.68) * 0.66, 0.22, 1);
    const positionFactor = position === "BTN" || position === "BB" ? 1.08 : position === "SB" ? 0.92 : 1;
    const baseContinue = input.preflopPreviouslyRaised ? 0.14 : 0.085;
    targetRange = clamp(baseContinue * profileRangeFactor * sizeFactor * pressureFactor * positionFactor, 0.025, 0.24);
    enterFrequency = rangeFrequency(percentile, targetRange, 32);
    const premium = premiumValue;
    const blockerFourBet = bluffShape * input.profile.bluff * clamp((percentile - 0.72) / 0.18, 0, 1);
    raiseFrequency = clamp((0.055 + premium * 0.72 + blockerFourBet * 0.3) * aggressionFactor, 0.03, 0.9);
    threeBetFrequency = raiseFrequency;
    const selectedRaise = canRaise ? enterFrequency * raiseFrequency : 0;
    raw = { fold: 1 - enterFrequency, call: enterFrequency - selectedRaise, raise: selectedRaise };
    const fourBetJamRamp = sigmoid((52 - input.effectiveStackBb) / 7);
    shortStackJamFrequency = clamp(
      fourBetJamRamp * (premium * 0.88 + blockerFourBet * 0.28),
      0,
      0.95,
    );
  } else {
    scenario = "vs-four-bet";
    const pressureFactor = clamp(1 - Math.pow(pressure, 0.62) * 0.58, 0.24, 0.82);
    targetRange = clamp((0.052 + Math.max(0, 45 - input.effectiveStackBb) * 0.00045) * profileRangeFactor * pressureFactor, 0.022, 0.085);
    enterFrequency = rangeFrequency(percentile, targetRange, 38);
    const premium = premiumValue;
    raiseFrequency = clamp(0.18 + premium * 0.78, 0.18, 0.96);
    threeBetFrequency = raiseFrequency;
    const selectedRaise = canRaise ? enterFrequency * raiseFrequency : 0;
    raw = { fold: 1 - enterFrequency, call: enterFrequency - selectedRaise, raise: selectedRaise };
    const fiveBetJamRamp = sigmoid((78 - input.effectiveStackBb) / 12);
    shortStackJamFrequency = clamp(
      fiveBetJamRamp * (0.72 + premium * 0.26),
      0.08,
      0.98,
    );
  }

  if (input.squidPressure > 0 && input.toCall > 0) {
    const pressureShift = Math.min(raw.fold ?? 0, 0.025 + input.squidPressure * 0.22);
    raw.fold = Math.max(0, (raw.fold ?? 0) - pressureShift);
    raw.call = (raw.call ?? 0) + pressureShift * 0.7;
    raw.raise = (raw.raise ?? 0) + pressureShift * 0.3;
  }

  const actionFrequencies = normalizeActionFrequencies(raw, input);
  return {
    scenario,
    position,
    targetRange,
    enterFrequency: actionFrequencies.call + actionFrequencies.raise,
    openRaiseFrequency,
    threeBetFrequency,
    raiseFrequency,
    shortStackJamFrequency,
    actionFrequencies,
  };
}

function inferredBigBlind(input: PokerPolicyInput) {
  if (input.bigBlind !== undefined && input.bigBlind > 0) return input.bigBlind;
  if (input.effectiveStackBb > 0 && input.playerStack > 0) {
    return input.playerStack / input.effectiveStackBb;
  }
  return Math.max(1, input.minRaise);
}

/**
 * Builds the deterministic half of the policy. No random numbers are consumed,
 * which lets a headless arena inspect frequencies before sampling an action.
 */
export function evaluatePokerPolicy(rawInput: PokerPolicyInput): PokerPolicyPlan {
  const normalizedPot = nonNegative(rawInput.pot);
  const normalizedPlayerStack = nonNegative(rawInput.playerStack);
  const normalizedToCall = Math.min(nonNegative(rawInput.toCall), normalizedPlayerStack);
  const normalizedPositionFactor = clamp(rawInput.preflopPositionFactor ?? 1, 0.5, 1.5);
  const input = {
    ...rawInput,
    equity: clamp(rawInput.equity, 0, 1),
    handStrength: clamp(rawInput.handStrength, 0, 1),
    draw: clamp(rawInput.draw, 0, 1),
    blockers: clamp(rawInput.blockers, 0, 1),
    pot: normalizedPot,
    toCall: normalizedToCall,
    potOdds: normalizedToCall > 0 ? normalizedToCall / Math.max(1, normalizedPot + normalizedToCall) : 0,
    activeOpponents: Math.max(1, Math.floor(nonNegative(rawInput.activeOpponents))),
    opponentsCanRespond: rawInput.opponentsCanRespond !== false,
    callEndsHand: Boolean(rawInput.callEndsHand),
    effectiveStackBb: nonNegative(rawInput.effectiveStackBb),
    startingDepthBb: Math.max(1, nonNegative(rawInput.startingDepthBb)),
    highestBet: nonNegative(rawInput.highestBet),
    playerBet: nonNegative(rawInput.playerBet),
    playerStack: normalizedPlayerStack,
    minRaise: nonNegative(rawInput.minRaise),
    squidPressure: clamp(rawInput.squidPressure, 0, 0.25),
    preflopPercentile: clamp(rawInput.preflopPercentile ?? rawInput.handStrength, 0, 1),
    preflopPositionFactor: normalizedPositionFactor,
    preflopRaiseCount: Math.max(0, Math.floor(nonNegative(rawInput.preflopRaiseCount ?? 0))),
    preflopPosition: rawInput.preflopPosition ?? positionFromFactor(normalizedPositionFactor),
    preflopOpenerPosition: rawInput.preflopOpenerPosition,
    preflopLimpers: Math.max(0, Math.floor(nonNegative(rawInput.preflopLimpers ?? 0))),
    preflopColdCallers: Math.max(0, Math.floor(nonNegative(rawInput.preflopColdCallers ?? 0))),
    preflopPreviouslyRaised: Boolean(rawInput.preflopPreviouslyRaised),
    preflopHand: rawInput.preflopHand ?? null,
    boardWetness: clamp(rawInput.boardWetness ?? 0, 0, 1),
    boardPairing: clamp(rawInput.boardPairing ?? 0, 0, 1),
    boardHighCard: clamp(rawInput.boardHighCard ?? 0, 0, 1),
    initiative: Boolean(rawInput.initiative),
    streetRaiseCount: Math.max(0, Math.floor(nonNegative(rawInput.streetRaiseCount ?? 0))),
    profile: {
      aggression: clamp(rawInput.profile.aggression, 0, 1),
      looseness: clamp(rawInput.profile.looseness, 0, 1),
      bluff: clamp(rawInput.profile.bluff, 0, 1),
    },
  };

  const bigBlind = inferredBigBlind(input);
  const effectiveStackChips = input.effectiveStackBb * bigBlind;
  const spr = effectiveStackChips / Math.max(1, input.pot);
  // Pressure is a share of chips that can still be contested, so it can never
  // exceed 100%. In particular, a bettor who has just moved all-in has zero
  // chips *behind* but the outstanding call is still part of the effective
  // stack. Without this floor, a 225 call divided by zero became a pressure of
  // 225 and forced the realization threshold to its 94% safety clamp.
  const pressure = decisionPressure(input.toCall, input.playerStack, effectiveStackChips);
  const preflopPlan = buildPreflopFrequencies({ ...input, bigBlind });
  const positionBonus = input.inPosition ? 0.016 : -0.004;
  const baseStrength = input.street === "preflop"
    ? input.equity * 0.35 + input.handStrength * 0.65
    : input.equity * 0.72 + input.handStrength * 0.28;
  const strategyStrength = clamp(baseStrength + positionBonus + input.squidPressure, 0.02, 0.98);
  // Depth is a continuous state. Smooth ramps avoid changing the whole tree at
  // exactly 45 BB, 140 BB or one particular SPR value.
  const shallowStackFactor = sigmoid((48 - input.effectiveStackBb) / 8);
  const shallowSprFactor = sigmoid((4 - spr) / 0.9);
  const shallowFactor = 1 - (1 - shallowStackFactor) * (1 - shallowSprFactor);
  const deepFactor = sigmoid((input.effectiveStackBb - 135) / 20) * sigmoid((spr - 6.5) / 1.6);
  const tableDepthNudge = Math.tanh((input.startingDepthBb - 100) / 80)
    * 0.007
    * (1 - shallowFactor)
    * (1 - deepFactor);
  const depthThreshold = -0.032 * shallowFactor + 0.023 * deepFactor + tableDepthNudge;
  const multiwayValuePenalty = Math.min(0.09, (input.activeOpponents - 1) * 0.024);
  const valueThreshold = (input.street === "river" ? 0.61 : 0.57)
    - input.profile.aggression * 0.075
    + depthThreshold
    + multiwayValuePenalty;
  const drawQuality = clamp(input.draw / 0.2, 0, 1);
  const blockerQuality = clamp(input.blockers / 0.15, 0, 1);
  const streetProgress = input.street === "river" ? 1 : input.street === "turn" ? 0.5 : 0;
  const valueScore = sigmoid(
    (strategyStrength + drawQuality * (input.street === "river" ? 0 : 0.035) - valueThreshold) * 12,
  );
  const strong = valueScore >= 0.5;
  const highDryBoard = input.boardHighCard * (1 - input.boardWetness);
  const rangeAdvantage = clamp(
    (input.equity - 0.5) * 1.08
      + (input.initiative ? 0.08 : -0.012)
      + (input.inPosition ? 0.03 : -0.01)
      + highDryBoard * 0.045
      + input.boardPairing * (1 - input.boardWetness) * 0.025
      - input.boardWetness * 0.035
      - (input.activeOpponents - 1) * 0.024,
    -0.5,
    0.5,
  );
  const nutAdvantage = clamp(sigmoid(
    (strategyStrength
      + blockerQuality * 0.025
      + drawQuality * (input.street === "river" ? 0 : 0.035)
      - (0.69 + deepFactor * 0.018)) * 13,
  ), 0, 1);

  const bluffShape = clamp(
    drawQuality * (input.street === "river" ? 0 : 0.58)
      + blockerQuality * (input.street === "river" ? 0.72 : 0.34)
      + (input.inPosition ? 0.06 : 0)
      + Math.max(0, rangeAdvantage) * 0.12,
    0,
    1,
  );
  const polarization = clamp(
    nutAdvantage * 0.55
      + (1 - valueScore) * bluffShape * 0.34
      + streetProgress * 0.12
      + Math.abs(rangeAdvantage) * 0.12,
    0,
    1,
  );
  const rangeBetBias = clamp(
    (input.initiative ? 0.24 : 0)
      + (input.inPosition ? 0.1 : -0.04)
      + highDryBoard * 0.24
      + input.boardPairing * (1 - input.boardWetness) * 0.18
      + rangeAdvantage * 0.4
      - input.boardWetness * 0.16
      - (input.activeOpponents - 1) * 0.12,
    -0.45,
    0.55,
  );
  const sizeOptions = input.street === "river"
    ? [0.5, 0.75, 1 + deepFactor * 0.25]
    : [0.33, 0.66, 0.82 + deepFactor * 0.22];
  const sizeFrequencies = softmax([
    0.72 + rangeBetBias * 1.05 - polarization * 0.5 - Number(input.toCall > 0) * 0.18,
    0.64 + input.boardWetness * 0.42 + drawQuality * 0.16,
    -0.08 + polarization * 1.55 + streetProgress * 0.26 + deepFactor * 0.24
      + input.streetRaiseCount * 0.16 - (input.activeOpponents - 1) * 0.12,
  ], 0.82);
  const postflopSizingIntents = sizeOptions.map((fraction, index) => ({
    fraction,
    frequency: sizeFrequencies[index],
  }));
  const preferredSizeIndex = sizeFrequencies.reduce(
    (best, frequency, index) => frequency > sizeFrequencies[best] ? index : best,
    0,
  );
  let intendedBetFraction = sizeOptions[preferredSizeIndex];
  const sizingPot = input.pot + input.toCall;
  const maxTarget = input.playerBet + input.playerStack;
  const sizingUnit = Math.max(1, bigBlind / 2);
  let desiredTarget: number;
  if (input.street === "preflop") {
    if (input.preflopRaiseCount === 0) {
      const limperPremium = input.preflopLimpers * bigBlind;
      const openSizeBb: Record<PokerPreflopPosition, number> = {
        UTG: 2.4,
        HJ: 2.35,
        CO: 2.3,
        BTN: 2.25,
        SB: 2.7,
        BB: 3.2,
      };
      desiredTarget = Math.max(
        input.highestBet + input.minRaise,
        bigBlind * (openSizeBb[input.preflopPosition] + (input.profile.aggression - 0.5) * 0.18) + limperPremium,
      );
    } else if (input.preflopRaiseCount === 1) {
      const multiplier = input.inPosition ? 3.1 : 4.1;
      desiredTarget = input.highestBet * multiplier + input.preflopColdCallers * input.highestBet;
    } else if (input.preflopRaiseCount === 2) {
      desiredTarget = input.highestBet * (input.inPosition ? 2.2 : 2.4);
    } else {
      desiredTarget = maxTarget;
    }
    intendedBetFraction = Math.max(0, desiredTarget - input.highestBet) / Math.max(1, sizingPot);
  } else {
    const desiredIncrement = Math.max(input.minRaise, sizingPot * intendedBetFraction);
    desiredTarget = input.highestBet + desiredIncrement;
  }
  const roundedTarget = Math.round(desiredTarget / sizingUnit) * sizingUnit;
  const legalFloor = Math.min(maxTarget, input.highestBet + input.minRaise);
  const raiseTo = Math.min(maxTarget, Math.max(legalFloor, roundedTarget));
  // `betFraction` describes the modal executable target. Action balance below
  // uses the expectation across every legal size branch instead of feeding a
  // discontinuous argmax back into the action mix.
  const betFraction = Math.max(0, raiseTo - input.highestBet) / Math.max(1, sizingPot);
  let sizingIntents: Array<{ fraction?: number; target?: number; frequency: number }>;
  if (input.street !== "preflop") {
    sizingIntents = postflopSizingIntents;
  } else if (input.preflopRaiseCount === 0) {
    const limperPremium = input.preflopLimpers * bigBlind;
    const latePosition = input.preflopPosition === "BTN" || input.preflopPosition === "CO";
    const blindPosition = input.preflopPosition === "SB" || input.preflopPosition === "BB";
    const frequencies = softmax([
      0.68 + Number(latePosition) * 0.24 - input.preflopLimpers * 0.22,
      0.82 + Number(latePosition) * 0.08 + input.preflopLimpers * 0.05,
      0.24 + Number(blindPosition) * 0.34 + input.preflopLimpers * 0.24 + shallowFactor * 0.08,
    ], 0.72);
    sizingIntents = [2.2, 2.5, 3].map((multiple, index) => ({
      target: multiple * bigBlind + limperPremium,
      frequency: frequencies[index],
    }));
  } else if (input.preflopRaiseCount === 1) {
    const multipliers = input.inPosition ? [2.8, 3.2, 3.6] : [3.5, 4, 4.5];
    const frequencies = softmax([
      0.56 + Number(input.inPosition) * 0.2 - input.preflopColdCallers * 0.16,
      0.86 + deepFactor * 0.08,
      0.34 + Number(!input.inPosition) * 0.22 + input.preflopColdCallers * 0.24 + shallowFactor * 0.08,
    ], 0.72);
    sizingIntents = multipliers.map((multiple, index) => ({
      target: input.highestBet * (multiple + input.preflopColdCallers),
      frequency: frequencies[index],
    }));
  } else if (input.preflopRaiseCount === 2) {
    const center = input.inPosition ? 2.2 : 2.4;
    const frequencies = softmax([
      0.45 + Number(input.inPosition) * 0.15,
      0.82,
      0.35 + Number(!input.inPosition) * 0.16 + deepFactor * 0.12,
    ], 0.7);
    sizingIntents = [center - 0.2, center, center + 0.2].map((multiple, index) => ({
      target: input.highestBet * multiple,
      frequency: frequencies[index],
    }));
  } else {
    sizingIntents = [{ target: maxTarget, frequency: 1 }];
  }
  const postflopJamRamp = input.street === "preflop"
    ? 0
    : sigmoid((48 - input.effectiveStackBb) / 6.5) * sigmoid((4.6 - spr) / 0.75);
  const shortStackJamFrequency = input.street === "preflop"
    ? preflopPlan.shortStackJamFrequency
    : clamp(
        postflopJamRamp
          * (valueScore * (0.24 + input.profile.aggression * 0.36)
            + (1 - valueScore) * drawQuality * 0.2),
        0,
        0.76,
      );
  const canRaise = input.opponentsCanRespond && !input.raiseLocked && maxTarget > input.highestBet;
  const sizingRoutes = canRaise
    ? buildPokerSizingRoutes({
        street: input.street,
        pot: input.pot,
        toCall: input.toCall,
        highestBet: input.highestBet,
        playerBet: input.playerBet,
        playerStack: input.playerStack,
        minRaise: input.minRaise,
        bigBlind,
        preflopRaiseCount: input.preflopRaiseCount,
      }, raiseTo, shortStackJamFrequency, sizingIntents)
    : [];
  const strategyBetFraction = sizingRoutes.length
    ? sizingRoutes.reduce((sum, route) => sum + route.frequency * route.fraction, 0)
    : betFraction;
  const balancedBluffRate = strategyBetFraction / (1 + 2 * strategyBetFraction);

  const bluffCandidate = bluffShape > 0.015;
  const multiwayBluffFactor = 1 / (1 + 0.62 * (input.activeOpponents - 1));
  const depthBluffFactor = 1 - shallowFactor * 0.18 + deepFactor * (input.inPosition ? 0.08 : -0.06);
  const bluffFrequency = clamp(
    balancedBluffRate
      * (0.42 + input.profile.bluff * 2.8)
      * bluffShape
      * (input.inPosition ? 1.16 : 0.82)
      * (1 + input.squidPressure * 2.4)
      * depthBluffFactor
      * multiwayBluffFactor,
    0,
    0.78,
  );
  const probeFrequency = clamp(
    (0.08 + input.profile.aggression * 0.16)
      * sigmoid((rangeAdvantage + rangeBetBias * 0.45 + 0.08) * 5)
      * (input.inPosition ? 1 : 0.42)
      * multiwayBluffFactor,
    0,
    0.32,
  );
  const raiseFrequencyWhenStrong = clamp(
    (0.42 + input.profile.aggression * 0.48) * (1 - Math.min(0.18, (input.activeOpponents - 1) * 0.045)),
    0,
    0.92,
  );
  const raiseFrequencyWhenBluffing = clamp(
    (0.28 + input.profile.aggression * 0.36) * multiwayBluffFactor,
    0,
    0.7,
  );
  const realizationThreshold = input.callEndsHand
    ? input.potOdds
    : clamp(
        input.potOdds
          + (input.inPosition ? -0.006 : 0.016)
          + input.boardWetness * (input.inPosition ? 0.002 : 0.012)
          + (input.activeOpponents - 1) * 0.017
          + pressure * 0.018
          - drawQuality * 0.008,
        0,
        0.94,
      );
  const continueEdge = input.equity
    + input.squidPressure
    + (input.profile.looseness - 0.27) * 0.035
    - realizationThreshold;
  let actionFrequencies: PokerPolicyActionFrequencies;
  if (input.toCall > 0 && input.callEndsHand && !canRaise) {
    // Once calling leaves the player no later decision and raising is illegal,
    // fold/call is centered on chip-EV indifference on every street, including
    // preflop. Only explicit Squid utility may shift that boundary; player-style
    // looseness must not rewrite pot odds.
    const terminalEdgeLogit = (input.equity + input.squidPressure - input.potOdds) * 14;
    actionFrequencies = softmaxLegalActions(
      { fold: -terminalEdgeLogit, call: terminalEdgeLogit },
      input,
      0.62,
    );
  } else if (input.street === "preflop") {
    actionFrequencies = preflopPlan.actionFrequencies;
  } else if (input.toCall > 0) {
    const futureRiskFactor = input.callEndsHand ? 0 : 1;
    const foldLogit = -continueEdge * 11.2
      + pressure * 0.62 * futureRiskFactor
      + (input.activeOpponents - 1) * 0.14 * futureRiskFactor;
    const callLogit = 0.34
      + sigmoid(continueEdge * 10) * 0.92
      - valueScore * 0.54
      + drawQuality * 0.26
      - pressure * 0.22 * futureRiskFactor;
    const raiseLogit = -1.02
      + valueScore * (1.72 + input.profile.aggression * 0.82)
      + bluffFrequency * 2.15
      + nutAdvantage * 0.42
      - input.streetRaiseCount * 0.3
      - (input.activeOpponents - 1) * 0.2;
    actionFrequencies = softmaxLegalActions(
      { fold: foldLogit, call: callLogit, raise: raiseLogit },
      input,
      0.76 + (input.activeOpponents - 1) * 0.035,
    );
  } else {
    const checkLogit = 0.46
      + (1 - valueScore) * 0.28
      - input.profile.aggression * 0.15
      - rangeBetBias * 0.42;
    const betLogit = -0.82
      + valueScore * (1.45 + input.profile.aggression * 0.72)
      + bluffFrequency * 1.9
      + rangeBetBias * 1.58
      + drawQuality * 0.16
      - (input.activeOpponents - 1) * 0.3;
    actionFrequencies = softmaxLegalActions(
      { check: checkLogit, raise: betLogit },
      input,
      0.78 + (input.activeOpponents - 1) * 0.04,
    );
  }

  return {
    strategyStrength,
    valueThreshold,
    strong,
    bluffCandidate,
    bluffFrequency,
    multiwayBluffFactor,
    probeFrequency,
    raiseFrequencyWhenStrong,
    raiseFrequencyWhenBluffing,
    intendedBetFraction,
    betFraction,
    balancedBluffRate,
    raiseTo,
    maxTarget,
    spr,
    pressure,
    shortStackJamFrequency,
    continueEdge,
    preflopTargetRange: preflopPlan.targetRange,
    preflopEnterFrequency: preflopPlan.enterFrequency,
    preflopOpenRaiseFrequency: preflopPlan.openRaiseFrequency,
    preflopThreeBetFrequency: preflopPlan.threeBetFrequency,
    preflopRaiseFrequency: preflopPlan.raiseFrequency,
    preflopScenario: preflopPlan.scenario,
    preflopPosition: preflopPlan.position,
    rangeAdvantage,
    nutAdvantage,
    realizationThreshold,
    sizingIntents,
    sizingRoutes,
    actionFrequencies,
  };
}

/** Samples one legal action from the deterministic plan using only the supplied RNG. */
export function choosePokerPolicyAction(
  input: PokerPolicyInput,
  random: PokerPolicyRng = Math.random,
): PokerPolicyAction {
  const plan = evaluatePokerPolicy(input);
  // Always consume the same three rolls, making seeded simulations reproducible
  // while every caller now samples the same published mixed strategy.
  const sizeMix = unitRandom(random);
  unitRandom(random);
  const mix = unitRandom(random);
  const sizingBranches = [...plan.sizingRoutes]
    .filter((route) => route.frequency > 0)
    .sort((left, right) => right.frequency - left.frequency);
  let sizeCumulative = 0;
  let raiseTo = plan.raiseTo;
  for (const [index, route] of sizingBranches.entries()) {
    sizeCumulative += route.frequency;
    if (sizeMix < sizeCumulative || index === sizingBranches.length - 1) {
      raiseTo = route.target;
      break;
    }
  }
  const branches = (Object.entries(plan.actionFrequencies) as [PokerPolicyActionKind, number][])
    .filter(([, frequency]) => frequency > 0)
    // Ordering does not change the distribution. Putting the main line first
    // makes deterministic zero-valued test RNGs choose the policy's main line.
    .sort((left, right) => right[1] - left[1]);
  let cumulative = 0;
  for (const [index, [kind, frequency]] of branches.entries()) {
    cumulative += frequency;
    if (mix < cumulative || index === branches.length - 1) {
      return kind === "raise" ? { kind, raiseTo } : { kind };
    }
  }
  const fallback = input.toCall > 0 ? "fold" : "check";
  return { kind: fallback };
}
