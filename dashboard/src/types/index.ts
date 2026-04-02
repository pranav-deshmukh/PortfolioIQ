// ── TypeScript types for the LPL Advisor Dashboard ──────────────────

export interface Alert {
  _id: string;
  client_id: string;
  severity: "CRITICAL" | "WARNING" | "MONITOR";
  title: string;
  description: string;
  suggested_action?: string;
  related_event?: string;
  status: "active" | "dismissed";
  created_at: string;
}

export interface Insight {
  _id: string;
  client_id: string;
  summary: string;
  impact_analysis: string;
  risk_assessment: string;
  recommendations: string;
  talking_points: string[] | string;
  urgency: "high" | "medium" | "low";
  created_at: string;
}

export interface PipelineRun {
  _id: string;
  started_at: string;
  completed_at?: string;
  status: "running" | "completed" | "failed";
  news_count: number;
  alerts_created: number;
  insights_created: number;
  agent_summary?: string;
  agent_iterations?: number;
  duration_seconds?: number;
  error?: string;
}

export interface Client {
  client_id: string;
  name: string;
  portfolio_value: number;
  risk_tolerance: string;
}

export type TabId = "dashboard" | "alerts" | "insights" | "runs";
