/**
 * Map /api/results/upload summary `jobs` into InteractionMatrix `results` entries.
 * Keys are manifest matrix keys: `${baitName}:${preyName}`.
 *
 * Cell values use ipTM (0–1) when present — not raw ranking_score, which AF3 can emit on ~[-100, 1.5].
 */

import { displayConfidenceFromScalars } from "./scoring.js";
import {
  extractIptmPtmFromModel,
  extractRankingScoreFromModel
} from "./results-query.js";

function firstFinite(...vals) {
  for (const v of vals) {
    if (v == null || v === "") continue;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * @param {{ iptm?: number | null, ptm?: number | null, ranking?: number | null }} s
 * @returns {{ score: number, ipTM: number }}
 */
export function matrixCellScoresFromScalars(s) {
  const iptm = firstFinite(s?.iptm);
  const ptm = firstFinite(s?.ptm);
  const rk = firstFinite(s?.ranking);
  const ipTM = displayConfidenceFromScalars({
    iptm,
    ptm,
    rankingRaw: rk
  });
  return { score: ipTM, ipTM };
}

function scoreModelForPick(m) {
  const { iptm, ptm } = extractIptmPtmFromModel(m);
  const rk = extractRankingScoreFromModel(m);
  return {
    iptmW: iptm != null && Number.isFinite(iptm) ? iptm : -1,
    ptmW: ptm != null && Number.isFinite(ptm) ? ptm : -1,
    rankW:
      rk != null && Number.isFinite(rk)
        ? displayConfidenceFromScalars({
            iptm: null,
            ptm: null,
            rankingRaw: rk
          })
        : -1
  };
}

/**
 * Prefer aggregate_top; else the sample with best ipTM (then pTM, then ranking proxy).
 * @param {unknown[]} models
 */
export function pickRepresentativeModelForMatrix(models) {
  if (!Array.isArray(models) || models.length === 0) return null;
  const agg = models.find((m) => m && m.kind === "aggregate_top");
  if (agg) return agg;

  const scored = models
    .filter((m) => m && typeof m === "object")
    .map((m) => ({ m, ...scoreModelForPick(m) }));
  if (scored.length === 0) return null;
  scored.sort((a, b) => {
    if (b.iptmW !== a.iptmW) return b.iptmW - a.iptmW;
    if (b.ptmW !== a.ptmW) return b.ptmW - a.ptmW;
    return b.rankW - a.rankW;
  });
  return scored[0].m;
}

/**
 * @param {unknown} jobs
 * @returns {Map<string, { score: number, ipTM: number, hasResult: boolean }>}
 */
export function resultsMapFromUploadJobs(jobs) {
  const map = new Map();
  if (!Array.isArray(jobs)) return map;

  for (const job of jobs) {
    const key = job?.matrixKey;
    if (!key || typeof key !== "string") continue;

    const models = job.models || [];
    const model = pickRepresentativeModelForMatrix(models);
    if (!model) continue;

    const { iptm, ptm } = extractIptmPtmFromModel(model);
    const ranking =
      extractRankingScoreFromModel(model) ??
      (model.metrics && typeof model.metrics === "object"
        ? firstFinite(
            model.metrics.ranking_score,
            model.metrics.aggregate_score,
            model.metrics.confidence_score
          )
        : null);

    const { score, ipTM } = matrixCellScoresFromScalars({
      iptm,
      ptm,
      ranking
    });

    map.set(key, {
      score,
      ipTM,
      hasResult: true,
      pairId: job.pairId ?? null
    });
  }

  return map;
}

/**
 * One ingest summary from GET /api/results (`ingests[]` item).
 * @param {unknown} ingest
 * @returns {Map<string, { score: number, ipTM: number, hasResult: boolean }>}
 */
export function resultsMapFromResultsIngest(ingest) {
  const map = new Map();
  const pairs = ingest?.pairs;
  if (!Array.isArray(pairs)) return map;

  for (const row of pairs) {
    const key = row?.matrixKey;
    if (!key || typeof key !== "string") continue;
    const summary = row.summary ?? {};
    const iptm = firstFinite(summary.bestIptm, summary.meanIptm);
    const ptm = firstFinite(summary.meanPtm);
    const ranking = firstFinite(summary.bestRankingScore);
    const { score, ipTM } = matrixCellScoresFromScalars({
      iptm,
      ptm,
      ranking
    });

    map.set(key, {
      score,
      ipTM,
      hasResult: true,
      pairId: row.pairId ?? null
    });
  }

  return map;
}

/**
 * @param {{ ingests?: unknown[] }} payload - body from GET /api/results
 */
export function resultsMapFromSessionApiPayload(payload) {
  const ingests = payload?.ingests;
  if (!Array.isArray(ingests) || ingests.length === 0) return new Map();
  return resultsMapFromResultsIngest(ingests[ingests.length - 1]);
}
