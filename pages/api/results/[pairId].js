/**
 * GET /api/results/:pairId?sessionId=…&ingestId=…(optional)
 * Full pair detail: job tree, per-model metrics/ranking paths, and aggregate pairSummary.
 */

import {
  loadParsedEnvelope,
  findPairOccurrencesInSession,
  findJobByPairId,
  buildPairDetailPayload
} from "@/lib/results-query";
import { normalizeIngestId } from "@/lib/ingest-id";

function firstString(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "").trim();
  return String(v).trim();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const pairIdRaw = req.query.pairId;
  const pairId = Array.isArray(pairIdRaw)
    ? String(pairIdRaw[0] ?? "")
    : String(pairIdRaw ?? "");
  const sessionId = firstString(req.query.sessionId);
  const ingestId = normalizeIngestId(firstString(req.query.ingestId));

  if (!sessionId) {
    return res.status(400).json({
      error: "Query parameter sessionId is required."
    });
  }
  if (!pairId.trim()) {
    return res.status(400).json({ error: "pairId is required in the path." });
  }

  try {
    if (ingestId) {
      const envelope = await loadParsedEnvelope(sessionId, ingestId);
      const job = findJobByPairId(envelope, pairId);
      if (!job) {
        return res.status(404).json({
          error: "pairId not found in this ingest.",
          sessionId,
          ingestId,
          pairId: pairId.trim()
        });
      }
      const detail = buildPairDetailPayload(envelope, job, ingestId);
      return res.status(200).json({ ok: true, ...detail });
    }

    const matches = await findPairOccurrencesInSession(sessionId, pairId);
    if (matches.length === 0) {
      return res.status(404).json({
        error: "pairId not found in any ingest for this session.",
        sessionId,
        pairId: pairId.trim()
      });
    }
    if (matches.length > 1) {
      return res.status(409).json({
        error:
          "pairId appears in multiple ingests; pass ingestId to disambiguate.",
        sessionId,
        pairId: pairId.trim(),
        matches: matches.map((m) => ({
          ingestId: m.ingestId,
          extractedAt: m.envelope.extractedAt ?? null,
          inferredJobName: m.job.inferredJobName ?? null,
          filePrefix: m.job.filePrefix ?? null
        }))
      });
    }

    const { ingestId: onlyId, envelope, job } = matches[0];
    const detail = buildPairDetailPayload(envelope, job, onlyId);
    return res.status(200).json({ ok: true, ...detail });
  } catch (e) {
    if (e && e.code === "ENOENT") {
      return res.status(404).json({
        error: "parsed.json not found for the requested ingest.",
        sessionId,
        ingestId: ingestId || null
      });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({
      error: "Failed to load pair detail.",
      details: msg
    });
  }
}
