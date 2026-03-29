import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, CheckCircle2, AlertCircle, XCircle, Target } from "lucide-react";
import MolViewer from "./MolViewer";
import { regionsToResidueList, sortedUniquePositiveInts } from "@/lib/molstar-selections";

/** Stable empty refs so Mol* load effect is not retriggered every parent render. */
const EMPTY_RESIDUES = [];

/** Demo-only placeholders when there is no session/ingest (matrix mock data). Never use after upload. */
const MOCK_MODELS = [
  { id: 1, ipTM: 0.87, ranking: 0.92, contacts: 45, interfaceSize: 1250, clashScore: 0.02, isBest: true },
  { id: 2, ipTM: 0.85, ranking: 0.89, contacts: 42, interfaceSize: 1180, clashScore: 0.03, isBest: false },
  { id: 3, ipTM: 0.84, ranking: 0.88, contacts: 44, interfaceSize: 1220, clashScore: 0.04, isBest: false },
  { id: 4, ipTM: 0.82, ranking: 0.85, contacts: 40, interfaceSize: 1150, clashScore: 0.05, isBest: false },
  { id: 5, ipTM: 0.79, ranking: 0.81, contacts: 38, interfaceSize: 1100, clashScore: 0.06, isBest: false }
];

const EMPTY_METRICS_MODEL = {
  id: "—",
  ipTM: 0,
  ranking: 0,
  contacts: 0,
  interfaceSize: 0,
  clashScore: 0,
  isBest: false
};

function finiteMetric(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Prefer API `displayConfidence` (ipTM → pTM → normalized ranking, same as matrix);
 * fall back to raw iptm/ptm for older responses.
 */
function confidenceScoreFromRow(r) {
  const dc = finiteMetric(r?.displayConfidence);
  if (dc != null) return dc;
  const iptm = finiteMetric(r?.iptm);
  if (iptm != null) return iptm;
  const ptm = finiteMetric(r?.ptm);
  if (ptm != null) return ptm;
  return 0;
}

function buildDisplayModelsFromAnalysis(perModel) {
  if (!Array.isArray(perModel) || perModel.length === 0) return null;
  let bestI = 0;
  let bestC = Number.NEGATIVE_INFINITY;
  perModel.forEach((r, i) => {
    const conf = confidenceScoreFromRow(r);
    const c = r.composite != null && Number.isFinite(r.composite) ? r.composite : conf;
    if (c > bestC) {
      bestC = c;
      bestI = i;
    }
  });
  return perModel.map((r, i) => {
    const iface = r.interface && typeof r.interface === "object" ? r.interface : {};
    const contacts = iface.contactPairs ?? 0;
    const size =
      (iface.baitInterfaceResidueCount ?? 0) + (iface.preyInterfaceResidueCount ?? 0);
    const conf = confidenceScoreFromRow(r);
    return {
      id: i + 1,
      ipTM: conf,
      ranking:
        typeof r.composite === "number" && Number.isFinite(r.composite)
          ? r.composite
          : conf,
      contacts,
      interfaceSize: size || contacts * 28,
      clashScore: 0,
      isBest: i === bestI
    };
  });
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function DetailPanel({
  data,
  open,
  onClose,
  sessionId = "",
  ingestId = "",
  proteins = []
}) {
  const [modelIndex, setModelIndex] = useState(0);
  const [regionStartStr, setRegionStartStr] = useState("");
  const [regionEndStr, setRegionEndStr] = useState("");
  const [targetAnalysis, setTargetAnalysis] = useState(null);
  const [regionError, setRegionError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const lastAnalysisFetchKeyRef = useRef("");
  /**
   * While the dialog is open, keep the first non-empty sessionId+ingestId we see and ignore
   * brief parent flicker (e.g. overlapping session GETs) so analysis/Mol* URLs stay valid.
   */
  const [viewerContext, setViewerContext] = useState(null);

  const baitName = data?.bait;
  const preyName = data?.prey;
  const pairIdForApi =
    data?.pairId != null && String(data.pairId).trim() ? String(data.pairId).trim() : "";

  const baitProtein = proteins.find(
    (p) => p.type === "bait" && p.name === baitName
  );
  const preyProtein = proteins.find(
    (p) => p.type === "prey" && p.name === preyName
  );

  const annotatedListA = useMemo(() => {
    const list = regionsToResidueList(baitProtein?.regions);
    return list.length === 0 ? EMPTY_RESIDUES : list;
  }, [baitProtein?.regions]);

  const annotatedListB = useMemo(() => {
    const list = regionsToResidueList(preyProtein?.regions);
    return list.length === 0 ? EMPTY_RESIDUES : list;
  }, [preyProtein?.regions]);

  useEffect(() => {
    if (!open) {
      setViewerContext(null);
      return;
    }
    setViewerContext((prev) => {
      const psid = String(sessionId || "").trim();
      const piid = String(ingestId || "").trim();
      if (!psid) {
        return null;
      }
      if (!prev) {
        return { sid: psid, iid: piid };
      }
      if (prev.sid && prev.iid) {
        if (prev.sid !== psid) {
          return { sid: psid, iid: piid };
        }
        if (piid && piid !== prev.iid) {
          return { sid: psid, iid: piid };
        }
        return prev;
      }
      if (psid && piid) {
        return { sid: psid, iid: piid };
      }
      return prev;
    });
  }, [open, sessionId, ingestId]);

  const ctxSid = viewerContext?.sid ?? "";
  const ctxIid = viewerContext?.iid ?? "";

  useEffect(() => {
    if (!baitName || !preyName) {
      setAnalysis(null);
      setAnalysisError(null);
      return;
    }
    if (open) {
      setModelIndex(0);
    }
  }, [open, baitName, preyName]);

  useEffect(() => {
    if (!open) return;
    setRegionStartStr("");
    setRegionEndStr("");
    setTargetAnalysis(null);
    setRegionError(null);
    setActionError(null);
  }, [open, baitName, preyName]);

  useEffect(() => {
    setTargetAnalysis(null);
    setRegionError(null);
  }, [modelIndex]);

  useEffect(() => {
    if (!open || !baitName || !preyName) {
      return undefined;
    }
    if (!ctxSid || !ctxIid) {
      return undefined;
    }

    const fetchKey = JSON.stringify([ctxSid, ctxIid, baitName, preyName, pairIdForApi]);
    const pairOrSessionChanged = fetchKey !== lastAnalysisFetchKeyRef.current;
    lastAnalysisFetchKeyRef.current = fetchKey;

    const ac = new AbortController();
    (async () => {
      if (pairOrSessionChanged) {
        setAnalysis(null);
      }
      setAnalysisLoading(true);
      setAnalysisError(null);
      try {
        const body = {
          sessionId: ctxSid,
          ingestId: ctxIid,
          matrixKey: `${baitName}:${preyName}`
        };
        if (pairIdForApi) {
          body.pairId = pairIdForApi;
        }
        const res = await fetch("/api/analysis/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof json.error === "string" ? json.error : `Analysis failed (${res.status})`
          );
        }
        setAnalysis(json);
        setModelIndex(0);
      } catch (e) {
        if (e.name === "AbortError") {
          return;
        }
        setAnalysis(null);
        setAnalysisError(e instanceof Error ? e.message : "Analysis request failed.");
      } finally {
        setAnalysisLoading(false);
      }
    })();

    return () => ac.abort();
  }, [open, baitName, preyName, pairIdForApi, ctxSid, ctxIid]);

  if (!data) return null;

  const expectingIngestMetrics =
    Boolean(String(ctxSid || "").trim()) && Boolean(String(ctxIid || "").trim());
  const builtDisplayModels = buildDisplayModelsFromAnalysis(analysis?.perModel);
  const displayModels =
    builtDisplayModels ?? (expectingIngestMetrics ? [] : MOCK_MODELS);
  const usingDemoMetricPlaceholders = !builtDisplayModels && !expectingIngestMetrics;
  const metricsReady = Boolean(builtDisplayModels?.length);
  const currentModel =
    displayModels[modelIndex] ?? displayModels[0] ?? EMPTY_METRICS_MODEL;
  const modelsHighConfidence = displayModels.filter((m) => m.ipTM > 0.8).length;
  const confidences = displayModels.map((m) => m.ipTM).filter((v) => Number.isFinite(v));
  const confMin = confidences.length ? Math.min(...confidences) : 0;
  const confMax = confidences.length ? Math.max(...confidences) : 0;
  const confSpread = confMax - confMin;
  const tightCrossModel =
    confidences.length <= 1 || confSpread <= 0.08;

  const perRow = analysis?.perModel?.[modelIndex];
  const relPath = perRow?.cifRelativePath;
  const structureUrl =
    ctxSid && ctxIid && relPath
      ? `/api/results/structure?sessionId=${encodeURIComponent(ctxSid)}&ingestId=${encodeURIComponent(ctxIid)}&relPath=${encodeURIComponent(relPath)}`
      : null;

  const chainA = perRow?.baitChain || "A";
  const chainB = perRow?.preyChain || "B";
  const iface = perRow?.interface && typeof perRow.interface === "object" ? perRow.interface : {};
  const rawIfaceA = iface.baitInterfaceResidues;
  const rawIfaceB = iface.preyInterfaceResidues;
  const interfaceResiduesA =
    Array.isArray(rawIfaceA) && rawIfaceA.length > 0 ? rawIfaceA : EMPTY_RESIDUES;
  const interfaceResiduesB =
    Array.isArray(rawIfaceB) && rawIfaceB.length > 0 ? rawIfaceB : EMPTY_RESIDUES;

  const hasRealAnalysis = Boolean(analysis?.perModel?.length);
  const modelWarnings = Array.isArray(perRow?.warnings) ? perRow.warnings : [];
  const interfaceDetectionOk = Boolean(perRow?.interfaceOk);
  const confidenceMetricsMissing =
    hasRealAnalysis &&
    perRow &&
    finiteMetric(perRow.iptm) == null &&
    finiteMetric(perRow.ptm) == null;

  const getConfidenceLevel = (ipTM) => {
    if (ipTM > 0.8) return { label: "High", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 };
    if (ipTM > 0.5) return { label: "Medium", color: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: AlertCircle };
    return { label: "Low", color: "bg-red-100 text-red-700 border-red-200", icon: XCircle };
  };
  const confidence = getConfidenceLevel(currentModel.ipTM);
  const ConfidenceIcon = confidence.icon;

  const safeFilenamePart = (s) =>
    String(s || "x")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 80);

  const runTargetRegionAnalyze = () => {
    setRegionError(null);
    const start = parseInt(String(regionStartStr).trim(), 10);
    const end = parseInt(String(regionEndStr).trim(), 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1) {
      setRegionError(
        `Enter valid 1-based residue numbers on bait chain ${chainA} (positive integers).`
      );
      return;
    }
    const lo = Math.min(Math.floor(start), Math.floor(end));
    const hi = Math.max(Math.floor(start), Math.floor(end));
    const iface = sortedUniquePositiveInts(interfaceResiduesA);
    const inRange = iface.filter((r) => r >= lo && r <= hi);
    const regionLen = hi - lo + 1;
    const pctRegionWithIface =
      regionLen > 0 ? Math.round((inRange.length / regionLen) * 1000) / 10 : 0;
    const pctIfaceInRegion =
      iface.length > 0 ? Math.round((inRange.length / iface.length) * 1000) / 10 : 0;
    setTargetAnalysis({
      start: lo,
      end: hi,
      regionLen,
      ifaceOnBaitCount: iface.length,
      overlapCount: inRange.length,
      pctIfaceInRegion,
      pctRegionWithIface,
      overlapResiduesA: inRange
    });
  };

  const handleExportStructure = async () => {
    setActionError(null);
    if (!structureUrl) {
      setActionError("No structure file for this model—upload results with mmCIF paths.");
      return;
    }
    try {
      const res = await fetch(structureUrl);
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Download failed (${res.status}) ${errText.slice(0, 120)}`);
      }
      const text = await res.text();
      const base = `${safeFilenamePart(data.bait)}_${safeFilenamePart(data.prey)}_m${modelIndex + 1}`;
      const blob = new Blob([text], { type: "chemical/x-mmcif;charset=utf-8" });
      downloadBlob(`${base}.cif`, blob);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Export failed.");
    }
  };

  const handleDownloadMetricsCsv = () => {
    setActionError(null);
    const rows = [
      [
        "bait",
        "prey",
        "model",
        "ipTM",
        "ranking",
        "contacts",
        "interfaceSize",
        "clashScore",
        "metricsSource"
      ],
      ...displayModels.map((m, i) => [
        data.bait,
        data.prey,
        i + 1,
        m.ipTM,
        m.ranking,
        m.contacts,
        m.interfaceSize,
        m.clashScore,
        metricsReady ? "ingest" : expectingIngestMetrics ? "pending_or_error" : "demo_placeholder"
      ])
    ];
    const csv = rows.map((r) => r.map(escapeCsvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(
      `${safeFilenamePart(data.bait)}_${safeFilenamePart(data.prey)}_metrics.csv`,
      blob
    );
  };

  const handleGenerateReport = () => {
    setActionError(null);
    const lines = [
      `Interaction: ${data.bait} × ${data.prey}`,
      `Matrix key: ${data.bait}:${data.prey}`,
      `Session ID: ${ctxSid || "(none)"}`,
      `Ingest ID: ${ctxIid || "(none)"}`,
      `Pair ID (if any): ${pairIdForApi || "(none)"}`,
      `Metrics source: ${
        metricsReady
          ? "ingest (/api/analysis/pair)"
          : expectingIngestMetrics
            ? "waiting or failed (session+ingest set, no perModel yet)"
            : "demo placeholders (no session/ingest)"
      }`,
      "",
      `Selected model index: ${modelIndex + 1} of ${displayModels.length}`,
      `ipTM: ${currentModel.ipTM}`,
      `Ranking / composite: ${currentModel.ranking}`,
      `Contacts (if known): ${currentModel.contacts}`,
      `Interface size proxy: ${currentModel.interfaceSize}`,
      "",
      structureUrl ? `Structure path: ${relPath || "(unknown)"}` : "Structure: (none for this model)",
      ""
    ];
    if (targetAnalysis) {
      lines.push(
        "Target region (bait chain vs interface on bait)",
        `  Range: ${targetAnalysis.start}–${targetAnalysis.end} (${targetAnalysis.regionLen} residues)`,
        `  Interface residues on bait (total): ${targetAnalysis.ifaceOnBaitCount}`,
        `  Interface residues in range: ${targetAnalysis.overlapCount}`,
        `  % of bait interface in range: ${targetAnalysis.pctIfaceInRegion}%`,
        `  % of range covered by interface: ${targetAnalysis.pctRegionWithIface}%`
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    downloadBlob(
      `${safeFilenamePart(data.bait)}_${safeFilenamePart(data.prey)}_report.txt`,
      blob
    );
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-2xl w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col">
          <div className="flex items-start justify-between p-6 border-b border-gray-200">
            <div>
              <Dialog.Title className="text-xl font-semibold text-gray-900">
                Interaction Details
              </Dialog.Title>
              <Dialog.Description className="text-sm text-gray-500 mt-1">
                {data.bait} × {data.prey}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-6 p-6">
              <div className="space-y-4">
                {analysisLoading && (
                  <p className="text-xs text-gray-500">Loading structure metadata…</p>
                )}
                {!analysisLoading && !ctxSid && (
                  <p className="text-xs text-sky-900 bg-sky-50 border border-sky-200 rounded px-2 py-1.5">
                    No active session: the matrix can still show demo scores. Use the toolbar to open
                    or create a session, upload AF3 results, then open this pair again for structures
                    and analysis.
                  </p>
                )}
                {!analysisLoading && ctxSid && !ctxIid && (
                  <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    Session is set but no results ingest is linked yet (or the server cannot see{" "}
                    <code className="text-amber-950">parsed.json</code> for this session). Upload a
                    results .zip or set <code className="text-amber-950">AF3_USE_LOCAL_STORAGE=1</code>{" "}
                    if data is only on disk.
                  </p>
                )}
                {analysisError && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    <span className="font-medium">Pair analysis failed.</span> {analysisError} Metric
                    columns stay empty (no demo numbers). Structures need a successful analysis and
                    mmCIF paths when you retry.
                  </p>
                )}

                {hasRealAnalysis && perRow && !analysisLoading && (
                  <div
                    className={`rounded-md border px-3 py-2 text-xs ${
                      interfaceDetectionOk
                        ? "border-gray-200 bg-gray-50 text-gray-800"
                        : "border-amber-300 bg-amber-50 text-amber-950"
                    }`}
                  >
                    <p className="font-medium text-gray-900 mb-1">Ingest analysis (selected model)</p>
                    <ul className="space-y-0.5 text-gray-700">
                      <li>
                        Interface residues:{" "}
                        <span className="font-mono">
                          {interfaceResiduesA.length} (bait {chainA}) · {interfaceResiduesB.length} (prey{" "}
                          {chainB})
                        </span>
                      </li>
                      <li>
                        mmCIF chains detected:{" "}
                        <span className="font-mono">
                          {Array.isArray(perRow.chains) && perRow.chains.length
                            ? perRow.chains.join(", ")
                            : "—"}
                        </span>
                      </li>
                      <li>
                        Interface parsing:{" "}
                        {interfaceDetectionOk ? (
                          <span className="text-green-800">success</span>
                        ) : (
                          <span className="text-amber-900 font-medium">failed or empty</span>
                        )}
                      </li>
                      {confidenceMetricsMissing && (
                        <li className="text-amber-900">
                          No ipTM or pTM in parsed metrics for this model.
                          {finiteMetric(perRow.displayConfidence) != null &&
                          finiteMetric(perRow.displayConfidence) > 0 ? (
                            <>
                              {" "}
                              Displayed confidence and model consistency use the normalized ranking
                              proxy (same idea as the matrix).
                            </>
                          ) : (
                            <>
                              {" "}
                              If the matrix still has a score, re-open this panel after deploy; else
                              check summary JSON and ranking_scores.csv in the zip.
                            </>
                          )}
                        </li>
                      )}
                    </ul>
                    {modelWarnings.length > 0 && (
                      <ul className="mt-2 list-disc pl-4 text-amber-900 space-y-0.5 max-h-28 overflow-y-auto">
                        {modelWarnings.map((w, i) => (
                          <li key={i}>{typeof w === "string" ? w : String(w)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <MolViewer
                  structureUrl={structureUrl}
                  chainA={chainA}
                  chainB={chainB}
                  interfaceResiduesA={interfaceResiduesA}
                  interfaceResiduesB={interfaceResiduesB}
                  annotatedRegionA={annotatedListA}
                  annotatedRegionB={annotatedListB}
                  overlapResiduesA={
                    targetAnalysis ? targetAnalysis.overlapResiduesA : undefined
                  }
                  height={420}
                />

                <div className="rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px] leading-snug text-gray-600">
                  <span className="font-medium text-gray-800">Viewer</span>
                  <span className="text-gray-400"> — strongest on top: </span>
                  <span className="text-gray-700">
                    <span className="inline-flex items-center gap-0.5">
                      <span className="inline-block w-2 h-2 rounded-sm bg-red-500 shrink-0" />
                      overlap
                    </span>
                    <span className="text-gray-300 mx-1">·</span>
                    <span className="inline-flex items-center gap-0.5">
                      <span className="inline-block w-2 h-2 rounded-sm bg-cyan-500 shrink-0" />
                      interface
                    </span>
                    <span className="text-gray-300 mx-1">·</span>
                    <span className="inline-flex items-center gap-0.5">
                      <span className="inline-block w-2 h-2 rounded-sm bg-amber-500 shrink-0" />
                      annotated
                    </span>
                    <span className="text-gray-300 mx-1">·</span>
                    <span className="inline-flex items-center gap-0.5">
                      <span className="inline-block w-2 h-2 rounded-sm bg-slate-300 shrink-0" />
                      base
                    </span>
                  </span>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Model
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {displayModels.length === 0 ? (
                      <span className="text-sm text-gray-500 px-1 py-2">
                        {expectingIngestMetrics && analysisLoading
                          ? "Loading…"
                          : expectingIngestMetrics
                            ? "No models in analysis response."
                            : "—"}
                      </span>
                    ) : (
                      displayModels.map((model, idx) => (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => setModelIndex(idx)}
                          className={`
                          flex-1 min-w-[3rem] px-3 py-2 rounded-md text-sm font-medium transition-colors relative
                          ${modelIndex === idx ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}
                        `}
                        >
                          {model.id}
                          {model.isBest && (
                            <span className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full border-2 border-white" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  {currentModel?.isBest && metricsReady && (
                    <span className="inline-block mt-2 px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                      Best model (by composite / ipTM)
                    </span>
                  )}
                </div>

                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-4 h-4 text-gray-600" />
                    <label className="text-sm font-medium text-gray-700">
                      Target region (bait chain {chainA})
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">
                    1-based residue range on the bait chain. Compares to interface residues from the
                    current model (after ingest analysis). Overlap highlights in red in the viewer when
                    a structure is loaded.
                  </p>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      type="number"
                      min={1}
                      placeholder="Start"
                      value={regionStartStr}
                      onChange={(e) => setRegionStartStr(e.target.value)}
                      className="flex-1 min-w-[5rem] px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-gray-400">–</span>
                    <input
                      type="number"
                      min={1}
                      placeholder="End"
                      value={regionEndStr}
                      onChange={(e) => setRegionEndStr(e.target.value)}
                      className="flex-1 min-w-[5rem] px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={runTargetRegionAnalyze}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 shrink-0"
                    >
                      Analyze
                    </button>
                  </div>
                  {regionError && (
                    <p className="text-xs text-red-700 mt-2">{regionError}</p>
                  )}
                  {interfaceResiduesA.length === 0 && hasRealAnalysis && (
                    <p className="text-xs text-amber-800 mt-2">
                      No bait-side interface residues in this model—region overlap will stay empty until
                      the structure parses interface residues.
                    </p>
                  )}
                  {annotatedListA.length + annotatedListB.length > 0 && (
                    <p className="text-xs text-gray-500 mt-2">
                      Manifest <code className="text-gray-700">regions</code> still drive the amber
                      “annotated” layer; this tool adds a separate numeric range on bait.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                {expectingIngestMetrics && !metricsReady && analysisLoading && (
                  <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
                    <span className="font-medium">Loading pair analysis…</span>{" "}
                    <span className="text-sky-800">
                      (Avoiding demo numbers—metrics appear when /api/analysis/pair finishes.)
                    </span>
                  </div>
                )}
                {usingDemoMetricPlaceholders && !analysisLoading && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                    <span className="font-medium">Demo metrics.</span> Toolbar: load or create a
                    session, upload AF3 results, then reopen this cell for real scores, interface data,
                    and structures.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                    <p className="text-xs text-blue-600 font-medium mb-1">Protein A (Bait)</p>
                    <p className="text-lg font-semibold text-blue-900">{data.bait}</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                    <p className="text-xs text-purple-600 font-medium mb-1">Protein B (Prey)</p>
                    <p className="text-lg font-semibold text-purple-900">{data.prey}</p>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Confidence Metrics</h3>
                  {!metricsReady ? (
                    <p className="text-sm text-gray-500">
                      {expectingIngestMetrics && analysisLoading
                        ? "Loading…"
                        : "Scores appear here after ingest analysis."}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Displayed confidence</span>
                        <span className="text-sm font-semibold text-gray-900">
                          {currentModel.ipTM.toFixed(3)}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 -mt-1">
                        Same 0–1 scale as the matrix (ipTM → pTM → ranking proxy). Not always raw
                        ipTM from JSON.
                      </p>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Composite / ranking</span>
                        <span className="text-sm font-semibold text-gray-900">
                          {currentModel.ranking.toFixed(3)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Confidence Level</span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium ${confidence.color}`}
                        >
                          <ConfidenceIcon className="w-3 h-3" />
                          {confidence.label}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Interface Metrics</h3>
                  {!metricsReady ? (
                    <p className="text-sm text-gray-500">
                      {expectingIngestMetrics && analysisLoading ? "Loading…" : "—"}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Number of Contacts</span>
                        <span className="text-sm font-semibold text-gray-900">
                          {currentModel.contacts}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Interface size (res. count proxy)</span>
                        <span className="text-sm font-semibold text-gray-900">
                          {currentModel.interfaceSize}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Clash Score</span>
                        <span className="text-sm font-semibold text-gray-900">
                          {currentModel.clashScore.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {targetAnalysis && (
                  <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg border border-blue-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      Region vs interface (bait)
                    </h3>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-sm text-gray-600">Residue range</span>
                          <span className="text-sm font-semibold text-gray-900">
                            {targetAnalysis.start}–{targetAnalysis.end}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {targetAnalysis.regionLen} residue(s) on chain {chainA}
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Bait interface in range</span>
                        <span className="text-sm font-semibold text-blue-600">
                          {targetAnalysis.overlapCount} / {targetAnalysis.ifaceOnBaitCount}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">% of bait interface in range</span>
                        <span className="text-sm font-semibold text-gray-900">
                          {targetAnalysis.pctIfaceInRegion}%
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">% of range covered by interface</span>
                        <span className="text-sm font-semibold text-purple-600">
                          {targetAnalysis.pctRegionWithIface}%
                        </span>
                      </div>
                      <div className="pt-2 mt-2 border-t border-blue-200">
                        <div className="flex items-center gap-2">
                          {targetAnalysis.pctRegionWithIface >= 50 ? (
                            <>
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                              <span className="text-sm font-medium text-green-700">
                                Much of this range contacts the prey (by residue overlap)
                              </span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-4 h-4 text-yellow-600" />
                              <span className="text-sm font-medium text-yellow-700">
                                Limited interface overlap in this range
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">Model consistency</h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Per-model displayed confidence (same scale as the matrix). Green = high (&gt;0.8),
                    amber = medium (&gt;0.5). Demo session (no upload) uses fixed sample numbers—never
                    confused with ingest.
                  </p>
                  <div className="space-y-3">
                    {displayModels.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-2">
                        {expectingIngestMetrics && analysisLoading
                          ? "Loading per-model confidence…"
                          : "No models to compare yet."}
                      </p>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          {displayModels.map((model, idx) => {
                            const v = model.ipTM;
                            const high = v > 0.8;
                            const medium = v > 0.5 && !high;
                            const tierClass = high
                              ? "bg-green-50 border-green-500 text-green-700"
                              : medium
                                ? "bg-amber-50 border-amber-400 text-amber-900"
                                : "bg-gray-50 border-gray-300 text-gray-500";
                            return (
                              <div
                                key={model.id}
                                title={`Confidence ${v.toFixed(2)}`}
                                className={`
                              flex-1 min-h-[3.25rem] py-1.5 rounded-md border-2 flex flex-col items-center justify-center text-xs font-medium leading-tight px-0.5
                              ${tierClass}
                              ${modelIndex === idx ? "ring-2 ring-blue-500" : ""}
                            `}
                              >
                                <span>{model.id}</span>
                                <span className="text-[10px] font-normal opacity-90">
                                  {v.toFixed(2)}
                                </span>
                                {high && <CheckCircle2 className="w-3 h-3 mt-0.5" />}
                                {medium && !high && (
                                  <AlertCircle className="w-3 h-3 mt-0.5 text-amber-600" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="text-sm text-gray-600 text-center space-y-1">
                          <p>
                            <span className="font-semibold text-gray-900">
                              {modelsHighConfidence}/{displayModels.length}
                            </span>{" "}
                            models above 0.8 (high confidence bar)
                          </p>
                          {confidences.length > 1 && (
                            <p
                              className={
                                tightCrossModel
                                  ? "text-green-700 font-medium"
                                  : "text-gray-600"
                              }
                            >
                              {tightCrossModel
                                ? `Similar confidence across models (range ${confSpread.toFixed(2)}).`
                                : `Spread across models: ${confMin.toFixed(2)}–${confMax.toFixed(2)} (Δ ${confSpread.toFixed(2)}).`}
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-gray-200 bg-gray-50 space-y-3">
            {actionError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                {actionError}
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={handleExportStructure}
                disabled={!structureUrl}
                title={
                  structureUrl
                    ? "Download current model mmCIF from ingest"
                    : "Requires uploaded results with a structure path for this model"
                }
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-45 disabled:pointer-events-none disabled:cursor-not-allowed"
              >
                Export structure (.cif)
              </button>
              <button
                type="button"
                onClick={handleDownloadMetricsCsv}
                className="flex-1 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium"
              >
                Download metrics (CSV)
              </button>
              <button
                type="button"
                onClick={handleGenerateReport}
                className="flex-1 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium"
              >
                Generate report (.txt)
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export { DetailPanel };
