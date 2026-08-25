import assert from "node:assert/strict";
import test from "node:test";

import {
  MULTIPLAYER_VISUAL_SEATS_BY_TABLE_SIZE,
  multiplayerRelativeSeat,
  multiplayerVisualSeat,
  normalizedMultiplayerTableSize,
} from "../lib/multiplayer-seat-layout.ts";

test("provides unique fixed visual seats for every supported table size", () => {
  for (let tableSize = 2; tableSize <= 10; tableSize += 1) {
    const visualSeats = MULTIPLAYER_VISUAL_SEATS_BY_TABLE_SIZE[tableSize];
    assert.equal(visualSeats.length, tableSize);
    assert.equal(new Set(visualSeats).size, tableSize);
    assert.ok(visualSeats.every((seat) => seat >= 0 && seat <= 9));
    assert.equal(visualSeats[0], 0);
  }
  assert.deepEqual(MULTIPLAYER_VISUAL_SEATS_BY_TABLE_SIZE[8], [0, 1, 3, 4, 5, 6, 7, 9]);
  assert.deepEqual(MULTIPLAYER_VISUAL_SEATS_BY_TABLE_SIZE[10], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("keeps the viewer at the bottom and rotates physical seats clockwise", () => {
  for (const viewerSeat of [0, 3, 7, 9]) {
    assert.equal(multiplayerRelativeSeat(viewerSeat, viewerSeat, 10), 0);
    assert.equal(multiplayerVisualSeat(viewerSeat, viewerSeat, 10), 0);
    assert.equal(multiplayerRelativeSeat((viewerSeat + 1) % 10, viewerSeat, 10), 1);
    assert.equal(multiplayerRelativeSeat((viewerSeat + 9) % 10, viewerSeat, 10), 9);
  }
});

test("uses table capacity rather than current attendance so seats do not jump", () => {
  const beforeSomeoneLeaves = [0, 2, 4, 6, 8].map((seat) => multiplayerVisualSeat(seat, 0, 10));
  const afterSomeoneLeaves = [0, 2, 6, 8].map((seat) => multiplayerVisualSeat(seat, 0, 10));
  assert.deepEqual(beforeSomeoneLeaves, [0, 2, 4, 6, 8]);
  assert.deepEqual(afterSomeoneLeaves, [0, 2, 6, 8]);
});

test("bounds malformed table sizes without producing an invalid visual slot", () => {
  assert.equal(normalizedMultiplayerTableSize(1), 2);
  assert.equal(normalizedMultiplayerTableSize(11), 10);
  assert.equal(normalizedMultiplayerTableSize(Number.NaN), 10);
  assert.equal(multiplayerVisualSeat(9, 0, 10), 9);
});
