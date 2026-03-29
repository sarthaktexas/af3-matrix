import { useEffect, useRef, useState } from "react";
import { FolderOpen, ChevronDown, Loader2, X } from "lucide-react";

function formatSessionHint(s) {
  if (!s?.updatedAt) return "";
  const d = new Date(s.updatedAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function shortSessionLabel(id) {
  if (!id) return "No session";
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function SessionBar({ sessionId, onLoadSession, onClearSession }) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingPick, setLoadingPick] = useState(false);
  const [listError, setListError] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingList(true);
      setListError(null);
      try {
        const res = await fetch("/api/sessions");
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setListError(
            typeof data?.error === "string" ? data.error : "Could not load sessions."
          );
          setSessions([]);
          return;
        }
        setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      } catch {
        if (!cancelled) setListError("Network error.");
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function pick(sid) {
    setLoadingPick(true);
    try {
      await onLoadSession(sid);
      setOpen(false);
    } finally {
      setLoadingPick(false);
    }
  }

  return (
    <div className="relative flex items-center gap-1" ref={wrapRef}>
      <button
        type="button"
        disabled={loadingPick}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-gray-800 rounded-md hover:bg-gray-50 text-sm font-medium min-w-[11rem]"
      >
        <FolderOpen className="w-4 h-4 text-gray-500 shrink-0" />
        <span className="font-mono text-xs truncate flex-1 text-left">
          {loadingPick ? "Loading…" : shortSessionLabel(sessionId)}
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {sessionId ? (
        <button
          type="button"
          title="Clear active session"
          onClick={() => {
            onClearSession();
            setOpen(false);
          }}
          className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-md"
        >
          <X className="w-4 h-4" />
        </button>
      ) : null}
      {open ? (
        <div className="absolute right-0 top-full mt-1 z-50 w-[22rem] max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1">
          <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
            Open a saved session (manifest + latest ingest). Local dev uses
            on-disk data; cloud uses Supabase + Blob.
          </div>
          {loadingList ? (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-gray-600">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              Loading sessions…
            </div>
          ) : null}
          {!loadingList && listError ? (
            <div className="px-3 py-2 text-sm text-red-700">{listError}</div>
          ) : null}
          {!loadingList && !listError && sessions.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-600">
              No sessions yet. Generate AF3 jobs or upload results to create one.
            </div>
          ) : null}
          {!loadingList && !listError
            ? sessions.map((s) => (
                <button
                  key={s.sessionId}
                  type="button"
                  disabled={loadingPick}
                  onClick={() => pick(s.sessionId)}
                  className={`w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b border-gray-50 last:border-0 disabled:opacity-50 ${
                    sessionId === s.sessionId ? "bg-blue-50/90" : ""
                  }`}
                >
                  <div className="font-mono text-[11px] text-gray-900 break-all leading-snug">
                    {s.sessionId}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {s.pairCount} pairs · {s.ingestCount} ingest(s)
                    {s.updatedAt ? ` · ${formatSessionHint(s)}` : ""}
                  </div>
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

export { SessionBar };
