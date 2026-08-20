export type PokerSizingStreet = "preflop" | "flop" | "turn" | "river";

export type PokerSizingContext = {
  street: PokerSizingStreet;
  /** Current committed pot, including bets already placed on this street. */
  pot: number;
  toCall: number;
  highestBet: number;
  playerBet: number;
  playerStack: number;
  minRaise: number;
  bigBlind: number;
  preflopRaiseCount: number;
};

export type PokerSizingRoute = {
  target: number;
  fraction: number;
  frequency: number;
  allIn: boolean;
};

export type PokerSizingIntent = {
  /** Post-flop fraction of the pot after calling. */
  fraction?: number;
  /** Explicit raise-to target, primarily for pre-flop branches. */
  target?: number;
  /** Conditional frequency inside the raise/bet branch. */
  frequency: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

export function pokerSizingMaxTarget(context: PokerSizingContext) {
  return Math.max(context.playerBet, context.playerBet + Math.max(0, context.playerStack));
}

/** Clamps a requested raise-to amount to the executable minimum and stack cap. */
export function legalPokerRaiseTarget(context: PokerSizingContext, requestedTarget: number) {
  const maxTarget = pokerSizingMaxTarget(context);
  const legalFloor = Math.min(maxTarget, Math.max(0, context.highestBet) + Math.max(0, context.minRaise));
  return Math.max(
    Math.max(0, context.playerBet),
    Math.min(maxTarget, Math.max(Number.isFinite(requestedTarget) ? requestedTarget : legalFloor, legalFloor)),
  );
}

/**
 * Postflop raise increment divided by the pot after calling. When checked to,
 * this is the familiar bet-size / pot fraction.
 */
export function pokerRaiseFraction(context: PokerSizingContext, target: number) {
  const sizingPot = Math.max(1, context.pot + Math.max(0, context.toCall));
  return Math.max(0, target - Math.max(0, context.highestBet)) / sizingPot;
}

/** Converts a pot-after-call fraction into a legal, half-big-blind raise target. */
export function roundedPokerRaiseTarget(context: PokerSizingContext, requestedTarget: number) {
  const sizingUnit = Math.max(1, context.bigBlind / 2);
  const rounded = Math.round(requestedTarget / sizingUnit) * sizingUnit;
  return legalPokerRaiseTarget(context, rounded);
}

/** Converts a pot-after-call fraction into a legal, half-big-blind raise target. */
export function pokerRaiseTargetForFraction(context: PokerSizingContext, fraction: number) {
  const desired = context.highestBet + (context.pot + Math.max(0, context.toCall)) * Math.max(0, fraction);
  return roundedPokerRaiseTarget(context, desired);
}

function normalizedRoutes(routes: Omit<PokerSizingRoute, "frequency">[], frequencies: number[]) {
  const total = frequencies.reduce((sum, frequency) => sum + frequency, 0);
  return routes.map((route, index) => ({
    ...route,
    frequency: total > 0 ? frequencies[index] / total : 1 / routes.length,
  }));
}

function mergeAndNormalizeRoutes(routes: PokerSizingRoute[]) {
  const byTarget = new Map<number, PokerSizingRoute>();
  for (const route of routes) {
    const existing = byTarget.get(route.target);
    if (existing) existing.frequency += Math.max(0, route.frequency);
    else byTarget.set(route.target, { ...route, frequency: Math.max(0, route.frequency) });
  }
  const merged = [...byTarget.values()].sort((left, right) => left.target - right.target);
  const total = merged.reduce((sum, route) => sum + route.frequency, 0);
  return merged.map((route) => ({
    ...route,
    frequency: total > 0 ? route.frequency / total : 1 / Math.max(1, merged.length),
  }));
}

function attachJamRoute(
  context: PokerSizingContext,
  routes: PokerSizingRoute[],
  requestedJamShare: number,
) {
  const maxTarget = pokerSizingMaxTarget(context);
  const jamShare = clamp(requestedJamShare, 0, 1);
  if (jamShare <= 0) return mergeAndNormalizeRoutes(routes);
  return mergeAndNormalizeRoutes([
    ...routes.map((route) => ({ ...route, frequency: route.frequency * (1 - jamShare) })),
    {
      target: maxTarget,
      fraction: pokerRaiseFraction(context, maxTarget),
      frequency: jamShare,
      allIn: true,
    },
  ]);
}

/** Builds a compact primary/secondary sizing tree for coaching and review. */
export function buildPokerSizingRoutes(
  context: PokerSizingContext,
  recommendedTarget: number,
  shortStackJamFrequency = 0,
  intents: readonly PokerSizingIntent[] = [],
): PokerSizingRoute[] {
  if (context.playerStack <= 0 || context.highestBet >= pokerSizingMaxTarget(context)) return [];
  const maxTarget = pokerSizingMaxTarget(context);
  const primaryTarget = legalPokerRaiseTarget(context, recommendedTarget);
  const primary: Omit<PokerSizingRoute, "frequency"> = {
    target: primaryTarget,
    fraction: pokerRaiseFraction(context, primaryTarget),
    allIn: primaryTarget === maxTarget,
  };
  const jamShare = clamp(shortStackJamFrequency, 0, 1);
  if (intents.length) {
    const planned = intents
      .filter((intent) => intent.frequency > 0 && (intent.target !== undefined || intent.fraction !== undefined))
      .map((intent) => {
        const requested = intent.target !== undefined
          ? intent.target
          : context.highestBet + (context.pot + Math.max(0, context.toCall)) * Math.max(0, intent.fraction ?? 0);
        const target = roundedPokerRaiseTarget(context, requested);
        return {
          target,
          fraction: pokerRaiseFraction(context, target),
          frequency: intent.frequency,
          allIn: target === maxTarget,
        };
      });
    if (planned.length) return attachJamRoute(context, mergeAndNormalizeRoutes(planned), jamShare);
  }
  if (primary.allIn) return [{ ...primary, frequency: 1 }];

  let alternativeTarget: number | undefined;
  if (context.street === "preflop" && context.preflopRaiseCount === 0) {
    const primaryBb = primaryTarget / Math.max(1, context.bigBlind);
    const alternativeBb = primaryBb < 2.75 ? 3 : 2.5;
    alternativeTarget = legalPokerRaiseTarget(context, alternativeBb * context.bigBlind);
  } else if (context.street !== "preflop") {
    const alternativeFraction = primary.fraction <= 0.42 ? 0.75 : primary.fraction <= 0.8 ? 0.33 : 0.5;
    alternativeTarget = pokerRaiseTargetForFraction(context, alternativeFraction);
  }

  if (alternativeTarget === undefined || alternativeTarget === primaryTarget || alternativeTarget === maxTarget) {
    return attachJamRoute(context, [{ ...primary, frequency: 1 }], jamShare);
  }
  const alternative: Omit<PokerSizingRoute, "frequency"> = {
    target: alternativeTarget,
    fraction: pokerRaiseFraction(context, alternativeTarget),
    allIn: alternativeTarget === maxTarget,
  };
  const primaryWeight = clamp(0.64 + Math.min(0.16, Math.abs(primary.fraction - alternative.fraction) * 0.18), 0.58, 0.8);
  return attachJamRoute(
    context,
    normalizedRoutes([primary, alternative], [primaryWeight, 1 - primaryWeight]),
    jamShare,
  );
}

export function preferredPokerSizingRoute(routes: readonly PokerSizingRoute[]) {
  return routes.reduce<PokerSizingRoute | undefined>(
    (preferred, route) => !preferred || route.frequency > preferred.frequency ? route : preferred,
    undefined,
  );
}

function formatNumber(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(value);
}

export function formatPokerSizingRoute(context: PokerSizingContext, route: PokerSizingRoute) {
  if (context.street === "preflop") {
    const level = context.preflopRaiseCount === 0 ? "开池" : `${context.preflopRaiseCount + 2}bet`;
    const prefix = route.allIn ? "全下" : level;
    const action = prefix.endsWith("bet") ? `${prefix} 至` : `${prefix}至`;
    return `${action} ${formatNumber(route.target, 0)}（${formatNumber(route.target / Math.max(1, context.bigBlind))} BB）`;
  }
  const prefix = route.allIn ? "全下" : context.toCall > 0 ? "加注" : "下注";
  const basis = context.toCall > 0 ? "跟注后底池" : "底池";
  return `${prefix}至 ${formatNumber(route.target, 0)}（${basis} ${Math.round(route.fraction * 100)}%）`;
}

/** Scores the selected size against every valid route; secondary routes remain acceptable. */
export function scorePokerRaiseSize(
  context: PokerSizingContext,
  actualTarget: number,
  routes: readonly PokerSizingRoute[],
) {
  if (!routes.length) return 70;
  const actualMeasure = context.street === "preflop"
    ? legalPokerRaiseTarget(context, actualTarget) / Math.max(1, context.bigBlind)
    : pokerRaiseFraction(context, legalPokerRaiseTarget(context, actualTarget));
  const maximumFrequency = Math.max(...routes.map((route) => route.frequency));
  let best = 0;
  for (const route of routes) {
    const routeMeasure = context.street === "preflop"
      ? route.target / Math.max(1, context.bigBlind)
      : route.fraction;
    const distance = Math.abs(Math.log(Math.max(0.001, actualMeasure) / Math.max(0.001, routeMeasure)));
    const closeness = clamp(1 - distance / Math.log(2), 0, 1);
    const routeCredit = 0.88 + 0.12 * route.frequency / Math.max(0.001, maximumFrequency);
    best = Math.max(best, 35 + 65 * closeness * routeCredit);
  }
  return Math.round(clamp(best, 35, 100));
}

export function pokerRaiseSizeVerdict(
  context: PokerSizingContext,
  actualTarget: number,
  routes: readonly PokerSizingRoute[],
) {
  if (!routes.length) return "当前节点不推荐主动加注";
  const score = scorePokerRaiseSize(context, actualTarget, routes);
  if (score >= 94) return "尺寸命中建议路线";
  if (score >= 80) return "尺寸接近建议路线";
  const minimum = Math.min(...routes.map((route) => route.target));
  const maximum = Math.max(...routes.map((route) => route.target));
  if (actualTarget < minimum) return "加注尺寸偏小";
  if (actualTarget > maximum) return "加注尺寸偏大";
  return "尺寸落在低频区间";
}
