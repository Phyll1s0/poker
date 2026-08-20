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

export function pokerReplayEventsAtStep(entry: PokerHandHistoryEntry, step: number) {
  const events = buildPokerReplayEvents(entry);
  const currentStep = clampPokerReplayStep(step, events.length);
  return {
    events,
    currentStep,
    current: events[currentStep],
    visible: events.slice(0, currentStep + 1),
    boardCount: events[currentStep]?.boardCount ?? 0,
  };
}
