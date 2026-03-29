/**
 * Bait × prey pair generation for AF3-matrix.
 *
 * Assumptions:
 * - Sequences are single-letter amino acid strings (no whitespace after normalize).
 * - Optional regions use 1-based inclusive residue indices on that protein's sequence
 *   (common convention in structural biology); they are not validated against AF3 chain IDs here.
 */

import crypto from "crypto";

const MAX_JOB_NAME_LEN = 120;

/** Strip whitespace and uppercase sequence for stable hashing (optional consistency). */
export function normalizeSequence(seq) {
  if (typeof seq !== "string") return "";
  return seq.replace(/\s/g, "").toUpperCase();
}

/**
 * Optional annotated regions per protein.
 * @typedef {{ start: number, end: number, label?: string, chain?: string }} ProteinRegion
 */

/**
 * @typedef {{ id?: string, name: string, sequence: string, type: "bait" | "prey", regions?: ProteinRegion[] }} ProteinInput
 */

/**
 * @typedef {{ pairId: string, matrixKey: string, af3JobName: string, bait: object, prey: object }} PairRecord
 */

function slugPart(s, maxLen = 24) {
  const base = String(s || "x")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLen) || "x";
  return base;
}

/**
 * Cryptographic fingerprint of the biological pair (names + normalized sequences).
 * Same bait/prey identity ⇒ same fingerprint even if client `id` values change.
 */
export function stablePairFingerprint(bait, prey) {
  const payload = JSON.stringify({
    b: String(bait.name || "").trim(),
    bs: normalizeSequence(bait.sequence),
    p: String(prey.name || "").trim(),
    ps: normalizeSequence(prey.sequence)
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function pairIdFromFingerprint(fingerprintHex) {
  return `p_${fingerprintHex.slice(0, 16)}`;
}

/**
 * Human-readable but unique-enough job name for AF3 uploads and ZIP contents.
 * Keep under typical path limits; pairId is the authoritative join key.
 */
export function makeAf3JobName(pairId, baitName, preyName) {
  const left = slugPart(baitName, 20);
  const right = slugPart(preyName, 20);
  let name = `af3m_${pairId}_${left}__${right}`;
  if (name.length > MAX_JOB_NAME_LEN) {
    name = name.slice(0, MAX_JOB_NAME_LEN);
  }
  return name;
}

/** Matrix cell key used by the frontend: `${baitName}:${preyName}`. */
export function matrixKeyForPair(baitName, preyName) {
  return `${String(baitName).trim()}:${String(preyName).trim()}`;
}

function isPositiveInt(n) {
  return Number.isInteger(n) && n >= 1;
}

/**
 * Normalize and lightly validate regions; invalid entries are dropped with reasons in optional log.
 */
export function normalizeRegions(regions, seqLen, proteinLabel) {
  if (!regions) return { regions: [], warnings: [] };
  if (!Array.isArray(regions)) {
    return {
      regions: [],
      warnings: [`${proteinLabel}: regions must be an array; ignored.`]
    };
  }
  const out = [];
  const warnings = [];
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (!r || typeof r !== "object") {
      warnings.push(`${proteinLabel}: region[${i}] is not an object; skipped.`);
      continue;
    }
    const start = Number(r.start);
    const end = Number(r.end);
    if (!isPositiveInt(start) || !isPositiveInt(end)) {
      warnings.push(
        `${proteinLabel}: region[${i}] needs integer start/end ≥ 1; skipped.`
      );
      continue;
    }
    if (start > end) {
      warnings.push(`${proteinLabel}: region[${i}] start > end; skipped.`);
      continue;
    }
    if (seqLen > 0 && (start > seqLen || end > seqLen)) {
      warnings.push(
        `${proteinLabel}: region[${i}] (${start}-${end}) outside sequence length ${seqLen}; kept but may be unusable for overlap.`
      );
    }
    out.push({
      start,
      end,
      ...(r.label != null ? { label: String(r.label) } : {}),
      ...(r.chain != null ? { chain: String(r.chain) } : {})
    });
  }
  return { regions: out, warnings };
}

/**
 * Validate one protein; returns { ok, protein, errors, warnings }.
 */
export function validateProtein(raw, role) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: [`Each ${role} must be an object.`], warnings };
  }
  const name = raw.name != null ? String(raw.name).trim() : "";
  const sequence = normalizeSequence(raw.sequence);
  if (!name) errors.push(`${role}: missing name.`);
  if (!sequence) errors.push(`${role} "${name || "(unnamed)"}": missing or empty sequence.`);

  const type = raw.type;
  if (type !== "bait" && type !== "prey") {
    errors.push(
      `${role} "${name || "(unnamed)"}": type must be "bait" or "prey" (got ${JSON.stringify(type)}).`
    );
  }

  const seqLen = sequence.length;
  const { regions, warnings: regWarnings } = normalizeRegions(
    raw.regions,
    seqLen,
    name || role
  );
  warnings.push(...regWarnings);

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const protein = {
    id: raw.id != null ? String(raw.id) : undefined,
    name,
    sequence,
    type,
    ...(regions.length > 0 ? { regions } : {})
  };
  return { ok: true, protein, errors: [], warnings };
}

/**
 * Full Cartesian product: every bait × every prey.
 * @param {ProteinInput[]} proteins
 * @returns {{ pairs: PairRecord[], warnings: string[], errors: string[] }}
 */
export function generatePairs(proteins) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(proteins)) {
    return {
      pairs: [],
      warnings: [],
      errors: ["Request body must include a `proteins` array."]
    };
  }
  if (proteins.length === 0) {
    return {
      pairs: [],
      warnings: [],
      errors: ["No proteins provided."]
    };
  }

  const validated = [];
  for (let i = 0; i < proteins.length; i++) {
    const v = validateProtein(proteins[i], `proteins[${i}]`);
    if (!v.ok) errors.push(...v.errors);
    else validated.push(v.protein);
    warnings.push(...v.warnings);
  }
  if (errors.length > 0) {
    return { pairs: [], warnings, errors };
  }

  const baits = validated.filter((p) => p.type === "bait");
  const preys = validated.filter((p) => p.type === "prey");

  if (baits.length === 0) {
    return {
      pairs: [],
      warnings,
      errors: ["At least one bait protein is required."]
    };
  }
  if (preys.length === 0) {
    return {
      pairs: [],
      warnings,
      errors: ["At least one prey protein is required."]
    };
  }

  const seenMatrixKeys = new Map();
  const pairs = [];

  for (const bait of baits) {
    for (const prey of preys) {
      const mk = matrixKeyForPair(bait.name, prey.name);
      if (seenMatrixKeys.has(mk)) {
        warnings.push(
          `Duplicate matrix key "${mk}" from multiple proteins with the same names; later pair overwrites in client UI. Consider unique names.`
        );
      }
      seenMatrixKeys.set(mk, true);

      const fp = stablePairFingerprint(bait, prey);
      const pairId = pairIdFromFingerprint(fp);
      const af3JobName = makeAf3JobName(pairId, bait.name, prey.name);

      pairs.push({
        pairId,
        matrixKey: mk,
        af3JobName,
        bait: { ...bait },
        prey: { ...prey }
      });
    }
  }

  return { pairs, warnings, errors: [] };
}

/**
 * Rebuild UI protein rows from a saved pairs manifest (session restore).
 * @param {{ pairs?: { bait?: object, prey?: object }[] }} manifest
 */
export function proteinsFromManifestPairs(manifest) {
  if (!manifest || !Array.isArray(manifest.pairs)) return [];
  /** @type {Map<string, object>} */
  const seen = new Map();
  let idCounter = 1;

  for (const pr of manifest.pairs) {
    for (const role of ["bait", "prey"]) {
      const raw = pr[role];
      if (!raw || typeof raw !== "object") continue;
      const type = raw.type === "prey" ? "prey" : "bait";
      const name = raw.name != null ? String(raw.name).trim() : "";
      const sequence = normalizeSequence(raw.sequence ?? "");
      if (!name || !sequence) continue;
      const key = `${type}|${sequence}|${name}`;
      if (seen.has(key)) continue;
      const id = raw.id != null ? String(raw.id) : String(idCounter++);
      /** @type {Record<string, unknown>} */
      const row = {
        id,
        name,
        sequence,
        type
      };
      if (Array.isArray(raw.regions) && raw.regions.length > 0) {
        row.regions = raw.regions;
      }
      seen.set(key, row);
    }
  }

  const list = [...seen.values()];
  list.sort((a, b) => {
    if (a.type !== b.type) return a.type === "bait" ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  });
  return list;
}
