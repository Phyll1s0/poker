export const AI_PROFILES = {
  gto: { aggression: 0.73, looseness: 0.3, bluff: 0.13 },
  lag: { aggression: 0.94, looseness: 0.47, bluff: 0.25 },
  tag: { aggression: 0.78, looseness: 0.25, bluff: 0.08 },
  adaptive: { aggression: 0.78, looseness: 0.34, bluff: 0.18 },
  nit: { aggression: 0.5, looseness: 0.15, bluff: 0.03 },
} as const;

export type AiStyleKey = keyof typeof AI_PROFILES;

export type HeroPressureNode = "preflop_open" | "preflop_reraise" | "postflop_bet" | "postflop_raise";

export type HeroPressureStat = {
  opportunities: number;
  aggressiveActions: number;
  recentAggression: number;
  streak: number;
};

export type HeroTableImage = {
  loose: number;
  aggressive: number;
  deceptive: number;
  observations: number;
  /** Public, opportunity-based aggression reads. Missing means no evidence yet. */
  pressure?: Partial<Record<HeroPressureNode, HeroPressureStat>>;
};

export type AdaptedAiProfile = {
  aggression: number;
  looseness: number;
  bluff: number;
  confidence: number;
  pressureResponse: number;
};

export type AiImageAdaptationOptions = {
  heroActive: boolean;
  facingHero: boolean;
  intensity?: number;
  pressureNode?: HeroPressureNode;
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

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

const HERO_PRESSURE_PRIORS: Record<HeroPressureNode, { mean: number; strength: number }> = {
  preflop_open: { mean: 0.28, strength: 6 },
  preflop_reraise: { mean: 0.11, strength: 8 },
  postflop_bet: { mean: 0.42, strength: 6 },
  postflop_raise: { mean: 0.12, strength: 8 },
};

function normalizedPressureStat(image: HeroTableImage, node: HeroPressureNode): HeroPressureStat {
  const prior = HERO_PRESSURE_PRIORS[node];
  const source = image.pressure?.[node];
  return {
    opportunities: Math.max(0, Math.floor(source?.opportunities ?? 0)),
    aggressiveActions: Math.max(0, Math.floor(source?.aggressiveActions ?? 0)),
    recentAggression: clamp01(source?.recentAggression ?? prior.mean),
    streak: Math.max(0, Math.floor(source?.streak ?? 0)),
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
  if (!pressureSignal) return { ...next, pressure: image.pressure };

  const previous = normalizedPressureStat(image, pressureSignal.node);
  const recentAlpha = 0.36;
  const aggressiveValue = Number(pressureSignal.aggressive);
  const updated: HeroPressureStat = {
    opportunities: previous.opportunities + 1,
    aggressiveActions: previous.aggressiveActions + aggressiveValue,
    recentAggression: previous.recentAggression * (1 - recentAlpha) + aggressiveValue * recentAlpha,
    streak: pressureSignal.aggressive ? Math.min(12, previous.streak + 1) : 0,
  };
  return {
    ...next,
    pressure: {
      ...image.pressure,
      [pressureSignal.node]: {
        ...updated,
        recentAggression: clamp01(updated.recentAggression),
      },
    },
  };
}

export function adaptAiProfileToHeroImage(
  styleKey: AiStyleKey,
  image: HeroTableImage,
  options: AiImageAdaptationOptions,
): AdaptedAiProfile {
  const baseline = AI_PROFILES[styleKey];
  if (!options.heroActive) {
    return { ...baseline, confidence: 0, pressureResponse: 0 };
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
  const heroLooseness = clamp01(image.loose) - 0.5;
  const heroAggression = clamp01(image.aggressive) - 0.5;
  const heroTightness = 0.5 - clamp01(image.loose);
  const heroPassivity = 0.5 - clamp01(image.aggressive);
  const deceptivePressure = clamp01(image.deceptive) - 0.5;
  const aggressionDelta = options.facingHero
    ? Math.max(-0.12, Math.min(0.13, confidence * (
        heroLooseness * 0.22 + heroAggression * 0.25 - deceptivePressure * 0.035
      ) + pressureResponse * 0.08))
    : Math.max(-0.08, Math.min(0.08, confidence * (
        heroTightness * 0.14 + heroPassivity * 0.14 - deceptivePressure * 0.04
      )));
  const loosenessDelta = options.facingHero
    ? Math.max(-0.14, Math.min(0.14, confidence * (
        heroLooseness * 0.34 + heroAggression * 0.38 + deceptivePressure * 0.16
      ) + pressureResponse * 0.12))
    : Math.max(-0.05, Math.min(0.05, confidence * (
        heroTightness * 0.1 + heroPassivity * 0.035 - deceptivePressure * 0.03
      )));
  const bluffDelta = options.facingHero
    ? Math.max(-0.07, Math.min(0.07, confidence * (
        heroLooseness * 0.08 - heroAggression * 0.04 - deceptivePressure * 0.08
      ) - pressureResponse * 0.02))
    : Math.max(-0.06, Math.min(0.06, confidence * (
        heroTightness * 0.2 + heroPassivity * 0.08 - deceptivePressure * 0.1
      )));

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
