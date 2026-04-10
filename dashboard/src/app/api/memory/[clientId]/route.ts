import { NextRequest } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";

interface RouteContext {
  params: Promise<{ clientId: string }>;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const { clientId } = await context.params;

  const backendRes = await fetch(`${BACKEND}/api/memory/${clientId}`, {
    method: "GET",
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
