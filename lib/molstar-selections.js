/**
 * Residue list / region helpers and exclusive highlight layers for AF3 pair viewing (no Mol* import).
 *
 * Highlighting priority (strongest last in draw order): whole chain < annotated-only <
 * interface-only < overlap. We split residue sets in JS so each layer is mutually exclusive.
 */

export const MAX_RESIDUES_IN_SELECTION = 4000;

/**
 * Normalize user residue input: plain arrays, single numbers, or { start, end } ranges (1-based inclusive).
 * @param {unknown} raw
 * @returns {number[]}
 */
export function expandResidueSpec(raw) {
  if (raw == null) return [];
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1) return [raw];
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return Number.isInteger(n) && n >= 1 ? [n] : [];
  }
  if (Array.isArray(raw)) {
    const out = [];
    for (const item of raw) {
      out.push(...expandResidueSpec(item));
    }
    return sortedUniquePositiveInts(out);
  }
  if (typeof raw === "object") {
    const start = Number(raw.start);
    const end = Number(raw.end);
    if (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 1 &&
      end >= 1
    ) {
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      const cap = lo + MAX_RESIDUES_IN_SELECTION;
      const lim = hi > cap ? cap : hi;
      const arr = [];
      for (let i = lo; i <= lim; i++) arr.push(i);
      return arr;
    }
  }
  return [];
}

/**
 * Union of 1-based residue indices from manifest-style region objects.
 * @param {{ start: number, end: number }[] | null | undefined} regions
 */
export function regionsToResidueList(regions) {
  if (!regions || !Array.isArray(regions)) return [];
  const acc = [];
  for (const r of regions) {
    acc.push(...expandResidueSpec(r));
  }
  return sortedUniquePositiveInts(acc);
}

export function sortedUniquePositiveInts(nums) {
  const s = new Set();
  for (const n of nums) {
    if (typeof n === "number" && Number.isInteger(n) && n >= 1) s.add(n);
  }
  return [...s].sort((a, b) => a - b);
}

/**
 * Merge a sorted unique residue list into inclusive { start, end } segments (1-based).
 * @param {number[]} residues
 * @returns {{ start: number, end: number }[]}
 */
export function mergeConsecutiveResidues(residues) {
  const sorted = sortedUniquePositiveInts(residues);
  if (sorted.length === 0) return [];
  /** @type {{ start: number, end: number }[]} */
  const ranges = [];
  let a = sorted[0];
  let b = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === b + 1) {
      b = sorted[i];
    } else {
      ranges.push({ start: a, end: b });
      a = b = sorted[i];
    }
  }
  ranges.push({ start: a, end: b });
  return ranges;
}

/**
 * @param {number[]} iface
 * @param {number[]} annotated
 * @returns {{ overlap: number[], ifaceOnly: number[], annOnly: number[] }}
 */
export function splitInterfaceAnnotated(iface, annotated) {
  const I = new Set(iface);
  const A = new Set(annotated);
  const overlap = [];
  const ifaceOnly = [];
  const annOnly = [];
  for (const x of I) {
    if (A.has(x)) overlap.push(x);
    else ifaceOnly.push(x);
  }
  for (const x of A) {
    if (!I.has(x)) annOnly.push(x);
  }
  overlap.sort((a, b) => a - b);
  ifaceOnly.sort((a, b) => a - b);
  annOnly.sort((a, b) => a - b);
  return { overlap, ifaceOnly, annOnly };
}

/**
 * Build exclusive highlight layers from possibly overlapping inputs.
 * If overlapResidues* is an array (including empty), it selects explicit overlap mode for that chain;
 * otherwise overlap = iface ∩ annotated.
 */
export function deriveHighlightLayers({
  interfaceResiduesA,
  interfaceResiduesB,
  annotatedRegionA,
  annotatedRegionB,
  overlapResiduesA,
  overlapResiduesB
}) {
  const ifaceA = expandResidueSpec(interfaceResiduesA);
  const ifaceB = expandResidueSpec(interfaceResiduesB);
  const annA = expandResidueSpec(annotatedRegionA);
  const annB = expandResidueSpec(annotatedRegionB);

  const overlapAExplicit = expandResidueSpec(overlapResiduesA);
  const overlapBExplicit = expandResidueSpec(overlapResiduesB);
  const useExplicitA = Array.isArray(overlapResiduesA);
  const useExplicitB = Array.isArray(overlapResiduesB);

  let overlapA;
  let ifaceOnlyA;
  let annOnlyA;
  if (useExplicitA) {
    overlapA = overlapAExplicit;
    const O = new Set(overlapA);
    const IA = new Set(ifaceA);
    ifaceOnlyA = ifaceA.filter((x) => !O.has(x));
    /* Annotated-only: in user region but not interface (overlap is explicit). */
    annOnlyA = annA.filter((x) => !O.has(x) && !IA.has(x));
  } else {
    const s = splitInterfaceAnnotated(ifaceA, annA);
    overlapA = s.overlap;
    ifaceOnlyA = s.ifaceOnly;
    annOnlyA = s.annOnly;
  }

  let overlapB;
  let ifaceOnlyB;
  let annOnlyB;
  if (useExplicitB) {
    overlapB = overlapBExplicit;
    const O = new Set(overlapB);
    const IB = new Set(ifaceB);
    ifaceOnlyB = ifaceB.filter((x) => !O.has(x));
    annOnlyB = annB.filter((x) => !O.has(x) && !IB.has(x));
  } else {
    const s = splitInterfaceAnnotated(ifaceB, annB);
    overlapB = s.overlap;
    ifaceOnlyB = s.ifaceOnly;
    annOnlyB = s.annOnly;
  }

  return {
    ifaceOnlyA,
    ifaceOnlyB,
    annOnlyA,
    annOnlyB,
    overlapA,
    overlapB
  };
}
