"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { BarChart3, Lightbulb, Bell, Users, Newspaper, FlaskConical, Wrench, Bot, MessageSquareText, Check, SendHorizonal, GitCompareArrows, TrendingUp, DatabaseZap } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/lib/api";
import { createClientMemory, fetchClientMemory, streamChatMessage } from "@/lib/api";

// ── Tool step shown in the UI while the agent works ──────────────────
interface ToolStep {
  name: string;
  summary: string;
  status: "running" | "done";
}

interface ChatPanelProps {
  clientId: string | null;
  clientLabel: string;
}

export default function ChatPanel({ clientId, clientLabel }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
  const [memoryStatus, setMemoryStatus] = useState<string | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevClientRef = useRef<string | null>(clientId);
  const abortRef = useRef<AbortController | null>(null);

  // ── Typewriter queue — smooth reveal even when tokens arrive in bulk ──
  const tokenQueueRef = useRef<string[]>([]);
  const typewriterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamDoneRef = useRef(false);
  const finalizedRef = useRef(false);  // guard: only finalize once per stream
  const receivedTokensRef = useRef(false);
  const suppressCurrentStreamRef = useRef(false);
  const finalizedContentRef = useRef<string | null>(null);

  const finalizeAssistantMessage = useCallback((explicitContent?: string) => {
    if (finalizedRef.current) {
      return;
    }

    finalizedRef.current = true;
    setStreamingContent((prev) => {
      const content = explicitContent ?? prev ?? "";

      if (
        content &&
        !suppressCurrentStreamRef.current &&
        finalizedContentRef.current !== content
      ) {
        finalizedContentRef.current = content;
        setMessages((msgs) => {
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && last.content === content) {
            return msgs;
          }

          return [...msgs, { role: "assistant", content }];
        });
      }

      return null;
    });
  }, []);

  /** Drain up to N chars from the token queue each tick */
  const startTypewriter = useCallback(() => {
    if (typewriterTimerRef.current) return; // already running
    const CHARS_PER_TICK = 3;
    const TICK_MS = 18; // ~55 chars/sec, feels natural
    typewriterTimerRef.current = setInterval(() => {
      const queue = tokenQueueRef.current;
      if (queue.length === 0) {
        if (streamDoneRef.current) {
          // Queue drained and stream finished — stop timer
          clearInterval(typewriterTimerRef.current!);
          typewriterTimerRef.current = null;
          finalizeAssistantMessage();
        }
        return;
      }
      const chunk = queue.splice(0, CHARS_PER_TICK).join("");
      setStreamingContent((prev) => (prev ?? "") + chunk);
    }, TICK_MS);
  }, [finalizeAssistantMessage]);

  const stopTypewriter = useCallback(() => {
    if (typewriterTimerRef.current) {
      clearInterval(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
    tokenQueueRef.current = [];
    streamDoneRef.current = false;
  }, []);

  // Auto-scroll to bottom on new messages / tool steps
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, toolSteps, streamingContent]);

  // Insert a divider when client selection changes
  useEffect(() => {
    if (prevClientRef.current !== clientId && messages.length > 0) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant" as const,
          content: `── Context switched to: ${clientLabel} ──`,
        },
      ]);
    }
    prevClientRef.current = clientId;
  }, [clientId, clientLabel, messages.length]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopTypewriter();
    };
  }, [stopTypewriter]);

  useEffect(() => {
    let active = true;

    async function loadMemoryStatus() {
      if (!clientId) {
        setMemoryStatus(null);
        return;
      }

      try {
        const memory = await fetchClientMemory(clientId);
        if (!active) return;
        setMemoryStatus(memory.exists ? `Memory ready (${memory.updated_at ? new Date(memory.updated_at).toLocaleString() : "saved"})` : "No memory yet");
      } catch {
        if (active) setMemoryStatus("Memory unavailable");
      }
    }

    loadMemoryStatus();
    return () => {
      active = false;
    };
  }, [clientId]);

  const handleCreateMemory = useCallback(async () => {
    if (!clientId || memoryBusy) return;

    try {
      setMemoryBusy(true);
      setError(null);
      const result = await createClientMemory(clientId);
      setMemoryStatus(`Memory ready (${result.generated_at ? new Date(result.generated_at).toLocaleString() : "saved"})`);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Created memory for **${clientLabel}**. I can now answer from the saved client context first instead of refetching insights, alerts, and news every time.`
        }
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create memory");
    } finally {
      setMemoryBusy(false);
    }
  }, [clientId, clientLabel, memoryBusy]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);
    setToolSteps([]);

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    // Build clean history for LLM
    const historyForLLM = [...messages, userMsg].filter(
      (m) => !m.content.startsWith("── Context switched")
    );

    abortRef.current = streamChatMessage(text, clientId, historyForLLM, {
      onToolCall(event) {
        suppressCurrentStreamRef.current = true;
        stopTypewriter();
        setStreamingContent(null);
        finalizedRef.current = true;

        setToolSteps((prev) => [
          ...prev,
          { name: event.name, summary: event.summary, status: "running" },
        ]);
      },

      onToolResult(event) {
        setToolSteps((prev) =>
          prev.map((s) =>
            s.name === event.name && s.status === "running"
              ? { ...s, status: "done" }
              : s
          )
        );
      },

      onStreamStart() {
        streamDoneRef.current = false;
        finalizedRef.current = false;
        finalizedContentRef.current = null;
        receivedTokensRef.current = false;
        suppressCurrentStreamRef.current = false;
        tokenQueueRef.current = [];
        setStreamingContent("");
        startTypewriter();
      },

      onToken(content) {
        // Push chars to the typewriter queue — it drains them smoothly
        receivedTokensRef.current = true;
        tokenQueueRef.current.push(...content.split(""));
      },

      onStreamEnd() {
        // If no tokens ever arrived (tool-call iteration), just clean up
        // without creating an empty message bubble.
        if (!receivedTokensRef.current) {
          stopTypewriter();
          setStreamingContent(null);
          finalizedRef.current = true;   // nothing to finalize
          return;
        }

        if (suppressCurrentStreamRef.current) {
          stopTypewriter();
          setStreamingContent(null);
          finalizedRef.current = true;
          return;
        }

        // Signal the typewriter to finalize after draining remaining chars
        streamDoneRef.current = true;
      },

      onResponse(content) {
        // Fallback for non-streaming responses
        if (receivedTokensRef.current || finalizedRef.current) {
          return;
        }

        suppressCurrentStreamRef.current = false;
        finalizeAssistantMessage(content);
      },

      onError(message) {
        setError(message);
      },

      onDone() {
        streamDoneRef.current = true;
        // Only finalize if typewriter hasn't already done it
        if (!finalizedRef.current && !typewriterTimerRef.current) {
          finalizeAssistantMessage();
        }
        setLoading(false);
        setToolSteps([]);
        inputRef.current?.focus();
      },
    });
  }, [input, loading, messages, clientId, finalizeAssistantMessage, startTypewriter, stopTypewriter]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Tool icon lookup ───────────────────────────────────────────────
  const toolIcon = (name: string): ReactNode => {
    const cls = "h-3 w-3";
    const map: Record<string, ReactNode> = {
      get_client_portfolio: <BarChart3 className={cls} />,
      get_client_insights: <Lightbulb className={cls} />,
      get_client_alerts: <Bell className={cls} />,
      get_all_clients_summary: <Users className={cls} />,
      get_recent_news: <Newspaper className={cls} />,
      run_stress_test: <FlaskConical className={cls} />,
      run_monte_carlo_simulation: <TrendingUp className={cls} />,
      compare_portfolio_change: <GitCompareArrows className={cls} />,
      generate_allocation_recommendation: <Lightbulb className={cls} />,
    };
    return map[name] || <Wrench className={cls} />;
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-semibold text-slate-800">AI Assistant</span>
        </div>
        <div className="flex items-center gap-2">
          {clientId && (
            <button
              onClick={handleCreateMemory}
              disabled={memoryBusy}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <DatabaseZap className="h-3 w-3" />
              {memoryBusy ? "Creating…" : "Create Memory"}
            </button>
          )}
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-semibold text-blue-600">
            {clientLabel}
          </span>
        </div>
      </div>

      {clientId && memoryStatus && (
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-[10px] text-slate-500">
          {memoryStatus}
        </div>
      )}

      {/* ── Messages ───────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
        style={{ minHeight: 0 }}
      >
        {messages.length === 0 && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageSquareText className="h-6 w-6 text-slate-300" />
            <p className="text-xs text-slate-400">
              Ask anything about{" "}
              <span className="font-medium text-slate-600">{clientLabel}</span>
            </p>
            <div className="mt-2 space-y-1">
              {(clientId
                ? [
                    "What are the biggest risks in this portfolio?",
                    "Suggest a safer allocation and simulate the result",
                    "Compare the current portfolio vs a more defensive version",
                  ]
                : [
                    "Which clients need a defensive rebalance right now?",
                    "Who has the weakest downside profile under stress tests?",
                    "Which clients are too concentrated in tech?",
                  ]
              ).map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                  className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-[11px] text-slate-500 transition hover:border-blue-300 hover:text-slate-700"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          // Divider messages
          if (m.content.startsWith("── Context switched")) {
            return (
              <div
                key={i}
                className="my-2 text-center text-[10px] text-slate-400"
              >
                {m.content}
              </div>
            );
          }

          return (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                  m.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {m.role === "user" ? (
                  <div className="whitespace-pre-wrap">{m.content}</div>
                ) : (
                  <div className="chat-prose">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* ── Tool steps (shown while agent is working) ────────────── */}
        {toolSteps.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Agent is working…
            </div>
            <div className="space-y-1">
              {toolSteps.map((step, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-[11px] text-slate-500"
                >
                  {step.status === "running" ? (
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border border-blue-600 border-t-transparent" />
                  ) : (
                    <Check className="h-3 w-3 text-emerald-500" />
                  )}
                  <span>{toolIcon(step.name)}</span>
                  <span>{step.summary}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Loading indicator (when waiting for LLM but no tool steps yet) */}
        {loading && toolSteps.length === 0 && streamingContent === null && (
          <div className="flex justify-start">
            <div className="rounded-xl bg-slate-100 px-4 py-3 text-xs text-slate-400">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">●</span>
                <span className="animate-bounce" style={{ animationDelay: "0.15s" }}>●</span>
                <span className="animate-bounce" style={{ animationDelay: "0.3s" }}>●</span>
              </span>
            </div>
          </div>
        )}

        {/* Live streaming response (token-by-token like ChatGPT) */}
        {streamingContent !== null && (
          <div className="flex justify-start">
            <div className="max-w-[90%] rounded-xl bg-slate-100 px-3.5 py-2.5 text-xs leading-relaxed text-slate-700">
              <div className="chat-prose">
                <ReactMarkdown>{streamingContent || "▍"}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}
      </div>

      {/* ── Input ──────────────────────────────────────────────────── */}
      <div className="border-t border-slate-200 px-3 py-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask about ${clientLabel}...`}
            disabled={loading}
            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-40"
          >
            <SendHorizonal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
