/**
 * Protein–protein interface detection from mmCIF using Cα–Cα distance cutoffs.
 * Tuned for AlphaFold Server–style heterodimers (two protein chains, typically A/B).
 */

import fs from "fs/promises";

/** Cα–Cα distance default (~8 Å) is a common coarse interface definition. */
export const DEFAULT_CA_INTERFACE_CUTOFF_A = 8;

/** Skip very large structures in serverless handlers (bytes of mmCIF text). */
export const DEFAULT_MAX_MMCIF_BYTES = 25 * 1024 * 1024;

/**
 * Split one mmCIF data line into tokens; supports double-quoted tokens with spaces.
 * @param {string} line
 * @returns {string[]}
 */
export function splitMmcifDataLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && (c === " " || c === "\t")) {
      if (cur.length) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur.length) out.push(cur);
  return out;
}

function skipMmcifNoise(lines, j) {
  while (j < lines.length) {
    const lt = lines[j].trim();
    if (lt === "" || lt.startsWith("#")) {
      j++;
      continue;
    }
    break;
  }
  return j;
}

/**
 * Match `_atom_site.Cartn_x` (case-insensitive); return column name after the dot.
 * @param {string} lineTrimmed
 * @returns {string | null}
 */
function atomSiteTagName(lineTrimmed) {
  const m = lineTrimmed.match(/^_atom_site\.(.+)$/i);
  return m ? m[1] : null;
}

/**
 * Find the first `atom_site` loop and return column tags + row token arrays.
 * Skips blank lines and `#` comments after `loop_` and between column tags (common in AF3 / PDBx).
 * Assumes one row per line; multi-line rows are not merged.
 * @param {string} text
 * @returns {{ tags: string[], rows: string[][] } | null}
 */
export function parseFirstAtomSiteLoop(text) {
  let s = String(text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const lines = s.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t !== "loop_") continue;
    let j = skipMmcifNoise(lines, i + 1);
    const tags = [];
    while (j < lines.length) {
      const lt = lines[j].trim();
      if (lt === "" || lt.startsWith("#")) {
        j++;
        continue;
      }
      const col = atomSiteTagName(lt);
      if (!col) break;
      tags.push(col);
      j++;
    }
    if (tags.length === 0) continue;

    const rows = [];
    for (; j < lines.length; j++) {
      const raw = lines[j];
      const lt = raw.trim();
      if (lt === "" || lt.startsWith("#")) continue;
      if (
        lt.startsWith("loop_") ||
        lt.startsWith("_") ||
        lt.startsWith("data_")
      ) {
        break;
      }
      const cells = splitMmcifDataLine(raw);
      if (cells.length === 0) continue;
      if (cells.length < tags.length) {
        while (cells.length < tags.length) cells.push(".");
      } else if (cells.length > tags.length) {
        cells.length = tags.length;
      }
      rows.push(cells);
    }
    return { tags, rows };
  }
  return null;
}

/**
 * Legacy PDB ATOM/HETATM (cols 13–16 atom, 22 chain, 23–26 resSeq, 31–38 x, 39–46 y, 47–54 z).
 * Used when mmCIF has no atom_site loop (mislabeled extension, export quirk, etc.).
 * @param {string} text
 * @returns {{ caByChain: Map<string, Map<number, CaRecord>>, chains: string[], warnings: string[] }}
 */
export function extractCaFromPdbStyleAtoms(text) {
  const warnings = [];
  const caByChain = new Map();
  const chainSet = new Set();
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const head = line.slice(0, 6).toUpperCase().trim();
    if (head !== "ATOM" && head !== "HETATM") continue;
    if (line.length < 54) continue;
    const atomName = line.slice(12, 16).trim().toUpperCase();
    if (atomName !== "CA") continue;
    let chain = line.slice(21, 22).trim();
    if (!chain && line.length > 76) {
      chain = line.slice(72, 76).trim().slice(0, 1);
    }
    if (!chain) chain = "?";
    const seq = parseInt(line.slice(22, 26).trim(), 10);
    if (!Number.isFinite(seq)) continue;
    const x = parseFloat(line.slice(30, 38));
    const y = parseFloat(line.slice(38, 46));
    const z = parseFloat(line.slice(46, 54));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const compId = line.length >= 20 ? line.slice(17, 20).trim() : "";
    chainSet.add(chain);
    let m = caByChain.get(chain);
    if (!m) {
      m = new Map();
      caByChain.set(chain, m);
    }
    if (!m.has(seq)) {
      m.set(seq, { x, y, z, compId });
    }
  }
  const chains = [...chainSet].sort((a, b) => a.localeCompare(b));
  if (chains.length === 0) {
    warnings.push("No PDB-style ATOM/HETATM CA records found.");
  }
  return { caByChain, chains, warnings };
}

function colIndex(tags, ...names) {
  const lower = tags.map((x) => String(x).toLowerCase());
  for (const n of names) {
    const idx = lower.indexOf(String(n).toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseFloatCell(s) {
  if (s == null || s === "." || s === "?") return NaN;
  const n = parseFloat(String(s));
  return Number.isFinite(n) ? n : NaN;
}

function parseSeqId(s) {
  if (s == null || s === "." || s === "?") return NaN;
  const n = parseInt(String(s), 10);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Cα coordinates keyed by chain id and residue sequence id (mmCIF column, 1-based typical).
 * @typedef {{ x: number, y: number, z: number, compId: string }} CaRecord
 */

/**
 * @param {string} mmCifText
 * @returns {{ caByChain: Map<string, Map<number, CaRecord>>, chains: string[], warnings: string[] }}
 */
export function extractCaByChain(mmCifText) {
  const warnings = [];
  const loop = parseFirstAtomSiteLoop(mmCifText);
  if (!loop) {
    const pdbTry = extractCaFromPdbStyleAtoms(mmCifText);
    if (pdbTry.chains.length > 0 && pdbTry.caByChain.size > 0) {
      return {
        caByChain: pdbTry.caByChain,
        chains: pdbTry.chains,
        warnings: [
          "No mmCIF _atom_site loop; parsed ATOM/HETATM records as PDB-style coordinates.",
          ...pdbTry.warnings
        ]
      };
    }
    return {
      caByChain: new Map(),
      chains: [],
      warnings: [
        "No _atom_site loop found (and no usable PDB-style ATOM lines). If this is a .bcif or gzip file, convert to text mmCIF or PDB.",
        ...pdbTry.warnings
      ]
    };
  }

  const { tags, rows } = loop;
  const iGroup = colIndex(tags, "group_PDB");
  const iAtom = colIndex(tags, "label_atom_id", "auth_atom_id");
  const iComp = colIndex(tags, "label_comp_id", "auth_comp_id");
  const iAsym = colIndex(tags, "label_asym_id", "auth_asym_id");
  const iSeq = colIndex(tags, "label_seq_id", "auth_seq_id");
  const iX = colIndex(tags, "Cartn_x");
  const iY = colIndex(tags, "Cartn_y");
  const iZ = colIndex(tags, "Cartn_z");

  if (iAtom < 0 || iAsym < 0 || iX < 0 || iY < 0 || iZ < 0) {
    warnings.push(
      "atom_site missing required columns (atom id, chain, or Cartn_x/y/z)."
    );
    return { caByChain: new Map(), chains: [], warnings };
  }

  /** @type {Map<string, Map<number, CaRecord>>} */
  const caByChain = new Map();
  const chainSet = new Set();

  for (const row of rows) {
    const group = iGroup >= 0 ? String(row[iGroup] || "").toUpperCase() : "ATOM";
    if (group !== "ATOM") continue;

    const atomName = String(row[iAtom] || "").toUpperCase();
    if (atomName !== "CA") continue;

    const asym = String(row[iAsym] || "").trim();
    if (!asym) continue;

    const seq =
      iSeq >= 0 ? parseSeqId(row[iSeq]) : NaN;
    if (!Number.isFinite(seq)) continue;

    const x = parseFloatCell(row[iX]);
    const y = parseFloatCell(row[iY]);
    const z = parseFloatCell(row[iZ]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

    const compId =
      iComp >= 0 ? String(row[iComp] || "").trim() : "";

    chainSet.add(asym);
    let m = caByChain.get(asym);
    if (!m) {
      m = new Map();
      caByChain.set(asym, m);
    }
    const prev = m.get(seq);
    if (prev) {
      warnings.push(
        `Duplicate Cα for chain ${asym} seq ${seq}; keeping first occurrence.`
      );
    } else {
      m.set(seq, { x, y, z, compId });
    }
  }

  const chains = [...chainSet].sort((a, b) => a.localeCompare(b));
  if (chains.length === 0) {
    warnings.push("No Cα ATOM records parsed.");
  }

  return { caByChain, chains, warnings };
}

/**
 * Default bait = lexicographically first chain id, prey = second (AF Server uses A, B).
 * @param {string[]} chainIds
 * @returns {{ baitChain: string | null, preyChain: string | null }}
 */
export function defaultBaitPreyChains(chainIds) {
  if (!chainIds || chainIds.length < 2) {
    return { baitChain: chainIds[0] ?? null, preyChain: null };
  }
  const sorted = [...chainIds].sort((a, b) => a.localeCompare(b));
  return { baitChain: sorted[0], preyChain: sorted[1] };
}

function distSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * @param {Map<number, CaRecord>} caA
 * @param {Map<number, CaRecord>} caB
 * @param {number} cutoffA
 */
export function computeCaInterface(caA, caB, cutoffA) {
  const cutoffSq = cutoffA * cutoffA;
  /** @type {Set<number>} */
  const residuesA = new Set();
  /** @type {Set<number>} */
  const residuesB = new Set();
  let contactPairs = 0;
  let minDistSq = Infinity;

  for (const [seqA, coordA] of caA) {
    for (const [seqB, coordB] of caB) {
      const d2 = distSq(coordA, coordB);
      if (d2 < minDistSq) minDistSq = d2;
      if (d2 <= cutoffSq) {
        contactPairs++;
        residuesA.add(seqA);
        residuesB.add(seqB);
      }
    }
  }

  const minDistanceA =
    minDistSq === Infinity ? null : Math.sqrt(minDistSq);

  return {
    cutoffAngstrom: cutoffA,
    contactPairs,
    baitInterfaceResidues: [...residuesA].sort((a, b) => a - b),
    preyInterfaceResidues: [...residuesB].sort((a, b) => a - b),
    baitInterfaceResidueCount: residuesA.size,
    preyInterfaceResidueCount: residuesB.size,
    minInterchainCaDistanceAngstrom: minDistanceA
  };
}

/**
 * With more than two polymer chains, the first two alphabetically are often not the dimer.
 * Pick the pair with the most Cα–Cα contacts within the cutoff (typical AF3 heterodimer).
 * @param {Map<string, Map<number, CaRecord>>} caByChain
 * @param {number} [cutoffA]
 * @returns {{ baitChain: string | null, preyChain: string | null, contactPairs: number }}
 */
export function pickBestBaitPreyChains(caByChain, cutoffA = DEFAULT_CA_INTERFACE_CUTOFF_A) {
  const chains = [...caByChain.keys()].filter((c) => (caByChain.get(c)?.size ?? 0) > 0);
  chains.sort((a, b) => a.localeCompare(b));
  if (chains.length < 2) {
    const d = defaultBaitPreyChains(chains);
    return {
      baitChain: d.baitChain,
      preyChain: d.preyChain,
      contactPairs: 0
    };
  }
  let bestA = chains[0];
  let bestB = chains[1];
  let bestContacts = -1;
  for (let i = 0; i < chains.length; i++) {
    for (let j = i + 1; j < chains.length; j++) {
      const caA = caByChain.get(chains[i]);
      const caB = caByChain.get(chains[j]);
      if (!caA || !caB) continue;
      const iface = computeCaInterface(caA, caB, cutoffA);
      if (iface.contactPairs > bestContacts) {
        bestContacts = iface.contactPairs;
        bestA = chains[i];
        bestB = chains[j];
      }
    }
  }
  if (bestContacts > 0) {
    return { baitChain: bestA, preyChain: bestB, contactPairs: bestContacts };
  }
  const d = defaultBaitPreyChains(chains);
  return {
    baitChain: d.baitChain,
    preyChain: d.preyChain,
    contactPairs: 0
  };
}

/**
 * Full interface summary for one model.
 * @param {string} mmCifText
 * @param {{ baitChain?: string | null, preyChain?: string | null, cutoffAngstrom?: number }} [options]
 */
export function analyzeInterfaceFromMmcifText(mmCifText, options = {}) {
  const cutoff =
    typeof options.cutoffAngstrom === "number" &&
    Number.isFinite(options.cutoffAngstrom) &&
    options.cutoffAngstrom > 0
      ? options.cutoffAngstrom
      : DEFAULT_CA_INTERFACE_CUTOFF_A;

  const { caByChain, chains, warnings: parseWarnings } =
    extractCaByChain(mmCifText);

  let baitChain = options.baitChain != null ? String(options.baitChain) : null;
  let preyChain = options.preyChain != null ? String(options.preyChain) : null;

  const userSpecifiedChains = Boolean(
    options.baitChain != null &&
      String(options.baitChain).trim() &&
      options.preyChain != null &&
      String(options.preyChain).trim()
  );

  let inferredContactPairs = 0;
  if (!baitChain || !preyChain) {
    const inferred = pickBestBaitPreyChains(caByChain, cutoff);
    baitChain = baitChain || inferred.baitChain;
    preyChain = preyChain || inferred.preyChain;
    inferredContactPairs = inferred.contactPairs;
  }

  const warnings = [...parseWarnings];
  if (!userSpecifiedChains && chains.length > 2 && inferredContactPairs > 0) {
    warnings.push(
      `Inferred dimer chains ${baitChain} / ${preyChain} (${inferredContactPairs} Cα–Cα pairs ≤ ${cutoff} Å among ${chains.length} chains).`
    );
  }

  if (!baitChain || !preyChain) {
    warnings.push("Need at least two chains for bait/prey interface detection.");
    return {
      ok: false,
      cutoffAngstrom: cutoff,
      chains,
      baitChain,
      preyChain,
      interface: null,
      warnings
    };
  }

  const caA = caByChain.get(baitChain);
  const caB = caByChain.get(preyChain);
  if (!caA || !caB || caA.size === 0 || caB.size === 0) {
    warnings.push(
      `Missing Cα atoms for bait chain "${baitChain}" or prey chain "${preyChain}".`
    );
    return {
      ok: false,
      cutoffAngstrom: cutoff,
      chains,
      baitChain,
      preyChain,
      interface: null,
      warnings
    };
  }

  const iface = computeCaInterface(caA, caB, cutoff);

  return {
    ok: true,
    cutoffAngstrom: cutoff,
    chains,
    baitChain,
    preyChain,
    interface: iface,
    warnings
  };
}

/**
 * Read mmCIF from disk with a size guard (serverless-friendly).
 * @param {string} absolutePath
 * @param {number} [maxBytes]
 */
export async function readMmcifTextBounded(absolutePath, maxBytes = DEFAULT_MAX_MMCIF_BYTES) {
  const st = await fs.stat(absolutePath);
  if (st.size > maxBytes) {
    throw new Error(
      `mmCIF too large (${st.size} bytes > ${maxBytes}); increase limit or trim file.`
    );
  }
  return fs.readFile(absolutePath, "utf8");
}

/**
 * @param {string} absolutePath
 * @param {Parameters<typeof analyzeInterfaceFromMmcifText>[1] & { maxMmcifBytes?: number }} [options]
 */
export async function analyzeInterfaceFromMmcifFile(absolutePath, options = {}) {
  const maxBytes =
    typeof options.maxMmcifBytes === "number"
      ? options.maxMmcifBytes
      : DEFAULT_MAX_MMCIF_BYTES;
  const text = await readMmcifTextBounded(absolutePath, maxBytes);
  return analyzeInterfaceFromMmcifText(text, options);
}
