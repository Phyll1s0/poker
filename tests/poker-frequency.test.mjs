import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPokerFrequency,
  formatPokerFrequencyMix,
} from "../lib/poker-frequency.ts";

test("reserves 100% for pure actions and keeps tiny branches visible", () => {
  assert.equal(formatPokerFrequency(1), "100%");
  assert.equal(formatPokerFrequency(0.9996), ">99.9%");
  assert.equal(formatPokerFrequency(0.999_999), ">99.9%");
  assert.equal(formatPokerFrequency(0.996), "99.6%");
  assert.equal(formatPokerFrequency(0.004), "0.4%");
  assert.equal(formatPokerFrequency(0.0004), "<0.1%");
  assert.equal(formatPokerFrequency(0), "0%");

  assert.equal(
    formatPokerFrequencyMix([
      { label: "弃牌", frequency: 0.996 },
      { label: "跟注", frequency: 0.004 },
      { label: "加注", frequency: 0 },
    ]),
    "弃牌 99.6% · 跟注 0.4%",
  );
});
