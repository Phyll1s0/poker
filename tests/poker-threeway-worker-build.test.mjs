import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_DIR = path.join(ROOT, "dist", "client", "_next", "static");

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  }));
  return nested.flat();
}

test("the Sites production build ships a bundled browser Worker instead of a file or TypeScript URL", async () => {
  const files = await javascriptFiles(STATIC_DIR);
  const workerFiles = files.filter((file) => (
    /poker-threeway-river\.worker-[\w-]+\.js$/.test(file)
  ));
  assert.equal(workerFiles.length, 1, `expected one bundled Worker, got ${workerFiles.join(", ")}`);

  const workerFile = workerFiles[0];
  const workerSource = await readFile(workerFile, "utf8");
  assert.ok(workerSource.length > 1_000, "Worker output should contain its bundled solver");
  assert.doesNotMatch(workerSource, /\bimport\s+type\b|\bas\s+unknown\b/);

  const workerName = path.basename(workerFile);
  const sources = await Promise.all(files
    .filter((file) => file !== workerFile)
    .map((file) => readFile(file, "utf8")));
  const clientSource = sources.find((source) => source.includes(workerName));
  assert.ok(clientSource, "client bundle should reference the emitted Worker");
  assert.match(clientSource, new RegExp(`new Worker\\([^)]*${workerName.replaceAll(".", "\\.")}`));
  assert.doesNotMatch(clientSource, /file:\/\/\/ROOT|poker-threeway-river\.worker[^"'`]*\.ts/);
});
