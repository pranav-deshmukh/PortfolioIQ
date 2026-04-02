// ── SSE streaming proxy for agentic chat ─────────────────────────────
// Next.js rewrites buffer responses, killing SSE. This route handler
// pipes the backend SSE stream straight through to the browser.

import { NextRequest } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const backendRes = await fetch(`${BACKEND}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!backendRes.ok || !backendRes.body) {
    const errText = await backendRes.text().catch(() => "Unknown error");
    return new Response(JSON.stringify({ error: errText }), {
      status: backendRes.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Pipe the SSE stream straight through — no buffering
  return new Response(backendRes.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
