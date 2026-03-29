/**
 * POST /api/af3/export
 * Body: { sessionId: string, batchSize?: number }
 *
 * Loads the session pairs manifest, builds AlphaFold Server batch JSON (list of jobs
 * per file chunk), writes each chunk under data/af3-matrix/sessions/<id>/exports/<runId>/,
 * and returns the same batch payloads in the response.
 */

import {
  chunkIntoBatches,
  jobsFromManifest,
  parseBatchSize,
  saveAf3ExportBatches
} from "@/lib/af3-export";
import { loadPairsManifest } from "@/lib/storage";

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

  const sessionId =
    body?.sessionId != null ? String(body.sessionId).trim() : "";
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required." });
  }

  let batchSize;
  try {
    batchSize = parseBatchSize(body?.batchSize);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(400).json({ error: msg });
  }

  let manifest;
  try {
    manifest = await loadPairsManifest(sessionId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({
      error: "Failed to read pairs manifest.",
      details: msg
    });
  }

  if (!manifest) {
    return res.status(404).json({
      error: "No pairs manifest for this session. Run POST /api/pairs/generate first."
    });
  }

  let jobs;
  try {
    jobs = jobsFromManifest(manifest);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(400).json({ error: msg });
  }

  const batches = chunkIntoBatches(jobs, batchSize);

  let saved;
  try {
    saved = await saveAf3ExportBatches(sessionId, batches);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({
      error: "Failed to write AF3 export files.",
      details: msg
    });
  }

  return res.status(200).json({
    sessionId,
    batchSize,
    dialect: "alphafoldserver",
    totalJobs: jobs.length,
    batchCount: batches.length,
    exportRunId: saved.runId,
    savedFiles: saved.files.map((f) => ({
      batchIndex: f.batchIndex,
      jobCount: f.jobCount,
      path: f.filePath ?? f.pathname ?? null,
      ...(f.pathname ? { pathname: f.pathname } : {})
    })),
    batches
  });
}
