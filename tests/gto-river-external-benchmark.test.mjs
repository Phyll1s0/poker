import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  benchmarkHeadsUpRiverAgainstPublicFixture,
  parsePublicRiverBenchmarkFixture,
  verifyPublicRiverBenchmarkArtifacts,
} from "../lib/gto-river-benchmark.ts";
import { headsUpRiverStrategyEntry, solveHeadsUpRiver } from "../lib/gto-river.ts";
import { stableGtoHash } from "../lib/gto-standard.ts";

const FIXTURE_PATH = new URL(
  "../benchmarks/external/noambrown-river-v1/reference.json",
  import.meta.url,
);
const rawFixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
const fixture = parsePublicRiverBenchmarkFixture(rawFixture);
const rawInput = await readFile(new URL(
  "../benchmarks/external/noambrown-river-v1/input.json",
  import.meta.url,
), "utf8");
const rawOutputBase64 = await readFile(new URL(
  "../benchmarks/external/noambrown-river-v1/upstream-strategy.json.base64",
  import.meta.url,
), "utf8");
const candidate = solveHeadsUpRiver(fixture.spec, {
  iterations: 5_000,
  averagingDelay: 100,
  linearAveraging: true,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function refreshHash(value) {
  const payload = clone(value);
  delete payload.contentHash;
  value.contentHash = stableGtoHash(payload);
  return value;
}

test("public MIT river oracle passes a strict same-spot benchmark", () => {
  const artifacts = verifyPublicRiverBenchmarkArtifacts(fixture, rawInput, rawOutputBase64);
  const report = benchmarkHeadsUpRiverAgainstPublicFixture(candidate, fixture);

  assert.equal(artifacts.semanticMatch, true);
  assert.equal(artifacts.rawOutputSha256, rawFixture.source.rawOutputSha256);
  assert.ok(artifacts.rawOutputBytes > 0);
  assert.equal(report.passed, true, JSON.stringify(report, null, 2));
  assert.equal(report.commercialAlignmentClaim, false);
  assert.equal(report.claimScope, "implementation-conformance-only");
  assert.equal(report.source.license, "MIT");
  assert.equal(report.source.commit, "6a10442877ffc8fd28af93e16e279b9bbdd97b2a");
  assert.deepEqual(report.coverage, {
    referenceStrategyCount: 12,
    candidateStrategyCount: 12,
    comparedStrategyCount: 12,
    fraction: 1,
  });
  assert.ok(report.referenceAuditedExploitabilityPotFraction < 1e-6);
  assert.ok(report.candidateAuditedExploitabilityPotFraction < 1e-6);
  assert.ok(report.weightedReferenceEvRegretPotFraction < 1e-6);
  assert.ok(report.maxSingleReferenceActionRegret.potFraction < 1e-6);
  assert.ok(report.maxActionFrequencyError.value < 1e-5);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.checks));
});

test("the independent mixed bluff frequency agrees to far below one percentage point", () => {
  const entry = headsUpRiverStrategyEntry(candidate, "ip", "QsJs", "check");
  assert.ok(entry);
  const candidateBet = entry.probabilities[entry.actions.indexOf("bet-to:10")];
  const upstreamBet = rawFixture.upstream.players[1].profile.c.strategy[2][1];

  assert.ok(Math.abs(candidateBet - upstreamBet) < 1e-5, `${candidateBet} vs ${upstreamBet}`);
});

test("fixture content, trusted source and exact spot identity cannot be silently changed", () => {
  const tampered = clone(rawFixture);
  tampered.upstream.players[1].profile.c.strategy[2] = [0.5, 0.5];
  assert.throws(() => parsePublicRiverBenchmarkFixture(tampered), /contentHash 不匹配/);

  const shortCommit = refreshHash(clone(rawFixture));
  shortCommit.source.commit = "main";
  refreshHash(shortCommit);
  assert.throws(() => parsePublicRiverBenchmarkFixture(shortCommit), /可信公开基准清单/);

  const wrongLicense = clone(rawFixture);
  wrongLicense.source.license = "unknown";
  refreshHash(wrongLicense);
  assert.throws(() => parsePublicRiverBenchmarkFixture(wrongLicense), /可信公开基准清单/);

  const forgedSource = clone(rawFixture);
  forgedSource.source.repository = "https://example.com/not-independent";
  forgedSource.source.commit = "a".repeat(40);
  forgedSource.source.licenseUrl = "https://example.com/LICENSE";
  forgedSource.source.rawOutputSha256 = "b".repeat(64);
  refreshHash(forgedSource);
  assert.throws(() => parsePublicRiverBenchmarkFixture(forgedSource), /可信公开基准清单/);

  const changedExternalRange = clone(rawFixture);
  changedExternalRange.upstream.players[0].weights = [0.5, 0.25, 0.25];
  refreshHash(changedExternalRange);
  assert.throws(() => parsePublicRiverBenchmarkFixture(changedExternalRange), /可信公开基准清单/);

  const changedPot = clone(rawFixture);
  changedPot.spec.potBb = 11;
  refreshHash(changedPot);
  assert.throws(() => parsePublicRiverBenchmarkFixture(changedPot), /可信公开基准清单/);
});

test("checked-in upstream input and raw solver bytes are actually hash verified", () => {
  assert.throws(
    () => verifyPublicRiverBenchmarkArtifacts(fixture, `${rawInput} `, rawOutputBase64),
    /input.json 的 SHA-256 不匹配/,
  );
  const tamperedRaw = `${rawOutputBase64.slice(0, -5)}AAAA\n`;
  assert.throws(
    () => verifyPublicRiverBenchmarkArtifacts(fixture, rawInput, tamperedRaw),
    /raw output/,
  );
});

test("partial profiles and unconverged candidates fail instead of borrowing the reference claim", () => {
  const partialOop = new Map(candidate.averageStrategy[0]);
  partialOop.delete(partialOop.keys().next().value);
  const partialCandidate = {
    ...candidate,
    averageStrategy: [partialOop, candidate.averageStrategy[1]],
  };
  const partialReport = benchmarkHeadsUpRiverAgainstPublicFixture(partialCandidate, fixture);
  assert.equal(partialReport.passed, false);
  assert.equal(partialReport.checks.completeCoverage, false);

  const oneIteration = solveHeadsUpRiver(fixture.spec, {
    iterations: 1,
    averagingDelay: 0,
    linearAveraging: true,
  });
  const unconvergedReport = benchmarkHeadsUpRiverAgainstPublicFixture(oneIteration, fixture);
  assert.equal(unconvergedReport.passed, false);
  assert.equal(unconvergedReport.checks.candidateExploitability, false);
});

test("a different board, stack, range or tree is not benchmark-comparable", () => {
  const different = solveHeadsUpRiver({
    ...fixture.spec,
    effectiveStackBb: 9,
  }, {
    iterations: 10,
    averagingDelay: 0,
  });
  assert.throws(
    () => benchmarkHeadsUpRiverAgainstPublicFixture(different, fixture),
    /候选 spotId 与外部同题局面不一致/,
  );
});
