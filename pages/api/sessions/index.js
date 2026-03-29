/**
 * GET /api/sessions — list saved sessions (local disk or Supabase index).
 */

import { listSessions } from "@/lib/storage";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  try {
    const sessions = await listSessions();
    return res.status(200).json({ ok: true, sessions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({
      error: "Failed to list sessions.",
      details: msg
    });
  }
}
