"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { TabId, Alert, Insight, PipelineRun, Client } from "@/types";
import {
  fetchAlerts,
  fetchInsights,
  fetchClients,
  fetchPipelineRuns,
  triggerPipeline as apiTriggerPipeline,
  dismissAlert as apiDismissAlert,
} from "@/lib/api";

import TopBar from "@/components/TopBar";
import DashboardTab from "@/components/DashboardTab";
import AlertsTab from "@/components/AlertsTab";
import InsightsTab from "@/components/InsightsTab";
import PipelineRunsTab from "@/components/PipelineRunsTab";

/* ── Refresh interval (ms) ─────────────────────────────────────────── */
const AUTO_REFRESH = 30_000;
const POLL_INTERVAL = 2_000;
const MAX_POLL_ATTEMPTS = 60;

export default function DashboardPage() {
  /* ── State ─────────────────────────────────────────────────────────── */
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [statusText, setStatusText] = useState("Ready");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Data loaders ──────────────────────────────────────────────────── */
  const loadAlerts = useCallback(async () => {
    try {
      setAlerts(await fetchAlerts());
    } catch {
      /* silent — backend might be down */
    }
  }, []);

  const loadInsights = useCallback(async () => {
    try {
      const [ins, cls] = await Promise.all([
        fetchInsights(selectedClient),
        fetchClients(),
      ]);
      setInsights(ins);
      setClients(cls);
    } catch {
      /* silent */
    }
  }, [selectedClient]);

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await fetchPipelineRuns());
    } catch {
      /* silent */
    }
  }, []);

  const loadAll = useCallback(() => {
    loadAlerts();
    loadInsights();
    loadRuns();
  }, [loadAlerts, loadInsights, loadRuns]);

  /* ── Auto refresh ──────────────────────────────────────────────────── */
  useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, AUTO_REFRESH);
    return () => clearInterval(id);
  }, [loadAll]);

  /* ── Reload tab data when switching or client filter changes ──────── */
  useEffect(() => {
    if (activeTab === "dashboard") loadAll();
    else if (activeTab === "alerts") loadAlerts();
    else if (activeTab === "insights") loadInsights();
    else if (activeTab === "runs") loadRuns();
  }, [activeTab, loadAll, loadAlerts, loadInsights, loadRuns]);

  /* re-fetch insights when client filter changes */
  useEffect(() => {
    loadInsights();
  }, [selectedClient, loadInsights]);

  /* ── Pipeline trigger + polling ────────────────────────────────────── */
  const handleRunPipeline = async () => {
    setPipelineRunning(true);
    setStatusText("Pipeline running...");

    try {
      await apiTriggerPipeline(3);
      setStatusText("Pipeline started! Waiting for results...");

      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > MAX_POLL_ATTEMPTS) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setStatusText("Pipeline taking long — check console");
          setPipelineRunning(false);
          return;
        }
        try {
          const latestRuns = await fetchPipelineRuns();
          if (latestRuns[0] && latestRuns[0].status !== "running") {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            const r = latestRuns[0];
            setStatusText(
              `Pipeline ${r.status} (${r.duration_seconds?.toFixed(1) ?? "?"}s)`
            );
            setPipelineRunning(false);
            loadAll();
          }
        } catch {
          /* keep polling */
        }
      }, POLL_INTERVAL);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setStatusText(`Error: ${msg}`);
      setPipelineRunning(false);
    }
  };

  /* cleanup polling on unmount */
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  /* ── Dismiss alert ─────────────────────────────────────────────────── */
  const handleDismiss = async (id: string) => {
    await apiDismissAlert(id);
    loadAlerts();
  };

  /* ── Render ────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar
        status={statusText}
        running={pipelineRunning}
        onRun={handleRunPipeline}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <main className="px-6 pb-8">
        {/* Section title */}
        <h2 className="mb-4 mt-5 pb-2 text-lg font-semibold text-slate-800">
          {activeTab === "dashboard" && "Portfolio Overview"}
          {activeTab === "alerts" && "Active Alerts"}
          {activeTab === "insights" && "Client Insights"}
          {activeTab === "runs" && "Pipeline Run History"}
        </h2>

        {/* Tab content */}
        {activeTab === "dashboard" && (
          <DashboardTab
            alerts={alerts}
            clients={clients}
            insights={insights}
            runs={runs}
          />
        )}

        {activeTab === "alerts" && (
          <AlertsTab alerts={alerts} onDismiss={handleDismiss} />
        )}

        {activeTab === "insights" && (
          <InsightsTab
            insights={insights}
            clients={clients}
            selectedClient={selectedClient}
            onSelectClient={setSelectedClient}
          />
        )}

        {activeTab === "runs" && <PipelineRunsTab runs={runs} />}
      </main>
    </div>
  );
}
