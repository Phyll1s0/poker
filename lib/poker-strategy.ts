import { stableGtoHash, stableGtoJson } from "./gto-standard.ts";

export type StrategyAction = "fold" | "check" | "call" | "raise";
export type StrategyStreet = "preflop" | "flop" | "turn" | "river";

export type StrategyCard = {
  rank: number;
  suit: "spades" | "hearts" | "diamonds" | "clubs";
};

export type StrategySeat = {
  id: string;
  position: string;
  stackBb: number;
  streetBetBb: number;
  folded: boolean;
};

/** A serializable V1 public-information node. Kept intact for existing callers. */
export type StrategySpot = {
  schemaVersion: 1;
  format: "cash-6max-nlhe";
  street: StrategyStreet;
  heroId: string;
  heroCards: StrategyCard[];
  board: StrategyCard[];
  potBb: number;
  toCallBb: number;
  minimumRaiseToBb: number;
  seats: StrategySeat[];
  actionHistory: Array<{ playerId: string; action: StrategyAction; amountBb?: number }>;
};

export type MixedStrategy = {
  source: "local-approximation" | "precomputed-gto" | "remote-solver";
  nodeId?: string;
  actions: Array<{
    action: StrategyAction;
    frequency: number;
    raiseToBb?: number;
    evBb?: number;
  }>;
};

/** V1 provider boundary. New providers should implement PokerStrategyProviderV2 below. */
export interface PokerStrategyProvider {
  resolve(spot: StrategySpot, signal?: AbortSignal): Promise<MixedStrategy>;
}

export const STRATEGY_SCHEMA_VERSION_V2 = "rangecraft-strategy/v2" as const;

/**
 * All values which change the rules or utility of a solve. Starting-stack keys
 * are table positions (for example BTN and BB), never player nicknames.
 */
export type StrategyGameConfigV2 = Readonly<{
  variant: "no-limit-holdem";
  tableSize: number;
  blinds: Readonly<{
    smallBb: number;
    bigBb: number;
  }>;
  ante: Readonly<{
    kind: "none" | "per-player" | "big-blind";
    amountBb: number;
  }>;
  rake: Readonly<{
    percent: number;
    capBb: number;
    noFlopNoDrop: boolean;
  }>;
  utility: "chip-ev";
  startingStacksBb: Readonly<Record<string, number>>;
}>;

export type StrategySeatV2 = Readonly<{
  id: string;
  position: string;
  stackBb: number;
  streetCommittedBb: number;
  totalCommittedBb: number;
  folded: boolean;
  allIn: boolean;
}>;

/** amountToBb is the player's street total after the action. */
export type StrategyActionEventV2 = Readonly<{
  street: StrategyStreet;
  playerId: string;
  action: StrategyAction;
  amountToBb: number;
  incrementBb: number;
  potAfterBb: number;
}>;

export type StrategyLegalActionV2 =
  | Readonly<{ action: "fold" | "check" | "call" }>
  | Readonly<{ action: "raise"; raiseToBb: number; isAllIn: boolean }>;

/**
 * V2 is deliberately self-contained. An exact pack lookup is only safe when
 * the configuration, stacks, legal sizes, cards and complete action line all
 * participate in the key.
 */
export type StrategySpotV2 = Readonly<{
  schemaVersion: typeof STRATEGY_SCHEMA_VERSION_V2;
  gameSpecId: string;
  treeId: string;
  gameConfig: StrategyGameConfigV2;
  street: StrategyStreet;
  heroId: string;
  heroCards: readonly StrategyCard[];
  board: readonly StrategyCard[];
  potBb: number;
  toCallBb: number;
  minimumRaiseToBb: number | null;
  seats: readonly StrategySeatV2[];
  activePlayerIds: readonly string[];
  legalActions: readonly StrategyLegalActionV2[];
  actionHistory: readonly StrategyActionEventV2[];
}>;

export type StrategyActionFrequencyV2 =
  | Readonly<{
      action: "fold" | "check" | "call";
      frequency: number;
      evBb: number;
    }>
  | Readonly<{
      action: "raise";
      frequency: number;
      raiseToBb: number;
      evBb: number;
    }>;

export type StrategyErrorV2 = Readonly<{
  metric: "exploitability" | "nash-distance" | "expected-value-loss" | "unmeasured";
  value: number | null;
  unit: "pot-fraction" | "bb-per-hand" | "unmeasured";
}>;

export type StrategyLicenseV2 = Readonly<{
  name: string;
  spdxId?: string;
  url?: string;
  redistribution: "allowed" | "restricted" | "internal-only";
}>;

type StrategyProvenanceBaseV2 = Readonly<{
  packId: string;
  packVersion: string;
  nodeId: string;
  configId: string;
  solver: Readonly<{
    name: string;
    version: string;
  }>;
  error: StrategyErrorV2;
  license: StrategyLicenseV2;
}>;

/** A solved pack node hit. "exact" describes lookup identity, not zero solver error. */
export type SolvedStrategyProvenanceV2 = StrategyProvenanceBaseV2 & Readonly<{
  kind: "solved-pack-node";
}>;

/** An intentionally separate provenance branch for heuristic/model fallback. */
export type FallbackStrategyProvenanceV2 = StrategyProvenanceBaseV2 & Readonly<{
  kind: "fallback-model";
}>;

export type StrategyFallbackReasonV2 = Readonly<{
  code:
    | "node-not-found"
    | "config-mismatch"
    | "tree-mismatch"
    | "unsupported-player-count"
    | "unsupported-action-line"
    | "solver-unavailable"
    | "timeout"
    | "approximation-only";
  message: string;
}>;

type StrategyResolutionBaseV2 = Readonly<{
  schemaVersion: typeof STRATEGY_SCHEMA_VERSION_V2;
  nodeKey: string;
  gameSpecId: string;
  treeId: string;
  actions: readonly StrategyActionFrequencyV2[];
}>;

export type ExactStrategyResolutionV2 = StrategyResolutionBaseV2 & Readonly<{
  resolution: "exact";
  provenance: SolvedStrategyProvenanceV2;
}>;

export type FallbackStrategyResolutionV2 = StrategyResolutionBaseV2 & Readonly<{
  resolution: "fallback";
  provenance: FallbackStrategyProvenanceV2;
  fallbackReason: StrategyFallbackReasonV2;
}>;

export type StrategyResolutionV2 = ExactStrategyResolutionV2 | FallbackStrategyResolutionV2;

export type StrategyResolutionInputV2 =
  | Readonly<{
      resolution: "exact";
      provenance: SolvedStrategyProvenanceV2;
      actions: readonly StrategyActionFrequencyV2[];
    }>
  | Readonly<{
      resolution: "fallback";
      provenance: FallbackStrategyProvenanceV2;
      fallbackReason: StrategyFallbackReasonV2;
      actions: readonly StrategyActionFrequencyV2[];
    }>;

const STREET_INDEX: Readonly<Record<StrategyStreet, number>> = Object.freeze({
  preflop: 0,
  flop: 1,
  turn: 2,
  river: 3,
});

const ACTION_INDEX: Readonly<Record<StrategyAction, number>> = Object.freeze({
  fold: 0,
  check: 1,
  call: 2,
  raise: 3,
});

const SUITS = new Set<StrategyCard["suit"]>(["spades", "hearts", "diamonds", "clubs"]);

function assertPlainRecord(value: unknown, label: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} 必须是对象`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} 必须是普通对象`);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} 不能为空`);
}

function assertFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} 必须是有限数值`);
}

function assertNonNegative(value: unknown, label: string): asserts value is number {
  assertFinite(value, label);
  if (value < 0) throw new RangeError(`${label} 不能为负数`);
}

function assertCard(card: StrategyCard, label: string) {
  assertPlainRecord(card, label);
  if (!Number.isInteger(card.rank) || card.rank < 2 || card.rank > 14) {
    throw new RangeError(`${label}.rank 必须在 2 到 14 之间`);
  }
  if (!SUITS.has(card.suit)) throw new TypeError(`${label}.suit 无效`);
}

function cardId(card: StrategyCard) {
  return `${card.rank}:${card.suit}`;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

/** Runtime validation for data received from storage, workers or a remote solver. */
export function assertStrategyGameConfigV2(config: StrategyGameConfigV2): void {
  assertPlainRecord(config, "gameConfig");
  if (config.variant !== "no-limit-holdem") throw new TypeError("gameConfig.variant 仅支持 no-limit-holdem");
  if (!Number.isInteger(config.tableSize) || config.tableSize < 2 || config.tableSize > 10) {
    throw new RangeError("gameConfig.tableSize 必须是 2 到 10 的整数");
  }
  assertPlainRecord(config.blinds, "gameConfig.blinds");
  assertNonNegative(config.blinds.smallBb, "gameConfig.blinds.smallBb");
  assertNonNegative(config.blinds.bigBb, "gameConfig.blinds.bigBb");
  if (config.blinds.bigBb <= 0 || config.blinds.smallBb >= config.blinds.bigBb) {
    throw new RangeError("盲注必须满足 0 <= smallBb < bigBb");
  }
  assertPlainRecord(config.ante, "gameConfig.ante");
  if (!new Set(["none", "per-player", "big-blind"]).has(config.ante.kind)) {
    throw new TypeError("gameConfig.ante.kind 无效");
  }
  assertNonNegative(config.ante.amountBb, "gameConfig.ante.amountBb");
  if (config.ante.kind === "none" && config.ante.amountBb !== 0) {
    throw new RangeError("无 ante 时 amountBb 必须为 0");
  }
  assertPlainRecord(config.rake, "gameConfig.rake");
  assertNonNegative(config.rake.percent, "gameConfig.rake.percent");
  if (config.rake.percent > 1) throw new RangeError("gameConfig.rake.percent 必须在 0 到 1 之间");
  assertNonNegative(config.rake.capBb, "gameConfig.rake.capBb");
  if (typeof config.rake.noFlopNoDrop !== "boolean") throw new TypeError("gameConfig.rake.noFlopNoDrop 必须是布尔值");
  if (config.utility !== "chip-ev") throw new TypeError("V2 仅接受定义完整的 chip-ev utility");
  assertPlainRecord(config.startingStacksBb, "gameConfig.startingStacksBb");
  const stackEntries = Object.entries(config.startingStacksBb);
  if (stackEntries.length !== config.tableSize) throw new RangeError("起始筹码数量必须与 tableSize 一致");
  for (const [position, stack] of stackEntries) {
    assertNonEmptyString(position, "起始筹码位置");
    assertNonNegative(stack, `startingStacksBb.${position}`);
    if (stack <= 0) throw new RangeError(`startingStacksBb.${position} 必须大于 0`);
  }
}

/** Runtime validation of a V2 decision node before it can be keyed or resolved. */
export function assertStrategySpotV2(spot: StrategySpotV2): void {
  assertPlainRecord(spot, "spot");
  if (spot.schemaVersion !== STRATEGY_SCHEMA_VERSION_V2) throw new TypeError("策略节点 schemaVersion 不受支持");
  assertNonEmptyString(spot.gameSpecId, "gameSpecId");
  assertNonEmptyString(spot.treeId, "treeId");
  assertStrategyGameConfigV2(spot.gameConfig);
  if (!(spot.street in STREET_INDEX)) throw new TypeError("street 无效");
  assertNonEmptyString(spot.heroId, "heroId");
  if (!Array.isArray(spot.heroCards) || spot.heroCards.length !== 2) throw new RangeError("heroCards 必须恰好有两张牌");
  if (!Array.isArray(spot.board)) throw new TypeError("board 必须是数组");
  const expectedBoardLength = { preflop: 0, flop: 3, turn: 4, river: 5 }[spot.street];
  if (spot.board.length !== expectedBoardLength) throw new RangeError(`${spot.street} 的公共牌数量必须为 ${expectedBoardLength}`);
  const seenCards = new Set<string>();
  [...spot.heroCards, ...spot.board].forEach((card, index) => {
    assertCard(card, `cards[${index}]`);
    const id = cardId(card);
    if (seenCards.has(id)) throw new RangeError("heroCards 与 board 不能包含重复牌");
    seenCards.add(id);
  });
  assertNonNegative(spot.potBb, "potBb");
  assertNonNegative(spot.toCallBb, "toCallBb");
  if (spot.minimumRaiseToBb !== null) assertNonNegative(spot.minimumRaiseToBb, "minimumRaiseToBb");
  if (!Array.isArray(spot.seats) || spot.seats.length !== spot.gameConfig.tableSize) {
    throw new RangeError("seats 数量必须与 tableSize 一致");
  }

  const seatIds = new Set<string>();
  const positions = new Set<string>();
  const seatById = new Map<string, StrategySeatV2>();
  for (const [index, seat] of spot.seats.entries()) {
    assertPlainRecord(seat, `seats[${index}]`);
    assertNonEmptyString(seat.id, `seats[${index}].id`);
    assertNonEmptyString(seat.position, `seats[${index}].position`);
    if (seatIds.has(seat.id)) throw new RangeError(`重复玩家 id: ${seat.id}`);
    if (positions.has(seat.position)) throw new RangeError(`重复位置: ${seat.position}`);
    if (!(seat.position in spot.gameConfig.startingStacksBb)) throw new RangeError(`位置 ${seat.position} 缺少起始筹码`);
    seatIds.add(seat.id);
    positions.add(seat.position);
    seatById.set(seat.id, seat);
    assertNonNegative(seat.stackBb, `seats[${index}].stackBb`);
    assertNonNegative(seat.streetCommittedBb, `seats[${index}].streetCommittedBb`);
    assertNonNegative(seat.totalCommittedBb, `seats[${index}].totalCommittedBb`);
    if (typeof seat.folded !== "boolean" || typeof seat.allIn !== "boolean") throw new TypeError("seat folded/allIn 必须是布尔值");
    if (seat.folded && seat.allIn) throw new RangeError("玩家不能同时 folded 与 allIn");
  }
  for (const position of Object.keys(spot.gameConfig.startingStacksBb)) {
    if (!positions.has(position)) throw new RangeError(`起始筹码位置 ${position} 未出现在 seats`);
  }

  if (!seatById.has(spot.heroId)) throw new RangeError("heroId 不在 seats 中");
  if (!Array.isArray(spot.activePlayerIds) || spot.activePlayerIds.length < 2) throw new RangeError("至少需要两名 active players");
  const activeIds = new Set<string>();
  for (const id of spot.activePlayerIds) {
    assertNonEmptyString(id, "activePlayerId");
    if (activeIds.has(id)) throw new RangeError(`重复 activePlayerId: ${id}`);
    const seat = seatById.get(id);
    if (!seat || seat.folded) throw new RangeError(`activePlayerId ${id} 不存在或已弃牌`);
    activeIds.add(id);
  }
  if (!activeIds.has(spot.heroId)) throw new RangeError("hero 必须是 active player");

  if (!Array.isArray(spot.legalActions) || spot.legalActions.length === 0) throw new RangeError("legalActions 不能为空");
  const legalSignatures = new Set<string>();
  let hasRaise = false;
  for (const [index, legalAction] of spot.legalActions.entries()) {
    assertPlainRecord(legalAction, `legalActions[${index}]`);
    if (!(legalAction.action in ACTION_INDEX)) throw new TypeError(`legalActions[${index}].action 无效`);
    let signature: string = legalAction.action;
    if (legalAction.action === "raise") {
      hasRaise = true;
      assertNonNegative(legalAction.raiseToBb, `legalActions[${index}].raiseToBb`);
      if (typeof legalAction.isAllIn !== "boolean") throw new TypeError("raise.isAllIn 必须是布尔值");
      if (!legalAction.isAllIn && spot.minimumRaiseToBb !== null && legalAction.raiseToBb < spot.minimumRaiseToBb) {
        throw new RangeError("非全下 raiseToBb 不能小于 minimumRaiseToBb");
      }
      signature = `raise:${legalAction.raiseToBb}`;
    } else if ("raiseToBb" in legalAction) {
      throw new TypeError("只有 raise 动作可以包含 raiseToBb");
    }
    if (legalSignatures.has(signature)) throw new RangeError(`重复合法动作: ${signature}`);
    legalSignatures.add(signature);
  }
  if (hasRaise !== (spot.minimumRaiseToBb !== null)) {
    throw new RangeError("minimumRaiseToBb 与合法 raise 动作不一致");
  }

  if (!Array.isArray(spot.actionHistory)) throw new TypeError("actionHistory 必须是数组");
  let previousStreet = -1;
  let previousPot = 0;
  for (const [index, event] of spot.actionHistory.entries()) {
    assertPlainRecord(event, `actionHistory[${index}]`);
    if (!(event.street in STREET_INDEX)) throw new TypeError(`actionHistory[${index}].street 无效`);
    const streetIndex = STREET_INDEX[event.street as StrategyStreet];
    if (streetIndex < previousStreet || streetIndex > STREET_INDEX[spot.street]) throw new RangeError("actionHistory 的街次顺序无效");
    previousStreet = streetIndex;
    assertNonEmptyString(event.playerId, `actionHistory[${index}].playerId`);
    if (!seatById.has(event.playerId)) throw new RangeError(`行动玩家 ${event.playerId} 不在 seats 中`);
    if (!(event.action in ACTION_INDEX)) throw new TypeError(`actionHistory[${index}].action 无效`);
    assertNonNegative(event.amountToBb, `actionHistory[${index}].amountToBb`);
    assertNonNegative(event.incrementBb, `actionHistory[${index}].incrementBb`);
    assertNonNegative(event.potAfterBb, `actionHistory[${index}].potAfterBb`);
    if (index > 0 && event.potAfterBb < previousPot) throw new RangeError("actionHistory.potAfterBb 不能倒退");
    previousPot = event.potAfterBb;
  }
}

function normalizedConfig(config: StrategyGameConfigV2) {
  assertStrategyGameConfigV2(config);
  return {
    variant: config.variant,
    tableSize: config.tableSize,
    blinds: { smallBb: config.blinds.smallBb, bigBb: config.blinds.bigBb },
    ante: { kind: config.ante.kind, amountBb: config.ante.amountBb },
    rake: {
      percent: config.rake.percent,
      capBb: config.rake.capBb,
      noFlopNoDrop: config.rake.noFlopNoDrop,
    },
    utility: config.utility,
    startingStacksBb: Object.fromEntries(Object.entries(config.startingStacksBb).sort(([left], [right]) => left.localeCompare(right))),
  };
}

/** Stable canonical JSON for the complete V2 game configuration. */
export function canonicalStrategyConfigV2(config: StrategyGameConfigV2) {
  return stableGtoJson(normalizedConfig(config));
}

/** A compact SHA-256 identity. Any rule, rake or starting-stack drift changes it. */
export function strategyConfigKeyV2(config: StrategyGameConfigV2) {
  return `rc-strategy-config-v2-${stableGtoHash(normalizedConfig(config))}`;
}

function actionSignature(action: StrategyLegalActionV2 | StrategyActionFrequencyV2) {
  return action.action === "raise" ? `raise:${action.raiseToBb}` : action.action;
}

function nodeFingerprint(spot: StrategySpotV2) {
  assertStrategySpotV2(spot);
  const positionById = new Map(spot.seats.map((seat) => [seat.id, seat.position]));
  const seats = spot.seats
    .map((seat) => ({
      position: seat.position,
      stackBb: seat.stackBb,
      streetCommittedBb: seat.streetCommittedBb,
      totalCommittedBb: seat.totalCommittedBb,
      folded: seat.folded,
      allIn: seat.allIn,
    }))
    .sort((left, right) => left.position.localeCompare(right.position));
  const activePositions = spot.activePlayerIds.map((id) => positionById.get(id) as string).sort();
  const legalActions = spot.legalActions
    .map((action) => action.action === "raise"
      ? { action: action.action, raiseToBb: action.raiseToBb, isAllIn: action.isAllIn }
      : { action: action.action })
    .sort((left, right) => {
      const actionDifference = ACTION_INDEX[left.action] - ACTION_INDEX[right.action];
      if (actionDifference !== 0) return actionDifference;
      const leftSize = "raiseToBb" in left && typeof left.raiseToBb === "number" ? left.raiseToBb : 0;
      const rightSize = "raiseToBb" in right && typeof right.raiseToBb === "number" ? right.raiseToBb : 0;
      return leftSize - rightSize;
    });
  const actionHistory = spot.actionHistory.map((event) => ({
    street: event.street,
    playerPosition: positionById.get(event.playerId),
    action: event.action,
    amountToBb: event.amountToBb,
    incrementBb: event.incrementBb,
    potAfterBb: event.potAfterBb,
  }));
  return {
    schemaVersion: spot.schemaVersion,
    gameSpecId: spot.gameSpecId,
    treeId: spot.treeId,
    configId: strategyConfigKeyV2(spot.gameConfig),
    street: spot.street,
    heroPosition: positionById.get(spot.heroId),
    heroCards: spot.heroCards
      .map((card) => ({ rank: card.rank, suit: card.suit }))
      .sort((left, right) => cardId(left).localeCompare(cardId(right))),
    board: spot.board.map((card) => ({ rank: card.rank, suit: card.suit })),
    potBb: spot.potBb,
    toCallBb: spot.toCallBb,
    minimumRaiseToBb: spot.minimumRaiseToBb,
    seats,
    activePositions,
    legalActions,
    actionHistory,
  };
}

/** Stable canonical JSON for an exact decision node. The action line order is preserved. */
export function canonicalStrategyNodeV2(spot: StrategySpotV2) {
  return stableGtoJson(nodeFingerprint(spot));
}

/**
 * Safe lookup key for solution packs. Player nicknames are mapped to positions,
 * while stack/rake/sizing/action-line changes necessarily produce a new key.
 */
export function strategyNodeKeyV2(spot: StrategySpotV2) {
  return `rc-strategy-node-v2-${stableGtoHash(nodeFingerprint(spot))}`;
}

function assertProvenance(provenance: SolvedStrategyProvenanceV2 | FallbackStrategyProvenanceV2, configId: string) {
  assertPlainRecord(provenance, "provenance");
  assertNonEmptyString(provenance.packId, "provenance.packId");
  assertNonEmptyString(provenance.packVersion, "provenance.packVersion");
  assertNonEmptyString(provenance.nodeId, "provenance.nodeId");
  assertNonEmptyString(provenance.configId, "provenance.configId");
  if (provenance.configId !== configId) throw new RangeError("provenance.configId 与当前 gameConfig 不匹配");
  assertPlainRecord(provenance.solver, "provenance.solver");
  assertNonEmptyString(provenance.solver.name, "provenance.solver.name");
  assertNonEmptyString(provenance.solver.version, "provenance.solver.version");
  assertPlainRecord(provenance.error, "provenance.error");
  if (!new Set(["exploitability", "nash-distance", "expected-value-loss", "unmeasured"]).has(provenance.error.metric)) {
    throw new TypeError("provenance.error.metric 无效");
  }
  if (provenance.error.metric === "unmeasured") {
    if (provenance.error.value !== null || provenance.error.unit !== "unmeasured") {
      throw new RangeError("未测量误差必须使用 null / unmeasured");
    }
  } else {
    assertNonNegative(provenance.error.value, "provenance.error.value");
    if (provenance.error.unit !== "pot-fraction" && provenance.error.unit !== "bb-per-hand") {
      throw new TypeError("已测量误差必须声明 pot-fraction 或 bb-per-hand");
    }
  }
  assertPlainRecord(provenance.license, "provenance.license");
  assertNonEmptyString(provenance.license.name, "provenance.license.name");
  if (provenance.license.spdxId !== undefined) assertNonEmptyString(provenance.license.spdxId, "provenance.license.spdxId");
  if (provenance.license.url !== undefined) assertNonEmptyString(provenance.license.url, "provenance.license.url");
  if (!new Set(["allowed", "restricted", "internal-only"]).has(provenance.license.redistribution)) {
    throw new TypeError("provenance.license.redistribution 无效");
  }
}

/** Normalizes positive action weights into immutable frequencies summing to one. */
export function normalizeStrategyActionsV2(actions: readonly StrategyActionFrequencyV2[]) {
  if (!Array.isArray(actions) || actions.length === 0) throw new RangeError("策略 actions 不能为空");
  const signatures = new Set<string>();
  let total = 0;
  const copied = actions.map((action, index) => {
    assertPlainRecord(action, `actions[${index}]`);
    if (!(action.action in ACTION_INDEX)) throw new TypeError(`actions[${index}].action 无效`);
    assertNonNegative(action.frequency, `actions[${index}].frequency`);
    assertFinite(action.evBb, `actions[${index}].evBb`);
    if (action.action === "raise") {
      assertNonNegative(action.raiseToBb, `actions[${index}].raiseToBb`);
    } else if ("raiseToBb" in action) {
      throw new TypeError("只有 raise 策略动作可以包含 raiseToBb");
    }
    const signature = actionSignature(action);
    if (signatures.has(signature)) throw new RangeError(`重复策略动作: ${signature}`);
    signatures.add(signature);
    total += action.frequency;
    return action.action === "raise"
      ? { action: action.action, frequency: action.frequency, raiseToBb: action.raiseToBb, evBb: action.evBb }
      : { action: action.action, frequency: action.frequency, evBb: action.evBb };
  });
  if (!(total > 0) || !Number.isFinite(total)) throw new RangeError("策略频率总和必须大于 0");
  return deepFreeze(copied.map((action) => ({ ...action, frequency: action.frequency / total }))) as readonly StrategyActionFrequencyV2[];
}

function assertActionsMatchSpot(spot: StrategySpotV2, actions: readonly StrategyActionFrequencyV2[]) {
  const expected = [...spot.legalActions].map(actionSignature).sort();
  const actual = [...actions].map(actionSignature).sort();
  if (stableGtoJson(expected) !== stableGtoJson(actual)) throw new RangeError("策略 actions 必须与节点 legalActions 完全一致");
}

/**
 * Creates an immutable, normalized response bound to this exact node. Runtime
 * checks make it impossible to label fallback output as an exact solved hit.
 */
export function createStrategyResolutionV2(spot: StrategySpotV2, input: StrategyResolutionInputV2): StrategyResolutionV2 {
  assertStrategySpotV2(spot);
  assertPlainRecord(input, "resolution input");
  if (input.resolution !== "exact" && input.resolution !== "fallback") throw new TypeError("resolution 必须是 exact 或 fallback");
  const configId = strategyConfigKeyV2(spot.gameConfig);
  const nodeKey = strategyNodeKeyV2(spot);
  assertProvenance(input.provenance, configId);
  const actions = normalizeStrategyActionsV2(input.actions);
  assertActionsMatchSpot(spot, actions);
  const base = {
    schemaVersion: STRATEGY_SCHEMA_VERSION_V2,
    nodeKey,
    gameSpecId: spot.gameSpecId,
    treeId: spot.treeId,
    actions,
  } as const;

  if (input.resolution === "exact") {
    if (input.provenance.kind !== "solved-pack-node") throw new TypeError("exact resolution 必须使用 solved-pack-node provenance");
    if (input.provenance.error.metric === "unmeasured") throw new TypeError("exact solved node 必须声明已测量误差");
    if ("fallbackReason" in input) throw new TypeError("exact resolution 不能包含 fallbackReason");
    return deepFreeze({ ...base, resolution: "exact", provenance: { ...input.provenance } });
  }

  if (input.provenance.kind !== "fallback-model") throw new TypeError("fallback resolution 必须使用 fallback-model provenance");
  assertPlainRecord(input.fallbackReason, "fallbackReason");
  if (!new Set([
    "node-not-found",
    "config-mismatch",
    "tree-mismatch",
    "unsupported-player-count",
    "unsupported-action-line",
    "solver-unavailable",
    "timeout",
    "approximation-only",
  ]).has(input.fallbackReason.code)) throw new TypeError("fallbackReason.code 无效");
  assertNonEmptyString(input.fallbackReason.message, "fallbackReason.message");
  return deepFreeze({
    ...base,
    resolution: "fallback",
    provenance: { ...input.provenance },
    fallbackReason: { ...input.fallbackReason },
  });
}

/**
 * V2 provider boundary: peek is synchronous and cache-only; resolve may load a
 * pack, worker or remote solver. Both return the same provenance-safe union.
 */
export interface PokerStrategyProviderV2 {
  peek(spot: StrategySpotV2): StrategyResolutionV2 | null;
  resolve(spot: StrategySpotV2, signal?: AbortSignal): Promise<StrategyResolutionV2>;
}
