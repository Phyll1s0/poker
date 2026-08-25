#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  benchmarkHeadsUpRiverAgainstPublicFixture,
  parsePublicRiverBenchmarkFixture,
  verifyPublicRiverBenchmarkArtifacts,
} from "../lib/gto-river-benchmark.ts";
import { solveHeadsUpRiver } from "../lib/gto-river.ts";

const DEFAULT_FIXTURE = "benchmarks/external/noambrown-river-v1/reference.json";

function parseArguments(argv) {
  const options = { fixture: DEFAULT_FIXTURE, iterations: 5_000, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write([
        "RangeCraft public river GTO benchmark",
        "",
        "Usage:",
        "  npm run gto:benchmark:river -- [--iterations 5000] [--fixture path] [--json]",
        "",
        "The command is offline: it verifies a checked-in, content-hashed public",
        "oracle snapshot and solves the exact same RangeCraft river subgame.",
        "",
      ].join("\n"));
      process.exit(0);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} 缺少参数`);
    index += 1;
    if (argument === "--fixture") options.fixture = value;
    else if (argument === "--iterations") {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("--iterations 必须是正整数");
      options.iterations = parsed;
    } else throw new Error(`未知参数 ${argument}`);
  }
  return options;
}

function percent(value, digits = 6) {
  return `${(value * 100).toFixed(digits)}%`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const fixturePath = resolve(options.fixture);
  const fixture = parsePublicRiverBenchmarkFixture(JSON.parse(await readFile(fixturePath, "utf8")));
  const fixtureDirectory = dirname(fixturePath);
  const artifacts = verifyPublicRiverBenchmarkArtifacts(
    fixture,
    await readFile(resolve(fixtureDirectory, fixture.source.inputFile), "utf8"),
    await readFile(resolve(fixtureDirectory, fixture.source.rawOutputFile), "utf8"),
  );
  const startedAt = Date.now();
  const solution = solveHeadsUpRiver(fixture.spec, {
    algorithm: "cfr+",
    iterations: options.iterations,
    averagingDelay: Math.min(100, Math.max(0, options.iterations - 1)),
    linearAveraging: true,
  });
  const report = benchmarkHeadsUpRiverAgainstPublicFixture(solution, fixture);
  const output = {
    ...report,
    artifacts,
    candidateIterations: options.iterations,
    durationMs: Date.now() - startedAt,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    const max = report.maxActionFrequencyError;
    process.stdout.write([
      `公开独立河牌同题基准：${report.passed ? "PASS" : "FAIL"}`,
      `参考：${report.source.name} @ ${report.source.commit.slice(0, 12)} · ${report.source.license}`,
      `原始产物：input/raw SHA-256 已验证 · ${artifacts.rawOutputBytes} bytes`,
      `身份：${report.identity.spotId}`,
      `覆盖：${report.coverage.comparedStrategyCount}/${report.coverage.referenceStrategyCount} (${percent(report.coverage.fraction, 2)})`,
      `参考/候选共同审计 exploitability：${percent(report.referenceAuditedExploitabilityPotFraction)} / ${percent(report.candidateAuditedExploitabilityPotFraction)}`,
      `参考动作 EV 下的候选加权 regret：${percent(report.weightedReferenceEvRegretPotFraction)}`,
      `最大单节点 regret：${percent(report.maxSingleReferenceActionRegret.potFraction)}`,
      `频率 TV（诊断）：${percent(report.meanFrequencyTotalVariation)}；最大动作误差 ${percent(max.value)} @ ${max.player} ${max.holding} ${max.history} ${max.action}`,
      "结论范围：公开独立实现的一项固定 heads-up 河牌子博弈一致性验证；不代表商业全树或多人 GTO 对齐。",
      `耗时：${output.durationMs} ms`,
      "",
    ].join("\n"));
  }
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
