"use client";

import { ArrowRight, TrendingDown, ShieldAlert, Lightbulb, MessageCircle, User, Clock } from "lucide-react";
import type { Insight, Client } from "@/types";
import EmptyState from "./EmptyState";
import ChatPanel from "./ChatPanel";

/* ── Urgency config ──────────────────────────────────────────────── */

const URGENCY_CONFIG: Record<string, { badge: string; accent: string; dot: string }> = {
  high:   { badge: "bg-red-50 text-red-600 ring-1 ring-red-200",      accent: "border-red-400",    dot: "bg-red-500" },
  medium: { badge: "bg-amber-50 text-amber-600 ring-1 ring-amber-200", accent: "border-amber-400",  dot: "bg-amber-500" },
  low:    { badge: "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200", accent: "border-emerald-400", dot: "bg-emerald-500" },
};

interface InsightsTabProps {
  insights: Insight[];
  clients: Client[];
  selectedClient: string | null;
  onSelectClient: (id: string | null) => void;
}

export default function InsightsTab({
  insights,
  clients,
  selectedClient,
  onSelectClient,
}: InsightsTabProps) {
  const clientLabel = selectedClient
    ? clients.find((c) => c.client_id === selectedClient)?.name ?? selectedClient
    : "All Clients";

  // Map client_id → name for display
  const clientName = (id: string) =>
    clients.find((c) => c.client_id === id)?.name ?? id;

  return (
    <>
      {/* Client filter chips */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <button
          onClick={() => onSelectClient(null)}
          className={`rounded-full border px-3.5 py-1 text-[11px] font-medium transition ${
            !selectedClient
              ? "border-blue-600 bg-blue-600 text-white shadow-sm"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
          }`}
        >
          All Clients
        </button>
        {clients.map((c) => {
          const parts = c.name.split(" ");
          const label = `${parts[0]} ${parts[parts.length - 1]}`;
          return (
            <button
              key={c.client_id}
              onClick={() => onSelectClient(c.client_id)}
              className={`rounded-full border px-3.5 py-1 text-[11px] font-medium transition ${
                selectedClient === c.client_id
                  ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── 65 / 35 Split ────────────────────────────────────────── */}
      <div className="flex gap-5" style={{ height: "calc(100vh - 200px)" }}>
        {/* Left: Insights (65%) */}
        <div className="w-[65%] overflow-y-auto pr-2">
          {insights.length === 0 ? (
            <EmptyState message="No insights yet. Run the pipeline to generate insights." />
          ) : (
            <div className="space-y-5">
              {insights.map((ins) => {
                const points = Array.isArray(ins.talking_points)
                  ? ins.talking_points
                  : ins.talking_points
                    ? [ins.talking_points]
                    : [];

                const urgency = URGENCY_CONFIG[ins.urgency] ?? URGENCY_CONFIG.low;

                return (
                  <article
                    key={ins._id}
                    className={`rounded-sm border-l-[3px] bg-white shadow-sm ring-1 ring-slate-200/80 ${urgency.accent}`}
                  >
                    {/* ── Card header ─────────────────────────────── */}
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50">
                          <User className="h-3.5 w-3.5 text-blue-600" />
                        </div>
                        <div>
                          <span className="text-[13px] font-semibold text-slate-800">
                            {clientName(ins.client_id)}
                          </span>
                          <span className="ml-2 text-[11px] text-slate-400">{ins.client_id}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase ${urgency.badge}`}
                        >
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${urgency.dot}`} />
                          {ins.urgency}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                          <Clock className="h-3 w-3" />
                          {new Date(ins.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>

                    {/* ── Summary (headline) ──────────────────────── */}
                    <div className="px-5 pt-4 pb-1">
                      <h3 className="text-[15px] font-semibold leading-snug text-slate-900">
                        {ins.summary}
                      </h3>
                    </div>

                    {/* ── Body sections ────────────────────────────── */}
                    <div className="space-y-3 px-5 pb-4 pt-2">
                      {/* Impact */}
                      <div className="flex gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-red-50 mt-0.5">
                          <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            Impact Analysis
                          </p>
                          <p className="mt-0.5 text-[13px] leading-relaxed text-slate-600">
                            {ins.impact_analysis}
                          </p>
                        </div>
                      </div>

                      {/* Risk */}
                      <div className="flex gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-50 mt-0.5">
                          <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            Risk Assessment
                          </p>
                          <p className="mt-0.5 text-[13px] leading-relaxed text-slate-600">
                            {ins.risk_assessment}
                          </p>
                        </div>
                      </div>

                      {/* Recommendations */}
                      <div className="flex gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-50 mt-0.5">
                          <Lightbulb className="h-3.5 w-3.5 text-blue-500" />
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            Recommendations
                          </p>
                          <p className="mt-0.5 text-[13px] leading-relaxed text-slate-600">
                            {ins.recommendations}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* ── Talking points ───────────────────────────── */}
                    {points.length > 0 && (
                      <div className="border-t border-slate-100 px-5 py-3.5">
                        <div className="flex items-center gap-1.5 mb-2">
                          <MessageCircle className="h-3.5 w-3.5 text-blue-500" />
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            Advisor Talking Points
                          </p>
                        </div>
                        <ul className="space-y-1.5">
                          {points.map((tp, i) => (
                            <li
                              key={i}
                              className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[13px] leading-relaxed text-slate-600"
                            >
                              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                              <span>{tp}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: AI Chat (35%) */}
        <div className="w-[35%]">
          <ChatPanel clientId={selectedClient} clientLabel={clientLabel} />
        </div>
      </div>
    </>
  );
}
