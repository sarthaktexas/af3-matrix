/**
 * Mol* MolScript selection expressions (import only from client Mol* bundle).
 *
 * High-level helpers return { expression, mergedRanges, residueCount } so the viewer can
 * pass `expression` to tryCreateComponentFromExpression and optionally log mergedRanges.
 */

import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import {
  MAX_RESIDUES_IN_SELECTION,
  expandResidueSpec,
  mergeConsecutiveResidues,
  sortedUniquePositiveInts
} from "@/lib/molstar-selections";

const proteinEntityTest = MS.core.logic.and([
  MS.core.rel.eq([MS.ammp("entityType"), "polymer"]),
  MS.core.str.match([
    MS.re("(polypeptide|cyclic-pseudo-peptide|peptide-like)", "i"),
    MS.ammp("entitySubtype")
  ])
]);

/** Max OR-branches before falling back to a single set.has(seq_id) (sparse lists). */
const MAX_RANGE_OR_CLAUSES = 128;

function labelSeqId() {
  return MS.ammp("label_seq_id");
}

/**
 * One predicate on label_seq_id from merged inclusive ranges.
 * @param {{ start: number, end: number }[]} mergedRanges
 * @param {number[]} sortedIds fallback ids for large merged segment counts
 */
function residuePredicateFromMergedRanges(mergedRanges, sortedIds) {
  if (!mergedRanges.length) return null;
  if (mergedRanges.length <= MAX_RANGE_OR_CLAUSES) {
    const parts = mergedRanges.map(({ start, end }) => {
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      if (lo === hi) return MS.core.rel.eq([labelSeqId(), lo]);
      return MS.core.rel.inRange([labelSeqId(), lo, hi]);
    });
    return parts.length === 1 ? parts[0] : MS.core.logic.or(parts);
  }
  const cap =
    sortedIds.length > MAX_RESIDUES_IN_SELECTION
      ? sortedIds.slice(0, MAX_RESIDUES_IN_SELECTION)
      : sortedIds;
  if (cap.length === 0) return null;
  return MS.core.set.has([MS.core.type.set(...cap), labelSeqId()]);
}

function chainAndProteinBase(chainId, residueTest) {
  return MS.struct.generator.atomGroups({
    "entity-test": proteinEntityTest,
    "chain-test": MS.core.rel.eq([MS.ammp("label_asym_id"), chainId]),
    "residue-test": residueTest,
    "group-by": MS.struct.atomProperty.macromolecular.residueKey()
  });
}

function polymerAtomGroupsForChain(chainId) {
  return MS.struct.generator.atomGroups({
    "entity-test": proteinEntityTest,
    "chain-test": MS.core.rel.eq([MS.ammp("label_asym_id"), chainId]),
    "group-by": MS.struct.atomProperty.macromolecular.residueKey()
  });
}

/**
 * One MolScript union covering protein polymer on both chains (fallback when static "polymer" is empty).
 * @param {string} chainIdA
 * @param {string} chainIdB
 */
export function buildTwoChainPolymerUnionExpression(chainIdA, chainIdB) {
  const a = chainIdA != null && String(chainIdA).trim() ? String(chainIdA).trim() : "";
  const b = chainIdB != null && String(chainIdB).trim() ? String(chainIdB).trim() : "";
  if (!a && !b) return null;
  if (a && b && a === b) return buildChainSelection(a).expression;
  const parts = [];
  if (a) parts.push(polymerAtomGroupsForChain(a));
  if (b && b !== a) parts.push(polymerAtomGroupsForChain(b));
  if (parts.length === 0) return null;
  return MS.struct.modifier.union(parts);
}

/**
 * Whole protein polymer chain selection (by label_asym_id).
 * @param {string} chainId
 * @returns {{ expression: object | null, mergedRanges: null, residueCount: null }}
 */
export function buildChainSelection(chainId) {
  if (!chainId || typeof chainId !== "string") {
    return { expression: null, mergedRanges: null, residueCount: null };
  }
  const expression = MS.struct.modifier.union([
    MS.struct.generator.atomGroups({
      "entity-test": proteinEntityTest,
      "chain-test": MS.core.rel.eq([MS.ammp("label_asym_id"), chainId]),
      "group-by": MS.struct.atomProperty.macromolecular.residueKey()
    })
  ]);
  return { expression, mergedRanges: null, residueCount: null };
}

/**
 * Residues on a chain from an array of 1-based sequence numbers (arbitrary gaps).
 * Uses merged contiguous ranges when that yields a small MolScript OR; otherwise set.has.
 * @param {string} chainId
 * @param {number[]} residues
 * @returns {{ expression: object | null, mergedRanges: { start: number, end: number }[], residueCount: number }}
 */
export function buildResidueSelection(chainId, residues) {
  if (!chainId || typeof chainId !== "string") {
    return { expression: null, mergedRanges: [], residueCount: 0 };
  }
  const sorted = sortedUniquePositiveInts(Array.isArray(residues) ? residues : []);
  if (sorted.length === 0) {
    return { expression: null, mergedRanges: [], residueCount: 0 };
  }
  const mergedRanges = mergeConsecutiveResidues(sorted);
  const residueTest = residuePredicateFromMergedRanges(mergedRanges, sorted);
  if (!residueTest) {
    return { expression: null, mergedRanges, residueCount: sorted.length };
  }
  const expression = chainAndProteinBase(chainId, residueTest);
  return { expression, mergedRanges, residueCount: sorted.length };
}

/**
 * Same as buildResidueSelection but accepts expandResidueSpec input: numbers, nested arrays,
 * or { start, end } objects (1-based inclusive).
 * @param {string} chainId
 * @param {unknown | unknown[]} residuesOrRanges
 */
export function buildRegionSelection(chainId, residuesOrRanges) {
  if (!chainId || typeof chainId !== "string") {
    return { expression: null, mergedRanges: [], residueCount: 0 };
  }
  const raw = Array.isArray(residuesOrRanges) ? residuesOrRanges : [residuesOrRanges];
  const expanded = [];
  for (const item of raw) {
    expanded.push(...expandResidueSpec(item));
  }
  const sorted = sortedUniquePositiveInts(expanded);
  return buildResidueSelection(chainId, sorted);
}

export function chainPolymerExpression(chainId) {
  return buildChainSelection(chainId).expression;
}

export function chainResidueSubsetExpression(chainId, seqIds) {
  return buildResidueSelection(chainId, seqIds).expression;
}
