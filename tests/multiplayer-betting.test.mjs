import assert from "node:assert/strict";
import test from "node:test";
import {
  clampMultiplayerRaiseTarget,
  multiplayerRaisePresets,
} from "../lib/multiplayer-betting.ts";

test("multiplayer raise targets clamp to legal integer boundaries", () => {
  assert.equal(clampMultiplayerRaiseTarget(19.6, 20, 100), 20);
  assert.equal(clampMultiplayerRaiseTarget(64.6, 20, 100), 65);
  assert.equal(clampMultiplayerRaiseTarget(101, 20, 100), 100);
  assert.equal(clampMultiplayerRaiseTarget(Number.NaN, 20, 100), 20);
});

test("postflop presets match the single-player 33/50/75/100 percent routes", () => {
  assert.deepEqual(multiplayerRaisePresets({
    pot: 60,
    currentBet: 0,
    callAmount: null,
    minRaiseTo: 10,
    maxRaiseTo: 100,
    street: "flop",
    bigBlind: 10,
  }), [
    { key: "one-third-pot", label: "33%", target: 20 },
    { key: "half-pot", label: "50%", target: 30 },
    { key: "three-quarters-pot", label: "75%", target: 45 },
    { key: "pot", label: "底池", target: 60 },
    { key: "all-in", label: "全下", target: 100 },
  ]);
});

test("postflop raise presets size from the pot after calling", () => {
  assert.deepEqual(multiplayerRaisePresets({
    pot: 150,
    currentBet: 50,
    callAmount: 50,
    minRaiseTo: 100,
    maxRaiseTo: 500,
    street: "turn",
    bigBlind: 10,
  }), [
    { key: "one-third-pot", label: "33%", target: 115 },
    { key: "half-pot", label: "50%", target: 150 },
    { key: "three-quarters-pot", label: "75%", target: 200 },
    { key: "pot", label: "底池", target: 250 },
    { key: "all-in", label: "全下", target: 500 },
  ]);
});

test("unopened preflop presets match the single-player big-blind routes", () => {
  assert.deepEqual(multiplayerRaisePresets({
    pot: 15,
    currentBet: 10,
    callAmount: 10,
    minRaiseTo: 20,
    maxRaiseTo: 1_000,
    street: "preflop",
    bigBlind: 10,
  }), [
    { key: "two-and-half-bb", label: "2.5BB", target: 25 },
    { key: "three-bb", label: "3BB", target: 30 },
    { key: "four-bb", label: "4BB", target: 40 },
    { key: "five-bb", label: "5BB", target: 50 },
    { key: "all-in", label: "全下", target: 1_000 },
  ]);
});

test("preflop reraises size from the current raise-to amount", () => {
  assert.deepEqual(multiplayerRaisePresets({
    pot: 45,
    currentBet: 30,
    callAmount: 30,
    minRaiseTo: 50,
    maxRaiseTo: 1_000,
    street: "preflop",
    bigBlind: 10,
  }), [
    { key: "two-and-half-bb", label: "2.5×", target: 75 },
    { key: "three-bb", label: "3×", target: 90 },
    { key: "four-bb", label: "4×", target: 120 },
    { key: "five-bb", label: "5×", target: 150 },
    { key: "all-in", label: "全下", target: 1_000 },
  ]);
});

test("a short-stack incomplete raise exposes only the all-in route", () => {
  assert.deepEqual(multiplayerRaisePresets({
    pot: 80,
    currentBet: 50,
    callAmount: 40,
    minRaiseTo: 70,
    maxRaiseTo: 70,
    allInOnly: true,
  }), [{ key: "all-in", label: "全下", target: 70 }]);
});
