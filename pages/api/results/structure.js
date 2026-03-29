/**
 * GET /api/results/structure?sessionId=…&ingestId=…&relPath=…
 * Serves one extracted mmCIF/PDB file from a parsed ingest (local or blob).
 */

import {
  loadParsedEnvelope,
  readExtractedMemberStructureText
} from "@/lib/storage";
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
  const ingestId = normalizeIngestId(firstString(req.query.ingestId));
  const relPath = firstString(req.query.relPath);

  if (!sessionId || !ingestId || !relPath) {
    return res.status(400).json({
      error: "Query parameters sessionId, ingestId, and relPath are required."
    });
  }

  const lower = relPath.toLowerCase();
  const contentType = lower.endsWith(".pdb")
    ? "chemical/x-pdb"
    : lower.endsWith(".cif") || lower.endsWith(".mmcif")
      ? "chemical/x-mmcif"
      : "text/plain";

  try {
    const envelope = await loadParsedEnvelope(sessionId, ingestId);
    const text = await readExtractedMemberStructureText(envelope, relPath);
    res.setHeader("Content-Type", `${contentType}; charset=utf-8`);
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.status(200).send(text);
  } catch (e) {
    if (e && e.code === "ENOENT") {
      return res.status(404).json({ error: "Structure file not found." });
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (/Invalid relative path/i.test(msg)) {
      return res.status(400).json({ error: msg });
    }
    if (
      /Structure file is empty|Gzip decompression failed|binary or not text mmCIF/i.test(
        msg
      )
    ) {
      return res.status(400).json({ error: msg });
    }
    if (/not found|Blob not found/i.test(msg)) {
      return res.status(404).json({ error: "Structure file not found." });
    }
    return res.status(500).json({
      error: "Failed to read structure file.",
      details: msg
    });
  }
}
