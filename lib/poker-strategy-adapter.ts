import {
  GTO_STANDARD_POSITIONS,
  RANGECRAFT_STANDARD_V1,
  type GtoStandardPosition,
} from "./gto-standard.ts";
import {
  STRATEGY_SCHEMA_VERSION_V2,
  assertStrategySpotV2,
  type StrategyAction,
  type StrategyActionEventV2,
  type StrategyCard,
  type StrategyGameConfigV2,
  type StrategyLegalActionV2,
  type StrategySeatV2,
  type StrategySpotV2,
  type StrategyStreet,
} from "./poker-strategy.ts";

export type StrategyAdapterId = string | number;
export type StrategyAdapterSuit = StrategyCard["suit"] | "♠" | "♥" | "♦" | "♣";

export type StrategyAdapterCardInput = Readonly<{
  rank: number;
  suit: StrategyAdapterSuit;
}>;

/**
 * Monetary fields use the caller's table unit (normally chips). They are
 * converted to big blinds at the adapter boundary.
 */
export type StrategyAdapterSeatInput = Readonly<{
  id: StrategyAdapterId;
  position?: GtoStandardPosition;
  startingStack: number;
  stack: number;
  streetCommitted: number;
  totalCommitted: number;
  folded: boolean;
  allIn?: boolean;
}>;

/**
 * A complete public action. increment is the amount paid by the acting player;
 * amountTo, potBefore and potAfter are optional consistency assertions.
 */
export type StrategyAdapterActionEventInput = Readonly<{
  street: StrategyStreet;
  playerId: StrategyAdapterId;
  action: StrategyAction;
  increment: number;
  amountTo?: number;
  potBefore?: number;
  potAfter?: number;
}>;

export type StrategyAdapterLegalActionInput =
  | Readonly<{ action: "fold" | "check" | "call" }>
  | Readonly<{ action: "raise"; raiseTo: number; isAllIn?: boolean }>;

export type RangeCraftStandardSpotInput = Readonly<{
  /** The array is clockwise table order when positions are not supplied. */
  seats: readonly StrategyAdapterSeatInput[];
  /** Required only when seat.position is omitted. The dealer is BTN. */
  dealerId?: StrategyAdapterId;
  heroId: StrategyAdapterId;
  heroCards: readonly StrategyAdapterCardInput[];
  board: readonly StrategyAdapterCardInput[];
  street: StrategyStreet;
  bigBlind: number;
  smallBlind?: number;
  ante?: number;
  rake?: Readonly<{ percent: number; cap: number }>;
  pot: number;
  toCall: number;
  minimumRaiseTo: number | null;
  /** The complete action set of the configured tree, including every raise-to. */
  legalActions: readonly StrategyAdapterLegalActionInput[];
  /** Complete chronological public history; blind posts are implicit. */
  actionHistory: readonly StrategyAdapterActionEventInput[];
}>;

const POSITION_INDEX = new Map<GtoStandardPosition, number>(
  GTO_STANDARD_POSITIONS.map((position, index) => [position, index]),
);

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

const SUIT_NAMES: Readonly<Record<StrategyAdapterSuit, StrategyCard["suit"]>> = Object.freeze({
  spades: "spades",
  hearts: "hearts",
  diamonds: "diamonds",
  clubs: "clubs",
  "♠": "spades",
  "♥": "hearts",
  "♦": "diamonds",
  "♣": "clubs",
});

const BB_PRECISION = 1_000_000_000;

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function adapterError(path: string, message: string): never {
  throw new TypeError(`${path}：${message}`);
}

function finiteNonNegative(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    adapterError(path, "必须是非负有限数值");
  }
  return value;
}

function normalizedId(value: StrategyAdapterId, path: string): string {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") {
    adapterError(path, "必须是非空字符串或有限数字");
  }
  if (typeof value === "number" && !Number.isFinite(value)) adapterError(path, "数字 id 必须有限");
  return String(value);
}

function roundedBb(value: number, bigBlind: number, path: string): number {
  finiteNonNegative(value, path);
  return Math.round((value / bigBlind) * BB_PRECISION) / BB_PRECISION;
}

function sameAmount(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1 / BB_PRECISION;
}

function normalizedCard(card: StrategyAdapterCardInput, path: string): StrategyCard {
  if (!card || typeof card !== "object" || Array.isArray(card)) adapterError(path, "必须是牌对象");
  if (!Number.isInteger(card.rank) || card.rank < 2 || card.rank > 14) {
    adapterError(`${path}.rank`, "必须是 2 到 14 的整数");
  }
  const suit = SUIT_NAMES[card.suit];
  if (!suit) adapterError(`${path}.suit`, "花色无效");
  return { rank: card.rank, suit };
}

const STARTING_STACKS_BB = Object.freeze(Object.fromEntries(
  GTO_STANDARD_POSITIONS.map((position) => [position, RANGECRAFT_STANDARD_V1.startingStackBb]),
)) as Readonly<Record<GtoStandardPosition, number>>;

/** The StrategySpotV2 representation of RangeCraft Standard v1's exact game configuration. */
export const RANGECRAFT_STANDARD_STRATEGY_CONFIG_V2: StrategyGameConfigV2 = deepFreeze({
  variant: "no-limit-holdem",
  tableSize: RANGECRAFT_STANDARD_V1.tableSize,
  blinds: {
    smallBb: RANGECRAFT_STANDARD_V1.blindsBb.small,
    bigBb: RANGECRAFT_STANDARD_V1.blindsBb.big,
  },
  ante: { kind: "none", amountBb: 0 },
  rake: { percent: 0, capBb: 0, noFlopNoDrop: true },
  utility: "chip-ev",
  startingStacksBb: STARTING_STACKS_BB,
});

/**
 * Derives Standard v1 positions from clockwise seat order. This is isolated
 * here so callers do not need to expose page-private player types.
 */
export function rangeCraftStandardPositionMap(
  seatIds: readonly StrategyAdapterId[],
  dealerId: StrategyAdapterId,
): Readonly<Record<string, GtoStandardPosition>> {
  if (!Array.isArray(seatIds) || seatIds.length !== RANGECRAFT_STANDARD_V1.tableSize) {
    adapterError("seatIds", `必须恰好包含 ${RANGECRAFT_STANDARD_V1.tableSize} 个座位`);
  }
  const normalizedIds = seatIds.map((id, index) => normalizedId(id, `seatIds[${index}]`));
  if (new Set(normalizedIds).size !== normalizedIds.length) adapterError("seatIds", "不能包含重复 id");
  const dealer = normalizedId(dealerId, "dealerId");
  const dealerIndex = normalizedIds.indexOf(dealer);
  if (dealerIndex < 0) adapterError("dealerId", "不在 seatIds 中");

  const positionsByOffset: readonly GtoStandardPosition[] = ["BTN", "SB", "BB", "UTG", "HJ", "CO"];
  const entries = positionsByOffset.map((position, offset) => [
    normalizedIds[(dealerIndex + offset) % normalizedIds.length],
    position,
  ] as const);
  return deepFreeze(Object.fromEntries(entries));
}

type NormalizedSeatInput = Readonly<{
  id: string;
  position: GtoStandardPosition;
  startingStackBb: number;
  stackBb: number;
  streetCommittedBb: number;
  totalCommittedBb: number;
  folded: boolean;
  allIn: boolean;
}>;

function normalizeSeats(
  input: RangeCraftStandardSpotInput,
  bigBlind: number,
): readonly NormalizedSeatInput[] {
  if (!Array.isArray(input.seats) || input.seats.length !== RANGECRAFT_STANDARD_V1.tableSize) {
    adapterError("seats", `RangeCraft Standard v1 必须有 ${RANGECRAFT_STANDARD_V1.tableSize} 个座位`);
  }
  const ids = input.seats.map((seat, index) => normalizedId(seat.id, `seats[${index}].id`));
  if (new Set(ids).size !== ids.length) adapterError("seats", "玩家 id 归一化后不能重复");

  const suppliedPositionCount = input.seats.filter((seat) => seat.position !== undefined).length;
  if (suppliedPositionCount !== 0 && suppliedPositionCount !== input.seats.length) {
    adapterError("seats", "position 必须全部提供或全部省略");
  }
  const derivedPositions = suppliedPositionCount === 0
    ? input.dealerId === undefined
      ? adapterError("dealerId", "省略 seat.position 时必须提供 dealerId")
      : rangeCraftStandardPositionMap(ids, input.dealerId)
    : null;

  const seenPositions = new Set<GtoStandardPosition>();
  const normalized = input.seats.map((seat, index): NormalizedSeatInput => {
    const position = seat.position ?? derivedPositions?.[ids[index]];
    if (!position || !POSITION_INDEX.has(position)) adapterError(`seats[${index}].position`, "不是 Standard v1 位置");
    if (seenPositions.has(position)) adapterError("seats", `位置 ${position} 重复`);
    seenPositions.add(position);

    const startingStackBb = roundedBb(seat.startingStack, bigBlind, `seats[${index}].startingStack`);
    const stackBb = roundedBb(seat.stack, bigBlind, `seats[${index}].stack`);
    const streetCommittedBb = roundedBb(seat.streetCommitted, bigBlind, `seats[${index}].streetCommitted`);
    const totalCommittedBb = roundedBb(seat.totalCommitted, bigBlind, `seats[${index}].totalCommitted`);
    if (!sameAmount(startingStackBb, RANGECRAFT_STANDARD_V1.startingStackBb)) {
      adapterError(`seats[${index}].startingStack`, "不是 RangeCraft Standard v1 的 100BB 起始筹码");
    }
    if (!sameAmount(startingStackBb, stackBb + totalCommittedBb)) {
      adapterError(`seats[${index}]`, "startingStack 必须等于 stack + totalCommitted");
    }
    if (typeof seat.folded !== "boolean") adapterError(`seats[${index}].folded`, "必须是布尔值");
    const expectedAllIn = !seat.folded && sameAmount(stackBb, 0);
    if (seat.allIn !== undefined && seat.allIn !== expectedAllIn) {
      adapterError(`seats[${index}].allIn`, "必须与 stack/folded 状态一致");
    }
    return {
      id: ids[index],
      position,
      startingStackBb,
      stackBb,
      streetCommittedBb,
      totalCommittedBb,
      folded: seat.folded,
      allIn: expectedAllIn,
    };
  });

  for (const position of GTO_STANDARD_POSITIONS) {
    if (!seenPositions.has(position)) adapterError("seats", `缺少位置 ${position}`);
  }
  if (input.dealerId !== undefined) {
    const dealer = normalizedId(input.dealerId, "dealerId");
    if (normalized.find((seat) => seat.id === dealer)?.position !== "BTN") {
      adapterError("dealerId", "必须对应 BTN 位置");
    }
  }
  return normalized.sort((left, right) => (
    (POSITION_INDEX.get(left.position) ?? 0) - (POSITION_INDEX.get(right.position) ?? 0)
  ));
}

type ReplayState = {
  streetCommittedBb: number;
  totalCommittedBb: number;
  folded: boolean;
  startingStackBb: number;
};

function normalizedHistory(
  input: RangeCraftStandardSpotInput,
  seats: readonly NormalizedSeatInput[],
  bigBlind: number,
): readonly StrategyActionEventV2[] {
  if (!Array.isArray(input.actionHistory)) adapterError("actionHistory", "必须是数组");
  const replay = new Map<string, ReplayState>(seats.map((seat) => [seat.id, {
    streetCommittedBb: seat.position === "SB" ? 0.5 : seat.position === "BB" ? 1 : 0,
    totalCommittedBb: seat.position === "SB" ? 0.5 : seat.position === "BB" ? 1 : 0,
    folded: false,
    startingStackBb: seat.startingStackBb,
  }]));
  let street: StrategyStreet = "preflop";
  let runningPotBb = 1.5;
  let highestStreetCommitmentBb = 1;
  const events: StrategyActionEventV2[] = [];

  for (const [index, event] of input.actionHistory.entries()) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      adapterError(`actionHistory[${index}]`, "必须是行动对象");
    }
    if (!(event.street in STREET_INDEX)) adapterError(`actionHistory[${index}].street`, "街次无效");
    const eventStreet = event.street as StrategyStreet;
    const eventStreetIndex = STREET_INDEX[eventStreet];
    const currentStreetIndex = STREET_INDEX[street];
    if (eventStreetIndex < currentStreetIndex || eventStreetIndex > STREET_INDEX[input.street]) {
      adapterError(`actionHistory[${index}].street`, "街次顺序无效");
    }
    if (eventStreetIndex > currentStreetIndex) {
      street = eventStreet;
      highestStreetCommitmentBb = 0;
      for (const state of replay.values()) state.streetCommittedBb = 0;
    }
    if (!(event.action in ACTION_INDEX)) adapterError(`actionHistory[${index}].action`, "动作无效");

    const playerId = normalizedId(event.playerId, `actionHistory[${index}].playerId`);
    const player = replay.get(playerId);
    if (!player) adapterError(`actionHistory[${index}].playerId`, "不在 seats 中");
    if (player.folded) adapterError(`actionHistory[${index}]`, "已弃牌玩家不能再次行动");

    const incrementBb = roundedBb(event.increment, bigBlind, `actionHistory[${index}].increment`);
    const amountToBb = Math.round((player.streetCommittedBb + incrementBb) * BB_PRECISION) / BB_PRECISION;
    if (event.amountTo !== undefined && !sameAmount(
      roundedBb(event.amountTo, bigBlind, `actionHistory[${index}].amountTo`),
      amountToBb,
    )) {
      adapterError(`actionHistory[${index}].amountTo`, "与此前投入和 increment 不一致");
    }
    if (event.potBefore !== undefined && !sameAmount(
      roundedBb(event.potBefore, bigBlind, `actionHistory[${index}].potBefore`),
      runningPotBb,
    )) {
      adapterError(`actionHistory[${index}].potBefore`, "与完整历史推导的底池不一致");
    }
    const potAfterBb = Math.round((runningPotBb + incrementBb) * BB_PRECISION) / BB_PRECISION;
    if (event.potAfter !== undefined && !sameAmount(
      roundedBb(event.potAfter, bigBlind, `actionHistory[${index}].potAfter`),
      potAfterBb,
    )) {
      adapterError(`actionHistory[${index}].potAfter`, "必须等于 potBefore + increment");
    }

    const remainingStackBb = player.startingStackBb - player.totalCommittedBb;
    if (incrementBb > remainingStackBb + 1 / BB_PRECISION) {
      adapterError(`actionHistory[${index}].increment`, "超过玩家剩余筹码");
    }
    if (event.action === "fold") {
      if (!sameAmount(incrementBb, 0)) adapterError(`actionHistory[${index}]`, "fold 的 increment 必须为 0");
      if (sameAmount(player.streetCommittedBb, highestStreetCommitmentBb)) {
        adapterError(`actionHistory[${index}]`, "无需跟注时应使用 check，而不是 fold");
      }
      player.folded = true;
    } else if (event.action === "check") {
      if (!sameAmount(incrementBb, 0)) adapterError(`actionHistory[${index}]`, "check 的 increment 必须为 0");
      if (!sameAmount(player.streetCommittedBb, highestStreetCommitmentBb)) {
        adapterError(`actionHistory[${index}]`, "面对下注不能 check");
      }
    } else if (event.action === "call") {
      const expectedIncrementBb = Math.min(
        Math.max(0, highestStreetCommitmentBb - player.streetCommittedBb),
        remainingStackBb,
      );
      if (sameAmount(expectedIncrementBb, 0) || !sameAmount(incrementBb, expectedIncrementBb)) {
        adapterError(`actionHistory[${index}]`, "call 金额与当时需跟注额不一致");
      }
    } else {
      if (!sameAmount(incrementBb, 0) && amountToBb > highestStreetCommitmentBb) {
        highestStreetCommitmentBb = amountToBb;
      } else {
        adapterError(`actionHistory[${index}]`, "raise 必须把本街投入提高到当前最高值之上");
      }
    }

    player.streetCommittedBb = amountToBb;
    player.totalCommittedBb = Math.round((player.totalCommittedBb + incrementBb) * BB_PRECISION) / BB_PRECISION;
    runningPotBb = potAfterBb;
    events.push({
      street: eventStreet,
      playerId,
      action: event.action,
      amountToBb,
      incrementBb,
      potAfterBb,
    });
  }

  if (STREET_INDEX[street] < STREET_INDEX[input.street]) {
    for (const state of replay.values()) state.streetCommittedBb = 0;
  }

  for (const seat of seats) {
    const replayed = replay.get(seat.id) as ReplayState;
    if (!sameAmount(replayed.streetCommittedBb, seat.streetCommittedBb)) {
      adapterError(`seats.${seat.position}.streetCommitted`, "与完整 actionHistory 不一致");
    }
    if (!sameAmount(replayed.totalCommittedBb, seat.totalCommittedBb)) {
      adapterError(`seats.${seat.position}.totalCommitted`, "与盲注和完整 actionHistory 不一致");
    }
    if (replayed.folded !== seat.folded) {
      adapterError(`seats.${seat.position}.folded`, "与完整 actionHistory 不一致");
    }
  }
  const potBb = roundedBb(input.pot, bigBlind, "pot");
  if (!sameAmount(runningPotBb, potBb)) adapterError("pot", "与盲注和完整 actionHistory 不一致");
  return events;
}

function normalizedLegalActions(
  input: RangeCraftStandardSpotInput,
  hero: NormalizedSeatInput,
  bigBlind: number,
  toCallBb: number,
  minimumRaiseToBb: number | null,
): readonly StrategyLegalActionV2[] {
  if (!Array.isArray(input.legalActions) || input.legalActions.length === 0) {
    adapterError("legalActions", "必须显式提供完整合法动作");
  }
  const expectedPassive = new Set<StrategyAction>(toCallBb > 0 ? ["fold", "call"] : ["check"]);
  const seenPassive = new Set<StrategyAction>();
  const seenRaiseTargets = new Set<number>();
  const maxRaiseToBb = Math.round((hero.streetCommittedBb + hero.stackBb) * BB_PRECISION) / BB_PRECISION;
  const callToBb = Math.round((hero.streetCommittedBb + toCallBb) * BB_PRECISION) / BB_PRECISION;
  const actions: StrategyLegalActionV2[] = [];

  for (const [index, action] of input.legalActions.entries()) {
    if (!action || typeof action !== "object" || Array.isArray(action) || !(action.action in ACTION_INDEX)) {
      adapterError(`legalActions[${index}]`, "动作无效");
    }
    if (action.action !== "raise") {
      if (!expectedPassive.has(action.action)) {
        adapterError(`legalActions[${index}]`, `${toCallBb > 0 ? "面对下注" : "无需跟注"}时 ${action.action} 不在策略树中`);
      }
      if (seenPassive.has(action.action)) adapterError(`legalActions[${index}]`, `重复动作 ${action.action}`);
      seenPassive.add(action.action);
      actions.push({ action: action.action });
      continue;
    }

    if (minimumRaiseToBb === null) adapterError(`legalActions[${index}]`, "minimumRaiseTo 为 null 时不能提供 raise");
    const raiseToBb = roundedBb(action.raiseTo, bigBlind, `legalActions[${index}].raiseTo`);
    if (seenRaiseTargets.has(raiseToBb)) adapterError(`legalActions[${index}]`, `重复 raiseTo ${raiseToBb}BB`);
    if (raiseToBb <= callToBb) adapterError(`legalActions[${index}].raiseTo`, "必须高于跟注后的本街投入");
    if (raiseToBb > maxRaiseToBb + 1 / BB_PRECISION) {
      adapterError(`legalActions[${index}].raiseTo`, "超过 hero 可用筹码");
    }
    const isAllIn = sameAmount(raiseToBb, maxRaiseToBb);
    if (!isAllIn && raiseToBb < minimumRaiseToBb) {
      adapterError(`legalActions[${index}].raiseTo`, "非全下加注不能低于 minimumRaiseTo");
    }
    if (action.isAllIn !== undefined && action.isAllIn !== isAllIn) {
      adapterError(`legalActions[${index}].isAllIn`, "与 hero 最大可投入额不一致");
    }
    seenRaiseTargets.add(raiseToBb);
    actions.push({ action: "raise", raiseToBb, isAllIn });
  }

  for (const action of expectedPassive) {
    if (!seenPassive.has(action)) adapterError("legalActions", `缺少必需动作 ${action}`);
  }
  if (minimumRaiseToBb !== null && seenRaiseTargets.size === 0) {
    adapterError("legalActions", "minimumRaiseTo 非 null 时必须提供至少一个 raise-to");
  }

  return actions.sort((left, right) => {
    const actionDifference = ACTION_INDEX[left.action] - ACTION_INDEX[right.action];
    if (actionDifference !== 0) return actionDifference;
    const leftSize = left.action === "raise" ? left.raiseToBb : 0;
    const rightSize = right.action === "raise" ? right.raiseToBb : 0;
    return leftSize - rightSize;
  });
}

/**
 * Converts a complete serializable Standard-v1 table snapshot into the strict
 * StrategySpotV2 provider boundary. It rejects rake, non-standard stacks,
 * incomplete history and incomplete passive legal actions instead of silently
 * producing a key for a different game.
 */
export function adaptRangeCraftStandardSpotV2(input: RangeCraftStandardSpotInput): StrategySpotV2 {
  if (!input || typeof input !== "object" || Array.isArray(input)) adapterError("input", "必须是对象");
  const bigBlind = finiteNonNegative(input.bigBlind, "bigBlind");
  if (bigBlind <= 0) adapterError("bigBlind", "必须大于 0");
  if (input.smallBlind !== undefined && !sameAmount(
    roundedBb(input.smallBlind, bigBlind, "smallBlind"),
    RANGECRAFT_STANDARD_V1.blindsBb.small,
  )) {
    adapterError("smallBlind", "RangeCraft Standard v1 必须为 0.5BB");
  }
  if (input.ante !== undefined && !sameAmount(roundedBb(input.ante, bigBlind, "ante"), 0)) {
    adapterError("ante", "RangeCraft Standard v1 不使用 ante");
  }
  if (input.rake !== undefined) {
    if (!sameAmount(finiteNonNegative(input.rake.percent, "rake.percent"), 0)
      || !sameAmount(roundedBb(input.rake.cap, bigBlind, "rake.cap"), 0)) {
      adapterError("rake", "RangeCraft Standard v1 强制无抽水");
    }
  }
  if (!(input.street in STREET_INDEX)) adapterError("street", "无效");

  const seats = normalizeSeats(input, bigBlind);
  const seatById = new Map(seats.map((seat) => [seat.id, seat]));
  const heroId = normalizedId(input.heroId, "heroId");
  const hero = seatById.get(heroId);
  if (!hero) adapterError("heroId", "不在 seats 中");
  if (hero.folded || hero.allIn || hero.stackBb <= 0) adapterError("heroId", "hero 必须是仍可行动的玩家");

  const totalCommittedBb = seats.reduce((sum, seat) => sum + seat.totalCommittedBb, 0);
  const potBb = roundedBb(input.pot, bigBlind, "pot");
  if (!sameAmount(totalCommittedBb, potBb)) adapterError("pot", "无抽水底池必须等于所有玩家 totalCommitted 之和");
  const highestActiveCommitmentBb = Math.max(...seats.filter((seat) => !seat.folded).map((seat) => seat.streetCommittedBb));
  const expectedToCallBb = Math.min(hero.stackBb, Math.max(0, highestActiveCommitmentBb - hero.streetCommittedBb));
  const toCallBb = roundedBb(input.toCall, bigBlind, "toCall");
  if (!sameAmount(toCallBb, expectedToCallBb)) adapterError("toCall", "与座位投入和 hero 剩余筹码不一致");

  const minimumRaiseToBb = input.minimumRaiseTo === null
    ? null
    : roundedBb(input.minimumRaiseTo, bigBlind, "minimumRaiseTo");
  const normalizedSeatOutput: StrategySeatV2[] = seats.map((seat) => ({
    id: seat.id,
    position: seat.position,
    stackBb: seat.stackBb,
    streetCommittedBb: seat.streetCommittedBb,
    totalCommittedBb: seat.totalCommittedBb,
    folded: seat.folded,
    allIn: seat.allIn,
  }));
  const spot: StrategySpotV2 = {
    schemaVersion: STRATEGY_SCHEMA_VERSION_V2,
    gameSpecId: RANGECRAFT_STANDARD_V1.gameSpecId,
    treeId: RANGECRAFT_STANDARD_V1.treeId,
    gameConfig: RANGECRAFT_STANDARD_STRATEGY_CONFIG_V2,
    street: input.street,
    heroId,
    heroCards: input.heroCards.map((card, index) => normalizedCard(card, `heroCards[${index}]`)),
    board: input.board.map((card, index) => normalizedCard(card, `board[${index}]`)),
    potBb,
    toCallBb,
    minimumRaiseToBb,
    seats: normalizedSeatOutput,
    activePlayerIds: seats.filter((seat) => !seat.folded).map((seat) => seat.id),
    legalActions: normalizedLegalActions(input, hero, bigBlind, toCallBb, minimumRaiseToBb),
    actionHistory: normalizedHistory(input, seats, bigBlind),
  };
  assertStrategySpotV2(spot);
  return deepFreeze(spot);
}

/** Alias emphasizing that the adapter constructs a new provider-boundary value. */
export const createRangeCraftStandardStrategySpotV2 = adaptRangeCraftStandardSpotV2;
