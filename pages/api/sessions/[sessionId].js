/**
 * GET /api/sessions/:sessionId — manifest, proteins, ingest ids (session restore).
 */

import { loadPairsManifest, listIngestIdsForSession } from "@/lib/storage";
import { proteinsFromManifestPairs } from "@/lib/pairs";

function assertSafeSessionId(raw) {
  const s = raw != null ? String(raw).trim() : "";
  if (!s || s.length > 128 || /[/\\]|\.\./.test(s)) {
    return null;
  }
  return s;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const sessionId = assertSafeSessionId(req.query.sessionId);
  if (!sessionId) {
    return res.status(400).json({ error: "Invalid or missing sessionId." });
  }

  try {
    const manifest = await loadPairsManifest(sessionId);
    const ingestIds = await listIngestIdsForSession(sessionId);
    const latestIngestId =
      ingestIds.length > 0 ? ingestIds[ingestIds.length - 1] : null;
    const proteins = manifest ? proteinsFromManifestPairs(manifest) : [];

    return res.status(200).json({
      ok: true,
      sessionId,
      hasManifest: Boolean(manifest),
      pairCount:
        manifest?.pairCount ??
        (Array.isArray(manifest?.pairs) ? manifest.pairs.length : 0),
      proteins,
      ingestIds,
      latestIngestId
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({
      error: "Failed to load session.",
      details: msg
    });
  }
}
