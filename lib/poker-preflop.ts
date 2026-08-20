export const PREFLOP_POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"] as const;

export type PreflopPosition = typeof PREFLOP_POSITIONS[number];
export type PreflopScenario = "rfi" | "vs-open" | "vs-three-bet" | "vs-four-bet";
export type PreflopAction = "fold" | "check" | "call" | "raise";
export type PreflopHandClass = string;

export type PreflopFrequencies = Record<PreflopAction, number>;

export type PreflopStrategyQuery = {
  hand: PreflopHandClass;
  scenario: PreflopScenario;
  heroPosition: PreflopPosition;
  /** Position of the opener for vs-open, or the latest raiser for later branches. */
  aggressorPosition?: PreflopPosition;
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

function buildRfiCharts() {
  const utg = emptyChart();
  setRaise(utg, ["AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "AKs", "AQs", "AJs", "ATs", "AKo", "AQo", "KQs", "KJs", "KTs", "QJs"], 0.995);
  setRaise(utg, ["66", "A5s", "QTs", "JTs"], 0.82);
  setRaise(utg, ["55", "A4s", "AJo", "T9s"], 0.62);
  setRaise(utg, ["44", "A9s", "A3s", "K9s", "J9s", "98s"], 0.36);
  setRaise(utg, ["33", "22", "A8s", "A7s", "A6s", "A2s", "ATo", "87s", "76s", "65s"], 0.18);
  setRaise(utg, ["KJo", "QJo"], 0.04);

  const hj = cloneChart(utg);
  setRaise(hj, ["AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "AKs", "AQs", "AJs", "ATs", "AKo", "AQo", "AJo", "KQs", "KJs", "KTs", "QJs", "QTs", "JTs"], 0.995);
  setRaise(hj, ["66", "55", "A9s", "A5s", "A4s", "K9s", "KQo", "J9s", "T9s", "98s"], 0.84);
  setRaise(hj, ["44", "33", "22", "A8s", "A7s", "A6s", "A3s", "A2s", "ATo", "KJo", "Q9s", "87s", "76s"], 0.48);
  setRaise(hj, ["QJo", "T8s", "65s", "54s"], 0.24);

  const co = cloneChart(hj);
  setRaise(co, ["AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55", "44", "33", "22", "AKs", "AQs", "AJs", "ATs", "A9s", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "AKo", "AQo", "AJo", "ATo", "KQs", "KJs", "KTs", "K9s", "KQo", "KJo", "QJs", "QTs", "Q9s", "QJo", "JTs", "J9s", "T9s", "98s", "87s"], 0.97);
  setRaise(co, ["A2s", "A9o", "K8s", "K7s", "KTo", "Q8s", "QTo", "J8s", "JTo", "T8s", "T7s", "97s", "86s", "76s", "65s", "54s"], 0.68);
  setRaise(co, ["A8o", "A7o", "K6s", "Q7s", "J7s", "98o", "75s", "64s", "53s"], 0.28);

  const btn = cloneChart(co);
  setRaise(btn, ["AA", "KK", "QQ", "JJ", "TT", "99", "88", "77", "66", "55", "44", "33", "22"], 0.995);
  setRaise(btn, ["AKs", "AQs", "AJs", "ATs", "A9s", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s", "AKo", "AQo", "AJo", "ATo", "A9o", "KQs", "KJs", "KTs", "K9s", "K8s", "K7s", "KQo", "KJo", "KTo", "QJs", "QTs", "Q9s", "Q8s", "QJo", "QTo", "JTs", "J9s", "J8s", "JTo", "T9s", "T8s", "98s", "97s", "87s", "86s", "76s", "75s", "65s", "64s", "54s"], 0.98);
  setRaise(btn, ["A8o", "A7o", "A6o", "A5o", "K6s", "K5s", "K9o", "Q7s", "Q9o", "J7s", "J9o", "T7s", "T9o", "96s", "98o", "85s", "74s", "63s", "53s", "43s"], 0.74);
  setRaise(btn, ["A4o", "A3o", "A2o", "K4s", "K3s", "K2s", "K8o", "Q6s", "Q5s", "Q8o", "J6s", "J8o", "T6s", "T8o", "95s", "97o", "84s", "76o", "73s", "65o", "52s", "42s", "32s"], 0.38);

  // Combo-weighted no-rake baselines. Calibration changes only frequencies of
  // explicitly charted hands; it never admits a hand absent from that chart.
  calibrateEnterRange(utg, 0.17);
  calibrateEnterRange(hj, 0.195);
  calibrateEnterRange(co, 0.29);
  calibrateEnterRange(btn, 0.47);
  // Preserve explicit early-position offsuit-broadway exclusions rather than
  // letting aggregate range calibration pull them through the boundary.
  setRaise(utg, ["KJo", "QJo"], 0.04);

  const sb = emptyChart();
  for (const hand of PREFLOP_HAND_CLASSES) {
    const buttonRaise = btn.get(hand)!.raise;
    const cutoffRaise = co.get(hand)!.raise;
    const raise = clamp(cutoffRaise * 0.72 + buttonRaise * 0.18);
    const complete = clamp((buttonRaise - raise) * 0.72 + (buttonRaise > 0 ? 0.08 : 0), 0, 1 - raise);
    sb.set(hand, normalized({ fold: 1 - raise - complete, call: complete, raise }));
  }
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
  setMix(chart, ["22"], 0.82, 0.06);
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
const VS_OPEN = buildVsOpenReference();
const VS_THREE_BET = buildVsThreeBetReference();
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

function adjustedReferenceFrequencies(query: PreflopStrategyQuery, base: PreflopFrequencies) {
  const handTraits = traits(query.hand);
  const depth = clamp(query.effectiveStackBb ?? 100, 10, 400);
  const depthShift = Math.tanh(Math.log(depth / 100) / 0.85);
  const referenceSize = query.scenario === "vs-open" ? 2.5 : query.scenario === "vs-three-bet" ? 9 : 22;
  const facingSize = clamp(query.facingSizeBb ?? referenceSize, 1, 400);
  const sizeFactor = Math.exp(-0.72 * Math.log(facingSize / referenceSize));
  const positionFactor = HERO_POSITION_FACTOR[query.heroPosition]
    * AGGRESSOR_POSITION_FACTOR[query.aggressorPosition ?? "CO"];
  const speculationFactor = handTraits.smallPair || handTraits.suited && handTraits.connected
    ? 1 + depthShift * 0.24
    : 1 - Math.max(0, depthShift) * 0.04;
  const totalEnter = base.call + base.raise;
  let adjustedEnter = scaleProbability(totalEnter, positionFactor * sizeFactor * speculationFactor);
  let raiseShare = totalEnter > 0 ? base.raise / totalEnter : 0;
  if (handTraits.wheelAce) {
    raiseShare = clamp(raiseShare * (1.08 + Math.max(0, -depthShift) * 0.08), 0, 0.92);
  }
  if (query.heroPosition === "SB") raiseShare = clamp(raiseShare * 1.18, 0, 0.98);
  if (query.heroPosition === "BB") raiseShare = clamp(raiseShare * 0.78, 0, 0.98);
  // Do not impose a fixed floor on KK/QQ/AK: facing-size and effective-stack
  // pressure must still be allowed to move those hands at extreme nodes.
  // AA is the sole unconditional anchor below.
  if (query.hand === "AA") {
    adjustedEnter = 1;
    raiseShare = query.scenario === "vs-open" ? 0.98 : query.scenario === "vs-three-bet" ? 0.9 : 0.94;
  }
  const raise = adjustedEnter * raiseShare;
  return normalized({ fold: 1 - adjustedEnter, call: adjustedEnter - raise, raise });
}

export function getPreflopStrategy(query: PreflopStrategyQuery): PreflopStrategy {
  if (!HAND_CLASS_SET.has(query.hand)) throw new RangeError(`未知起手牌类别：${query.hand}`);
  if (!PREFLOP_POSITIONS.includes(query.heroPosition)) throw new RangeError(`未知位置：${query.heroPosition}`);
  let frequencies: PreflopFrequencies;
  if (query.scenario === "rfi") {
    frequencies = { ...RFI[query.heroPosition].get(query.hand)! };
  } else {
    const chart = query.scenario === "vs-open"
      ? VS_OPEN
      : query.scenario === "vs-three-bet"
        ? VS_THREE_BET
        : VS_FOUR_BET;
    frequencies = adjustedReferenceFrequencies(query, chart.get(query.hand)!);
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
