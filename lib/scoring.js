/**
 * Composite scores for ranking bait–prey models and aggregates across ≤5 structures.
 */

import { pairRegionOverlapSummary } from "./region-overlap.js";

/** @typedef {{ modelId: string, composite: number, components: Record<string, number>, iptm: number | null, ptm: number | null }} ModelScoreRow */

/**
 * Default weights (sum to 1): confidence-heavy, with interface size and optional region support.
 */
export const DEFAULT_SCORE_WEIGHTS = {
  iptm: 0.45,
  interface: 0.35,
  region: 0.2
};

const MAX_INTERFACE_RESIDUES_FOR_SCALE = 45;

/**
 * Same mapping as ingest heatmap when only AF3 ranking_score-style values exist.
 * @param {number | null | undefined} r
 */
function normalizeAf3RankingToDisplay01(r) {
  if (r == null || !Number.isFinite(r)) return 0;
  if (r >= 0 && r <= 1) return r;
  if (r <= -100) return 0;
  if (r >= 1.5) return 1;
  return Math.min(1, Math.max(0, (r + 100) / 101.5));
}

/**
 * Pull ranking_score-style scalar from metrics JSON and/or ranking CSV hints (no full model).
 * @param {Record<string, unknown> | null | undefined} metrics
 * @param {Record<string, unknown> | null | undefined} rankingNumericHints
 * @returns {number | null}
 */
function extractRankingScalarFromSources(metrics, rankingNumericHints) {
  const m = metrics;
  if (m && typeof m === "object") {
    for (const key of ["ranking_score", "aggregate_score", "confidence_score"]) {
      if (key in m && m[key] != null) {
        const x = Number(m[key]);
        if (Number.isFinite(x)) return x;
      }
    }
    for (const [k, v] of Object.entries(m)) {
      if (v == null || typeof v === "object") continue;
      const lk = String(k).toLowerCase();
      if (lk.includes("ranking") && lk.includes("score")) {
        const x = Number(v);
        if (Number.isFinite(x)) return x;
      }
    }
  }
  const n = rankingNumericHints;
  if (!n || typeof n !== "object") return null;
  for (const [k, v] of Object.entries(n)) {
    if (k.includes("ranking") && k.includes("score")) {
      const x = Number(v);
      if (Number.isFinite(x)) return x;
    }
  }
  for (const key of ["ranking_score", "score"]) {
    if (key in n && n[key] != null) {
      const x = Number(n[key]);
      if (Number.isFinite(x)) return x;
    }
  }
  return null;
}

/**
 * Single 0–1 value for UI: ipTM, else pTM, else normalized ranking proxy (matches matrix ingest).
 * @param {{
 *   iptm: number | null,
 *   ptm: number | null,
 *   rankingRaw: number | null
 * }} s
 */
export function displayConfidenceFromScalars(s) {
  const iptm = s.iptm;
  const ptm = s.ptm;
  if (iptm != null && Number.isFinite(iptm)) {
    return Math.min(Math.max(iptm, 0), 1);
  }
  if (ptm != null && Number.isFinite(ptm)) {
    return Math.min(Math.max(ptm, 0), 1);
  }
  return normalizeAf3RankingToDisplay01(s.rankingRaw);
}

/**
 * Map AF3 metrics blob to 0–1 ipTM / pTM if present (shallow + one pass of nested plain objects).
 * @param {Record<string, unknown> | null | undefined} metrics
 * @param {number} [depth]
 */
export function extractIptmPtm(metrics, depth = 0) {
  if (!metrics || typeof metrics !== "object" || depth > 2) {
    return { iptm: null, ptm: null };
  }
  const raw = /** @type {Record<string, unknown>} */ (metrics);
  const pick = (keys) => {
    for (const k of keys) {
      if (k in raw && raw[k] != null) {
        const n = parseFloat(String(raw[k]));
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };
  let iptm = pick(["iptm", "ipTM", "iptm_score", "ipTM_score"]);
  let ptm = pick(["ptm", "pTM", "ptm_score", "pTM_score"]);
  if (iptm == null && ptm == null) {
    for (const [k, v] of Object.entries(raw)) {
      if (v == null || typeof v === "object") continue;
      const n = parseFloat(String(v));
      if (!Number.isFinite(n)) continue;
      const lk = String(k).toLowerCase();
      if (lk === "iptm" || lk === "iptm_score") iptm = iptm ?? n;
      if (lk === "ptm" || lk === "ptm_score") ptm = ptm ?? n;
    }
  }
  if (iptm != null || ptm != null) return { iptm, ptm };
  if (depth < 2) {
    for (const v of Object.values(raw)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const nested = extractIptmPtm(v, depth + 1);
        if (nested.iptm != null || nested.ptm != null) return nested;
      }
    }
  }
  return { iptm: null, ptm: null };
}

/**
 * Same sources as matrix ingest: job `metrics`, then ranking_scores.csv `numericHints`.
 * @param {Record<string, unknown> | null | undefined} metrics
 * @param {Record<string, unknown> | null | undefined} rankingNumericHints
 */
export function extractIptmPtmFromModelLike(metrics, rankingNumericHints) {
  const fromM = extractIptmPtm(metrics);
  if (fromM.iptm != null || fromM.ptm != null) return fromM;
  return extractIptmPtm(rankingNumericHints);
}

/**
 * Normalize interface footprint to 0–1 (saturating past ~45 residues per side total).
 * @param {{ baitInterfaceResidueCount?: number, preyInterfaceResidueCount?: number } | null | undefined} iface
 */
export function interfaceFootprintScore(iface) {
  if (!iface) return 0;
  const a = Number(iface.baitInterfaceResidueCount ?? 0);
  const b = Number(iface.preyInterfaceResidueCount ?? 0);
  const total = (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
  return Math.min(
    Math.max(total, 0) / MAX_INTERFACE_RESIDUES_FOR_SCALE,
    1
  );
}

/**
 * Region overlap 0–1; when no regions are defined, returns null so weights renormalize.
 * @param {{ hasAnyRegion: boolean, combinedMeanRecall: number | null }} overlapSummary
 */
export function regionScoreFromSummary(overlapSummary) {
  if (!overlapSummary.hasAnyRegion) return null;
  const r = overlapSummary.combinedMeanRecall;
  if (r == null || !Number.isFinite(r)) return 0;
  return Math.min(Math.max(r, 0), 1);
}

/**
 * Build per-model composite in [0,1].
 * @param {{
 *   metrics?: Record<string, unknown> | null,
 *   rankingNumericHints?: Record<string, unknown> | null,
 *   interface?: { baitInterfaceResidueCount?: number, preyInterfaceResidueCount?: number } | null,
 *   regionOverlap?: { hasAnyRegion: boolean, combinedMeanRecall: number | null }
 * }} args
 * @param {typeof DEFAULT_SCORE_WEIGHTS} [weights]
 */
export function scoreSingleModel(args, weights = DEFAULT_SCORE_WEIGHTS) {
  const hints = args.rankingNumericHints ?? null;
  const { iptm, ptm } = extractIptmPtmFromModelLike(args.metrics, hints);
  const rankingRaw = extractRankingScalarFromSources(args.metrics, hints);
  const displayConfidence = displayConfidenceFromScalars({ iptm, ptm, rankingRaw });

  const iptmPart =
    iptm != null && Number.isFinite(iptm)
      ? Math.min(Math.max(iptm, 0), 1)
      : 0;

  const ifacePart = interfaceFootprintScore(args.interface ?? null);

  const regionRaw = args.regionOverlap
    ? regionScoreFromSummary(args.regionOverlap)
    : null;
  const usesRegion = regionRaw != null;

  let wI = weights.iptm;
  let wF = weights.interface;
  let wR = weights.region;
  if (!usesRegion) {
    const sum = wI + wF;
    wI = wI / sum;
    wF = wF / sum;
    wR = 0;
  }

  const regionPart = usesRegion ? /** @type {number} */ (regionRaw) : 0;

  const composite = wI * iptmPart + wF * ifacePart + wR * regionPart;

  return {
    composite,
    components: {
      iptmPart,
      interfaceFootprint: ifacePart,
      regionRecall: usesRegion ? regionPart : NaN
    },
    iptm,
    ptm,
    rankingScore: rankingRaw,
    displayConfidence
  };
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sampleStdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  if (m == null) return 0;
  const v =
    arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1);
  return Math.sqrt(Math.max(v, 0));
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Aggregate composite across up to N models; includes simple consensus spread.
 * @param {number[]} composites - each in [0,1]
 * @param {number} [maxModels]
 */
export function aggregateCompositeScores(composites, maxModels = 5) {
  const slice = composites
    .slice(0, maxModels)
    .filter((x) => Number.isFinite(x));
  if (!slice.length) {
    return {
      modelCount: 0,
      mean: null,
      median: null,
      stdev: null,
      min: null,
      max: null,
      consensus: null
    };
  }

  const m = mean(slice);
  const med = median(slice);
  const sd = sampleStdev(slice);
  const consensus =
    m != null ? Math.min(1, Math.max(0, 1 / (1 + sd * 4))) : null;

  return {
    modelCount: slice.length,
    mean: m,
    median: med,
    stdev: sd,
    min: Math.min(...slice),
    max: Math.max(...slice),
    consensus
  };
}

function ifaceForOverlap(ifaceBlock) {
  if (ifaceBlock && typeof ifaceBlock === "object") {
    return {
      baitInterfaceResidues: ifaceBlock.baitInterfaceResidues ?? [],
      preyInterfaceResidues: ifaceBlock.preyInterfaceResidues ?? []
    };
  }
  return { baitInterfaceResidues: [], preyInterfaceResidues: [] };
}

/**
 * Full pair-level report: per-model rows + aggregate.
 * @param {{
 *   pair: { bait?: object, prey?: object },
 *   models: {
 *     modelId: string,
 *     metrics?: object | null,
 *     rankingNumericHints?: object | null,
 *     interface: object | null,
 *     interfaceOk: boolean,
 *     warnings?: string[]
 *   }[]
 * }} input
 * @param {typeof DEFAULT_SCORE_WEIGHTS} [weights]
 */
export function buildPairScoreReport(input, weights = DEFAULT_SCORE_WEIGHTS) {
  const pair = input.pair ?? {};

  const perModel = [];

  for (const m of input.models) {
    const ifaceBlock = m.interfaceOk ? m.interface : null;
    const overlap = pairRegionOverlapSummary(
      { bait: pair.bait, prey: pair.prey },
      ifaceForOverlap(ifaceBlock)
    );

    const score = scoreSingleModel(
      {
        metrics: m.metrics,
        rankingNumericHints: m.rankingNumericHints ?? null,
        interface: ifaceBlock,
        regionOverlap: overlap
      },
      weights
    );

    perModel.push({
      modelId: m.modelId,
      interfaceOk: m.interfaceOk,
      warnings: m.warnings ?? [],
      regionOverlap: overlap,
      iptm: score.iptm,
      ptm: score.ptm,
      rankingScore: score.rankingScore,
      displayConfidence: score.displayConfidence,
      composite: score.composite,
      components: score.components,
      interface: ifaceBlock
    });
  }

  const composites = perModel.map((r) => r.composite);
  const aggregate = aggregateCompositeScores(composites, 5);

  return {
    version: 1,
    weights,
    perModel,
    aggregate: {
      ...aggregate,
      rankScore100:
        aggregate.mean != null
          ? Math.round(aggregate.mean * 1000) / 10
          : null
    }
  };
}

/**
 * Choose up to `maxModels` structures with mmCIF paths, preferring higher ranking scores when present.
 * @param {{ models?: object[] }} job
 * @param {number} [maxModels]
 */
export function pickModelsForPairAnalysis(job, maxModels = 5) {
  const cap =
    Number.isInteger(maxModels) && maxModels >= 1
      ? Math.min(maxModels, 5)
      : 5;
  const models = Array.isArray(job?.models) ? job.models : [];
  const withCif = models.filter((m) => m && m.cifRelativePath);

  function rankingScore(m) {
    const n = m.ranking?.numericHints;
    if (!n || typeof n !== "object") return -Infinity;
    for (const [k, v] of Object.entries(n)) {
      if (k.includes("ranking") && k.includes("score")) {
        const x = Number(v);
        return Number.isFinite(x) ? x : -Infinity;
      }
    }
    for (const key of ["ranking_score", "score"]) {
      if (key in n && n[key] != null) {
        const x = Number(n[key]);
        if (Number.isFinite(x)) return x;
      }
    }
    return -Infinity;
  }

  withCif.sort((a, b) => {
    const d = rankingScore(b) - rankingScore(a);
    if (d !== 0) return d;
    if (a.kind === b.kind) return String(a.modelId).localeCompare(String(b.modelId));
    const sampleLike = (k) => k === "sample" || k === "indexed";
    if (sampleLike(a.kind) && !sampleLike(b.kind)) return -1;
    if (sampleLike(b.kind) && !sampleLike(a.kind)) return 1;
    return String(a.modelId).localeCompare(String(b.modelId));
  });

  return withCif.slice(0, cap);
}
