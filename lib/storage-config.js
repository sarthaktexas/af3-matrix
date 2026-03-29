/**
 * Cloud storage is enabled when Blob + Supabase env vars are all set.
 * Set AF3_USE_LOCAL_STORAGE=1 to always use ./data/af3-matrix (e.g. you have cloud
 * keys in .env but ingests only exist on disk).
 */

export const BLOB_STORE_PREFIX = "af3-matrix";

function truthyEnv(name) {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isCloudStorageConfigured() {
  if (truthyEnv("AF3_USE_LOCAL_STORAGE")) {
    return false;
  }
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function blobPathParsedJson(sessionId, ingestId) {
  return `${BLOB_STORE_PREFIX}/sessions/${encodePathSegment(sessionId)}/ingest/${encodePathSegment(ingestId)}/parsed.json`;
}

export function blobPathExtractedPrefix(sessionId, ingestId) {
  return `${BLOB_STORE_PREFIX}/sessions/${encodePathSegment(sessionId)}/ingest/${encodePathSegment(ingestId)}/extracted/`;
}

export function blobPathExtractedFile(sessionId, ingestId, relativePosix) {
  const rel = safeRelativePosix(relativePosix);
  return `${blobPathExtractedPrefix(sessionId, ingestId)}${rel}`;
}

export function blobPathExportBatch(sessionId, runId, fileName) {
  return `${BLOB_STORE_PREFIX}/sessions/${encodePathSegment(sessionId)}/exports/${encodePathSegment(runId)}/${fileName}`;
}

function encodePathSegment(s) {
  return String(s).replace(/[/\\]/g, "_");
}

/**
 * @param {string} rel
 */
export function safeRelativePosix(rel) {
  const parts = String(rel || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  for (const p of parts) {
    if (p === "." || p === "..") {
      throw new Error(`Invalid relative path: ${rel}`);
    }
  }
  return parts.join("/");
}
