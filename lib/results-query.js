/**
 * Read and summarize AF3 ingest envelopes (`parsed.json`) for results APIs.
 */

import {
  parsedEnvelopePath,
  loadParsedEnvelope,
  listIngestIdsForSession
} from "./storage.js";
import { extractIptmPtmFromModelLike } from "./scoring.js";

export { parsedEnvelopePath, loadParsedEnvelope, listIngestIdsForSession };

/**
 * @param {string | null | undefined} pairId
 */
export function normalizePairId(pairId) {
  return String(pairId ?? "").trim().toLowerCase();
}

/**
 * Matrix key for UI: manifest when present, else parse `af3m_{pairId}_{bait}__{prey}` job folder names.
 * @param {object} job
 */
export function effectiveMatrixKeyForJob(job) {
  const fromManifest = String(job?.manifestMatch?.matrixKey ?? "").trim();
  if (fromManifest) return fromManifest;
  for (const text of [job?.folderBasename, job?.inferredJobName]) {
    if (!text) continue;
    const m = String(text).match(/^af3m_p_[0-9a-f]{16}_(.+?)__(.+)$/i);
    if (m) return `${m[1]}:${m[2]}`;
  }
  return null;
}

/**
 * @param {object} envelope
 * @param {string} pairId
 */
export function findJobByPairId(envelope, pairId) {
  const pid = normalizePairId(pairId);
  if (!pid) return null;
  const jobs = Array.isArray(envelope?.jobs) ? envelope.jobs : [];
  return (
    jobs.find((j) => normalizePairId(j?.pairId) === pid) ?? null
  );
}

/**
 * @param {object} envelope
 * @param {string} matrixKey
 */
export function findJobByMatrixKey(envelope, matrixKey) {
  const mk = String(matrixKey ?? "").trim();
  if (!mk) return null;
  const jobs = Array.isArray(envelope?.jobs) ? envelope.jobs : [];
  return (
    jobs.find((j) => effectiveMatrixKeyForJob(j) === mk) ?? null
  );
}

/**
 * @param {object} parsed
 * @param {{ pairId?: string, matrixKey?: string }} keys
 */
export function resolveJobFromParsed(parsed, keys) {
  const pairId = keys.pairId != null ? String(keys.pairId).trim() : "";
  const matrixKey =
    keys.matrixKey != null ? String(keys.matrixKey).trim() : "";
  if (pairId) {
    const j = findJobByPairId(parsed, pairId);
    if (j) return j;
  }
  if (matrixKey) {
    return findJobByMatrixKey(parsed, matrixKey);
  }
  return null;
}

/**
 * @param {object | null | undefined} model
 */
export function extractRankingScoreFromModel(model) {
  const m = model?.metrics;
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
  const n = model?.ranking?.numericHints;
  if (!n || typeof n !== "object") return null;
  for (const [k, v] of Object.entries(n)) {
    if (k.includes("ranking") && k.includes("score")) {
      const x = Number(v);
      return Number.isFinite(x) ? x : null;
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
 * Confidence JSON may be missing; ranking_scores.csv is still parsed into `ranking.numericHints`.
 * @param {object | null | undefined} model
 */
export function extractIptmPtmFromModel(model) {
  if (!model || typeof model !== "object") {
    return { iptm: null, ptm: null };
  }
  return extractIptmPtmFromModelLike(
    model.metrics,
    model.ranking?.numericHints ?? null
  );
}

function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Aggregate confidence / ranking hints across models in one job.
 * @param {object} job
 */
export function buildPairSummaryStats(job) {
  const models = Array.isArray(job?.models) ? job.models : [];
  let bestIptm = null;
  let bestIptmModelId = null;
  const iptms = [];
  const ptms = [];
  const rankingScores = [];

  for (const m of models) {
    const { iptm, ptm } = extractIptmPtmFromModel(m);
    if (iptm != null && Number.isFinite(iptm)) {
      iptms.push(iptm);
      if (bestIptm == null || iptm > bestIptm) {
        bestIptm = iptm;
        bestIptmModelId = m.modelId ?? null;
      }
    }
    if (ptm != null && Number.isFinite(ptm)) ptms.push(ptm);
    const r = extractRankingScoreFromModel(m);
    if (r != null) rankingScores.push(r);
  }

  return {
    modelCount: models.length,
    modelsWithIptm: iptms.length,
    bestIptm,
    bestIptmModelId,
    meanIptm: mean(iptms),
    meanPtm: mean(ptms),
    bestRankingScore:
      rankingScores.length > 0 ? Math.max(...rankingScores) : null,
    meanRankingScore: mean(rankingScores)
  };
}

/**
 * @param {object} job
 * @param {string} ingestId
 */
export function pairRowForList(job, ingestId) {
  return {
    ingestId,
    pairId: job.pairId ?? null,
    matrixKey: effectiveMatrixKeyForJob(job),
    filePrefix: job.filePrefix,
    inferredJobName: job.inferredJobName,
    jobRootRelative: job.jobRootRelative ?? null,
    manifestMatched: Boolean(job.manifestMatch),
    modelCount: job.modelCount,
    summary: buildPairSummaryStats(job)
  };
}

/**
 * @param {object} envelope
 * @param {string} ingestId
 */
export function ingestSummaryForList(envelope, ingestId) {
  const jobs = Array.isArray(envelope?.jobs) ? envelope.jobs : [];
  return {
    ingestId,
    sessionId: envelope.sessionId ?? null,
    extractedAt: envelope.extractedAt ?? null,
    jobCount: envelope.jobCount ?? jobs.length,
    parseWarnings: envelope.parseWarnings ?? [],
    pairs: jobs.map((j) => pairRowForList(j, ingestId))
  };
}

/**
 * @param {string} sessionId
 * @param {{ ingestId?: string }} [filter]
 */
export async function listSessionResults(sessionId, filter = {}) {
  let ingestIds = await listIngestIdsForSession(sessionId);
  const one = filter.ingestId != null ? String(filter.ingestId).trim() : "";
  if (one) {
    ingestIds = ingestIds.filter((id) => id === one);
  }

  const ingests = [];
  for (const id of ingestIds) {
    const env = await loadParsedEnvelope(sessionId, id);
    ingests.push(ingestSummaryForList(env, id));
  }

  const pairTotal = ingests.reduce((n, g) => n + g.pairs.length, 0);
  return {
    sessionId: String(sessionId),
    ingestCount: ingests.length,
    pairCount: pairTotal,
    ingests
  };
}

/**
 * Clone job and attach normalized confidence fields per model.
 * @param {object} job
 */
export function jobWithDerivedModelFields(job) {
  const models = (job.models ?? []).map((m) => {
    const { iptm, ptm } = extractIptmPtmFromModel(m);
    return {
      ...m,
      derived: {
        iptm,
        ptm,
        rankingScore: extractRankingScoreFromModel(m)
      }
    };
  });
  return { ...job, models };
}

/**
 * Full detail payload for one pair (no `rawJsonByRelPath` — keep responses bounded).
 * @param {object} envelope
 * @param {object} job
 * @param {string} ingestId
 */
export function buildPairDetailPayload(envelope, job, ingestId) {
  return {
    sessionId: envelope.sessionId ?? null,
    ingestId,
    source: envelope.source ?? null,
    paths: envelope.paths ?? null,
    meta: {
      version: envelope.version,
      dialectHint: envelope.dialectHint,
      extractedAt: envelope.extractedAt,
      parseWarnings: envelope.parseWarnings ?? []
    },
    pairSummary: buildPairSummaryStats(job),
    job: jobWithDerivedModelFields(job)
  };
}

/**
 * @param {string} sessionId
 * @param {string} pairId
 * @returns {Promise<{ ingestId: string, envelope: object, job: object }[]>}
 */
export async function findPairOccurrencesInSession(sessionId, pairId) {
  const ingestIds = await listIngestIdsForSession(sessionId);
  const matches = [];
  for (const ingestId of ingestIds) {
    const envelope = await loadParsedEnvelope(sessionId, ingestId);
    const job = findJobByPairId(envelope, pairId);
    if (job) matches.push({ ingestId, envelope, job });
  }
  return matches;
}
