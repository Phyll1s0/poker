export type MultiplayerRaisePreset = {
  key: "minimum" | "half-pot" | "two-thirds-pot" | "pot" | "all-in";
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

  const callAmount = Math.max(0, Math.round(input.callAmount ?? 0));
  const potAfterCall = Math.max(0, Math.round(input.pot)) + callAmount;
  const matchedBet = Math.max(0, Math.round(input.currentBet));
  const candidates: MultiplayerRaisePreset[] = [
    { key: "minimum", label: "最小", target: minimum },
    { key: "half-pot", label: "½ 池", target: matchedBet + Math.round(potAfterCall * 0.5) },
    { key: "two-thirds-pot", label: "⅔ 池", target: matchedBet + Math.round(potAfterCall * (2 / 3)) },
    { key: "pot", label: "1 池", target: matchedBet + potAfterCall },
    { key: "all-in", label: "全下", target: maximum },
  ];

  const byTarget = new Map<number, MultiplayerRaisePreset>();
  for (const candidate of candidates) {
    if (candidate.target < minimum || candidate.target > maximum) continue;
    const previous = byTarget.get(candidate.target);
    if (!previous || candidate.key === "all-in") byTarget.set(candidate.target, candidate);
  }
  return [...byTarget.values()].sort((left, right) => left.target - right.target);
}
