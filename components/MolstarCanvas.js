/**
 * Browser-only Mol* canvas: loads structure, applies base cartoon + prioritized highlight layers.
 * Parent should load this only with `next/dynamic` and `ssr: false`.
 *
 * Visual priority (1 = strongest, drawn last): overlap > interface > annotated > base.
 * Only the base uses a full-structure cartoon; highlights use subset selections (no duplicate chain cartoons).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Plugin } from "molstar/lib/mol-plugin-ui/plugin";
import { PluginUIContext } from "molstar/lib/mol-plugin-ui/context";
import { DefaultPluginUISpec } from "molstar/lib/mol-plugin-ui/spec";
import { Asset } from "molstar/lib/mol-util/assets";
import { deriveHighlightLayers } from "@/lib/molstar-selections";
import {
  buildTwoChainPolymerUnionExpression,
  chainResidueSubsetExpression
} from "@/lib/molstar-expressions";

import "molstar/lib/mol-plugin-ui/skin/light.scss";

/* Match DetailPanel legend (Tailwind-like hex). */
const COLORS = {
  base: 0xcfd4dc,
  annotated: 0xf59e0b,
  iface: 0x06b6d4,
  overlap: 0xef4444
};

function inferFormat(url) {
  const u = url.toLowerCase().split("?")[0];
  if (u.endsWith(".pdb") || u.endsWith(".ent")) return "pdb";
  if (u.endsWith(".bcif")) return "bcif";
  return "mmcif";
}

function absoluteUrl(maybeRelative) {
  if (!maybeRelative) return "";
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  if (typeof window === "undefined") return maybeRelative;
  return `${window.location.origin}${maybeRelative.startsWith("/") ? "" : "/"}${maybeRelative}`;
}

function normArr(a) {
  return Array.isArray(a) ? a : [];
}

/**
 * When parent passes a new [] each render, JSON content is still stable so the string
 * does not change and the load effect does not thrash Mol* state.
 */
function useHighlightSignature({
  interfaceResiduesA,
  interfaceResiduesB,
  annotatedRegionA,
  annotatedRegionB,
  overlapResiduesA,
  overlapResiduesB
}) {
  return useMemo(
    () =>
      JSON.stringify({
        ia: normArr(interfaceResiduesA),
        ib: normArr(interfaceResiduesB),
        aa: normArr(annotatedRegionA),
        ab: normArr(annotatedRegionB),
        oa: normArr(overlapResiduesA),
        ob: normArr(overlapResiduesB)
      }),
    [
      interfaceResiduesA,
      interfaceResiduesB,
      annotatedRegionA,
      annotatedRegionB,
      overlapResiduesA,
      overlapResiduesB
    ]
  );
}

/**
 * @param {import('molstar/lib/mol-plugin-ui/context').PluginUIContext} plugin
 * @param {unknown} structure
 * @param {string} staticType e.g. 'polymer'
 * @param {string} key
 * @param {object} reprProps
 * @returns {Promise<boolean>}
 */
async function safeAddStaticRepr(plugin, structure, staticType, key, reprProps) {
  const b = plugin.builders.structure;
  try {
    const comp = await b.tryCreateComponentStatic(structure, staticType, { label: key });
    if (!comp) return false;
    await b.representation.addRepresentation(comp, reprProps);
    return true;
  } catch (e) {
    console.warn(`Mol* static layer "${key}" skipped:`, e);
    return false;
  }
}

/**
 * @param {import('molstar/lib/mol-plugin-ui/context').PluginUIContext} plugin
 * @param {unknown} structure
 * @param {string} key
 * @param {unknown} expression
 * @param {object} reprProps
 */
async function safeAddExpressionRepr(plugin, structure, key, expression, reprProps) {
  if (!expression) return;
  const b = plugin.builders.structure;
  try {
    const comp = await b.tryCreateComponentFromExpression(structure, expression, key, {
      label: key
    });
    if (comp) await b.representation.addRepresentation(comp, reprProps);
  } catch (e) {
    console.warn(`Mol* layer "${key}" skipped:`, e);
  }
}

export default function MolstarCanvas({
  structureUrl,
  chainA,
  chainB,
  interfaceResiduesA,
  interfaceResiduesB,
  annotatedRegionA,
  annotatedRegionB,
  overlapResiduesA,
  overlapResiduesB,
  height = 420
}) {
  const containerRef = useRef(null);
  const hostRef = useRef(null);
  const pluginRef = useRef(null);
  const rootRef = useRef(null);
  const structureLoadGenRef = useRef(0);
  const [pluginReady, setPluginReady] = useState(false);
  const [error, setError] = useState(null);

  const requestMolstarResize = useCallback(() => {
    const plugin = pluginRef.current;
    if (!plugin || plugin.disposed) return;
    try {
      plugin.handleResize?.();
    } catch (e) {
      console.warn("Mol* handleResize:", e);
    }
  }, []);

  const highlightSig = useHighlightSignature({
    interfaceResiduesA,
    interfaceResiduesB,
    annotatedRegionA,
    annotatedRegionB,
    overlapResiduesA,
    overlapResiduesB
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let cancelled = false;

    (async () => {
      const spec = {
        ...DefaultPluginUISpec(),
        layout: {
          initial: {
            isExpanded: false,
            showControls: false
          }
        },
        components: {
          remoteState: "none"
        }
      };

      const ctx = new PluginUIContext(spec);
      await ctx.init();
      if (cancelled) {
        ctx.dispose();
        return;
      }

      const root = createRoot(host);
      root.render(createElement(Plugin, { plugin: ctx }));
      rootRef.current = root;
      pluginRef.current = ctx;

      try {
        await ctx.canvas3dInitialized;
      } catch {
        /* canvas errors surface in UI */
      }

      if (!cancelled) setPluginReady(true);
    })();

    return () => {
      cancelled = true;
      structureLoadGenRef.current += 1;
      setPluginReady(false);
      rootRef.current?.unmount();
      rootRef.current = null;
      try {
        pluginRef.current?.dispose?.();
      } catch (e) {
        console.warn("Mol* dispose:", e);
      }
      pluginRef.current = null;
    };
  }, []);

  /* Dialogs (e.g. Radix) often finish layout after first paint; Mol* needs an explicit resize. */
  useEffect(() => {
    if (!pluginReady) return undefined;
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      requestAnimationFrame(() => requestMolstarResize());
      return undefined;
    }
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => requestMolstarResize());
    });
    ro.observe(el);
    requestAnimationFrame(() => requestMolstarResize());
    return () => ro.disconnect();
  }, [pluginReady, requestMolstarResize]);

  useEffect(() => {
    if (!pluginReady) return undefined;

    if (!structureUrl || typeof structureUrl !== "string") {
      setError(null);
      return undefined;
    }

    const plugin = pluginRef.current;
    if (!plugin) return undefined;

    const loadGen = structureLoadGenRef.current;

    (async () => {
      setError(null);
      const url = absoluteUrl(structureUrl);
      const format = inferFormat(url);
      const formatProvider =
        plugin.dataFormats.get(format === "bcif" ? "mmcif" : format) ??
        plugin.dataFormats.get("mmcif");

      try {
        await plugin.clear();
      } catch (e) {
        console.warn("Mol* clear:", e);
      }

      if (loadGen !== structureLoadGenRef.current || plugin.disposed) return;

      try {
        let structure;

        await plugin.dataTransaction(async () => {
          if (loadGen !== structureLoadGenRef.current || plugin.disposed) return;

          const data = await plugin.builders.data.download(
            { url: Asset.Url(url), isBinary: format === "bcif" },
            { state: { isGhost: true } }
          );
          if (loadGen !== structureLoadGenRef.current || plugin.disposed) return;

          const trajectory = await plugin.builders.structure.parseTrajectory(
            data,
            formatProvider ?? format
          );
          if (loadGen !== structureLoadGenRef.current || plugin.disposed) return;

          let built = await plugin.builders.structure.hierarchy.applyPreset(
            trajectory,
            "default",
            {
              structure: { name: "model", params: {} },
              showUnitcell: false,
              representationPreset: "empty"
            }
          );

          if (!built?.structure) {
            const builder = plugin.builders.structure;
            const model = await builder.createModel(trajectory, { modelIndex: 0 });
            if (loadGen !== structureLoadGenRef.current || plugin.disposed) return;
            built = { structure: await builder.createStructure(model, { name: "model", params: {} }) };
          }

          structure = built.structure;
        });

        if (loadGen !== structureLoadGenRef.current || plugin.disposed) return;

        if (!structure) {
          throw new Error("Structure build did not produce a model.");
        }

        const layers = deriveHighlightLayers({
          interfaceResiduesA,
          interfaceResiduesB,
          annotatedRegionA,
          annotatedRegionB,
          overlapResiduesA,
          overlapResiduesB
        });

        /* Priority 4 (lowest): one full-structure cartoon — no per-chain duplicates. */
        const baseRepr = {
          type: "cartoon",
          typeParams: { alpha: 0.82 },
          color: "uniform",
          colorParams: { value: COLORS.base }
        };
        let baseOk = await safeAddStaticRepr(
          plugin,
          structure,
          "polymer",
          "af3-base-polymer",
          baseRepr
        );
        if (!baseOk) {
          const fallbackEx = buildTwoChainPolymerUnionExpression(chainA, chainB);
          await safeAddExpressionRepr(
            plugin,
            structure,
            "af3-base-chains",
            fallbackEx,
            baseRepr
          );
        }

        /*
          Subset layers are mutually exclusive (deriveHighlightLayers). Draw order: annotated →
          interface → overlap so visual priority is overlap > interface > annotated (last wins on top).
        */
        const highlightTiers = [
          {
            rows: [
              [chainA, layers.annOnlyA, "ann-a"],
              [chainB, layers.annOnlyB, "ann-b"]
            ],
            repr: {
              type: "putty",
              typeParams: { alpha: 0.9, sizeFactor: 0.17 },
              color: "uniform",
              colorParams: { value: COLORS.annotated }
            }
          },
          {
            rows: [
              [chainA, layers.ifaceOnlyA, "iface-a"],
              [chainB, layers.ifaceOnlyB, "iface-b"]
            ],
            repr: {
              type: "ball-and-stick",
              typeParams: { sizeFactor: 0.4, bondScale: 0.52 },
              color: "uniform",
              colorParams: { value: COLORS.iface }
            }
          },
          {
            rows: [
              [chainA, layers.overlapA, "overlap-a"],
              [chainB, layers.overlapB, "overlap-b"]
            ],
            repr: {
              type: "ball-and-stick",
              typeParams: { sizeFactor: 0.54, bondScale: 0.64 },
              color: "uniform",
              colorParams: { value: COLORS.overlap }
            }
          }
        ];

        for (const tier of highlightTiers) {
          for (const [cid, residues, tag] of tier.rows) {
            const ex = chainResidueSubsetExpression(cid, residues);
            await safeAddExpressionRepr(plugin, structure, `af3-${tag}`, ex, tier.repr);
          }
        }

        if (loadGen === structureLoadGenRef.current) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (loadGen !== structureLoadGenRef.current || plugin.disposed) return;
              requestMolstarResize();
              plugin.canvas3d?.requestCameraReset?.();
            });
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (loadGen === structureLoadGenRef.current) {
          setError(msg);
        }
        console.warn("Mol* load failed:", e);
      }
    })();

    return () => {
      structureLoadGenRef.current++;
    };
  }, [pluginReady, structureUrl, chainA, chainB, highlightSig, requestMolstarResize]);

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-md border border-gray-200 overflow-hidden bg-white"
      style={{ height, minHeight: 280 }}
    >
      {error ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md border border-amber-200 bg-amber-50/95 text-amber-900 px-3 py-6 text-sm text-center">
          Could not load structure in the viewer. {error}
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="molstar-host"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
