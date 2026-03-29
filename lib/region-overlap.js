/**
 * Overlap between user-defined sequence regions (1-based inclusive) and
 * interface residue sets from structure (same index convention as mmCIF seq ids).
 */

/**
 * @typedef {{ start: number, end: number, label?: string, chain?: string }} ProteinRegion
 */

/**
 * @param {number} start
 * @param {number} end
 * @returns {Set<number>}
 */
export function residueSetInclusive(start, end) {
  const s = new Set();
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  for (let i = a; i <= b; i++) s.add(i);
  return s;
}

/**
 * Recall: fraction of region residues that appear in the interface set.
 * @param {ProteinRegion} region
 * @param {Set<number> | number[]} interfaceResidues
 */
export function regionInterfaceRecall(region, interfaceResidues) {
  const iface =
    interfaceResidues instanceof Set
      ? interfaceResidues
      : new Set(interfaceResidues);
  const len = Math.abs(region.end - region.start) + 1;
  if (len <= 0) {
    return {
      region,
      regionLength: 0,
      interfaceResiduesInRegion: 0,
      recall: null,
      jaccard: null
    };
  }

  let hit = 0;
  const lo = Math.min(region.start, region.end);
  const hi = Math.max(region.start, region.end);
  for (let i = lo; i <= hi; i++) {
    if (iface.has(i)) hit++;
  }

  const unionSize = len + iface.size - hit;
  const jaccard = unionSize > 0 ? hit / unionSize : null;

  return {
    region,
    regionLength: len,
    interfaceResiduesInRegion: hit,
    recall: hit / len,
    jaccard
  };
}

/**
 * Mean recall across regions; empty regions array ⇒ null (caller may treat as uninformative).
 * @param {ProteinRegion[] | null | undefined} regions
 * @param {Set<number> | number[]} interfaceResidues
 */
export function summarizeRegionsAgainstInterface(regions, interfaceResidues) {
  if (!regions || !regions.length) {
    return {
      perRegion: [],
      meanRecall: null,
      meanJaccard: null,
      regionCount: 0
    };
  }

  const perRegion = regions.map((r) =>
    regionInterfaceRecall(r, interfaceResidues)
  );
  const recalls = perRegion
    .map((x) => x.recall)
    .filter((x) => x != null && Number.isFinite(x));
  const jacs = perRegion
    .map((x) => x.jaccard)
    .filter((x) => x != null && Number.isFinite(x));

  return {
    perRegion,
    meanRecall:
      recalls.length > 0
        ? recalls.reduce((a, b) => a + b, 0) / recalls.length
        : null,
    meanJaccard:
      jacs.length > 0 ? jacs.reduce((a, b) => a + b, 0) / jacs.length : null,
    regionCount: regions.length
  };
}

/**
 * Combined bait + prey region overlap using the respective interface residue lists.
 * @param {{ bait?: { regions?: ProteinRegion[] }, prey?: { regions?: ProteinRegion[] } }} pairLike
 * @param {{ baitInterfaceResidues: number[], preyInterfaceResidues: number[] }} iface
 */
export function pairRegionOverlapSummary(pairLike, iface) {
  const baitRegions = pairLike?.bait?.regions;
  const preyRegions = pairLike?.prey?.regions;

  const baitSummary = summarizeRegionsAgainstInterface(
    baitRegions,
    iface.baitInterfaceResidues
  );
  const preySummary = summarizeRegionsAgainstInterface(
    preyRegions,
    iface.preyInterfaceResidues
  );

  const parts = [];
  if (baitSummary.meanRecall != null) parts.push(baitSummary.meanRecall);
  if (preySummary.meanRecall != null) parts.push(preySummary.meanRecall);

  const combinedMeanRecall =
    parts.length > 0
      ? parts.reduce((a, b) => a + b, 0) / parts.length
      : null;

  return {
    bait: baitSummary,
    prey: preySummary,
    combinedMeanRecall,
    hasAnyRegion: Boolean(
      (baitRegions && baitRegions.length) || (preyRegions && preyRegions.length)
    )
  };
}
