"use client";

import type { ReactNode } from "react";
import type { TabId } from "@/types";
import { LayoutDashboard, Bell, BarChart3, Settings } from "lucide-react";

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
  { id: "alerts", label: "Alerts", icon: <Bell className="h-3.5 w-3.5" /> },
  { id: "insights", label: "Client Insights", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: "runs", label: "Pipeline Runs", icon: <Settings className="h-3.5 w-3.5" /> },
];

interface TabBarProps {
  active: TabId;
  onChange: (tab: TabId) => void;
}

export default function TabBar({ active, onChange }: TabBarProps) {
  return (
    <div className="flex gap-1 border-b border-slate-200 bg-white px-5 pt-3 pb-0">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-medium transition-all ${
            active === tab.id
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          }`}
        >
          {tab.icon} {tab.label}
        </button>
      ))}
    </div>
  );
}
