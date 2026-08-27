#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  AI_PROFILES,
  AI_STYLE_OPTIONS,
  adaptAiProfileToHeroImage,
  heroNodePressure,
  heroPublicActionSignals,
  heroResponseRead,
  updateHeroTableImage,
} from "../lib/poker-ai.ts";
import {
  chooseAdaptivePokerPolicyAction,
  evaluateAdaptivePokerPolicy,
  pokerPolicyTotalVariation,
} from "../lib/poker-adaptive-policy.ts";
import { seededRandom } from "./ai-self-play.mjs";

const RESPONSE_CONTEXT = {
  node: "river_vs_bet",
  size: "medium",
  position: "oop",
  tableShape: "heads_up",
  depth: "standard",
};

const RIVER_BLUFF_SPOT = {
  profile: AI_PROFILES.gto,
  street: "river",
  equity: 0.2,
  handStrength: 0.1,
  draw: 0,
  blockers: 0.13,
  pot: 100,
  toCall: 0,
  potOdds: 0,
  inPosition: true,
  activeOpponents: 1,
  opponentsCanRespond: true,
  callEndsHand: false,
  effectiveStackBb: 70,
  startingDepthBb: 100,
  highestBet: 0,
  playerBet: 0,
  playerStack: 700,
  maxContestableTarget: 700,
  minRaise: 10,
  raiseLocked: false,
  squidPressure: 0,
  bigBlind: 10,
  boardWetness: 0.25,
  boardPairing: 0,
  boardHighCard: 0.8,
  initiative: false,
  streetRaiseCount: 0,
};

const RIVER_VALUE_SPOT = {
  ...RIVER_BLUFF_SPOT,
  equity: 0.86,
  handStrength: 0.93,
  blockers: 0.04,
  initiative: true,
};

const PREFLOP_DEFENSE_SPOT = {
  profile: AI_PROFILES.gto,
  street: "preflop",
  equity: 0.34,
  handStrength: 0.34,
  draw: 0,
  blockers: 0.03,
  pot: 40,
  toCall: 15,
  potOdds: 15 / 55,
  inPosition: false,
  activeOpponents: 1,
  opponentsCanRespond: true,
  callEndsHand: false,
  effectiveStackBb: 99,
  startingDepthBb: 100,
  highestBet: 25,
  playerBet: 10,
  playerStack: 990,
  maxContestableTarget: 1_000,
  minRaise: 15,
  raiseLocked: false,
  squidPressure: 0,
  bigBlind: 10,
  preflopPercentile: 0.55,
  preflopPosition: "BB",
  preflopPositionFactor: 1.35,
  preflopRaiseCount: 1,
  preflopOpenerPosition: "BTN",
  preflopLimpers: 0,
  preflopColdCallers: 0,
  preflopPreviouslyRaised: false,
  preflopHand: { highRank: 12, lowRank: 4, pair: false, suited: true, gap: 8 },
  boardWetness: 0,
  boardPairing: 0,
  boardHighCard: 0,
  initiative: false,
  streetRaiseCount: 1,
};

function emptyImage() {
  return {
    loose: 0.5,
    aggressive: 0.5,
    deceptive: 0.5,
    observations: 0,
    pressure: {},
    responses: {},
  };
}

function observeResponse(action, count) {
  let image = emptyImage();
  for (let index = 0; index < count; index += 1) {
    image = updateHeroTableImage(
      image,
      heroPublicActionSignals(action),
      undefined,
      { context: RESPONSE_CONTEXT, action },
    );
  }
  return image;
}

function observeResponseRegimeSwitch() {
  let image = observeResponse("fold", 1_000);
  for (let index = 0; index < 100; index += 1) {
    image = updateHeroTableImage(
      image,
      heroPublicActionSignals("call"),
      undefined,
      { context: RESPONSE_CONTEXT, action: "call" },
    );
  }
  return image;
}

function observeOpenPressure(count) {
  let image = emptyImage();
  for (let index = 0; index < count; index += 1) {
    image = updateHeroTableImage(
      image,
      heroPublicActionSignals("raise"),
      { node: "preflop_open", aggressive: true },
    );
  }
  return image;
}

function neutralAdaptation(styleKey) {
  return {
    ...AI_PROFILES[styleKey],
    confidence: 0,
    pressureResponse: 0,
    responseConfidence: 0,
    overfoldResponse: 0,
    underfoldResponse: 0,
    counterRaiseResponse: 0,
    exploitWeight: 0,
  };
}

function sampleActions(input, styleKey, adaptedProfile, samples, seed) {
  const random = seededRandom(seed);
  const counts = { fold: 0, check: 0, call: 0, raise: 0 };
  for (let index = 0; index < samples; index += 1) {
    counts[chooseAdaptivePokerPolicyAction(input, { styleKey, adaptedProfile }, random).kind] += 1;
  }
  return Object.fromEntries(Object.entries(counts).map(([kind, count]) => [kind, count / samples]));
}

function styleResult({ scenario, input, image, options, samples, seed, primaryMetric }) {
  return AI_STYLE_OPTIONS.map(({ styleKey, style }) => {
    const baselineProfile = neutralAdaptation(styleKey);
    const adaptedProfile = adaptAiProfileToHeroImage(styleKey, image, options);
    const baseline = evaluateAdaptivePokerPolicy(input, { styleKey, adaptedProfile: baselineProfile });
    const adapted = evaluateAdaptivePokerPolicy(input, { styleKey, adaptedProfile });
    return {
      scenario,
      styleKey,
      style,
      exploitWeight: adapted.exploitWeight,
      actionTv: pokerPolicyTotalVariation(
        baseline.actionFrequencies,
        adapted.actionFrequencies,
      ),
      baseline: baseline.actionFrequencies,
      adapted: adapted.actionFrequencies,
      primaryMetric,
      baselinePrimary: primaryMetric === "continue"
        ? baseline.actionFrequencies.call + baseline.actionFrequencies.raise
        : baseline.actionFrequencies.raise,
      adaptedPrimary: primaryMetric === "continue"
        ? adapted.actionFrequencies.call + adapted.actionFrequencies.raise
        : adapted.actionFrequencies.raise,
      sampled: sampleActions(
        input,
        styleKey,
        adaptedProfile,
        samples,
        `${seed}:${scenario}:${styleKey}`,
      ),
    };
  });
}

export function runAdaptationBenchmark(options = {}) {
  const samples = Number(options.samples ?? 5_000);
  const seed = String(options.seed ?? "rangecraft-adaptation-2026");
  if (!Number.isInteger(samples) || samples < 100) throw new Error("samples 必须是至少 100 的整数");
  const overfoldImage = observeResponse("fold", 50);
  const stationImage = observeResponse("call", 50);
  const switchedStationImage = observeResponseRegimeSwitch();
  const pressureImage = observeOpenPressure(24);
  const overfoldRead = heroResponseRead(overfoldImage, RESPONSE_CONTEXT);
  const stationRead = heroResponseRead(stationImage, RESPONSE_CONTEXT);
  const scenarios = [
    ...styleResult({
      scenario: "river-overfold-bluff",
      input: RIVER_BLUFF_SPOT,
      image: overfoldImage,
      options: {
        heroActive: true,
        facingHero: false,
        intensity: 1.5,
        responseContext: RESPONSE_CONTEXT,
      },
      samples,
      seed,
      primaryMetric: "raise",
    }),
    ...styleResult({
      scenario: "river-station-bluff",
      input: RIVER_BLUFF_SPOT,
      image: stationImage,
      options: {
        heroActive: true,
        facingHero: false,
        intensity: 1.5,
        responseContext: RESPONSE_CONTEXT,
      },
      samples,
      seed,
      primaryMetric: "raise",
    }),
    ...styleResult({
      scenario: "river-station-value",
      input: RIVER_VALUE_SPOT,
      image: stationImage,
      options: {
        heroActive: true,
        facingHero: false,
        intensity: 1.5,
        responseContext: RESPONSE_CONTEXT,
      },
      samples,
      seed,
      primaryMetric: "raise",
    }),
    ...styleResult({
      scenario: "river-regime-switch-bluff",
      input: RIVER_BLUFF_SPOT,
      image: switchedStationImage,
      options: {
        heroActive: true,
        facingHero: false,
        intensity: 1.5,
        responseContext: RESPONSE_CONTEXT,
      },
      samples,
      seed,
      primaryMetric: "raise",
    }),
    ...styleResult({
      scenario: "preflop-open-pressure-defense",
      input: PREFLOP_DEFENSE_SPOT,
      image: pressureImage,
      options: {
        heroActive: true,
        facingHero: true,
        intensity: 1.5,
        pressureNode: "preflop_open",
      },
      samples,
      seed,
      primaryMetric: "continue",
    }),
  ];
  return {
    config: { samples, seed, styles: AI_STYLE_OPTIONS.length },
    evidence: {
      overfold: overfoldRead,
      station: stationRead,
      switchedStation: heroResponseRead(switchedStationImage, RESPONSE_CONTEXT),
      openPressure: heroNodePressure(pressureImage, "preflop_open"),
    },
    scenarios,
  };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatAdaptationReport(report) {
  const lines = [
    "RangeCraft 动态电脑行动频率审计",
    `${report.config.styles} 种风格 · 每场景/风格 ${report.config.samples.toLocaleString("zh-CN")} 次可重复抽样 · seed=${report.config.seed}`,
    `公开证据：河牌过弃 ${percent(report.evidence.overfold.fold)}；跟注站弃牌 ${percent(report.evidence.station.fold)}；旧过弃换挡后弃牌 ${percent(report.evidence.switchedStation.fold)}；持续开池压力 ${percent(report.evidence.openPressure)}`,
    "",
  ];
  for (const scenario of [...new Set(report.scenarios.map((entry) => entry.scenario))]) {
    lines.push(`[${scenario}]`);
    for (const row of report.scenarios.filter((entry) => entry.scenario === scenario)) {
      lines.push([
        row.style.padEnd(6),
        `主线路 ${percent(row.baselinePrimary)} → ${percent(row.adaptedPrimary)}`,
        `行动 TV ${percent(row.actionTv)}`,
        `动态预算 ${percent(row.exploitWeight)}`,
        `抽样 ${percent(row.primaryMetric === "continue" ? row.sampled.call + row.sampled.raise : row.sampled.raise)}`,
      ].join(" · "));
    }
    lines.push("");
  }
  lines.push("说明：这是同一公开证据下的最终行动频率与抽样审计，不是完整牌局盈利证明；完整 6-max 零和回归请运行 npm run ai:benchmark。");
  return lines.join("\n");
}

function parseArguments(argv) {
  const options = { samples: 5_000, seed: "rangecraft-adaptation-2026", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--samples") options.samples = Number(argv[++index]);
    else if (argument.startsWith("--samples=")) options.samples = Number(argument.slice(10));
    else if (argument === "--seed") options.seed = argv[++index];
    else if (argument.startsWith("--seed=")) options.seed = argument.slice(7);
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`未知参数：${argument}`);
  }
  return options;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log("用法：node --experimental-strip-types scripts/ai-adaptation-benchmark.mjs [--samples N] [--seed VALUE] [--json]");
    } else {
      const report = runAdaptationBenchmark(options);
      console.log(options.json ? JSON.stringify(report, null, 2) : formatAdaptationReport(report));
    }
  } catch (error) {
    console.error(`动态 AI 审计失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
