/**
 * POST /api/pairs/generate
 * Body: { proteins: ProteinInput[], sessionId?: string }
 *
 * ProteinInput matches the frontend: { id?, name, sequence, type: "bait"|"prey", regions?: [...] }
 * Optional sessionId reuses the same storage folder; otherwise a new id is returned.
 */

import { generatePairs } from "@/lib/pairs";
import {
  createSessionId,
  savePairsManifest
} from "@/lib/storage";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "2mb"
    }
  }
};

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

  const proteins = body?.proteins;
  const sessionId =
    body?.sessionId != null && String(body.sessionId).trim() !== ""
      ? String(body.sessionId).trim()
      : createSessionId();

  const { pairs, warnings, errors } = generatePairs(proteins);

  if (errors.length > 0) {
    return res.status(400).json({
      error: "Validation failed.",
      details: errors,
      ...(warnings.length > 0 ? { warnings } : {})
    });
  }

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    sessionId,
    pairCount: pairs.length,
    pairs
  };

  try {
    await savePairsManifest(sessionId, manifest);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({
      error: "Failed to save pairs manifest.",
      details: msg
    });
  }

  return res.status(200).json({
    sessionId,
    pairCount: pairs.length,
    pairs: pairs.map((p) => ({
      pairId: p.pairId,
      matrixKey: p.matrixKey,
      af3JobName: p.af3JobName,
      bait: p.bait,
      prey: p.prey
    })),
    ...(warnings.length > 0 ? { warnings } : {})
  });
}
