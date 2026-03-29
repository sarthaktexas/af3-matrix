/**
 * Local disk persistence under data/af3-matrix (development / VPS).
 */

import fs from "fs/promises";
import path from "path";
import { getDataRoot } from "./storage-path.js";

export { getDataRoot } from "./storage-path.js";

export async function ensureDataDir() {
  await fs.mkdir(getDataRoot(), { recursive: true });
}

/**
 * @param {string} filePath
 * @param {unknown} data
 */
export async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(tmp, json, "utf8");
  await fs.rename(tmp, filePath);
}

/**
 * @param {string} filePath
 */
export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function sessionDir(sessionId) {
  return path.join(getDataRoot(), "sessions", String(sessionId));
}

export function pairsManifestPath(sessionId) {
  return path.join(sessionDir(sessionId), "pairs-manifest.json");
}

/**
 * @param {string} sessionId
 * @param {unknown} manifest
 */
export async function savePairsManifestLocal(sessionId, manifest) {
  await ensureDataDir();
  const filePath = pairsManifestPath(sessionId);
  await writeJsonAtomic(filePath, manifest);
  return filePath;
}

/**
 * @param {string} sessionId
 */
export async function loadPairsManifestLocal(sessionId) {
  const filePath = pairsManifestPath(sessionId);
  try {
    return await readJson(filePath);
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
}

export function parsedEnvelopePathLocal(sessionId, ingestId) {
  return path.join(
    getDataRoot(),
    "sessions",
    String(sessionId),
    "ingest",
    String(ingestId),
    "parsed.json"
  );
}

/**
 * @param {string} sessionId
 * @param {string} ingestId
 */
export async function loadParsedEnvelopeLocal(sessionId, ingestId) {
  return readJson(parsedEnvelopePathLocal(sessionId, ingestId));
}

export async function listIngestIdsForSessionLocal(sessionId) {
  const base = path.join(
    getDataRoot(),
    "sessions",
    String(sessionId),
    "ingest"
  );
  let names;
  try {
    names = await fs.readdir(base, { withFileTypes: true });
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw e;
  }

  const out = [];
  for (const d of names) {
    if (!d.isDirectory()) continue;
    const p = path.join(base, d.name, "parsed.json");
    try {
      const st = await fs.stat(p);
      if (st.isFile()) out.push(d.name);
    } catch {
      /* skip */
    }
  }
  out.sort();
  return out;
}

/**
 * @returns {Promise<{ sessionId: string, pairCount: number, ingestCount: number, hasManifest: boolean, updatedAt: string | null }[]>}
 */
export async function listSessionsLocal() {
  await ensureDataDir();
  const root = path.join(getDataRoot(), "sessions");
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw e;
  }

  /** @type {{ sessionId: string, pairCount: number, ingestCount: number, hasManifest: boolean, updatedAt: string | null }[]} */
  const out = [];

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const sessionId = ent.name;
    if (/[/\\]|\.\./.test(sessionId)) continue;

    let pairCount = 0;
    let hasManifest = false;
    let manifestMtime = 0;
    try {
      const mp = pairsManifestPath(sessionId);
      const st = await fs.stat(mp);
      manifestMtime = st.mtimeMs;
      const man = await readJson(mp);
      hasManifest = true;
      pairCount =
        (man && typeof man === "object"
          ? man.pairCount ?? man.pairs?.length
          : 0) ?? 0;
    } catch {
      /* no manifest */
    }

    const ingestIds = await listIngestIdsForSessionLocal(sessionId);
    let latestIngestMtime = 0;
    for (const iid of ingestIds) {
      try {
        const st = await fs.stat(parsedEnvelopePathLocal(sessionId, iid));
        if (st.mtimeMs > latestIngestMtime) latestIngestMtime = st.mtimeMs;
      } catch {
        /* skip */
      }
    }

    if (!hasManifest && ingestIds.length === 0) continue;

    const t = Math.max(manifestMtime, latestIngestMtime);
    out.push({
      sessionId,
      pairCount: Number(pairCount) || 0,
      ingestCount: ingestIds.length,
      hasManifest,
      updatedAt: t > 0 ? new Date(t).toISOString() : null
    });
  }

  out.sort((a, b) => {
    const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return tb - ta;
  });
  return out;
}

/**
 * @param {string} sessionId
 * @param {object} envelope
 * @param {string} parsedPathAbs
 */
export async function commitParsedIngestLocal(parsedPathAbs, envelope) {
  await writeJsonAtomic(parsedPathAbs, envelope);
  return { envelope, paths: envelope.paths };
}

/**
 * @param {string} sessionId
 * @param {object[][]} batches
 */
export async function saveAf3ExportBatchesLocal(sessionId, batches) {
  await ensureDataDir();
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(
    getDataRoot(),
    "sessions",
    String(sessionId),
    "exports",
    runId
  );
  const files = [];

  for (let i = 0; i < batches.length; i++) {
    const chunk = batches[i];
    const fileName = `batch-${String(i + 1).padStart(4, "0")}-of-${String(
      batches.length
    ).padStart(4, "0")}.json`;
    const filePath = path.join(dir, fileName);
    await writeJsonAtomic(filePath, chunk);
    files.push({
      batchIndex: i,
      jobCount: chunk.length,
      filePath
    });
  }

  return { runId, files };
}

/**
 * @param {string} extractedDirAbs
 * @param {string} relativePath
 */
export async function readExtractedLocalUtf8(extractedDirAbs, relativePath) {
  const rel = String(relativePath || "").replace(/\\/g, "/");
  if (rel.includes("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid relative path.");
  }
  const abs = path.join(extractedDirAbs, rel);
  return fs.readFile(abs, "utf8");
}

/**
 * Raw bytes (for gzip / binary-safe structure reads).
 * @param {string} extractedDirAbs
 * @param {string} relativePath
 * @returns {Promise<Buffer>}
 */
export async function readExtractedLocalBuffer(extractedDirAbs, relativePath) {
  const rel = String(relativePath || "").replace(/\\/g, "/");
  if (rel.includes("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid relative path.");
  }
  const abs = path.join(extractedDirAbs, rel);
  return fs.readFile(abs);
}
