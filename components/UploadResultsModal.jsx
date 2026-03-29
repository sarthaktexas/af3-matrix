import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, FileUp, AlertCircle, CheckCircle2 } from "lucide-react";
import { resultsMapFromUploadJobs } from "@/lib/ingest-to-matrix";

function UploadResultsModal({
  open,
  onClose,
  sessionId,
  onSessionIdChange,
  onApplyResults,
  onIngestLoaded
}) {
  const [localSessionId, setLocalSessionId] = useState("");
  const [selectedFileName, setSelectedFileName] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const successRef = useRef(null);
  const wasOpenRef = useRef(false);

  // Reset only when the dialog opens — not when sessionId updates after a
  // successful upload (that was clearing the success summary immediately).
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setLocalSessionId(sessionId || "");
      setSelectedFileName(null);
      setError(null);
      setSummary(null);
    }
    wasOpenRef.current = open;
    // sessionId is intentionally read only on open (see comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when dialog opens, not when sessionId changes mid-flight
  }, [open]);

  useEffect(() => {
    if (!summary || !successRef.current) return;
    successRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [summary]);

  const handleOpenChange = (next) => {
    if (!next) onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSummary(null);
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("resultsZip");
    const file = fileInput?.files?.[0];
    if (!file) {
      setError("Choose a .zip file of AF3 results.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Upload must be a .zip archive.");
      return;
    }

    const fd = new FormData();
    const sid = localSessionId.trim();
    if (sid) fd.append("sessionId", sid);
    fd.append("file", file);

    setSubmitting(true);
    try {
      const res = await fetch("/api/results/upload", {
        method: "POST",
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data?.error ||
          data?.details ||
          `Upload failed (${res.status})`;
        setError(typeof msg === "string" ? msg : JSON.stringify(msg));
        return;
      }

      if (data.sessionId && data.sessionId !== sessionId) {
        onSessionIdChange?.(data.sessionId);
      }
      if (data.sessionId) {
        setLocalSessionId(data.sessionId);
      }

      const sid = data.sessionId || sessionId || localSessionId.trim();
      if (sid && data.ingestId) {
        onIngestLoaded?.({ sessionId: sid, ingestId: data.ingestId });
      }

      const mapped = resultsMapFromUploadJobs(data.jobs);
      const unmapped = Array.isArray(data.jobs)
        ? data.jobs.filter((j) => !j?.matrixKey).length
        : 0;
      onApplyResults?.(mapped);

      setSummary({
        ingestId: data.ingestId,
        sessionId: data.sessionId,
        jobCount: data.jobCount,
        matrixCells: mapped.size,
        unmappedJobs: unmapped,
        parseWarnings: Array.isArray(data.parseWarnings)
          ? data.parseWarnings
          : []
      });
      fileInput.value = "";
      setSelectedFileName(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
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
                Upload Results
              </Dialog.Title>
              <Dialog.Description className="text-sm text-gray-500 mt-1">
                Import an AF3 results .zip to fill matrix scores (uses your
                session manifest when the same session ID is set).
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

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label
                htmlFor="upload-session-id"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Session ID{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="upload-session-id"
                type="text"
                value={localSessionId}
                onChange={(e) => setLocalSessionId(e.target.value)}
                placeholder="Same ID as &quot;Generate AF3 Jobs&quot; for pairing"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                Leave blank to start a new ingest folder; include it if you
                exported jobs from this app so pair IDs match.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Results archive (.zip)
              </label>
              <label className="flex flex-col items-center justify-center gap-1 px-4 py-3 bg-gray-50 border-2 border-dashed border-gray-300 text-gray-700 rounded-md hover:bg-gray-100 transition-colors cursor-pointer">
                <span className="flex items-center gap-2">
                  <FileUp className="w-4 h-4 shrink-0" />
                  <span className="text-sm">
                    {selectedFileName
                      ? "Change .zip file"
                      : "Choose AF3 results .zip"}
                  </span>
                </span>
                {selectedFileName && (
                  <span className="text-xs font-mono text-gray-600 break-all text-center max-w-full px-1">
                    {selectedFileName}
                  </span>
                )}
                <input
                  id="results-zip"
                  name="resultsZip"
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(ev) => {
                    const f = ev.target.files?.[0];
                    setSelectedFileName(f ? f.name : null);
                    setError(null);
                  }}
                />
              </label>
              <p className="text-xs text-gray-500 mt-1">
                After choosing a file, click{" "}
                <span className="font-medium text-gray-700">
                  Upload &amp; apply
                </span>{" "}
                to parse and merge scores into the matrix.
              </p>
            </div>

            {error && (
              <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {summary && (
              <div
                ref={successRef}
                role="status"
                aria-live="polite"
                className="rounded-lg border-2 border-green-300 bg-green-50 px-4 py-4 text-green-950 shadow-sm space-y-2"
              >
                <div className="text-base font-semibold flex items-center gap-2">
                  <CheckCircle2
                    className="w-5 h-5 text-green-600 shrink-0"
                    aria-hidden
                  />
                  Upload complete
                </div>
                <p className="text-sm">
                  Parsed {summary.jobCount} job(s); updated{" "}
                  {summary.matrixCells} matrix cell(s).
                </p>
                {summary.unmappedJobs > 0 && (
                  <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    {summary.unmappedJobs} job(s) had no manifest match—set
                    Session ID to the one from job generation, then re-upload.
                  </p>
                )}
                {summary.parseWarnings.length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-green-900/90 space-y-1 max-h-32 overflow-y-auto">
                    {summary.parseWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:pointer-events-none"
              >
                {submitting ? "Uploading…" : "Upload & apply"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                {summary ? "Done" : "Cancel"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export { UploadResultsModal };
