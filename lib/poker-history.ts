export const POKER_HAND_HISTORY_LIMIT = 30;
export const POKER_HAND_HISTORY_STORAGE_KEY = "rangecraft.solo-hand-history.v1";

export type PokerHistorySuit = "♠" | "♥" | "♦" | "♣";
export type PokerHistoryStreet = "preflop" | "flop" | "turn" | "river";
export type PokerHistoryActionKind = "fold" | "check" | "call" | "raise";
export type PokerHistoryMode = "per_hand" | "session" | "endless";
export type PokerHistoryPreset = "short" | "standard" | "deep" | "squid";

export type PokerHistoryCard = {
  rank: number;
  suit: PokerHistorySuit;
};

export type PokerHistoryPlayer = {
  id: number;
  name: string;
  monogram: string;
  hole: PokerHistoryCard[];
  /** Exact stack before this hand posted blinds. Added in v1 records defensively. */
  startingStack?: number;
  folded: boolean;
  contributed: number;
  stack: number;
  isHuman: boolean;
};

export type PokerHistoryAction = {
  playerId: number;
  street: PokerHistoryStreet;
  kind: PokerHistoryActionKind;
  amount: number;
  toCall: number;
  stackBefore: number;
  potBefore: number;
  isAllIn: boolean;
  description: string;
};

export type PokerHandHistoryEntry = {
  id: string;
  runId: string;
  hand: number;
  completedAt: number;
  mode: PokerHistoryMode;
  presetKey: PokerHistoryPreset;
  result: string;
  finalStreet: PokerHistoryStreet;
  totalPot: number;
  board: PokerHistoryCard[];
  dealer: number;
  winnerIds: number[];
  mainPotWinnerIds: number[];
  payouts: Array<{ playerId: number; amount: number }>;
  returns: Array<{ playerId: number; amount: number }>;
  players: PokerHistoryPlayer[];
  actions: PokerHistoryAction[];
  /** Chronological, oldest event first. */
  log: string[];
};

export type PokerReplayEvent = {
  id: string;
  kind: "deal" | "action" | "result";
  street: PokerHistoryStreet;
  boardCount: number;
  text: string;
  playerId?: number;
  actionIndex?: number;
};

export type PokerReplayPlayerState = {
  playerId: number;
  stack: number;
  streetBet: number;
  contributed: number;
  folded: boolean;
  isWinner: boolean;
};

export type PokerReplayActionState = {
  playerId: number;
  kind: PokerHistoryActionKind;
  amount: number;
  raiseTo: number | null;
  isAllIn: boolean;
  label: string;
  text: string;
};

export type PokerReplayTableState = {
  street: PokerHistoryStreet;
  boardCount: number;
  pot: number;
  settled: boolean;
  currentPlayerId: number | null;
  action: PokerReplayActionState | null;
  players: PokerReplayPlayerState[];
};

const SUITS = new Set<PokerHistorySuit>(["♠", "♥", "♦", "♣"]);
const STREETS: PokerHistoryStreet[] = ["preflop", "flop", "turn", "river"];
const STREET_BOARD_COUNT: Record<PokerHistoryStreet, number> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
};
const STREET_LABEL: Record<PokerHistoryStreet, string> = {
  preflop: "翻牌前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCard(value: unknown): value is PokerHistoryCard {
  if (!value || typeof value !== "object") return false;
  const card = value as Partial<PokerHistoryCard>;
  return finiteNumber(card.rank)
    && card.rank >= 2
    && card.rank <= 14
    && typeof card.suit === "string"
    && SUITS.has(card.suit as PokerHistorySuit);
}

function isNumberEntry(value: unknown): value is { playerId: number; amount: number } {
  if (!value || typeof value !== "object") return false;
  const entry = value as { playerId?: unknown; amount?: unknown };
  return finiteNumber(entry.playerId) && finiteNumber(entry.amount);
}

function isPlayer(value: unknown): value is PokerHistoryPlayer {
  if (!value || typeof value !== "object") return false;
  const player = value as Partial<PokerHistoryPlayer>;
  return finiteNumber(player.id)
    && typeof player.name === "string"
    && typeof player.monogram === "string"
    && Array.isArray(player.hole)
    && player.hole.length === 2
    && player.hole.every(isCard)
    && (player.startingStack === undefined || (finiteNumber(player.startingStack) && player.startingStack >= 0))
    && typeof player.folded === "boolean"
    && finiteNumber(player.contributed)
    && finiteNumber(player.stack)
    && typeof player.isHuman === "boolean";
}

function isAction(value: unknown): value is PokerHistoryAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<PokerHistoryAction>;
  return finiteNumber(action.playerId)
    && typeof action.street === "string"
    && STREETS.includes(action.street as PokerHistoryStreet)
    && typeof action.kind === "string"
    && ["fold", "check", "call", "raise"].includes(action.kind)
    && finiteNumber(action.amount)
    && finiteNumber(action.toCall)
    && finiteNumber(action.stackBefore)
    && finiteNumber(action.potBefore)
    && typeof action.isAllIn === "boolean"
    && typeof action.description === "string";
}

function isHandHistoryEntry(value: unknown): value is PokerHandHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<PokerHandHistoryEntry>;
  return typeof entry.id === "string"
    && entry.id.length > 0
    && typeof entry.runId === "string"
    && entry.runId.length > 0
    && finiteNumber(entry.hand)
    && entry.hand >= 1
    && finiteNumber(entry.completedAt)
    && ["per_hand", "session", "endless"].includes(entry.mode ?? "")
    && ["short", "standard", "deep", "squid"].includes(entry.presetKey ?? "")
    && typeof entry.result === "string"
    && STREETS.includes(entry.finalStreet as PokerHistoryStreet)
    && finiteNumber(entry.totalPot)
    && Array.isArray(entry.board)
    && entry.board.length <= 5
    && entry.board.every(isCard)
    && finiteNumber(entry.dealer)
    && Array.isArray(entry.winnerIds)
    && entry.winnerIds.every(finiteNumber)
    && Array.isArray(entry.mainPotWinnerIds)
    && entry.mainPotWinnerIds.every(finiteNumber)
    && Array.isArray(entry.payouts)
    && entry.payouts.every(isNumberEntry)
    && Array.isArray(entry.returns)
    && entry.returns.every(isNumberEntry)
    && Array.isArray(entry.players)
    && entry.players.length > 0
    && entry.players.every(isPlayer)
    && Array.isArray(entry.actions)
    && entry.actions.every(isAction)
    && Array.isArray(entry.log)
    && entry.log.every((line) => typeof line === "string");
}

export function upsertPokerHandHistory(
  entries: readonly PokerHandHistoryEntry[],
  nextEntry: PokerHandHistoryEntry,
  limit = POKER_HAND_HISTORY_LIMIT,
) {
  const existing = entries.find((entry) => entry.id === nextEntry.id);
  const stableEntry = existing
    ? { ...nextEntry, completedAt: existing.completedAt }
    : nextEntry;
  return [stableEntry, ...entries.filter((entry) => entry.id !== stableEntry.id)]
    .sort((left, right) => right.completedAt - left.completedAt)
    .slice(0, Math.max(0, limit));
}

export function mergePokerHandHistory(
  entries: readonly PokerHandHistoryEntry[],
  incoming: readonly PokerHandHistoryEntry[],
  limit = POKER_HAND_HISTORY_LIMIT,
) {
  return [...incoming]
    .sort((left, right) => left.completedAt - right.completedAt)
    .reduce(
      (history, entry) => upsertPokerHandHistory(history, entry, limit),
      [...entries],
    );
}

export function parsePokerHandHistoryJson(serialized: string | null | undefined) {
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .filter(isHandHistoryEntry)
      .sort((left, right) => right.completedAt - left.completedAt)
      .filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      })
      .slice(0, POKER_HAND_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function rankLabel(rank: number) {
  return rank <= 10 ? String(rank) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[rank];
}

function cardText(card: PokerHistoryCard) {
  return `${rankLabel(card.rank)}${card.suit}`;
}

export function buildPokerReplayEvents(entry: PokerHandHistoryEntry): PokerReplayEvent[] {
  const events: PokerReplayEvent[] = [{
    id: `${entry.id}:deal:hole`,
    kind: "deal",
    street: "preflop",
    boardCount: 0,
    text: "底牌发放完毕，翻牌前行动开始",
  }];

  for (const street of STREETS) {
    const boardCount = Math.min(entry.board.length, STREET_BOARD_COUNT[street]);
    if (street !== "preflop" && entry.board.length >= STREET_BOARD_COUNT[street]) {
      const newlyVisible = street === "flop" ? entry.board.slice(0, 3) : entry.board.slice(boardCount - 1, boardCount);
      events.push({
        id: `${entry.id}:deal:${street}`,
        kind: "deal",
        street,
        boardCount,
        text: `${STREET_LABEL[street]}发出：${newlyVisible.map(cardText).join(" ")}`,
      });
    }
    entry.actions.forEach((action, index) => {
      if (action.street !== street) return;
      events.push({
        id: `${entry.id}:action:${index}`,
        kind: "action",
        street,
        boardCount,
        text: action.description,
        playerId: action.playerId,
        actionIndex: index,
      });
    });
  }

  events.push({
    id: `${entry.id}:result`,
    kind: "result",
    street: entry.finalStreet,
    boardCount: entry.board.length,
    text: entry.result,
  });
  return events;
}

export function clampPokerReplayStep(step: number, eventCount: number) {
  if (eventCount <= 0) return 0;
  return Math.max(0, Math.min(eventCount - 1, Math.trunc(Number.isFinite(step) ? step : 0)));
}

function pokerReplayStartingStack(entry: PokerHandHistoryEntry, player: PokerHistoryPlayer) {
  if (finiteNumber(player.startingStack) && player.startingStack >= 0) return player.startingStack;
  const payout = entry.payouts.find((item) => item.playerId === player.id)?.amount ?? 0;
  const returned = entry.returns.find((item) => item.playerId === player.id)?.amount ?? 0;
  return Math.max(0, player.stack + player.contributed - payout - returned);
}

function pokerReplayActionLabel(action: PokerHistoryAction, raiseTo: number | null) {
  if (action.kind === "fold") return "弃牌";
  if (action.kind === "check") return "过牌";
  if (action.kind === "call") return `${action.isAllIn ? "全下跟注" : "跟注"} ${action.amount}`;
  if (action.street !== "preflop" && action.toCall === 0) {
    return `${action.isAllIn ? "全下" : "下注"} ${raiseTo ?? action.amount}`;
  }
  return `${action.isAllIn ? "全下到" : "加注到"} ${raiseTo ?? action.amount}`;
}

/**
 * Rebuilds the visible table for a completed solo hand at one replay event.
 * Chips posted as blinds, every street bet, folds, stacks and the pot are
 * replayed from the authoritative action journal instead of inferred from the
 * prose log.
 */
export function buildPokerReplayTableState(
  entry: PokerHandHistoryEntry,
  events: readonly PokerReplayEvent[],
  currentStep: number,
): PokerReplayTableState {
  const playerCount = entry.players.length;
  const smallBlindId = playerCount > 1 ? (entry.dealer + 1) % playerCount : -1;
  const bigBlindId = playerCount > 1 ? (entry.dealer + 2) % playerCount : smallBlindId;
  const players = entry.players.map<PokerReplayPlayerState>((player) => ({
    playerId: player.id,
    stack: pokerReplayStartingStack(entry, player),
    streetBet: 0,
    contributed: 0,
    folded: false,
    isWinner: false,
  }));

  const postBlind = (playerId: number, amount: number) => {
    const player = players.find((candidate) => candidate.playerId === playerId);
    if (!player) return;
    const paid = Math.min(amount, player.stack);
    player.stack -= paid;
    player.streetBet += paid;
    player.contributed += paid;
  };
  postBlind(smallBlindId, 5);
  if (bigBlindId !== smallBlindId) postBlind(bigBlindId, 10);

  let street: PokerHistoryStreet = "preflop";
  let boardCount = 0;
  let pot = players.reduce((sum, player) => sum + player.streetBet, 0);
  let settled = false;
  let currentPlayerId: number | null = null;
  let currentAction: PokerReplayActionState | null = null;
  const lastVisible = Math.min(events.length - 1, Math.max(0, currentStep));

  for (let eventIndex = 0; eventIndex <= lastVisible; eventIndex += 1) {
    const event = events[eventIndex];
    street = event.street;
    boardCount = event.boardCount;
    currentPlayerId = null;
    currentAction = null;

    if (event.kind === "deal") {
      if (event.street !== "preflop") {
        players.forEach((player) => { player.streetBet = 0; });
      }
      continue;
    }

    if (event.kind === "result") {
      settled = true;
      // Result snapshots use post-settlement stacks, so the chips have already
      // left the middle. Keeping totalPot here would visually count the same
      // chips once in the winners' stacks and again in the pot.
      pot = 0;
      players.forEach((player) => {
        const finalPlayer = entry.players.find((candidate) => candidate.id === player.playerId);
        player.stack = finalPlayer?.stack ?? player.stack;
        player.streetBet = 0;
        player.contributed = finalPlayer?.contributed ?? player.contributed;
        player.folded = finalPlayer?.folded ?? player.folded;
        player.isWinner = entry.winnerIds.includes(player.playerId);
      });
      continue;
    }

    const action = event.actionIndex === undefined ? undefined : entry.actions[event.actionIndex];
    if (!action) continue;
    const player = players.find((candidate) => candidate.playerId === action.playerId);
    if (!player) continue;
    // stackBefore is captured by the engine immediately before this action and
    // corrects any old or imported record whose blind metadata is incomplete.
    player.stack = action.stackBefore;
    const streetBetBefore = player.streetBet;
    if (action.kind === "fold") player.folded = true;
    if (action.kind === "call" || action.kind === "raise") {
      player.stack = Math.max(0, player.stack - action.amount);
      player.streetBet += action.amount;
      player.contributed += action.amount;
    }
    const raiseTo = action.kind === "raise" ? streetBetBefore + action.amount : null;
    const label = pokerReplayActionLabel(action, raiseTo);
    currentPlayerId = player.playerId;
    currentAction = {
      playerId: player.playerId,
      kind: action.kind,
      amount: action.amount,
      raiseTo,
      isAllIn: action.isAllIn,
      label,
      text: `${entry.players.find((candidate) => candidate.id === player.playerId)?.name ?? `座位 ${player.playerId + 1}`} ${label}`,
    };
    pot = Math.max(0, action.potBefore + action.amount);
  }

  return {
    street,
    boardCount,
    pot,
    settled,
    currentPlayerId,
    action: currentAction,
    players,
  };
}

export function pokerReplayEventsAtStep(entry: PokerHandHistoryEntry, step: number) {
  const events = buildPokerReplayEvents(entry);
  const currentStep = clampPokerReplayStep(step, events.length);
  return {
    events,
    currentStep,
    current: events[currentStep],
    visible: events.slice(0, currentStep + 1),
    boardCount: events[currentStep]?.boardCount ?? 0,
    table: buildPokerReplayTableState(entry, events, currentStep),
  };
}
