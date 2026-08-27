export const AI_PROFILES = {
  gto: { aggression: 0.73, looseness: 0.3, bluff: 0.13 },
  lag: { aggression: 0.94, looseness: 0.47, bluff: 0.25 },
  tag: { aggression: 0.78, looseness: 0.25, bluff: 0.08 },
  adaptive: { aggression: 0.78, looseness: 0.34, bluff: 0.18 },
  nit: { aggression: 0.5, looseness: 0.15, bluff: 0.03 },
} as const;

export type AiStyleKey = keyof typeof AI_PROFILES;

export type HeroPressureNode = "preflop_open" | "preflop_reraise" | "postflop_bet" | "postflop_raise";

export type HeroResponseNode =
  | "preflop_vs_open"
  | "preflop_vs_reraise"
  | "flop_vs_bet"
  | "flop_vs_raise"
  | "turn_vs_bet"
  | "turn_vs_raise"
  | "river_vs_bet"
  | "river_vs_raise";

export type HeroResponseAction = "fold" | "call" | "raise";
export type HeroResponseSize = "small" | "medium" | "large" | "jam";
export type HeroResponsePosition = "ip" | "oop";
export type HeroResponseTableShape = "heads_up" | "multiway";
export type HeroResponseDepth = "short" | "standard" | "deep";

export type HeroResponseSizingEvidence = {
  street: "preflop" | "flop" | "turn" | "river";
  bigBlind: number;
  /** Total raise-to amount on this street. */
  target: number;
  /** True for either an actual shove or a wager that puts the responder all-in. */
  isEffectiveAllIn: boolean;
  /** Postflop added risk divided by the pot after calling. */
  betFraction?: number;
};

/** Only public decision context is allowed here; hole cards never enter the key. */
export type HeroResponseContext = {
  node: HeroResponseNode;
  size: HeroResponseSize;
  position: HeroResponsePosition;
  tableShape: HeroResponseTableShape;
  depth: HeroResponseDepth;
};

export type HeroPressureStat = {
  opportunities: number;
  aggressiveActions: number;
  recentAggression: number;
  streak: number;
};

export type HeroResponseStat = {
  opportunities: number;
  folds: number;
  calls: number;
  raises: number;
  recentFold: number;
  recentCall: number;
  recentRaise: number;
};

export type HeroResponseRead = {
  fold: number;
  call: number;
  raise: number;
  confidence: number;
  /** 0 for coarse-node fallback; reaches 1 after 24 matching context samples. */
  contextSpecificity: number;
  /** Jensen-Shannon divergence from the neutral node prior, normalized to [0, 1]. */
  divergence: number;
  overfold: number;
  underfold: number;
  counterRaise: number;
};

export type HeroTableImage = {
  loose: number;
  aggressive: number;
  deceptive: number;
  observations: number;
  /** Public, opportunity-based aggression reads. Missing means no evidence yet. */
  pressure?: Partial<Record<HeroPressureNode, HeroPressureStat>>;
  /** Hierarchical public response model: generic node plus a sparse context key. */
  responses?: Record<string, HeroResponseStat>;
};

export type AdaptedAiProfile = {
  aggression: number;
  looseness: number;
  bluff: number;
  confidence: number;
  pressureResponse: number;
  responseConfidence: number;
  overfoldResponse: number;
  underfoldResponse: number;
  counterRaiseResponse: number;
  /** Evidence-weighted cap used by the action-level robust exploit overlay. */
  exploitWeight: number;
};

export type AiImageAdaptationOptions = {
  heroActive: boolean;
  facingHero: boolean;
  intensity?: number;
  pressureNode?: HeroPressureNode;
  responseContext?: HeroResponseContext;
};

export type HeroPublicRangeTendency = {
  preflopOpen: number;
  preflopReraise: number;
  postflopBet: number;
  postflopRaise: number;
  /** Publicly inferred concealment/deception; this is not a hidden-card read. */
  publicDeception: number;
};

const AI_IMAGE_SENSITIVITY: Record<AiStyleKey, number> = {
  gto: 0.55,
  lag: 0.74,
  tag: 0.68,
  adaptive: 1,
  nit: 0.46,
};

/**
 * Every archetype starts from the same balanced policy. Style expression is a
 * bounded deviation from that reference; the dynamic budget is separate and
 * only activates with matching public evidence.
 */
export const AI_STYLE_POLICY_BUDGETS: Record<AiStyleKey, {
  styleExpression: number;
  maxExploit: number;
}> = {
  gto: { styleExpression: 0, maxExploit: 0.14 },
  lag: { styleExpression: 0.7, maxExploit: 0.32 },
  tag: { styleExpression: 0.66, maxExploit: 0.24 },
  adaptive: { styleExpression: 0.38, maxExploit: 0.48 },
  nit: { styleExpression: 0.72, maxExploit: 0.17 },
};

const AI_STYLE_RESPONSE_MATRIX: Record<AiStyleKey, {
  overfold: { aggression: number; looseness: number; bluff: number };
  underfold: { aggression: number; looseness: number; bluff: number };
  counterRaise: { aggression: number; looseness: number; bluff: number };
}> = {
  // The balanced style stays closest to the reference and gives up the least
  // robustness for a population read.
  gto: {
    overfold: { aggression: 0.06, looseness: 0.035, bluff: 0.075 },
    underfold: { aggression: 0.035, looseness: 0, bluff: -0.1 },
    counterRaise: { aggression: 0.015, looseness: -0.02, bluff: -0.035 },
  },
  // LAG converts overfold evidence into pressure and retains more thin bluffs.
  lag: {
    overfold: { aggression: 0.14, looseness: 0.1, bluff: 0.17 },
    underfold: { aggression: 0.065, looseness: 0, bluff: -0.11 },
    counterRaise: { aggression: 0.04, looseness: -0.025, bluff: -0.04 },
  },
  // TAG responds to sticky ranges mainly with value aggression, not extra air.
  tag: {
    overfold: { aggression: 0.08, looseness: 0.035, bluff: 0.08 },
    underfold: { aggression: 0.09, looseness: 0, bluff: -0.18 },
    counterRaise: { aggression: 0.035, looseness: -0.04, bluff: -0.06 },
  },
  // Adaptive owns the widest evidence budget and changes both frequency and
  // composition while remaining inside the action-level trust region.
  adaptive: {
    overfold: { aggression: 0.12, looseness: 0.08, bluff: 0.16 },
    underfold: { aggression: 0.09, looseness: 0.015, bluff: -0.2 },
    counterRaise: { aggression: 0.05, looseness: -0.05, bluff: -0.07 },
  },
  // NIT will defend against obvious attacks but preserves its narrow identity.
  nit: {
    overfold: { aggression: 0.08, looseness: 0.04, bluff: 0.11 },
    underfold: { aggression: 0.055, looseness: -0.01, bluff: -0.16 },
    counterRaise: { aggression: 0.02, looseness: -0.055, bluff: -0.08 },
  },
};

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

const HERO_PRESSURE_PRIORS: Record<HeroPressureNode, { mean: number; strength: number }> = {
  preflop_open: { mean: 0.28, strength: 6 },
  preflop_reraise: { mean: 0.11, strength: 8 },
  postflop_bet: { mean: 0.42, strength: 6 },
  postflop_raise: { mean: 0.12, strength: 8 },
};

const HERO_PRESSURE_EFFECTIVE_SAMPLE_CAP = 96;
const HERO_RESPONSE_GENERIC_EFFECTIVE_SAMPLE_CAP = 120;
const HERO_RESPONSE_CONTEXT_EFFECTIVE_SAMPLE_CAP = 72;

type HeroResponsePrior = {
  fold: number;
  call: number;
  raise: number;
  strength: number;
};

// These are deliberately neutral engineering priors, not claimed solver
// outputs. Bayesian shrinkage prevents a two-hand streak from becoming a
// brittle best response while still allowing repeated, matching evidence to
// move every computer style.
const HERO_RESPONSE_PRIORS: Record<HeroResponseNode, HeroResponsePrior> = {
  preflop_vs_open: { fold: 0.5, call: 0.35, raise: 0.15, strength: 10 },
  preflop_vs_reraise: { fold: 0.5, call: 0.39, raise: 0.11, strength: 12 },
  flop_vs_bet: { fold: 0.38, call: 0.48, raise: 0.14, strength: 10 },
  flop_vs_raise: { fold: 0.5, call: 0.42, raise: 0.08, strength: 12 },
  turn_vs_bet: { fold: 0.42, call: 0.49, raise: 0.09, strength: 11 },
  turn_vs_raise: { fold: 0.54, call: 0.4, raise: 0.06, strength: 13 },
  river_vs_bet: { fold: 0.48, call: 0.47, raise: 0.05, strength: 12 },
  river_vs_raise: { fold: 0.62, call: 0.35, raise: 0.03, strength: 14 },
};

function normalizedPressureStat(image: HeroTableImage, node: HeroPressureNode): HeroPressureStat {
  const prior = HERO_PRESSURE_PRIORS[node];
  const source = image.pressure?.[node];
  return {
    opportunities: Math.max(0, Number.isFinite(source?.opportunities) ? source!.opportunities : 0),
    aggressiveActions: Math.max(0, Number.isFinite(source?.aggressiveActions) ? source!.aggressiveActions : 0),
    recentAggression: clamp01(source?.recentAggression ?? prior.mean),
    streak: Math.max(0, Math.floor(source?.streak ?? 0)),
  };
}

/**
 * Converts a public wager into the response-model size bucket. `jam` is
 * reserved for an actual/effective all-in; a large non-all-in overbet stays
 * `large`, so short-stack shoves and deep overbets cannot contaminate each
 * other's evidence.
 */
export function classifyHeroResponseSize(
  evidence: HeroResponseSizingEvidence,
): HeroResponseSize {
  if (evidence.isEffectiveAllIn) return "jam";
  if (evidence.street === "preflop") {
    const targetBb = Math.max(0, evidence.target) / Math.max(1, evidence.bigBlind);
    if (targetBb <= 3) return "small";
    if (targetBb <= 9) return "medium";
    return "large";
  }
  const fraction = Math.max(0, evidence.betFraction ?? 1);
  if (fraction <= 0.4) return "small";
  if (fraction <= 0.8) return "medium";
  return "large";
}

/** Mirrors pokerRaiseFraction using only one recorded public action. */
export function publicAggressiveActionBetFraction(
  action: Pick<{ amount: number; toCall: number; potBefore: number }, "amount" | "toCall" | "potBefore">,
) {
  const addedRisk = Math.max(0, action.amount - Math.max(0, action.toCall));
  const potAfterCall = Math.max(1, action.potBefore + Math.max(0, action.toCall));
  return addedRisk / potAfterCall;
}

function responseContextKey(context: HeroResponseContext) {
  return [
    context.node,
    context.size,
    context.position,
    context.tableShape,
    context.depth,
  ].join("|");
}

function normalizedResponseStat(
  source: HeroResponseStat | undefined,
  prior: HeroResponsePrior,
): HeroResponseStat {
  const finiteCount = (value: number | undefined) => (
    Number.isFinite(value) ? Math.max(0, value!) : 0
  );
  const folds = finiteCount(source?.folds);
  const calls = finiteCount(source?.calls);
  const raises = finiteCount(source?.raises);
  // The three action counts are the canonical effective sample. Trusting a
  // stale independent opportunity counter could make the posterior sum < 1.
  const opportunities = folds + calls + raises;
  const recentTotal = Math.max(
    Number.EPSILON,
    clamp01(source?.recentFold ?? prior.fold)
      + clamp01(source?.recentCall ?? prior.call)
      + clamp01(source?.recentRaise ?? prior.raise),
  );
  return {
    opportunities,
    folds,
    calls,
    raises,
    recentFold: clamp01(source?.recentFold ?? prior.fold) / recentTotal,
    recentCall: clamp01(source?.recentCall ?? prior.call) / recentTotal,
    recentRaise: clamp01(source?.recentRaise ?? prior.raise) / recentTotal,
  };
}

function responseDistribution(
  stat: HeroResponseStat,
  prior: HeroResponsePrior,
  options: {
    priorScale: number;
    recentMaximum: number;
    recentDenominator: number;
    confidenceDenominator: number;
  },
) {
  const priorStrength = prior.strength * options.priorScale;
  const total = stat.opportunities + priorStrength;
  const posterior = {
    fold: (stat.folds + prior.fold * priorStrength) / total,
    call: (stat.calls + prior.call * priorStrength) / total,
    raise: (stat.raises + prior.raise * priorStrength) / total,
  };
  const recencyWeight = options.recentMaximum * stat.opportunities
    / (stat.opportunities + options.recentDenominator);
  return {
    fold: posterior.fold * (1 - recencyWeight) + stat.recentFold * recencyWeight,
    call: posterior.call * (1 - recencyWeight) + stat.recentCall * recencyWeight,
    raise: posterior.raise * (1 - recencyWeight) + stat.recentRaise * recencyWeight,
    confidence: stat.opportunities / (stat.opportunities + options.confidenceDenominator),
  };
}

function klTerm(left: number, right: number) {
  return left <= 0 ? 0 : left * Math.log(left / Math.max(Number.EPSILON, right));
}

function responseDivergence(
  distribution: Pick<HeroResponseRead, "fold" | "call" | "raise">,
  prior: HeroResponsePrior,
) {
  const midpoint = {
    fold: (distribution.fold + prior.fold) / 2,
    call: (distribution.call + prior.call) / 2,
    raise: (distribution.raise + prior.raise) / 2,
  };
  const left = klTerm(distribution.fold, midpoint.fold)
    + klTerm(distribution.call, midpoint.call)
    + klTerm(distribution.raise, midpoint.raise);
  const right = klTerm(prior.fold, midpoint.fold)
    + klTerm(prior.call, midpoint.call)
    + klTerm(prior.raise, midpoint.raise);
  return clamp01((left + right) / (2 * Math.log(2)));
}

/**
 * Empirical partial-pooling estimate of how the hero responds to pressure.
 * Generic and contextual views use the same neutral prior independently, then
 * combine through a convex blend. This avoids counting one public action twice
 * while retaining Dirichlet-style shrinkage and a faster EWMA regime signal.
 */
export function heroResponseRead(
  image: HeroTableImage,
  context: HeroResponseContext,
): HeroResponseRead {
  const prior = HERO_RESPONSE_PRIORS[context.node];
  const generic = responseDistribution(
    normalizedResponseStat(image.responses?.[context.node], prior),
    prior,
    {
      priorScale: 1,
      recentMaximum: 0.3,
      recentDenominator: 8,
      confidenceDenominator: 12,
    },
  );
  const contextualKey = responseContextKey(context);
  const contextualStat = normalizedResponseStat(image.responses?.[contextualKey], prior);
  const contextual = responseDistribution(contextualStat, prior, {
    priorScale: 0.85,
    recentMaximum: 0.38,
    recentDenominator: 18,
    confidenceDenominator: 30,
  });
  const contextualBlend = contextualStat.opportunities / (contextualStat.opportunities + 18);
  const distribution = {
    fold: generic.fold * (1 - contextualBlend) + contextual.fold * contextualBlend,
    call: generic.call * (1 - contextualBlend) + contextual.call * contextualBlend,
    raise: generic.raise * (1 - contextualBlend) + contextual.raise * contextualBlend,
  };
  const total = distribution.fold + distribution.call + distribution.raise;
  const normalized = {
    fold: distribution.fold / Math.max(Number.EPSILON, total),
    call: distribution.call / Math.max(Number.EPSILON, total),
    raise: distribution.raise / Math.max(Number.EPSILON, total),
  };
  // Generic and contextual counters are two views of the same actions, not
  // independent samples. Reusing them as independent confidence would count
  // every observation twice; context changes the distribution, while the
  // coarse-node opportunity count remains the confidence ceiling.
  const confidence = clamp01(generic.confidence);
  return {
    ...normalized,
    confidence,
    contextSpecificity: clamp01(contextualStat.opportunities / 24),
    divergence: responseDivergence(normalized, prior),
    overfold: clamp01(Math.max(0, normalized.fold - prior.fold) / Math.max(0.01, 1 - prior.fold)),
    underfold: clamp01(Math.max(0, prior.fold - normalized.fold) / Math.max(0.01, prior.fold)),
    counterRaise: clamp01(Math.max(0, normalized.raise - prior.raise) / Math.max(0.01, 1 - prior.raise)),
  };
}

/**
 * Returns only evidence that the hero is attacking more than the node prior.
 * A fast recent window and a short streak make repeated pressure visible early,
 * while the opportunity denominator prevents one isolated raise from rewriting
 * the whole table image.
 */
export function heroNodePressure(image: HeroTableImage, node: HeroPressureNode) {
  const prior = HERO_PRESSURE_PRIORS[node];
  const stat = normalizedPressureStat(image, node);
  const posterior = (stat.aggressiveActions + prior.mean * prior.strength)
    / Math.max(1, stat.opportunities + prior.strength);
  const posteriorExcess = Math.max(0, (posterior - prior.mean) / Math.max(0.01, 1 - prior.mean));
  const recentExcess = Math.max(
    0,
    (stat.recentAggression - prior.mean) / Math.max(0.01, 1 - prior.mean),
  );
  const opportunityConfidence = stat.opportunities / (stat.opportunities + 4);
  const streakPressure = Math.min(1, stat.streak / 4) * 0.18;
  return clamp01((posteriorExcess * 0.5 + recentExcess * 0.32) * opportunityConfidence + streakPressure);
}

export function heroPublicRangeTendency(image: HeroTableImage): HeroPublicRangeTendency {
  const publicDeception = Math.max(0, (clamp01(image.deceptive) - 0.5) * 2)
    * heroImageConfidence(image);
  return {
    preflopOpen: heroNodePressure(image, "preflop_open"),
    preflopReraise: heroNodePressure(image, "preflop_reraise"),
    postflopBet: heroNodePressure(image, "postflop_bet"),
    postflopRaise: heroNodePressure(image, "postflop_raise"),
    publicDeception: clamp01(publicDeception),
  };
}

export function heroImageConfidence(image: HeroTableImage) {
  const observations = Number.isFinite(image.observations) ? Math.max(0, image.observations) : 0;
  return observations / (observations + 24);
}

export function updateHeroTableImage(
  image: HeroTableImage,
  signals: Partial<Pick<HeroTableImage, "loose" | "aggressive" | "deceptive">>,
  pressureSignal?: { node: HeroPressureNode; aggressive: boolean },
  responseSignal?: { context: HeroResponseContext; action: HeroResponseAction },
): HeroTableImage {
  // Early observations move the read quickly; a mature image still adapts,
  // but one short streak can no longer rewrite thousands of prior actions.
  const alpha = Math.max(0.035, 0.18 / (1 + Math.max(0, image.observations) / 18));
  const blend = (current: number, signal: number | undefined) => signal === undefined
    ? current
    : clamp01(current * (1 - alpha) + clamp01(signal) * alpha);
  const next: HeroTableImage = {
    loose: blend(image.loose, signals.loose),
    aggressive: blend(image.aggressive, signals.aggressive),
    deceptive: blend(image.deceptive, signals.deceptive),
    observations: image.observations + 1,
  };
  let pressure = image.pressure;
  if (pressureSignal) {
    const previous = normalizedPressureStat(image, pressureSignal.node);
    const lifetimeScale = previous.opportunities >= HERO_PRESSURE_EFFECTIVE_SAMPLE_CAP
      ? (HERO_PRESSURE_EFFECTIVE_SAMPLE_CAP - 1) / previous.opportunities
      : 1;
    // A slower public-action trace cannot be erased by one tactical pause.
    const recentAlpha = 0.2;
    const aggressiveValue = Number(pressureSignal.aggressive);
    const updated: HeroPressureStat = {
      opportunities: previous.opportunities * lifetimeScale + 1,
      aggressiveActions: previous.aggressiveActions * lifetimeScale + aggressiveValue,
      recentAggression: previous.recentAggression * (1 - recentAlpha) + aggressiveValue * recentAlpha,
      streak: pressureSignal.aggressive
        ? Math.min(12, previous.streak + 1)
        : Math.max(0, previous.streak - 1),
    };
    pressure = {
      ...image.pressure,
      [pressureSignal.node]: {
        ...updated,
        recentAggression: clamp01(updated.recentAggression),
      },
    };
  }

  let responses = image.responses;
  if (responseSignal) {
    const prior = HERO_RESPONSE_PRIORS[responseSignal.context.node];
    const updateStat = (key: string, contextual: boolean) => {
      const previous = normalizedResponseStat(image.responses?.[key], prior);
      const cap = contextual
        ? HERO_RESPONSE_CONTEXT_EFFECTIVE_SAMPLE_CAP
        : HERO_RESPONSE_GENERIC_EFFECTIVE_SAMPLE_CAP;
      const lifetimeScale = previous.opportunities >= cap
        ? (cap - 1) / previous.opportunities
        : 1;
      const recentAlpha = contextual ? 0.16 : 0.11;
      const isFold = Number(responseSignal.action === "fold");
      const isCall = Number(responseSignal.action === "call");
      const isRaise = Number(responseSignal.action === "raise");
      return {
        opportunities: previous.opportunities * lifetimeScale + 1,
        folds: previous.folds * lifetimeScale + isFold,
        calls: previous.calls * lifetimeScale + isCall,
        raises: previous.raises * lifetimeScale + isRaise,
        recentFold: previous.recentFold * (1 - recentAlpha) + isFold * recentAlpha,
        recentCall: previous.recentCall * (1 - recentAlpha) + isCall * recentAlpha,
        recentRaise: previous.recentRaise * (1 - recentAlpha) + isRaise * recentAlpha,
      } satisfies HeroResponseStat;
    };
    const contextualKey = responseContextKey(responseSignal.context);
    responses = {
      ...image.responses,
      [responseSignal.context.node]: updateStat(responseSignal.context.node, false),
      [contextualKey]: updateStat(contextualKey, true),
    };
  }

  return { ...next, pressure, responses };
}

export function heroPublicActionSignals(action: "fold" | "check" | "call" | "raise") {
  return {
    loose: action === "fold" ? 0.18 : action === "check" ? 0.4 : action === "call" ? 0.68 : 0.78,
    aggressive: action === "raise" ? 0.9 : action === "fold" ? 0.34 : 0.24,
  };
}

export function adaptAiProfileToHeroImage(
  styleKey: AiStyleKey,
  image: HeroTableImage,
  options: AiImageAdaptationOptions,
): AdaptedAiProfile {
  const baseline = AI_PROFILES[styleKey];
  if (!options.heroActive) {
    return {
      ...baseline,
      confidence: 0,
      pressureResponse: 0,
      responseConfidence: 0,
      overfoldResponse: 0,
      underfoldResponse: 0,
      counterRaiseResponse: 0,
      exploitWeight: 0,
    };
  }

  const requestedIntensity = options.intensity ?? 1;
  const intensity = Number.isFinite(requestedIntensity)
    ? Math.max(0, Math.min(1.6, requestedIntensity))
    : 0;
  const confidence = clamp01(heroImageConfidence(image) * AI_IMAGE_SENSITIVITY[styleKey] * intensity);
  const nodePressure = options.facingHero && options.pressureNode
    ? heroNodePressure(image, options.pressureNode)
    : 0;
  const pressureResponse = clamp01(nodePressure * AI_IMAGE_SENSITIVITY[styleKey] * intensity);
  const response = options.responseContext
    ? heroResponseRead(image, options.responseContext)
    : null;
  const responseScale = AI_IMAGE_SENSITIVITY[styleKey] * intensity;
  const responseConfidence = response
    ? clamp01(response.confidence * responseScale)
    : 0;
  const overfoldResponse = response
    ? clamp01(response.overfold * responseConfidence)
    : 0;
  const underfoldResponse = response
    ? clamp01(response.underfold * responseConfidence)
    : 0;
  const counterRaiseResponse = response
    ? clamp01(response.counterRaise * responseConfidence)
    : 0;
  const responseMatrix = AI_STYLE_RESPONSE_MATRIX[styleKey];
  const heroLooseness = clamp01(image.loose) - 0.5;
  const heroAggression = clamp01(image.aggressive) - 0.5;
  const heroTightness = 0.5 - clamp01(image.loose);
  const heroPassivity = 0.5 - clamp01(image.aggressive);
  const deceptivePressure = clamp01(image.deceptive) - 0.5;
  const aggressionDelta = (options.facingHero
    ? Math.max(-0.12, Math.min(0.13, confidence * (
        heroLooseness * 0.22 + heroAggression * 0.25 - deceptivePressure * 0.035
      ) + pressureResponse * 0.08))
    : Math.max(-0.08, Math.min(0.08, confidence * (
        heroTightness * 0.14 + heroPassivity * 0.14 - deceptivePressure * 0.04
      ))))
    + overfoldResponse * responseMatrix.overfold.aggression
    + underfoldResponse * responseMatrix.underfold.aggression
    + counterRaiseResponse * responseMatrix.counterRaise.aggression;
  const loosenessDelta = (options.facingHero
    ? Math.max(-0.14, Math.min(0.14, confidence * (
        heroLooseness * 0.34 + heroAggression * 0.38 + deceptivePressure * 0.16
      ) + pressureResponse * 0.12))
    : Math.max(-0.05, Math.min(0.05, confidence * (
        heroTightness * 0.1 + heroPassivity * 0.035 - deceptivePressure * 0.03
      ))))
    + overfoldResponse * responseMatrix.overfold.looseness
    + underfoldResponse * responseMatrix.underfold.looseness
    + counterRaiseResponse * responseMatrix.counterRaise.looseness;
  const bluffDelta = (options.facingHero
    ? Math.max(-0.07, Math.min(0.07, confidence * (
        heroLooseness * 0.08 - heroAggression * 0.04 - deceptivePressure * 0.08
      ) - pressureResponse * 0.02))
    : Math.max(-0.06, Math.min(0.06, confidence * (
        heroTightness * 0.2 + heroPassivity * 0.08 - deceptivePressure * 0.1
      ))))
    + overfoldResponse * responseMatrix.overfold.bluff
    + underfoldResponse * responseMatrix.underfold.bluff
    + counterRaiseResponse * responseMatrix.counterRaise.bluff;
  const globalDeviation = clamp01((
    Math.abs(heroLooseness) + Math.abs(heroAggression) + Math.abs(deceptivePressure)
  ) / 1.5 * 2);
  const responseEvidence = response
    ? responseConfidence
      * clamp01(response.divergence / 0.12)
      * (0.25 + 0.75 * response.contextSpecificity)
    : 0;
  // Coarse public style remains a small cross-node prior. Most exploit budget
  // is unlocked only by the matching pressure/response node.
  const globalPriorSignal = 0.12 * confidence * globalDeviation;
  const exploitSignal = Math.max(
    globalPriorSignal,
    pressureResponse,
    responseEvidence,
  );
  const exploitWeight = Math.min(
    AI_STYLE_POLICY_BUDGETS[styleKey].maxExploit,
    AI_STYLE_POLICY_BUDGETS[styleKey].maxExploit * exploitSignal,
  );

  return {
    // Tight/passive opponents are pressured more. When the hero is the latest
    // aggressor, loose/aggressive reads instead widen defense and value raises;
    // this prevents repeated auto-raises from making every opponent tighter.
    // Deltas stay bounded so each computer retains its base archetype.
    aggression: clamp01(baseline.aggression + aggressionDelta),
    looseness: clamp01(baseline.looseness + loosenessDelta),
    bluff: clamp01(baseline.bluff + bluffDelta),
    confidence,
    pressureResponse,
    responseConfidence,
    overfoldResponse,
    underfoldResponse,
    counterRaiseResponse,
    exploitWeight,
  };
}

export const AI_STYLE_OPTIONS: { style: string; styleKey: AiStyleKey }[] = [
  { style: "GTO 平衡", styleKey: "gto" },
  { style: "松凶压迫", styleKey: "lag" },
  { style: "紧凶价值", styleKey: "tag" },
  { style: "动态适应", styleKey: "adaptive" },
  { style: "稳健保守", styleKey: "nit" },
];

const AI_STYLE_WEIGHTS: Record<AiStyleKey, number> = {
  gto: 0.26,
  lag: 0.24,
  tag: 0.2,
  adaptive: 0.24,
  nit: 0.06,
};

export function sampleAiStyle(random = Math.random) {
  const roll = clamp01(random());
  let cumulative = 0;
  for (const option of AI_STYLE_OPTIONS) {
    cumulative += AI_STYLE_WEIGHTS[option.styleKey];
    if (roll < cumulative) return { ...option };
  }
  return { ...AI_STYLE_OPTIONS[AI_STYLE_OPTIONS.length - 1] };
}

export function sampleAiLineup(count: number, random = Math.random) {
  return Array.from({ length: count }, () => sampleAiStyle(random));
}
