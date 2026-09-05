export const PREFLOP_POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"] as const;

export type PreflopPosition = typeof PREFLOP_POSITIONS[number];
export type PreflopScenario = "rfi" | "vs-limp" | "vs-open" | "vs-three-bet" | "vs-four-bet";
export type PreflopResponseRole = "opener" | "cold-caller" | "cold-entry";
export type PreflopAction = "fold" | "check" | "call" | "raise";
export type PreflopHandClass = string;

export type PreflopFrequencies = Record<PreflopAction, number>;

export type PreflopStrategyQuery = {
  hand: PreflopHandClass;
  scenario: PreflopScenario;
  heroPosition: PreflopPosition;
  /** Position of the opener for vs-open, or the latest raiser for later branches. */
  aggressorPosition?: PreflopPosition;
  /** Distinguishes the opener's 3-bet response from a squeezed caller or a true cold entry. */
  responseRole?: PreflopResponseRole;
  /** Number of limpers already in the pot for an isolate/overlimp node. */
  limpers?: number;
  effectiveStackBb?: number;
  /** Total raise-to size. Defaults: open 2.5BB, 3-bet 9BB, 4-bet 22BB. */
  facingSizeBb?: number;
};

export type PreflopStrategy = {
  hand: PreflopHandClass;
  scenario: PreflopScenario;
  frequencies: PreflopFrequencies;
  enterFrequency: number;
  raiseFrequency: number;
};

export type PreflopRangeSummary = {
  totalCombos: 1326;
  foldCombos: number;
  checkCombos: number;
  callCombos: number;
  raiseCombos: number;
  enterCombos: number;
  frequencies: PreflopFrequencies;
  enterFrequency: number;
};

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const RANK_VALUE: Record<string, number> = Object.fromEntries(
  RANKS.map((rank, index) => [rank, 14 - index]),
);

type MutableChart = Map<PreflopHandClass, PreflopFrequencies>;
type PositionPair = `${PreflopPosition}:${PreflopPosition}`;

type VsThreeBetTarget = {
  /** Share of this position's RFI range that continues against the reference 9BB size. */
  retain: number;
  /** Conditional 4-bet share after the continue branch has been selected. */
  fourBetShare: number;
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function normalized(frequencies: Partial<PreflopFrequencies>): PreflopFrequencies {
  const result: PreflopFrequencies = {
    fold: Math.max(0, frequencies.fold ?? 0),
    check: Math.max(0, frequencies.check ?? 0),
    call: Math.max(0, frequencies.call ?? 0),
    raise: Math.max(0, frequencies.raise ?? 0),
  };
  const total = Object.values(result).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { fold: 1, check: 0, call: 0, raise: 0 };
  for (const action of Object.keys(result) as PreflopAction[]) result[action] /= total;
  return result;
}

export function encodePreflopHandClass(highRank: string | number, lowRank: string | number, suited = false): PreflopHandClass {
  const high = typeof highRank === "number" ? RANKS[14 - highRank] : highRank.toUpperCase();
  const low = typeof lowRank === "number" ? RANKS[14 - lowRank] : lowRank.toUpperCase();
  if (!(high in RANK_VALUE) || !(low in RANK_VALUE)) throw new RangeError("起手牌点数必须是 2..14 或 2..A");
  const ordered = RANK_VALUE[high] >= RANK_VALUE[low] ? [high, low] : [low, high];
  return ordered[0] === ordered[1] ? `${ordered[0]}${ordered[1]}` : `${ordered[0]}${ordered[1]}${suited ? "s" : "o"}`;
}

export const PREFLOP_HAND_CLASSES: readonly PreflopHandClass[] = (() => {
  const classes: string[] = [];
  for (let high = 0; high < RANKS.length; high += 1) {
    classes.push(`${RANKS[high]}${RANKS[high]}`);
    for (let low = high + 1; low < RANKS.length; low += 1) classes.push(`${RANKS[high]}${RANKS[low]}s`);
    for (let low = high + 1; low < RANKS.length; low += 1) classes.push(`${RANKS[high]}${RANKS[low]}o`);
  }
  return Object.freeze(classes);
})();

const HAND_CLASS_SET = new Set(PREFLOP_HAND_CLASSES);

export function preflopComboCount(hand: PreflopHandClass) {
  if (!HAND_CLASS_SET.has(hand)) throw new RangeError(`未知起手牌类别：${hand}`);
  if (hand.length === 2) return 6;
  return hand.endsWith("s") ? 4 : 12;
}

function emptyChart(): MutableChart {
  return new Map(PREFLOP_HAND_CLASSES.map((hand) => [hand, { fold: 1, check: 0, call: 0, raise: 0 }]));
}

function cloneChart(chart: MutableChart): MutableChart {
  return new Map([...chart].map(([hand, frequencies]) => [hand, { ...frequencies }]));
}

function setMix(chart: MutableChart, hands: readonly string[], call: number, raise: number) {
  for (const hand of hands) {
    if (!HAND_CLASS_SET.has(hand)) throw new RangeError(`策略表包含未知起手牌：${hand}`);
    chart.set(hand, normalized({ fold: Math.max(0, 1 - call - raise), call, raise }));
  }
}

function setRaise(chart: MutableChart, hands: readonly string[], raise: number) {
  setMix(chart, hands, 0, raise);
}

function calibrateEnterRange(chart: MutableChart, targetRange: number) {
  const rangeAtFactor = (factor: number) => PREFLOP_HAND_CLASSES.reduce((sum, hand) => {
    const frequencies = chart.get(hand)!;
    return sum + preflopComboCount(hand) * scaleProbability(frequencies.call + frequencies.raise, factor);
  }, 0) / 1326;
  let lower = 0.01;
  let upper = 100;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (rangeAtFactor(middle) < targetRange) lower = middle;
    else upper = middle;
  }
  const factor = (lower + upper) / 2;
  for (const hand of PREFLOP_HAND_CLASSES) {
    const frequencies = chart.get(hand)!;
    const enter = frequencies.call + frequencies.raise;
    if (enter <= 0) continue;
    const adjustedEnter = scaleProbability(enter, factor);
    const raiseShare = frequencies.raise / enter;
    chart.set(hand, normalized({
      fold: 1 - adjustedEnter,
      call: adjustedEnter * (1 - raiseShare),
      raise: adjustedEnter * raiseShare,
    }));
  }
}

function calibrateRaiseRange(chart: MutableChart, targetRange: number) {
  const raiseAtFactor = (factor: number) => PREFLOP_HAND_CLASSES.reduce((sum, hand) => {
    const frequencies = chart.get(hand)!;
    const enter = frequencies.call + frequencies.raise;
    if (enter <= 0) return sum;
    const raiseShare = scaleProbability(frequencies.raise / enter, factor);
    return sum + preflopComboCount(hand) * enter * raiseShare;
  }, 0) / 1326;
  let lower = 0.000_001;
  let upper = 1_000_000;
  for (let iteration = 0; iteration < 72; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (raiseAtFactor(middle) < targetRange) lower = middle;
    else upper = middle;
  }
  const factor = (lower + upper) / 2;
  for (const hand of PREFLOP_HAND_CLASSES) {
    const frequencies = chart.get(hand)!;
    const enter = frequencies.call + frequencies.raise;
    if (enter <= 0) continue;
    const raiseShare = scaleProbability(frequencies.raise / enter, factor);
    chart.set(hand, normalized({
      fold: 1 - enter,
      call: enter * (1 - raiseShare),
      raise: enter * raiseShare,
    }));
  }
}

function expandRange(specification: string) {
  const hands = new Set<string>();
  for (const token of specification.trim().split(/\s+/).filter(Boolean)) {
    const match = token.match(/^([AKQJT98765432])([AKQJT98765432])([so])?(\+)?$/);
    if (!match) throw new RangeError(`无法解析翻前范围：${token}`);
    const [, first, second, suffix = "", plus] = match;
    const firstValue = RANK_VALUE[first];
    const secondValue = RANK_VALUE[second];
    if (!plus) {
      hands.add(encodePreflopHandClass(first, second, suffix === "s"));
      continue;
    }
    if (first === second) {
      for (let value = secondValue; value <= 14; value += 1) {
        hands.add(encodePreflopHandClass(value, value));
      }
      continue;
    }
    for (let low = secondValue; low < firstValue; low += 1) {
      hands.add(encodePreflopHandClass(first, low, suffix === "s"));
    }
  }
  return [...hands];
}

function setNestedRaiseRange(
  chart: MutableChart,
  specification: string,
  frequency: number,
) {
  for (const hand of expandRange(specification)) {
    const current = chart.get(hand)!;
    setRaise(chart, [hand], Math.max(current.raise, frequency));
  }
}

function preserveRfiNesting(later: MutableChart, earlier: MutableChart) {
  for (const hand of PREFLOP_HAND_CLASSES) {
    const earlierRaise = earlier.get(hand)!.raise;
    if (later.get(hand)!.raise < earlierRaise) setRaise(later, [hand], earlierRaise);
  }
}

function buildRfiCharts() {
  const utg = emptyChart();
  // Coherent 100BB, six-max, no-rake baselines.  Each later position starts
  // from the previous chart, so aggregate calibration can never make a hand
  // open less often merely because fewer players remain behind.
  setNestedRaiseRange(utg, "66+ A2s+ KTs+ QTs+ JTs T9s 98s 87s 76s ATo+ KQo", 0.985);
  setRaise(utg, ["55", "Q9s", "J9s", "T8s"], 0.72);
  setRaise(utg, ["KJo", "65s", "54s"], 0.28);
  calibrateEnterRange(utg, 0.17);
  // KJo is only an edge mix in this early-position construction.  Keep it
  // below the KQo/ATo core rather than letting aggregate odds calibration
  // promote every supported hand equally.
  setRaise(utg, ["KJo"], 0.06);

  const hj = cloneChart(utg);
  setNestedRaiseRange(hj, "22+ A2s+ K9s+ Q9s+ J9s+ T9s 98s 87s 76s 65s ATo+ KJo+ QJo", 0.985);
  setRaise(hj, ["Q8s", "J8s", "T8s", "54s"], 0.45);
  calibrateEnterRange(hj, 0.21);
  preserveRfiNesting(hj, utg);

  const co = cloneChart(hj);
  setNestedRaiseRange(co, "22+ A2s+ K6s+ Q8s+ J8s+ T8s+ 97s+ 86s+ 75s+ 65s 54s A8o+ K9o+ Q9o+ JTo", 0.985);
  setRaise(co, ["A7o", "K8o", "Q8o", "T7s", "96s", "85s", "64s", "53s"], 0.42);
  calibrateEnterRange(co, 0.29);
  preserveRfiNesting(co, hj);

  const btn = cloneChart(co);
  setNestedRaiseRange(btn, "22+ A2s+ K2s+ Q6s+ J7s+ T7s+ 96s+ 86s+ 75s+ 65s 54s A2o+ K9o+ Q9o+ J8o+ T8o+ 98o", 0.985);
  setRaise(btn, ["K8o", "Q8o", "J7o", "T7o", "97o", "87o", "76o"], 0.58);
  setRaise(btn, ["Q5s", "J6s", "T6s", "95s", "85s", "74s", "64s", "53s", "43s"], 0.48);
  calibrateEnterRange(btn, 0.46);
  preserveRfiNesting(btn, co);

  const sb = emptyChart();
  const sbCandidates = PREFLOP_HAND_CLASSES
    .filter((hand) => hand !== "72o")
    .map((hand) => ({ hand, score: blindDefenseScore(hand) }))
    .sort((left, right) => right.score - left.score || left.hand.localeCompare(right.hand));
  let supported = 0;
  for (const [index, candidate] of sbCandidates.entries()) {
    if (supported / 1326 >= 0.9) break;
    const quality = 1 - index / sbCandidates.length;
    const enter = clamp(0.35 + quality * 0.63);
    const handTraits = traits(candidate.hand);
    const valueRaise = clamp((candidate.score - 64) / 80, 0, 0.78);
    const blockerRaise = handTraits.wheelAce ? 0.28 : handTraits.high === 14 && handTraits.suited ? 0.16 : 0;
    const raiseShare = clamp(0.12 + valueRaise + blockerRaise, 0.08, 0.96);
    setMix(sb, [candidate.hand], enter * (1 - raiseShare), enter * raiseShare);
    supported += preflopComboCount(candidate.hand);
  }
  calibrateEnterRange(sb, 0.78);
  calibrateRaiseRange(sb, 0.3);
  setMix(sb, ["AA", "KK", "QQ", "JJ", "TT", "AKs", "AQs", "AKo"], 0.03, 0.97);
  setMix(sb, ["22", "33", "44", "55"], 0.34, 0.64);

  const bb = emptyChart();
  for (const hand of PREFLOP_HAND_CLASSES) bb.set(hand, { fold: 0, check: 1, call: 0, raise: 0 });
  return { UTG: utg, HJ: hj, CO: co, BTN: btn, SB: sb, BB: bb } satisfies Record<PreflopPosition, MutableChart>;
}

function buildVsOpenReference() {
  const chart = emptyChart();
  setMix(chart, ["AA"], 0.02, 0.98);
  setMix(chart, ["KK"], 0.05, 0.95);
  setMix(chart, ["QQ"], 0.18, 0.8);
  setMix(chart, ["JJ"], 0.42, 0.5);
  setMix(chart, ["TT"], 0.58, 0.3);
  setMix(chart, ["99"], 0.68, 0.18);
  setMix(chart, ["88", "77", "66", "55", "44", "33"], 0.76, 0.06);
  setMix(chart, ["22"], 0.72, 0.05);
  setMix(chart, ["AKs"], 0.16, 0.84);
  setMix(chart, ["AKo"], 0.36, 0.6);
  setMix(chart, ["AQs"], 0.5, 0.42);
  setMix(chart, ["AQo"], 0.5, 0.28);
  setMix(chart, ["AJs", "ATs"], 0.58, 0.24);
  setMix(chart, ["AJo", "KQs"], 0.48, 0.16);
  setMix(chart, ["KJs", "KTs", "QJs", "QTs", "JTs"], 0.54, 0.15);
  setMix(chart, ["A5s"], 0.46, 0.34);
  setMix(chart, ["A4s"], 0.42, 0.28);
  setMix(chart, ["A3s", "A2s"], 0.36, 0.18);
  setMix(chart, ["A9s", "A8s", "A7s", "A6s", "K9s", "Q9s", "J9s", "T9s", "98s", "87s", "76s", "65s", "54s"], 0.5, 0.08);
  setMix(chart, ["ATo", "KQo", "KJo", "QJo", "T8s", "97s", "86s", "75s", "64s", "53s"], 0.32, 0.05);
  return chart;
}

const VS_OPEN_TARGETS: Record<PreflopPosition, Record<PreflopPosition, number>> = {
  UTG: { UTG: 0.1, HJ: 0.1, CO: 0.1, BTN: 0.1, SB: 0.1, BB: 0.1 },
  HJ: { UTG: 0.12, HJ: 0.12, CO: 0.12, BTN: 0.12, SB: 0.12, BB: 0.12 },
  CO: { UTG: 0.14, HJ: 0.17, CO: 0.17, BTN: 0.17, SB: 0.17, BB: 0.17 },
  BTN: { UTG: 0.16, HJ: 0.19, CO: 0.235, BTN: 0.235, SB: 0.235, BB: 0.235 },
  SB: { UTG: 0.15, HJ: 0.17, CO: 0.22, BTN: 0.28, SB: 0.28, BB: 0.28 },
  BB: { UTG: 0.327, HJ: 0.37, CO: 0.46, BTN: 0.575, SB: 0.62, BB: 0.575 },
};

// Absolute 3-bet frequencies, rather than a single conditional share.  This
// matters because a larger open removes calls much faster than 3-bets; scaling
// both branches together was the main reason the old policy under-3-bet.
const VS_OPEN_RAISE_TARGETS: Record<PreflopPosition, Record<PreflopPosition, number>> = {
  UTG: { UTG: 0.045, HJ: 0.045, CO: 0.045, BTN: 0.045, SB: 0.045, BB: 0.045 },
  HJ: { UTG: 0.05, HJ: 0.05, CO: 0.05, BTN: 0.05, SB: 0.05, BB: 0.05 },
  CO: { UTG: 0.055, HJ: 0.07, CO: 0.07, BTN: 0.07, SB: 0.07, BB: 0.07 },
  BTN: { UTG: 0.06, HJ: 0.075, CO: 0.095, BTN: 0.095, SB: 0.095, BB: 0.095 },
  SB: { UTG: 0.065, HJ: 0.08, CO: 0.11, BTN: 0.145, SB: 0.145, BB: 0.145 },
  BB: { UTG: 0.054, HJ: 0.07, CO: 0.095, BTN: 0.12, SB: 0.14, BB: 0.12 },
};

const VS_OPEN_SUPPORT_MARGIN: Record<PreflopPosition, Record<PreflopPosition, number>> = {
  UTG: { UTG: 0.02, HJ: 0.02, CO: 0.02, BTN: 0.02, SB: 0.02, BB: 0.02 },
  HJ: { UTG: 0.02, HJ: 0.02, CO: 0.02, BTN: 0.02, SB: 0.02, BB: 0.02 },
  CO: { UTG: 0.025, HJ: 0.025, CO: 0.025, BTN: 0.025, SB: 0.025, BB: 0.025 },
  BTN: { UTG: 0.04, HJ: 0.045, CO: 0.07, BTN: 0.07, SB: 0.07, BB: 0.07 },
  SB: { UTG: 0.035, HJ: 0.035, CO: 0.05, BTN: 0.1, SB: 0.1, BB: 0.1 },
  BB: { UTG: 0.08, HJ: 0.1, CO: 0.13, BTN: 0.18, SB: 0.2, BB: 0.18 },
};

function blindDefenseScore(hand: PreflopHandClass) {
  const pair = hand.length === 2;
  const suited = hand.endsWith("s");
  const high = RANK_VALUE[hand[0]];
  const low = RANK_VALUE[hand[1]];
  if (pair) return 108 + high * 4;
  const gap = high - low;
  const connectivity = gap === 1 ? 10 : gap === 2 ? 6 : gap === 3 ? 2 : 0;
  const blocker = high === 14 ? 9 : high === 13 ? 3 : 0;
  const wheel = suited && high === 14 && low <= 5 ? 5 : 0;
  const offsuitPenalty = suited ? 0 : gap >= 4 ? 8 : 3;
  const weakOffsuitPenalty = !suited && high <= 10 && low <= 5 ? 4 : 0;
  return high * 4 + low * 2 + (suited ? 14 : 0) + connectivity + blocker + wheel
    - offsuitPenalty - weakOffsuitPenalty;
}

function addRankedDefenseSupport(
  chart: MutableChart,
  targetSupport: number,
  heroPosition: PreflopPosition,
) {
  let supportedCombos = PREFLOP_HAND_CLASSES.reduce((sum, hand) => {
    const frequencies = chart.get(hand)!;
    return sum + (frequencies.call + frequencies.raise > 0 ? preflopComboCount(hand) : 0);
  }, 0);
  const targetCombos = Math.ceil(clamp(targetSupport) * 1326);
  const candidates = PREFLOP_HAND_CLASSES
    .filter((hand) => {
      const frequencies = chart.get(hand)!;
      return frequencies.call + frequencies.raise === 0 && hand !== "72o";
    })
    .map((hand) => ({ hand, score: blindDefenseScore(hand) }))
    .sort((left, right) => right.score - left.score || left.hand.localeCompare(right.hand));
  const bestScore = candidates[0]?.score ?? 1;
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    if (supportedCombos >= targetCombos) break;
    selected.push(candidate);
    supportedCombos += preflopComboCount(candidate.hand);
  }
  const edgeScore = selected.at(-1)?.score ?? bestScore;
  for (const candidate of selected) {
    const quality = clamp((candidate.score - edgeScore) / Math.max(1, bestScore - edgeScore));
    const enter = 0.025 + quality * 0.45;
    const handTraits = traits(candidate.hand);
    const blockerRaise = handTraits.high === 14
      ? handTraits.suited ? 0.16 : 0.08
      : handTraits.high === 13 && handTraits.suited ? 0.07 : 0;
    const baseRaiseShare = heroPosition === "SB" ? 0.16 : heroPosition === "BB" ? 0.035 : 0.1;
    const raiseShare = clamp(baseRaiseShare + blockerRaise, 0.025, 0.34);
    chart.set(candidate.hand, normalized({
      fold: 1 - enter,
      call: enter * (1 - raiseShare),
      raise: enter * raiseShare,
    }));
  }
}

function buildVsOpenCharts(
  base: MutableChart,
) {
  const charts = {} as Record<PreflopPosition, Record<PreflopPosition, MutableChart>>;
  for (const heroPosition of PREFLOP_POSITIONS) {
    charts[heroPosition] = {} as Record<PreflopPosition, MutableChart>;
    for (const aggressorPosition of PREFLOP_POSITIONS) {
      const chart = cloneChart(base);
      const targetRange = VS_OPEN_TARGETS[heroPosition][aggressorPosition];
      addRankedDefenseSupport(
        chart,
        targetRange + VS_OPEN_SUPPORT_MARGIN[heroPosition][aggressorPosition],
        heroPosition,
      );
      calibrateEnterRange(chart, targetRange);
      calibrateRaiseRange(chart, VS_OPEN_RAISE_TARGETS[heroPosition][aggressorPosition]);
      charts[heroPosition][aggressorPosition] = chart;
    }
  }
  return charts;
}

const VS_LIMP_TARGETS: Record<PreflopPosition, number> = {
  UTG: 0.2,
  HJ: 0.26,
  CO: 0.36,
  BTN: 0.52,
  SB: 0.63,
  BB: 1,
};

function buildVsLimpCharts(rfiCharts: Record<PreflopPosition, MutableChart>) {
  const charts = {} as Record<PreflopPosition, MutableChart>;
  for (const position of PREFLOP_POSITIONS) {
    if (position === "BB") {
      const check = emptyChart();
      for (const hand of PREFLOP_HAND_CLASSES) check.set(hand, { fold: 0, check: 1, call: 0, raise: 0 });
      charts[position] = check;
      continue;
    }
    const chart = cloneChart(rfiCharts[position]);
    for (const hand of PREFLOP_HAND_CLASSES) {
      const frequencies = chart.get(hand)!;
      const enter = frequencies.call + frequencies.raise;
      if (enter <= 0) continue;
      const strength = blindDefenseScore(hand);
      const isolateShare = clamp(0.48 + (strength - 66) / 110, 0.38, 0.9);
      chart.set(hand, normalized({
        fold: 1 - enter,
        call: enter * (1 - isolateShare),
        raise: enter * isolateShare,
      }));
    }
    addRankedDefenseSupport(chart, Math.min(0.82, VS_LIMP_TARGETS[position] + 0.12), position);
    // Common overlimp/isolate boundary hands need explicit support rather than
    // inheriting a hard zero from the unopened RFI chart.
    if (position === "CO" || position === "BTN" || position === "SB") {
      setMix(chart, ["Q9o"], 0.12, position === "CO" ? 0.06 : 0.12);
    }
    calibrateEnterRange(chart, VS_LIMP_TARGETS[position]);
    calibrateRaiseRange(chart, Math.min(VS_LIMP_TARGETS[position] * 0.62, position === "SB" ? 0.34 : 0.3));
    charts[position] = chart;
  }
  return charts;
}

function buildVsThreeBetReference() {
  const chart = emptyChart();
  setMix(chart, ["AA"], 0.1, 0.9);
  setMix(chart, ["KK"], 0.22, 0.76);
  setMix(chart, ["QQ"], 0.5, 0.46);
  setMix(chart, ["JJ"], 0.66, 0.24);
  setMix(chart, ["TT"], 0.62, 0.14);
  setMix(chart, ["99"], 0.48, 0.08);
  setMix(chart, ["88", "77"], 0.32, 0.04);
  setMix(chart, ["66", "55", "44", "33", "22"], 0.18, 0.02);
  setMix(chart, ["AKs"], 0.32, 0.66);
  setMix(chart, ["AKo"], 0.48, 0.46);
  setMix(chart, ["AQs"], 0.62, 0.25);
  setMix(chart, ["AQo"], 0.42, 0.13);
  setMix(chart, ["AJs", "ATs"], 0.46, 0.08);
  setMix(chart, ["KQs", "KJs", "QJs", "JTs"], 0.5, 0.06);
  setMix(chart, ["A5s"], 0.16, 0.22);
  setMix(chart, ["A4s"], 0.13, 0.16);
  setMix(chart, ["A3s", "A2s"], 0.1, 0.09);
  setMix(chart, ["A9s", "A8s", "KTs", "QTs", "T9s", "98s", "87s", "76s", "65s"], 0.24, 0.03);
  setMix(chart, ["AJo", "ATo", "KQo", "KJo", "QJo"], 0.1, 0.02);
  return chart;
}

// 100BB, no-rake guardrails at the 9BB reference size. The base chart below
// still decides which hands prefer calls or 4-bets; these targets only stop a
// single all-position chart from defending the same absolute number of combos
// after a 16% UTG open and a 47% BTN open.
const VS_THREE_BET_DEFAULT_TARGETS: Record<PreflopPosition, VsThreeBetTarget> = {
  UTG: { retain: 0.48, fourBetShare: 0.4 },
  HJ: { retain: 0.46, fourBetShare: 0.39 },
  CO: { retain: 0.45, fourBetShare: 0.4 },
  BTN: { retain: 0.45, fourBetShare: 0.24 },
  SB: { retain: 0.42, fourBetShare: 0.36 },
  BB: { retain: 0.42, fourBetShare: 0.28 },
};

const VS_THREE_BET_TARGET_OVERRIDES: Readonly<Partial<Record<PositionPair, VsThreeBetTarget>>> = {
  // An opener who will have position against a blind 3-bettor can retain more
  // hands as calls and needs a smaller conditional 4-bet share.
  "UTG:SB": { retain: 0.5, fourBetShare: 0.3 },
  "UTG:BB": { retain: 0.52, fourBetShare: 0.29 },
  "HJ:SB": { retain: 0.48, fourBetShare: 0.29 },
  "HJ:BB": { retain: 0.5, fourBetShare: 0.28 },
  "CO:SB": { retain: 0.49, fourBetShare: 0.25 },
  "CO:BB": { retain: 0.47, fourBetShare: 0.24 },
  "BTN:SB": { retain: 0.45, fourBetShare: 0.24 },
  "BTN:BB": { retain: 0.47, fourBetShare: 0.23 },
  "SB:BB": { retain: 0.42, fourBetShare: 0.36 },
};

function vsThreeBetTarget(heroPosition: PreflopPosition, aggressorPosition: PreflopPosition) {
  return VS_THREE_BET_TARGET_OVERRIDES[`${heroPosition}:${aggressorPosition}`]
    ?? VS_THREE_BET_DEFAULT_TARGETS[heroPosition];
}

function conditionalRfiWeight(rfi: MutableChart, hand: PreflopHandClass) {
  return preflopComboCount(hand) * rfi.get(hand)!.raise;
}

/**
 * The reference chart has enough support for an early-position open, but only
 * covers about 39% of the BTN's much wider RFI range. Add the best missing RFI
 * hands before calibration; multiplying odds alone can never revive a zero.
 */
function addVsThreeBetSupport(chart: MutableChart, rfi: MutableChart, targetSupport: number) {
  const openingWeight = PREFLOP_HAND_CLASSES.reduce(
    (sum, hand) => sum + conditionalRfiWeight(rfi, hand),
    0,
  );
  if (openingWeight <= 0) return;
  let supportedWeight = PREFLOP_HAND_CLASSES.reduce((sum, hand) => {
    const frequencies = chart.get(hand)!;
    return sum + (frequencies.call + frequencies.raise > 0 ? conditionalRfiWeight(rfi, hand) : 0);
  }, 0);
  const requiredWeight = openingWeight * clamp(targetSupport);
  if (supportedWeight >= requiredWeight) return;

  const candidates = PREFLOP_HAND_CLASSES
    .filter((hand) => {
      const frequencies = chart.get(hand)!;
      return rfi.get(hand)!.raise > 0 && frequencies.call + frequencies.raise === 0 && hand !== "72o";
    })
    .map((hand) => ({ hand, score: blindDefenseScore(hand) }))
    .sort((left, right) => right.score - left.score || left.hand.localeCompare(right.hand));
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    if (supportedWeight >= requiredWeight) break;
    selected.push(candidate);
    supportedWeight += conditionalRfiWeight(rfi, candidate.hand);
  }
  const bestScore = selected[0]?.score ?? 1;
  const edgeScore = selected.at(-1)?.score ?? bestScore;
  for (const candidate of selected) {
    const quality = clamp((candidate.score - edgeScore) / Math.max(1, bestScore - edgeScore));
    const enter = 0.05 + quality * 0.28;
    const handTraits = traits(candidate.hand);
    const raiseShare = handTraits.high === 14 && handTraits.suited
      ? 0.08
      : handTraits.high === 13 && handTraits.suited
        ? 0.025
        : 0.01;
    chart.set(candidate.hand, normalized({
      fold: 1 - enter,
      call: enter * (1 - raiseShare),
      raise: enter * raiseShare,
    }));
  }
}

function calibrateConditionalRfiEnter(chart: MutableChart, rfi: MutableChart, targetRetain: number) {
  const openingWeight = PREFLOP_HAND_CLASSES.reduce(
    (sum, hand) => sum + conditionalRfiWeight(rfi, hand),
    0,
  );
  if (openingWeight <= 0) return;
  const retainAtFactor = (factor: number) => PREFLOP_HAND_CLASSES.reduce((sum, hand) => {
    const frequencies = chart.get(hand)!;
    const enter = scaleProbability(frequencies.call + frequencies.raise, factor);
    return sum + conditionalRfiWeight(rfi, hand) * enter;
  }, 0) / openingWeight;
  let lower = 0.001;
  let upper = 100_000;
  for (let iteration = 0; iteration < 72; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (retainAtFactor(middle) < targetRetain) lower = middle;
    else upper = middle;
  }
  const factor = (lower + upper) / 2;
  for (const hand of PREFLOP_HAND_CLASSES) {
    const frequencies = chart.get(hand)!;
    const enter = frequencies.call + frequencies.raise;
    if (enter <= 0) continue;
    const adjustedEnter = scaleProbability(enter, factor);
    const raiseShare = frequencies.raise / enter;
    chart.set(hand, normalized({
      fold: 1 - adjustedEnter,
      call: adjustedEnter * (1 - raiseShare),
      raise: adjustedEnter * raiseShare,
    }));
  }
}

function calibrateConditionalFourBetShare(chart: MutableChart, rfi: MutableChart, targetShare: number) {
  const continuingWeight = PREFLOP_HAND_CLASSES.reduce((sum, hand) => {
    const frequencies = chart.get(hand)!;
    return sum + conditionalRfiWeight(rfi, hand) * (frequencies.call + frequencies.raise);
  }, 0);
  if (continuingWeight <= 0) return;
  const shareAtFactor = (factor: number) => PREFLOP_HAND_CLASSES.reduce((sum, hand) => {
    const frequencies = chart.get(hand)!;
    const enter = frequencies.call + frequencies.raise;
    if (enter <= 0) return sum;
    const currentShare = frequencies.raise / enter;
    const raiseShare = hand === "AA" ? 0.9 : scaleProbability(currentShare, factor);
    return sum + conditionalRfiWeight(rfi, hand) * enter * raiseShare;
  }, 0) / continuingWeight;
  let lower = 0.001;
  let upper = 1_000;
  for (let iteration = 0; iteration < 72; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (shareAtFactor(middle) < targetShare) lower = middle;
    else upper = middle;
  }
  const factor = (lower + upper) / 2;
  for (const hand of PREFLOP_HAND_CLASSES) {
    const frequencies = chart.get(hand)!;
    const enter = frequencies.call + frequencies.raise;
    if (enter <= 0) continue;
    const currentShare = frequencies.raise / enter;
    const raiseShare = hand === "AA" ? 0.9 : scaleProbability(currentShare, factor);
    chart.set(hand, normalized({
      fold: 1 - enter,
      call: enter * (1 - raiseShare),
      raise: enter * raiseShare,
    }));
  }
}

function buildVsThreeBetCharts(base: MutableChart, rfiCharts: Record<PreflopPosition, MutableChart>) {
  const charts = {} as Record<PreflopPosition, Record<PreflopPosition, MutableChart>>;
  for (const heroPosition of PREFLOP_POSITIONS) {
    charts[heroPosition] = {} as Record<PreflopPosition, MutableChart>;
    for (const aggressorPosition of PREFLOP_POSITIONS) {
      const target = vsThreeBetTarget(heroPosition, aggressorPosition);
      const chart = cloneChart(base);
      const rfi = rfiCharts[heroPosition];
      addVsThreeBetSupport(chart, rfi, Math.min(0.78, target.retain + 0.12));
      calibrateConditionalRfiEnter(chart, rfi, target.retain);
      calibrateConditionalFourBetShare(chart, rfi, target.fourBetShare);
      charts[heroPosition][aggressorPosition] = chart;
    }
  }
  return charts;
}

function buildVsFourBetReference() {
  const chart = emptyChart();
  setMix(chart, ["AA"], 0.06, 0.94);
  setMix(chart, ["KK"], 0.16, 0.8);
  setMix(chart, ["QQ"], 0.42, 0.45);
  setMix(chart, ["JJ"], 0.34, 0.24);
  setMix(chart, ["TT"], 0.2, 0.12);
  setMix(chart, ["AKs"], 0.28, 0.68);
  setMix(chart, ["AKo"], 0.32, 0.52);
  setMix(chart, ["AQs"], 0.28, 0.16);
  setMix(chart, ["A5s"], 0.08, 0.06);
  setMix(chart, ["A4s"], 0.06, 0.04);
  return chart;
}

const RFI = buildRfiCharts();
const VS_LIMP = buildVsLimpCharts(RFI);
const VS_OPEN = buildVsOpenCharts(buildVsOpenReference());
const VS_THREE_BET = buildVsThreeBetCharts(buildVsThreeBetReference(), RFI);
const VS_FOUR_BET = buildVsFourBetReference();

function traits(hand: PreflopHandClass) {
  const pair = hand.length === 2;
  const suited = hand.endsWith("s");
  const high = RANK_VALUE[hand[0]];
  const low = RANK_VALUE[hand[1]];
  return {
    pair,
    suited,
    high,
    low,
    smallPair: pair && high <= 6,
    connected: !pair && high - low <= 2,
    wheelAce: suited && high === 14 && low <= 5,
  };
}

function scaleProbability(probability: number, factor: number) {
  if (probability <= 0 || probability >= 1) return probability;
  const odds = probability / (1 - probability) * Math.max(0.01, factor);
  return odds / (1 + odds);
}

const HERO_POSITION_FACTOR: Record<PreflopPosition, number> = {
  UTG: 0.68,
  HJ: 0.78,
  CO: 0.92,
  BTN: 1.06,
  SB: 0.84,
  BB: 1.22,
};

const AGGRESSOR_POSITION_FACTOR: Record<PreflopPosition, number> = {
  UTG: 0.72,
  HJ: 0.82,
  CO: 1,
  BTN: 1.2,
  SB: 1.12,
  BB: 0.9,
};

// The aggregate vs-open chart sets total continue ranges, but its original
// call/raise split is otherwise nearly identical in every position pair.
// These late-position floors reshape only AT's conditional 3-bet share; they
// never add continue frequency to a hand that should fold more often.
const ACE_TEN_VS_OPEN_RAISE_SHARE_FLOORS: Record<
  "ATs" | "ATo",
  Readonly<Partial<Record<PositionPair, number>>>
> = {
  ATs: {
    "BTN:HJ": 0.35,
    "BTN:CO": 0.42,
    "SB:CO": 0.58,
    "SB:BTN": 0.72,
    "BB:CO": 0.27,
    "BB:BTN": 0.3,
    "BB:SB": 0.32,
  },
  ATo: {
    "BTN:HJ": 0.2,
    "BTN:CO": 0.3,
    "SB:CO": 0.5,
    "SB:BTN": 0.65,
    "BB:CO": 0.16,
    "BB:BTN": 0.2,
    "BB:SB": 0.23,
  },
};

function aceTenVsOpenRaiseShareFloor(query: PreflopStrategyQuery, depthShift: number) {
  if (query.scenario !== "vs-open" || (query.hand !== "ATs" && query.hand !== "ATo")) return 0;
  const positionPair: PositionPair = `${query.heroPosition}:${query.aggressorPosition ?? "CO"}`;
  const standardFloor = ACE_TEN_VS_OPEN_RAISE_SHARE_FLOORS[query.hand][positionPair] ?? 0;
  if (standardFloor <= 0) return 0;
  const deepPenalty = Math.max(0, depthShift) * (query.hand === "ATo" ? 0.18 : 0.1);
  const shallowBoost = Math.max(0, -depthShift) * (query.hand === "ATo" ? 0.08 : 0.04);
  return clamp(standardFloor * (1 - deepPenalty + shallowBoost), 0, 0.9);
}

const VS_THREE_BET_SHOVE_BY_DEPTH = [
  {
    depth: 10,
    hands: {
      AA: 1, KK: 1, QQ: 1, JJ: 1, TT: 0.98, "99": 0.9, "88": 0.7,
      AKs: 1, AKo: 1, AQs: 0.99, AQo: 0.95, AJs: 0.92, AJo: 0.85,
      ATs: 0.88, KQs: 0.9, KQo: 0.78,
    },
  },
  {
    depth: 20,
    hands: {
      AA: 1, KK: 1, QQ: 0.995, JJ: 0.97, TT: 0.9, "99": 0.65, "88": 0.24,
      AKs: 1, AKo: 0.98, AQs: 0.95, AQo: 0.82, AJs: 0.8, AJo: 0.55,
      ATs: 0.62, KQs: 0.75, KQo: 0.35,
    },
  },
  {
    depth: 40,
    hands: {
      AA: 1, KK: 1, QQ: 0.95, JJ: 0.8, TT: 0.55, "99": 0.16,
      AKs: 0.98, AKo: 0.9, AQs: 0.65, AQo: 0.4, AJs: 0.24, KQs: 0.34,
    },
  },
  {
    depth: 100,
    hands: { AA: 1, KK: 0.98, AKs: 0.95, QQ: 0.72, AKo: 0.65, JJ: 0.08, AQs: 0.08 },
  },
  {
    depth: 200,
    hands: { AA: 1, KK: 0.96, AKs: 0.88, QQ: 0.48, AKo: 0.38, JJ: 0.025, AQs: 0.02 },
  },
] as const;

function threeBetShoveEnter(hand: PreflopHandClass, effectiveStackBb: number) {
  const depth = clamp(effectiveStackBb, 10, 200);
  let lower: (typeof VS_THREE_BET_SHOVE_BY_DEPTH)[number] = VS_THREE_BET_SHOVE_BY_DEPTH[0];
  let upper: (typeof VS_THREE_BET_SHOVE_BY_DEPTH)[number] = VS_THREE_BET_SHOVE_BY_DEPTH.at(-1)!;
  for (let index = 1; index < VS_THREE_BET_SHOVE_BY_DEPTH.length; index += 1) {
    if (depth <= VS_THREE_BET_SHOVE_BY_DEPTH[index].depth) {
      lower = VS_THREE_BET_SHOVE_BY_DEPTH[index - 1];
      upper = VS_THREE_BET_SHOVE_BY_DEPTH[index];
      break;
    }
  }
  const progress = clamp((depth - lower.depth) / Math.max(1, upper.depth - lower.depth));
  const lowerEnter = (lower.hands as Readonly<Partial<Record<PreflopHandClass, number>>>)[hand] ?? 0;
  const upperEnter = (upper.hands as Readonly<Partial<Record<PreflopHandClass, number>>>)[hand] ?? 0;
  return lowerEnter + (upperEnter - lowerEnter) * progress;
}

function threeBetShoveBlend(query: PreflopStrategyQuery, depth: number, facingSize: number) {
  if (query.scenario !== "vs-three-bet") return 0;
  // Blend by chips left behind rather than a narrow raise/depth ratio gate.
  // A one-blind depth change must not abruptly swap a normal 3-bet tree for a
  // shove tree, while an actual effective all-in still reaches the endpoint.
  const remainingBehind = Math.max(0, depth - facingSize);
  const progress = clamp((42 - remainingBehind) / 42);
  return progress * progress * (3 - 2 * progress);
}

type VsOpenAggregateTarget = { enter: number; raise: number };

const BB_VS_UTG_SIZE_ANCHORS = [
  { size: 2, enter: 0.577, raise: 0.042 },
  { size: 2.5, enter: 0.327, raise: 0.054 },
  { size: 3, enter: 0.222, raise: 0.054 },
] as const;

const BB_VS_BTN_SIZE_ANCHORS = [
  { size: 2, enter: 0.787, raise: 0.106 },
  { size: 2.5, enter: 0.575, raise: 0.12 },
  { size: 3, enter: 0.408, raise: 0.132 },
] as const;

// GTO Wizard's published 200BB, 6-max, unraked BB-vs-LJ aggregates. This
// project labels the first six-max seat UTG, so LJ maps to UTG here.
// https://blog.gtowizard.com/preflop-raise-sizing-examining-2-key-factors/
const BB_VS_UTG_200_SIZE_ANCHORS = [
  { size: 2, enter: 0.547, raise: 0.028 },
  { size: 2.5, enter: 0.325, raise: 0.037 },
  { size: 3, enter: 0.228, raise: 0.039 },
] as const;

function interpolateSizeAnchor(
  anchors: readonly { size: number; enter: number; raise: number }[],
  size: number,
): VsOpenAggregateTarget {
  const clampedSize = clamp(size, 1.5, 400);
  if (clampedSize <= anchors[0].size) {
    const first = anchors[0];
    const call = first.enter - first.raise;
    const ratio = first.size / clampedSize;
    return {
      enter: clamp(first.raise * Math.pow(ratio, -0.2) + call * Math.pow(ratio, 1.45)),
      raise: clamp(first.raise * Math.pow(ratio, -0.2)),
    };
  }
  for (let index = 1; index < anchors.length; index += 1) {
    const upper = anchors[index];
    const lower = anchors[index - 1];
    if (clampedSize <= upper.size) {
      const progress = (clampedSize - lower.size) / (upper.size - lower.size);
      return {
        enter: lower.enter + (upper.enter - lower.enter) * progress,
        raise: lower.raise + (upper.raise - lower.raise) * progress,
      };
    }
  }
  const last = anchors.at(-1)!;
  const call = last.enter - last.raise;
  const ratio = clampedSize / last.size;
  const raise = last.raise * Math.pow(ratio, -1.05);
  return { enter: clamp(raise + call * Math.pow(ratio, -1.85)), raise: clamp(raise) };
}

function openShoveBlend(query: PreflopStrategyQuery) {
  const depth = clamp(query.effectiveStackBb ?? 100, 8, 400);
  const size = Math.min(depth, clamp(query.facingSizeBb ?? 2.5, 1, 400));
  const progress = clamp((size - 3) / Math.max(1, depth - 3));
  return progress * progress * (3 - 2 * progress);
}

const OPEN_SHOVE_TARGETS = [
  { depth: 10, tight: 0.16, loose: 0.26 },
  { depth: 15, tight: 0.1, loose: 0.17 },
  { depth: 20, tight: 0.065, loose: 0.11 },
  { depth: 40, tight: 0.035, loose: 0.055 },
  { depth: 100, tight: 0.022, loose: 0.032 },
  { depth: 200, tight: 0.014, loose: 0.02 },
  { depth: 400, tight: 0.01, loose: 0.015 },
] as const;

const STACK_OFF_HAND_SCORES: Readonly<Partial<Record<PreflopHandClass, number>>> = {
  AA: 220,
  KK: 212,
  AKs: 207,
  QQ: 203,
  AKo: 198,
  JJ: 191,
  AQs: 186,
  TT: 181,
  AQo: 176,
  AJs: 172,
  KQs: 169,
  "99": 165,
  ATs: 161,
  KJs: 158,
  AJo: 154,
  QJs: 151,
  "88": 148,
};

function allInDefenseScore(hand: PreflopHandClass) {
  const explicit = STACK_OFF_HAND_SCORES[hand];
  if (explicit !== undefined) return explicit;
  const handTraits = traits(hand);
  // Small pairs retain useful all-in equity, but must never outrank AK/AQ at
  // deep-stack prices.  The previous pair bonus accidentally put 22 ahead of
  // AKo and produced a catastrophically inverted call-off range.
  if (handTraits.pair) return 108 + handTraits.high * 4.5;
  const ace = handTraits.high === 14 ? 18 : 0;
  const king = handTraits.high === 13 ? 5 : 0;
  const suited = handTraits.suited ? 4 : 0;
  const gapPenalty = Math.max(0, handTraits.high - handTraits.low - 1) * 1.8;
  return handTraits.high * 5 + handTraits.low * 3 + ace + king + suited - gapPenalty;
}

function openShoveTarget(query: PreflopStrategyQuery) {
  const depth = Number(clamp(query.effectiveStackBb ?? 100, 8, 400).toFixed(2));
  let lower: (typeof OPEN_SHOVE_TARGETS)[number] = OPEN_SHOVE_TARGETS[0];
  let upper: (typeof OPEN_SHOVE_TARGETS)[number] = OPEN_SHOVE_TARGETS.at(-1)!;
  for (let index = 1; index < OPEN_SHOVE_TARGETS.length; index += 1) {
    if (depth <= OPEN_SHOVE_TARGETS[index].depth) {
      lower = OPEN_SHOVE_TARGETS[index - 1];
      upper = OPEN_SHOVE_TARGETS[index];
      break;
    }
  }
  const progress = clamp((depth - lower.depth) / Math.max(1, upper.depth - lower.depth));
  const tight = lower.tight + (upper.tight - lower.tight) * progress;
  const loose = lower.loose + (upper.loose - lower.loose) * progress;
  const openerLooseness: Record<PreflopPosition, number> = {
    UTG: 0,
    HJ: 0.18,
    CO: 0.52,
    BTN: 1,
    SB: 1.12,
    BB: 1,
  };
  const blindPriceFactor = query.heroPosition === "BB" ? 1 : query.heroPosition === "SB" ? 0.84 : 0.76;
  return clamp((tight + (loose - tight) * openerLooseness[query.aggressorPosition ?? "CO"]) * blindPriceFactor);
}

const OPEN_SHOVE_RANGE_CACHE = new Map<string, number[]>();

function openShoveRange(query: PreflopStrategyQuery) {
  const depth = Number(clamp(query.effectiveStackBb ?? 100, 8, 400).toFixed(2));
  const key = [query.heroPosition, query.aggressorPosition ?? "CO", depth].join("|");
  const cached = OPEN_SHOVE_RANGE_CACHE.get(key);
  if (cached) return cached;
  const target = openShoveTarget({ ...query, effectiveStackBb: depth });
  const candidates = PREFLOP_HAND_CLASSES.map((hand, index) => ({
    hand,
    index,
    score: allInDefenseScore(hand),
  }));
  // Keep support fixed across stack depths. A depth-dependent hard cutoff made
  // a boundary class disappear when the stack moved by 0.1BB, even though the
  // aggregate target itself was smooth. Odds calibration now changes only the
  // temperature inside this stable range; hands below the cutoff remain true
  // folds at every depth.
  const supportFloor = 75;
  const scoreSpan = 220 - supportFloor;
  // Deep open-jams demand a much more top-heavy call-off range than shallow
  // jams. Change the temperature smoothly instead of moving a hard threshold:
  // 22 can defend against some 10BB late-position jams, but becomes effectively
  // pure fold at 100BB without a depth boundary where it suddenly vanishes.
  const depthSelectivity = clamp(Math.log(depth / 10) / Math.log(10), 0, 1.3);
  const shapeExponent = 3.25 + depthSelectivity * 4;
  const seeds = candidates.map((candidate) => (
    candidate.hand === "AA"
      ? 1
      : candidate.score > supportFloor
        ? 0.000_05 + 0.985 * Math.pow(
          clamp((candidate.score - supportFloor) / scoreSpan),
          shapeExponent,
        )
        : 0
  ));
  const factor = oddsFactorForTarget(seeds, target);
  const result = seeds.map((seed) => scaleProbability(seed, factor));
  OPEN_SHOVE_RANGE_CACHE.set(key, result);
  return result;
}

function vsOpenAggregateTarget(query: PreflopStrategyQuery): VsOpenAggregateTarget {
  const aggressor = query.aggressorPosition ?? "CO";
  const size = query.facingSizeBb ?? 2.5;
  let normalTarget: VsOpenAggregateTarget;
  if (query.heroPosition === "BB") {
    const tight = interpolateSizeAnchor(BB_VS_UTG_SIZE_ANCHORS, size);
    const loose = interpolateSizeAnchor(BB_VS_BTN_SIZE_ANCHORS, size);
    const looseness: Record<PreflopPosition, number> = {
      UTG: 0,
      HJ: 0.17,
      CO: 0.54,
      BTN: 1,
      SB: 1.12,
      BB: 1,
    };
    const blend = looseness[aggressor];
    normalTarget = {
      enter: clamp(tight.enter + (loose.enter - tight.enter) * blend),
      raise: clamp(tight.raise + (loose.raise - tight.raise) * blend),
    };
  } else {
    const referenceEnter = VS_OPEN_TARGETS[query.heroPosition][aggressor];
    const referenceRaise = VS_OPEN_RAISE_TARGETS[query.heroPosition][aggressor];
    if (size <= 3) {
      const ratio = size / 2.5;
      const call = Math.max(0, referenceEnter - referenceRaise) * Math.pow(ratio, -1.9);
      const raise = referenceRaise * Math.pow(ratio, 0.28);
      normalTarget = { enter: clamp(call + raise), raise: clamp(raise, 0, call + raise) };
    } else {
      const ratioAtThree = 3 / 2.5;
      const callAtThree = Math.max(0, referenceEnter - referenceRaise) * Math.pow(ratioAtThree, -1.9);
      const raiseAtThree = referenceRaise * Math.pow(ratioAtThree, 0.28);
      const largeRatio = size / 3;
      const call = callAtThree * Math.pow(largeRatio, -1.85);
      const raise = raiseAtThree * Math.pow(largeRatio, -1.05);
      normalTarget = { enter: clamp(call + raise), raise: clamp(raise, 0, call + raise) };
    }
  }
  const depth = clamp(query.effectiveStackBb ?? 100, 10, 400);
  if (Math.abs(depth - 100) < 1e-9) return normalTarget;

  if (query.heroPosition === "BB" && aggressor === "UTG" && depth > 100) {
    const published200 = interpolateSizeAnchor(BB_VS_UTG_200_SIZE_ANCHORS, size);
    if (depth <= 200) {
      const progress = (depth - 100) / 100;
      return {
        enter: normalTarget.enter + (published200.enter - normalTarget.enter) * progress,
        raise: normalTarget.raise + (published200.raise - normalTarget.raise) * progress,
      };
    }
    // No same-tree public 400BB matrix is available. Continue only a small,
    // explicit conservative trend beyond the exact 200BB anchor.
    const progress = clamp((depth - 200) / 200);
    return {
      enter: published200.enter * (1 - 0.02 * progress),
      raise: published200.raise * (1 - 0.18 * progress),
    };
  }

  // Public 100BB action aggregates and the 200BB BB-vs-UTG branch above are
  // hard calibration points. These remaining smooth engineering anchors
  // smooth engineering anchors make the *shape* of the tree stack-aware:
  // shallow stacks realise equity more easily and replace some calls with
  // jams; deep stacks defend only slightly wider while 3-betting less often.
  // They deliberately move totals conservatively because exact commercial
  // stack-by-stack matrices are not public data.
  const depthAnchors = [
    { depth: 10, enter: 1.035, lateEnter: 0.045, raise: 1.55, lateRaise: 0.25 },
    { depth: 20, enter: 1.025, lateEnter: 0.03, raise: 1.35, lateRaise: 0.18 },
    { depth: 40, enter: 1.012, lateEnter: 0.015, raise: 1.17, lateRaise: 0.1 },
    { depth: 100, enter: 1, lateEnter: 0, raise: 1, lateRaise: 0 },
    { depth: 200, enter: 1.01, lateEnter: 0.004, raise: 0.88, lateRaise: 0 },
    { depth: 400, enter: 1.018, lateEnter: 0.007, raise: 0.76, lateRaise: 0 },
  ] as const;
  let lower: (typeof depthAnchors)[number] = depthAnchors[0];
  let upper: (typeof depthAnchors)[number] = depthAnchors.at(-1)!;
  for (let index = 1; index < depthAnchors.length; index += 1) {
    if (depth <= depthAnchors[index].depth) {
      lower = depthAnchors[index - 1];
      upper = depthAnchors[index];
      break;
    }
  }
  const progress = clamp((depth - lower.depth) / Math.max(1, upper.depth - lower.depth));
  const interpolate = (field: "enter" | "lateEnter" | "raise" | "lateRaise") => (
    lower[field] + (upper[field] - lower[field]) * progress
  );
  const aggressorLooseness: Record<PreflopPosition, number> = {
    UTG: 0,
    HJ: 0.18,
    CO: 0.52,
    BTN: 1,
    SB: 1.08,
    BB: 1,
  };
  const looseness = aggressorLooseness[aggressor];
  const enter = clamp(normalTarget.enter * (interpolate("enter") + interpolate("lateEnter") * looseness));
  const raise = clamp(
    normalTarget.raise * (interpolate("raise") + interpolate("lateRaise") * looseness),
    0,
    enter,
  );
  return { enter, raise };
}

function oddsFactorForTarget(values: readonly number[], target: number) {
  const aggregate = (factor: number) => PREFLOP_HAND_CLASSES.reduce(
    (sum, hand, index) => sum + preflopComboCount(hand) * scaleProbability(values[index], factor),
    0,
  ) / 1326;
  let lower = 0.000_001;
  let upper = 1_000_000;
  for (let iteration = 0; iteration < 72; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (aggregate(middle) < target) lower = middle;
    else upper = middle;
  }
  return (lower + upper) / 2;
}

type VsOpenAdjustment = {
  enterFactor: number;
  raiseFactor: number;
  seedEnter: number[];
  seedRaiseShare: number[];
};

const VS_OPEN_ADJUSTMENT_CACHE = new Map<string, VsOpenAdjustment>();

function vsOpenAdjustment(query: PreflopStrategyQuery, chart: MutableChart): VsOpenAdjustment {
  const depth = clamp(query.effectiveStackBb ?? 100, 10, 400);
  const facingSizeBb = clamp(query.facingSizeBb ?? 2.5, 1, 400);
  const calibrationQuery = { ...query, effectiveStackBb: depth, facingSizeBb };
  const depthShift = Math.tanh(Math.log(depth / 100) / 0.85);
  const key = [
    query.heroPosition,
    query.aggressorPosition ?? "CO",
    depth,
    facingSizeBb,
  ].join("|");
  const cached = VS_OPEN_ADJUSTMENT_CACHE.get(key);
  if (cached) return cached;
  const seedEnter = PREFLOP_HAND_CLASSES.map((hand) => {
    const base = chart.get(hand)!;
    const handTraits = traits(hand);
    const pairValue = handTraits.pair ? (handTraits.high - 2) / 12 : 0;
    const speculative = handTraits.suited && handTraits.connected
      ? 1 + depthShift * 0.2
      : handTraits.pair
        ? 1 + depthShift * (0.2 - pairValue * 0.12)
        : 1 - Math.max(0, depthShift) * 0.04;
    return scaleProbability(base.call + base.raise, speculative);
  });
  {
    // A stable low-frequency tail gives every cheap-open chart enough legal
    // support without admitting whole classes as the size crosses a magic
    // decimal. This matters outside the BB too: a BTN-vs-HJ 2x target can be
    // slightly wider than the static 2.5x support. At normal prices these
    // seeds remain tiny; cheaper prices continuously warm the same ordering.
    // The true bottom of the deck still remains zero. Every other hand keeps
    // a tiny, ordered seed. This fixed support is important at shallow stacks:
    // a 2x blind-vs-blind target can exceed the old static chart's support,
    // causing the calibration factor to hit its ceiling and an edge hand to
    // jump several percentage points when the open grew by just 0.01BB.
    const tailWarmth: Record<PreflopPosition, number> = {
      UTG: 0,
      HJ: 0.18,
      CO: 0.52,
      BTN: 1,
      SB: 1.12,
      BB: 1,
    };
    const warmth = tailWarmth[query.aggressorPosition ?? "CO"];
    for (const [index, hand] of PREFLOP_HAND_CLASSES.entries()) {
      if (seedEnter[index] > 0) continue;
      const score = blindDefenseScore(hand);
      if (hand === "72o") continue;
      const quality = clamp((score - 18) / (164 - 18));
      if (query.heroPosition === "BB") {
        // The BB receives the widest tail against late-position opens because
        // its discount and closing action make many marginal calls viable.
        seedEnter[index] = 0.004 + 0.011 * warmth
          + (0.008 + 0.012 * warmth) * Math.pow(quality, 2);
      } else {
        seedEnter[index] = 0.004 + 0.012 * Math.pow(quality, 2);
      }
    }
  }
  const seedRaiseShare = PREFLOP_HAND_CLASSES.map((hand, index) => {
    const base = chart.get(hand)!;
    const baseEnter = base.call + base.raise;
    let share = baseEnter > 0 ? base.raise / baseEnter : 0;
    const floor = aceTenVsOpenRaiseShareFloor({ ...calibrationQuery, hand }, depthShift);
    share = Math.max(share, floor);
    if (hand === "AA") share = 0.98;
    return seedEnter[index] > 0 ? share : 0;
  });
  const target = vsOpenAggregateTarget(calibrationQuery);
  const enterFactor = oddsFactorForTarget(seedEnter, target.enter);
  const adjustedEnter = seedEnter.map((enter) => scaleProbability(enter, enterFactor));
  const raiseAtFactor = (factor: number) => PREFLOP_HAND_CLASSES.reduce((sum, hand, index) => (
    sum + preflopComboCount(hand) * adjustedEnter[index] * scaleProbability(seedRaiseShare[index], factor)
  ), 0) / 1326;
  let lower = 0.000_001;
  let upper = 1_000_000;
  for (let iteration = 0; iteration < 72; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (raiseAtFactor(middle) < target.raise) lower = middle;
    else upper = middle;
  }
  const result = { enterFactor, raiseFactor: (lower + upper) / 2, seedEnter, seedRaiseShare };
  VS_OPEN_ADJUSTMENT_CACHE.set(key, result);
  return result;
}

function calibratedVsOpenHand(
  query: PreflopStrategyQuery,
  chart: MutableChart,
  facingSizeBb: number,
) {
  const calibrationQuery = { ...query, facingSizeBb };
  const adjustment = vsOpenAdjustment(calibrationQuery, chart);
  const index = PREFLOP_HAND_CLASSES.indexOf(query.hand);
  let enter = scaleProbability(adjustment.seedEnter[index], adjustment.enterFactor);
  let raiseShare = scaleProbability(adjustment.seedRaiseShare[index], adjustment.raiseFactor);
  if (query.hand === "AA") {
    enter = 1;
    raiseShare = 0.98;
  }
  if (query.hand === "ATo" && query.heroPosition === "HJ" && query.aggressorPosition === "UTG") {
    enter = Math.min(enter, 0.14);
    raiseShare = Math.min(raiseShare, 0.14);
  }
  return { enter, raise: enter * raiseShare };
}

function adjustedVsOpenFrequencies(query: PreflopStrategyQuery, chart: MutableChart) {
  const depth = clamp(query.effectiveStackBb ?? 100, 10, 400);
  const effectiveSize = Math.min(depth, clamp(query.facingSizeBb ?? 2.5, 1, 400));
  let enter: number;
  let raise: number;

  if (query.heroPosition === "BB" && effectiveSize >= 2 && effectiveSize <= 3) {
    // Solve the published 2x/2.5x/3x nodes, then interpolate each hand's
    // absolute enter and raise probabilities. Interpolating conditional raise
    // shares would distort the combo-weighted action totals. The aggregate BB
    // anchors are piecewise linear over these same intervals, so this convex
    // interpolation is simultaneously legal, target-preserving and gives a
    // strict 2pp/0.01BB worst-case continuity bound for every hand.
    const lowerSize = effectiveSize <= 2.5 ? 2 : 2.5;
    const upperSize = effectiveSize <= 2.5 ? 2.5 : 3;
    const progress = (effectiveSize - lowerSize) / (upperSize - lowerSize);
    const lower = calibratedVsOpenHand(query, chart, lowerSize);
    const upper = calibratedVsOpenHand(query, chart, upperSize);
    enter = lower.enter + (upper.enter - lower.enter) * progress;
    raise = lower.raise + (upper.raise - lower.raise) * progress;
  } else {
    ({ enter, raise } = calibratedVsOpenHand(query, chart, effectiveSize));
  }

  if (effectiveSize > 3) {
    // Beyond a conventional open, interpolate from the legal 3BB strategy to
    // a depth/position-specific call-off range.  This keeps every hand and the
    // aggregate range monotone as the price grows, and reaches a true
    // fold/call endpoint when the opener is all-in.
    const threeQuery = { ...query, effectiveStackBb: depth, facingSizeBb: 3 };
    const atThree = calibratedVsOpenHand(threeQuery, chart, 3);
    const enterAtThree = atThree.enter;
    const raiseShareAtThree = atThree.enter > 0 ? atThree.raise / atThree.enter : 0;
    const index = PREFLOP_HAND_CLASSES.indexOf(query.hand);
    const terminalEnter = Math.min(openShoveRange({ ...query, effectiveStackBb: depth })[index], enterAtThree);
    const shoveBlend = openShoveBlend({ ...query, effectiveStackBb: depth, facingSizeBb: effectiveSize });
    const priceDecay = Math.exp(-0.3 * Math.max(0, effectiveSize - 3));
    enter = terminalEnter + (enterAtThree - terminalEnter) * (1 - shoveBlend) * priceDecay;
    const raiseShare = raiseShareAtThree
      * (1 - shoveBlend)
      * Math.exp(-0.08 * Math.max(0, effectiveSize - 3));
    raise = enter * raiseShare;
  }
  return normalized({ fold: 1 - enter, call: enter - raise, raise });
}

function adjustedReferenceFrequencies(query: PreflopStrategyQuery, base: PreflopFrequencies) {
  const handTraits = traits(query.hand);
  const depth = clamp(query.effectiveStackBb ?? 100, 10, 400);
  const depthShift = Math.tanh(Math.log(depth / 100) / 0.85);
  const referenceSize = query.scenario === "vs-three-bet" ? 9 : 22;
  const facingSize = clamp(query.facingSizeBb ?? referenceSize, 1, 400);
  const sizeLogRatio = Math.log(facingSize / referenceSize);
  const sizeElasticity = 0.72;
  const sizeFactor = Math.exp(-sizeElasticity * sizeLogRatio);
  const positionFactor = query.scenario === "vs-three-bet"
      ? 1
      : HERO_POSITION_FACTOR[query.heroPosition]
        * AGGRESSOR_POSITION_FACTOR[query.aggressorPosition ?? "CO"];
  const pairSpeculation = handTraits.pair
    ? 0.1 + (14 - handTraits.high) / 12 * 0.14
    : 0;
  const speculationSensitivity = handTraits.suited && handTraits.connected
    ? 0.24
    : pairSpeculation;
  const speculationFactor = speculationSensitivity > 0
    ? 1 + depthShift * speculationSensitivity
    : 1 - Math.max(0, depthShift) * 0.04;
  const totalEnter = base.call + base.raise;
  let adjustedEnter = scaleProbability(totalEnter, positionFactor * sizeFactor * speculationFactor);
  const shoveBlend = threeBetShoveBlend(query, depth, facingSize);
  if (shoveBlend > 0) {
    const shoveEnter = threeBetShoveEnter(query.hand, depth);
    adjustedEnter = adjustedEnter * (1 - shoveBlend) + shoveEnter * shoveBlend;
  }
  let raiseShare = totalEnter > 0 ? base.raise / totalEnter : 0;
  if (handTraits.wheelAce) {
    const referenceBoost = query.scenario === "vs-three-bet" ? 1 : 1.08;
    raiseShare = clamp(raiseShare * (referenceBoost + Math.max(0, -depthShift) * 0.08), 0, 0.92);
  }
  if (query.scenario !== "vs-three-bet") {
    if (query.heroPosition === "SB") raiseShare = clamp(raiseShare * 1.18, 0, 0.98);
    if (query.heroPosition === "BB") raiseShare = clamp(raiseShare * 0.78, 0, 0.98);
  }
  // Do not impose a fixed floor on KK/QQ/AK: facing-size and effective-stack
  // pressure must still be allowed to move those hands at extreme nodes.
  // AA is the sole unconditional anchor below.
  if (query.hand === "AA") {
    adjustedEnter = 1;
    raiseShare = query.scenario === "vs-three-bet" ? 0.9 : 0.94;
  }
  const raise = adjustedEnter * raiseShare;
  return normalized({ fold: 1 - adjustedEnter, call: adjustedEnter - raise, raise });
}

function adjustedRfiFrequencies(query: PreflopStrategyQuery, base: PreflopFrequencies) {
  const depth = clamp(query.effectiveStackBb ?? 100, 8, 400);
  if (query.hand === "AA" && Math.abs(depth - 100) < 0.001) {
    return { fold: 0.001, check: 0, call: 0, raise: 0.999 };
  }
  if (Math.abs(depth - 100) < 0.001) return { ...base };
  const handTraits = traits(query.hand);
  const shallow = clamp((28 - depth) / 20);
  const deep = clamp(Math.log2(depth / 100) / 2);
  const pairQuality = handTraits.pair ? (handTraits.high - 2) / 12 : 0;
  const broadway = handTraits.high >= 11 && handTraits.low >= 10;
  const aceHigh = handTraits.high === 14;
  let factor = 1;
  if (shallow > 0) {
    const speculativePenalty = handTraits.suited && handTraits.connected
      ? 0.3
      : handTraits.pair
        ? 0.26 * (1 - pairQuality)
        : 0;
    const highCardBoost = broadway || aceHigh ? 0.08 : 0;
    factor *= 1 - shallow * speculativePenalty + shallow * highCardBoost;
  }
  if (deep > 0) {
    const impliedOddsBoost = handTraits.suited && handTraits.connected
      ? 0.16
      : handTraits.pair
        ? 0.14 * (1 - pairQuality * 0.65)
        : 0;
    factor *= 1 + deep * impliedOddsBoost;
  }
  let enter = scaleProbability(base.call + base.raise, factor);
  let raiseShare = enter > 0 ? base.raise / Math.max(0.000_001, base.call + base.raise) : 0;
  if (query.hand === "AA") {
    enter = 1;
    raiseShare = Math.max(raiseShare, 0.97);
  }
  const raise = enter * raiseShare;
  return normalized({ fold: 1 - enter, call: enter - raise, raise });
}

function adjustedVsLimpFrequencies(query: PreflopStrategyQuery, base: PreflopFrequencies) {
  const limpers = Math.max(1, Math.round(query.limpers ?? 1));
  const handTraits = traits(query.hand);
  const enter = scaleProbability(
    base.call + base.raise,
    Math.pow(0.95, limpers - 1) * (handTraits.suited || handTraits.pair ? 1.03 : 0.98),
  );
  let raiseShare = base.call + base.raise > 0 ? base.raise / (base.call + base.raise) : 0;
  const premium = handTraits.pair && handTraits.high >= 10
    || handTraits.high === 14 && handTraits.low >= 12;
  raiseShare = scaleProbability(raiseShare, premium ? 1 + limpers * 0.16 : Math.pow(0.91, limpers - 1));
  if ((query.heroPosition === "CO" || query.heroPosition === "BTN") && handTraits.suited && handTraits.connected) {
    raiseShare = scaleProbability(raiseShare, 1.18);
  }
  if (query.hand === "AA") raiseShare = Math.max(raiseShare, 0.94);
  const raise = enter * raiseShare;
  return normalized({ fold: 1 - enter, call: enter - raise, raise });
}

function adjustedThreeBetResponseByRole(
  query: PreflopStrategyQuery,
  openerFrequencies: PreflopFrequencies,
) {
  const role = query.responseRole ?? "opener";
  if (role === "opener") return openerFrequencies;
  const handTraits = traits(query.hand);
  const depth = clamp(query.effectiveStackBb ?? 100, 10, 400);
  const deep = clamp(Math.log2(depth / 100) / 2, -0.6, 1);
  const openerEnter = openerFrequencies.call + openerFrequencies.raise;
  const openerRaiseShare = openerEnter > 0 ? openerFrequencies.raise / openerEnter : 0;

  const anchors: Readonly<Partial<Record<PreflopHandClass, [number, number]>>> = role === "cold-entry"
    ? {
        AA: [1, 0.9], KK: [0.99, 0.82], QQ: [0.92, 0.55], AKs: [0.97, 0.68],
        AKo: [0.82, 0.5], JJ: [0.68, 0.28], AQs: [0.62, 0.24], TT: [0.34, 0.12],
        AQo: [0.24, 0.08], AJs: [0.2, 0.08], KQs: [0.24, 0.07], "99": [0.14, 0.04],
      }
    : {
        AA: [1, 0.82], KK: [0.99, 0.72], QQ: [0.94, 0.42], AKs: [0.98, 0.58],
        AKo: [0.86, 0.38], JJ: [0.78, 0.2], AQs: [0.72, 0.18], TT: [0.58, 0.08],
        AQo: [0.43, 0.06], AJs: [0.46, 0.06], KQs: [0.5, 0.05], "99": [0.38, 0.035],
      };
  const anchor = anchors[query.hand];
  if (anchor) {
    const [referenceEnter, raiseShare] = anchor;
    const depthFactor = handTraits.pair && handTraits.high <= 10 ? 1 + deep * 0.12 : 1;
    const anchoredEnter = scaleProbability(referenceEnter, depthFactor);
    const facingSize = Math.min(depth, clamp(query.facingSizeBb ?? 9, 1, 400));
    let adjustedEnter: number;
    let adjustedRaiseShare: number;
    const terminal = threeBetShoveEnter(query.hand, depth);
    const roleTerminal = query.hand === "AA"
      ? 1
      : scaleProbability(terminal, role === "cold-caller" ? 0.92 : 0.78);
    if (facingSize <= 9) {
      const priceFactor = Math.pow(Math.max(0.15, facingSize / 9), -0.72);
      adjustedEnter = scaleProbability(anchoredEnter, priceFactor);
      adjustedRaiseShare = raiseShare;
    } else {
      const progress = clamp((facingSize - 9) / Math.max(1, depth - 9));
      const remainingNormalTree = Math.pow(1 - progress, 1.6);
      adjustedEnter = roleTerminal + (anchoredEnter - roleTerminal) * remainingNormalTree;
      adjustedRaiseShare = raiseShare * Math.pow(1 - progress, 0.9);
    }
    const shovePressure = threeBetShoveBlend(query, depth, facingSize);
    adjustedEnter = adjustedEnter * (1 - shovePressure) + roleTerminal * shovePressure;
    adjustedRaiseShare *= 1 - shovePressure;
    return normalized({
      fold: 1 - adjustedEnter,
      call: adjustedEnter * (1 - adjustedRaiseShare),
      raise: adjustedEnter * adjustedRaiseShare,
    });
  }

  const speculative = handTraits.suited && handTraits.connected || handTraits.pair;
  const roleFactor = role === "cold-caller"
    ? speculative ? 0.14 + Math.max(0, deep) * 0.08 : 0.08
    : speculative ? 0.006 + Math.max(0, deep) * 0.004 : 0.003;
  let enter = scaleProbability(openerEnter, roleFactor);
  let raiseShare = scaleProbability(openerRaiseShare, role === "cold-caller" ? 0.55 : 0.28);
  const shovePressure = threeBetShoveBlend(query, depth, Math.min(depth, clamp(query.facingSizeBb ?? 9, 1, 400)));
  if (shovePressure > 0) {
    const terminal = scaleProbability(
      threeBetShoveEnter(query.hand, depth),
      role === "cold-caller" ? 0.92 : 0.78,
    );
    enter = enter * (1 - shovePressure) + terminal * shovePressure;
    raiseShare *= 1 - shovePressure;
  }
  const raise = enter * raiseShare;
  return normalized({ fold: 1 - enter, call: enter - raise, raise });
}

export function getPreflopStrategy(query: PreflopStrategyQuery): PreflopStrategy {
  if (!HAND_CLASS_SET.has(query.hand)) throw new RangeError(`未知起手牌类别：${query.hand}`);
  if (!PREFLOP_POSITIONS.includes(query.heroPosition)) throw new RangeError(`未知位置：${query.heroPosition}`);
  let frequencies: PreflopFrequencies;
  if (query.scenario === "rfi") {
    frequencies = adjustedRfiFrequencies(query, RFI[query.heroPosition].get(query.hand)!);
  } else if (query.scenario === "vs-limp") {
    frequencies = adjustedVsLimpFrequencies(query, VS_LIMP[query.heroPosition].get(query.hand)!);
  } else if (query.scenario === "vs-open") {
    const chart = VS_OPEN[query.heroPosition][query.aggressorPosition ?? "CO"];
    frequencies = adjustedVsOpenFrequencies(query, chart);
  } else {
    const chart = query.scenario === "vs-three-bet"
        ? VS_THREE_BET[query.heroPosition][query.aggressorPosition ?? "CO"]
        : VS_FOUR_BET;
    frequencies = adjustedReferenceFrequencies(query, chart.get(query.hand)!);
    if (query.scenario === "vs-three-bet") {
      frequencies = adjustedThreeBetResponseByRole(query, frequencies);
    }
  }
  return {
    hand: query.hand,
    scenario: query.scenario,
    frequencies,
    enterFrequency: frequencies.call + frequencies.raise,
    raiseFrequency: frequencies.raise,
  };
}

export function summarizePreflopRange(query: Omit<PreflopStrategyQuery, "hand">): PreflopRangeSummary {
  const weighted: PreflopFrequencies = { fold: 0, check: 0, call: 0, raise: 0 };
  for (const hand of PREFLOP_HAND_CLASSES) {
    const combos = preflopComboCount(hand);
    const strategy = getPreflopStrategy({ ...query, hand });
    for (const action of Object.keys(weighted) as PreflopAction[]) {
      weighted[action] += combos * strategy.frequencies[action];
    }
  }
  const enterCombos = weighted.call + weighted.raise;
  return {
    totalCombos: 1326,
    foldCombos: weighted.fold,
    checkCombos: weighted.check,
    callCombos: weighted.call,
    raiseCombos: weighted.raise,
    enterCombos,
    frequencies: normalized(Object.fromEntries(
      (Object.keys(weighted) as PreflopAction[]).map((action) => [action, weighted[action] / 1326]),
    )),
    enterFrequency: enterCombos / 1326,
  };
}
