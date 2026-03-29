/**
 * GET /api/results?sessionId=…&ingestId=…(optional)
 * Lists parsed AF3 ingests for a session and summarized pair rows.
 */

import {
  listSessionResults,
  listIngestIdsForSession
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

  const sessionId = firstString(req.query.sessionId);
  if (!sessionId) {
    return res.status(400).json({
      error: "Query parameter sessionId is required."
    });
  }

  const ingestId = normalizeIngestId(firstString(req.query.ingestId));

  try {
    const exists = (await listIngestIdsForSession(sessionId)).length > 0;
    if (!exists && !ingestId) {
      return res.status(200).json({
        ok: true,
        sessionId,
        ingestCount: 0,
        pairCount: 0,
        ingests: [],
        note: "No ingests with parsed.json for this session."
      });
    }

    const payload = await listSessionResults(sessionId, {
      ...(ingestId ? { ingestId } : {})
    });

    if (ingestId && payload.ingestCount === 0) {
      return res.status(404).json({
        error: "Ingest not found or missing parsed.json.",
        sessionId,
        ingestId
      });
    }

    return res.status(200).json({ ok: true, ...payload });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({
      error: "Failed to list results.",
      details: msg
    });
  }
}
