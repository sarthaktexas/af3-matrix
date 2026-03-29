/**
 * Build AlphaFold Server–compatible batch JSON from pairs manifests.
 * @see https://github.com/google-deepmind/alphafold/blob/main/server/README.md
 */

export { saveAf3ExportBatches } from "./storage.js";

export const DEFAULT_AF3_BATCH_SIZE = 50;
export const MIN_AF3_BATCH_SIZE = 1;
export const MAX_AF3_BATCH_SIZE = 500;

/**
 * One AF Server job: bait + prey as two protein chains.
 * @param {{ af3JobName: string, bait: { sequence: string }, prey: { sequence: string } }} pair
 */
export function pairToAf3ServerJob(pair) {
  const name = String(pair.af3JobName || "").trim();
  if (!name) {
    throw new Error("pair missing af3JobName");
  }
  const baitSeq = String(pair.bait?.sequence || "").trim();
  const preySeq = String(pair.prey?.sequence || "").trim();
  if (!baitSeq || !preySeq) {
    throw new Error(`pair "${name}": bait and prey sequences are required`);
  }
  return {
    name,
    modelSeeds: [],
    sequences: [
      { proteinChain: { sequence: baitSeq, count: 1 } },
      { proteinChain: { sequence: preySeq, count: 1 } }
    ],
    dialect: "alphafoldserver",
    version: 1
  };
}

/**
 * @param {unknown} manifest - pairs manifest from disk (version 1)
 * @returns {object[]}
 */
export function jobsFromManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("manifest is required");
  }
  const pairs = manifest.pairs;
  if (!Array.isArray(pairs)) {
    throw new Error("manifest.pairs must be an array");
  }
  return pairs.map((p) => pairToAf3ServerJob(p));
}

/**
 * Split flat job list into batches of length `batchSize` (last batch may be smaller).
 * @template T
 * @param {T[]} items
 * @param {number} batchSize
 * @returns {T[][]}
 */
export function chunkIntoBatches(items, batchSize) {
  if (!Number.isInteger(batchSize) || batchSize < MIN_AF3_BATCH_SIZE) {
    throw new Error(
      `batchSize must be an integer ≥ ${MIN_AF3_BATCH_SIZE}`
    );
  }
  if (batchSize > MAX_AF3_BATCH_SIZE) {
    throw new Error(`batchSize must be ≤ ${MAX_AF3_BATCH_SIZE}`);
  }
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
export function parseBatchSize(value, fallback = DEFAULT_AF3_BATCH_SIZE) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const n = typeof value === "string" ? parseInt(value, 10) : Number(value);
  if (!Number.isInteger(n)) {
    throw new Error("batchSize must be an integer");
  }
  if (n < MIN_AF3_BATCH_SIZE || n > MAX_AF3_BATCH_SIZE) {
    throw new Error(
      `batchSize must be between ${MIN_AF3_BATCH_SIZE} and ${MAX_AF3_BATCH_SIZE}`
    );
  }
  return n;
}
