export type PokerPolicyActionKind = "fold" | "check" | "call" | "raise";
export type PokerPolicyStreet = "preflop" | "flop" | "turn" | "river";

export type PokerPolicyProfile = {
  aggression: number;
  looseness: number;
  bluff: number;
};

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
};

export type PokerPolicyRng = () => number;

// Seat offsets from the dealer in a six-max game:
// BTN, SB, BB, UTG, HJ, CO. Blinds defend wider, while early position opens
// tighter. Keeping this here prevents the UI and the headless arena drifting.
const SIX_MAX_PREFLOP_POSITION_FACTORS = [1.28, 0.9, 1.35, 0.72, 0.86, 1.06] as const;

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
    preflopPositionFactor: clamp(rawInput.preflopPositionFactor ?? 1, 0.5, 1.5),
    preflopRaiseCount: Math.max(0, Math.floor(nonNegative(rawInput.preflopRaiseCount ?? 0))),
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
  const positionBonus = input.inPosition ? 0.012 : 0;
  const baseStrength = input.street === "preflop"
    ? input.equity * 0.35 + input.handStrength * 0.65
    : input.equity * 0.72 + input.handStrength * 0.28;
  const strategyStrength = clamp(baseStrength + positionBonus + input.squidPressure, 0.02, 0.98);
  const facingRaiseBase = input.preflopRaiseCount === 0
    ? 1
    : (0.56 + input.profile.aggression * 0.2) * Math.pow(0.54, Math.max(0, input.preflopRaiseCount - 1));
  // A raise count alone cannot distinguish a 2.5 BB open from a 100 BB jam.
  // Tighten the continuing range as the call consumes more of the effective
  // stack and as the offered price worsens. First-in opening ranges remain
  // driven only by profile and position.
  const preflopPressureFactor = input.preflopRaiseCount === 0
    ? 1
    : clamp(1 - Math.pow(pressure, 0.65) * 0.74, 0.18, 1);
  const preflopPriceFactor = input.preflopRaiseCount === 0
    ? 1
    : clamp(1 + (0.28 - input.potOdds) * 1.3, 0.42, 1.12);
  const facingRaiseFactor = facingRaiseBase * preflopPressureFactor * preflopPriceFactor;
  const preflopTargetRange = clamp(
    input.profile.looseness * input.preflopPositionFactor * facingRaiseFactor,
    0.045,
    0.58,
  );
  const preflopEnterFrequency = clamp(
    sigmoid((input.preflopPercentile - (1 - preflopTargetRange)) * 34),
    0.005,
    0.995,
  );
  const premiumFactor = clamp((input.preflopPercentile - 0.86) / 0.14, 0, 1);
  const blockerBluffFactor = clamp(input.blockers / 0.12, 0, 1);
  const preflopOpenRaiseFrequency = input.toCall > 0
    ? 1
    : clamp(0.78 + input.profile.aggression * 0.18 + premiumFactor * 0.04, 0.76, 0.98);
  const preflopThreeBetFrequency = clamp(
    premiumFactor * (0.2 + input.profile.aggression * 0.52)
      + blockerBluffFactor * input.profile.bluff * 0.14,
    0.015,
    input.preflopRaiseCount > 1 ? 0.76 : 0.68,
  );
  const preflopRaiseFrequency = input.preflopRaiseCount === 0
    ? preflopOpenRaiseFrequency
    : preflopThreeBetFrequency;

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
  if (input.street === "preflop" && input.preflopRaiseCount === 0) {
    desiredTarget = Math.max(
      input.highestBet + input.minRaise,
      bigBlind * (2.35 + input.profile.aggression * 0.4),
    );
    intendedBetFraction = Math.max(0, desiredTarget - input.highestBet) / Math.max(1, sizingPot);
  } else {
    if (input.street === "preflop") intendedBetFraction = 0.62 + input.profile.aggression * 0.28;
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
  const preflopJamEligible = input.street === "preflop"
    && (input.effectiveStackBb <= 18 || (input.preflopRaiseCount >= 2 && input.effectiveStackBb <= 45));
  const postflopJamEligible = input.street !== "preflop" && input.effectiveStackBb <= 45 && spr <= 4.5;
  const shortStackJamFrequency = strong && (preflopJamEligible || postflopJamEligible)
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
    preflopTargetRange,
    preflopEnterFrequency,
    preflopOpenRaiseFrequency,
    preflopThreeBetFrequency,
    preflopRaiseFrequency,
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
    if (bluffRoll >= plan.preflopEnterFrequency) return input.toCall > 0 ? { kind: "fold" } : { kind: "check" };
    if (canRaise && jamRoll < plan.preflopRaiseFrequency) return { kind: "raise", raiseTo };
    return input.toCall > 0 ? { kind: "call" } : { kind: "check" };
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
