import type {
  GtoActionDefinition,
  GtoHoldingStrategy,
  GtoSolverResult,
  GtoStrategyNode,
} from "./gto-standard.ts";

const FREQUENCY_TOLERANCE = 1e-6;

export type GtoBenchmarkCoverage = Readonly<{
  /** Sum of reference reachProbability across every reference node/holding. */
  referenceReachWeight: number;
  /** Reference reach represented by a node/holding present in the candidate. */
  coveredReferenceReachWeight: number;
  /** coveredReferenceReachWeight / referenceReachWeight. */
  fraction: number;
  referenceHoldingCount: number;
  comparedHoldingCount: number;
}>;

export type GtoBenchmarkMaxActionError = Readonly<{
  value: number;
  nodeId: string;
  holding: string;
  actionId: string;
  referenceFrequency: number;
  candidateFrequency: number;
}>;

export type GtoBenchmarkReport = Readonly<{
  candidateResultId: string;
  referenceResultId: string;
  gameSpecId: string;
  treeId: string;
  solveKind: GtoSolverResult["solveKind"];
  participants: readonly GtoSolverResult["participants"][number][];
  sharedNodeCount: number;
  coverage: GtoBenchmarkCoverage;
  /** Reference-reach-weighted mean total-variation distance on covered holdings. */
  meanTotalVariation: number;
  maxSingleActionFrequencyError: GtoBenchmarkMaxActionError;
  /**
   * Candidate mixed-strategy regret under reference action EVs, weighted by
   * reference reach and normalized over covered holdings. Null when any
   * reference holding lacks a complete actionEvBb vector.
   */
  weightedEvRegretBb: number | null;
}>;

type IndexedNode = Readonly<{
  node: GtoStrategyNode;
  actions: ReadonlyMap<string, number>;
  holdings: ReadonlyMap<string, GtoHoldingStrategy>;
}>;

type IndexedResult = Readonly<{
  nodes: ReadonlyMap<string, IndexedNode>;
}>;

function benchmarkError(message: string): never {
  throw new TypeError(`GTO 对标失败：${message}`);
}

function requireNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") benchmarkError(`${path} 必须是非空字符串`);
}

function requireFinite(value: unknown, path: string, minimum = -Infinity, maximum = Infinity): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    benchmarkError(`${path} 必须是 ${minimum}..${maximum} 内的有限数值`);
  }
}

function buildUniqueIndex<T>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
  path: string,
) {
  const index = new Map<string, T>();
  for (const entry of entries) {
    const key = keyOf(entry);
    requireNonEmptyString(key, `${path} id`);
    if (index.has(key)) benchmarkError(`${path} 存在重复 id “${key}”`);
    index.set(key, entry);
  }
  return index;
}

function validateHolding(
  holding: GtoHoldingStrategy,
  node: GtoStrategyNode,
  resultLabel: string,
) {
  const path = `${resultLabel}.nodes[${node.nodeId}].holdings[${holding.holding}]`;
  requireNonEmptyString(holding.holding, `${path}.holding`);
  requireFinite(holding.reachProbability, `${path}.reachProbability`, 0, 1);
  if (!Array.isArray(holding.frequencies) || holding.frequencies.length !== node.actions.length) {
    benchmarkError(`${path}.frequencies 必须与 actions 等长`);
  }
  let frequencyTotal = 0;
  holding.frequencies.forEach((frequency, index) => {
    requireFinite(frequency, `${path}.frequencies[${index}]`, 0, 1);
    frequencyTotal += frequency;
  });
  if (Math.abs(frequencyTotal - 1) > FREQUENCY_TOLERANCE) {
    benchmarkError(`${path}.frequencies 总和必须为 1，当前为 ${frequencyTotal}`);
  }
  if (holding.actionEvBb !== undefined) {
    if (!Array.isArray(holding.actionEvBb) || holding.actionEvBb.length !== node.actions.length) {
      benchmarkError(`${path}.actionEvBb 必须与 actions 等长`);
    }
    holding.actionEvBb.forEach((ev, index) => {
      requireFinite(ev, `${path}.actionEvBb[${index}]`);
    });
  }
}

function indexResult(result: GtoSolverResult, label: string): IndexedResult {
  if (result === null || typeof result !== "object") benchmarkError(`${label} 必须是求解结果对象`);
  requireNonEmptyString(result.resultId, `${label}.resultId`);
  requireNonEmptyString(result.gameSpecId, `${label}.gameSpecId`);
  requireNonEmptyString(result.treeId, `${label}.treeId`);
  if (result.solveKind !== "heads-up" && result.solveKind !== "three-way") {
    benchmarkError(`${label}.solveKind 无效`);
  }
  if (!Array.isArray(result.participants)) benchmarkError(`${label}.participants 必须是数组`);
  const expectedParticipants = result.solveKind === "heads-up" ? 2 : 3;
  if (result.participants.length !== expectedParticipants) {
    benchmarkError(`${label}.participants 必须有 ${expectedParticipants} 个位置`);
  }
  const uniqueParticipants = new Set(result.participants);
  if (uniqueParticipants.size !== result.participants.length) benchmarkError(`${label}.participants 不得重复`);
  result.participants.forEach((participant, index) => {
    requireNonEmptyString(participant, `${label}.participants[${index}]`);
  });

  if (!Array.isArray(result.nodes) || result.nodes.length === 0) benchmarkError(`${label}.nodes 不得为空`);
  const nodes = buildUniqueIndex<GtoStrategyNode>(
    result.nodes as readonly GtoStrategyNode[],
    (node) => node.nodeId,
    `${label}.nodes`,
  );
  const indexed = new Map<string, IndexedNode>();
  for (const [nodeId, node] of nodes) {
    requireNonEmptyString(node.nodeId, `${label}.nodes.nodeId`);
    requireFinite(node.potBb, `${label}.nodes[${nodeId}].potBb`, 0);
    requireFinite(node.effectiveStackBb, `${label}.nodes[${nodeId}].effectiveStackBb`, 0);
    if (!Array.isArray(node.actions) || node.actions.length < 2) {
      benchmarkError(`${label}.nodes[${nodeId}].actions 至少需要两个动作`);
    }
    const actions = buildUniqueIndex<{ action: GtoActionDefinition; actionIndex: number }>(
      (node.actions as readonly GtoActionDefinition[]).map((action, actionIndex) => ({ action, actionIndex })),
      ({ action }) => action.id,
      `${label}.nodes[${nodeId}].actions`,
    );
    for (const { action } of actions.values()) {
      requireNonEmptyString(action.label, `${label}.nodes[${nodeId}].actions[${action.id}].label`);
    }
    if (!Array.isArray(node.holdings) || node.holdings.length === 0) {
      benchmarkError(`${label}.nodes[${nodeId}].holdings 不得为空`);
    }
    const holdings = buildUniqueIndex<GtoHoldingStrategy>(
      node.holdings as readonly GtoHoldingStrategy[],
      (holding) => holding.holding,
      `${label}.nodes[${nodeId}].holdings`,
    );
    for (const holding of holdings.values()) validateHolding(holding, node, label);
    indexed.set(nodeId, {
      node,
      actions: new Map([...actions].map(([actionId, entry]) => [actionId, entry.actionIndex])),
      holdings,
    });
  }
  return { nodes: indexed };
}

function assertComparable(candidate: GtoSolverResult, reference: GtoSolverResult) {
  if (candidate.gameSpecId !== reference.gameSpecId) benchmarkError("gameSpecId 不一致，禁止比较不同游戏规范");
  if (candidate.treeId !== reference.treeId) benchmarkError("treeId 不一致，禁止比较不同下注树");
  if (candidate.solveKind !== reference.solveKind) benchmarkError("solveKind 不一致，禁止比较不同求解类型");
  if (
    candidate.participants.length !== reference.participants.length
    || candidate.participants.some((participant, index) => participant !== reference.participants[index])
  ) {
    benchmarkError("participants 不一致，位置及顺序必须完全相同");
  }
}

function assertSameNodeDefinition(candidate: IndexedNode, reference: IndexedNode) {
  const candidateNode = candidate.node;
  const referenceNode = reference.node;
  if (
    candidateNode.street !== referenceNode.street
    || candidateNode.actingPosition !== referenceNode.actingPosition
    || candidateNode.potBb !== referenceNode.potBb
    || candidateNode.effectiveStackBb !== referenceNode.effectiveStackBb
  ) {
    benchmarkError(`共享 nodeId “${referenceNode.nodeId}” 的公开局面定义不一致`);
  }
  const candidateActions = [...candidate.actions.keys()].sort();
  const referenceActions = [...reference.actions.keys()].sort();
  if (
    candidateActions.length !== referenceActions.length
    || candidateActions.some((actionId, index) => actionId !== referenceActions[index])
  ) {
    benchmarkError(`共享 nodeId “${referenceNode.nodeId}” 的 action id 集合不一致`);
  }
}

function frozenReport(report: GtoBenchmarkReport): GtoBenchmarkReport {
  Object.freeze(report.participants);
  Object.freeze(report.coverage);
  Object.freeze(report.maxSingleActionFrequencyError);
  return Object.freeze(report);
}

/**
 * Compares a candidate solution with a legally supplied reference solution.
 * This function performs no networking and never extracts commercial data.
 *
 * Missing candidate nodes/holdings reduce coverage. Once a node id is shared,
 * however, its public state and legal action-id set must match exactly. Metrics
 * are normalized over covered holdings using the reference reach probability.
 */
export function benchmarkGtoSolverResults(
  candidate: GtoSolverResult,
  reference: GtoSolverResult,
): GtoBenchmarkReport {
  const candidateIndex = indexResult(candidate, "candidate");
  const referenceIndex = indexResult(reference, "reference");
  assertComparable(candidate, reference);

  const sharedNodeIds = [...referenceIndex.nodes.keys()]
    .filter((nodeId) => candidateIndex.nodes.has(nodeId))
    .sort();
  if (sharedNodeIds.length === 0) benchmarkError("没有共享 nodeId，无法对标");

  let referenceReachWeight = 0;
  let coveredReferenceReachWeight = 0;
  let referenceHoldingCount = 0;
  let comparedHoldingCount = 0;
  let weightedTotalVariation = 0;
  let weightedEvRegret = 0;
  let hasComparablePositiveReach = false;
  let referenceEvIsComplete = true;
  let maxError: GtoBenchmarkMaxActionError | undefined;

  for (const referenceNode of referenceIndex.nodes.values()) {
    for (const referenceHolding of referenceNode.holdings.values()) {
      referenceReachWeight += referenceHolding.reachProbability;
      referenceHoldingCount += 1;
      if (referenceHolding.actionEvBb === undefined) referenceEvIsComplete = false;
    }
  }
  if (!(referenceReachWeight > 0)) benchmarkError("参考解的总 reachProbability 必须大于 0");

  for (const nodeId of sharedNodeIds) {
    const referenceNode = referenceIndex.nodes.get(nodeId);
    const candidateNode = candidateIndex.nodes.get(nodeId);
    if (!referenceNode || !candidateNode) continue;
    assertSameNodeDefinition(candidateNode, referenceNode);

    const sharedHoldings = [...referenceNode.holdings.keys()]
      .filter((holding) => candidateNode.holdings.has(holding))
      .sort();
    for (const holdingKey of sharedHoldings) {
      const referenceHolding = referenceNode.holdings.get(holdingKey);
      const candidateHolding = candidateNode.holdings.get(holdingKey);
      if (!referenceHolding || !candidateHolding) continue;
      const reach = referenceHolding.reachProbability;
      coveredReferenceReachWeight += reach;
      comparedHoldingCount += 1;
      if (!(reach > 0)) continue;
      hasComparablePositiveReach = true;

      let absoluteDifferenceTotal = 0;
      let candidateEv = 0;
      let referenceBestEv = -Infinity;
      for (const actionId of [...referenceNode.actions.keys()].sort()) {
        const referenceActionIndex = referenceNode.actions.get(actionId);
        const candidateActionIndex = candidateNode.actions.get(actionId);
        if (referenceActionIndex === undefined || candidateActionIndex === undefined) {
          benchmarkError(`node “${nodeId}” 无法对齐动作 “${actionId}”`);
        }
        const referenceFrequency = referenceHolding.frequencies[referenceActionIndex];
        const candidateFrequency = candidateHolding.frequencies[candidateActionIndex];
        const error = Math.abs(candidateFrequency - referenceFrequency);
        absoluteDifferenceTotal += error;
        if (!maxError || error > maxError.value) {
          maxError = {
            value: error,
            nodeId,
            holding: holdingKey,
            actionId,
            referenceFrequency,
            candidateFrequency,
          };
        }
        if (referenceHolding.actionEvBb !== undefined) {
          const actionEv = referenceHolding.actionEvBb[referenceActionIndex];
          referenceBestEv = Math.max(referenceBestEv, actionEv);
          candidateEv += candidateFrequency * actionEv;
        }
      }
      weightedTotalVariation += reach * absoluteDifferenceTotal * 0.5;
      if (referenceHolding.actionEvBb !== undefined) {
        weightedEvRegret += reach * Math.max(0, referenceBestEv - candidateEv);
      }
    }
  }

  if (!hasComparablePositiveReach || !maxError || !(coveredReferenceReachWeight > 0)) {
    benchmarkError("共享节点中没有 reference reach 大于 0 的同名 holding，无法计算指标");
  }

  return frozenReport({
    candidateResultId: candidate.resultId,
    referenceResultId: reference.resultId,
    gameSpecId: reference.gameSpecId,
    treeId: reference.treeId,
    solveKind: reference.solveKind,
    participants: [...reference.participants],
    sharedNodeCount: sharedNodeIds.length,
    coverage: {
      referenceReachWeight,
      coveredReferenceReachWeight,
      fraction: coveredReferenceReachWeight / referenceReachWeight,
      referenceHoldingCount,
      comparedHoldingCount,
    },
    meanTotalVariation: weightedTotalVariation / coveredReferenceReachWeight,
    maxSingleActionFrequencyError: maxError,
    weightedEvRegretBb: referenceEvIsComplete
      ? weightedEvRegret / coveredReferenceReachWeight
      : null,
  });
}
