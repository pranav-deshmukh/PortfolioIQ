"use client";

import type { ReactNode } from "react";
import type { TabId } from "@/types";
import { Zap, Loader2, Play, LayoutDashboard, Bell, BarChart3, Settings } from "lucide-react";

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
  { id: "alerts", label: "Alerts", icon: <Bell className="h-3.5 w-3.5" /> },
  { id: "insights", label: "Client Insights", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: "runs", label: "Pipeline Runs", icon: <Settings className="h-3.5 w-3.5" /> },
];

interface TopBarProps {
  status: string;
  running: boolean;
  onRun: () => void;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export default function TopBar({ status, running, onRun, activeTab, onTabChange }: TopBarProps) {
  return (
    <div className="sticky top-0 z-50 bg-blue-600 shadow-sm">
      <div className="flex items-center justify-between px-6 py-2">
        {/* Left: logo + tabs */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20">
              <Zap className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-[14px] font-semibold tracking-tight text-white">
              PortfolioIQ
            </span>
          </div>

          {/* Tabs */}
          <nav className="flex items-center gap-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all ${
                  activeTab === tab.id
                    ? "bg-white/20 text-white"
                    : "text-blue-200 hover:bg-white/10 hover:text-white"
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right: status + run button */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_6px] shadow-emerald-300 animate-pulse-dot" />
            <span className="text-[11px] text-blue-100">{status}</span>
          </div>

          <button
            onClick={onRun}
            disabled={running}
            className="rounded-md bg-white px-3.5 py-1.5 text-[11px] font-medium text-blue-600 shadow-sm transition-all hover:bg-blue-50 disabled:cursor-wait disabled:opacity-50"
          >
            {running ? (
              <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Running...</span>
            ) : (
              <span className="inline-flex items-center gap-1.5"><Play className="h-3 w-3" /> Run Pipeline</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
