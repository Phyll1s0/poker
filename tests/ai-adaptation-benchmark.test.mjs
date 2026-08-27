import assert from "node:assert/strict";
import test from "node:test";

import { runAdaptationBenchmark } from "../scripts/ai-adaptation-benchmark.mjs";

function stable(report) {
  return {
    config: report.config,
    evidence: report.evidence,
    scenarios: report.scenarios,
  };
}

test("adaptive response benchmark is deterministic and exercises every style", () => {
  const options = { samples: 300, seed: "paired-adaptation-test" };
  const first = runAdaptationBenchmark(options);
  const replay = runAdaptationBenchmark(options);
  assert.deepEqual(stable(first), stable(replay));
  assert.equal(first.scenarios.length, 25);
  assert.deepEqual(
    [...new Set(first.scenarios.map((row) => row.styleKey))].sort(),
    ["adaptive", "gto", "lag", "nit", "tag"],
  );
});

test("matching public evidence changes final actions in the intended direction", () => {
  const report = runAdaptationBenchmark({ samples: 300, seed: "direction-test" });
  const byScenario = Object.groupBy(report.scenarios, (row) => row.scenario);
  for (const row of byScenario["river-overfold-bluff"]) {
    assert.ok(row.adaptedPrimary > row.baselinePrimary, `${row.styleKey} 应攻击河牌过弃`);
    assert.ok(row.actionTv > 0.002, `${row.styleKey} 需要有最终行动层变化`);
  }
  for (const row of byScenario["river-station-bluff"]) {
    assert.ok(row.adaptedPrimary < row.baselinePrimary, `${row.styleKey} 应减少对跟注站的空气进攻`);
  }
  for (const row of byScenario["river-regime-switch-bluff"]) {
    assert.ok(row.adaptedPrimary < row.baselinePrimary, `${row.styleKey} 应跟随玩家换挡而减少空气进攻`);
  }
  for (const row of byScenario["preflop-open-pressure-defense"]) {
    assert.ok(row.adaptedPrimary > row.baselinePrimary, `${row.styleKey} 应扩大对持续开池的防守`);
  }
  const overfoldAdaptive = byScenario["river-overfold-bluff"].find((row) => row.styleKey === "adaptive");
  const overfoldGto = byScenario["river-overfold-bluff"].find((row) => row.styleKey === "gto");
  assert.ok(overfoldAdaptive.actionTv > overfoldGto.actionTv * 3);
});
