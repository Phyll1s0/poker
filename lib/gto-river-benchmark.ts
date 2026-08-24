import { createHash } from "node:crypto";

import type {
  CFRStrategyEntry,
  CFRStrategyProfile,
} from "./gto-cfr.ts";
import {
  createHeadsUpRiverGame,
  type HeadsUpRiverAction,
  type HeadsUpRiverPlayer,
  type HeadsUpRiverSolution,
  type HeadsUpRiverSpec,
} from "./gto-river.ts";
import { stableGtoHash } from "./gto-standard.ts";
import type { StrategyCard } from "./poker-strategy.ts";

export const PUBLIC_RIVER_BENCHMARK_SCHEMA_VERSION = "rangecraft-public-river-benchmark/v1" as const;

type PublicRiverBenchmarkThresholds = Readonly<{
  minimumCoverageFraction: number;
  maximumReferenceExploitabilityPotFraction: number;
  maximumCandidateExploitabilityPotFraction: number;
  maximumNativeAuditDeltaPotFraction: number;
  maximumProfileValueDeltaPotFraction: number;
  maximumWeightedReferenceEvRegretPotFraction: number;
  maximumSingleReferenceActionRegretPotFraction: number;
  maximumActionFrequencyError: number;
}>;

type UpstreamStrategyNode = Readonly<{
  actions: readonly string[];
  strategy: readonly (readonly number[])[];
}>;

type UpstreamPlayer = Readonly<{
  hands: readonly string[];
  weights: readonly number[];
  profile: Readonly<Record<string, UpstreamStrategyNode>>;
}>;

export type PublicRiverBenchmarkFixture = Readonly<{
  schemaVersion: typeof PUBLIC_RIVER_BENCHMARK_SCHEMA_VERSION;
  contentHash: string;
  benchmarkId: string;
  claimScope: "implementation-conformance-only";
  source: Readonly<{
    name: string;
    repository: string;
    commit: string;
    license: "MIT";
    licenseUrl: string;
    inputFile: string;
    inputSha256: string;
    rawOutputFile: string;
    rawOutputEncoding: "base64";
    rawOutputSha256: string;
    generationCommand: string;
  }>;
  solver: Readonly<{
    algorithm: "cfr+";
    iterations: number;
    chipScalePerBb: number;
    nativeExploitability: Readonly<{
      value: number;
      unit: "chips";
      potFraction: number;
    }>;
  }>;
  identity: Readonly<{
    spotId: string;
    gameSpecId: string;
    treeId: string;
  }>;
  thresholds: PublicRiverBenchmarkThresholds;
  spec: HeadsUpRiverSpec;
  upstream: Readonly<{ players: readonly [UpstreamPlayer, UpstreamPlayer] }>;
}>;

export type PublicRiverBenchmarkMaxFrequencyError = Readonly<{
  value: number;
  player: HeadsUpRiverPlayer;
  holding: string;
  history: string;
  action: string;
  referenceFrequency: number;
  candidateFrequency: number;
}>;

export type PublicRiverBenchmarkMaxActionRegret = Readonly<{
  valueBb: number;
  potFraction: number;
  player: HeadsUpRiverPlayer;
  holding: string;
  history: string;
}>;

export type PublicRiverBenchmarkReport = Readonly<{
  schemaVersion: "rangecraft-public-river-benchmark-report/v1";
  benchmarkId: string;
  source: Readonly<{
    name: string;
    repository: string;
    commit: string;
    license: "MIT";
  }>;
  claimScope: "implementation-conformance-only";
  commercialAlignmentClaim: false;
  passed: boolean;
  identity: PublicRiverBenchmarkFixture["identity"];
  coverage: Readonly<{
    referenceStrategyCount: number;
    candidateStrategyCount: number;
    comparedStrategyCount: number;
    fraction: number;
  }>;
  referenceNativeExploitabilityPotFraction: number;
  referenceAuditedExploitabilityPotFraction: number;
  candidateAuditedExploitabilityPotFraction: number;
  candidateReportedExploitabilityPotFraction: number;
  nativeAuditDeltaPotFraction: number;
  candidateAuditDeltaPotFraction: number;
  profileValueDeltaPotFraction: number;
  weightedReferenceEvRegretBb: number;
  weightedReferenceEvRegretPotFraction: number;
  meanFrequencyTotalVariation: number;
  maxActionFrequencyError: PublicRiverBenchmarkMaxFrequencyError;
  maxSingleReferenceActionRegret: PublicRiverBenchmarkMaxActionRegret;
  thresholds: PublicRiverBenchmarkThresholds;
  checks: Readonly<{
    completeCoverage: boolean;
    referenceExploitability: boolean;
    candidateExploitability: boolean;
    nativeAuditAgreement: boolean;
    candidateAuditAgreement: boolean;
    profileValueAgreement: boolean;
    weightedReferenceEvRegret: boolean;
    singleReferenceActionRegret: boolean;
    frequencyMapping: boolean;
  }>;
}>;

type MutableRecord = Record<string, unknown>;

const RANKS = "23456789TJQKA";
const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
const SUIT_BY_SYMBOL: Readonly<Record<string, StrategyCard["suit"]>> = Object.freeze({
  s: "spades",
  h: "hearts",
  d: "diamonds",
  c: "clubs",
});
const SUIT_SYMBOL: Readonly<Record<StrategyCard["suit"], string>> = Object.freeze({
  spades: "s",
  hearts: "h",
  diamonds: "d",
  clubs: "c",
});
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const PROBABILITY_TOLERANCE = 1e-9;
const AUDIT_ROUNDING_TOLERANCE = 1e-12;

const TRUSTED_PUBLIC_RIVER_BENCHMARKS = Object.freeze({
  "noambrown-river-symmetric-pot-bet-v1": Object.freeze({
    contentHash: "35b1dbb2bbd65e718ccf0d20c5b0ee90dfecda9445e6dc5efa4f7bb8aa8584ba",
    repository: "https://github.com/noambrown/poker_solver",
    commit: "6a10442877ffc8fd28af93e16e279b9bbdd97b2a",
    licenseUrl: "https://github.com/noambrown/poker_solver/blob/6a10442877ffc8fd28af93e16e279b9bbdd97b2a/LICENSE",
    inputSha256: "40c991eb4ed22f46e1a89b8e4fa0b18f4e8368001bef9dff7708cd3ec795ce91",
    rawOutputSha256: "9f6e5bc7c5b84f9d676ff3e03d5aa07b55e51f491003e8c52a636074f8c9978c",
    spotId: "rc-hu-river-spot-v1-9d9782dee5df958c349abf8f98335b85687112bd29a8fcef533e30e4f9972fe1",
    gameSpecId: "rc-hu-river-game-v1-3613e43c15e6eca6b77f3f8c0374c29f6b382ce585ca1ca682b20194f4897d6c",
    treeId: "rc-hu-river-tree-v1-b07fd4665f40d861d0cf8c08348d7a6fff2d36fd6a1c2d177f1d6f44dbabee23",
  }),
} as const);

function benchmarkError(message: string): never {
  throw new TypeError(`公开河牌基准无效：${message}`);
}

function record(value: unknown, path: string): MutableRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    benchmarkError(`${path} 必须是普通对象`);
  }
  return value as MutableRecord;
}

function exactKeys(value: MutableRecord, expected: readonly string[], path: string): void {
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !(key in value));
  const extras = Object.keys(value).filter((key) => !expectedSet.has(key));
  if (missing.length) benchmarkError(`${path} 缺少字段 ${missing.join(", ")}`);
  if (extras.length) benchmarkError(`${path} 存在未知字段 ${extras.join(", ")}`);
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") benchmarkError(`${path} 必须是非空字符串`);
  return value;
}

function artifactFileName(value: unknown, path: string): string {
  const parsed = nonEmptyString(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parsed)) benchmarkError(`${path} 必须是同目录内的安全文件名`);
  return parsed;
}

function finite(value: unknown, path: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    benchmarkError(`${path} 必须是 ${minimum}..${maximum} 内的有限数值`);
  }
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  const parsed = finite(value, path, minimum);
  if (!Number.isSafeInteger(parsed)) benchmarkError(`${path} 必须是安全整数`);
  return parsed;
}

function literal<T extends string>(value: unknown, expected: T, path: string): T {
  if (value !== expected) benchmarkError(`${path} 必须是 ${expected}`);
  return expected;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) benchmarkError(`${path} 必须是数组`);
  return value;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function parseCard(value: unknown, path: string): StrategyCard {
  const source = record(value, path);
  exactKeys(source, ["rank", "suit"], path);
  const rank = integer(source.rank, `${path}.rank`, 2);
  if (rank > 14) benchmarkError(`${path}.rank 必须不大于 14`);
  const suit = nonEmptyString(source.suit, `${path}.suit`) as StrategyCard["suit"];
  if (!SUITS.includes(suit)) benchmarkError(`${path}.suit 不是标准花色`);
  return { rank, suit };
}

function parseHolding(value: unknown, path: string) {
  const source = record(value, path);
  exactKeys(source, ["cards", "weight"], path);
  const cards = array(source.cards, `${path}.cards`).map((card, index) => parseCard(card, `${path}.cards[${index}]`));
  if (cards.length !== 2) benchmarkError(`${path}.cards 必须正好有两张牌`);
  return {
    cards: cards as [StrategyCard, StrategyCard],
    weight: finite(source.weight, `${path}.weight`, Number.MIN_VALUE),
  };
}

function parseSpec(value: unknown): HeadsUpRiverSpec {
  const source = record(value, "spec");
  exactKeys(source, ["board", "oopRange", "ipRange", "potBb", "effectiveStackBb", "bettingTree"], "spec");
  const board = array(source.board, "spec.board").map((card, index) => parseCard(card, `spec.board[${index}]`));
  if (board.length !== 5) benchmarkError("spec.board 必须正好有五张牌");
  const oopRange = array(source.oopRange, "spec.oopRange")
    .map((holding, index) => parseHolding(holding, `spec.oopRange[${index}]`));
  const ipRange = array(source.ipRange, "spec.ipRange")
    .map((holding, index) => parseHolding(holding, `spec.ipRange[${index}]`));
  const treeSource = record(source.bettingTree, "spec.bettingTree");
  exactKeys(
    treeSource,
    ["betPotFractions", "raisePotAfterCallFractions", "maxRaises", "allInAlwaysAvailable"],
    "spec.bettingTree",
  );
  const fractions = (key: "betPotFractions" | "raisePotAfterCallFractions") =>
    array(treeSource[key], `spec.bettingTree.${key}`)
      .map((entry, index) => finite(entry, `spec.bettingTree.${key}[${index}]`, Number.MIN_VALUE));
  if (typeof treeSource.allInAlwaysAvailable !== "boolean") {
    benchmarkError("spec.bettingTree.allInAlwaysAvailable 必须是布尔值");
  }
  return {
    board: board as unknown as HeadsUpRiverSpec["board"],
    oopRange,
    ipRange,
    potBb: finite(source.potBb, "spec.potBb", Number.MIN_VALUE),
    effectiveStackBb: finite(source.effectiveStackBb, "spec.effectiveStackBb", Number.MIN_VALUE),
    bettingTree: {
      betPotFractions: fractions("betPotFractions"),
      raisePotAfterCallFractions: fractions("raisePotAfterCallFractions"),
      maxRaises: integer(treeSource.maxRaises, "spec.bettingTree.maxRaises"),
      allInAlwaysAvailable: treeSource.allInAlwaysAvailable,
    },
  };
}

function parseThresholds(value: unknown): PublicRiverBenchmarkThresholds {
  const source = record(value, "thresholds");
  const keys = [
    "minimumCoverageFraction",
    "maximumReferenceExploitabilityPotFraction",
    "maximumCandidateExploitabilityPotFraction",
    "maximumNativeAuditDeltaPotFraction",
    "maximumProfileValueDeltaPotFraction",
    "maximumWeightedReferenceEvRegretPotFraction",
    "maximumSingleReferenceActionRegretPotFraction",
    "maximumActionFrequencyError",
  ] as const;
  exactKeys(source, keys, "thresholds");
  return Object.fromEntries(
    keys.map((key) => [key, finite(source[key], `thresholds.${key}`, 0, 1)]),
  ) as unknown as PublicRiverBenchmarkThresholds;
}

function parseUpstreamNode(value: unknown, path: string): UpstreamStrategyNode {
  const source = record(value, path);
  exactKeys(source, ["actions", "strategy"], path);
  const actions = array(source.actions, `${path}.actions`)
    .map((entry, index) => nonEmptyString(entry, `${path}.actions[${index}]`));
  if (actions.length < 2 || new Set(actions).size !== actions.length) {
    benchmarkError(`${path}.actions 必须至少有两个且不得重复`);
  }
  const strategy = array(source.strategy, `${path}.strategy`).map((row, rowIndex) => {
    const frequencies = array(row, `${path}.strategy[${rowIndex}]`)
      .map((entry, actionIndex) => finite(entry, `${path}.strategy[${rowIndex}][${actionIndex}]`, 0, 1));
    if (frequencies.length !== actions.length) benchmarkError(`${path}.strategy[${rowIndex}] 与动作数不同`);
    const total = frequencies.reduce((sum, frequency) => sum + frequency, 0);
    if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) {
      benchmarkError(`${path}.strategy[${rowIndex}] 频率和必须为 1，当前为 ${total}`);
    }
    return frequencies;
  });
  return { actions, strategy };
}

function parseUpstreamPlayer(value: unknown, path: string): UpstreamPlayer {
  const source = record(value, path);
  exactKeys(source, ["hands", "weights", "profile"], path);
  const hands = array(source.hands, `${path}.hands`)
    .map((entry, index) => nonEmptyString(entry, `${path}.hands[${index}]`));
  const weights = array(source.weights, `${path}.weights`)
    .map((entry, index) => finite(entry, `${path}.weights[${index}]`, 0, 1));
  if (hands.length === 0 || weights.length !== hands.length) benchmarkError(`${path} 手牌与权重长度必须相同且非空`);
  const profileSource = record(source.profile, `${path}.profile`);
  if (Object.keys(profileSource).length === 0) benchmarkError(`${path}.profile 不能为空`);
  const profile = Object.fromEntries(Object.entries(profileSource).map(([history, node]) => [
    nonEmptyString(history, `${path}.profile key`),
    parseUpstreamNode(node, `${path}.profile[${history}]`),
  ]));
  for (const [history, node] of Object.entries(profile)) {
    if (node.strategy.length !== hands.length) {
      benchmarkError(`${path}.profile[${history}] 的策略行数必须与手牌数相同`);
    }
  }
  return { hands, weights, profile };
}

/** Parses and content-hash verifies a checked-in, legally sourced oracle snapshot. */
export function parsePublicRiverBenchmarkFixture(value: unknown): PublicRiverBenchmarkFixture {
  const root = record(value, "fixture");
  exactKeys(root, [
    "schemaVersion",
    "contentHash",
    "benchmarkId",
    "claimScope",
    "source",
    "solver",
    "identity",
    "thresholds",
    "spec",
    "upstream",
  ], "fixture");
  literal(root.schemaVersion, PUBLIC_RIVER_BENCHMARK_SCHEMA_VERSION, "fixture.schemaVersion");
  literal(root.claimScope, "implementation-conformance-only", "fixture.claimScope");
  const benchmarkId = nonEmptyString(root.benchmarkId, "fixture.benchmarkId");
  const trusted = TRUSTED_PUBLIC_RIVER_BENCHMARKS[
    benchmarkId as keyof typeof TRUSTED_PUBLIC_RIVER_BENCHMARKS
  ];
  if (!trusted) benchmarkError(`fixture.benchmarkId ${benchmarkId} 不在可信公开基准清单中`);
  const contentHash = nonEmptyString(root.contentHash, "fixture.contentHash");
  if (!HASH_PATTERN.test(contentHash)) benchmarkError("fixture.contentHash 必须是 SHA-256");
  const hashPayload = { ...root };
  delete hashPayload.contentHash;
  const computedHash = stableGtoHash(hashPayload);
  if (computedHash !== contentHash) benchmarkError(`fixture.contentHash 不匹配，计算值为 ${computedHash}`);
  if (contentHash !== trusted.contentHash) benchmarkError("fixture.contentHash 与可信公开基准清单不一致");

  const sourceRecord = record(root.source, "source");
  exactKeys(
    sourceRecord,
    [
      "name",
      "repository",
      "commit",
      "license",
      "licenseUrl",
      "inputFile",
      "inputSha256",
      "rawOutputFile",
      "rawOutputEncoding",
      "rawOutputSha256",
      "generationCommand",
    ],
    "source",
  );
  const commit = nonEmptyString(sourceRecord.commit, "source.commit");
  const repository = nonEmptyString(sourceRecord.repository, "source.repository");
  const licenseUrl = nonEmptyString(sourceRecord.licenseUrl, "source.licenseUrl");
  const inputSha256 = nonEmptyString(sourceRecord.inputSha256, "source.inputSha256");
  const rawOutputSha256 = nonEmptyString(sourceRecord.rawOutputSha256, "source.rawOutputSha256");
  if (!COMMIT_PATTERN.test(commit)) benchmarkError("source.commit 必须锁定完整 Git commit");
  if (!HASH_PATTERN.test(inputSha256)) benchmarkError("source.inputSha256 必须是 SHA-256");
  if (!HASH_PATTERN.test(rawOutputSha256)) benchmarkError("source.rawOutputSha256 必须是 SHA-256");
  literal(sourceRecord.license, "MIT", "source.license");
  literal(sourceRecord.rawOutputEncoding, "base64", "source.rawOutputEncoding");
  if (
    repository !== trusted.repository
    || commit !== trusted.commit
    || licenseUrl !== trusted.licenseUrl
    || inputSha256 !== trusted.inputSha256
    || rawOutputSha256 !== trusted.rawOutputSha256
  ) benchmarkError("source 与可信公开基准清单不一致");

  const solverRecord = record(root.solver, "solver");
  exactKeys(solverRecord, ["algorithm", "iterations", "chipScalePerBb", "nativeExploitability"], "solver");
  literal(solverRecord.algorithm, "cfr+", "solver.algorithm");
  const nativeRecord = record(solverRecord.nativeExploitability, "solver.nativeExploitability");
  exactKeys(nativeRecord, ["value", "unit", "potFraction"], "solver.nativeExploitability");
  literal(nativeRecord.unit, "chips", "solver.nativeExploitability.unit");

  const identityRecord = record(root.identity, "identity");
  exactKeys(identityRecord, ["spotId", "gameSpecId", "treeId"], "identity");
  const spec = parseSpec(root.spec);
  const model = createHeadsUpRiverGame(spec);
  const identity = {
    spotId: nonEmptyString(identityRecord.spotId, "identity.spotId"),
    gameSpecId: nonEmptyString(identityRecord.gameSpecId, "identity.gameSpecId"),
    treeId: nonEmptyString(identityRecord.treeId, "identity.treeId"),
  };
  if (model.spotId !== identity.spotId) benchmarkError("identity.spotId 与完整局面不一致");
  if (model.gameSpecId !== identity.gameSpecId) benchmarkError("identity.gameSpecId 与完整规则不一致");
  if (model.treeId !== identity.treeId) benchmarkError("identity.treeId 与下注树不一致");
  if (
    identity.spotId !== trusted.spotId
    || identity.gameSpecId !== trusted.gameSpecId
    || identity.treeId !== trusted.treeId
  ) benchmarkError("identity 与可信公开基准清单不一致");

  const chipScalePerBb = finite(solverRecord.chipScalePerBb, "solver.chipScalePerBb", Number.MIN_VALUE);
  const nativeValue = finite(nativeRecord.value, "solver.nativeExploitability.value", 0);
  const nativePotFraction = finite(nativeRecord.potFraction, "solver.nativeExploitability.potFraction", 0, 1);
  const derivedNativePotFraction = nativeValue / (spec.potBb * chipScalePerBb);
  if (Math.abs(derivedNativePotFraction - nativePotFraction) > AUDIT_ROUNDING_TOLERANCE) {
    benchmarkError("solver.nativeExploitability 的 chips 与 potFraction 单位换算不一致");
  }

  const upstreamRecord = record(root.upstream, "upstream");
  exactKeys(upstreamRecord, ["players"], "upstream");
  const players = array(upstreamRecord.players, "upstream.players")
    .map((player, index) => parseUpstreamPlayer(player, `upstream.players[${index}]`));
  if (players.length !== 2) benchmarkError("upstream.players 必须正好有两位玩家");
  players.forEach((player, playerIndex) => {
    const canonicalHands = player.hands.map(canonicalHolding);
    const upstreamWeightTotal = player.weights.reduce((sum, weight) => sum + weight, 0);
    if (!(upstreamWeightTotal > 0)) benchmarkError(`upstream.players[${playerIndex}].weights 总和必须为正`);
    const upstreamWeights = new Map(canonicalHands.map((holding, holdingIndex) => [
      holding,
      player.weights[holdingIndex] / upstreamWeightTotal,
    ]));
    if (upstreamWeights.size !== canonicalHands.length) {
      benchmarkError(`upstream.players[${playerIndex}] 手牌规范化后重复`);
    }
    const modelRange = playerIndex === 0 ? model.spec.oopRange : model.spec.ipRange;
    const modelWeightTotal = modelRange.reduce((sum, holding) => sum + holding.weight, 0);
    if (upstreamWeights.size !== modelRange.length) {
      benchmarkError(`upstream.players[${playerIndex}] 手牌集合与 spec 范围不一致`);
    }
    modelRange.forEach((holding, holdingIndex) => {
      const key = model.holdingKey(playerIndex as 0 | 1, holdingIndex);
      const upstreamWeight = upstreamWeights.get(key);
      if (upstreamWeight === undefined) {
        benchmarkError(`upstream.players[${playerIndex}] 缺少 spec 手牌 ${key}`);
      }
      const modelWeight = holding.weight / modelWeightTotal;
      if (Math.abs(upstreamWeight - modelWeight) > PROBABILITY_TOLERANCE) {
        benchmarkError(`upstream.players[${playerIndex}] 手牌 ${key} 的范围权重与 spec 不一致`);
      }
    });
  });

  return deepFreeze({
    schemaVersion: PUBLIC_RIVER_BENCHMARK_SCHEMA_VERSION,
    contentHash,
    benchmarkId,
    claimScope: "implementation-conformance-only",
    source: {
      name: nonEmptyString(sourceRecord.name, "source.name"),
      repository,
      commit,
      license: "MIT",
      licenseUrl,
      inputFile: artifactFileName(sourceRecord.inputFile, "source.inputFile"),
      inputSha256,
      rawOutputFile: artifactFileName(sourceRecord.rawOutputFile, "source.rawOutputFile"),
      rawOutputEncoding: "base64",
      rawOutputSha256,
      generationCommand: nonEmptyString(sourceRecord.generationCommand, "source.generationCommand"),
    },
    solver: {
      algorithm: "cfr+",
      iterations: integer(solverRecord.iterations, "solver.iterations", 1),
      chipScalePerBb,
      nativeExploitability: { value: nativeValue, unit: "chips", potFraction: nativePotFraction },
    },
    identity,
    thresholds: parseThresholds(root.thresholds),
    spec,
    upstream: { players: players as unknown as readonly [UpstreamPlayer, UpstreamPlayer] },
  });
}

export type PublicRiverBenchmarkArtifactVerification = Readonly<{
  inputSha256: string;
  rawOutputSha256: string;
  rawOutputBytes: number;
  semanticMatch: true;
}>;

function sha256Artifact(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function parsedJsonArtifact(value: string, path: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    benchmarkError(`${path} 不是有效 JSON`);
  }
}

/** Verifies the exact checked-in upstream input and byte-for-byte raw solver output. */
export function verifyPublicRiverBenchmarkArtifacts(
  fixture: PublicRiverBenchmarkFixture,
  inputText: string,
  rawOutputBase64: string,
): PublicRiverBenchmarkArtifactVerification {
  const inputSha256 = sha256Artifact(inputText);
  if (inputSha256 !== fixture.source.inputSha256) benchmarkError("公开基准 input.json 的 SHA-256 不匹配");

  const compactBase64 = rawOutputBase64.replace(/\s/g, "");
  if (!compactBase64 || compactBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compactBase64)) {
    benchmarkError("公开基准 raw output 不是规范 base64");
  }
  const rawBytes = Buffer.from(compactBase64, "base64");
  if (rawBytes.toString("base64") !== compactBase64) benchmarkError("公开基准 raw output base64 不能无损往返");
  const rawOutputSha256 = sha256Artifact(rawBytes);
  if (rawOutputSha256 !== fixture.source.rawOutputSha256) benchmarkError("公开基准 raw output 的 SHA-256 不匹配");

  const rawRoot = record(parsedJsonArtifact(rawBytes.toString("utf8"), "raw output"), "raw output");
  exactKeys(rawRoot, ["players"], "raw output");
  const rawPlayers = array(rawRoot.players, "raw output.players")
    .map((player, index) => parseUpstreamPlayer(player, `raw output.players[${index}]`));
  if (rawPlayers.length !== 2) benchmarkError("raw output.players 必须正好有两位玩家");
  if (stableGtoHash({ players: rawPlayers }) !== stableGtoHash(fixture.upstream)) {
    benchmarkError("raw output 的策略内容与 reference.json 不一致");
  }

  const input = record(parsedJsonArtifact(inputText, "input.json"), "input.json");
  exactKeys(input, ["board", "pot", "stack", "bet_sizes", "include_all_in", "max_raises", "players"], "input.json");
  const board = array(input.board, "input.json.board")
    .map((card, index) => parseExternalCard(nonEmptyString(card, `input.json.board[${index}]`)))
    .map((card) => `${RANKS[card.rank - 2]}${SUIT_SYMBOL[card.suit]}`)
    .sort();
  const expectedBoard = fixture.spec.board
    .map((card) => `${RANKS[card.rank - 2]}${SUIT_SYMBOL[card.suit]}`)
    .sort();
  if (stableGtoHash(board) !== stableGtoHash(expectedBoard)) benchmarkError("input.json 牌面与 reference.json 不一致");
  if (finite(input.pot, "input.json.pot", Number.MIN_VALUE) / fixture.solver.chipScalePerBb !== fixture.spec.potBb) {
    benchmarkError("input.json 底池与 reference.json 不一致");
  }
  if (finite(input.stack, "input.json.stack", Number.MIN_VALUE) / fixture.solver.chipScalePerBb !== fixture.spec.effectiveStackBb) {
    benchmarkError("input.json 后手与 reference.json 不一致");
  }
  const betSizes = array(input.bet_sizes, "input.json.bet_sizes")
    .map((size, index) => finite(size, `input.json.bet_sizes[${index}]`, Number.MIN_VALUE));
  if (stableGtoHash(betSizes) !== stableGtoHash(fixture.spec.bettingTree?.betPotFractions ?? [])) {
    benchmarkError("input.json 下注尺寸与 reference.json 不一致");
  }
  if (input.include_all_in !== fixture.spec.bettingTree?.allInAlwaysAvailable) {
    benchmarkError("input.json 全下分支与 reference.json 不一致");
  }
  if (integer(input.max_raises, "input.json.max_raises") !== fixture.spec.bettingTree?.maxRaises) {
    benchmarkError("input.json 最大加注次数与 reference.json 不一致");
  }

  const inputPlayers = array(input.players, "input.json.players");
  if (inputPlayers.length !== 2) benchmarkError("input.json.players 必须正好有两位玩家");
  inputPlayers.forEach((playerValue, playerIndex) => {
    const player = record(playerValue, `input.json.players[${playerIndex}]`);
    exactKeys(player, ["hands", "weights"], `input.json.players[${playerIndex}]`);
    const hands = array(player.hands, `input.json.players[${playerIndex}].hands`)
      .map((hand, index) => canonicalHolding(nonEmptyString(hand, `input.json.players[${playerIndex}].hands[${index}]`)));
    const weights = array(player.weights, `input.json.players[${playerIndex}].weights`)
      .map((weight, index) => finite(weight, `input.json.players[${playerIndex}].weights[${index}]`, 0));
    if (hands.length === 0 || hands.length !== weights.length || new Set(hands).size !== hands.length) {
      benchmarkError(`input.json.players[${playerIndex}] 手牌与权重无效`);
    }
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!(total > 0)) benchmarkError(`input.json.players[${playerIndex}].weights 总和必须为正`);
    const normalized = new Map(hands.map((hand, index) => [hand, weights[index] / total]));
    const expected = fixture.upstream.players[playerIndex];
    const expectedTotal = expected.weights.reduce((sum, weight) => sum + weight, 0);
    if (normalized.size !== expected.hands.length) benchmarkError(`input.json.players[${playerIndex}] 范围不一致`);
    expected.hands.forEach((hand, index) => {
      const weight = normalized.get(canonicalHolding(hand));
      if (weight === undefined || Math.abs(weight - expected.weights[index] / expectedTotal) > PROBABILITY_TOLERANCE) {
        benchmarkError(`input.json.players[${playerIndex}] 范围不一致`);
      }
    });
  });

  return deepFreeze({
    inputSha256,
    rawOutputSha256,
    rawOutputBytes: rawBytes.byteLength,
    semanticMatch: true as const,
  });
}

function amountText(value: number): string {
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function parseExternalCard(text: string): StrategyCard {
  if (text.length !== 2) benchmarkError(`外部牌 “${text}” 格式无效`);
  const rankIndex = RANKS.indexOf(text[0].toUpperCase());
  const suit = SUIT_BY_SYMBOL[text[1].toLowerCase()];
  if (rankIndex < 0 || !suit) benchmarkError(`外部牌 “${text}” 格式无效`);
  return { rank: rankIndex + 2, suit };
}

function canonicalHolding(text: string): string {
  if (text.length !== 4) benchmarkError(`外部手牌 “${text}” 必须是四个字符`);
  const cards = [parseExternalCard(text.slice(0, 2)), parseExternalCard(text.slice(2, 4))];
  if (cards[0].rank === cards[1].rank && cards[0].suit === cards[1].suit) {
    benchmarkError(`外部手牌 “${text}” 含重复牌`);
  }
  return cards
    .sort((left, right) => right.rank - left.rank || SUITS.indexOf(left.suit) - SUITS.indexOf(right.suit))
    .map((card) => `${RANKS[card.rank - 2]}${SUIT_SYMBOL[card.suit]}`)
    .join("");
}

type ExternalHistoryState = Readonly<{
  history: string;
  facingBet: boolean;
}>;

function externalHistory(path: string, chipScalePerBb: number): ExternalHistoryState {
  if (path === "root") return { history: "root", facingBet: false };
  const normalized: string[] = [];
  let facingBet = false;
  for (const token of path.split("/")) {
    if (token === "c") {
      if (facingBet) benchmarkError(`外部 profile 路径 ${path} 在跟注终局后仍有节点`);
      normalized.push("check");
      continue;
    }
    const betMatch = /^b([1-9]\d*)$/.exec(token);
    if (betMatch) {
      if (facingBet) benchmarkError(`外部 profile 路径 ${path} 含当前基准不支持的再次加注`);
      normalized.push(`bet-to:${amountText(Number(betMatch[1]) / chipScalePerBb)}`);
      facingBet = true;
      continue;
    }
    benchmarkError(`外部 profile 路径 ${path} 含不支持动作 ${token}`);
  }
  return { history: normalized.join(">"), facingBet };
}

function externalAction(token: string, facingBet: boolean, chipScalePerBb: number): HeadsUpRiverAction {
  if (token === "c") return facingBet ? "call" : "check";
  if (token === "f" && facingBet) return "fold";
  const betMatch = /^b([1-9]\d*)$/.exec(token);
  if (betMatch && !facingBet) return `bet-to:${amountText(Number(betMatch[1]) / chipScalePerBb)}`;
  benchmarkError(`外部动作 ${token} 与当前公开状态不一致`);
}

function referenceProfile(
  fixture: PublicRiverBenchmarkFixture,
): CFRStrategyProfile<HeadsUpRiverAction> {
  const profile: [Map<string, CFRStrategyEntry<HeadsUpRiverAction>>, Map<string, CFRStrategyEntry<HeadsUpRiverAction>>] = [
    new Map(),
    new Map(),
  ];
  fixture.upstream.players.forEach((player, playerIndex) => {
    const holdings = player.hands.map(canonicalHolding);
    if (new Set(holdings).size !== holdings.length) benchmarkError(`upstream.players[${playerIndex}] 手牌规范化后重复`);
    for (const [path, node] of Object.entries(player.profile)) {
      const state = externalHistory(path, fixture.solver.chipScalePerBb);
      const actions = node.actions.map((action) => externalAction(
        action,
        state.facingBet,
        fixture.solver.chipScalePerBb,
      ));
      if (new Set(actions).size !== actions.length) benchmarkError(`外部节点 ${path} 动作规范化后重复`);
      node.strategy.forEach((frequencies, holdingIndex) => {
        const informationSet = `river|P${playerIndex}|${holdings[holdingIndex]}|${state.history}`;
        if (profile[playerIndex].has(informationSet)) benchmarkError(`外部策略含重复信息集 ${informationSet}`);
        profile[playerIndex].set(informationSet, Object.freeze({
          actions: Object.freeze([...actions]),
          probabilities: Object.freeze([...frequencies]),
        }));
      });
    }
  });
  return Object.freeze(profile) as CFRStrategyProfile<HeadsUpRiverAction>;
}

function alignedProbabilities(
  entry: CFRStrategyEntry<HeadsUpRiverAction>,
  referenceActions: readonly HeadsUpRiverAction[],
  informationSet: string,
): readonly number[] {
  if (entry.actions.length !== entry.probabilities.length) benchmarkError(`候选节点 ${informationSet} 动作与频率长度不同`);
  const byAction = new Map(entry.actions.map((action, index) => [action, entry.probabilities[index]]));
  if (byAction.size !== entry.actions.length || byAction.size !== referenceActions.length) {
    benchmarkError(`候选节点 ${informationSet} 动作集合不一致`);
  }
  const probabilities = referenceActions.map((action) => {
    const probability = byAction.get(action);
    if (probability === undefined) benchmarkError(`候选节点 ${informationSet} 缺少动作 ${action}`);
    return finite(probability, `候选节点 ${informationSet}.${action}`, 0, 1);
  });
  if (Math.abs(probabilities.reduce((sum, probability) => sum + probability, 0) - 1) > PROBABILITY_TOLERANCE) {
    benchmarkError(`候选节点 ${informationSet} 频率和不为 1`);
  }
  return probabilities;
}

function parsedInformationSet(informationSet: string) {
  const [prefix, playerToken, holding, history, ...rest] = informationSet.split("|");
  if (prefix !== "river" || !/^P[01]$/.test(playerToken) || !holding || !history || rest.length) {
    benchmarkError(`信息集 ${informationSet} 格式无效`);
  }
  const playerIndex = Number(playerToken[1]) as 0 | 1;
  return {
    playerIndex,
    player: (playerIndex === 0 ? "oop" : "ip") as HeadsUpRiverPlayer,
    holding,
    history,
  };
}

/**
 * Runs a strict same-spot comparison against a checked-in public oracle.
 * Frequency distance is diagnostic except for a loose mapping-integrity cap;
 * pass/fail is driven primarily by common-auditor exploitability and EV regret.
 */
export function benchmarkHeadsUpRiverAgainstPublicFixture(
  solution: HeadsUpRiverSolution,
  fixture: PublicRiverBenchmarkFixture,
): PublicRiverBenchmarkReport {
  if (solution.spotId !== fixture.identity.spotId) benchmarkError("候选 spotId 与外部同题局面不一致");
  if (solution.gameSpecId !== fixture.identity.gameSpecId) benchmarkError("候选 gameSpecId 与外部规则不一致");
  if (solution.treeId !== fixture.identity.treeId) benchmarkError("候选 treeId 与外部下注树不一致");

  const model = createHeadsUpRiverGame(fixture.spec);
  const reference = referenceProfile(fixture);
  const referenceAudit = model.exploitability(reference);
  const candidateAudit = model.exploitability(solution.averageStrategy);
  const referenceActionValues = new Map(model.actionValues(reference).map((entry) => [
    `river|P${entry.player === "oop" ? 0 : 1}|${entry.holding}|${entry.history}`,
    entry,
  ]));
  const referenceKeys = reference.flatMap((player) => [...player.keys()]).sort();
  const candidateKeys = solution.averageStrategy.flatMap((player) => [...player.keys()]).sort();
  const candidateKeySet = new Set(candidateKeys);
  const comparedKeys = referenceKeys.filter((key) => candidateKeySet.has(key));
  const coverageFraction = referenceKeys.length === 0 ? 0 : comparedKeys.length / referenceKeys.length;

  let reachTotal = 0;
  let weightedTotalVariation = 0;
  let weightedRegretBb = 0;
  let maximumFrequency: PublicRiverBenchmarkMaxFrequencyError | undefined;
  let maximumRegret: PublicRiverBenchmarkMaxActionRegret | undefined;

  for (const informationSet of comparedKeys) {
    const { playerIndex, player, holding, history } = parsedInformationSet(informationSet);
    const referenceEntry = reference[playerIndex].get(informationSet);
    const candidateEntry = solution.averageStrategy[playerIndex].get(informationSet);
    const actionValues = referenceActionValues.get(informationSet);
    if (!referenceEntry || !candidateEntry || !actionValues) benchmarkError(`无法完整审计信息集 ${informationSet}`);
    const candidateProbabilities = alignedProbabilities(candidateEntry, referenceEntry.actions, informationSet);
    const referenceByAction = new Map(actionValues.actions.map((action, index) => [action, actionValues.actionEvBb[index]]));
    const evs = referenceEntry.actions.map((action) => {
      const value = referenceByAction.get(action);
      if (value === undefined) benchmarkError(`参考动作 EV 缺少 ${informationSet}.${action}`);
      return value;
    });
    const bestEv = Math.max(...evs);
    const candidateEv = evs.reduce((sum, ev, index) => sum + ev * candidateProbabilities[index], 0);
    const regretBb = Math.max(0, bestEv - candidateEv);
    const reach = actionValues.counterfactualReach;
    reachTotal += reach;
    weightedRegretBb += reach * regretBb;

    let absoluteDifference = 0;
    referenceEntry.actions.forEach((action, index) => {
      const error = Math.abs(referenceEntry.probabilities[index] - candidateProbabilities[index]);
      absoluteDifference += error;
      if (!maximumFrequency || error > maximumFrequency.value) {
        maximumFrequency = {
          value: error,
          player,
          holding,
          history,
          action,
          referenceFrequency: referenceEntry.probabilities[index],
          candidateFrequency: candidateProbabilities[index],
        };
      }
    });
    weightedTotalVariation += reach * absoluteDifference * 0.5;
    const regret = { valueBb: regretBb, potFraction: regretBb / model.spec.potBb, player, holding, history };
    if (!maximumRegret || regret.valueBb > maximumRegret.valueBb) maximumRegret = regret;
  }

  if (!(reachTotal > 0) || !maximumFrequency || !maximumRegret) benchmarkError("参考策略没有可审计的正 reach 信息集");
  const weightedReferenceEvRegretBb = weightedRegretBb / reachTotal;
  const weightedReferenceEvRegretPotFraction = weightedReferenceEvRegretBb / model.spec.potBb;
  const nativeAuditDeltaPotFraction = Math.abs(
    referenceAudit.exploitabilityPotFraction - fixture.solver.nativeExploitability.potFraction,
  );
  const candidateAuditDeltaPotFraction = Math.abs(
    candidateAudit.exploitabilityPotFraction - solution.exploitability.exploitabilityPotFraction,
  );
  const profileValueDeltaPotFraction = Math.abs(
    candidateAudit.profileValueBb - referenceAudit.profileValueBb,
  ) / model.spec.potBb;
  const thresholds = fixture.thresholds;
  const checks = Object.freeze({
    completeCoverage: coverageFraction >= thresholds.minimumCoverageFraction
      && comparedKeys.length === candidateKeys.length,
    referenceExploitability:
      referenceAudit.exploitabilityPotFraction <= thresholds.maximumReferenceExploitabilityPotFraction,
    candidateExploitability:
      candidateAudit.exploitabilityPotFraction <= thresholds.maximumCandidateExploitabilityPotFraction,
    nativeAuditAgreement: nativeAuditDeltaPotFraction <= thresholds.maximumNativeAuditDeltaPotFraction,
    candidateAuditAgreement: candidateAuditDeltaPotFraction <= AUDIT_ROUNDING_TOLERANCE,
    profileValueAgreement: profileValueDeltaPotFraction <= thresholds.maximumProfileValueDeltaPotFraction,
    weightedReferenceEvRegret:
      weightedReferenceEvRegretPotFraction <= thresholds.maximumWeightedReferenceEvRegretPotFraction,
    singleReferenceActionRegret:
      maximumRegret.potFraction <= thresholds.maximumSingleReferenceActionRegretPotFraction,
    frequencyMapping: maximumFrequency.value <= thresholds.maximumActionFrequencyError,
  });

  return deepFreeze({
    schemaVersion: "rangecraft-public-river-benchmark-report/v1",
    benchmarkId: fixture.benchmarkId,
    source: {
      name: fixture.source.name,
      repository: fixture.source.repository,
      commit: fixture.source.commit,
      license: fixture.source.license,
    },
    claimScope: fixture.claimScope,
    commercialAlignmentClaim: false,
    passed: Object.values(checks).every(Boolean),
    identity: fixture.identity,
    coverage: {
      referenceStrategyCount: referenceKeys.length,
      candidateStrategyCount: candidateKeys.length,
      comparedStrategyCount: comparedKeys.length,
      fraction: coverageFraction,
    },
    referenceNativeExploitabilityPotFraction: fixture.solver.nativeExploitability.potFraction,
    referenceAuditedExploitabilityPotFraction: referenceAudit.exploitabilityPotFraction,
    candidateAuditedExploitabilityPotFraction: candidateAudit.exploitabilityPotFraction,
    candidateReportedExploitabilityPotFraction: solution.exploitability.exploitabilityPotFraction,
    nativeAuditDeltaPotFraction,
    candidateAuditDeltaPotFraction,
    profileValueDeltaPotFraction,
    weightedReferenceEvRegretBb,
    weightedReferenceEvRegretPotFraction,
    meanFrequencyTotalVariation: weightedTotalVariation / reachTotal,
    maxActionFrequencyError: maximumFrequency,
    maxSingleReferenceActionRegret: maximumRegret,
    thresholds,
    checks,
  });
}
