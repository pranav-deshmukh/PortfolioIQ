"use client";

import { ArrowRight, Newspaper } from "lucide-react";
import type { Alert } from "@/types";
import EmptyState from "./EmptyState";

/* ── Severity → style maps ───────────────────────────────────────── */

const BORDER_COLOR: Record<string, string> = {
  CRITICAL: "border-l-red-500",
  WARNING: "border-l-amber-500",
  MONITOR: "border-l-blue-500",
};

const BADGE_STYLE: Record<string, string> = {
  CRITICAL: "bg-red-50 text-red-600",
  WARNING: "bg-amber-50 text-amber-600",
  MONITOR: "bg-blue-50 text-blue-600",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-amber-50 text-amber-600",
  dismissed: "bg-emerald-50 text-emerald-600",
};

interface AlertsTabProps {
  alerts: Alert[];
  onDismiss: (id: string) => void;
}

export default function AlertsTab({ alerts, onDismiss }: AlertsTabProps) {
  if (alerts.length === 0) {
    return <EmptyState message="No alerts yet. Run the pipeline to generate alerts." />;
  }

  return (
    <div className="space-y-3">
      {alerts.map((a) => (
        <div
          key={a._id}
          className={`rounded-lg border border-slate-200 border-l-4 bg-white p-4 shadow-sm ${BORDER_COLOR[a.severity] ?? ""}`}
        >
          {/* Header row */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${BADGE_STYLE[a.severity] ?? ""}`}
              >
                {a.severity}
              </span>
              <span className="text-[11px] text-slate-500">{a.client_id}</span>
            </div>
            <span className="text-[10px] text-slate-400">
              {new Date(a.created_at).toLocaleString()}
            </span>
          </div>

          {/* Title + description */}
          <h3 className="mt-2 text-sm font-semibold text-slate-800">{a.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {a.description}
          </p>

          {/* Suggested action */}
          {a.suggested_action && (
            <p className="mt-2 flex items-center gap-1.5 text-xs italic text-amber-600">
              <ArrowRight className="h-3 w-3 shrink-0" /> {a.suggested_action}
            </p>
          )}

          {/* Related event */}
          {a.related_event && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
              <Newspaper className="h-3 w-3 shrink-0" /> {a.related_event}
            </div>
          )}

          {/* Status + dismiss */}
          <div className="mt-3 flex items-center gap-2">
            <span
              className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_BADGE[a.status] ?? ""}`}
            >
              {a.status}
            </span>
            {a.status === "active" && (
              <button
                onClick={() => onDismiss(a._id)}
                className="rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
