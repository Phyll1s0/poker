import {
  AI_PROFILES,
  AI_STYLE_POLICY_BUDGETS,
  type AdaptedAiProfile,
  type AiStyleKey,
} from "./poker-ai.ts";
import {
  evaluatePokerPolicy,
  type PokerPolicyAction,
  type PokerPolicyActionFrequencies,
  type PokerPolicyActionKind,
  type PokerPolicyInput,
  type PokerPolicyPlan,
  type PokerPolicyProfile,
  type PokerPolicyRng,
} from "./poker-policy.ts";
import type { PokerSizingRoute } from "./poker-sizing.ts";

export type AdaptivePokerPolicyOptions = {
  styleKey: AiStyleKey;
  adaptedProfile: AdaptedAiProfile;
};

export type AdaptivePokerPolicyPlan = {
  /** Balanced local reference before any persona or opponent-specific overlay. */
  gtoReference: PokerPolicyPlan;
  /** The archetype's unconstrained policy, retained for audit and replay. */
  styleReference: PokerPolicyPlan;
  /** Policy generated from the public opponent model. */
  exploitReference: PokerPolicyPlan;
  /** GTO/style mixture before opponent-specific exploitation. */
  baselineActionFrequencies: PokerPolicyActionFrequencies;
  actionFrequencies: PokerPolicyActionFrequencies;
  sizingRoutes: PokerSizingRoute[];
  raiseTo: number;
  styleExpressionWeight: number;
  exploitWeight: number;
  totalVariationFromGto: number;
  totalVariationFromStyleBaseline: number;
  source: "local-gto-anchor+bounded-public-exploit";
};

const ACTION_KINDS: readonly PokerPolicyActionKind[] = ["fold", "check", "call", "raise"];

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function unitRandom(random: PokerPolicyRng) {
  return Math.min(1 - Number.EPSILON, clamp01(random()));
}

function policyInputWithProfile(input: PokerPolicyInput, profile: PokerPolicyProfile): PokerPolicyInput {
  return { ...input, profile };
}

function normalizeActionFrequencies(frequencies: PokerPolicyActionFrequencies) {
  const total = ACTION_KINDS.reduce((sum, kind) => sum + Math.max(0, frequencies[kind]), 0);
  if (total <= Number.EPSILON) {
    return { fold: 0, check: 1, call: 0, raise: 0 } satisfies PokerPolicyActionFrequencies;
  }
  return Object.fromEntries(ACTION_KINDS.map((kind) => [
    kind,
    Math.max(0, frequencies[kind]) / total,
  ])) as PokerPolicyActionFrequencies;
}

function mixActionFrequencies(
  left: PokerPolicyActionFrequencies,
  right: PokerPolicyActionFrequencies,
  rightWeight: number,
) {
  const weight = clamp01(rightWeight);
  return normalizeActionFrequencies(Object.fromEntries(ACTION_KINDS.map((kind) => [
    kind,
    left[kind] * (1 - weight) + right[kind] * weight,
  ])) as PokerPolicyActionFrequencies);
}

export function pokerPolicyTotalVariation(
  left: PokerPolicyActionFrequencies,
  right: PokerPolicyActionFrequencies,
) {
  return 0.5 * ACTION_KINDS.reduce((sum, kind) => sum + Math.abs(left[kind] - right[kind]), 0);
}

function weightedSizingRoutes(
  plans: readonly { plan: PokerPolicyPlan; weight: number }[],
): PokerSizingRoute[] {
  const byTarget = new Map<number, {
    mass: number;
    fractionMass: number;
    allInMass: number;
  }>();
  for (const { plan, weight } of plans) {
    const sourceWeight = Math.max(0, weight) * Math.max(0, plan.actionFrequencies.raise);
    if (sourceWeight <= 0) continue;
    const routes = plan.sizingRoutes.length
      ? plan.sizingRoutes
      : [{ target: plan.raiseTo, fraction: plan.betFraction, frequency: 1, allIn: plan.raiseTo === plan.maxTarget }];
    for (const route of routes) {
      const mass = sourceWeight * Math.max(0, route.frequency);
      if (mass <= 0) continue;
      const previous = byTarget.get(route.target) ?? { mass: 0, fractionMass: 0, allInMass: 0 };
      previous.mass += mass;
      previous.fractionMass += mass * route.fraction;
      previous.allInMass += route.allIn ? mass : 0;
      byTarget.set(route.target, previous);
    }
  }
  const total = [...byTarget.values()].reduce((sum, route) => sum + route.mass, 0);
  if (total <= Number.EPSILON) return [];
  return [...byTarget.entries()]
    .map(([target, route]) => ({
      target,
      fraction: route.fractionMass / route.mass,
      frequency: route.mass / total,
      allIn: route.allInMass >= route.mass - Number.EPSILON,
    }))
    .sort((left, right) => left.target - right.target);
}

/**
 * Builds one auditable decision in three stages:
 * balanced local reference -> bounded style -> evidence-capped exploit overlay.
 *
 * This is inspired by robust-response research, but it deliberately does not
 * claim an RNR/epsilon-safety theorem: the live six-max baseline is an
 * approximation and the final mixture is a transparent engineering trust
 * region. Its useful local guarantee is exact: action TV from the pre-exploit
 * baseline cannot exceed `exploitWeight`.
 */
export function evaluateAdaptivePokerPolicy(
  input: PokerPolicyInput,
  options: AdaptivePokerPolicyOptions,
): AdaptivePokerPolicyPlan {
  const budget = AI_STYLE_POLICY_BUDGETS[options.styleKey];
  const styleExpressionWeight = clamp01(budget.styleExpression);
  const exploitWeight = Math.min(budget.maxExploit, clamp01(options.adaptedProfile.exploitWeight));
  const gtoReference = evaluatePokerPolicy(policyInputWithProfile(input, AI_PROFILES.gto));
  const styleReference = evaluatePokerPolicy(policyInputWithProfile(input, AI_PROFILES[options.styleKey]));
  const exploitProfile: PokerPolicyProfile = {
    aggression: options.adaptedProfile.aggression,
    looseness: options.adaptedProfile.looseness,
    bluff: options.adaptedProfile.bluff,
  };
  const exploitReference = evaluatePokerPolicy(policyInputWithProfile(input, exploitProfile));
  const baselineActionFrequencies = mixActionFrequencies(
    gtoReference.actionFrequencies,
    styleReference.actionFrequencies,
    styleExpressionWeight,
  );
  const actionFrequencies = mixActionFrequencies(
    baselineActionFrequencies,
    exploitReference.actionFrequencies,
    exploitWeight,
  );
  const sourcePlans = [
    {
      plan: gtoReference,
      weight: (1 - exploitWeight) * (1 - styleExpressionWeight),
    },
    {
      plan: styleReference,
      weight: (1 - exploitWeight) * styleExpressionWeight,
    },
    { plan: exploitReference, weight: exploitWeight },
  ];
  const sizingRoutes = weightedSizingRoutes(sourcePlans);
  const preferredRoute = sizingRoutes.reduce<PokerSizingRoute | undefined>(
    (preferred, route) => !preferred || route.frequency > preferred.frequency ? route : preferred,
    undefined,
  );

  return {
    gtoReference,
    styleReference,
    exploitReference,
    baselineActionFrequencies,
    actionFrequencies,
    sizingRoutes,
    raiseTo: preferredRoute?.target ?? gtoReference.raiseTo,
    styleExpressionWeight,
    exploitWeight,
    totalVariationFromGto: pokerPolicyTotalVariation(
      actionFrequencies,
      gtoReference.actionFrequencies,
    ),
    totalVariationFromStyleBaseline: pokerPolicyTotalVariation(
      actionFrequencies,
      baselineActionFrequencies,
    ),
    source: "local-gto-anchor+bounded-public-exploit",
  };
}

/** Samples the final mixed strategy while preserving seeded three-roll replay. */
export function chooseAdaptivePokerPolicyAction(
  input: PokerPolicyInput,
  options: AdaptivePokerPolicyOptions,
  random: PokerPolicyRng = Math.random,
): PokerPolicyAction {
  const plan = evaluateAdaptivePokerPolicy(input, options);
  const sizeMix = unitRandom(random);
  unitRandom(random);
  const actionMix = unitRandom(random);
  const sizingBranches = [...plan.sizingRoutes]
    .filter((route) => route.frequency > 0)
    .sort((left, right) => right.frequency - left.frequency);
  let raiseTo = plan.raiseTo;
  let sizeCumulative = 0;
  for (const [index, route] of sizingBranches.entries()) {
    sizeCumulative += route.frequency;
    if (sizeMix < sizeCumulative || index === sizingBranches.length - 1) {
      raiseTo = route.target;
      break;
    }
  }
  const actionBranches = ACTION_KINDS
    .map((kind) => [kind, plan.actionFrequencies[kind]] as const)
    .filter(([, frequency]) => frequency > 0)
    .sort((left, right) => right[1] - left[1]);
  let cumulative = 0;
  for (const [index, [kind, frequency]] of actionBranches.entries()) {
    cumulative += frequency;
    if (actionMix < cumulative || index === actionBranches.length - 1) {
      return kind === "raise" ? { kind, raiseTo } : { kind };
    }
  }
  return { kind: input.toCall > 0 ? "fold" : "check" };
}
