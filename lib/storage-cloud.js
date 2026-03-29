/**
 * Vercel Blob + Supabase persistence (serverless-friendly).
 */

import fs from "fs/promises";
import path from "path";
import { put, get } from "@vercel/blob";
import { getSupabaseAdmin } from "./supabase-admin.js";
import {
  blobPathExportBatch,
  blobPathExtractedFile,
  blobPathParsedJson,
  blobPathExtractedPrefix,
  safeRelativePosix
} from "./storage-config.js";

function blobToken() {
  const t = process.env.BLOB_READ_WRITE_TOKEN;
  if (!t) throw new Error("BLOB_READ_WRITE_TOKEN is not set.");
  return t;
}

const putOpts = () => ({
  access: "private",
  addRandomSuffix: false,
  token: blobToken()
});

/**
 * @param {string} pathname
 */
export async function getBlobText(pathname) {
  const res = await get(pathname, {
    access: "private",
    token: blobToken()
  });
  if (!res || res.statusCode !== 200 || !res.stream) {
    throw new Error(`Blob not found or empty: ${pathname}`);
  }
  return new Response(res.stream).text();
}

/**
 * @param {string} pathname
 * @returns {Promise<Buffer>}
 */
export async function getBlobBuffer(pathname) {
  const res = await get(pathname, {
    access: "private",
    token: blobToken()
  });
  if (!res || res.statusCode !== 200 || !res.stream) {
    throw new Error(`Blob not found or empty: ${pathname}`);
  }
  const ab = await new Response(res.stream).arrayBuffer();
  return Buffer.from(ab);
}

/**
 * @param {string} sessionId
 * @param {string} ingestId
 * @param {object} envelope
 * @param {string} extractedDirAbs - local temp directory of extracted ZIP
 */
export async function commitParsedIngestCloud(
  sessionId,
  ingestId,
  envelope,
  extractedDirAbs
) {
  const parsedPathname = blobPathParsedJson(sessionId, ingestId);
  const extractedPrefix = blobPathExtractedPrefix(sessionId, ingestId);

  async function walk(relDir) {
    const abs = path.join(extractedDirAbs, relDir);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      const nextRel = relDir ? `${relDir}/${e.name}` : e.name;
      const nextAbs = path.join(abs, e.name);
      if (e.isDirectory()) {
        await walk(nextRel);
      } else {
        const relPosix = nextRel.split(path.sep).join("/");
        safeRelativePosix(relPosix);
        const buf = await fs.readFile(nextAbs);
        const pathname = blobPathExtractedFile(sessionId, ingestId, relPosix);
        await put(pathname, buf, putOpts());
      }
    }
  }

  await walk("");

  const outEnvelope = {
    ...envelope,
    paths: {
      storage: "vercel-blob",
      parsedPathname,
      extractedPrefix
    }
  };

  await put(
    parsedPathname,
    JSON.stringify(outEnvelope),
    putOpts()
  );

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("af3_ingests").insert({
    session_id: String(sessionId),
    ingest_id: String(ingestId),
    parsed_pathname: parsedPathname,
    extracted_prefix: extractedPrefix
  });
  if (error) throw error;

  return { envelope: outEnvelope, paths: outEnvelope.paths };
}

/**
 * @param {string} sessionId
 * @param {string} ingestId
 */
export async function loadParsedEnvelopeCloud(sessionId, ingestId) {
  const pathname = blobPathParsedJson(sessionId, ingestId);
  const raw = await getBlobText(pathname);
  return JSON.parse(raw);
}

/**
 * @param {string} sessionId
 */
export async function listIngestIdsForSessionCloud(sessionId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("af3_ingests")
    .select("ingest_id, created_at")
    .eq("session_id", String(sessionId))
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => r.ingest_id);
}

/**
 * @param {object} manifest
 * @param {string} sessionId
 */
export async function savePairsManifestCloud(sessionId, manifest) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("af3_session_manifests").upsert(
    {
      session_id: String(sessionId),
      manifest,
      updated_at: new Date().toISOString()
    },
    { onConflict: "session_id" }
  );
  if (error) throw error;
  return `supabase:af3_session_manifests:${sessionId}`;
}

/**
 * @param {string} sessionId
 */
export async function loadPairsManifestCloud(sessionId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("af3_session_manifests")
    .select("manifest")
    .eq("session_id", String(sessionId))
    .maybeSingle();
  if (error) throw error;
  return data?.manifest ?? null;
}

/**
 * @param {string} sessionId
 * @param {object[][]} batches
 */
export async function saveAf3ExportBatchesCloud(sessionId, batches) {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const files = [];

  for (let i = 0; i < batches.length; i++) {
    const chunk = batches[i];
    const fileName = `batch-${String(i + 1).padStart(4, "0")}-of-${String(
      batches.length
    ).padStart(4, "0")}.json`;
    const pathname = blobPathExportBatch(sessionId, runId, fileName);
    const body = JSON.stringify(chunk);
    await put(pathname, body, putOpts());
    files.push({
      batchIndex: i,
      jobCount: chunk.length,
      pathname,
      fileName
    });
  }

  return { runId, files };
}

/**
 * Read one extracted member (e.g. mmCIF) as UTF-8 text.
 * @param {string} extractedPrefix - ends with /
 * @param {string} relativePath
 */
/**
 * @returns {Promise<{ sessionId: string, pairCount: number, ingestCount: number, hasManifest: boolean, updatedAt: string | null }[]>}
 */
export async function listSessionsCloud() {
  const supabase = getSupabaseAdmin();
  const { data: manRows, error: e1 } = await supabase
    .from("af3_session_manifests")
    .select("session_id, updated_at, manifest");
  if (e1) throw e1;

  const { data: ingRows, error: e2 } = await supabase
    .from("af3_ingests")
    .select("session_id, created_at");
  if (e2) throw e2;

  /** @type {Map<string, { sessionId: string, pairCount: number, ingestCount: number, hasManifest: boolean, updatedAt: string | null }>} */
  const map = new Map();

  for (const r of manRows ?? []) {
    const sid = String(r.session_id);
    const m = r.manifest;
    const pc =
      m && typeof m === "object"
        ? m.pairCount ?? m.pairs?.length ?? 0
        : 0;
    map.set(sid, {
      sessionId: sid,
      pairCount: Number(pc) || 0,
      ingestCount: 0,
      hasManifest: true,
      updatedAt: r.updated_at ?? null
    });
  }

  /** @type {Map<string, { count: number, latest: string | null }>} */
  const ingestBySession = new Map();
  for (const r of ingRows ?? []) {
    const sid = String(r.session_id);
    const t = r.created_at ?? null;
    const cur = ingestBySession.get(sid) ?? { count: 0, latest: null };
    cur.count += 1;
    if (t && (!cur.latest || t > cur.latest)) cur.latest = t;
    ingestBySession.set(sid, cur);
  }

  for (const [sid, ag] of ingestBySession) {
    const row = map.get(sid);
    if (row) {
      row.ingestCount = ag.count;
      if (ag.latest && (!row.updatedAt || ag.latest > row.updatedAt)) {
        row.updatedAt = ag.latest;
      }
    } else {
      map.set(sid, {
        sessionId: sid,
        pairCount: 0,
        ingestCount: ag.count,
        hasManifest: false,
        updatedAt: ag.latest
      });
    }
  }

  return [...map.values()].sort((a, b) => {
    const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return tb - ta;
  });
}

export async function readExtractedBlobUtf8(extractedPrefix, relativePath) {
  const rel = safeRelativePosix(relativePath);
  const prefix = extractedPrefix.endsWith("/")
    ? extractedPrefix
    : `${extractedPrefix}/`;
  const pathname = `${prefix}${rel}`;
  return getBlobText(pathname);
}

export async function readExtractedBlobBuffer(extractedPrefix, relativePath) {
  const rel = safeRelativePosix(relativePath);
  const prefix = extractedPrefix.endsWith("/")
    ? extractedPrefix
    : `${extractedPrefix}/`;
  const pathname = `${prefix}${rel}`;
  return getBlobBuffer(pathname);
}
