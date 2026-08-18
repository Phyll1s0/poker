import assert from "node:assert/strict";
import test from "node:test";

import { sampleAiLineup } from "../lib/poker-ai.ts";

test("samples every AI seat independently and allows repeated styles", () => {
  const lineup = sampleAiLineup(5, () => 0);

  assert.equal(lineup.length, 5);
  assert.deepEqual(lineup.map((entry) => entry.styleKey), Array(5).fill("gto"));
  assert.notEqual(lineup[0], lineup[1]);
});

test("samples the full style range and handles an empty table", () => {
  assert.deepEqual(sampleAiLineup(3, () => 0.9999).map((entry) => entry.styleKey), ["nit", "nit", "nit"]);
  assert.deepEqual(sampleAiLineup(0, () => 0.5), []);
});
