export const AI_PROFILES = {
  gto: { aggression: 0.73, looseness: 0.3, bluff: 0.13 },
  lag: { aggression: 0.94, looseness: 0.47, bluff: 0.25 },
  tag: { aggression: 0.78, looseness: 0.25, bluff: 0.08 },
  adaptive: { aggression: 0.78, looseness: 0.34, bluff: 0.18 },
  nit: { aggression: 0.5, looseness: 0.15, bluff: 0.03 },
} as const;

export type AiStyleKey = keyof typeof AI_PROFILES;

export type HeroTableImage = {
  loose: number;
  aggressive: number;
  deceptive: number;
  observations: number;
};

export type AdaptedAiProfile = {
  aggression: number;
  looseness: number;
  bluff: number;
  confidence: number;
  equityAdjustment: number;
};

export type AiImageAdaptationOptions = {
  heroActive: boolean;
  facingHero: boolean;
  intensity?: number;
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

export function heroImageConfidence(image: HeroTableImage) {
  const observations = Number.isFinite(image.observations) ? Math.max(0, image.observations) : 0;
  return observations / (observations + 24);
}

export function updateHeroTableImage(
  image: HeroTableImage,
  signals: Partial<Pick<HeroTableImage, "loose" | "aggressive" | "deceptive">>,
): HeroTableImage {
  // Early observations move the read quickly; a mature image still adapts,
  // but one short streak can no longer rewrite thousands of prior actions.
  const alpha = Math.max(0.035, 0.18 / (1 + Math.max(0, image.observations) / 18));
  const blend = (current: number, signal: number | undefined) => signal === undefined
    ? current
    : clamp01(current * (1 - alpha) + clamp01(signal) * alpha);
  return {
    loose: blend(image.loose, signals.loose),
    aggressive: blend(image.aggressive, signals.aggressive),
    deceptive: blend(image.deceptive, signals.deceptive),
    observations: image.observations + 1,
  };
}

export function adaptAiProfileToHeroImage(
  styleKey: AiStyleKey,
  image: HeroTableImage,
  options: AiImageAdaptationOptions,
): AdaptedAiProfile {
  const baseline = AI_PROFILES[styleKey];
  if (!options.heroActive) return { ...baseline, confidence: 0, equityAdjustment: 0 };

  const requestedIntensity = options.intensity ?? 1;
  const intensity = Number.isFinite(requestedIntensity)
    ? Math.max(0, Math.min(1.6, requestedIntensity))
    : 0;
  const confidence = clamp01(heroImageConfidence(image) * AI_IMAGE_SENSITIVITY[styleKey] * intensity);
  const heroLooseness = clamp01(image.loose) - 0.5;
  const heroAggression = clamp01(image.aggressive) - 0.5;
  const heroTightness = 0.5 - clamp01(image.loose);
  const heroPassivity = 0.5 - clamp01(image.aggressive);
  const deceptivePressure = clamp01(image.deceptive) - 0.5;
  const equityAdjustment = options.facingHero
    ? Math.max(-0.07, Math.min(0.075, confidence * (
        heroLooseness * 0.1
        + heroAggression * 0.12
        + deceptivePressure * 0.02
      )))
    : 0;
  const aggressionDelta = options.facingHero
    ? Math.max(-0.12, Math.min(0.13, confidence * (
        heroLooseness * 0.22 + heroAggression * 0.25 - deceptivePressure * 0.035
      )))
    : Math.max(-0.08, Math.min(0.08, confidence * (
        heroTightness * 0.14 + heroPassivity * 0.14 - deceptivePressure * 0.04
      )));
  const loosenessDelta = options.facingHero
    ? Math.max(-0.14, Math.min(0.14, confidence * (
        heroLooseness * 0.34 + heroAggression * 0.38 - deceptivePressure * 0.02
      )))
    : Math.max(-0.05, Math.min(0.05, confidence * (
        heroTightness * 0.1 + heroPassivity * 0.035 - deceptivePressure * 0.03
      )));
  const bluffDelta = options.facingHero
    ? Math.max(-0.07, Math.min(0.07, confidence * (
        heroLooseness * 0.08 - heroAggression * 0.04 - deceptivePressure * 0.08
      )))
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
    equityAdjustment,
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
