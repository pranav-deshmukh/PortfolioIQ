import { NextRequest } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";

interface RouteContext {
  params: Promise<{ clientId: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { clientId } = await context.params;
  const bodyText = await req.text();

  const backendRes = await fetch(`${BACKEND}/api/memory/${clientId}/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyText || "{}",
    cache: "no-store",
  });

  const text = await backendRes.text();

  return new Response(text, {
    status: backendRes.status,
    headers: {
      "Content-Type": backendRes.headers.get("Content-Type") || "application/json",
    },
  });
}
