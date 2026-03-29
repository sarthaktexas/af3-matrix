import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Sparkles, AlertCircle, CheckCircle2, Download } from "lucide-react";

const DEFAULT_BATCH_SIZE = 50;

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function GenerateAf3JobsModal({
  open,
  onClose,
  proteins,
  sessionId,
  onSessionIdChange
}) {
  const [batchSize, setBatchSize] = useState(String(DEFAULT_BATCH_SIZE));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const preview = useMemo(() => {
    const baits = proteins.filter((p) => p.type === "bait");
    const preys = proteins.filter((p) => p.type === "prey");
    return {
      baitCount: baits.length,
      preyCount: preys.length,
      pairCount: baits.length * preys.length
    };
  }, [proteins]);

  useEffect(() => {
    if (!open) {
      setLoading(false);
      setError(null);
      setSuccess(null);
    }
  }, [open]);

  const handleOpenChange = (next) => {
    if (!next) onClose();
  };

  const runGenerate = async () => {
    setError(null);
    setSuccess(null);

    if (preview.baitCount === 0 || preview.preyCount === 0) {
      setError("Add at least one bait and one prey before generating jobs.");
      return;
    }

    let batchNum = DEFAULT_BATCH_SIZE;
    const parsed = parseInt(batchSize, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 500) {
      batchNum = parsed;
    } else {
      setError("Batch size must be an integer from 1 to 500.");
      return;
    }

    setLoading(true);
    try {
      const pairsBody = {
        proteins,
        ...(sessionId?.trim() ? { sessionId: sessionId.trim() } : {})
      };
      const pairsRes = await fetch("/api/pairs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pairsBody)
      });
      const pairsData = await pairsRes.json().catch(() => ({}));
      if (!pairsRes.ok) {
        const msg =
          pairsData?.error ||
          pairsData?.details ||
          `Pairs step failed (${pairsRes.status})`;
        const detailStr =
          Array.isArray(pairsData?.details) && pairsData.details.length
            ? `: ${pairsData.details.join("; ")}`
            : "";
        setError(
          typeof msg === "string" ? `${msg}${detailStr}` : JSON.stringify(msg)
        );
        return;
      }

      const sid = pairsData.sessionId;
      if (sid) onSessionIdChange?.(sid);

      const exportRes = await fetch("/api/af3/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, batchSize: batchNum })
      });
      const exportData = await exportRes.json().catch(() => ({}));
      if (!exportRes.ok) {
        const msg =
          exportData?.error ||
          exportData?.details ||
          `Export failed (${exportRes.status})`;
        setError(typeof msg === "string" ? msg : JSON.stringify(msg));
        return;
      }

      setSuccess({
        sessionId: exportData.sessionId,
        totalJobs: exportData.totalJobs,
        batchCount: exportData.batchCount,
        batchSize: exportData.batchSize,
        exportRunId: exportData.exportRunId,
        batches: exportData.batches,
        pairsWarnings: Array.isArray(pairsData.warnings)
          ? pairsData.warnings
          : []
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
          <div className="flex items-start justify-between p-6 border-b border-gray-200">
            <div>
              <Dialog.Title className="text-xl font-semibold text-gray-900">
                Generate AF3 Jobs
              </Dialog.Title>
              <Dialog.Description className="text-sm text-gray-500 mt-1">
                Create bait × prey pairs for this matrix and build AlphaFold
                Server batch JSON files.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="p-6 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-center">
                <p className="text-xs font-medium text-blue-700">Baits</p>
                <p className="text-lg font-semibold text-blue-900">
                  {preview.baitCount}
                </p>
              </div>
              <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-center">
                <p className="text-xs font-medium text-purple-700">Preys</p>
                <p className="text-lg font-semibold text-purple-900">
                  {preview.preyCount}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-center">
                <p className="text-xs font-medium text-gray-600">Pairs</p>
                <p className="text-lg font-semibold text-gray-900">
                  {preview.pairCount}
                </p>
              </div>
            </div>

            {sessionId ? (
              <p className="text-xs text-gray-600">
                Reusing session{" "}
                <span className="font-mono text-gray-800">{sessionId}</span>{" "}
                so new exports stay with the same manifest.
              </p>
            ) : (
              <p className="text-xs text-gray-600">
                A new session ID will be created on first run and stored for
                uploads and later exports.
              </p>
            )}

            <div>
              <label
                htmlFor="af3-batch-size"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Jobs per batch file
              </label>
              <input
                id="af3-batch-size"
                type="number"
                min={1}
                max={500}
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                AlphaFold Server accepts JSON arrays of jobs; default 50 per
                file.
              </p>
            </div>

            {error && (
              <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="space-y-3 rounded-md border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-900">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  {success.totalJobs} jobs in {success.batchCount} batch file(s)
                </div>
                <p className="text-xs font-mono text-green-800/90 break-all">
                  Session: {success.sessionId}
                  {success.exportRunId ? ` · run ${success.exportRunId}` : ""}
                </p>
                {success.pairsWarnings.length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-2 max-h-24 overflow-y-auto">
                    {success.pairsWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {success.batches?.map((batch, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() =>
                        downloadJson(
                          `af3-batch-${String(i + 1).padStart(3, "0")}-of-${String(success.batchCount).padStart(3, "0")}.json`,
                          batch
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-green-300 text-green-900 rounded-md text-xs font-medium hover:bg-green-100 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Batch {i + 1} ({batch?.length ?? 0})
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={runGenerate}
                disabled={loading}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:pointer-events-none"
              >
                <Sparkles className="w-4 h-4" />
                {loading ? "Working…" : "Generate pairs & batches"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export { GenerateAf3JobsModal };
