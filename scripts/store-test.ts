import { readAll, writeAll } from "../server/services/jsonStore.js";
const FILE = "__concurrency_test.json";
const writes = Array.from({ length: 100 }, (_, i) =>
  writeAll(FILE, Array.from({ length: (i % 40) + 1 }, (_, j) => ({ id: `${i}-${j}`, blob: "x".repeat(2000) }))),
);
let readErrors = 0;
const reads = Array.from({ length: 200 }, async () => {
  try { const a = await readAll(FILE); if (!Array.isArray(a)) readErrors++; } catch { readErrors++; }
});
await Promise.all([...writes, ...reads]);
const final = await readAll<{ id: string }>(FILE);
console.log("100 concurrent writes + 200 interleaved reads:");
console.log("  read errors (corrupt/partial):", readErrors);
console.log("  final file valid array:", Array.isArray(final), "len:", final.length);
