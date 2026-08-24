import { stableGtoJson } from "./gto-standard.ts";
import {
  STRATEGY_SCHEMA_VERSION_V2,
  assertStrategySpotV2,
  createStrategyResolutionV2,
  strategyConfigKeyV2,
  strategyNodeKeyV2,
  type ExactStrategyResolutionV2,
  type FallbackStrategyResolutionV2,
  type PokerStrategyProviderV2,
  type StrategyActionFrequencyV2,
  type StrategyErrorV2,
  type StrategyFallbackReasonV2,
  type StrategyLegalActionV2,
  type StrategyLicenseV2,
  type StrategyResolutionV2,
  type StrategySpotV2,
} from "./poker-strategy.ts";

export const STATIC_STRATEGY_PACK_SCHEMA_V1 = "rangecraft-static-strategy-pack/v1" as const;

export type StaticStrategyPackNodeV1 = Readonly<{
  nodeKey: string;
  nodeId: string;
  legalActions: readonly StrategyLegalActionV2[];
  actions: readonly StrategyActionFrequencyV2[];
  /** Optional tighter per-node audit; otherwise the pack-level error is used. */
  error?: StrategyErrorV2;
}>;

/** Immutable output generated offline. It contains no opponent private state. */
export type StaticStrategyPackV1 = Readonly<{
  schemaVersion: typeof STATIC_STRATEGY_PACK_SCHEMA_V1;
  packId: string;
  packVersion: string;
  configId: string;
  gameSpecId: string;
  treeId: string;
  solver: Readonly<{ name: string; version: string }>;
  error: StrategyErrorV2;
  license: StrategyLicenseV2;
  nodes: readonly StaticStrategyPackNodeV1[];
}>;

export type StrategyPackLookupRequestV2 = Readonly<{
  nodeKey: string;
  configId: string;
  gameSpecId: string;
  treeId: string;
}>;

/** A loader may fetch one static shard; the source validates all returned data. */
export type StaticStrategyPackLoaderV2 = (
  request: StrategyPackLookupRequestV2,
  signal?: AbortSignal,
) => Promise<unknown | null>;

export type StrategyFallbackContextV2 = Readonly<{
  code: Extract<StrategyFallbackReasonV2["code"], "node-not-found" | "solver-unavailable">;
  message: string;
  cause?: unknown;
}>;

/** The fallback boundary is separate so an exact result can never masquerade as degradation. */
export interface FallbackPokerStrategyProviderV2 {
  resolve(
    spot: StrategySpotV2,
    context: StrategyFallbackContextV2,
    signal?: AbortSignal,
  ): Promise<FallbackStrategyResolutionV2>;
}

export class StrategyPackValidationError extends TypeError {
  constructor(message: string) {
    super(`静态策略包无效：${message}`);
    this.name = "StrategyPackValidationError";
  }
}

function packError(message: string): never {
  throw new StrategyPackValidationError(message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) packError(`${path} 必须是普通对象`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) packError(`${path} 必须是普通对象`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[], path: string) {
  const allowedSet = new Set(allowed);
  const extras = Object.keys(value).filter((key) => !allowedSet.has(key));
  const missing = required.filter((key) => !(key in value));
  if (missing.length > 0) packError(`${path} 缺少字段 ${missing.join(", ")}`);
  if (extras.length > 0) packError(`${path} 存在未知字段 ${extras.join(", ")}`);
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") packError(`${path} 必须是非空字符串`);
  return value;
}

function finiteNumber(value: unknown, path: string, minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    packError(`${path} 必须是 ${minimum}..${maximum} 内的有限数值`);
  }
  return value;
}

function booleanValue(value: unknown, path: string) {
  if (typeof value !== "boolean") packError(`${path} 必须是布尔值`);
  return value;
}

function parseError(value: unknown, path: string): StrategyErrorV2 {
  const source = record(value, path);
  exactKeys(source, ["metric", "value", "unit"], ["metric", "value", "unit"], path);
  const metric = source.metric;
  if (metric !== "exploitability" && metric !== "nash-distance" && metric !== "expected-value-loss") {
    packError(`${path}.metric 必须是已测量的 solver error`);
  }
  const unit = source.unit;
  if (unit !== "pot-fraction" && unit !== "bb-per-hand") packError(`${path}.unit 无效`);
  return Object.freeze({
    metric,
    value: finiteNumber(source.value, `${path}.value`, 0),
    unit,
  });
}

function parseLicense(value: unknown, path: string): StrategyLicenseV2 {
  const source = record(value, path);
  exactKeys(
    source,
    ["name", "spdxId", "url", "redistribution"],
    ["name", "redistribution"],
    path,
  );
  const redistribution = source.redistribution;
  if (redistribution !== "allowed" && redistribution !== "restricted" && redistribution !== "internal-only") {
    packError(`${path}.redistribution 无效`);
  }
  return Object.freeze({
    name: nonEmptyString(source.name, `${path}.name`),
    ...(source.spdxId === undefined ? {} : { spdxId: nonEmptyString(source.spdxId, `${path}.spdxId`) }),
    ...(source.url === undefined ? {} : { url: nonEmptyString(source.url, `${path}.url`) }),
    redistribution,
  });
}

function legalActionIdentity(action: StrategyLegalActionV2) {
  return action.action === "raise" ? `raise:${action.raiseToBb}` : action.action;
}

function fullLegalActionIdentity(action: StrategyLegalActionV2) {
  return action.action === "raise" ? `raise:${action.raiseToBb}:${action.isAllIn ? "all-in" : "full"}` : action.action;
}

function strategyActionIdentity(action: StrategyActionFrequencyV2) {
  return action.action === "raise" ? `raise:${action.raiseToBb}` : action.action;
}

function parseLegalActions(value: unknown, path: string): readonly StrategyLegalActionV2[] {
  if (!Array.isArray(value) || value.length === 0) packError(`${path} 不能为空`);
  const seen = new Set<string>();
  const result = value.map((entry, index) => {
    const actionPath = `${path}[${index}]`;
    const source = record(entry, actionPath);
    const kind = source.action;
    let parsed: StrategyLegalActionV2;
    if (kind === "raise") {
      exactKeys(source, ["action", "raiseToBb", "isAllIn"], ["action", "raiseToBb", "isAllIn"], actionPath);
      parsed = Object.freeze({
        action: "raise",
        raiseToBb: finiteNumber(source.raiseToBb, `${actionPath}.raiseToBb`, 0),
        isAllIn: booleanValue(source.isAllIn, `${actionPath}.isAllIn`),
      });
    } else if (kind === "fold" || kind === "check" || kind === "call") {
      exactKeys(source, ["action"], ["action"], actionPath);
      parsed = Object.freeze({ action: kind });
    } else {
      packError(`${actionPath}.action 无效`);
    }
    const identity = legalActionIdentity(parsed);
    if (seen.has(identity)) packError(`${path} 包含重复动作 ${identity}`);
    seen.add(identity);
    return parsed;
  });
  return Object.freeze(result);
}

function parseStrategyActions(value: unknown, path: string): readonly StrategyActionFrequencyV2[] {
  if (!Array.isArray(value) || value.length === 0) packError(`${path} 不能为空`);
  const seen = new Set<string>();
  let total = 0;
  const result = value.map((entry, index) => {
    const actionPath = `${path}[${index}]`;
    const source = record(entry, actionPath);
    const kind = source.action;
    const frequency = finiteNumber(source.frequency, `${actionPath}.frequency`, 0, 1);
    const evBb = finiteNumber(source.evBb, `${actionPath}.evBb`);
    let parsed: StrategyActionFrequencyV2;
    if (kind === "raise") {
      exactKeys(source, ["action", "frequency", "raiseToBb", "evBb"], ["action", "frequency", "raiseToBb", "evBb"], actionPath);
      parsed = Object.freeze({
        action: "raise",
        frequency,
        raiseToBb: finiteNumber(source.raiseToBb, `${actionPath}.raiseToBb`, 0),
        evBb,
      });
    } else if (kind === "fold" || kind === "check" || kind === "call") {
      exactKeys(source, ["action", "frequency", "evBb"], ["action", "frequency", "evBb"], actionPath);
      parsed = Object.freeze({ action: kind, frequency, evBb });
    } else {
      packError(`${actionPath}.action 无效`);
    }
    const identity = strategyActionIdentity(parsed);
    if (seen.has(identity)) packError(`${path} 包含重复动作 ${identity}`);
    seen.add(identity);
    total += frequency;
    return parsed;
  });
  if (Math.abs(total - 1) > 1e-6) packError(`${path} 频率总和必须为 1，当前为 ${total}`);
  return Object.freeze(result);
}

function sameIdentities(left: readonly string[], right: readonly string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((identity, index) => identity === sortedRight[index]);
}

function parseNode(value: unknown, index: number): StaticStrategyPackNodeV1 {
  const path = `pack.nodes[${index}]`;
  const source = record(value, path);
  exactKeys(
    source,
    ["nodeKey", "nodeId", "legalActions", "actions", "error"],
    ["nodeKey", "nodeId", "legalActions", "actions"],
    path,
  );
  const nodeKey = nonEmptyString(source.nodeKey, `${path}.nodeKey`);
  if (!/^rc-strategy-node-v2-[a-f0-9]{64}$/.test(nodeKey)) packError(`${path}.nodeKey 格式无效`);
  const legalActions = parseLegalActions(source.legalActions, `${path}.legalActions`);
  const actions = parseStrategyActions(source.actions, `${path}.actions`);
  if (!sameIdentities(legalActions.map(legalActionIdentity), actions.map(strategyActionIdentity))) {
    packError(`${path}.actions 与 legalActions 不一致`);
  }
  return Object.freeze({
    nodeKey,
    nodeId: nonEmptyString(source.nodeId, `${path}.nodeId`),
    legalActions,
    actions,
    ...(source.error === undefined ? {} : { error: parseError(source.error, `${path}.error`) }),
  });
}

/** Parses and freezes untrusted JSON before it can enter the exact cache. */
export function parseStaticStrategyPackV1(value: unknown): StaticStrategyPackV1 {
  const source = record(value, "pack");
  exactKeys(
    source,
    ["schemaVersion", "packId", "packVersion", "configId", "gameSpecId", "treeId", "solver", "error", "license", "nodes"],
    ["schemaVersion", "packId", "packVersion", "configId", "gameSpecId", "treeId", "solver", "error", "license", "nodes"],
    "pack",
  );
  if (source.schemaVersion !== STATIC_STRATEGY_PACK_SCHEMA_V1) packError("pack.schemaVersion 不受支持");
  const configId = nonEmptyString(source.configId, "pack.configId");
  if (!/^rc-strategy-config-v2-[a-f0-9]{64}$/.test(configId)) packError("pack.configId 格式无效");
  const solverSource = record(source.solver, "pack.solver");
  exactKeys(solverSource, ["name", "version"], ["name", "version"], "pack.solver");
  if (!Array.isArray(source.nodes) || source.nodes.length === 0) packError("pack.nodes 不能为空");
  const nodes = source.nodes.map(parseNode);
  if (new Set(nodes.map((node) => node.nodeKey)).size !== nodes.length) packError("pack.nodes 不得包含重复 nodeKey");
  return Object.freeze({
    schemaVersion: STATIC_STRATEGY_PACK_SCHEMA_V1,
    packId: nonEmptyString(source.packId, "pack.packId"),
    packVersion: nonEmptyString(source.packVersion, "pack.packVersion"),
    configId,
    gameSpecId: nonEmptyString(source.gameSpecId, "pack.gameSpecId"),
    treeId: nonEmptyString(source.treeId, "pack.treeId"),
    solver: Object.freeze({
      name: nonEmptyString(solverSource.name, "pack.solver.name"),
      version: nonEmptyString(solverSource.version, "pack.solver.version"),
    }),
    error: parseError(source.error, "pack.error"),
    license: parseLicense(source.license, "pack.license"),
    nodes: Object.freeze(nodes),
  });
}

type LoadedNode = Readonly<{
  pack: StaticStrategyPackV1;
  node: StaticStrategyPackNodeV1;
}>;

export type StaticStrategyPackSourceOptionsV2 = Readonly<{
  initialPacks?: readonly unknown[];
  loader?: StaticStrategyPackLoaderV2;
}>;

/** Exact-only cache/source. A miss is represented by null, never by approximation. */
export class StaticStrategyPackSourceV2 {
  readonly #loader?: StaticStrategyPackLoaderV2;
  readonly #nodes = new Map<string, LoadedNode>();
  readonly #inflight = new Map<string, Promise<ExactStrategyResolutionV2 | null>>();

  constructor(options: StaticStrategyPackSourceOptionsV2 = {}) {
    this.#loader = options.loader;
    for (const pack of options.initialPacks ?? []) this.install(pack);
  }

  install(value: unknown): StaticStrategyPackV1 {
    const pack = parseStaticStrategyPackV1(value);
    for (const node of pack.nodes) {
      const existing = this.#nodes.get(node.nodeKey);
      const candidate = { pack, node };
      if (existing && stableGtoJson(existing) !== stableGtoJson(candidate)) {
        packError(`nodeKey ${node.nodeKey} 已由另一份不同的策略包占用`);
      }
    }
    for (const node of pack.nodes) this.#nodes.set(node.nodeKey, { pack, node });
    return pack;
  }

  peekExact(spot: StrategySpotV2): ExactStrategyResolutionV2 | null {
    assertStrategySpotV2(spot);
    const nodeKey = strategyNodeKeyV2(spot);
    const loaded = this.#nodes.get(nodeKey);
    return loaded ? this.#materialize(spot, loaded) : null;
  }

  async resolveExact(spot: StrategySpotV2, signal?: AbortSignal): Promise<ExactStrategyResolutionV2 | null> {
    const cached = this.peekExact(spot);
    if (cached || !this.#loader) return cached;
    const request = this.#request(spot);
    const existing = this.#inflight.get(request.nodeKey);
    if (existing) return existing;
    const task = this.#load(request, spot, signal).finally(() => {
      if (this.#inflight.get(request.nodeKey) === task) this.#inflight.delete(request.nodeKey);
    });
    this.#inflight.set(request.nodeKey, task);
    return task;
  }

  #request(spot: StrategySpotV2): StrategyPackLookupRequestV2 {
    return Object.freeze({
      nodeKey: strategyNodeKeyV2(spot),
      configId: strategyConfigKeyV2(spot.gameConfig),
      gameSpecId: spot.gameSpecId,
      treeId: spot.treeId,
    });
  }

  async #load(
    request: StrategyPackLookupRequestV2,
    spot: StrategySpotV2,
    signal?: AbortSignal,
  ): Promise<ExactStrategyResolutionV2 | null> {
    const rawPack = await this.#loader?.(request, signal);
    if (rawPack === null || rawPack === undefined) return null;
    const pack = parseStaticStrategyPackV1(rawPack);
    if (pack.configId !== request.configId) packError("loader 返回了不同 configId 的策略包");
    if (pack.gameSpecId !== request.gameSpecId) packError("loader 返回了不同 gameSpecId 的策略包");
    if (pack.treeId !== request.treeId) packError("loader 返回了不同 treeId 的策略包");
    this.install(pack);
    return this.peekExact(spot);
  }

  #materialize(spot: StrategySpotV2, loaded: LoadedNode): ExactStrategyResolutionV2 {
    const { pack, node } = loaded;
    const expectedNodeKey = strategyNodeKeyV2(spot);
    const expectedConfigId = strategyConfigKeyV2(spot.gameConfig);
    if (node.nodeKey !== expectedNodeKey) packError("缓存 nodeKey 与请求节点不一致");
    if (pack.configId !== expectedConfigId) packError("缓存 configId 与请求规则不一致");
    if (pack.gameSpecId !== spot.gameSpecId) packError("缓存 gameSpecId 与请求规则不一致");
    if (pack.treeId !== spot.treeId) packError("缓存 treeId 与请求下注树不一致");
    const expectedLegal = spot.legalActions.map(fullLegalActionIdentity).sort();
    const packedLegal = node.legalActions.map(fullLegalActionIdentity).sort();
    if (!sameIdentities(expectedLegal, packedLegal)) packError("缓存 legalActions 与请求节点不完全一致");
    const resolution = createStrategyResolutionV2(spot, {
      resolution: "exact",
      provenance: {
        kind: "solved-pack-node",
        packId: pack.packId,
        packVersion: pack.packVersion,
        nodeId: node.nodeId,
        configId: pack.configId,
        solver: pack.solver,
        error: node.error ?? pack.error,
        license: pack.license,
      },
      actions: node.actions,
    });
    if (resolution.resolution !== "exact") packError("精确节点被错误解析为 fallback");
    return resolution;
  }
}

function providerError(message: string): never {
  throw new TypeError(`策略 Provider 返回无效结果：${message}`);
}

function revalidateResolution(
  spot: StrategySpotV2,
  result: StrategyResolutionV2,
  expected: StrategyResolutionV2["resolution"],
): StrategyResolutionV2 {
  if (result === null || typeof result !== "object") providerError("结果必须是对象");
  const nodeKey = strategyNodeKeyV2(spot);
  if (result.schemaVersion !== STRATEGY_SCHEMA_VERSION_V2) providerError("schemaVersion 不匹配");
  if (result.nodeKey !== nodeKey) providerError("nodeKey 不匹配");
  if (result.gameSpecId !== spot.gameSpecId) providerError("gameSpecId 不匹配");
  if (result.treeId !== spot.treeId) providerError("treeId 不匹配");
  if (result.resolution !== expected) providerError(`预期 ${expected}，实际为 ${result.resolution}`);
  const rebuilt = result.resolution === "exact"
    ? createStrategyResolutionV2(spot, {
        resolution: "exact",
        provenance: result.provenance,
        actions: result.actions,
      })
    : createStrategyResolutionV2(spot, {
        resolution: "fallback",
        provenance: result.provenance,
        fallbackReason: result.fallbackReason,
        actions: result.actions,
      });
  if (stableGtoJson(result) !== stableGtoJson(rebuilt)) providerError("结果包含未验证字段或未归一化内容");
  return rebuilt;
}

type DecisionLock = Readonly<{
  nodeKey: string;
  result: StrategyResolutionV2;
}>;

type DecisionInflight = Readonly<{
  nodeKey: string;
  promise: Promise<StrategyResolutionV2>;
}>;

function decisionIdValue(decisionId: string) {
  if (typeof decisionId !== "string" || decisionId.trim() === "") throw new TypeError("decisionId 不能为空");
  return decisionId;
}

function aborted(): DOMException {
  return new DOMException("策略查询已取消", "AbortError");
}

function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export type CompositePokerStrategyProviderOptionsV2 = Readonly<{
  exact: StaticStrategyPackSourceV2;
  fallback: FallbackPokerStrategyProviderV2;
}>;

/**
 * Exact-first provider with explicit decision locks. `resolveDecision` pins the
 * first valid exact/fallback result; later cache changes cannot rewrite it.
 */
export class CompositePokerStrategyProviderV2 implements PokerStrategyProviderV2 {
  readonly #exact: StaticStrategyPackSourceV2;
  readonly #fallback: FallbackPokerStrategyProviderV2;
  readonly #locks = new Map<string, DecisionLock>();
  readonly #inflight = new Map<string, DecisionInflight>();

  constructor(options: CompositePokerStrategyProviderOptionsV2) {
    this.#exact = options.exact;
    this.#fallback = options.fallback;
  }

  peek(spot: StrategySpotV2): StrategyResolutionV2 | null {
    return this.peekDecision(`node:${strategyNodeKeyV2(spot)}`, spot);
  }

  resolve(spot: StrategySpotV2, signal?: AbortSignal): Promise<StrategyResolutionV2> {
    return this.resolveDecision(`node:${strategyNodeKeyV2(spot)}`, spot, signal);
  }

  peekDecision(decisionId: string, spot: StrategySpotV2): StrategyResolutionV2 | null {
    const id = decisionIdValue(decisionId);
    assertStrategySpotV2(spot);
    const nodeKey = strategyNodeKeyV2(spot);
    this.#assertDecisionNode(id, nodeKey);
    const locked = this.#locks.get(id);
    if (locked) return locked.result;
    const exact = this.#exact.peekExact(spot);
    if (!exact) return null;
    const result = revalidateResolution(spot, exact, "exact");
    this.#locks.set(id, { nodeKey, result });
    return result;
  }

  resolveDecision(decisionId: string, spot: StrategySpotV2, signal?: AbortSignal): Promise<StrategyResolutionV2> {
    const id = decisionIdValue(decisionId);
    assertStrategySpotV2(spot);
    const nodeKey = strategyNodeKeyV2(spot);
    this.#assertDecisionNode(id, nodeKey);
    const locked = this.#locks.get(id);
    if (locked) return waitWithSignal(Promise.resolve(locked.result), signal);
    const pending = this.#inflight.get(id);
    if (pending) return waitWithSignal(pending.promise, signal);

    const task = this.#compute(spot).then((candidate) => {
      const current = this.#inflight.get(id);
      if (current?.promise !== task) return candidate;
      const first = this.#locks.get(id)?.result ?? candidate;
      if (!this.#locks.has(id)) this.#locks.set(id, { nodeKey, result: first });
      return first;
    }).finally(() => {
      if (this.#inflight.get(id)?.promise === task) this.#inflight.delete(id);
    });
    this.#inflight.set(id, { nodeKey, promise: task });
    return waitWithSignal(task, signal);
  }

  /** Ending a hand/decision permits a future query to use a newly available exact pack. */
  releaseDecision(decisionId: string): void {
    const id = decisionIdValue(decisionId);
    this.#locks.delete(id);
    this.#inflight.delete(id);
  }

  clearDecisionLocks(): void {
    this.#locks.clear();
    this.#inflight.clear();
  }

  #assertDecisionNode(decisionId: string, nodeKey: string) {
    const locked = this.#locks.get(decisionId);
    const pending = this.#inflight.get(decisionId);
    const existingNodeKey = locked?.nodeKey ?? pending?.nodeKey;
    if (existingNodeKey && existingNodeKey !== nodeKey) {
      throw new RangeError(`decisionId ${decisionId} 已绑定到另一策略节点`);
    }
  }

  async #compute(spot: StrategySpotV2): Promise<StrategyResolutionV2> {
    let context: StrategyFallbackContextV2 = {
      code: "node-not-found",
      message: "完整节点键未命中静态解库",
    };
    try {
      const exact = await this.#exact.resolveExact(spot);
      if (exact) return revalidateResolution(spot, exact, "exact");
    } catch (cause) {
      context = {
        code: "solver-unavailable",
        message: "静态解库加载或校验失败",
        cause,
      };
    }
    const fallback = await this.#fallback.resolve(spot, context);
    return revalidateResolution(spot, fallback, "fallback");
  }
}
