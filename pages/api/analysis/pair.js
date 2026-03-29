/**
 * POST /api/analysis/pair
 * JSON body: { sessionId, ingestId, pairId? | matrixKey?, maxModels?, cutoffAngstrom?, maxMmcifBytes? }
 *
 * Runs interface detection + region overlap + composite scoring for one ingested AF3 job.
 * Kept separate from /api/results/upload to stay within serverless time/memory for large ZIPs.
 */

import {
  loadParsedEnvelope,
  parsedEnvelopePath,
  readExtractedMemberStructureText
} from "@/lib/storage";
import { resolveJobFromParsed } from "@/lib/results-query";
import {
  analyzeInterfaceFromMmcifText,
  DEFAULT_MAX_MMCIF_BYTES
} from "@/lib/interface-analysis";
import {
  buildPairScoreReport,
  pickModelsForPairAnalysis,
  DEFAULT_SCORE_WEIGHTS
} from "@/lib/scoring";
import { normalizeIngestId } from "@/lib/ingest-id";

/** Vercel / Next: extend budget for mmCIF + distance work (requires compatible plan). */
export const maxDuration = 60;

function firstString(v) {
  if (v == null) return "";
  return String(v).trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON body." });
    }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "JSON body required." });
  }

  const sessionId = firstString(body.sessionId);
  const ingestId = normalizeIngestId(firstString(body.ingestId));
  const pairId = body.pairId != null ? firstString(body.pairId) : "";
  const matrixKey =
    body.matrixKey != null ? firstString(body.matrixKey) : "";

  if (!sessionId || !ingestId) {
    return res.status(400).json({
      error: "sessionId and ingestId are required."
    });
  }
  if (!pairId && !matrixKey) {
    return res.status(400).json({
      error: "Provide pairId or matrixKey to select a job."
    });
  }

  let maxModels = 5;
  if (body.maxModels != null) {
    const n = parseInt(String(body.maxModels), 10);
    if (Number.isInteger(n) && n >= 1) maxModels = Math.min(n, 5);
  }

  let cutoffAngstrom;
  if (body.cutoffAngstrom != null) {
    const c = Number(body.cutoffAngstrom);
    if (Number.isFinite(c) && c > 0 && c < 50) cutoffAngstrom = c;
  }

  let maxMmcifBytes;
  if (body.maxMmcifBytes != null) {
    const m = parseInt(String(body.maxMmcifBytes), 10);
    if (Number.isInteger(m) && m > 0) maxMmcifBytes = m;
  }

  const parsedPath = parsedEnvelopePath(sessionId, ingestId);

  let parsed;
  try {
    parsed = await loadParsedEnvelope(sessionId, ingestId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const notFound =
      (e && e.code === "ENOENT") || /not found|Blob not found/i.test(msg);
    if (notFound) {
      return res.status(404).json({
        error: "Parsed ingest not found.",
        parsedPath
      });
    }
    return res.status(500).json({
      error: "Failed to read parsed envelope.",
      details: msg
    });
  }

  const job = resolveJobFromParsed(parsed, { pairId, matrixKey });
  if (!job) {
    return res.status(404).json({
      error: "No job matched pairId/matrixKey.",
      pairId: pairId || null,
      matrixKey: matrixKey || null
    });
  }

  const selected = pickModelsForPairAnalysis(job, maxModels);
  if (selected.length === 0) {
    return res.status(422).json({
      error: "No mmCIF models available for this job.",
      job: {
        filePrefix: job.filePrefix,
        pairId: job.pairId,
        modelCount: job.modelCount
      }
    });
  }

  const readOpts = {
    ...(cutoffAngstrom != null ? { cutoffAngstrom } : {})
  };

  const maxBytes =
    maxMmcifBytes != null && Number.isFinite(maxMmcifBytes)
      ? maxMmcifBytes
      : DEFAULT_MAX_MMCIF_BYTES;

  const modelsPayload = [];

  for (const m of selected) {
    let analysis;
    try {
      const text = await readExtractedMemberStructureText(parsed, m.cifRelativePath);
      const byteLen = Buffer.byteLength(text, "utf8");
      if (byteLen > maxBytes) {
        throw new Error(
          `mmCIF too large (${byteLen} bytes > ${maxBytes}); increase maxMmcifBytes or trim.`
        );
      }
      analysis = analyzeInterfaceFromMmcifText(text, readOpts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      modelsPayload.push({
        modelId: m.modelId,
        kind: m.kind,
        cifRelativePath: m.cifRelativePath,
        interfaceOk: false,
        interface: null,
        metrics: m.metrics ?? null,
        ranking: m.ranking ?? null,
        warnings: [`Failed to read/parse mmCIF: ${msg}`]
      });
      continue;
    }

    modelsPayload.push({
      modelId: m.modelId,
      kind: m.kind,
      cifRelativePath: m.cifRelativePath,
      interfaceOk: Boolean(analysis.ok),
      interface: analysis.interface,
      metrics: m.metrics ?? null,
      ranking: m.ranking ?? null,
      warnings: [...(analysis.warnings ?? [])],
      chains: analysis.chains,
      baitChain: analysis.baitChain,
      preyChain: analysis.preyChain,
      cutoffAngstrom: analysis.cutoffAngstrom
    });
  }

  const pairRecord = job.manifestMatch ?? { bait: {}, prey: {} };
  const report = buildPairScoreReport(
    {
      pair: pairRecord,
      models: modelsPayload.map((row) => ({
        modelId: row.modelId,
        metrics: row.metrics,
        rankingNumericHints: row.ranking?.numericHints ?? null,
        interface: row.interface,
        interfaceOk: row.interfaceOk,
        warnings: row.warnings
      }))
    },
    DEFAULT_SCORE_WEIGHTS
  );

  const perModel = report.perModel.map((row, i) => {
    const src = modelsPayload[i];
    return {
      ...row,
      kind: selected[i]?.kind ?? null,
      cifRelativePath: selected[i]?.cifRelativePath ?? null,
      chains: src?.chains ?? null,
      baitChain: src?.baitChain ?? null,
      preyChain: src?.preyChain ?? null,
      cutoffAngstrom: src?.cutoffAngstrom ?? null
    };
  });

  return res.status(200).json({
    ok: true,
    sessionId,
    ingestId,
    pairId: job.pairId ?? null,
    matrixKey: job.manifestMatch?.matrixKey ?? null,
    filePrefix: job.filePrefix,
    weights: report.weights,
    modelsAnalyzed: selected.length,
    perModel,
    aggregate: report.aggregate,
    meta: {
      extractedLocation:
        parsed.paths?.extractedDir ??
        parsed.paths?.extractedPrefix ??
        null,
      defaultWeights: DEFAULT_SCORE_WEIGHTS,
      note:
        "Upload parsing stays in /api/results/upload; this route reads the envelope + mmCIF from storage."
    }
  });
}
