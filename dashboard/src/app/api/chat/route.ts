// ── SSE streaming proxy for agentic chat ─────────────────────────────
// Next.js rewrites buffer responses, killing SSE. This route handler
// pipes the backend SSE stream straight through to the browser
// using a ReadableStream so every chunk is forwarded immediately.

import { NextRequest } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";

// Force edge runtime so Next.js doesn't buffer the response body
export const runtime = "edge";

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

  // Create a pass-through stream that forwards every chunk immediately.
  // Using pull() instead of start() so the stream is "ready" right away
  // and each chunk is forwarded as soon as the consumer asks for more.
  const reader = backendRes.body.getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
