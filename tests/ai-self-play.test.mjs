import assert from "node:assert/strict";
import test from "node:test";
import { runSimulation } from "../scripts/ai-self-play.mjs";

function stableResult(report) {
  return {
    config: report.config,
    totalNetBb: report.totalNetBb,
    results: report.results,
  };
}

test("AI self-play is deterministic for a fixed seed", () => {
  const options = { hands: 600, seed: "repeatable-lineups", stackBb: 100, equityIterations: 2 };
  assert.deepEqual(stableResult(runSimulation(options)), stableResult(runSimulation(options)));
});

test("AI self-play stays zero-sum and reports every style", () => {
  const report = runSimulation({ hands: 1_000, seed: "zero-sum", stackBb: 40, equityIterations: 2 });
  assert.ok(Math.abs(report.totalNetBb) < 1e-8);
  assert.deepEqual(report.results.map(({ styleKey }) => styleKey).sort(), ["adaptive", "gto", "lag", "nit", "tag"]);
  assert.equal(report.results.reduce((sum, result) => sum + result.hands, 0), 6_000);
  for (const result of report.results) {
    assert.ok(result.hands > 0);
    assert.ok(result.vpip >= 0 && result.vpip <= 1);
    assert.ok(result.pfr >= 0 && result.pfr <= result.vpip);
    assert.ok(result.limpRate >= 0 && result.limpRate <= 1);
    assert.ok(result.openLimpDecisionRate >= 0 && result.openLimpDecisionRate <= 1);
    assert.ok(result.overLimpDecisionRate >= 0 && result.overLimpDecisionRate <= 1);
    assert.ok(result.isolationRaiseRate >= 0 && result.isolationRaiseRate <= 1);
    assert.ok(result.limpRaiseDecisionRate >= 0 && result.limpRaiseDecisionRate <= 1);
    assert.ok(result.bluffActionRate >= 0 && result.bluffActionRate <= 1);
    assert.ok(result.pureBluffActionRate >= 0 && result.pureBluffActionRate <= 1);
    assert.ok(result.showdownWinRate >= 0 && result.showdownWinRate <= 1);
    assert.ok(Number.isFinite(result.netBbPer100));
  }

  const byStyle = Object.fromEntries(report.results.map((result) => [result.styleKey, result]));
  assert.ok(byStyle.lag.vpip > byStyle.gto.vpip);
  assert.ok(byStyle.lag.vpip > byStyle.tag.vpip);
  assert.ok(byStyle.gto.vpip > byStyle.nit.vpip);
  assert.ok(byStyle.tag.vpip > byStyle.nit.vpip);
  assert.ok(byStyle.lag.pfr > 0.16);
  assert.ok(byStyle.nit.pfr > 0.05);
  assert.ok(report.results.reduce((sum, result) => sum + result.openLimpRate, 0) > 0.01);
  assert.ok(report.results.reduce((sum, result) => sum + result.overLimpRate, 0) > 0.005);
  assert.ok(report.results.reduce((sum, result) => sum + result.bluffOpportunities, 0) > 100);
  assert.ok(report.results.reduce((sum, result) => sum + result.pureBluffOpportunities, 0) > 20);
  assert.ok(report.results.every((result) => result.bluffActionRate > 0.08));
  assert.ok(byStyle.lag.bluffActionRate > byStyle.nit.bluffActionRate);
});
