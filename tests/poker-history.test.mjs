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
