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
/** Bounded replay window so a long-running room cannot grow state forever. */
export const ONLINE_COMMAND_RECEIPT_LIMIT = 2_048;
/** Shared server-side pause before any seated player may advance the table. */
export const ONLINE_NEXT_HAND_DELAY_MS = 4_000;
/** @deprecated Show or muck now shares the single next-hand waiting window. */
export const ONLINE_SHOW_DECISION_TIME_MS = ONLINE_NEXT_HAND_DELAY_MS;

export type OnlineCard = {
  rank: number;
  suit: string | number;
};
export type OnlineStreet = "preflop" | "flop" | "turn" | "river";
export type OnlineActionKind = "fold" | "check" | "call" | "raise";
export type OnlineRoomPhase = "lobby" | "playing" | "showdown" | "between_hands" | "finished" | "closed";
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
  /** Remains true after a full raise reopens action, unlike hasActed. */
  hasTakenAction: boolean;
  actedAtBet: number;
  raiseLocked: boolean;
  shown: boolean;
  /** Stack immediately before this hand posts blinds; authoritative for per-hand net. */
  stackAtHandStart: number;
  /** Per-hand flags keep frequency denominators idempotent across repeated actions. */
  voluntaryPutMoney: boolean;
  preflopRaised: boolean;
  sawFlop: boolean;
  wentAllIn: boolean;
};

type OnlineFullRaiseRecord = {
  seat: number;
  target: number;
  increment: number;
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
  /** Private full-raise history for restoring the legal minimum after an out-of-turn fold. */
  fullRaiseHistory: OnlineFullRaiseRecord[];
  /** Returns already credited during the hand, retained for the final result summary. */
  pendingReturns: OnlinePayout[];
  lastAggressorSeat: number | null;
  raiseCount: number;
  result: OnlineHandResult | null;
  pendingShowSeat: number | null;
  actionStartedAt: number | null;
  actionDeadlineAt: number | null;
  showDecisionDeadlineAt: number | null;
  nextHandAt: number | null;
  /** Distinguishes a consumed terminal wait from a newly settled hand awaiting its first clock sync. */
  betweenHandsWaitCompleted: boolean;
};

export type OnlineCommandReceipt = {
  commandId: string;
  accountId: string;
  fingerprint: string;
  resultRevision: number;
};

export type OnlineSessionPlayerStats = {
  accountId: string;
  displayName: string;
  seat: number;
  buyInTotal: number;
  rebuyCount: number;
  finalStack: number;
  left: boolean;
  handsDealt: number;
  handsWon: number;
  netChips: number;
  vpipHands: number;
  pfrHands: number;
  sawFlopHands: number;
  showdownHands: number;
  showdownWins: number;
  uncontestedWins: number;
  decisions: number;
  timeoutActions: number;
  foldActions: number;
  checkActions: number;
  callActions: number;
  raiseActions: number;
  postflopBetActions: number;
  postflopRaiseActions: number;
  postflopCallActions: number;
  postflopCheckActions: number;
  allInHands: number;
  voluntaryShows: number;
  biggestWin: number;
  /** Positive magnitude of the largest single-hand loss. */
  biggestLoss: number;
};

export type OnlineSessionState = {
  startedAt: number | null;
  finishedAt: number | null;
  finishRequestedByAccountId: string | null;
  handsCompleted: number;
  totalPotAwarded: number;
  lastCompletedHandId: string | null;
  players: OnlineSessionPlayerStats[];
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
  session: OnlineSessionState;
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
  | (CommandBase & { type: "finish" })
  | (CommandBase & { type: "restart" })
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
    /** Public-safe payout/return recipient details retained after a seat is released. */
    winnerDetails: {
      seat: number;
      displayName: string;
      holeCards: [OnlineCard, OnlineCard] | null;
    }[];
  }) | null;
  pendingShowSeat: number | null;
  actionStartedAt: number | null;
  actionDeadlineAt: number | null;
  showDecisionDeadlineAt: number | null;
  nextHandAt: number | null;
};

export type OnlineSessionSampleSize = "insufficient" | "developing" | "meaningful";

export type OnlinePublicSessionPlayerReport = {
  rank: number;
  seat: number;
  displayName: string;
  finalStack: number;
  buyInTotal: number;
  rebuyCount: number;
  left: boolean;
  handsDealt: number;
  handsWon: number;
  netChips: number;
  netBigBlinds: number;
  bbPer100: number;
  vpipPercent: number;
  pfrPercent: number;
  sawFlopPercent: number;
  aggressionFrequencyPercent: number;
  aggressionFactor: number | null;
  wentToShowdownPercent: number;
  wonAtShowdownPercent: number | null;
  allInHands: number;
  timeoutPercent: number;
  voluntaryShows: number;
  biggestWin: number;
  biggestLoss: number;
  decisions: number;
  foldActions: number;
  checkActions: number;
  callActions: number;
  raiseActions: number;
  sampleSize: OnlineSessionSampleSize;
  styleTags: string[];
  insights: string[];
};

export type OnlinePublicSessionReport = {
  startedAt: number | null;
  finishedAt: number;
  durationMs: number;
  handsCompleted: number;
  totalPotAwarded: number;
  bigBlind: number;
  players: OnlinePublicSessionPlayerReport[];
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
  finishRequested: boolean;
  sessionReport: OnlinePublicSessionReport | null;
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

function emptyOnlineSession(): OnlineSessionState {
  return {
    startedAt: null,
    finishedAt: null,
    finishRequestedByAccountId: null,
    handsCompleted: 0,
    totalPotAwarded: 0,
    lastCompletedHandId: null,
    players: [],
  };
}

function makeSessionPlayer(seat: OnlineSeatState, buyInTotal: number): OnlineSessionPlayerStats {
  return {
    accountId: seat.accountId,
    displayName: seat.displayName,
    seat: seat.seat,
    buyInTotal,
    rebuyCount: 0,
    finalStack: seat.stack,
    left: false,
    handsDealt: 0,
    handsWon: 0,
    netChips: 0,
    vpipHands: 0,
    pfrHands: 0,
    sawFlopHands: 0,
    showdownHands: 0,
    showdownWins: 0,
    uncontestedWins: 0,
    decisions: 0,
    timeoutActions: 0,
    foldActions: 0,
    checkActions: 0,
    callActions: 0,
    raiseActions: 0,
    postflopBetActions: 0,
    postflopRaiseActions: 0,
    postflopCallActions: 0,
    postflopCheckActions: 0,
    allInHands: 0,
    voluntaryShows: 0,
    biggestWin: 0,
    biggestLoss: 0,
  };
}

function ensureSessionPlayer(
  room: OnlineRoomState,
  seat: OnlineSeatState,
  initialBuyIn = room.startingStack,
): OnlineSessionPlayerStats {
  let stats = room.session.players.find((player) => player.accountId === seat.accountId);
  if (!stats) {
    stats = makeSessionPlayer(seat, Math.max(0, initialBuyIn));
    room.session.players.push(stats);
  }
  stats.displayName = seat.displayName;
  stats.seat = seat.seat;
  stats.finalStack = seat.stack;
  stats.left = seat.pendingLeave;
  return stats;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
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
          fullRaiseHistory: (room.hand.fullRaiseHistory ?? []).map((record) => ({ ...record })),
          pendingReturns: (room.hand.pendingReturns ?? []).map((entry) => ({ ...entry })),
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
    session: room.session
      ? {
          ...room.session,
          players: Array.isArray(room.session.players)
            ? room.session.players.map((player) => ({ ...player }))
            : [],
        }
      : emptyOnlineSession(),
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
  const bootstrapActiveLegacyHand = !room.session
    || !Array.isArray(room.session.players)
    || room.session.players.length === 0;
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
  if (!room.session || !Array.isArray(room.session.players)) {
    room.session = emptyOnlineSession();
  }
  room.session.startedAt = finiteTimestamp(room.session.startedAt);
  room.session.finishedAt = finiteTimestamp(room.session.finishedAt);
  room.session.finishRequestedByAccountId = typeof room.session.finishRequestedByAccountId === "string"
    && room.session.finishRequestedByAccountId.trim()
    ? room.session.finishRequestedByAccountId
    : null;
  room.session.handsCompleted = nonNegativeInteger(room.session.handsCompleted);
  room.session.totalPotAwarded = nonNegativeInteger(room.session.totalPotAwarded);
  room.session.lastCompletedHandId = typeof room.session.lastCompletedHandId === "string"
    && room.session.lastCompletedHandId.trim()
    ? room.session.lastCompletedHandId
    : null;
  room.session.players = room.session.players.filter((stats) => (
    stats
    && typeof stats.accountId === "string"
    && stats.accountId.trim()
    && Number.isInteger(stats.seat)
  )).map((stats) => {
    const liveSeat = room.seats.find((seat) => seat.accountId === stats.accountId);
    const normalized = makeSessionPlayer(liveSeat ?? {
      seat: stats.seat,
      accountId: stats.accountId,
      displayName: typeof stats.displayName === "string" && stats.displayName.trim()
        ? stats.displayName
        : `座位 ${stats.seat + 1}`,
      stack: nonNegativeInteger(stats.finalStack),
      ready: false,
      timeBankMs: room.initialTimeBankMs,
      connected: false,
      disconnectedAt: null,
      pendingLeave: true,
    }, nonNegativeInteger(stats.buyInTotal, room.startingStack));
    const counterKeys: (keyof OnlineSessionPlayerStats)[] = [
      "buyInTotal", "rebuyCount", "finalStack", "handsDealt", "handsWon", "vpipHands", "pfrHands",
      "sawFlopHands", "showdownHands", "showdownWins", "uncontestedWins", "decisions", "timeoutActions",
      "foldActions", "checkActions", "callActions", "raiseActions", "postflopBetActions",
      "postflopRaiseActions", "postflopCallActions", "postflopCheckActions", "allInHands",
      "voluntaryShows", "biggestWin", "biggestLoss",
    ];
    counterKeys.forEach((key) => {
      const value = stats[key];
      if (typeof value === "number") (normalized[key] as number) = nonNegativeInteger(value);
    });
    normalized.netChips = typeof stats.netChips === "number" && Number.isInteger(stats.netChips)
      ? stats.netChips
      : 0;
    normalized.left = liveSeat ? liveSeat.pendingLeave : stats.left === true;
    return normalized;
  });
  room.seats.forEach((seat) => ensureSessionPlayer(room, seat));
  room.hand?.players.forEach((player) => {
    if (typeof player.displayName !== "string" || !player.displayName.trim()) {
      player.displayName = room.seats.find((seat) => seat.seat === player.seat)?.displayName ?? `座位 ${player.seat + 1}`;
    }
    if (typeof player.hasTakenAction !== "boolean") {
      player.hasTakenAction = player.hasActed || player.actedAtBet > 0;
    }
    const liveSeat = room.seats.find((seat) => seat.seat === player.seat);
    if (!Number.isInteger(player.stackAtHandStart) || player.stackAtHandStart < 0) {
      // Active legacy hands can recover their starting stack exactly because
      // contributed excludes chips already returned. Completed legacy hands
      // deliberately start at the final stack so no historical result is invented.
      player.stackAtHandStart = room.hand?.result
        ? (liveSeat?.stack ?? 0)
        : (liveSeat?.stack ?? 0) + nonNegativeInteger(player.contributed);
    }
    player.voluntaryPutMoney = player.voluntaryPutMoney === true;
    player.preflopRaised = player.preflopRaised === true;
    player.sawFlop = player.sawFlop === true;
    player.wentAllIn = player.wentAllIn === true;
  });
  if (bootstrapActiveLegacyHand && room.hand && !room.hand.result) {
    room.hand.players.forEach((player) => {
      const stats = sessionStatsForHandPlayer(room, player);
      if (!stats) return;
      stats.handsDealt = Math.max(1, stats.handsDealt);
      if (room.hand && room.hand.community.length >= 3 && !player.folded) {
        player.sawFlop = true;
        stats.sawFlopHands = Math.max(1, stats.sawFlopHands);
      }
    });
  }
  if (room.hand) {
    room.hand.fullRaiseHistory = Array.isArray(room.hand.fullRaiseHistory)
      ? room.hand.fullRaiseHistory.filter((record) => (
          Number.isInteger(record?.seat)
          && Number.isInteger(record?.target)
          && record.target > 0
          && Number.isInteger(record?.increment)
          && record.increment > 0
        ))
      : [];
    room.hand.pendingReturns = Array.isArray(room.hand.pendingReturns)
      ? room.hand.pendingReturns.filter((entry) => (
          Number.isInteger(entry?.seat)
          && Number.isInteger(entry?.amount)
          && entry.amount > 0
        ))
      : [];
    // Missing keys identify states stored before server-owned phase clocks were
    // introduced. synchronizePhaseClocks expires those legacy waits on first
    // command so an abandoned old room cannot acquire a fresh permanent stall.
    if ("showDecisionDeadlineAt" in room.hand) {
      room.hand.showDecisionDeadlineAt = typeof room.hand.showDecisionDeadlineAt === "number"
        && Number.isFinite(room.hand.showDecisionDeadlineAt)
        ? room.hand.showDecisionDeadlineAt
        : null;
    }
    if ("nextHandAt" in room.hand) {
      room.hand.nextHandAt = typeof room.hand.nextHandAt === "number"
        && Number.isFinite(room.hand.nextHandAt)
        ? room.hand.nextHandAt
        : null;
    }
    room.hand.betweenHandsWaitCompleted = room.hand.betweenHandsWaitCompleted === true;
    // Pre-unified-clock rooms used a separate showdown phase for the optional
    // reveal. Keep their pending choice, but fold it into the normal hand pause.
    if (room.phase === "showdown" && room.hand.result) room.phase = "between_hands";
  }
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
    session: emptyOnlineSession(),
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

function sessionStatsForHandPlayer(
  room: OnlineRoomState,
  player: OnlineHandPlayerState,
): OnlineSessionPlayerStats | null {
  const seat = seatByNumber(room, player.seat);
  if (seat) return ensureSessionPlayer(room, seat, player.stackAtHandStart);
  return room.session.players.find((stats) => stats.accountId === player.accountId) ?? null;
}

function markPlayerAllIn(room: OnlineRoomState, player: OnlineHandPlayerState): void {
  if (player.wentAllIn || (seatByNumber(room, player.seat)?.stack ?? 0) > 0) return;
  player.wentAllIn = true;
  const stats = sessionStatsForHandPlayer(room, player);
  if (stats) stats.allInHands += 1;
}

function markPlayersSawFlop(room: OnlineRoomState, hand: OnlineHandState): void {
  hand.players.forEach((player) => {
    if (player.folded || player.sawFlop) return;
    player.sawFlop = true;
    const stats = sessionStatsForHandPlayer(room, player);
    if (stats) stats.sawFlopHands += 1;
  });
}

function recordAcceptedAction(
  room: OnlineRoomState,
  hand: OnlineHandState,
  player: OnlineHandPlayerState,
  action: OnlineActionKind,
  highestBetBefore: number,
  timedOut: boolean,
): void {
  const stats = sessionStatsForHandPlayer(room, player);
  if (!stats) return;
  stats.decisions += 1;
  if (timedOut) {
    stats.timeoutActions += 1;
  } else {
    if (action === "fold") stats.foldActions += 1;
    else if (action === "check") stats.checkActions += 1;
    else if (action === "call") stats.callActions += 1;
    else stats.raiseActions += 1;

    if (hand.street !== "preflop") {
      if (action === "check") stats.postflopCheckActions += 1;
      else if (action === "call") stats.postflopCallActions += 1;
      else if (action === "raise") {
        if (highestBetBefore === 0) stats.postflopBetActions += 1;
        else stats.postflopRaiseActions += 1;
      }
    }
  }

  if (hand.street === "preflop" && (action === "call" || action === "raise") && !player.voluntaryPutMoney) {
    player.voluntaryPutMoney = true;
    stats.vpipHands += 1;
  }
  if (hand.street === "preflop" && action === "raise" && !player.preflopRaised) {
    player.preflopRaised = true;
    stats.pfrHands += 1;
  }
  markPlayerAllIn(room, player);
}

function recordCompletedHand(room: OnlineRoomState, hand: OnlineHandState): void {
  if (!hand.result || room.session.lastCompletedHandId === hand.id) return;
  const payoutBySeat = new Map(hand.result.payouts.map((entry) => [entry.seat, entry.amount]));
  hand.players.forEach((player) => {
    const stats = sessionStatsForHandPlayer(room, player);
    if (!stats) return;
    const finalStack = seatByNumber(room, player.seat)?.stack ?? stats.finalStack;
    const net = finalStack - player.stackAtHandStart;
    const wonPot = (payoutBySeat.get(player.seat) ?? 0) > 0;
    stats.finalStack = finalStack;
    stats.netChips += net;
    stats.biggestWin = Math.max(stats.biggestWin, net);
    stats.biggestLoss = Math.max(stats.biggestLoss, -net);
    if (wonPot) stats.handsWon += 1;
    if (hand.result?.kind === "showdown" && !player.folded) {
      stats.showdownHands += 1;
      if (wonPot) stats.showdownWins += 1;
    } else if (hand.result?.kind === "uncontested" && wonPot) {
      stats.uncontestedWins += 1;
    }
  });
  room.session.handsCompleted += 1;
  room.session.totalPotAwarded += hand.result.totalPot;
  room.session.lastCompletedHandId = hand.id;
}

function beginHand(room: OnlineRoomState, options: OnlineEngineOptions): void {
  const handStartedAt = engineNow(options);
  if (room.session.startedAt === null) room.session.startedAt = handStartedAt;
  room.seats.forEach((seat) => ensureSessionPlayer(room, seat));
  if (room.tableMode === "cash" && room.hand) {
    room.seats.forEach((seat) => {
      if (seat.stack <= 0) {
        seat.stack = room.startingStack;
        const stats = ensureSessionPlayer(room, seat);
        stats.buyInTotal += room.startingStack;
        stats.rebuyCount += 1;
        stats.finalStack = seat.stack;
      }
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
    const stats = ensureSessionPlayer(room, seat);
    stats.handsDealt += 1;
    stats.finalStack = seat.stack;
    return {
      seat: seat.seat,
      accountId: seat.accountId,
      displayName: seat.displayName,
      hole: [cards[0], cards[1]],
      folded: false,
      bet: 0,
      contributed: 0,
      hasActed: false,
      hasTakenAction: false,
      actedAtBet: 0,
      raiseLocked: false,
      shown: false,
      stackAtHandStart: seat.stack,
      voluntaryPutMoney: false,
      preflopRaised: false,
      sawFlop: false,
      wentAllIn: false,
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
  players.forEach((player) => markPlayerAllIn(room, player));

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
  const actionStartedAt = currentSeat === null ? null : handStartedAt;
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
    fullRaiseHistory: [],
    pendingReturns: [],
    lastAggressorSeat: null,
    raiseCount: 0,
    result: null,
    pendingShowSeat: null,
    actionStartedAt,
    actionDeadlineAt: actionStartedAt === null ? null : actionStartedAt + room.actionTimeMs,
    showDecisionDeadlineAt: null,
    nextHandAt: null,
    betweenHandsWaitCompleted: false,
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
    markPlayersSawFlop(room, room.hand);
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

function addAmount(target: Map<number, number>, seat: number, amount: number) {
  if (amount <= 0) return;
  target.set(seat, (target.get(seat) ?? 0) + amount);
}

function payoutEntries(target: Map<number, number>): OnlinePayout[] {
  return [...target]
    .sort(([leftSeat], [rightSeat]) => leftSeat - rightSeat)
    .map(([seat, amount]) => ({ seat, amount }));
}

function collectBets(room: OnlineRoomState, hand: OnlineHandState) {
  hand.pot += hand.players.reduce((sum, player) => sum + player.bet, 0);
  hand.players.forEach((player) => {
    player.bet = 0;
    player.hasActed = false;
    player.hasTakenAction = false;
    player.actedAtBet = 0;
    player.raiseLocked = false;
  });
  hand.highestBet = 0;
  hand.minRaise = room.bigBlind;
  hand.fullRaiseHistory = [];
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
  const newlyCreditedReturns = new Map<number, number>();
  hand.pendingReturns.forEach((entry) => addAmount(returns, entry.seat, entry.amount));
  const handNames = new Map<number, string>();
  let previousLevel = 0;
  let mainPotWinners: number[] = [];

  for (const level of levels) {
    const contributors = hand.players.filter((player) => player.contributed >= level);
    const layerAmount = (level - previousLevel) * contributors.length;
    previousLevel = level;
    if (contributors.length === 1) {
      const returningSeat = contributors[0].seat;
      addAmount(returns, returningSeat, layerAmount);
      addAmount(newlyCreditedReturns, returningSeat, layerAmount);
      continue;
    }
    const directEligible = contributors.filter((player) => !player.folded);
    // Forced out-of-turn departures can leave a historical side-pot layer with
    // no live contributor. Folded hands can never win: treat that layer as dead
    // money contested by every hand that is still live.
    const eligible = directEligible.length
      ? directEligible
      : hand.players.filter((player) => !player.folded);
    if (layerAmount <= 0) continue;
    if (!eligible.length) {
      throw new Error("底池没有仍持牌的玩家");
    }
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
      addAmount(payouts, seatNumber, amount);
    });
  }

  payouts.forEach((amount, seatNumber) => {
    const seat = seatByNumber(room, seatNumber);
    if (!seat) throw new Error("结算座位不存在");
    seat.stack += amount;
  });
  newlyCreditedReturns.forEach((amount, seatNumber) => {
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
    returns: payoutEntries(returns),
    handNames: [...handNames].map(([seat, name]) => ({ seat, name })),
  };
  recordCompletedHand(room, hand);
  hand.pendingShowSeat = null;
  room.seats.forEach((seat) => { seat.ready = false; });
  room.phase = "between_hands";
}

function awardUncontested(room: OnlineRoomState, hand: OnlineHandState, winnerSeat: number) {
  const winner = seatByNumber(room, winnerSeat);
  if (!winner) throw new Error("赢家座位不存在");
  const winnerPlayer = playerBySeat(hand, winnerSeat);
  if (!winnerPlayer) throw new Error("赢家不在本手牌中");

  const levels = [...new Set(hand.players.filter((player) => player.contributed > 0).map((player) => player.contributed))]
    .sort((left, right) => left - right);
  const payouts = new Map<number, number>();
  const returns = new Map<number, number>();
  const newlyCreditedReturns = new Map<number, number>();
  hand.pendingReturns.forEach((entry) => addAmount(returns, entry.seat, entry.amount));
  let previousLevel = 0;
  let mainPotWinners: number[] = [];

  for (const level of levels) {
    const contributors = hand.players.filter((player) => player.contributed >= level);
    const layerAmount = (level - previousLevel) * contributors.length;
    previousLevel = level;
    if (layerAmount <= 0) continue;
    if (contributors.length === 1) {
      addAmount(returns, contributors[0].seat, layerAmount);
      addAmount(newlyCreditedReturns, contributors[0].seat, layerAmount);
      continue;
    }
    const layerWinner = contributors.find((player) => !player.folded) ?? winnerPlayer;
    addAmount(payouts, layerWinner.seat, layerAmount);
    if (!mainPotWinners.length) mainPotWinners = [layerWinner.seat];
  }

  payouts.forEach((amount, seatNumber) => {
    const receivingSeat = seatByNumber(room, seatNumber);
    if (!receivingSeat) throw new Error("结算座位不存在");
    receivingSeat.stack += amount;
  });
  newlyCreditedReturns.forEach((amount, seatNumber) => {
    const returningSeat = seatByNumber(room, seatNumber);
    if (!returningSeat) throw new Error("退回筹码的座位不存在");
    returningSeat.stack += amount;
  });
  const totalPot = [...payouts.values()].reduce((sum, amount) => sum + amount, 0);
  hand.players.forEach((player) => { player.bet = 0; });
  hand.pot = 0;
  hand.currentSeat = null;
  hand.result = {
    kind: "uncontested",
    totalPot,
    winnerSeats: [...payouts.keys()],
    mainPotWinnerSeats: mainPotWinners.length ? mainPotWinners : [winnerSeat],
    payouts: payoutEntries(payouts),
    returns: payoutEntries(returns),
    handNames: [],
  };
  recordCompletedHand(room, hand);
  hand.pendingShowSeat = winnerSeat;
  room.seats.forEach((seat) => { seat.ready = false; });
  room.phase = "between_hands";
}

function dealNextStreet(room: OnlineRoomState, hand: OnlineHandState) {
  collectBets(room, hand);
  if (hand.street === "river") {
    settleShowdown(room, hand);
    return;
  }
  if (hand.street === "preflop") {
    hand.community.push(takeCard(hand.deck), takeCard(hand.deck), takeCard(hand.deck));
    hand.street = "flop";
    markPlayersSawFlop(room, hand);
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

function markPlayerFolded(hand: OnlineHandState, player: OnlineHandPlayerState, actedAtBet: number) {
  player.folded = true;
  player.hasActed = true;
  player.hasTakenAction = true;
  player.actedAtBet = actedAtBet;
  player.raiseLocked = false;
}

function rememberPendingReturn(hand: OnlineHandState, seat: number, amount: number) {
  if (amount <= 0) return;
  const existing = hand.pendingReturns.find((entry) => entry.seat === seat);
  if (existing) existing.amount += amount;
  else hand.pendingReturns.push({ seat, amount });
}

function normalizeBettingAfterFold(room: OnlineRoomState, hand: OnlineHandState) {
  const fundedActors = activeActorSeats(room, hand);
  const actualLiveHighest = Math.max(0, ...hand.players
    .filter((player) => !player.folded)
    .map((player) => player.bet));
  const liveBettingFloor = hand.street === "preflop" && fundedActors.length >= 2
    ? Math.max(actualLiveHighest, room.bigBlind)
    : actualLiveHighest;

  // Only a unique top tranche is uncalled. Matched chips from players who all
  // departed remain dead money for the live hands to contest at settlement.
  while (true) {
    const ordered = [...hand.players].sort((left, right) => right.bet - left.bet);
    const highest = ordered[0];
    if (!highest || highest.bet <= 0 || !highest.folded) break;
    const peersAtHighest = ordered.filter((player) => player.bet === highest.bet);
    if (peersAtHighest.length !== 1) break;
    const nextLevel = Math.max(liveBettingFloor, ordered[1]?.bet ?? 0);
    const amount = highest.bet - nextLevel;
    if (amount <= 0) break;
    const seat = seatByNumber(room, highest.seat);
    if (!seat) throw new Error("退回筹码的座位不存在");
    highest.bet -= amount;
    highest.contributed -= amount;
    seat.stack += amount;
    rememberPendingReturn(hand, highest.seat, amount);
  }

  const previousHighest = hand.highestBet;
  hand.highestBet = liveBettingFloor;
  if (hand.highestBet < previousHighest) {
    hand.fullRaiseHistory = hand.fullRaiseHistory.filter((record) => record.target <= hand.highestBet);
    const lastFullRaise = hand.fullRaiseHistory.at(-1) ?? null;
    hand.minRaise = lastFullRaise?.increment ?? room.bigBlind;
    hand.lastAggressorSeat = lastFullRaise?.seat ?? null;
    hand.raiseCount = hand.fullRaiseHistory.length;
    hand.players.forEach((player) => {
      if (player.folded || (seatByNumber(room, player.seat)?.stack ?? 0) <= 0) return;
      if (player.hasTakenAction && player.actedAtBet >= hand.highestBet) {
        player.hasActed = true;
        player.raiseLocked = false;
      } else if (player.hasActed) {
        player.raiseLocked = hand.highestBet - player.actedAtBet < hand.minRaise;
      } else {
        player.raiseLocked = false;
      }
    });
  }
}

function closeHandOrStreetIfReady(room: OnlineRoomState, hand: OnlineHandState): boolean {
  const remaining = hand.players.filter((player) => !player.folded);
  if (remaining.length === 1) {
    awardUncontested(room, hand, remaining[0].seat);
    return true;
  }
  const actors = activeActorSeats(room, hand);
  const soleActor = actors.length === 1 ? playerBySeat(hand, actors[0]) : null;
  if (actors.length === 0 || (
    soleActor
    && soleActor.bet >= betToMatchForActor(room, hand, soleActor.seat)
  )) {
    dealNextStreet(room, hand);
    return true;
  }
  if (bettingRoundComplete(room, hand)) {
    dealNextStreet(room, hand);
    return true;
  }
  return false;
}

function finishAction(room: OnlineRoomState, hand: OnlineHandState, actingSeat: number) {
  if (closeHandOrStreetIfReady(room, hand)) return;
  hand.currentSeat = nextActorSeat(room, hand, actingSeat);
  if (hand.currentSeat === null) dealNextStreet(room, hand);
}

function applyAction(
  room: OnlineRoomState,
  accountId: string,
  command: Extract<OnlinePokerCommand, { type: "act" }>,
  timedOut = false,
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
  const highestBetBefore = hand.highestBet;

  if (command.action === "fold") {
    markPlayerFolded(hand, player, betToMatch);
    normalizeBettingAfterFold(room, hand);
  } else if (command.action === "check") {
    if (toCall !== 0) {
      return { code: "CALL_REQUIRED", message: "面对下注时不能过牌", revision: room.revision };
    }
    player.hasActed = true;
    player.hasTakenAction = true;
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
    player.hasTakenAction = true;
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
    player.hasTakenAction = true;
    player.actedAtBet = target;
    player.raiseLocked = false;
    hand.highestBet = target;
    hand.lastAggressorSeat = seat.seat;
    hand.raiseCount += 1;
    const fullRaise = increase >= hand.minRaise;
    if (fullRaise) {
      hand.minRaise = increase;
      hand.fullRaiseHistory.push({ seat: seat.seat, target, increment: increase });
    }
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

  recordAcceptedAction(room, hand, player, command.action, highestBetBefore, timedOut);
  finishAction(room, hand, seat.seat);
  return null;
}

function forceFoldDepartingPlayer(room: OnlineRoomState, seat: OnlineSeatState): void {
  const hand = room.hand;
  if (room.phase !== "playing" || !hand) return;
  const player = playerBySeat(hand, seat.seat);
  if (!player || player.folded || seat.stack <= 0) return;

  const wasCurrentSeat = hand.currentSeat === seat.seat;
  markPlayerFolded(hand, player, betToMatchForActor(room, hand, seat.seat));
  normalizeBettingAfterFold(room, hand);
  if (closeHandOrStreetIfReady(room, hand)) return;

  // An out-of-turn departure must not skip the player whose decision was
  // already pending. Only advance when the departing player owned the turn.
  if (wasCurrentSeat) {
    hand.currentSeat = nextActorSeat(room, hand, seat.seat);
    if (hand.currentSeat === null) dealNextStreet(room, hand);
  }
}

function muckPendingShowChoice(room: OnlineRoomState): void {
  const hand = room.hand;
  if (!hand || hand.pendingShowSeat === null) return;
  const player = playerBySeat(hand, hand.pendingShowSeat);
  if (player) player.shown = false;
  hand.pendingShowSeat = null;
  hand.showDecisionDeadlineAt = null;
}

function completeBetweenHandsWait(room: OnlineRoomState): void {
  const hand = room.hand;
  if (!hand?.result) return;
  muckPendingShowChoice(room);
  hand.nextHandAt = null;
  hand.betweenHandsWaitCompleted = true;
}

function resolveDepartingShowChoice(room: OnlineRoomState): void {
  const hand = room.hand;
  if (
    (room.phase !== "between_hands" && room.phase !== "showdown")
    || !hand
    || hand.pendingShowSeat === null
  ) return;
  const pendingWinner = seatByNumber(room, hand.pendingShowSeat);
  if (!pendingWinner?.pendingLeave) return;
  muckPendingShowChoice(room);
}

function finishOnlineSession(room: OnlineRoomState, now: number): void {
  if (room.phase === "finished") return;
  if (room.session.startedAt === null) room.session.startedAt = now;
  room.session.finishedAt = now;
  room.session.finishRequestedByAccountId = null;
  room.seats.forEach((seat) => {
    const stats = ensureSessionPlayer(room, seat);
    stats.finalStack = seat.stack;
    stats.left = seat.pendingLeave;
    seat.ready = false;
  });
  if (room.hand) {
    muckPendingShowChoice(room);
    room.hand.currentSeat = null;
    room.hand.actionStartedAt = null;
    room.hand.actionDeadlineAt = null;
    room.hand.showDecisionDeadlineAt = null;
    room.hand.nextHandAt = null;
    room.hand.betweenHandsWaitCompleted = true;
  }
  room.phase = "finished";
}

function resolveFinishRequest(room: OnlineRoomState, now: number): void {
  if (!room.session.finishRequestedByAccountId || room.phase === "finished" || room.phase === "closed") return;
  if (room.phase === "playing") return;
  if (room.phase === "between_hands" && room.hand?.result) {
    if (!room.hand.betweenHandsWaitCompleted && !nextHandWindowOpen(room, now)) return;
    completeBetweenHandsWait(room);
  }
  finishOnlineSession(room, now);
}

function restartOnlineSession(room: OnlineRoomState): void {
  room.phase = "lobby";
  room.hand = null;
  room.lastDealerSeat = null;
  room.session = emptyOnlineSession();
  room.seats.forEach((seat) => {
    seat.stack = room.startingStack;
    seat.ready = false;
    seat.timeBankMs = room.initialTimeBankMs;
    seat.pendingLeave = false;
  });
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
  if (room.seats.some((seat) => seat.pendingLeave)) {
    room.seats = room.seats.filter((seat) => !seat.pendingLeave);
  }
  if (!room.seats.length) {
    room.phase = "closed";
    room.hand = null;
    return;
  }

  if (!room.seats.some((seat) => seat.accountId === room.ownerAccountId)) {
    room.ownerAccountId = [...room.seats]
      .sort((left, right) => left.seat - right.seat)[0].accountId;
  }

  const preservingSharedWait = room.phase === "between_hands"
    && Boolean(room.hand?.result)
    && room.hand?.betweenHandsWaitCompleted !== true;
  if (room.phase !== "finished" && room.seats.length < ONLINE_MIN_PLAYERS && !preservingSharedWait) {
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

function synchronizePhaseClocks(room: OnlineRoomState, now: number): void {
  const hand = room.hand;
  if (!hand) return;
  // Be defensive when this helper receives an un-normalized legacy room.
  if (room.phase === "showdown" && hand.result) room.phase = "between_hands";
  if (room.phase === "between_hands" && hand.result) {
    if (hand.betweenHandsWaitCompleted) {
      muckPendingShowChoice(room);
      hand.nextHandAt = null;
      hand.showDecisionDeadlineAt = null;
      return;
    }
    const hadNextHandClock = Object.prototype.hasOwnProperty.call(hand, "nextHandAt");
    const legacyShowDeadline = typeof hand.showDecisionDeadlineAt === "number"
      && Number.isFinite(hand.showDecisionDeadlineAt)
      ? hand.showDecisionDeadlineAt
      : null;
    if (!hadNextHandClock) {
      hand.nextHandAt = now;
    }
    if (typeof hand.nextHandAt !== "number" || !Number.isFinite(hand.nextHandAt)) {
      hand.nextHandAt = legacyShowDeadline ?? now + ONLINE_NEXT_HAND_DELAY_MS;
    }
    // A room stored by the former two-stage clock may still carry an eight
    // second reveal deadline. Never let migration extend the unified pause.
    hand.nextHandAt = Math.min(hand.nextHandAt, now + ONLINE_NEXT_HAND_DELAY_MS);
    hand.showDecisionDeadlineAt = hand.pendingShowSeat === null ? null : hand.nextHandAt;
    return;
  }
  hand.showDecisionDeadlineAt = null;
  hand.nextHandAt = null;
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

function showDecisionExpired(room: OnlineRoomState, now: number): boolean {
  return Boolean(
    room.phase === "between_hands"
    && room.hand?.pendingShowSeat !== null
    && typeof room.hand?.nextHandAt === "number"
    && Number.isFinite(room.hand.nextHandAt)
    && now >= Number(room.hand.nextHandAt),
  );
}

function nextHandWindowOpen(room: OnlineRoomState, now: number): boolean {
  return Boolean(
    room.phase === "between_hands"
    && room.hand?.result
    && typeof room.hand?.nextHandAt === "number"
    && Number.isFinite(room.hand.nextHandAt)
    && now >= Number(room.hand.nextHandAt),
  );
}

function nextHandSeats(room: OnlineRoomState): OnlineSeatState[] {
  const presentSeats = room.seats.filter((seat) => !seat.pendingLeave);
  return room.tableMode === "cash"
    ? presentSeats
    : presentSeats.filter((seat) => seat.stack > 0);
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
  if (
    command.type === "join"
    || command.type === "start"
    || command.type === "finish"
    || command.type === "restart"
    || command.type === "leave"
  ) {
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

  const commandNow = engineNow(options);
  const next = cloneRoom(room);
  normalizeStoredRoom(next);
  const previousTurnKey = activeTurnKey(next);
  synchronizeTurnClock(next, previousTurnKey, commandNow);
  synchronizePhaseClocks(next, commandNow);
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
  } else if (command.type === "finish") {
    if (next.ownerAccountId !== actor.accountId) return fail(room, "NOT_ROOM_OWNER", "只有房主可以结束整局");
    if (next.phase === "finished" || next.phase === "closed") {
      return fail(room, "WRONG_PHASE", "本局已经结束");
    }
    next.session.finishRequestedByAccountId = actor.accountId;
    if (next.phase === "lobby") {
      finishOnlineSession(next, commandNow);
    }
  } else if (command.type === "restart") {
    if (next.ownerAccountId !== actor.accountId) return fail(room, "NOT_ROOM_OWNER", "只有房主可以重新开局");
    if (next.phase !== "finished") return fail(room, "WRONG_PHASE", "只能在整局结算后重新开局");
    restartOnlineSession(next);
  } else if (command.type === "ready") {
    if (next.phase !== "lobby" && next.phase !== "between_hands") {
      return fail(room, "WRONG_PHASE", "当前不能改变准备状态");
    }
    member.ready = command.ready;
    const eligibleSeats = nextHandSeats(next);
    if (
      next.phase === "between_hands"
      && eligibleSeats.length >= ONLINE_MIN_PLAYERS
      && !next.session.finishRequestedByAccountId
      && (eligibleSeats.every((seat) => seat.ready) || (command.ready && nextHandWindowOpen(next, commandNow)))
    ) {
      // Readying early explicitly gives up an outstanding optional reveal;
      // the old hand must never carry a private pending choice into a new deal.
      completeBetweenHandsWait(next);
      finalizePendingLeaves(next);
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
    if (!hand || hand.id !== command.handId) {
      return fail(room, hand && hand.id !== command.handId ? "WRONG_HAND" : "WRONG_PHASE", "当前没有可结算的超时行动");
    }
    if (next.phase === "playing" && hand.currentSeat !== null) {
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
      }, true);
      if (timeoutError) return { ok: false, state: room, error: { ...timeoutError, revision: room.revision } };
    } else if (next.phase === "between_hands" && hand.result) {
      if (!nextHandWindowOpen(next, commandNow)) {
        return fail(room, "TIME_NOT_EXPIRED", "下一手的统一等待时间尚未结束");
      } else {
        completeBetweenHandsWait(next);
        if (!next.session.finishRequestedByAccountId) {
          finalizePendingLeaves(next);
          const eligibleSeats = nextHandSeats(next);
          if (next.phase === "between_hands" && eligibleSeats.length >= ONLINE_MIN_PLAYERS) {
            beginHand(next, options);
          }
        }
      }
    } else {
      return fail(room, "WRONG_PHASE", "当前没有可结算的超时行动");
    }
  } else if (command.type === "show") {
    const hand = next.hand;
    if (next.phase !== "between_hands" || !hand || hand.id !== command.handId) {
      return fail(room, hand && hand.id !== command.handId ? "WRONG_HAND" : "SHOW_NOT_ALLOWED", "当前不能亮牌或盖牌");
    }
    if (hand.pendingShowSeat !== member.seat) return fail(room, "SHOW_NOT_ALLOWED", "只有本手赢家可以选择亮牌");
    if (showDecisionExpired(next, commandNow)) return fail(room, "TIME_EXPIRED", "亮牌选择时间已经结束");
    const player = playerBySeat(hand, member.seat);
    if (!player) return fail(room, "SHOW_NOT_ALLOWED", "找不到本手玩家");
    player.shown = command.show;
    if (command.show) {
      const stats = sessionStatsForHandPlayer(next, player);
      if (stats) stats.voluntaryShows += 1;
    }
    hand.pendingShowSeat = null;
    hand.showDecisionDeadlineAt = null;
  } else if (command.type === "leave") {
    if (next.phase !== "finished") {
      const stats = ensureSessionPlayer(next, member);
      stats.left = true;
    }
    member.pendingLeave = true;
    member.ready = false;
    member.connected = false;
    member.disconnectedAt = commandNow;
    forceFoldDepartingPlayer(next, member);
    transferOwnerOrCloseAbandonedRoom(next);
  }

  resolveDepartingShowChoice(next);
  // Settlement happens inside act/leave commands. Install the one shared
  // result/reveal clock before deciding whether a queued session finish may run.
  synchronizePhaseClocks(next, commandNow);
  resolveFinishRequest(next, commandNow);
  finalizePendingLeaves(next);
  synchronizeTurnClock(next, previousTurnKey, commandNow);
  synchronizePhaseClocks(next, commandNow);

  next.revision = room.revision + 1;
  next.processedCommands = [
    ...next.processedCommands,
    { commandId: command.commandId, accountId: actor.accountId, fingerprint, resultRevision: next.revision },
  ].slice(-ONLINE_COMMAND_RECEIPT_LIMIT);
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
  normalizeStoredRoom(next);
  synchronizePhaseClocks(next, Math.floor(now));
  const nextMember = next.seats.find((seat) => seat.accountId === accountId);
  if (!nextMember) return room;
  nextMember.connected = connected;
  nextMember.disconnectedAt = connected ? null : now;
  next.revision += 1;
  return next;
}

function rounded(value: number, digits = 1): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? rounded((numerator / denominator) * 100) : 0;
}

function sessionSampleSize(hands: number): OnlineSessionSampleSize {
  if (hands < 20) return "insufficient";
  if (hands < 100) return "developing";
  return "meaningful";
}

function playerStyleTags(
  stats: OnlineSessionPlayerStats,
  vpipPercent: number,
  pfrPercent: number,
  aggressionFrequencyPercent: number,
  timeoutPercent: number,
): string[] {
  if (stats.handsDealt < 20) return ["样本积累中"];
  const tags: string[] = [];
  if (vpipPercent >= 32) tags.push("入池偏宽");
  else if (vpipPercent <= 18) tags.push("入池偏紧");
  else tags.push("入池相对均衡");
  if (vpipPercent - pfrPercent >= 12) tags.push("跟注占比较高");
  else if (pfrPercent >= vpipPercent - 5) tags.push("主动入池");
  if (aggressionFrequencyPercent >= 50) tags.push("翻后积极");
  else if (aggressionFrequencyPercent <= 25) tags.push("翻后克制");
  else tags.push("翻后攻守均衡");
  if (timeoutPercent >= 10) tags.push("时间管理待改善");
  return tags;
}

function playerInsights(
  stats: OnlineSessionPlayerStats,
  vpipPercent: number,
  pfrPercent: number,
  aggressionFrequencyPercent: number,
  wentToShowdownPercent: number,
  timeoutPercent: number,
  bigBlind: number,
): string[] {
  const netBb = bigBlind > 0 ? rounded(stats.netChips / bigBlind) : 0;
  const insights = [`本局净收益 ${stats.netChips >= 0 ? "+" : ""}${stats.netChips}（${netBb >= 0 ? "+" : ""}${netBb} BB）。`];
  if (stats.handsDealt < 20) {
    insights.push(`目前只有 ${stats.handsDealt} 手，样本不足以判断稳定风格；频率仅描述本局实际行动。`);
  } else if (stats.handsDealt < 100) {
    insights.push(`当前 ${stats.handsDealt} 手属于发展中样本，短期牌运仍会显著影响结果。`);
  } else {
    insights.push(`已累计 ${stats.handsDealt} 手，可用于观察本局趋势，但仍不能替代逐手求解器分析。`);
  }
  insights.push(`翻牌前 VPIP ${vpipPercent}% / PFR ${pfrPercent}%；翻后主动行动频率 ${aggressionFrequencyPercent}%。`);
  if (stats.sawFlopHands > 0) insights.push(`看到翻牌后有 ${wentToShowdownPercent}% 进入摊牌。`);
  if (stats.timeoutActions > 0) insights.push(`共有 ${stats.timeoutActions} 次超时，占全部决策 ${timeoutPercent}%。`);
  return insights;
}

function projectSessionReport(room: OnlineRoomState): OnlinePublicSessionReport | null {
  const session = room.session;
  if (room.phase !== "finished" || !session || session.finishedAt === null) return null;
  const ranked = [...session.players].sort((left, right) => (
    right.netChips - left.netChips
    || right.finalStack - left.finalStack
    || left.seat - right.seat
  ));
  return {
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    durationMs: session.startedAt === null ? 0 : Math.max(0, session.finishedAt - session.startedAt),
    handsCompleted: session.handsCompleted,
    totalPotAwarded: session.totalPotAwarded,
    bigBlind: room.bigBlind,
    players: ranked.map((stats, index): OnlinePublicSessionPlayerReport => {
      const aggressiveActions = stats.postflopBetActions + stats.postflopRaiseActions;
      const aggressionFrequencyDenominator = aggressiveActions
        + stats.postflopCallActions
        + stats.postflopCheckActions;
      const vpipPercent = percentage(stats.vpipHands, stats.handsDealt);
      const pfrPercent = percentage(stats.pfrHands, stats.handsDealt);
      const aggressionFrequencyPercent = percentage(aggressiveActions, aggressionFrequencyDenominator);
      const wentToShowdownPercent = percentage(stats.showdownHands, stats.sawFlopHands);
      const timeoutPercent = percentage(stats.timeoutActions, stats.decisions);
      return {
        rank: index + 1,
        seat: stats.seat,
        displayName: stats.displayName,
        finalStack: stats.finalStack,
        buyInTotal: stats.buyInTotal,
        rebuyCount: stats.rebuyCount,
        left: stats.left,
        handsDealt: stats.handsDealt,
        handsWon: stats.handsWon,
        netChips: stats.netChips,
        netBigBlinds: room.bigBlind > 0 ? rounded(stats.netChips / room.bigBlind) : 0,
        bbPer100: stats.handsDealt > 0 && room.bigBlind > 0
          ? rounded((stats.netChips / room.bigBlind / stats.handsDealt) * 100)
          : 0,
        vpipPercent,
        pfrPercent,
        sawFlopPercent: percentage(stats.sawFlopHands, stats.handsDealt),
        aggressionFrequencyPercent,
        aggressionFactor: stats.postflopCallActions > 0
          ? rounded(aggressiveActions / stats.postflopCallActions, 2)
          : null,
        wentToShowdownPercent,
        wonAtShowdownPercent: stats.showdownHands > 0
          ? percentage(stats.showdownWins, stats.showdownHands)
          : null,
        allInHands: stats.allInHands,
        timeoutPercent,
        voluntaryShows: stats.voluntaryShows,
        biggestWin: stats.biggestWin,
        biggestLoss: stats.biggestLoss,
        decisions: stats.decisions,
        foldActions: stats.foldActions,
        checkActions: stats.checkActions,
        callActions: stats.callActions,
        raiseActions: stats.raiseActions,
        sampleSize: sessionSampleSize(stats.handsDealt),
        styleTags: playerStyleTags(stats, vpipPercent, pfrPercent, aggressionFrequencyPercent, timeoutPercent),
        insights: playerInsights(
          stats,
          vpipPercent,
          pfrPercent,
          aggressionFrequencyPercent,
          wentToShowdownPercent,
          timeoutPercent,
          room.bigBlind,
        ),
      };
    }),
  };
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
                winnerDetails: [...new Set([
                  ...hand.result.winnerSeats,
                  ...hand.result.returns.map((entry) => entry.seat),
                ])].map((recipientSeat) => {
                  const winner = playerBySeat(hand, recipientSeat);
                  return {
                    seat: recipientSeat,
                    displayName: winner?.displayName
                      ?? room.seats.find((seat) => seat.seat === recipientSeat)?.displayName
                      ?? `座位 ${recipientSeat + 1}`,
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
          showDecisionDeadlineAt: typeof hand.showDecisionDeadlineAt === "number"
            ? hand.showDecisionDeadlineAt
            : null,
          nextHandAt: typeof hand.nextHandAt === "number" ? hand.nextHandAt : null,
        }
      : null,
    legalActions: viewerAccountId === null ? null : legalOnlineActions(room, viewerAccountId),
    finishRequested: room.phase !== "finished" && Boolean(room.session?.finishRequestedByAccountId),
    sessionReport: projectSessionReport(room),
  };
}
