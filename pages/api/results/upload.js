/**
 * POST /api/results/upload
 * multipart/form-data: sessionId (optional), file | archive | zip = AF3 results .zip
 *
 * Extracts the archive, parses AF3-style outputs, persists envelope + extracted tree
 * (local disk or Vercel Blob + Supabase when configured).
 */

import path from "path";
import os from "os";
import fs from "fs/promises";
import formidable from "formidable";
import {
  createSessionId,
  ensureDataDir,
  getDataRoot,
  loadPairsManifest,
  commitParsedIngest,
  isCloudStorage
} from "@/lib/storage";
import {
  parseAf3ExtractedDirectory,
  safeUnzipToDir,
  summarizeIngestForResponse
} from "@/lib/parse-af3";
import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: "50mb"
  }
};

const MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024;

function firstFieldValue(fields, name) {
  const v = fields[name];
  if (v == null) return "";
  return Array.isArray(v) ? String(v[0] ?? "").trim() : String(v).trim();
}

function pickUploadedZip(files) {
  const candidates = ["file", "archive", "zip", "results"];
  for (const key of candidates) {
    const entry = files[key];
    const list = entry ? (Array.isArray(entry) ? entry : [entry]) : [];
    for (const f of list) {
      if (!f) continue;
      const name = (f.originalFilename || "").toLowerCase();
      const mime = (f.mimetype || "").toLowerCase();
      if (mime.includes("zip") || name.endsWith(".zip")) return f;
    }
  }
  for (const entry of Object.values(files)) {
    const list = entry ? (Array.isArray(entry) ? entry : [entry]) : [];
    for (const f of list) {
      if (f) return f;
    }
  }
  return null;
}

function ingestBaseDir(sessionId, ingestId) {
  return path.join(
    getDataRoot(),
    "sessions",
    String(sessionId),
    "ingest",
    String(ingestId)
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const cloud = isCloudStorage();
  if (!cloud) await ensureDataDir();

  const uploadDir = cloud
    ? path.join(os.tmpdir(), "af3-matrix-uploads")
    : path.join(getDataRoot(), "_tmp_uploads");
  await fs.mkdir(uploadDir, { recursive: true });

  const form = formidable({
    uploadDir,
    keepExtensions: true,
    maxFileSize: MAX_ZIP_BYTES,
    multiples: false
  });

  let fields;
  let files;
  try {
    [fields, files] = await form.parse(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(400).json({ error: "Upload parse failed.", details: msg });
  }

  let sessionId = firstFieldValue(fields, "sessionId");
  if (!sessionId) sessionId = createSessionId();

  const zipFile = pickUploadedZip(files);
  if (!zipFile || !zipFile.filepath) {
    return res.status(400).json({
      error: "No ZIP file found. Use field name file, archive, or zip."
    });
  }

  const ingestId = `${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
  const ingestBaseAbs = cloud
    ? path.join(os.tmpdir(), "af3-ingest", ingestId)
    : ingestBaseDir(sessionId, ingestId);
  const extractedDir = path.join(ingestBaseAbs, "extracted");
  const parsedPathAbs = path.join(ingestBaseAbs, "parsed.json");

  try {
    await fs.mkdir(ingestBaseAbs, { recursive: true });
    await safeUnzipToDir(zipFile.filepath, extractedDir);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (cloud) {
      try {
        await fs.rm(ingestBaseAbs, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    return res.status(500).json({
      error: "Failed to extract ZIP.",
      details: msg
    });
  } finally {
    try {
      await fs.unlink(zipFile.filepath);
    } catch {
      /* temp cleanup best-effort */
    }
  }

  let manifest = null;
  try {
    manifest = await loadPairsManifest(sessionId);
  } catch {
    manifest = null;
  }

  let parsed;
  try {
    parsed = await parseAf3ExtractedDirectory(extractedDir, { manifest });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (cloud) {
      try {
        await fs.rm(ingestBaseAbs, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    return res.status(500).json({
      error: "Failed to parse extracted results.",
      details: msg
    });
  }

  const envelope = {
    ...parsed,
    ingestId,
    sessionId,
    source: "af3_results_zip",
    paths: cloud
      ? {}
      : {
          extractedDir,
          parsedJson: parsedPathAbs
        }
  };

  let committed;
  try {
    committed = await commitParsedIngest(
      sessionId,
      ingestId,
      envelope,
      ingestBaseAbs
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (cloud) {
      try {
        await fs.rm(ingestBaseAbs, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    return res.status(500).json({
      error: "Failed to persist parsed ingest.",
      details: msg
    });
  }

  if (cloud) {
    try {
      await fs.rm(ingestBaseAbs, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  const pathsOut = committed.paths;
  return res.status(200).json({
    ok: true,
    ingestId,
    sessionId,
    storage: cloud ? "vercel-blob" : "local",
    parsedJsonPath: pathsOut.parsedJson ?? pathsOut.parsedPathname ?? null,
    extractedDir: pathsOut.extractedDir ?? pathsOut.extractedPrefix ?? null,
    ...summarizeIngestForResponse(parsed, sessionId)
  });
}
