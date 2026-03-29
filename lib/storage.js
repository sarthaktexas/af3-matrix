/**
 * Storage router: local disk (default) or Vercel Blob + Supabase when env is complete.
 *
 * Required for cloud mode:
 *   BLOB_READ_WRITE_TOKEN
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import path from "path";
import crypto from "crypto";
import { isCloudStorageConfigured, blobPathParsedJson } from "./storage-config.js";
import * as local from "./storage-local.js";
import * as cloud from "./storage-cloud.js";
import { decodeStructureBytesToText } from "./structure-decode.js";

export function isCloudStorage() {
  return isCloudStorageConfigured();
}

export { isCloudStorageConfigured };

export function getDataRoot() {
  return local.getDataRoot();
}

export async function ensureDataDir() {
  if (!isCloudStorageConfigured()) await local.ensureDataDir();
}

export async function writeJsonAtomic(filePath, data) {
  return local.writeJsonAtomic(filePath, data);
}

export async function readJson(filePath) {
  return local.readJson(filePath);
}

export function pairsManifestPath(sessionId) {
  return local.pairsManifestPath(sessionId);
}

export async function savePairsManifest(sessionId, manifest) {
  return isCloudStorageConfigured()
    ? cloud.savePairsManifestCloud(sessionId, manifest)
    : local.savePairsManifestLocal(sessionId, manifest);
}

export async function loadPairsManifest(sessionId) {
  return isCloudStorageConfigured()
    ? cloud.loadPairsManifestCloud(sessionId)
    : local.loadPairsManifestLocal(sessionId);
}

/**
 * Display / error path (local absolute path or blob key).
 */
export function parsedEnvelopePath(sessionId, ingestId) {
  if (isCloudStorageConfigured()) {
    return `vercel-blob:${blobPathParsedJson(sessionId, ingestId)}`;
  }
  return local.parsedEnvelopePathLocal(sessionId, ingestId);
}

export async function loadParsedEnvelope(sessionId, ingestId) {
  return isCloudStorageConfigured()
    ? cloud.loadParsedEnvelopeCloud(sessionId, ingestId)
    : local.loadParsedEnvelopeLocal(sessionId, ingestId);
}

export async function listIngestIdsForSession(sessionId) {
  return isCloudStorageConfigured()
    ? cloud.listIngestIdsForSessionCloud(sessionId)
    : local.listIngestIdsForSessionLocal(sessionId);
}

export async function listSessions() {
  if (isCloudStorageConfigured()) return cloud.listSessionsCloud();
  await ensureDataDir();
  return local.listSessionsLocal();
}

/**
 * Persist one ingest: local writes `parsed.json` next to `extracted/`; cloud uploads tree + row.
 * @param {string} sessionId
 * @param {string} ingestId
 * @param {object} envelope - must include `paths` for local mode before call
 * @param {string} ingestBaseAbs - directory containing `extracted/` (and `parsed.json` for local)
 */
export async function commitParsedIngest(sessionId, ingestId, envelope, ingestBaseAbs) {
  if (isCloudStorageConfigured()) {
    const extractedDirAbs = path.join(ingestBaseAbs, "extracted");
    return cloud.commitParsedIngestCloud(
      sessionId,
      ingestId,
      envelope,
      extractedDirAbs
    );
  }
  const parsedPathAbs = path.join(ingestBaseAbs, "parsed.json");
  return local.commitParsedIngestLocal(parsedPathAbs, envelope);
}

export async function saveAf3ExportBatches(sessionId, batches) {
  return isCloudStorageConfigured()
    ? cloud.saveAf3ExportBatchesCloud(sessionId, batches)
    : local.saveAf3ExportBatchesLocal(sessionId, batches);
}

/**
 * Read one file from an ingest envelope (local `extractedDir` or blob `extractedPrefix`).
 * @param {object} parsedEnvelope - full parsed document
 * @param {string} relativePath - job model `cifRelativePath`
 */
export async function readExtractedMemberUtf8(parsedEnvelope, relativePath) {
  const p = parsedEnvelope?.paths;
  if (!p || typeof p !== "object") {
    throw new Error("Envelope missing paths.");
  }
  if (p.storage === "vercel-blob") {
    return cloud.readExtractedBlobUtf8(p.extractedPrefix, relativePath);
  }
  if (p.extractedDir) {
    return local.readExtractedLocalUtf8(p.extractedDir, relativePath);
  }
  throw new Error("Cannot resolve extracted files for this envelope.");
}

/**
 * Read mmCIF/PDB (or gzip-wrapped) from extracted ingest. Prefer this for coordinate files.
 */
export async function readExtractedMemberStructureText(parsedEnvelope, relativePath) {
  const p = parsedEnvelope?.paths;
  if (!p || typeof p !== "object") {
    throw new Error("Envelope missing paths.");
  }
  let buf;
  if (p.storage === "vercel-blob") {
    buf = await cloud.readExtractedBlobBuffer(p.extractedPrefix, relativePath);
  } else if (p.extractedDir) {
    buf = await local.readExtractedLocalBuffer(p.extractedDir, relativePath);
  } else {
    throw new Error("Cannot resolve extracted files for this envelope.");
  }
  return decodeStructureBytesToText(buf);
}

export function createSessionId() {
  return crypto.randomBytes(12).toString("hex");
}
