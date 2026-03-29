/**
 * Ingest folders / blob keys use ids from upload: `${Date.now().toString(36)}_${randomBytes(6).hex()}`.
 * Occasionally a bad client value appends ":<port>" (e.g. pasted URL). Strip that suffix when it matches.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeIngestId(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return s;
  const m = s.match(/^([a-z0-9]+_[a-f0-9]{12})(:\d+)+$/i);
  if (m) return m[1];
  return s;
}
