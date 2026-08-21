/**
 * Immutable, self-identifying inputs and outputs for RangeCraft's first
 * reproducible solver baseline. This module deliberately contains no poker
 * policy heuristics: changing a rule or a sizing creates a different id.
 */

export const GTO_STANDARD_SCHEMA_VERSION = "rangecraft-gto-standard/v1" as const;
export const GTO_RESULT_SCHEMA_VERSION = "rangecraft-gto-result/v1" as const;

export const GTO_STANDARD_POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"] as const;
export const GTO_STANDARD_STREETS = ["preflop", "flop", "turn", "river"] as const;

export type GtoStandardPosition = typeof GTO_STANDARD_POSITIONS[number];
export type GtoStandardStreet = typeof GTO_STANDARD_STREETS[number];
export type GtoSolveKind = "heads-up" | "three-way";

export type GtoBettingTree = Readonly<{
  abstraction: "fixed-discrete";
  preflop: Readonly<{
    openRaiseToBb: 2.5;
    nonBlindOpenLimp: false;
    smallBlindMayComplete: true;
    threeBetToBb: Readonly<{ inPosition: 8; outOfPosition: 10 }>;
    fourBetToBb: Readonly<{ inPosition: 20; outOfPosition: 22 }>;
    fiveBet: "all-in";
    maxRaises: 4;
  }>;
  postflop: Readonly<{
    flop: Readonly<{ betPotFractions: readonly [0.33, 0.75]; raisePotAfterCallFractions: readonly [0.75] }>;
    turn: Readonly<{ betPotFractions: readonly [0.5, 1]; raisePotAfterCallFractions: readonly [0.75] }>;
    river: Readonly<{ betPotFractions: readonly [0.75, 1.25]; raisePotAfterCallFractions: readonly [0.75] }>;
    maxRaisesPerStreet: 2;
    allInAlwaysAvailable: true;
  }>;
}>;

export type GtoGameSpec = Readonly<{
  schemaVersion: typeof GTO_STANDARD_SCHEMA_VERSION;
  gameSpecId: string;
  treeId: string;
  name: "RangeCraft Standard v1";
  variant: "no-limit-holdem";
  tableSize: 6;
  positions: typeof GTO_STANDARD_POSITIONS;
  startingStackBb: 100;
  blindsBb: Readonly<{ small: 0.5; big: 1; ante: 0 }>;
  utility: "chip-ev";
  rake: Readonly<{ percent: 0; capBb: 0 }>;
  deck: Readonly<{ cards: 52; holeCards: 2; boardCards: readonly [3, 1, 1] }>;
  bettingTree: GtoBettingTree;
}>;

export const HEADS_UP_ACCURACY_THRESHOLDS = Object.freeze({
  commercialTargetMaxPotFraction: 0.003,
  trainingMaxPotFraction: 0.01,
}) as Readonly<{
  commercialTargetMaxPotFraction: 0.003;
  trainingMaxPotFraction: 0.01;
}>;

export const THREE_WAY_ACCURACY_THRESHOLDS = Object.freeze({
  highConfidenceMaxPotFraction: 0.001,
  trainingMaxPotFraction: 0.005,
}) as Readonly<{
  highConfidenceMaxPotFraction: 0.001;
  trainingMaxPotFraction: 0.005;
}>;

export type HeadsUpAccuracyLevel = "commercial-target" | "training" | "experimental";
export type ThreeWayAccuracyLevel = "high-confidence-approximation" | "training-approximation" | "experimental-approximation";

export type HeadsUpAccuracy = Readonly<{
  kind: "heads-up-exploitability";
  level: HeadsUpAccuracyLevel;
  value: number;
  unit: "pot-fraction";
  iterations: number;
}>;

export type ThreeWayAccuracy = Readonly<{
  kind: "three-way-nash-distance";
  level: ThreeWayAccuracyLevel;
  value: number;
  unit: "pot-fraction";
  iterations: number;
}>;

export type GtoAccuracy = HeadsUpAccuracy | ThreeWayAccuracy;

export type GtoSolverSource = Readonly<{
  kind: "internal-solver" | "licensed-dataset" | "public-research" | "manual-reference";
  name: string;
  license: string;
  url?: string;
  checksum?: string;
}>;

export type GtoActionDefinition = Readonly<{
  id: string;
  label: string;
}>;

export type GtoHoldingStrategy = Readonly<{
  holding: string;
  reachProbability: number;
  frequencies: readonly number[];
  actionEvBb?: readonly number[];
}>;

export type GtoStrategyNode = Readonly<{
  nodeId: string;
  street: GtoStandardStreet;
  actingPosition: GtoStandardPosition;
  potBb: number;
  effectiveStackBb: number;
  actions: readonly GtoActionDefinition[];
  holdings: readonly GtoHoldingStrategy[];
}>;

export type GtoSolverResult = Readonly<{
  schemaVersion: typeof GTO_RESULT_SCHEMA_VERSION;
  resultId: string;
  gameSpecId: string;
  treeId: string;
  solveKind: GtoSolveKind;
  participants: readonly GtoStandardPosition[];
  solverVersion: string;
  source: GtoSolverSource;
  accuracy: GtoAccuracy;
  nodes: readonly GtoStrategyNode[];
}>;

export type GtoSolverResultInput = Omit<GtoSolverResult, "resultId">;

const SHA256_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const);

const SHA256_INITIAL = Object.freeze([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const);

function rotateRight(value: number, amount: number) {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256(value: string) {
  const bytes = [...new TextEncoder().encode(value)];
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const highLength = Math.floor(bitLength / 0x1_0000_0000);
  const lowLength = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((highLength >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((lowLength >>> shift) & 0xff);

  const state: number[] = [...SHA256_INITIAL];
  const words = new Array<number>(64).fill(0);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const byte = offset + index * 4;
      words[index] = (
        (bytes[byte] << 24)
        | (bytes[byte + 1] << 16)
        | (bytes[byte + 2] << 8)
        | bytes[byte + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("稳定哈希只接受有限数值");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") throw new TypeError("稳定哈希只接受 JSON 数据");
  if (ancestors.has(value)) throw new TypeError("稳定哈希不接受循环引用");
  ancestors.add(value);
  let encoded: string;
  if (Array.isArray(value)) {
    encoded = `[${value.map((entry) => canonicalize(entry, ancestors)).join(",")}]`;
  } else {
    if (!isPlainRecord(value)) throw new TypeError("稳定哈希只接受普通对象");
    const keys = Object.keys(value).sort();
    encoded = `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], ancestors)}`).join(",")}}`;
  }
  ancestors.delete(value);
  return encoded;
}

/** Deterministic JSON with recursively sorted object keys. */
export function stableGtoJson(value: unknown) {
  return canonicalize(value, new Set());
}

/** SHA-256 over stableGtoJson; identical semantic JSON gets an identical id. */
export function stableGtoHash(value: unknown) {
  return sha256(stableGtoJson(value));
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

const STANDARD_BETTING_TREE: GtoBettingTree = deepFreeze({
  abstraction: "fixed-discrete",
  preflop: {
    openRaiseToBb: 2.5,
    nonBlindOpenLimp: false,
    smallBlindMayComplete: true,
    threeBetToBb: { inPosition: 8, outOfPosition: 10 },
    fourBetToBb: { inPosition: 20, outOfPosition: 22 },
    fiveBet: "all-in",
    maxRaises: 4,
  },
  postflop: {
    flop: { betPotFractions: [0.33, 0.75], raisePotAfterCallFractions: [0.75] },
    turn: { betPotFractions: [0.5, 1], raisePotAfterCallFractions: [0.75] },
    river: { betPotFractions: [0.75, 1.25], raisePotAfterCallFractions: [0.75] },
    maxRaisesPerStreet: 2,
    allInAlwaysAvailable: true,
  },
});

const STANDARD_CORE = deepFreeze({
  schemaVersion: GTO_STANDARD_SCHEMA_VERSION,
  name: "RangeCraft Standard v1",
  variant: "no-limit-holdem",
  tableSize: 6,
  positions: GTO_STANDARD_POSITIONS,
  startingStackBb: 100,
  blindsBb: { small: 0.5, big: 1, ante: 0 },
  utility: "chip-ev",
  rake: { percent: 0, capBb: 0 },
  deck: { cards: 52, holeCards: 2, boardCards: [3, 1, 1] },
  bettingTree: STANDARD_BETTING_TREE,
} as const);

const STANDARD_TREE_ID = `rc-tree-v1-${stableGtoHash(STANDARD_BETTING_TREE)}`;
const STANDARD_GAME_SPEC_ID = `rc-game-v1-${stableGtoHash({ ...STANDARD_CORE, treeId: STANDARD_TREE_ID })}`;

export const RANGECRAFT_STANDARD_V1: GtoGameSpec = deepFreeze({
  ...STANDARD_CORE,
  gameSpecId: STANDARD_GAME_SPEC_ID,
  treeId: STANDARD_TREE_ID,
});

function fail(path: string, message: string): never {
  throw new TypeError(`${path}：${message}`);
}

function recordAt(value: unknown, path: string) {
  if (!isPlainRecord(value)) fail(path, "必须是普通对象");
  return value;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], path: string) {
  const expected = new Set(keys);
  const extras = Object.keys(record).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in record));
  if (missing.length) fail(path, `缺少字段 ${missing.join(", ")}`);
  if (extras.length) fail(path, `存在未知字段 ${extras.join(", ")}`);
}

function stringAt(value: unknown, path: string) {
  if (typeof value !== "string" || value.trim() === "") fail(path, "必须是非空字符串");
  return value;
}

function finiteAt(value: unknown, path: string, minimum = -Infinity, maximum = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `必须是 ${minimum}..${maximum} 内的有限数值`);
  }
  return value;
}

function integerAt(value: unknown, path: string, minimum = 0) {
  const parsed = finiteAt(value, path, minimum);
  if (!Number.isInteger(parsed)) fail(path, "必须是整数");
  return parsed;
}

function literalAt<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) fail(path, `必须是 ${choices.join(" | ")}`);
  return value as T;
}

function arrayAt(value: unknown, path: string) {
  if (!Array.isArray(value)) fail(path, "必须是数组");
  return value;
}

function assertStandardSemantics(spec: Record<string, unknown>) {
  // A canonical comparison validates every literal, nested rule and sizing,
  // while still accepting a deserialized copy rather than requiring identity.
  const expected = stableGtoJson(RANGECRAFT_STANDARD_V1);
  if (stableGtoJson(spec) !== expected) fail("gameSpec", "不是 RangeCraft Standard v1 的完整规范");
}

/** Validates a deserialized Standard v1 spec and returns a frozen copy. */
export function parseGtoGameSpec(input: unknown): GtoGameSpec {
  const spec = recordAt(input, "gameSpec");
  exactKeys(spec, Object.keys(RANGECRAFT_STANDARD_V1), "gameSpec");
  assertStandardSemantics(spec);
  return deepFreeze(JSON.parse(stableGtoJson(spec)) as GtoGameSpec);
}

export function headsUpAccuracyLevel(value: number): HeadsUpAccuracyLevel {
  finiteAt(value, "accuracy.value", 0);
  if (value <= HEADS_UP_ACCURACY_THRESHOLDS.commercialTargetMaxPotFraction) return "commercial-target";
  if (value <= HEADS_UP_ACCURACY_THRESHOLDS.trainingMaxPotFraction) return "training";
  return "experimental";
}

export function threeWayAccuracyLevel(value: number): ThreeWayAccuracyLevel {
  finiteAt(value, "accuracy.value", 0);
  if (value <= THREE_WAY_ACCURACY_THRESHOLDS.highConfidenceMaxPotFraction) return "high-confidence-approximation";
  if (value <= THREE_WAY_ACCURACY_THRESHOLDS.trainingMaxPotFraction) return "training-approximation";
  return "experimental-approximation";
}

function parseSource(input: unknown): GtoSolverSource {
  const source = recordAt(input, "source");
  const allowed = ["kind", "name", "license", "url", "checksum"];
  const required = ["kind", "name", "license"];
  const extras = Object.keys(source).filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => !(key in source));
  if (missing.length) fail("source", `缺少字段 ${missing.join(", ")}`);
  if (extras.length) fail("source", `存在未知字段 ${extras.join(", ")}`);
  const parsed: GtoSolverSource = {
    kind: literalAt(source.kind, ["internal-solver", "licensed-dataset", "public-research", "manual-reference"], "source.kind"),
    name: stringAt(source.name, "source.name"),
    license: stringAt(source.license, "source.license"),
    ...(source.url === undefined ? {} : { url: stringAt(source.url, "source.url") }),
    ...(source.checksum === undefined ? {} : { checksum: stringAt(source.checksum, "source.checksum") }),
  };
  return parsed;
}

function parseAccuracy(input: unknown, solveKind: GtoSolveKind): GtoAccuracy {
  const accuracy = recordAt(input, "accuracy");
  exactKeys(accuracy, ["kind", "level", "value", "unit", "iterations"], "accuracy");
  const value = finiteAt(accuracy.value, "accuracy.value", 0);
  const iterations = integerAt(accuracy.iterations, "accuracy.iterations", 1);
  if (accuracy.unit !== "pot-fraction") fail("accuracy.unit", "必须是 pot-fraction");
  if (solveKind === "heads-up") {
    if (accuracy.kind !== "heads-up-exploitability") fail("accuracy.kind", "单挑结果必须报告 heads-up-exploitability");
    const level = headsUpAccuracyLevel(value);
    if (accuracy.level !== level) fail("accuracy.level", `数值 ${value} 对应等级应为 ${level}`);
    return { kind: "heads-up-exploitability", level, value, unit: "pot-fraction", iterations };
  }
  if (accuracy.kind !== "three-way-nash-distance") fail("accuracy.kind", "三人结果必须报告 three-way-nash-distance");
  const level = threeWayAccuracyLevel(value);
  if (accuracy.level !== level) fail("accuracy.level", `数值 ${value} 对应等级应为 ${level}`);
  return { kind: "three-way-nash-distance", level, value, unit: "pot-fraction", iterations };
}

function parseNode(input: unknown, index: number): GtoStrategyNode {
  const path = `nodes[${index}]`;
  const node = recordAt(input, path);
  exactKeys(node, ["nodeId", "street", "actingPosition", "potBb", "effectiveStackBb", "actions", "holdings"], path);
  const actions = arrayAt(node.actions, `${path}.actions`).map((entry, actionIndex) => {
    const actionPath = `${path}.actions[${actionIndex}]`;
    const action = recordAt(entry, actionPath);
    exactKeys(action, ["id", "label"], actionPath);
    return { id: stringAt(action.id, `${actionPath}.id`), label: stringAt(action.label, `${actionPath}.label`) };
  });
  if (actions.length < 2) fail(`${path}.actions`, "至少需要两个合法动作");
  if (new Set(actions.map((action) => action.id)).size !== actions.length) fail(`${path}.actions`, "动作 id 不得重复");

  const holdings = arrayAt(node.holdings, `${path}.holdings`).map((entry, holdingIndex) => {
    const holdingPath = `${path}.holdings[${holdingIndex}]`;
    const holding = recordAt(entry, holdingPath);
    const allowed = ["holding", "reachProbability", "frequencies", "actionEvBb"];
    const required = ["holding", "reachProbability", "frequencies"];
    const extras = Object.keys(holding).filter((key) => !allowed.includes(key));
    const missing = required.filter((key) => !(key in holding));
    if (missing.length) fail(holdingPath, `缺少字段 ${missing.join(", ")}`);
    if (extras.length) fail(holdingPath, `存在未知字段 ${extras.join(", ")}`);
    const frequencies = arrayAt(holding.frequencies, `${holdingPath}.frequencies`)
      .map((frequency, frequencyIndex) => finiteAt(frequency, `${holdingPath}.frequencies[${frequencyIndex}]`, 0, 1));
    if (frequencies.length !== actions.length) fail(`${holdingPath}.frequencies`, "必须与 actions 等长");
    const total = frequencies.reduce((sum, frequency) => sum + frequency, 0);
    if (Math.abs(total - 1) > 1e-6) fail(`${holdingPath}.frequencies`, `总和必须为 1，当前为 ${total}`);
    const actionEvBb = holding.actionEvBb === undefined
      ? undefined
      : arrayAt(holding.actionEvBb, `${holdingPath}.actionEvBb`)
        .map((ev, evIndex) => finiteAt(ev, `${holdingPath}.actionEvBb[${evIndex}]`));
    if (actionEvBb && actionEvBb.length !== actions.length) fail(`${holdingPath}.actionEvBb`, "必须与 actions 等长");
    return {
      holding: stringAt(holding.holding, `${holdingPath}.holding`),
      reachProbability: finiteAt(holding.reachProbability, `${holdingPath}.reachProbability`, 0, 1),
      frequencies,
      ...(actionEvBb ? { actionEvBb } : {}),
    };
  });
  if (holdings.length === 0) fail(`${path}.holdings`, "不得为空");
  if (new Set(holdings.map((holding) => holding.holding)).size !== holdings.length) fail(`${path}.holdings`, "holding 不得重复");
  return {
    nodeId: stringAt(node.nodeId, `${path}.nodeId`),
    street: literalAt(node.street, GTO_STANDARD_STREETS, `${path}.street`),
    actingPosition: literalAt(node.actingPosition, GTO_STANDARD_POSITIONS, `${path}.actingPosition`),
    potBb: finiteAt(node.potBb, `${path}.potBb`, 0),
    effectiveStackBb: finiteAt(node.effectiveStackBb, `${path}.effectiveStackBb`, 0, 100),
    actions,
    holdings,
  };
}

function parseResultPayload(input: unknown, expectedSpec: GtoGameSpec, expectResultId: boolean) {
  const result = recordAt(input, "result");
  const keys = ["schemaVersion", ...(expectResultId ? ["resultId"] : []), "gameSpecId", "treeId", "solveKind", "participants", "solverVersion", "source", "accuracy", "nodes"];
  exactKeys(result, keys, "result");
  if (result.schemaVersion !== GTO_RESULT_SCHEMA_VERSION) fail("result.schemaVersion", `必须是 ${GTO_RESULT_SCHEMA_VERSION}`);
  if (result.gameSpecId !== expectedSpec.gameSpecId) fail("result.gameSpecId", "与所选游戏规范不匹配");
  if (result.treeId !== expectedSpec.treeId) fail("result.treeId", "与所选下注树不匹配");
  const solveKind = literalAt(result.solveKind, ["heads-up", "three-way"], "result.solveKind");
  const participants = arrayAt(result.participants, "result.participants")
    .map((position, index) => literalAt(position, GTO_STANDARD_POSITIONS, `result.participants[${index}]`));
  const expectedParticipants = solveKind === "heads-up" ? 2 : 3;
  if (participants.length !== expectedParticipants) fail("result.participants", `${solveKind} 必须有 ${expectedParticipants} 名参与者`);
  if (new Set(participants).size !== participants.length) fail("result.participants", "参与位置不得重复");
  const nodes = arrayAt(result.nodes, "result.nodes").map(parseNode);
  if (nodes.length === 0) fail("result.nodes", "不得为空");
  if (new Set(nodes.map((node) => node.nodeId)).size !== nodes.length) fail("result.nodes", "nodeId 不得重复");
  for (const node of nodes) {
    if (!participants.includes(node.actingPosition)) fail(`node ${node.nodeId}`, "行动位置不在参与者列表中");
  }
  const parsed = {
    schemaVersion: GTO_RESULT_SCHEMA_VERSION,
    gameSpecId: expectedSpec.gameSpecId,
    treeId: expectedSpec.treeId,
    solveKind,
    participants,
    solverVersion: stringAt(result.solverVersion, "result.solverVersion"),
    source: parseSource(result.source),
    accuracy: parseAccuracy(result.accuracy, solveKind),
    nodes,
  } satisfies GtoSolverResultInput;
  return { parsed, suppliedResultId: expectResultId ? stringAt(result.resultId, "result.resultId") : undefined };
}

/** Validates solver output, computes its content id, and recursively freezes it. */
export function createGtoSolverResult(input: GtoSolverResultInput, expectedSpec = RANGECRAFT_STANDARD_V1): GtoSolverResult {
  const { parsed } = parseResultPayload(input, expectedSpec, false);
  const resultId = `rc-result-v1-${stableGtoHash(parsed)}`;
  return deepFreeze({ ...parsed, resultId });
}

/** Validates a stored result, including its content hash, and freezes a copy. */
export function parseGtoSolverResult(input: unknown, expectedSpec = RANGECRAFT_STANDARD_V1): GtoSolverResult {
  const { parsed, suppliedResultId } = parseResultPayload(input, expectedSpec, true);
  const expectedResultId = `rc-result-v1-${stableGtoHash(parsed)}`;
  if (suppliedResultId !== expectedResultId) fail("result.resultId", "内容哈希不匹配，数据可能已损坏或被修改");
  return deepFreeze({ ...parsed, resultId: expectedResultId });
}
