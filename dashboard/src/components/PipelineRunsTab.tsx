"use client";

import type { PipelineRun } from "@/types";
import EmptyState from "./EmptyState";

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-emerald-50 text-emerald-600",
  failed: "bg-red-50 text-red-600",
  running: "bg-blue-50 text-blue-600",
};

interface PipelineRunsTabProps {
  runs: PipelineRun[];
}

export default function PipelineRunsTab({ runs }: PipelineRunsTabProps) {
  if (runs.length === 0) {
    return <EmptyState message="No pipeline runs yet." />;
  }

  return (
    <div className="space-y-3">
      {runs.map((r) => (
        <div
          key={r._id}
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        >
          {/* Run header row */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLE[r.status] ?? ""}`}
              >
                {r.status}
              </span>
              <span className="text-slate-500">
                {r.news_count || 0} events
              </span>
            </div>
            <span className="text-[11px] text-slate-400">
              {new Date(r.started_at).toLocaleString()}
              {r.duration_seconds != null && ` · ${r.duration_seconds.toFixed(1)}s`}
            </span>
          </div>

          {/* Agent summary (truncated) */}
          {r.agent_summary && (
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-500">
              {r.agent_summary.length > 500
                ? r.agent_summary.substring(0, 500) + "..."
                : r.agent_summary}
            </p>
          )}

          {/* Error message */}
          {r.error && (
            <p className="mt-2 text-xs text-red-500">{r.error}</p>
          )}
        </div>
      ))}
    </div>
  );
}
