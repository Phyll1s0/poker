import assert from "node:assert/strict";
import test from "node:test";

import {
  pokerPrivatePeekCandidateIds,
  selectPokerPrivatePeek,
} from "../lib/poker-peek.ts";

const players = [
  { id: 0, isHuman: true, hole: ["A♠", "K♠"] },
  { id: 1, isHuman: false, hole: ["Q♥", "J♥"] },
  { id: 2, isHuman: false, hole: ["7♣", "2♦"] },
  { id: 3, isHuman: false, hole: [] },
];

test("offers only unrevealed AI hands as private peek candidates", () => {
  assert.deepEqual(pokerPrivatePeekCandidateIds(players, [1]), [2]);
  assert.deepEqual(pokerPrivatePeekCandidateIds(players, []), [1, 2]);
  assert.deepEqual(pokerPrivatePeekCandidateIds(players, [1, 2]), []);
});

test("allows exactly one valid private peek per hand", () => {
  const candidates = pokerPrivatePeekCandidateIds(players, []);
  const first = selectPokerPrivatePeek([], 2, candidates);
  assert.deepEqual(first, [2]);
  assert.deepEqual(selectPokerPrivatePeek(first, 1, candidates), [2]);
  assert.deepEqual(selectPokerPrivatePeek([], 0, candidates), []);
  assert.deepEqual(selectPokerPrivatePeek([], 3, candidates), []);
});

test("keeps public reveals separate and resets naturally with a fresh hand", () => {
  const publiclyShown = [1];
  const peeked = selectPokerPrivatePeek([], 2, pokerPrivatePeekCandidateIds(players, publiclyShown));
  assert.deepEqual(publiclyShown, [1]);
  assert.deepEqual(peeked, [2]);
  assert.deepEqual([], [], "a fresh hand starts with no private peek state");
});
