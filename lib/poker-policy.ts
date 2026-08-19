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

function unitRandom(random: PokerPolicyRng) {
  return clamp(random(), 0, 1 - Number.EPSILON);
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
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

function rangeFrequency(percentile: number, targetRange: number, steepness = 42) {
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
  input: { toCall: number; raiseLocked: boolean; highestBet: number; playerBet: number; playerStack: number },
) {
  const frequencies: PokerPolicyActionFrequencies = {
    fold: nonNegative(raw.fold ?? 0),
    check: nonNegative(raw.check ?? 0),
    call: nonNegative(raw.call ?? 0),
    raise: nonNegative(raw.raise ?? 0),
  };
  const canRaise = !input.raiseLocked && input.playerBet + input.playerStack > input.highestBet;
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
  squidPressure: number;
}) {
  const position = input.preflopPosition;
  const percentile = input.preflopPercentile;
  const profileRangeFactor = 0.5 + input.profile.looseness * 1.85;
  const aggressionFactor = clamp(0.82 + input.profile.aggression * 0.28, 0.82, 1.1);
  const bluffShape = preflopBluffShape(input);
  const premiumValue = preflopPremiumValue(input);
  const maxTarget = input.playerBet + input.playerStack;
  const canRaise = !input.raiseLocked && maxTarget > input.highestBet;
  const pressure = input.toCall / Math.max(1, Math.min(input.playerStack, input.effectiveStackBb * input.bigBlind));
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
      const totalEntry = rangeFrequency(percentile, completeRange, 34);
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
    if (input.effectiveStackBb <= 22) {
      shortStackJamFrequency = clamp(premium * 0.82 + strong * 0.2, 0, 0.92);
    }
  } else if (input.preflopRaiseCount === 2) {
    scenario = "vs-three-bet";
    const threeBetSizeBb = input.highestBet / Math.max(1, input.bigBlind);
    const sizeFactor = clamp(Math.pow(9 / Math.max(3, threeBetSizeBb), 0.8), 0.48, 1.3);
    const pressureFactor = clamp(1 - Math.pow(pressure, 0.68) * 0.66, 0.22, 1);
    const positionFactor = position === "BTN" || position === "BB" ? 1.08 : position === "SB" ? 0.92 : 1;
    const baseContinue = input.preflopPreviouslyRaised ? 0.14 : 0.085;
    targetRange = clamp(baseContinue * profileRangeFactor * sizeFactor * pressureFactor * positionFactor, 0.025, 0.24);
    enterFrequency = rangeFrequency(percentile, targetRange, 48);
    const premium = premiumValue;
    const blockerFourBet = bluffShape * input.profile.bluff * clamp((percentile - 0.72) / 0.18, 0, 1);
    raiseFrequency = clamp((0.055 + premium * 0.72 + blockerFourBet * 0.3) * aggressionFactor, 0.03, 0.9);
    threeBetFrequency = raiseFrequency;
    const selectedRaise = canRaise ? enterFrequency * raiseFrequency : 0;
    raw = { fold: 1 - enterFrequency, call: enterFrequency - selectedRaise, raise: selectedRaise };
    if (input.effectiveStackBb <= 50) {
      shortStackJamFrequency = clamp(premium * 0.88 + blockerFourBet * 0.28, 0, 0.95);
    }
  } else {
    scenario = "vs-four-bet";
    const pressureFactor = clamp(1 - Math.pow(pressure, 0.62) * 0.58, 0.24, 0.82);
    targetRange = clamp((0.052 + Math.max(0, 45 - input.effectiveStackBb) * 0.00045) * profileRangeFactor * pressureFactor, 0.022, 0.085);
    enterFrequency = rangeFrequency(percentile, targetRange, 58);
    const premium = premiumValue;
    raiseFrequency = clamp(0.18 + premium * 0.78, 0.18, 0.96);
    threeBetFrequency = raiseFrequency;
    const selectedRaise = canRaise ? enterFrequency * raiseFrequency : 0;
    raw = { fold: 1 - enterFrequency, call: enterFrequency - selectedRaise, raise: selectedRaise };
    shortStackJamFrequency = clamp(0.72 + premium * 0.26, 0.72, 0.98);
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
    profile: {
      aggression: clamp(rawInput.profile.aggression, 0, 1),
      looseness: clamp(rawInput.profile.looseness, 0, 1),
      bluff: clamp(rawInput.profile.bluff, 0, 1),
    },
  };

  const bigBlind = inferredBigBlind(input);
  const effectiveStackChips = input.effectiveStackBb * bigBlind;
  const spr = effectiveStackChips / Math.max(1, input.pot);
  const pressure = input.toCall / Math.max(1, Math.min(input.playerStack, effectiveStackChips));
  const preflopPlan = buildPreflopFrequencies({ ...input, bigBlind });
  const positionBonus = input.inPosition ? 0.012 : 0;
  const baseStrength = input.street === "preflop"
    ? input.equity * 0.35 + input.handStrength * 0.65
    : input.equity * 0.72 + input.handStrength * 0.28;
  const strategyStrength = clamp(baseStrength + positionBonus + input.squidPressure, 0.02, 0.98);
  // Current effective depth and SPR, not the table's original buy-in, determine
  // whether a spot behaves shallow or deep. The original depth only nudges the
  // residual post-flop style when current effective stacks are in the middle.
  const effectivelyShallow = input.effectiveStackBb <= 45 || spr <= 3.5;
  const effectivelyDeep = input.effectiveStackBb >= 140 && spr >= 7;
  const tableDepthNudge = !effectivelyShallow && !effectivelyDeep
    ? input.startingDepthBb >= 180 ? 0.008 : input.startingDepthBb <= 45 ? -0.008 : 0
    : 0;
  const depthThreshold = effectivelyShallow ? -0.032 : effectivelyDeep ? 0.022 : tableDepthNudge;
  const multiwayValuePenalty = Math.min(0.09, (input.activeOpponents - 1) * 0.024);
  const valueThreshold = (input.street === "river" ? 0.61 : 0.57)
    - input.profile.aggression * 0.075
    + depthThreshold
    + multiwayValuePenalty;
  const strong = strategyStrength + input.draw * 0.35 > valueThreshold;

  const sizeOptions = input.street === "river"
    ? effectivelyDeep ? [0.5, 0.75, 1.25] : [0.5, 0.75, 1]
    : effectivelyDeep ? [0.33, 0.66, 1] : [0.33, 0.5, 0.75];
  const sizeIndex = strong ? (input.profile.aggression > 0.68 ? 2 : 1) : input.blockers > 0.08 ? 2 : 0;
  let intendedBetFraction = sizeOptions[sizeIndex];
  const sizingPot = input.pot + input.toCall;
  const maxTarget = input.playerBet + input.playerStack;
  const sizingUnit = Math.max(1, bigBlind / 2);
  let desiredTarget: number;
  if (input.street === "preflop") {
    if (input.preflopRaiseCount === 0) {
      const limperPremium = input.preflopLimpers * bigBlind;
      desiredTarget = Math.max(
        input.highestBet + input.minRaise,
        bigBlind * (2.35 + input.profile.aggression * 0.4) + limperPremium,
      );
    } else if (input.preflopRaiseCount === 1) {
      const multiplier = input.inPosition ? 3.1 : 4.1;
      desiredTarget = input.highestBet * multiplier + input.preflopColdCallers * input.highestBet;
    } else if (input.preflopRaiseCount === 2) {
      desiredTarget = input.effectiveStackBb <= 50
        ? maxTarget
        : input.highestBet * (input.inPosition ? 2.2 : 2.4);
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
  // Balance calculations must use the executable size after min-raise and
  // all-in caps, rather than the pre-clamp menu size.
  const betFraction = Math.max(0, raiseTo - input.highestBet) / Math.max(1, sizingPot);
  const balancedBluffRate = betFraction / (1 + 2 * betFraction);

  const bluffCandidate = input.draw > 0.03
    || input.blockers > 0.04
    || (input.street === "river" && input.blockers > 0.07);
  const multiwayBluffFactor = 1 / (1 + 0.62 * (input.activeOpponents - 1));
  const depthBluffFactor = effectivelyShallow ? 0.82 : effectivelyDeep ? (input.inPosition ? 1.08 : 0.94) : 1;
  const bluffFrequency = clamp(
    balancedBluffRate
      * (0.42 + input.profile.bluff * 2.8)
      * (input.inPosition ? 1.16 : 0.82)
      * (1 + input.squidPressure * 2.4)
      * depthBluffFactor
      * multiwayBluffFactor,
    0,
    0.78,
  );
  const probeFrequency = clamp(
    (0.12 + input.profile.aggression * 0.12)
      * (input.inPosition ? 1 : 0.35)
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
  const postflopJamEligible = input.street !== "preflop" && input.effectiveStackBb <= 45 && spr <= 4.5;
  const shortStackJamFrequency = input.street === "preflop"
    ? preflopPlan.shortStackJamFrequency
    : strong && postflopJamEligible
      ? clamp(0.28 + input.profile.aggression * 0.28 + Math.max(0, 2.5 - spr) * 0.055, 0, 0.72)
      : 0;
  const continueEdge = strategyStrength
    + input.draw
    + input.profile.looseness * 0.1
    - input.potOdds
    - pressure * 0.12
    - Math.min(0.075, (input.activeOpponents - 1) * 0.02);

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
    actionFrequencies: preflopPlan.actionFrequencies,
  };
}

/** Samples one legal action from the deterministic plan using only the supplied RNG. */
export function choosePokerPolicyAction(
  input: PokerPolicyInput,
  random: PokerPolicyRng = Math.random,
): PokerPolicyAction {
  const plan = evaluatePokerPolicy(input);
  // Always consume the same three rolls, making seeded simulations reproducible
  // even when a hand is not a bluff or jam candidate.
  const bluffRoll = unitRandom(random);
  const jamRoll = unitRandom(random);
  const mix = unitRandom(random);
  const bluffing = plan.bluffCandidate && bluffRoll < plan.bluffFrequency;
  const canRaise = !input.raiseLocked && plan.raiseTo > input.highestBet;
  const shouldJam = canRaise
    && plan.shortStackJamFrequency > 0
    && jamRoll < plan.shortStackJamFrequency;
  const raiseTo = shouldJam ? plan.maxTarget : plan.raiseTo;

  if (input.street === "preflop") {
    let cumulative = 0;
    for (const kind of ["raise", "call", "check", "fold"] as const) {
      cumulative += plan.actionFrequencies[kind];
      if (mix < cumulative || kind === "fold") {
        return kind === "raise" ? { kind, raiseTo } : { kind };
      }
    }
  }

  if (input.toCall > 0) {
    const raiseFrequency = plan.strong
      ? plan.raiseFrequencyWhenStrong
      : bluffing ? plan.raiseFrequencyWhenBluffing : 0;
    if (canRaise && (plan.strong || bluffing) && mix < raiseFrequency) {
      return { kind: "raise", raiseTo };
    }
    // Being selected as a bluff may unlock a bluff-raise, but it must never
    // turn a negative-EV bluff catcher into an automatic call when raising is
    // unavailable or the mixed raise was not selected.
    if (plan.continueEdge < -0.055) return { kind: "fold" };
    if (plan.continueEdge < 0.015
      && mix > 0.28 + clamp(input.profile.looseness, 0, 1) * 0.42) {
      return { kind: "fold" };
    }
    return { kind: "call" };
  }

  const probing = input.inPosition
    && plan.strategyStrength > 0.34
    && mix < plan.probeFrequency;
  const betFrequency = plan.strong
    ? clamp(0.48 + clamp(input.profile.aggression, 0, 1) * 0.46, 0, 0.94)
    : bluffing
      ? clamp((0.34 + clamp(input.profile.aggression, 0, 1) * 0.42) * plan.multiwayBluffFactor, 0, 0.76)
      : probing ? 1 : 0;
  if (canRaise && (plan.strong || bluffing || probing) && mix < betFrequency) {
    return { kind: "raise", raiseTo };
  }
  return { kind: "check" };
}
