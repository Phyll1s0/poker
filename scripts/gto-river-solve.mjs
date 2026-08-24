#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { solveHeadsUpRiver } from "../lib/gto-river.ts";

function usage() {
  return [
    "RangeCraft heads-up river CFR+ solver",
    "",
    "Usage:",
    "  npm run gto:river -- --input examples/gto-river-node.json [--output solution.json]",
    "",
    "Options:",
    "  --input <file>             JSON river specification (required)",
    "  --output <file>            Write the portable result instead of stdout",
    "  --iterations <integer>     CFR+ iterations (default: 50000)",
    "  --averaging-delay <integer>  Delayed averaging iterations (default: 100)",
    "  --help                     Show this help",
  ].join("\n");
}

function parseInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} 必须是非负整数`);
  return parsed;
}

function parseArguments(argv) {
  const result = { input: "", output: "", iterations: 50_000, averagingDelay: 100, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} 缺少参数`);
    index += 1;
    if (argument === "--input") result.input = value;
    else if (argument === "--output") result.output = value;
    else if (argument === "--iterations") result.iterations = parseInteger(value, argument);
    else if (argument === "--averaging-delay") result.averagingDelay = parseInteger(value, argument);
    else throw new Error(`未知参数 ${argument}`);
  }
  return result;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.input) throw new Error(`缺少 --input\n\n${usage()}`);
  const inputPath = resolve(options.input);
  const spec = JSON.parse(await readFile(inputPath, "utf8"));
  const startedAt = Date.now();
  const solution = solveHeadsUpRiver(spec, {
    iterations: options.iterations,
    averagingDelay: options.averagingDelay,
    linearAveraging: true,
  });
  const portable = {
    schemaVersion: "rangecraft-heads-up-river-solution/v1",
    inputFile: options.input,
    solverVersion: solution.solverVersion,
    spotId: solution.spotId,
    gameSpecId: solution.gameSpecId,
    treeId: solution.treeId,
    standardTemplate: solution.standardTemplate,
    source: solution.source,
    iterations: solution.iterations,
    compatibleDeals: solution.compatibleDeals,
    accuracyScope: solution.accuracyScope,
    externalBenchmarkStatus: solution.externalBenchmarkStatus,
    accuracyLevel: solution.accuracyLevel,
    exploitability: solution.exploitability,
    durationMs: Date.now() - startedAt,
    strategies: solution.strategies,
    actionValues: solution.actionValues,
  };
  const encoded = `${JSON.stringify(portable, null, 2)}\n`;
  if (options.output) {
    const outputPath = resolve(options.output);
    await writeFile(outputPath, encoded, "utf8");
    process.stdout.write(
      `已写入 ${outputPath}\n` +
      `exploitability ${portable.exploitability.exploitabilityPotFraction.toFixed(6)} pot · ` +
      `${portable.iterations} iterations · ${portable.durationMs} ms\n`,
    );
    return;
  }
  process.stdout.write(encoded);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
