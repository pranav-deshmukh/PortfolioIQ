"use client";

import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { Alert, Client, Insight, PipelineRun } from "@/types";

/* ── Helpers ─────────────────────────────────────────────────────────── */

function fmt$(n: number) {
  if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toLocaleString();
}

function riskLevel(client: Client, alertsForClient: Alert[]): { score: string; level: "HIGH" | "MEDIUM" | "LOW"; color: string } {
  const critCount = alertsForClient.filter((a) => a.severity === "CRITICAL" && a.status === "active").length;
  const warnCount = alertsForClient.filter((a) => a.severity === "WARNING" && a.status === "active").length;
  const monCount = alertsForClient.filter((a) => a.severity === "MONITOR" && a.status === "active").length;

  if (critCount > 0) return { score: "Critical", level: "HIGH", color: "text-red-600" };
  if (warnCount > 0) return { score: "Elevated", level: "MEDIUM", color: "text-amber-600" };
  if (monCount > 0) return { score: "Monitor", level: "LOW", color: "text-blue-600" };
  return { score: "Stable", level: "LOW", color: "text-emerald-600" };
}

const LEVEL_BADGE: Record<string, string> = {
  HIGH: "bg-red-50 text-red-600",
  MEDIUM: "bg-amber-50 text-amber-600",
  LOW: "bg-emerald-50 text-emerald-600",
};

/* ── Component ───────────────────────────────────────────────────────── */

interface DashboardTabProps {
  alerts: Alert[];
  clients: Client[];
  insights: Insight[];
  runs: PipelineRun[];
}

export default function DashboardTab({ alerts, clients, insights, runs }: DashboardTabProps) {
  const activeAlerts = alerts.filter((a) => a.status === "active");
  const criticalAlerts = activeAlerts.filter((a) => a.severity === "CRITICAL");
  const warningAlerts = activeAlerts.filter((a) => a.severity === "WARNING");

  // Clients with CRITICAL or WARNING alerts = high risk
  const clientsWithHighRisk = new Set(
    activeAlerts
      .filter((a) => a.severity === "CRITICAL" || a.severity === "WARNING")
      .map((a) => a.client_id)
  );

  const totalAUM = clients.reduce((s, c) => s + c.portfolio_value, 0);
  const lastRun = runs[0] ?? null;

  // Build leaderboard rows
  const leaderboard = clients.map((c) => {
    const clientAlerts = alerts.filter((a) => a.client_id === c.client_id);
    const activeClientAlerts = clientAlerts.filter((a) => a.status === "active");
    const risk = riskLevel(c, clientAlerts);
    const latestInsight = insights.find((i) => i.client_id === c.client_id);
    return { ...c, risk, activeAlerts: activeClientAlerts.length, latestUrgency: latestInsight?.urgency ?? null };
  });

  // Sort: HIGH first, then MEDIUM, then LOW
  const ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  leaderboard.sort((a, b) => ORDER[a.risk.level] - ORDER[b.risk.level] || b.activeAlerts - a.activeAlerts);

  return (
    <div>
      {/* ── KPI Cards ────────────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {/* Active Alerts */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Active Alerts
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-red-600">
            {activeAlerts.length}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {criticalAlerts.length} critical · {warningAlerts.length} warning
          </div>
        </div>

        {/* High Risk Clients */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            High Risk Clients
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-amber-600">
            {clientsWithHighRisk.size}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            of {clients.length} total
          </div>
        </div>

        {/* Total AUM */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Total AUM
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-slate-800">
            {fmt$(totalAUM)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {clients.length} clients
          </div>
        </div>

        {/* Last Pipeline */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Last Pipeline
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight">
            {lastRun ? (
              <span className={lastRun.status === "completed" ? "text-emerald-600" : lastRun.status === "failed" ? "text-red-600" : "text-blue-600"}>
                {lastRun.status === "completed" ? <CheckCircle2 className="h-6 w-6" /> : lastRun.status === "failed" ? <XCircle className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}
              </span>
            ) : (
              <span className="text-slate-300">&mdash;</span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {lastRun
              ? `${lastRun.news_count} events · ${lastRun.duration_seconds?.toFixed(1) ?? "?"}s`
              : "No runs yet"}
          </div>
        </div>
      </div>

      {/* ── Client Risk Leaderboard ──────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Client Risk Leaderboard
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Client
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  AUM
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Risk Tolerance
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Active Alerts
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Urgency
                </th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row) => (
                <tr
                  key={row.client_id}
                  className="border-b border-slate-100 transition hover:bg-slate-50"
                >
                  {/* Client name */}
                  <td className="px-5 py-3.5">
                    <div className="text-sm font-medium text-slate-800">{row.name}</div>
                    <div className="text-[11px] text-slate-400">{row.client_id}</div>
                  </td>
                  {/* AUM */}
                  <td className="px-4 py-3.5 font-mono text-sm text-slate-600">
                    {fmt$(row.portfolio_value)}
                  </td>
                  {/* Risk tolerance */}
                  <td className="px-4 py-3.5">
                    <span className="text-xs capitalize text-slate-500">{row.risk_tolerance}</span>
                  </td>
                  {/* Risk status badge */}
                  <td className="px-4 py-3.5">
                    <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${LEVEL_BADGE[row.risk.level]}`}>
                      {row.risk.score}
                    </span>
                  </td>
                  {/* Alert count */}
                  <td className="px-4 py-3.5">
                    {row.activeAlerts > 0 ? (
                      <span className="font-mono text-sm font-semibold text-red-600">{row.activeAlerts}</span>
                    ) : (
                      <span className="text-sm text-slate-300">0</span>
                    )}
                  </td>
                  {/* Latest urgency */}
                  <td className="px-4 py-3.5">
                    {row.latestUrgency ? (
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          row.latestUrgency === "high"
                            ? "bg-red-50 text-red-600"
                            : row.latestUrgency === "medium"
                              ? "bg-amber-50 text-amber-600"
                              : "bg-emerald-50 text-emerald-600"
                        }`}
                      >
                        {row.latestUrgency}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {leaderboard.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-400">
                    No client data yet. Run the pipeline to populate.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
