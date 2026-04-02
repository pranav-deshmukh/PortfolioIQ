// ── API helper functions ─────────────────────────────────────────────
// All calls go to /api/* which Next.js rewrites to localhost:3001

import type { Alert, Insight, PipelineRun, Client } from "@/types";

const headers = { "Content-Type": "application/json" };

export async function fetchAlerts(all = true): Promise<Alert[]> {
  const res = await fetch(`/api/alerts?all=${all}`);
  if (!res.ok) throw new Error(`Failed to fetch alerts: ${res.status}`);
  return res.json();
}

export async function fetchInsights(clientId?: string | null, limit = 20): Promise<Insight[]> {
  const params = new URLSearchParams();
  if (clientId) params.set("client_id", clientId);
  if (limit) params.set("limit", String(limit));
  const res = await fetch(`/api/insights?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch insights: ${res.status}`);
  return res.json();
}

export async function fetchClients(): Promise<Client[]> {
  const res = await fetch("/api/clients");
  if (!res.ok) throw new Error(`Failed to fetch clients: ${res.status}`);
  return res.json();
}

export async function fetchPipelineRuns(limit = 10): Promise<PipelineRun[]> {
  const res = await fetch("/api/pipeline-runs");
  if (!res.ok) throw new Error(`Failed to fetch pipeline runs: ${res.status}`);
  return res.json();
}

export async function triggerPipeline(newsCount = 3): Promise<void> {
  const res = await fetch("/api/pipeline/run", {
    method: "POST",
    headers,
    body: JSON.stringify({ news_count: newsCount }),
  });
  if (!res.ok) throw new Error(`Failed to trigger pipeline: ${res.status}`);
}

export async function dismissAlert(alertId: string): Promise<void> {
  const res = await fetch(`/api/alerts/${alertId}/dismiss`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to dismiss alert: ${res.status}`);
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ── SSE event types from the agentic chat endpoint ───────────────────
export interface ToolCallEvent {
  type: "tool_call";
  name: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface ToolResultEvent {
  type: "tool_result";
  name: string;
  summary: string;
  preview: string;
}

export interface ResponseEvent {
  type: "response";
  content: string;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export interface DoneEvent {
  type: "done";
}

export type ChatSSEEvent =
  | ToolCallEvent
  | ToolResultEvent
  | ResponseEvent
  | ErrorEvent
  | DoneEvent;

export interface StreamChatCallbacks {
  onToolCall: (event: ToolCallEvent) => void;
  onToolResult: (event: ToolResultEvent) => void;
  onResponse: (content: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

/**
 * Stream chat via SSE — reads tool_call/tool_result/response events.
 * Returns an AbortController so the caller can cancel.
 */
export function streamChatMessage(
  message: string,
  clientId: string | null,
  history: ChatMessage[],
  callbacks: StreamChatCallbacks
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ message, client_id: clientId, history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        callbacks.onError(err.error || `Chat failed: ${res.status}`);
        callbacks.onDone();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json) continue;

          try {
            const event = JSON.parse(json) as ChatSSEEvent;
            switch (event.type) {
              case "tool_call":
                callbacks.onToolCall(event);
                break;
              case "tool_result":
                callbacks.onToolResult(event);
                break;
              case "response":
                callbacks.onResponse(event.content);
                break;
              case "error":
                callbacks.onError(event.message);
                break;
              case "done":
                callbacks.onDone();
                return;
            }
          } catch {
            // skip malformed events
          }
        }
      }

      callbacks.onDone();
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        callbacks.onError(
          err instanceof Error ? err.message : "Connection failed"
        );
      }
      callbacks.onDone();
    }
  })();

  return controller;
}
