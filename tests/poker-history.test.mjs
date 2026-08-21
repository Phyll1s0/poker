import assert from "node:assert/strict";
import test from "node:test";

import {
  POKER_HAND_HISTORY_LIMIT,
  buildPokerReplayEvents,
  clampPokerReplayStep,
  mergePokerHandHistory,
  parsePokerHandHistoryJson,
  pokerReplayEventsAtStep,
  upsertPokerHandHistory,
} from "../lib/poker-history.ts";

function historyEntry(hand, overrides = {}) {
  const runId = overrides.runId ?? "run-a";
  return {
    id: overrides.id ?? `${runId}:${hand}`,
    runId,
    hand,
    completedAt: overrides.completedAt ?? hand * 1_000,
    mode: "per_hand",
    presetKey: "standard",
    result: overrides.result ?? `第 ${hand} 手结算`,
    finalStreet: "river",
    totalPot: 120,
    board: [
      { rank: 14, suit: "♣" },
      { rank: 3, suit: "♣" },
      { rank: 6, suit: "♣" },
      { rank: 13, suit: "♥" },
      { rank: 2, suit: "♦" },
    ],
    dealer: 0,
    winnerIds: [1],
    mainPotWinnerIds: [1],
    payouts: [{ playerId: 1, amount: 120 }],
    returns: [],
    players: [
      { id: 0, name: "你", monogram: "ME", hole: [{ rank: 12, suit: "♣" }, { rank: 11, suit: "♣" }], folded: false, contributed: 60, stack: 940, isHuman: true },
      { id: 1, name: "ORION", monogram: "OR", hole: [{ rank: 14, suit: "♦" }, { rank: 14, suit: "♥" }], folded: false, contributed: 60, stack: 1_060, isHuman: false },
    ],
    actions: overrides.actions ?? [
      { playerId: 0, street: "preflop", kind: "raise", amount: 30, toCall: 10, stackBefore: 995, potBefore: 15, isAllIn: false, description: "你 加注至 30" },
      { playerId: 1, street: "preflop", kind: "call", amount: 20, toCall: 20, stackBefore: 990, potBefore: 45, isAllIn: false, description: "ORION 跟注 20" },
    ],
    log: ["第 1 手开始", "你 加注至 30", "ORION 跟注 20", "第 1 手结算"],
    ...overrides,
  };
}

test("keeps the newest 30 solo hands and allows the same hand number in different runs", () => {
  let history = [];
  for (let hand = 1; hand <= 35; hand += 1) {
    history = upsertPokerHandHistory(history, historyEntry(hand));
  }
  assert.equal(history.length, POKER_HAND_HISTORY_LIMIT);
  assert.equal(history[0].hand, 35);
  assert.equal(history.at(-1).hand, 6);

  history = upsertPokerHandHistory(history, historyEntry(35, { runId: "run-b", completedAt: 99_000 }));
  assert.equal(history[0].id, "run-b:35");
  assert.equal(history.filter((entry) => entry.hand === 35).length, 2);
});

test("upsert is idempotent and preserves the original completion time", () => {
  const original = historyEntry(4, { completedAt: 4_000, result: "旧结算" });
  const updated = historyEntry(4, { completedAt: 9_000, result: "最终亮牌结算" });
  const history = upsertPokerHandHistory([original], updated);
  assert.equal(history.length, 1);
  assert.equal(history[0].completedAt, 4_000);
  assert.equal(history[0].result, "最终亮牌结算");
});

test("merges a sealed review run into persistent history in chronological order", () => {
  const persistent = [historyEntry(9, { runId: "old", completedAt: 900 })];
  const sealed = [
    historyEntry(2, { runId: "review", completedAt: 2_000 }),
    historyEntry(1, { runId: "review", completedAt: 1_000 }),
  ];
  const merged = mergePokerHandHistory(persistent, sealed);
  assert.deepEqual(merged.map((entry) => entry.id), ["review:2", "review:1", "old:9"]);
});

test("parses browser storage defensively, deduplicates ids and rejects malformed records", () => {
  const valid = historyEntry(3);
  const duplicate = { ...valid, result: "重复" };
  const malformed = { ...historyEntry(2), players: [] };
  assert.deepEqual(parsePokerHandHistoryJson("not json"), []);
  assert.deepEqual(parsePokerHandHistoryJson(JSON.stringify({ nope: true })), []);
  const parsed = parsePokerHandHistoryJson(JSON.stringify([valid, duplicate, malformed]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].result, valid.result);
});

test("replay inserts every board street even when an all-in has no postflop actions", () => {
  const entry = historyEntry(7, {
    actions: [
      { playerId: 0, street: "preflop", kind: "raise", amount: 990, toCall: 5, stackBefore: 995, potBefore: 15, isAllIn: true, description: "你 全下至 1000" },
      { playerId: 1, street: "preflop", kind: "call", amount: 990, toCall: 990, stackBefore: 990, potBefore: 1_005, isAllIn: true, description: "ORION 全下跟注 990" },
    ],
  });
  const events = buildPokerReplayEvents(entry);
  assert.deepEqual(
    events.filter((event) => event.kind === "deal").map((event) => [event.street, event.boardCount]),
    [["preflop", 0], ["flop", 3], ["turn", 4], ["river", 5]],
  );
  assert.equal(events.at(-1).kind, "result");
  assert.equal(events.at(-1).boardCount, 5);

  const mid = pokerReplayEventsAtStep(entry, 3);
  assert.equal(mid.currentStep, 3);
  assert.equal(mid.visible.length, 4);
  assert.equal(mid.boardCount, mid.current.boardCount);
});

test("replay step is always clamped to an existing event", () => {
  assert.equal(clampPokerReplayStep(-50, 4), 0);
  assert.equal(clampPokerReplayStep(2.9, 4), 2);
  assert.equal(clampPokerReplayStep(50, 4), 3);
  assert.equal(clampPokerReplayStep(Number.NaN, 4), 0);
  assert.equal(clampPokerReplayStep(1, 0), 0);
});

test("table replay rebuilds blinds, exact raise-to amounts, stacks, folds and street bets", () => {
  const players = Array.from({ length: 6 }, (_, id) => ({
    id,
    name: id === 0 ? "你" : `P${id}`,
    monogram: id === 0 ? "ME" : `P${id}`,
    hole: [{ rank: 14 - id, suit: "♠" }, { rank: 8 + (id % 3), suit: "♥" }],
    folded: id === 1 || id === 5,
    contributed: [30, 5, 30, 90, 30, 0][id],
    stack: [970, 995, 970, 910, 970, 1_000][id],
    isHuman: id === 0,
  }));
  const entry = historyEntry(8, {
    dealer: 0,
    players,
    payouts: [],
    returns: [],
    totalPot: 185,
    actions: [
      { playerId: 3, street: "preflop", kind: "raise", amount: 30, toCall: 10, stackBefore: 1_000, potBefore: 15, isAllIn: false, description: "P3 加注至 30" },
      { playerId: 4, street: "preflop", kind: "call", amount: 30, toCall: 30, stackBefore: 1_000, potBefore: 45, isAllIn: false, description: "P4 跟注 30" },
      { playerId: 5, street: "preflop", kind: "fold", amount: 0, toCall: 30, stackBefore: 1_000, potBefore: 75, isAllIn: false, description: "P5 弃牌" },
      { playerId: 0, street: "preflop", kind: "call", amount: 30, toCall: 30, stackBefore: 1_000, potBefore: 75, isAllIn: false, description: "你 跟注 30" },
      { playerId: 1, street: "preflop", kind: "fold", amount: 0, toCall: 25, stackBefore: 995, potBefore: 105, isAllIn: false, description: "P1 弃牌" },
      { playerId: 2, street: "preflop", kind: "call", amount: 20, toCall: 20, stackBefore: 990, potBefore: 105, isAllIn: false, description: "P2 跟注 20" },
      { playerId: 2, street: "flop", kind: "check", amount: 0, toCall: 0, stackBefore: 970, potBefore: 125, isAllIn: false, description: "P2 过牌" },
      { playerId: 3, street: "flop", kind: "raise", amount: 60, toCall: 0, stackBefore: 970, potBefore: 125, isAllIn: false, description: "P3 下注 60" },
    ],
  });

  const openingRaise = pokerReplayEventsAtStep(entry, 1).table;
  assert.equal(openingRaise.pot, 45);
  assert.equal(openingRaise.currentPlayerId, 3);
  assert.equal(openingRaise.action.label, "加注到 30");
  assert.equal(openingRaise.players.find((player) => player.playerId === 3).streetBet, 30);
  assert.equal(openingRaise.players.find((player) => player.playerId === 3).stack, 970);
  assert.equal(openingRaise.players.find((player) => player.playerId === 1).streetBet, 5);
  assert.equal(openingRaise.players.find((player) => player.playerId === 2).streetBet, 10);

  const folded = pokerReplayEventsAtStep(entry, 3).table;
  assert.equal(folded.players.find((player) => player.playerId === 5).folded, true);

  const bigBlindCall = pokerReplayEventsAtStep(entry, 6).table;
  assert.equal(bigBlindCall.action.label, "跟注 20");
  assert.equal(bigBlindCall.players.find((player) => player.playerId === 2).streetBet, 30);
  assert.equal(bigBlindCall.players.find((player) => player.playerId === 2).stack, 970);
  assert.equal(bigBlindCall.pot, 125);

  const flop = pokerReplayEventsAtStep(entry, 7).table;
  assert.equal(flop.street, "flop");
  assert.equal(flop.boardCount, 3);
  assert.equal(flop.pot, 125);
  assert.ok(flop.players.every((player) => player.streetBet === 0));

  const flopBet = pokerReplayEventsAtStep(entry, 9).table;
  assert.equal(flopBet.action.label, "下注 60");
  assert.equal(flopBet.pot, 185);
  assert.equal(flopBet.players.find((player) => player.playerId === 3).streetBet, 60);
});

test("result frame awards the pot exactly once and preserves table chips", () => {
  const players = Array.from({ length: 6 }, (_, id) => ({
    id,
    name: id === 0 ? "你" : `P${id}`,
    monogram: id === 0 ? "ME" : `P${id}`,
    hole: [{ rank: 14 - id, suit: "♠" }, { rank: 8 + (id % 3), suit: "♥" }],
    folded: id !== 2,
    contributed: id === 1 ? 5 : id === 2 ? 10 : 0,
    stack: id === 1 ? 995 : id === 2 ? 1_005 : 1_000,
    isHuman: id === 0,
  }));
  const actions = [3, 4, 5, 0, 1].map((playerId) => ({
    playerId,
    street: "preflop",
    kind: "fold",
    amount: 0,
    toCall: playerId === 1 ? 5 : 10,
    stackBefore: playerId === 1 ? 995 : 1_000,
    potBefore: 15,
    isAllIn: false,
    description: `${playerId === 0 ? "你" : `P${playerId}`} 弃牌`,
  }));
  const entry = historyEntry(9, {
    finalStreet: "preflop",
    board: [],
    dealer: 0,
    players,
    totalPot: 10,
    winnerIds: [2],
    mainPotWinnerIds: [2],
    payouts: [{ playerId: 2, amount: 10 }],
    returns: [{ playerId: 2, amount: 5 }],
    actions,
    result: "P2 收下底池 10 · 未跟注退回 5",
  });

  const firstFrame = pokerReplayEventsAtStep(entry, 0).table;
  assert.equal(firstFrame.pot, 15);
  assert.equal(firstFrame.players.find((player) => player.playerId === 1).stack, 995);
  assert.equal(firstFrame.players.find((player) => player.playerId === 1).streetBet, 5);
  assert.equal(firstFrame.players.find((player) => player.playerId === 2).stack, 990);
  assert.equal(firstFrame.players.find((player) => player.playerId === 2).streetBet, 10);
  assert.equal(firstFrame.players.reduce((sum, player) => sum + player.stack, 0) + firstFrame.pot, 6_000);

  const resultFrame = pokerReplayEventsAtStep(entry, Number.MAX_SAFE_INTEGER).table;
  assert.equal(resultFrame.settled, true);
  assert.equal(resultFrame.pot, 0);
  assert.equal(resultFrame.players.find((player) => player.playerId === 2).stack, 1_005);
  assert.equal(resultFrame.players.find((player) => player.playerId === 2).isWinner, true);
  assert.equal(resultFrame.players.reduce((sum, player) => sum + player.stack, 0) + resultFrame.pot, 6_000);
});

test("stored hand-start stacks keep squid settlement transfers out of earlier replay frames", () => {
  const players = Array.from({ length: 6 }, (_, id) => ({
    id,
    name: id === 0 ? "你" : `P${id}`,
    monogram: id === 0 ? "ME" : `P${id}`,
    hole: [{ rank: 14 - id, suit: "♠" }, { rank: 8 + (id % 3), suit: "♥" }],
    startingStack: 1_000,
    folded: id !== 2,
    contributed: id === 1 ? 5 : id === 2 ? 10 : 0,
    // These final stacks deliberately include an external squid transfer.
    stack: id === 0 ? 500 : id === 2 ? 1_505 : id === 1 ? 995 : 1_000,
    isHuman: id === 0,
  }));
  const entry = historyEntry(10, {
    presetKey: "squid",
    finalStreet: "preflop",
    board: [],
    dealer: 0,
    players,
    totalPot: 10,
    winnerIds: [2],
    mainPotWinnerIds: [2],
    payouts: [{ playerId: 2, amount: 10 }],
    returns: [{ playerId: 2, amount: 5 }],
    actions: [],
  });

  const firstFrame = pokerReplayEventsAtStep(entry, 0).table;
  assert.deepEqual(firstFrame.players.map((player) => player.stack), [1_000, 995, 990, 1_000, 1_000, 1_000]);
  assert.equal(firstFrame.pot, 15);
});
