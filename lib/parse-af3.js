/**
 * Defensive parsing of AlphaFold 3 / AlphaFold Server result trees (extracted ZIPs).
 * Layout follows public AF3 output docs; tolerates renames, extra nesting, and partial files.
 */

import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import unzipper from "unzipper";
import { effectiveMatrixKeyForJob } from "./results-query.js";

const PAIR_ID_AFTER_AF3M = /af3m_(p_[0-9a-f]{16})(?:_|$)/i;
const PAIR_ID_ANYWHERE = /\bp_[0-9a-f]{16}\b/i;

export function normRel(rel) {
  return String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Skip macOS zip artifacts: resource-fork files and __MACOSX (often empty mirrors of real paths).
 * @param {string} rel
 */
export function isIgnoredForAf3ExtractPath(rel) {
  const r = normRel(rel);
  if (!r) return false;
  const parts = r.split("/").filter(Boolean);
  if (parts.some((p) => p === "__MACOSX")) return true;
  const bn = path.posix.basename(r);
  if (bn.startsWith("._")) return true;
  if (bn === ".DS_Store") return true;
  return false;
}

export function extractPairIdFromText(text) {
  if (text == null) return null;
  const s = String(text);
  const m1 = s.match(PAIR_ID_AFTER_AF3M);
  if (m1) return m1[1].toLowerCase();
  const m2 = s.match(PAIR_ID_ANYWHERE);
  return m2 ? m2[0].toLowerCase() : null;
}

/**
 * Extract ZIP to directory (unzipper.Extract includes basic zip-slip checks).
 * @param {string} zipPath
 * @param {string} destDir
 */
export async function safeUnzipToDir(zipPath, destDir) {
  const resolved = path.resolve(destDir);
  await fs.mkdir(resolved, { recursive: true });
  await createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: resolved }))
    .promise();
}

async function walkFiles(rootAbs) {
  /** @type {{ rel: string, full: string, sizeBytes: number }[]} */
  const out = [];
  async function walk(curAbs, rel) {
    let entries;
    try {
      entries = await fs.readdir(curAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const name = e.name;
      if (name === "." || name === "..") continue;
      const nextRel = rel ? `${rel}/${name}` : name;
      const nextAbs = path.join(curAbs, name);
      if (e.isDirectory()) await walk(nextAbs, nextRel);
      else {
        try {
          const st = await fs.stat(nextAbs);
          out.push({
            rel: normRel(nextRel),
            full: nextAbs,
            sizeBytes: st.size
          });
        } catch {
          /* ignore */
        }
      }
    }
  }
  await walk(rootAbs, "");
  return out;
}

function posixDirname(rel) {
  const r = normRel(rel);
  const i = r.lastIndexOf("/");
  return i < 0 ? "" : r.slice(0, i);
}

/**
 * Files belonging to one AF3 job directory (handles flat root layout).
 * @param {{ rel: string }[]} fileRecords
 * @param {string} jobRootRel
 */
export function filesInJobSubtree(fileRecords, jobRootRel) {
  const jr = normRel(jobRootRel);
  return fileRecords.filter(({ rel }) => {
    const r = normRel(rel);
    if (jr === "") {
      if (!r.includes("/")) return true;
      return /^seed-[^/]+_sample-\d+\//i.test(r);
    }
    return r === jr || r.startsWith(`${jr}/`);
  });
}

function jobKey(jobRootRel, prefix) {
  return `${normRel(jobRootRel)}@@${prefix}`;
}

/**
 * Discover job roots + file name prefixes from paths (ranking CSV, models, samples).
 * @param {{ rel: string }[]} fileRecords
 */
export function discoverAf3Jobs(fileRecords) {
  /** @type {Map<string, { jobRootRel: string, prefix: string, sources: string[] }>} */
  const map = new Map();

  function add(jobRootRel, prefix, source) {
    const k = jobKey(jobRootRel, prefix);
    const cur = map.get(k);
    if (cur) {
      if (!cur.sources.includes(source)) cur.sources.push(source);
      return;
    }
    map.set(k, { jobRootRel, prefix, sources: [source] });
  }

  for (const { rel } of fileRecords) {
    const bn = path.posix.basename(normRel(rel));
    const rankM = bn.match(/^(.+)_ranking_scores\.csv$/i);
    if (rankM) {
      const dir = posixDirname(rel);
      add(dir, rankM[1], "ranking_scores.csv");
    }
  }

  for (const { rel } of fileRecords) {
    if (/\/seed-[^/]+_sample-\d+\//i.test(normRel(rel))) continue;
    const bn = path.posix.basename(normRel(rel));
    const topM = bn.match(/^(.+)_model\.cif$/i);
    if (topM) {
      const dir = posixDirname(rel);
      add(dir, topM[1], "top_model.cif");
    }
  }

  // AlphaFold Server / batch exports: fold_*_model_0.cif … model_4.cif (no single *_model.cif).
  for (const { rel } of fileRecords) {
    if (/\/seed-[^/]+_sample-\d+\//i.test(normRel(rel))) continue;
    const bn = path.posix.basename(normRel(rel));
    const idxM = bn.match(/^(.+)_model_(\d+)\.cif$/i);
    if (!idxM) continue;
    const dir = posixDirname(rel);
    add(dir, idxM[1], "indexed_model.cif");
  }

  for (const { rel } of fileRecords) {
    const bn = path.posix.basename(normRel(rel));
    const sm = bn.match(/^(.+)_seed-(.+)_sample-(\d+)_model\.cif$/i);
    if (!sm) continue;
    const parent = posixDirname(rel);
    const jobRoot = parentOfSeedSampleDir(parent);
    if (jobRoot === undefined) continue;
    add(jobRoot, sm[1], "sample_model.cif");
  }

  return [...map.values()].sort((a, b) => {
    const ra = `${a.jobRootRel}/${a.prefix}`;
    const rb = `${b.jobRootRel}/${b.prefix}`;
    return ra.localeCompare(rb);
  });
}

function parentOfSeedSampleDir(dirRel) {
  const parts = normRel(dirRel).split("/").filter(Boolean);
  if (parts.length === 0) return "";
  const last = parts[parts.length - 1];
  if (/^seed-[^/]+_sample-\d+$/i.test(last)) {
    return parts.slice(0, -1).join("/");
  }
  return normRel(dirRel);
}

/** Minimal CSV: handles quoted fields lightly, CRLF. */
export function parseRankingCsv(text) {
  if (text == null || String(text).trim() === "") {
    return { headers: [], rows: [], normalizedRows: [] };
  }
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) {
    return { headers: [], rows: [], normalizedRows: [] };
  }

  function splitRow(line) {
    const cells = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQ = !inQ;
      } else if (c === "," && !inQ) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur.trim());
    return cells;
  }

  const headers = splitRow(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i]).map((c) => c.replace(/^"|"$/g, ""));
    if (cells.length === 1 && cells[0] === "") continue;
    const row = {};
    headers.forEach((h, j) => {
      row[h] = cells[j] != null ? cells[j] : "";
    });
    rows.push(row);
  }

  const normKey = (h) =>
    String(h)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const normalizedRows = rows.map((row) => {
    const o = {};
    for (const [k, v] of Object.entries(row)) {
      o[normKey(k)] = v;
    }
    return o;
  });

  return { headers, rows, normalizedRows };
}

/**
 * Pull scalar ranking/confidence fields from arbitrary JSON (AF3 summary or nested).
 * @param {unknown} obj
 */
export function pickConfidenceMetrics(obj) {
  if (!obj || typeof obj !== "object") return null;
  /** @type {Record<string, unknown>} */
  const out = {};
  const candidates = [
    "ranking_score",
    "ptm",
    "iptm",
    "pTM",
    "ipTM",
    "fraction_disordered",
    "has_clash",
    "aggregate_score",
    "confidence_score",
    "iptm_score",
    "ptm_score"
  ];
  for (const k of candidates) {
    if (k in obj && obj[k] != null && typeof obj[k] !== "object") {
      out[k] = obj[k];
    }
  }
  const lower = (s) => String(s).toLowerCase();
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || typeof v === "object") continue;
    const lk = lower(k);
    if (
      lk.includes("ranking") &&
      lk.includes("score") &&
      out.ranking_score === undefined
    ) {
      out.ranking_score = v;
    }
    if (lk === "iptm" || lk === "iptm_score") out.iptm = out.iptm ?? v;
    if (lk === "ptm" || lk === "ptm_score") out.ptm = out.ptm ?? v;
  }
  return Object.keys(out).length ? out : null;
}

/** AlphaFold Server `full_data_N.json` often nests scores one level deep. */
function pickMetricsFromFullDataJson(obj) {
  if (!obj || typeof obj !== "object") return null;
  const direct = pickConfidenceMetrics(obj);
  if (direct) return direct;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = pickConfidenceMetrics(v);
      if (nested) return nested;
    }
  }
  return null;
}

function truncateLargeJsonForStorage(obj, depth = 0) {
  if (depth > 12) return { _truncatedDepth: true };
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    const max = 64;
    if (obj.length > max) {
      return {
        _truncated: true,
        length: obj.length,
        preview: obj.slice(0, 3).map((x) => truncateLargeJsonForStorage(x, depth + 1))
      };
    }
    return obj.map((x) => truncateLargeJsonForStorage(x, depth + 1));
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const bigArrays =
      (k === "pae" ||
        k === "contact_probs" ||
        k === "atom_plddts" ||
        k === "token_chain_ids" ||
        k === "atom_chain_ids") &&
      Array.isArray(v) &&
      v.length > 64;
    if (bigArrays) {
      out[k] = { _truncated: true, length: v.length };
    } else if (typeof v === "object" && v !== null) {
      out[k] = truncateLargeJsonForStorage(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function tryReadJsonFile(fullPath) {
  try {
    const raw = await fs.readFile(fullPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findRel(subset, pred) {
  for (const f of subset) {
    if (pred(normRel(f.rel))) return f.rel;
  }
  return null;
}

function inferJobNameFromRequest(parsed) {
  if (parsed == null) return null;
  if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object") {
    const n = parsed[0].name;
    return n != null ? String(n) : null;
  }
  if (typeof parsed === "object" && parsed.name != null) {
    return String(parsed.name);
  }
  return null;
}

function findRankingRowForSample(normalizedRows, seed, sample) {
  if (!normalizedRows || !normalizedRows.length) return null;
  const seedStr = seed != null ? String(seed) : null;
  const sampleStr = sample != null ? String(sample) : null;
  for (const row of normalizedRows) {
    const rSeed =
      row.seed ??
      row.model_seed ??
      row.random_seed ??
      row.prng_seed ??
      row.s;
    const rSample =
      row.sample ??
      row.sample_id ??
      row.model_sample ??
      row.sample_index ??
      row.n;
    if (seedStr != null && rSeed != null && String(rSeed) !== seedStr) continue;
    if (sampleStr != null && rSample != null && String(rSample) !== sampleStr)
      continue;
    if (seedStr != null || sampleStr != null) return row;
  }
  return normalizedRows[0] || null;
}

function findRankingRowForTop(normalizedRows) {
  if (!normalizedRows || !normalizedRows.length) return null;
  let best = normalizedRows[0];
  let bestScore = -Infinity;
  for (const row of normalizedRows) {
    const scoreKeys = Object.keys(row).filter(
      (k) => k.includes("ranking") && k.includes("score")
    );
    let s = NaN;
    for (const k of scoreKeys) {
      const n = parseFloat(String(row[k]));
      if (!Number.isNaN(n)) {
        s = n;
        break;
      }
    }
    if (Number.isNaN(s)) {
      const n2 = parseFloat(String(row.score ?? row.rank_score ?? ""));
      s = Number.isNaN(n2) ? 0 : n2;
    }
    if (s > bestScore) {
      bestScore = s;
      best = row;
    }
  }
  return best;
}

function metricsFromRankingRow(row) {
  if (!row || typeof row !== "object") return null;
  const out = { ...row };
  const num = {};
  for (const [k, v] of Object.entries(row)) {
    const f = parseFloat(String(v));
    if (!Number.isNaN(f) && String(v).trim() !== "") num[k] = f;
  }
  return { raw: out, numericHints: num };
}

/**
 * @param {string} extractRootAbs
 * @param {{ manifest?: object | null }} [options]
 */
export async function parseAf3ExtractedDirectory(extractRootAbs, options = {}) {
  const manifest = options.manifest ?? null;
  const parseWarnings = [];

  const walked = await walkFiles(extractRootAbs);
  const fileRecords = walked.filter((f) => !isIgnoredForAf3ExtractPath(f.rel));
  const skippedMacMeta = walked.length - fileRecords.length;
  if (skippedMacMeta > 0) {
    parseWarnings.push(
      `Skipped ${skippedMacMeta} macOS ZIP artifact path(s) (__MACOSX and/or ._* resource forks); parsing uses the real AF3 output folders only.`
    );
  }
  const rawFileIndex = fileRecords.map((f) => ({
    relativePath: f.rel,
    sizeBytes: f.sizeBytes
  }));

  const jobSpecs = discoverAf3Jobs(fileRecords);
  if (jobSpecs.length === 0) {
    parseWarnings.push(
      "No AF3-style jobs detected (expected ranking_scores.csv, *_model.cif, *_model_<n>.cif, and/or seed-*_sample-* trees)."
    );
  }

  /** @type {Record<string, unknown>} */
  const rawJsonByRelPath = {};
  /** @type {object[]} */
  const jobs = [];

  for (const spec of jobSpecs) {
    const subset = filesInJobSubtree(fileRecords, spec.jobRootRel);
    const folderBasename =
      spec.jobRootRel === ""
        ? "(extract_root)"
        : path.posix.basename(normRel(spec.jobRootRel));
    const { prefix } = spec;

    const pl = prefix.toLowerCase();
    const jobRequestRel = findRel(subset, (r) => {
      const b = path.posix.basename(r);
      return (
        /job_request\.json$/i.test(b) ||
        /_job_request\.json$/i.test(b) ||
        b.toLowerCase() === `${pl}_request.json`
      );
    });
    let jobRequestParsed = null;
    if (jobRequestRel) {
      jobRequestParsed = await tryReadJsonFile(
        path.join(extractRootAbs, jobRequestRel)
      );
      if (jobRequestParsed != null) {
        rawJsonByRelPath[jobRequestRel] = jobRequestParsed;
      }
    }

    const inferredName =
      inferJobNameFromRequest(jobRequestParsed) || folderBasename;
    let pairId =
      extractPairIdFromText(folderBasename) ||
      extractPairIdFromText(inferredName);

    const rankingRel = findRel(
      subset,
      (r) =>
        path.posix.basename(r).toLowerCase() ===
          `${prefix.toLowerCase()}_ranking_scores.csv` ||
        r.toLowerCase().endsWith(`/${prefix.toLowerCase()}_ranking_scores.csv`)
    );
    let rankingCsvRaw = null;
    let rankingParsed = null;
    if (rankingRel) {
      try {
        rankingCsvRaw = await fs.readFile(
          path.join(extractRootAbs, rankingRel),
          "utf8"
        );
      } catch {
        parseWarnings.push(`Could not read ranking CSV: ${rankingRel}`);
      }
      if (rankingCsvRaw) {
        rankingParsed = parseRankingCsv(rankingCsvRaw);
        rawJsonByRelPath[rankingRel] = {
          _kind: "ranking_scores_csv",
          headers: rankingParsed.headers,
          rowCount: rankingParsed.rows.length,
          rawPreview: rankingCsvRaw.slice(0, 65536),
          parsed: {
            headers: rankingParsed.headers,
            rows: rankingParsed.rows
          }
        };
      }
    }

    const normRows = rankingParsed?.normalizedRows ?? [];

    /** @type {object[]} */
    const models = [];

    const topCifRel = findRel(
      subset,
      (r) =>
        !/\/seed-[^/]+_sample-\d+\//i.test(r) &&
        path.posix.basename(r).toLowerCase() ===
          `${prefix.toLowerCase()}_model.cif`
    );
    const topSummaryRel = findRel(
      subset,
      (r) =>
        !/\/seed-[^/]+_sample-\d+\//i.test(r) &&
        path.posix.basename(r).toLowerCase() ===
          `${prefix.toLowerCase()}_summary_confidences.json`
    );
    const topFullRel = findRel(
      subset,
      (r) =>
        !/\/seed-[^/]+_sample-\d+\//i.test(r) &&
        /_confidences\.json$/i.test(path.posix.basename(r)) &&
        !/_summary_confidences\.json$/i.test(path.posix.basename(r)) &&
        path.posix.basename(r).toLowerCase().startsWith(prefix.toLowerCase())
    );

    let topSummaryParsed = null;
    if (topSummaryRel) {
      topSummaryParsed = await tryReadJsonFile(
        path.join(extractRootAbs, topSummaryRel)
      );
      if (topSummaryParsed != null) {
        rawJsonByRelPath[topSummaryRel] = topSummaryParsed;
      }
    }
    let topFullParsed = null;
    if (topFullRel) {
      topFullParsed = await tryReadJsonFile(
        path.join(extractRootAbs, topFullRel)
      );
      if (topFullParsed != null) {
        rawJsonByRelPath[topFullRel] =
          truncateLargeJsonForStorage(topFullParsed);
      }
    }

    const topMetrics =
      pickConfidenceMetrics(topSummaryParsed) ||
      pickConfidenceMetrics(topFullParsed);
    const topRankRow = findRankingRowForTop(normRows);

    if (topCifRel || topSummaryRel || topFullRel) {
      models.push({
        modelId: `${prefix}::top`,
        kind: "aggregate_top",
        seed: null,
        sample: null,
        cifRelativePath: topCifRel,
        summaryConfidencesRelativePath: topSummaryRel,
        fullConfidencesRelativePath: topFullRel,
        metrics: topMetrics,
        ranking: topRankRow ? metricsFromRankingRow(topRankRow) : null
      });
    }

    const indexedModelRe = new RegExp(
      `^${escapeRe(prefix)}_model_(\\d+)\\.cif$`,
      "i"
    );
    const indexedCifs = subset
      .map((f) => {
        const bn = path.posix.basename(normRel(f.rel));
        const m = bn.match(indexedModelRe);
        return m
          ? { rel: f.rel, idx: parseInt(m[1], 10) }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.idx - b.idx);

    for (const { rel: idxCifRel, idx: modelIdx } of indexedCifs) {
      if (topCifRel && normRel(idxCifRel) === normRel(topCifRel)) continue;
      const n = modelIdx;
      const fullDataRel = findRel(
        subset,
        (r) =>
          path.posix.basename(r).toLowerCase() ===
          `${pl}_full_data_${n}.json`
      );
      const idxSummaryRel = findRel(
        subset,
        (r) => {
          const b = path.posix.basename(r).toLowerCase();
          return (
            b === `${pl}_summary_confidences_${n}.json` ||
            b === `${pl}_summary_confidence_${n}.json`
          );
        }
      );
      const idxFullRel = findRel(subset, (r) => {
        const b = path.posix.basename(r).toLowerCase();
        if (b.includes("summary")) return false;
        return (
          b === `${pl}_full_confidences_${n}.json` ||
          b === `${pl}_confidences_${n}.json`
        );
      });

      let idxSummaryParsed = null;
      if (idxSummaryRel) {
        idxSummaryParsed = await tryReadJsonFile(
          path.join(extractRootAbs, idxSummaryRel)
        );
        if (idxSummaryParsed != null) {
          rawJsonByRelPath[idxSummaryRel] = idxSummaryParsed;
        }
      }
      let idxFullParsed = null;
      if (idxFullRel) {
        idxFullParsed = await tryReadJsonFile(
          path.join(extractRootAbs, idxFullRel)
        );
        if (idxFullParsed != null) {
          rawJsonByRelPath[idxFullRel] =
            truncateLargeJsonForStorage(idxFullParsed);
        }
      }
      let fullDataParsed = null;
      if (fullDataRel) {
        fullDataParsed = await tryReadJsonFile(
          path.join(extractRootAbs, fullDataRel)
        );
        if (fullDataParsed != null) {
          rawJsonByRelPath[fullDataRel] =
            truncateLargeJsonForStorage(fullDataParsed);
        }
      }

      const idxMetrics =
        pickConfidenceMetrics(idxSummaryParsed) ||
        pickConfidenceMetrics(idxFullParsed) ||
        pickMetricsFromFullDataJson(fullDataParsed) ||
        (fullDataParsed &&
        typeof fullDataParsed === "object" &&
        "metrics" in fullDataParsed
          ? pickConfidenceMetrics(
              /** @type {{ metrics?: unknown }} */ (fullDataParsed).metrics
            )
          : null);
      const idxRankRow = findRankingRowForSample(
        normRows,
        null,
        String(n)
      );

      models.push({
        modelId: `${prefix}::model_${n}`,
        kind: "indexed",
        seed: null,
        sample: modelIdx,
        cifRelativePath: idxCifRel,
        summaryConfidencesRelativePath: idxSummaryRel,
        fullConfidencesRelativePath: idxFullRel,
        metrics: idxMetrics,
        ranking: idxRankRow ? metricsFromRankingRow(idxRankRow) : null
      });
    }

    const samplePrefixRe = new RegExp(
      `^${escapeRe(prefix)}_seed-(.+)_sample-(\\d+)_`,
      "i"
    );

    const sampleRoots = new Set();
    const jrNorm = normRel(spec.jobRootRel);
    for (const { rel } of subset) {
      const r = normRel(rel);
      const idx = r.search(/seed-[^/]+_sample-\d+/i);
      if (idx < 0) continue;
      const fromIdx = r.slice(idx);
      const slash = fromIdx.indexOf("/");
      const seedFolder =
        slash < 0 ? fromIdx : fromIdx.slice(0, slash);
      if (!/^seed-[^/]+_sample-\d+$/i.test(seedFolder)) continue;
      const before = r.slice(0, idx).replace(/\/+$/, "");
      const fullRoot = before ? `${before}/${seedFolder}` : seedFolder;
      if (jrNorm === "") {
        sampleRoots.add(fullRoot);
      } else if (fullRoot === jrNorm || fullRoot.startsWith(`${jrNorm}/`)) {
        sampleRoots.add(fullRoot);
      }
    }

    for (const sroot of [...sampleRoots].sort()) {
      const inSample = subset.filter((f) =>
        normRel(f.rel).startsWith(`${normRel(sroot)}/`)
      );
      const cifR = findRel(inSample, (r) => /_model\.cif$/i.test(r));
      const sumR = findRel(inSample, (r) =>
        /_summary_confidences\.json$/i.test(r)
      );
      const fullR = findRel(
        inSample,
        (r) =>
          /_confidences\.json$/i.test(r) &&
          !/_summary_confidences\.json$/i.test(r)
      );

      let seedVal = null;
      let sampleVal = null;
      const dirName = path.posix.basename(normRel(sroot));
      const dm = dirName.match(/^seed-(.+)_sample-(\d+)$/i);
      if (dm) {
        seedVal = dm[1];
        sampleVal = parseInt(dm[2], 10);
      }

      if (cifR) {
        const bn = path.posix.basename(cifR);
        const fm = bn.match(samplePrefixRe);
        if (fm) {
          seedVal = fm[1];
          sampleVal = parseInt(fm[2], 10);
        }
      }

      let sumParsed = null;
      if (sumR) {
        sumParsed = await tryReadJsonFile(path.join(extractRootAbs, sumR));
        if (sumParsed != null) rawJsonByRelPath[sumR] = sumParsed;
      }
      let fullParsed = null;
      if (fullR) {
        fullParsed = await tryReadJsonFile(path.join(extractRootAbs, fullR));
        if (fullParsed != null) {
          rawJsonByRelPath[fullR] = truncateLargeJsonForStorage(fullParsed);
        }
      }

      const mets =
        pickConfidenceMetrics(sumParsed) || pickConfidenceMetrics(fullParsed);
      const rankRow = findRankingRowForSample(normRows, seedVal, sampleVal);

      if (cifR || sumR || fullR) {
        models.push({
          modelId: `${prefix}::${dirName}`,
          kind: "sample",
          seed: seedVal,
          sample: sampleVal,
          cifRelativePath: cifR,
          summaryConfidencesRelativePath: sumR,
          fullConfidencesRelativePath: fullR,
          metrics: mets,
          ranking: rankRow ? metricsFromRankingRow(rankRow) : null
        });
      }
    }

    models.sort((a, b) => String(a.modelId).localeCompare(String(b.modelId)));

    if (models.length === 0) {
      parseWarnings.push(
        `No models found for job prefix "${prefix}" under "${spec.jobRootRel || "(root)"}".`
      );
    }

    let manifestMatch = null;
    if (pairId && manifest?.pairs && Array.isArray(manifest.pairs)) {
      manifestMatch =
        manifest.pairs.find((p) => p && p.pairId === pairId) || null;
      if (!manifestMatch) {
        parseWarnings.push(
          `pairId ${pairId} (job ${prefix}) not found in session manifest.`
        );
      }
    }

    jobs.push({
      jobRootRelative: spec.jobRootRel,
      folderBasename,
      filePrefix: prefix,
      inferredJobName: inferredName,
      pairId,
      pairIdSources: {
        fromFolder: extractPairIdFromText(folderBasename),
        fromJobRequestName: extractPairIdFromText(inferredName)
      },
      manifestMatch,
      discoverySources: spec.sources,
      rankingScoresRelativePath: rankingRel,
      models,
      modelCount: models.length
    });
  }

  return {
    version: 1,
    dialectHint: "alphafold3_output_tree",
    extractedAt: new Date().toISOString(),
    parseWarnings,
    rawFileIndex,
    rawJsonByRelPath,
    jobs,
    jobCount: jobs.length
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {object} parsed
 * @param {string | null} sessionId
 */
export function summarizeIngestForResponse(parsed, sessionId) {
  return {
    sessionId,
    jobCount: parsed.jobCount,
    parseWarnings: parsed.parseWarnings,
    jobs: parsed.jobs.map((j) => ({
      jobRootRelative: j.jobRootRelative,
      filePrefix: j.filePrefix,
      inferredJobName: j.inferredJobName,
      pairId: j.pairId,
      manifestMatched: Boolean(j.manifestMatch),
      matrixKey: effectiveMatrixKeyForJob(j),
      modelCount: j.modelCount,
      models: j.models.map((m) => ({
        modelId: m.modelId,
        kind: m.kind,
        seed: m.seed,
        sample: m.sample,
        cifRelativePath: m.cifRelativePath,
        metrics: m.metrics,
        hasRankingRow: Boolean(m.ranking)
      }))
    }))
  };
}
