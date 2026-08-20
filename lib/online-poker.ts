export const ONLINE_MIN_PLAYERS = 2;
export const ONLINE_MAX_PLAYERS = 6;
export const ONLINE_SMALL_BLIND = 5;
export const ONLINE_BIG_BLIND = 10;
export const ONLINE_STARTING_STACK = ONLINE_BIG_BLIND * 100;
export const ONLINE_MIN_STARTING_STACK = ONLINE_BIG_BLIND * 20;
export const ONLINE_MAX_STARTING_STACK = ONLINE_BIG_BLIND * 1_000;
export const ONLINE_DEFAULT_ACTION_TIME_MS = 10_000;
export const ONLINE_MIN_ACTION_TIME_MS = 5_000;
export const ONLINE_MAX_ACTION_TIME_MS = 60_000;
export const ONLINE_DEFAULT_TIME_BANK_MS = 100_000;
export const ONLINE_MAX_TIME_BANK_MS = 600_000;

export type OnlineCard = {
  rank: number;
  suit: string | number;
};
export type OnlineStreet = "preflop" | "flop" | "turn" | "river";
export type OnlineActionKind = "fold" | "check" | "call" | "raise";
export type OnlineRoomPhase = "lobby" | "playing" | "showdown" | "between_hands" | "closed";
export type OnlineTableMode = "cash" | "tournament";

export type OnlineActor = {
  accountId: string;
  displayName: string;
};

export type OnlineSeatState = {
  seat: number;
  accountId: string;
  displayName: string;
  stack: number;
  ready: boolean;
  timeBankMs: number;
  connected: boolean;
  disconnectedAt: number | null;
  /** Explicitly leaving; retained only while the current hand still needs this seat. */
  pendingLeave: boolean;
};

export type OnlineHandPlayerState = {
  seat: number;
  accountId: string;
  /** Kept with the hand so completed results remain readable after a seat leaves. */
  displayName: string;
  hole: [OnlineCard, OnlineCard];
  folded: boolean;
  bet: number;
  contributed: number;
  hasActed: boolean;
  actedAtBet: number;
  raiseLocked: boolean;
  shown: boolean;
};

export type OnlinePayout = {
  seat: number;
  amount: number;
};

export type OnlineHandResult = {
  kind: "uncontested" | "showdown";
  totalPot: number;
  /** Every seat receiving chips from any pot. */
  winnerSeats: number[];
  /** Winners of the first/main pot, useful for table headline display. */
  mainPotWinnerSeats: number[];
  payouts: OnlinePayout[];
  /** Uncalled chips returned to their owner; these are not pot winnings. */
  returns: OnlinePayout[];
  handNames: { seat: number; name: string }[];
};

export type OnlineHandState = {
  id: string;
  number: number;
  street: OnlineStreet;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  currentSeat: number | null;
  community: OnlineCard[];
  /** Server-private. projectRoomState never copies this field. */
  deck: OnlineCard[];
  players: OnlineHandPlayerState[];
  pot: number;
  highestBet: number;
  minRaise: number;
  lastAggressorSeat: number | null;
  raiseCount: number;
  result: OnlineHandResult | null;
  pendingShowSeat: number | null;
  actionStartedAt: number | null;
  actionDeadlineAt: number | null;
};

export type OnlineCommandReceipt = {
  commandId: string;
  accountId: string;
  fingerprint: string;
  resultRevision: number;
};

export type OnlineRoomState = {
  roomId: string;
  ownerAccountId: string;
  maxPlayers: number;
  phase: OnlineRoomPhase;
  revision: number;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  tableMode: OnlineTableMode;
  actionTimeMs: number;
  initialTimeBankMs: number;
  seats: OnlineSeatState[];
  hand: OnlineHandState | null;
  lastDealerSeat: number | null;
  processedCommands: OnlineCommandReceipt[];
};

type CommandBase = {
  commandId: string;
  expectedRevision: number;
};

export type OnlinePokerCommand =
  | (CommandBase & { type: "join" })
  | (CommandBase & { type: "ready"; ready: boolean })
  | (CommandBase & { type: "start" })
  | (CommandBase & { type: "use-time-bank"; handId: string })
  | (CommandBase & { type: "timeout"; handId: string })
  | (CommandBase & {
      type: "act";
      handId: string;
      action: OnlineActionKind;
      raiseTo?: number;
    })
  | (CommandBase & { type: "show"; handId: string; show: boolean })
  | (CommandBase & { type: "leave" });

export type OnlinePokerErrorCode =
  | "INVALID_COMMAND"
  | "COMMAND_ID_CONFLICT"
  | "STALE_REVISION"
  | "ROOM_NOT_JOINABLE"
  | "ROOM_FULL"
  | "ALREADY_JOINED"
  | "NOT_A_MEMBER"
  | "NOT_ROOM_OWNER"
  | "NOT_ENOUGH_PLAYERS"
  | "PLAYERS_NOT_READY"
  | "WRONG_PHASE"
  | "WRONG_HAND"
  | "NOT_YOUR_TURN"
  | "CHECK_REQUIRED"
  | "CALL_REQUIRED"
  | "RAISE_NOT_ALLOWED"
  | "INVALID_RAISE"
  | "SHOW_NOT_ALLOWED"
  | "TIME_BANK_EMPTY"
  | "TIME_NOT_EXPIRED"
  | "TIME_EXPIRED";

export type OnlinePokerError = {
  code: OnlinePokerErrorCode;
  message: string;
  revision: number;
};

export type OnlinePokerCommandResult =
  | {
      ok: true;
      state: OnlineRoomState;
      resultRevision: number;
      duplicate: boolean;
    }
  | {
      ok: false;
      state: OnlineRoomState;
      error: OnlinePokerError;
    };

export type OnlineRandomIndex = (maxExclusive: number) => number;

export type OnlineEngineOptions = {
  randomIndex?: OnlineRandomIndex;
  makeHandId?: () => string;
  now?: () => number;
};

export type OnlineLegalActions = {
  fold: boolean;
  check: boolean;
  callAmount: number | null;
  raise: {
    minRaiseTo: number;
    maxRaiseTo: number;
    allInOnly: boolean;
  } | null;
};

export type OnlinePublicSeat = {
  seat: number;
  displayName: string;
  stack: number;
  ready: boolean;
  timeBankMs: number;
  connected: boolean;
  pendingLeave: boolean;
  folded: boolean;
  bet: number;
  contributed: number;
  holeCardCount: number;
  holeCards: [OnlineCard, OnlineCard] | null;
  shown: boolean;
};

export type OnlinePublicHand = {
  id: string;
  number: number;
  street: OnlineStreet;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  currentSeat: number | null;
  community: OnlineCard[];
  pot: number;
  committedPot: number;
  highestBet: number;
  minRaise: number;
  lastAggressorSeat: number | null;
  raiseCount: number;
  result: (OnlineHandResult & {
    /** Public-safe winner details retained even after the winner releases their seat. */
    winnerDetails: {
      seat: number;
      displayName: string;
      holeCards: [OnlineCard, OnlineCard] | null;
    }[];
  }) | null;
  pendingShowSeat: number | null;
  actionStartedAt: number | null;
  actionDeadlineAt: number | null;
};

export type OnlinePublicRoomState = {
  roomId: string;
  ownerSeat: number | null;
  maxPlayers: number;
  phase: OnlineRoomPhase;
  revision: number;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  tableMode: OnlineTableMode;
  actionTimeMs: number;
  initialTimeBankMs: number;
  timeBankUnitMs: number;
  viewerSeat: number | null;
  seats: OnlinePublicSeat[];
  hand: OnlinePublicHand | null;
  legalActions: OnlineLegalActions | null;
};

const SUITS = ["♠", "♥", "♦", "♣"] as const;
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
const HAND_NAMES = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"] as const;

function packedHandScore(category: number, values: readonly number[]) {
  return [category, ...values, 0, 0, 0, 0, 0]
    .slice(0, 6)
    .reduce((total, value) => total * 15 + value, 0);
}

function scoreFiveCards(cards: readonly OnlineCard[]) {
  const ranks = cards.map((card) => card.rank).sort((left, right) => right - left);
  const counts = new Map<number, number>();
  ranks.forEach((rank) => counts.set(rank, (counts.get(rank) ?? 0) + 1));
  const groups = [...counts].sort((left, right) => right[1] - left[1] || right[0] - left[0]);
  const flush = cards.every((card) => (
    typeof card.suit === typeof cards[0].suit && String(card.suit) === String(cards[0].suit)
  ));
  const uniqueRanks = [...new Set(ranks)];
  if (uniqueRanks[0] === 14) uniqueRanks.push(1);
  let straightHigh = 0;
  for (let index = 0; index <= uniqueRanks.length - 5; index += 1) {
    if (uniqueRanks[index] - uniqueRanks[index + 4] === 4) {
      straightHigh = uniqueRanks[index];
      break;
    }
  }

  let category = 0;
  let values: number[] = ranks;
  if (flush && straightHigh) {
    category = 8;
    values = [straightHigh];
  } else if (groups[0][1] === 4) {
    category = 7;
    values = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    category = 6;
    values = [groups[0][0], groups[1][0]];
  } else if (flush) {
    category = 5;
  } else if (straightHigh) {
    category = 4;
    values = [straightHigh];
  } else if (groups[0][1] === 3) {
    category = 3;
    values = [groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((left, right) => right - left)];
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    category = 2;
    const pairs = groups.filter(([, count]) => count === 2).map(([rank]) => rank).sort((left, right) => right - left);
    const kicker = groups.find(([, count]) => count === 1)?.[0] ?? 0;
    values = [pairs[0], pairs[1], kicker];
  } else if (groups[0][1] === 2) {
    category = 1;
    values = [groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((left, right) => right - left)];
  }
  return { score: packedHandScore(category, values), name: HAND_NAMES[category] };
}

function bestOnlineHand(cards: readonly OnlineCard[]) {
  if (cards.length < 5 || cards.length > 7) throw new RangeError("摊牌必须包含 5 到 7 张牌");
  let best = { score: -1, name: HAND_NAMES[0] as string };
  const choose = (start: number, picked: OnlineCard[]) => {
    if (picked.length === 5) {
      const evaluation = scoreFiveCards(picked);
      if (evaluation.score > best.score) best = evaluation;
      return;
    }
    for (let index = start; index <= cards.length - (5 - picked.length); index += 1) {
      choose(index + 1, [...picked, cards[index]]);
    }
  };
  choose(0, []);
  return best;
}

function assertNonEmpty(value: string, label: string) {
  if (!value.trim()) throw new RangeError(`${label} 不能为空`);
}

function cloneCard(card: OnlineCard): OnlineCard {
  return { rank: card.rank, suit: card.suit };
}

function cloneRoom(room: OnlineRoomState): OnlineRoomState {
  return {
    ...room,
    seats: room.seats.map((seat) => ({ ...seat })),
    hand: room.hand
      ? {
          ...room.hand,
          community: room.hand.community.map(cloneCard),
          deck: room.hand.deck.map(cloneCard),
          players: room.hand.players.map((player) => ({
            ...player,
            hole: [cloneCard(player.hole[0]), cloneCard(player.hole[1])],
          })),
          result: room.hand.result
            ? {
                ...room.hand.result,
                winnerSeats: [...room.hand.result.winnerSeats],
                mainPotWinnerSeats: [...room.hand.result.mainPotWinnerSeats],
                payouts: room.hand.result.payouts.map((payout) => ({ ...payout })),
                returns: room.hand.result.returns.map((entry) => ({ ...entry })),
                handNames: room.hand.result.handNames.map((entry) => ({ ...entry })),
              }
            : null,
        }
      : null,
    processedCommands: room.processedCommands.map((receipt) => ({ ...receipt })),
  };
}

function fail(room: OnlineRoomState, code: OnlinePokerErrorCode, message: string): OnlinePokerCommandResult {
  return {
    ok: false,
    state: room,
    error: { code, message, revision: room.revision },
  };
}

function defaultHandId() {
  return crypto.randomUUID();
}

function engineNow(options: OnlineEngineOptions): number {
  const value = (options.now ?? Date.now)();
  if (!Number.isFinite(value)) throw new RangeError("now 必须返回有效时间");
  return Math.floor(value);
}

function integerInRange(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} 必须在 ${minimum} 到 ${maximum} 之间`);
  }
  return value;
}

function normalizeStoredRoom(room: OnlineRoomState): void {
  room.tableMode = room.tableMode === "cash" ? "cash" : "tournament";
  if (!Number.isInteger(room.actionTimeMs) || room.actionTimeMs < ONLINE_MIN_ACTION_TIME_MS || room.actionTimeMs > ONLINE_MAX_ACTION_TIME_MS) {
    room.actionTimeMs = ONLINE_DEFAULT_ACTION_TIME_MS;
  }
  if (!Number.isInteger(room.initialTimeBankMs) || room.initialTimeBankMs < 0 || room.initialTimeBankMs > ONLINE_MAX_TIME_BANK_MS) {
    room.initialTimeBankMs = ONLINE_DEFAULT_TIME_BANK_MS;
  }
  room.seats.forEach((seat) => {
    if (!Number.isInteger(seat.timeBankMs) || seat.timeBankMs < 0 || seat.timeBankMs > ONLINE_MAX_TIME_BANK_MS) {
      seat.timeBankMs = room.initialTimeBankMs;
    }
    seat.pendingLeave = seat.pendingLeave === true;
  });
  room.hand?.players.forEach((player) => {
    if (typeof player.displayName !== "string" || !player.displayName.trim()) {
      player.displayName = room.seats.find((seat) => seat.seat === player.seat)?.displayName ?? `座位 ${player.seat + 1}`;
    }
  });
}

/** Uniform integer sampling backed by Web Crypto for every card shuffle. */
export function cryptoRandomIndex(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError("maxExclusive 必须是正整数");
  }
  const range = 0x1_0000_0000;
  const ceiling = Math.floor(range / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= ceiling);
  return buffer[0] % maxExclusive;
}

export function makeOnlineDeck(): OnlineCard[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

export function shuffleOnlineDeck(randomIndex: OnlineRandomIndex = cryptoRandomIndex): OnlineCard[] {
  const deck = makeOnlineDeck();
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
      throw new RangeError(`randomIndex(${index + 1}) 返回了越界值`);
    }
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

export function createOnlineRoom(options: {
  roomId: string;
  owner: OnlineActor;
  maxPlayers?: number;
  startingStack?: number;
  tableMode?: OnlineTableMode;
  actionTimeMs?: number;
  initialTimeBankMs?: number;
}): OnlineRoomState {
  assertNonEmpty(options.roomId, "roomId");
  assertNonEmpty(options.owner.accountId, "owner.accountId");
  assertNonEmpty(options.owner.displayName, "owner.displayName");
  const maxPlayers = options.maxPlayers ?? ONLINE_MAX_PLAYERS;
  if (!Number.isInteger(maxPlayers) || maxPlayers < ONLINE_MIN_PLAYERS || maxPlayers > ONLINE_MAX_PLAYERS) {
    throw new RangeError(`maxPlayers 必须在 ${ONLINE_MIN_PLAYERS} 到 ${ONLINE_MAX_PLAYERS} 之间`);
  }
  const startingStack = integerInRange(
    options.startingStack ?? ONLINE_STARTING_STACK,
    ONLINE_MIN_STARTING_STACK,
    ONLINE_MAX_STARTING_STACK,
    "startingStack",
  );
  const actionTimeMs = integerInRange(
    options.actionTimeMs ?? ONLINE_DEFAULT_ACTION_TIME_MS,
    ONLINE_MIN_ACTION_TIME_MS,
    ONLINE_MAX_ACTION_TIME_MS,
    "actionTimeMs",
  );
  const initialTimeBankMs = integerInRange(
    options.initialTimeBankMs ?? ONLINE_DEFAULT_TIME_BANK_MS,
    0,
    ONLINE_MAX_TIME_BANK_MS,
    "initialTimeBankMs",
  );
  const tableMode = options.tableMode ?? "tournament";
  if (tableMode !== "cash" && tableMode !== "tournament") {
    throw new RangeError("tableMode 必须是 cash 或 tournament");
  }
  return {
    roomId: options.roomId,
    ownerAccountId: options.owner.accountId,
    maxPlayers,
    phase: "lobby",
    revision: 0,
    smallBlind: ONLINE_SMALL_BLIND,
    bigBlind: ONLINE_BIG_BLIND,
    startingStack,
    tableMode,
    actionTimeMs,
    initialTimeBankMs,
    seats: [{
      seat: 0,
      accountId: options.owner.accountId,
      displayName: options.owner.displayName,
      stack: startingStack,
      ready: false,
      timeBankMs: initialTimeBankMs,
      connected: true,
      disconnectedAt: null,
      pendingLeave: false,
    }],
    hand: null,
    lastDealerSeat: null,
    processedCommands: [],
  };
}

function clockwiseSeats(seats: readonly number[], after: number): number[] {
  return [...seats].sort((left, right) => {
    const leftDistance = (left - after + ONLINE_MAX_PLAYERS) % ONLINE_MAX_PLAYERS || ONLINE_MAX_PLAYERS;
    const rightDistance = (right - after + ONLINE_MAX_PLAYERS) % ONLINE_MAX_PLAYERS || ONLINE_MAX_PLAYERS;
    return leftDistance - rightDistance;
  });
}

function nextSeat(seats: readonly number[], after: number): number {
  const ordered = clockwiseSeats(seats, after);
  if (!ordered.length) throw new Error("牌桌没有可用座位");
  return ordered[0];
}

function seatByNumber(room: OnlineRoomState, seatNumber: number) {
  return room.seats.find((seat) => seat.seat === seatNumber);
}

function playerBySeat(hand: OnlineHandState, seatNumber: number) {
  return hand.players.find((player) => player.seat === seatNumber);
}

function activeActorSeats(room: OnlineRoomState, hand: OnlineHandState): number[] {
  return hand.players
    .filter((player) => !player.folded && (seatByNumber(room, player.seat)?.stack ?? 0) > 0)
    .map((player) => player.seat);
}

function nextActorSeat(room: OnlineRoomState, hand: OnlineHandState, after: number): number | null {
  const seats = activeActorSeats(room, hand);
  return seats.length ? nextSeat(seats, after) : null;
}

function takeCard(deck: OnlineCard[]): OnlineCard {
  const card = deck.shift();
  if (!card) throw new Error("牌堆已耗尽");
  return card;
}

function beginHand(room: OnlineRoomState, options: OnlineEngineOptions): void {
  if (room.tableMode === "cash" && room.hand) {
    room.seats.forEach((seat) => {
      if (seat.stack <= 0) seat.stack = room.startingStack;
    });
  }
  const occupied = room.seats
    .filter((seat) => seat.stack > 0)
    .sort((left, right) => left.seat - right.seat);
  if (occupied.length < ONLINE_MIN_PLAYERS) throw new Error("至少需要两名玩家才能开局");
  room.seats.forEach((seat) => { seat.ready = false; });

  const occupiedSeats = occupied.map((seat) => seat.seat);
  const headsUp = occupied.length === 2;
  const previousHand = room.hand;
  let dealerSeat: number;
  let bigBlindSeat: number;
  if (headsUp && previousHand && previousHand.players.length > 2) {
    // When a table contracts to heads-up, first move the big blind clockwise
    // from the previous BB. The other survivor becomes button/SB, preventing
    // either survivor from posting the big blind twice in succession.
    bigBlindSeat = nextSeat(occupiedSeats, previousHand.bigBlindSeat);
    dealerSeat = nextSeat(occupiedSeats, bigBlindSeat);
  } else {
    dealerSeat = room.lastDealerSeat === null
      ? occupiedSeats[0]
      : nextSeat(occupiedSeats, room.lastDealerSeat);
    bigBlindSeat = headsUp
      ? nextSeat(occupiedSeats, dealerSeat)
      : nextSeat(occupiedSeats, nextSeat(occupiedSeats, dealerSeat));
  }
  const smallBlindSeat = headsUp ? dealerSeat : nextSeat(occupiedSeats, dealerSeat);
  const deck = shuffleOnlineDeck(options.randomIndex ?? cryptoRandomIndex);
  const dealOrder = clockwiseSeats(occupiedSeats, dealerSeat);
  const holes = new Map<number, OnlineCard[]>();
  occupiedSeats.forEach((seat) => holes.set(seat, []));
  for (let round = 0; round < 2; round += 1) {
    dealOrder.forEach((seat) => holes.get(seat)?.push(takeCard(deck)));
  }

  const players: OnlineHandPlayerState[] = occupied.map((seat) => {
    const cards = holes.get(seat.seat);
    if (!cards || cards.length !== 2) throw new Error("发牌失败");
    return {
      seat: seat.seat,
      accountId: seat.accountId,
      displayName: seat.displayName,
      hole: [cards[0], cards[1]],
      folded: false,
      bet: 0,
      contributed: 0,
      hasActed: false,
      actedAtBet: 0,
      raiseLocked: false,
      shown: false,
    };
  });

  const postBlind = (seatNumber: number, blind: number) => {
    const seat = seatByNumber(room, seatNumber);
    const player = players.find((candidate) => candidate.seat === seatNumber);
    if (!seat || !player) throw new Error("盲注座位不存在");
    const paid = Math.min(blind, seat.stack);
    seat.stack -= paid;
    player.bet = paid;
    player.contributed = paid;
  };
  postBlind(smallBlindSeat, room.smallBlind);
  postBlind(bigBlindSeat, room.bigBlind);

  const actorsAfterBlinds = players
    .filter((player) => (seatByNumber(room, player.seat)?.stack ?? 0) > 0)
    .map((player) => player.seat);
  const currentSeat = actorsAfterBlinds.length ? nextSeat(actorsAfterBlinds, bigBlindSeat) : null;
  const postedHighestBet = Math.max(...players.map((player) => player.bet));
  // A short all-in big blind does not reduce the preflop bring-in while at
  // least two players still have chips with which to act.
  const openingHighestBet = actorsAfterBlinds.length >= 2
    ? Math.max(postedHighestBet, room.bigBlind)
    : postedHighestBet;
  const actionStartedAt = currentSeat === null ? null : engineNow(options);
  room.hand = {
    id: (options.makeHandId ?? defaultHandId)(),
    number: (room.hand?.number ?? 0) + 1,
    street: "preflop",
    dealerSeat,
    smallBlindSeat,
    bigBlindSeat,
    currentSeat,
    community: [],
    deck,
    players,
    pot: 0,
    highestBet: openingHighestBet,
    minRaise: room.bigBlind,
    lastAggressorSeat: null,
    raiseCount: 0,
    result: null,
    pendingShowSeat: null,
    actionStartedAt,
    actionDeadlineAt: actionStartedAt === null ? null : actionStartedAt + room.actionTimeMs,
  };
  room.lastDealerSeat = dealerSeat;
  room.phase = "playing";

  const soleActor = currentSeat === null ? null : playerBySeat(room.hand, currentSeat);
  if (currentSeat === null || (
    actorsAfterBlinds.length === 1
    && soleActor
    && soleActor.bet === room.hand.highestBet
  )) {
    while (room.hand.community.length < 5) room.hand.community.push(takeCard(room.hand.deck));
    room.hand.street = "river";
    settleShowdown(room, room.hand);
  }
}

function committedPot(hand: OnlineHandState) {
  return hand.pot + hand.players.reduce((sum, player) => sum + player.bet, 0);
}

function minimumRaiseTarget(hand: OnlineHandState) {
  return hand.highestBet + hand.minRaise;
}

function hasOpponentWhoCanRespond(room: OnlineRoomState, hand: OnlineHandState, actingSeat: number) {
  return hand.players.some((player) => (
    player.seat !== actingSeat
    && !player.folded
    && (seatByNumber(room, player.seat)?.stack ?? 0) > 0
  ));
}

function betToMatchForActor(room: OnlineRoomState, hand: OnlineHandState, actingSeat: number) {
  const actors = activeActorSeats(room, hand);
  if (actors.length !== 1 || actors[0] !== actingSeat) return hand.highestBet;

  // Once every other live player is all-in, a nominal short-BB bring-in is no
  // longer money this player can be required to match. Only chips actually put
  // in by non-folded opponents remain contestable.
  return Math.max(0, ...hand.players
    .filter((player) => player.seat !== actingSeat && !player.folded)
    .map((player) => player.bet));
}

export function legalOnlineActions(room: OnlineRoomState, accountId: string): OnlineLegalActions | null {
  const hand = room.hand;
  if (room.phase !== "playing" || !hand || hand.currentSeat === null) return null;
  const seat = room.seats.find((candidate) => candidate.accountId === accountId);
  if (!seat || seat.seat !== hand.currentSeat) return null;
  const player = playerBySeat(hand, seat.seat);
  if (!player || player.folded || seat.stack <= 0) return null;
  const toCall = Math.max(0, betToMatchForActor(room, hand, seat.seat) - player.bet);
  const maxRaiseTo = player.bet + seat.stack;
  let raise: OnlineLegalActions["raise"] = null;
  if (!player.raiseLocked && maxRaiseTo > hand.highestBet && hasOpponentWhoCanRespond(room, hand, seat.seat)) {
    const ordinaryMinimum = minimumRaiseTarget(hand);
    raise = {
      minRaiseTo: Math.min(ordinaryMinimum, maxRaiseTo),
      maxRaiseTo,
      allInOnly: maxRaiseTo < ordinaryMinimum,
    };
  }
  return {
    fold: true,
    check: toCall === 0,
    callAmount: toCall > 0 ? Math.min(toCall, seat.stack) : null,
    raise,
  };
}

function collectBets(hand: OnlineHandState) {
  hand.pot += hand.players.reduce((sum, player) => sum + player.bet, 0);
  hand.players.forEach((player) => {
    player.bet = 0;
    player.hasActed = false;
    player.actedAtBet = 0;
    player.raiseLocked = false;
  });
  hand.highestBet = 0;
  hand.minRaise = ONLINE_BIG_BLIND;
  hand.lastAggressorSeat = null;
  hand.raiseCount = 0;
}

function payoutOrder(winnerSeats: readonly number[], dealerSeat: number): number[] {
  return clockwiseSeats(winnerSeats, dealerSeat);
}

function settleShowdown(room: OnlineRoomState, hand: OnlineHandState) {
  const levels = [...new Set(hand.players.filter((player) => player.contributed > 0).map((player) => player.contributed))]
    .sort((left, right) => left - right);
  const payouts = new Map<number, number>();
  const returns = new Map<number, number>();
  const handNames = new Map<number, string>();
  let previousLevel = 0;
  let mainPotWinners: number[] = [];

  for (const level of levels) {
    const contributors = hand.players.filter((player) => player.contributed >= level);
    const layerAmount = (level - previousLevel) * contributors.length;
    previousLevel = level;
    if (contributors.length === 1) {
      const returningSeat = contributors[0].seat;
      returns.set(returningSeat, (returns.get(returningSeat) ?? 0) + layerAmount);
      continue;
    }
    const eligible = contributors.filter((player) => !player.folded);
    if (!eligible.length) throw new Error("边池没有仍持牌的合资格玩家");
    if (layerAmount <= 0) continue;
    const ranked = eligible.map((player) => {
      const evaluation = bestOnlineHand([...player.hole, ...hand.community]);
      handNames.set(player.seat, evaluation.name);
      return { seat: player.seat, score: evaluation.score };
    });
    const topScore = Math.max(...ranked.map((entry) => entry.score));
    const winners = ranked.filter((entry) => entry.score === topScore).map((entry) => entry.seat);
    if (!mainPotWinners.length) mainPotWinners = winners;
    const orderedWinners = payoutOrder(winners, hand.dealerSeat);
    const share = Math.floor(layerAmount / winners.length);
    let remainder = layerAmount - share * winners.length;
    orderedWinners.forEach((seatNumber) => {
      const amount = share + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      payouts.set(seatNumber, (payouts.get(seatNumber) ?? 0) + amount);
    });
  }

  payouts.forEach((amount, seatNumber) => {
    const seat = seatByNumber(room, seatNumber);
    if (!seat) throw new Error("结算座位不存在");
    seat.stack += amount;
  });
  returns.forEach((amount, seatNumber) => {
    const seat = seatByNumber(room, seatNumber);
    if (!seat) throw new Error("退回筹码的座位不存在");
    seat.stack += amount;
  });
  hand.players.forEach((player) => {
    player.bet = 0;
    if (!player.folded) player.shown = true;
  });
  const totalPot = [...payouts.values()].reduce((sum, amount) => sum + amount, 0);
  hand.pot = 0;
  hand.currentSeat = null;
  hand.result = {
    kind: "showdown",
    totalPot,
    winnerSeats: [...payouts.keys()],
    mainPotWinnerSeats: mainPotWinners,
    payouts: [...payouts].map(([seat, amount]) => ({ seat, amount })),
    returns: [...returns].map(([seat, amount]) => ({ seat, amount })),
    handNames: [...handNames].map(([seat, name]) => ({ seat, name })),
  };
  hand.pendingShowSeat = null;
  room.seats.forEach((seat) => { seat.ready = false; });
  room.phase = "between_hands";
}

function awardUncontested(room: OnlineRoomState, hand: OnlineHandState, winnerSeat: number) {
  const contributed = hand.players.reduce((sum, player) => sum + player.contributed, 0);
  const winner = seatByNumber(room, winnerSeat);
  if (!winner) throw new Error("赢家座位不存在");
  const winnerPlayer = playerBySeat(hand, winnerSeat);
  if (!winnerPlayer) throw new Error("赢家不在本手牌中");
  const opponentHigh = Math.max(0, ...hand.players
    .filter((player) => player.seat !== winnerSeat)
    .map((player) => player.contributed));
  const uncalled = Math.max(0, winnerPlayer.contributed - opponentHigh);
  const totalPot = contributed - uncalled;
  winner.stack += totalPot;
  if (uncalled > 0) winner.stack += uncalled;
  hand.players.forEach((player) => { player.bet = 0; });
  hand.pot = 0;
  hand.currentSeat = null;
  hand.result = {
    kind: "uncontested",
    totalPot,
    winnerSeats: [winnerSeat],
    mainPotWinnerSeats: [winnerSeat],
    payouts: [{ seat: winnerSeat, amount: totalPot }],
    returns: uncalled > 0 ? [{ seat: winnerSeat, amount: uncalled }] : [],
    handNames: [],
  };
  hand.pendingShowSeat = winnerSeat;
  room.seats.forEach((seat) => { seat.ready = false; });
  room.phase = "showdown";
}

function dealNextStreet(room: OnlineRoomState, hand: OnlineHandState) {
  collectBets(hand);
  if (hand.street === "river") {
    settleShowdown(room, hand);
    return;
  }
  if (hand.street === "preflop") {
    hand.community.push(takeCard(hand.deck), takeCard(hand.deck), takeCard(hand.deck));
    hand.street = "flop";
  } else if (hand.street === "flop") {
    hand.community.push(takeCard(hand.deck));
    hand.street = "turn";
  } else {
    hand.community.push(takeCard(hand.deck));
    hand.street = "river";
  }

  const actors = activeActorSeats(room, hand);
  if (actors.length <= 1) {
    while (hand.community.length < 5) hand.community.push(takeCard(hand.deck));
    hand.street = "river";
    settleShowdown(room, hand);
    return;
  }
  hand.currentSeat = nextSeat(actors, hand.dealerSeat);
}

function bettingRoundComplete(room: OnlineRoomState, hand: OnlineHandState) {
  return hand.players
    .filter((player) => !player.folded && (seatByNumber(room, player.seat)?.stack ?? 0) > 0)
    .every((player) => player.hasActed && player.bet === hand.highestBet);
}

function finishAction(room: OnlineRoomState, hand: OnlineHandState, actingSeat: number) {
  const remaining = hand.players.filter((player) => !player.folded);
  if (remaining.length === 1) {
    awardUncontested(room, hand, remaining[0].seat);
    return;
  }
  const actors = activeActorSeats(room, hand);
  const soleActor = actors.length === 1 ? playerBySeat(hand, actors[0]) : null;
  if (actors.length === 0 || (
    soleActor
    && soleActor.bet >= betToMatchForActor(room, hand, soleActor.seat)
  )) {
    dealNextStreet(room, hand);
    return;
  }
  if (bettingRoundComplete(room, hand)) {
    dealNextStreet(room, hand);
    return;
  }
  hand.currentSeat = nextActorSeat(room, hand, actingSeat);
  if (hand.currentSeat === null) dealNextStreet(room, hand);
}

function applyAction(
  room: OnlineRoomState,
  accountId: string,
  command: Extract<OnlinePokerCommand, { type: "act" }>,
): OnlinePokerError | null {
  const hand = room.hand;
  if (room.phase !== "playing" || !hand) {
    return { code: "WRONG_PHASE", message: "牌局当前不可行动", revision: room.revision };
  }
  if (command.handId !== hand.id) {
    return { code: "WRONG_HAND", message: "该行动属于另一手牌", revision: room.revision };
  }
  const seat = room.seats.find((candidate) => candidate.accountId === accountId);
  if (!seat) return { code: "NOT_A_MEMBER", message: "你不在这个房间", revision: room.revision };
  if (hand.currentSeat !== seat.seat) {
    return { code: "NOT_YOUR_TURN", message: "当前没有轮到你", revision: room.revision };
  }
  const player = playerBySeat(hand, seat.seat);
  if (!player || player.folded || seat.stack <= 0) {
    return { code: "NOT_YOUR_TURN", message: "当前没有轮到你", revision: room.revision };
  }
  const betToMatch = betToMatchForActor(room, hand, seat.seat);
  const toCall = Math.max(0, betToMatch - player.bet);

  if (command.action === "fold") {
    player.folded = true;
    player.hasActed = true;
    player.actedAtBet = betToMatch;
  } else if (command.action === "check") {
    if (toCall !== 0) {
      return { code: "CALL_REQUIRED", message: "面对下注时不能过牌", revision: room.revision };
    }
    player.hasActed = true;
    player.actedAtBet = betToMatch;
  } else if (command.action === "call") {
    if (toCall === 0) {
      return { code: "CHECK_REQUIRED", message: "无人下注时应当过牌", revision: room.revision };
    }
    const paid = Math.min(toCall, seat.stack);
    seat.stack -= paid;
    player.bet += paid;
    player.contributed += paid;
    player.hasActed = true;
    player.actedAtBet = betToMatch;
  } else {
    const target = command.raiseTo;
    if (player.raiseLocked) {
      return { code: "RAISE_NOT_ALLOWED", message: "不足额全下没有重新开放加注权", revision: room.revision };
    }
    if (!hasOpponentWhoCanRespond(room, hand, seat.seat)) {
      return { code: "RAISE_NOT_ALLOWED", message: "所有对手都已全下，不能继续加注", revision: room.revision };
    }
    if (typeof target !== "number" || !Number.isFinite(target) || !Number.isInteger(target)) {
      return { code: "INVALID_RAISE", message: "raiseTo 必须是整数筹码总额", revision: room.revision };
    }
    const maxTarget = player.bet + seat.stack;
    const ordinaryMinimum = minimumRaiseTarget(hand);
    if (target <= hand.highestBet || target > maxTarget) {
      return { code: "INVALID_RAISE", message: `raiseTo 必须大于 ${hand.highestBet} 且不超过 ${maxTarget}`, revision: room.revision };
    }
    if (target < ordinaryMinimum && target !== maxTarget) {
      return { code: "INVALID_RAISE", message: `最小加注到 ${ordinaryMinimum}；不足额只能全下到 ${maxTarget}`, revision: room.revision };
    }
    const previousHighest = hand.highestBet;
    const increase = target - previousHighest;
    const paid = target - player.bet;
    seat.stack -= paid;
    player.bet = target;
    player.contributed += paid;
    player.hasActed = true;
    player.actedAtBet = target;
    player.raiseLocked = false;
    hand.highestBet = target;
    hand.lastAggressorSeat = seat.seat;
    hand.raiseCount += 1;
    const fullRaise = increase >= hand.minRaise;
    if (fullRaise) hand.minRaise = increase;
    hand.players.forEach((other) => {
      if (other.seat === seat.seat || other.folded || (seatByNumber(room, other.seat)?.stack ?? 0) <= 0) return;
      if (fullRaise) {
        other.hasActed = false;
        other.raiseLocked = false;
      } else if (other.hasActed) {
        other.raiseLocked = target - other.actedAtBet < hand.minRaise;
      }
    });
  }

  finishAction(room, hand, seat.seat);
  return null;
}

function forceFoldDepartingPlayer(room: OnlineRoomState, seat: OnlineSeatState): void {
  const hand = room.hand;
  if (room.phase !== "playing" || !hand) return;
  const player = playerBySeat(hand, seat.seat);
  if (!player || player.folded || seat.stack <= 0) return;

  player.folded = true;
  player.hasActed = true;
  player.actedAtBet = betToMatchForActor(room, hand, seat.seat);

  if (hand.currentSeat === seat.seat) {
    finishAction(room, hand, seat.seat);
    return;
  }

  const remaining = hand.players.filter((candidate) => !candidate.folded);
  if (remaining.length === 1) awardUncontested(room, hand, remaining[0].seat);
}

function resolveDepartingShowChoice(room: OnlineRoomState): void {
  const hand = room.hand;
  if (room.phase !== "showdown" || !hand || hand.pendingShowSeat === null) return;
  const pendingWinner = seatByNumber(room, hand.pendingShowSeat);
  if (!pendingWinner?.pendingLeave) return;
  const player = playerBySeat(hand, pendingWinner.seat);
  if (player) player.shown = false;
  hand.pendingShowSeat = null;
  room.phase = "between_hands";
}

function transferOwnerOrCloseAbandonedRoom(room: OnlineRoomState): void {
  const remaining = room.seats
    .filter((seat) => !seat.pendingLeave)
    .sort((left, right) => left.seat - right.seat);
  if (!remaining.length) {
    room.seats = [];
    room.hand = null;
    room.phase = "closed";
    return;
  }
  if (!remaining.some((seat) => seat.accountId === room.ownerAccountId)) {
    room.ownerAccountId = remaining[0].accountId;
  }
}

function finalizePendingLeaves(room: OnlineRoomState): void {
  if (room.phase === "playing" || room.phase === "showdown") return;
  if (!room.seats.some((seat) => seat.pendingLeave)) return;

  room.seats = room.seats.filter((seat) => !seat.pendingLeave);
  if (!room.seats.length) {
    room.phase = "closed";
    room.hand = null;
    return;
  }

  if (!room.seats.some((seat) => seat.accountId === room.ownerAccountId)) {
    room.ownerAccountId = [...room.seats]
      .sort((left, right) => left.seat - right.seat)[0].accountId;
  }

  if (room.seats.length < ONLINE_MIN_PLAYERS) {
    room.phase = "lobby";
    // Keep a completed hand long enough for the remaining player to see its
    // result. A future join clears it before the lobby resumes.
    if (!room.hand?.result) room.hand = null;
    room.seats.forEach((seat) => { seat.ready = false; });
  }
}

function activeTurnKey(room: OnlineRoomState): string | null {
  const hand = room.hand;
  if (room.phase !== "playing" || !hand || hand.currentSeat === null) return null;
  return `${hand.id}:${hand.street}:${hand.currentSeat}`;
}

function synchronizeTurnClock(room: OnlineRoomState, previousTurnKey: string | null, now: number): void {
  const hand = room.hand;
  const nextTurnKey = activeTurnKey(room);
  if (!hand || nextTurnKey === null) {
    if (hand) {
      hand.actionStartedAt = null;
      hand.actionDeadlineAt = null;
    }
    return;
  }
  if (
    nextTurnKey !== previousTurnKey
    || typeof hand.actionStartedAt !== "number"
    || !Number.isFinite(hand.actionStartedAt)
    || typeof hand.actionDeadlineAt !== "number"
    || !Number.isFinite(hand.actionDeadlineAt)
  ) {
    hand.actionStartedAt = now;
    hand.actionDeadlineAt = now + room.actionTimeMs;
  }
}

function turnExpired(room: OnlineRoomState, now: number): boolean {
  return Boolean(
    room.phase === "playing"
    && room.hand?.currentSeat !== null
    && typeof room.hand?.actionDeadlineAt === "number"
    && Number.isFinite(room.hand.actionDeadlineAt)
    && now >= Number(room.hand?.actionDeadlineAt),
  );
}

function firstEmptySeat(room: OnlineRoomState): number | null {
  const occupied = new Set(room.seats.map((seat) => seat.seat));
  for (let seat = 0; seat < room.maxPlayers; seat += 1) {
    if (!occupied.has(seat)) return seat;
  }
  return null;
}

function validateCommand(command: OnlinePokerCommand): string | null {
  if (!command.commandId.trim()) return "commandId 不能为空";
  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 0) return "expectedRevision 必须是非负整数";
  return null;
}

function commandFingerprint(command: OnlinePokerCommand) {
  if (command.type === "join" || command.type === "start" || command.type === "leave") {
    return JSON.stringify([command.type, command.expectedRevision]);
  }
  if (command.type === "ready") {
    return JSON.stringify([command.type, command.expectedRevision, command.ready]);
  }
  if (command.type === "show") {
    return JSON.stringify([command.type, command.expectedRevision, command.handId, command.show]);
  }
  if (command.type === "use-time-bank" || command.type === "timeout") {
    return JSON.stringify([command.type, command.expectedRevision, command.handId]);
  }
  return JSON.stringify([
    command.type,
    command.expectedRevision,
    command.handId,
    command.action,
    command.raiseTo ?? null,
  ]);
}

export function applyOnlinePokerCommand(
  room: OnlineRoomState,
  actor: OnlineActor,
  command: OnlinePokerCommand,
  options: OnlineEngineOptions = {},
): OnlinePokerCommandResult {
  const invalid = validateCommand(command);
  if (invalid) return fail(room, "INVALID_COMMAND", invalid);
  assertNonEmpty(actor.accountId, "actor.accountId");
  assertNonEmpty(actor.displayName, "actor.displayName");

  const fingerprint = commandFingerprint(command);
  const existingReceipt = room.processedCommands.find((receipt) => receipt.commandId === command.commandId);
  if (existingReceipt) {
    if (existingReceipt.accountId !== actor.accountId || existingReceipt.fingerprint !== fingerprint) {
      return fail(room, "COMMAND_ID_CONFLICT", "该 commandId 已绑定到另一条命令");
    }
    return {
      ok: true,
      state: room,
      resultRevision: existingReceipt.resultRevision,
      duplicate: true,
    };
  }
  if (command.expectedRevision !== room.revision) {
    return fail(room, "STALE_REVISION", `状态已更新，当前 revision 为 ${room.revision}`);
  }

  const next = cloneRoom(room);
  normalizeStoredRoom(next);
  const commandNow = engineNow(options);
  const previousTurnKey = activeTurnKey(next);
  synchronizeTurnClock(next, previousTurnKey, commandNow);
  const member = next.seats.find((seat) => seat.accountId === actor.accountId);
  if (command.type === "join") {
    if (next.phase !== "lobby") return fail(room, "ROOM_NOT_JOINABLE", "牌局开始后不能加入");
    if (member) return fail(room, "ALREADY_JOINED", "你已经在这个房间");
    const seatNumber = firstEmptySeat(next);
    if (seatNumber === null) return fail(room, "ROOM_FULL", "房间已满");
    next.seats.push({
      seat: seatNumber,
      accountId: actor.accountId,
      displayName: actor.displayName,
      stack: next.startingStack,
      ready: false,
      timeBankMs: next.initialTimeBankMs,
      connected: true,
      disconnectedAt: null,
      pendingLeave: false,
    });
    next.seats.sort((left, right) => left.seat - right.seat);
    if (next.hand?.result) next.hand = null;
  } else if (!member) {
    return fail(room, "NOT_A_MEMBER", "你不在这个房间");
  } else if (command.type === "ready") {
    if (next.phase !== "lobby" && next.phase !== "between_hands") {
      return fail(room, "WRONG_PHASE", "当前不能改变准备状态");
    }
    member.ready = command.ready;
    const nextHandSeats = next.tableMode === "cash" ? next.seats : next.seats.filter((seat) => seat.stack > 0);
    if (next.phase === "between_hands" && nextHandSeats.length >= ONLINE_MIN_PLAYERS && nextHandSeats.every((seat) => seat.ready)) {
      beginHand(next, options);
    }
  } else if (command.type === "start") {
    if (next.phase !== "lobby") return fail(room, "WRONG_PHASE", "当前不能开始牌局");
    if (next.ownerAccountId !== actor.accountId) return fail(room, "NOT_ROOM_OWNER", "只有房主可以开局");
    if (next.seats.filter((seat) => seat.stack > 0).length < ONLINE_MIN_PLAYERS) {
      return fail(room, "NOT_ENOUGH_PLAYERS", "至少需要两名仍有筹码的玩家");
    }
    if (!next.seats.filter((seat) => seat.stack > 0).every((seat) => seat.ready)) {
      return fail(room, "PLAYERS_NOT_READY", "所有仍有筹码的玩家准备后才能开局");
    }
    beginHand(next, options);
  } else if (command.type === "act") {
    if (turnExpired(next, commandNow)) {
      return fail(room, "TIME_EXPIRED", "本次行动时间已经结束");
    }
    const actionError = applyAction(next, actor.accountId, command);
    if (actionError) return { ok: false, state: room, error: { ...actionError, revision: room.revision } };
  } else if (command.type === "use-time-bank") {
    const hand = next.hand;
    if (next.phase !== "playing" || !hand || hand.id !== command.handId) {
      return fail(room, hand && hand.id !== command.handId ? "WRONG_HAND" : "WRONG_PHASE", "当前不能使用时间牌");
    }
    if (hand.currentSeat !== member.seat) return fail(room, "NOT_YOUR_TURN", "只有当前行动玩家可以使用时间牌");
    if (turnExpired(next, commandNow)) return fail(room, "TIME_EXPIRED", "本次行动时间已经结束");
    if (member.timeBankMs <= 0) return fail(room, "TIME_BANK_EMPTY", "本局时间库已经用完");
    const addedTime = Math.min(next.actionTimeMs, member.timeBankMs);
    member.timeBankMs -= addedTime;
    hand.actionDeadlineAt = (hand.actionDeadlineAt ?? commandNow) + addedTime;
  } else if (command.type === "timeout") {
    const hand = next.hand;
    if (next.phase !== "playing" || !hand || hand.id !== command.handId || hand.currentSeat === null) {
      return fail(room, hand && hand.id !== command.handId ? "WRONG_HAND" : "WRONG_PHASE", "当前没有可结算的超时行动");
    }
    if (!turnExpired(next, commandNow)) return fail(room, "TIME_NOT_EXPIRED", "当前玩家仍有思考时间");
    const timedOutSeat = seatByNumber(next, hand.currentSeat);
    if (!timedOutSeat) return fail(room, "NOT_A_MEMBER", "当前行动座位不存在");
    const legal = legalOnlineActions(next, timedOutSeat.accountId);
    if (!legal) return fail(room, "NOT_YOUR_TURN", "当前没有可执行的超时行动");
    const timeoutAction: OnlineActionKind = legal.check ? "check" : "fold";
    const timeoutError = applyAction(next, timedOutSeat.accountId, {
      ...command,
      type: "act",
      action: timeoutAction,
    });
    if (timeoutError) return { ok: false, state: room, error: { ...timeoutError, revision: room.revision } };
  } else if (command.type === "show") {
    const hand = next.hand;
    if (next.phase !== "showdown" || !hand || hand.id !== command.handId) {
      return fail(room, hand && hand.id !== command.handId ? "WRONG_HAND" : "SHOW_NOT_ALLOWED", "当前不能亮牌或盖牌");
    }
    if (hand.pendingShowSeat !== member.seat) return fail(room, "SHOW_NOT_ALLOWED", "只有本手赢家可以选择亮牌");
    const player = playerBySeat(hand, member.seat);
    if (!player) return fail(room, "SHOW_NOT_ALLOWED", "找不到本手玩家");
    player.shown = command.show;
    hand.pendingShowSeat = null;
    next.phase = "between_hands";
  } else if (command.type === "leave") {
    member.pendingLeave = true;
    member.ready = false;
    member.connected = false;
    member.disconnectedAt = commandNow;
    forceFoldDepartingPlayer(next, member);
    transferOwnerOrCloseAbandonedRoom(next);
  }

  resolveDepartingShowChoice(next);
  finalizePendingLeaves(next);
  synchronizeTurnClock(next, previousTurnKey, commandNow);

  next.revision = room.revision + 1;
  next.processedCommands = [
    ...next.processedCommands,
    { commandId: command.commandId, accountId: actor.accountId, fingerprint, resultRevision: next.revision },
  ];
  return { ok: true, state: next, resultRevision: next.revision, duplicate: false };
}

export function setOnlinePlayerConnection(
  room: OnlineRoomState,
  accountId: string,
  connected: boolean,
  now = Date.now(),
): OnlineRoomState {
  const member = room.seats.find((seat) => seat.accountId === accountId);
  if (!member || member.connected === connected) return room;
  const next = cloneRoom(room);
  const nextMember = next.seats.find((seat) => seat.accountId === accountId);
  if (!nextMember) return room;
  nextMember.connected = connected;
  nextMember.disconnectedAt = connected ? null : now;
  next.revision += 1;
  return next;
}

export function projectRoomState(room: OnlineRoomState, viewerAccountId: string | null): OnlinePublicRoomState {
  const tableMode: OnlineTableMode = room.tableMode === "cash" ? "cash" : "tournament";
  const actionTimeMs = Number.isInteger(room.actionTimeMs) ? room.actionTimeMs : ONLINE_DEFAULT_ACTION_TIME_MS;
  const initialTimeBankMs = Number.isInteger(room.initialTimeBankMs) ? room.initialTimeBankMs : ONLINE_DEFAULT_TIME_BANK_MS;
  const viewerSeat = viewerAccountId === null
    ? null
    : room.seats.find((seat) => seat.accountId === viewerAccountId)?.seat ?? null;
  const hand = room.hand;
  const publicSeats = room.seats.map((seat): OnlinePublicSeat => {
    const player = hand ? playerBySeat(hand, seat.seat) : undefined;
    const maySeeHole = Boolean(player && (seat.accountId === viewerAccountId || player.shown));
    return {
      seat: seat.seat,
      displayName: seat.displayName,
      stack: seat.stack,
      ready: seat.ready,
      timeBankMs: Number.isInteger(seat.timeBankMs) ? seat.timeBankMs : initialTimeBankMs,
      connected: seat.connected,
      pendingLeave: seat.pendingLeave === true,
      folded: player?.folded ?? false,
      bet: player?.bet ?? 0,
      contributed: player?.contributed ?? 0,
      holeCardCount: player ? 2 : 0,
      holeCards: maySeeHole && player
        ? [cloneCard(player.hole[0]), cloneCard(player.hole[1])]
        : null,
      shown: player?.shown ?? false,
    };
  });
  return {
    roomId: room.roomId,
    ownerSeat: room.seats.find((seat) => seat.accountId === room.ownerAccountId)?.seat ?? null,
    maxPlayers: room.maxPlayers,
    phase: room.phase,
    revision: room.revision,
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    startingStack: room.startingStack,
    tableMode,
    actionTimeMs,
    initialTimeBankMs,
    timeBankUnitMs: actionTimeMs,
    viewerSeat,
    seats: publicSeats,
    hand: hand
      ? {
          id: hand.id,
          number: hand.number,
          street: hand.street,
          dealerSeat: hand.dealerSeat,
          smallBlindSeat: hand.smallBlindSeat,
          bigBlindSeat: hand.bigBlindSeat,
          currentSeat: hand.currentSeat,
          community: hand.community.map(cloneCard),
          pot: hand.pot,
          committedPot: committedPot(hand),
          highestBet: hand.highestBet,
          minRaise: hand.minRaise,
          lastAggressorSeat: hand.lastAggressorSeat,
          raiseCount: hand.raiseCount,
          result: hand.result
            ? {
                ...hand.result,
                winnerSeats: [...hand.result.winnerSeats],
                mainPotWinnerSeats: [...hand.result.mainPotWinnerSeats],
                payouts: hand.result.payouts.map((payout) => ({ ...payout })),
                returns: hand.result.returns.map((entry) => ({ ...entry })),
                handNames: hand.result.handNames.map((entry) => ({ ...entry })),
                winnerDetails: hand.result.winnerSeats.map((winnerSeat) => {
                  const winner = playerBySeat(hand, winnerSeat);
                  return {
                    seat: winnerSeat,
                    displayName: winner?.displayName
                      ?? room.seats.find((seat) => seat.seat === winnerSeat)?.displayName
                      ?? `座位 ${winnerSeat + 1}`,
                    holeCards: winner?.shown
                      ? [cloneCard(winner.hole[0]), cloneCard(winner.hole[1])]
                      : null,
                  };
                }),
              }
            : null,
          pendingShowSeat: hand.pendingShowSeat,
          actionStartedAt: typeof hand.actionStartedAt === "number" ? hand.actionStartedAt : null,
          actionDeadlineAt: typeof hand.actionDeadlineAt === "number" ? hand.actionDeadlineAt : null,
        }
      : null,
    legalActions: viewerAccountId === null ? null : legalOnlineActions(room, viewerAccountId),
  };
}
