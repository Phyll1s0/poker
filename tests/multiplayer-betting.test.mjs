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

test("unopened pot presets use direct pot fractions", () => {
  assert.deepEqual(multiplayerRaisePresets({
    pot: 60,
    currentBet: 0,
    callAmount: null,
    minRaiseTo: 10,
    maxRaiseTo: 100,
  }), [
    { key: "minimum", label: "最小", target: 10 },
    { key: "half-pot", label: "½ 池", target: 30 },
    { key: "two-thirds-pot", label: "⅔ 池", target: 40 },
    { key: "pot", label: "1 池", target: 60 },
    { key: "all-in", label: "全下", target: 100 },
  ]);
});

test("raise presets size from the pot after calling and stay within legal bounds", () => {
  assert.deepEqual(multiplayerRaisePresets({
    pot: 150,
    currentBet: 50,
    callAmount: 50,
    minRaiseTo: 100,
    maxRaiseTo: 500,
  }), [
    { key: "minimum", label: "最小", target: 100 },
    { key: "half-pot", label: "½ 池", target: 150 },
    { key: "two-thirds-pot", label: "⅔ 池", target: 183 },
    { key: "pot", label: "1 池", target: 250 },
    { key: "all-in", label: "全下", target: 500 },
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
