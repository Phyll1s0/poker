export type MultiplayerRaisePreset = {
  key:
    | "minimum"
    | "two-and-half-bb"
    | "three-bb"
    | "four-bb"
    | "five-bb"
    | "one-third-pot"
    | "half-pot"
    | "three-quarters-pot"
    | "pot"
    | "all-in";
  label: string;
  target: number;
};

type MultiplayerRaisePresetInput = {
  pot: number;
  currentBet: number;
  callAmount: number | null;
  minRaiseTo: number;
  maxRaiseTo: number;
  allInOnly?: boolean;
  street?: "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";
  bigBlind?: number;
};

export function clampMultiplayerRaiseTarget(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

/**
 * Pot fractions are expressed as the extra raise after calling. For example,
 * facing a 50-chip bet in a 150-chip pot, a half-pot raise is to 150:
 * call 50, then raise another 100 into the 200-chip pot after calling.
 */
export function multiplayerRaisePresets(input: MultiplayerRaisePresetInput): MultiplayerRaisePreset[] {
  const minimum = Math.max(0, Math.round(input.minRaiseTo));
  const maximum = Math.max(minimum, Math.round(input.maxRaiseTo));
  if (input.allInOnly || minimum === maximum) {
    return [{ key: "all-in", label: "全下", target: maximum }];
  }

  const matchedBet = Math.max(0, Math.round(input.currentBet));
  let candidates: MultiplayerRaisePreset[];
  if (input.street === "preflop" && Number.isFinite(input.bigBlind) && Number(input.bigBlind) > 0) {
    const bigBlind = Math.max(1, Math.round(Number(input.bigBlind)));
    const unopened = matchedBet <= bigBlind;
    const sizingBase = unopened ? bigBlind : matchedBet;
    const preflopSizes = [
      { key: "two-and-half-bb" as const, multiple: 2.5 },
      { key: "three-bb" as const, multiple: 3 },
      { key: "four-bb" as const, multiple: 4 },
      { key: "five-bb" as const, multiple: 5 },
    ];
    candidates = [
      ...preflopSizes.map(({ key, multiple }) => ({
        key,
        label: unopened ? `${multiple}BB` : `${multiple}×`,
        target: Math.round(sizingBase * multiple),
      })),
      { key: "all-in", label: "全下", target: maximum },
    ];
  } else {
    const callAmount = Math.max(0, Math.round(input.callAmount ?? 0));
    const potAfterCall = Math.max(0, Math.round(input.pot)) + callAmount;
    const sizingUnit = Number.isFinite(input.bigBlind) && Number(input.bigBlind) > 0
      ? Math.max(1, Number(input.bigBlind) / 2)
      : 1;
    const postflopTarget = (fraction: number) => Math.round(
      Math.round((matchedBet + potAfterCall * fraction) / sizingUnit) * sizingUnit,
    );
    candidates = [
      { key: "one-third-pot", label: "33%", target: postflopTarget(0.33) },
      { key: "half-pot", label: "50%", target: postflopTarget(0.5) },
      { key: "three-quarters-pot", label: "75%", target: postflopTarget(0.75) },
      { key: "pot", label: "底池", target: postflopTarget(1) },
      { key: "all-in", label: "全下", target: maximum },
    ];
  }

  const byTarget = new Map<number, MultiplayerRaisePreset>();
  for (const candidate of candidates) {
    if (candidate.target < minimum || candidate.target > maximum) continue;
    const previous = byTarget.get(candidate.target);
    if (!previous || candidate.key === "all-in") byTarget.set(candidate.target, candidate);
  }
  const presets = [...byTarget.values()].sort((left, right) => left.target - right.target);
  if (presets.some((preset) => preset.key !== "all-in")) return presets;
  return [
    { key: "minimum" as const, label: "最小", target: minimum },
    ...presets,
  ].filter((preset, index, list) => list.findIndex((item) => item.target === preset.target) === index);
}
