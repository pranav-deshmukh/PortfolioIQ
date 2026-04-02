// ── Chat Tools ────────────────────────────────────────────────────────
// Tools the chat agent can call on-demand. Each tool fetches only the
// data the LLM needs — no upfront context stuffing.

import { getLatestInsights, getActiveAlerts, getDB } from "./db.js";
import { CLIENTS, TICKERS, RISK_THRESHOLDS } from "./data/sample_data.js";
import { computeVaR } from "./analytics_engine.js";


// ══════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS (OpenAI function-calling format)
// ══════════════════════════════════════════════════════════════════════

export const CHAT_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "get_client_portfolio",
      description: "Get a client's full portfolio: holdings, sector breakdown, risk metrics (VaR), and basic profile (age, risk tolerance, time horizon). Use when the advisor asks about a specific client's exposure, holdings, or risk posture.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client ID, e.g. C001, C002, C003, C004, C005" }
        },
        required: ["client_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_client_insights",
      description: "Get the latest AI-generated insights for a client from the most recent pipeline run. Includes impact analysis, risk assessment, recommendations, and talking points. Use when the advisor asks what happened to a client or wants a briefing.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client ID, e.g. C001. Pass null or omit to get insights for all clients." },
          limit: { type: "number", description: "Number of insights to return (default 3)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_client_alerts",
      description: "Get active alerts for a client (or all clients). Alerts include severity (CRITICAL/WARNING/MONITOR), description, and suggested actions. Use when the advisor asks about risks, warnings, or what needs attention.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client ID. Omit to get alerts for all clients." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_all_clients_summary",
      description: "Get a quick overview of ALL clients: names, portfolio values, risk tolerances, top sector exposures. Use when the advisor asks a question about multiple clients or wants to compare them.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_recent_news",
      description: "Get recent news events that were ingested by the pipeline. Returns headlines, categories, keywords, and sentiment. Use when the advisor asks about recent market events or what news came in.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of events to return (default 10)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_stress_test",
      description: "Run a stress test scenario on a specific client's portfolio. Scenarios: '2008_crisis', 'covid_crash', '2022_rate_shock', 'oil_spike', 'tech_selloff'. Returns the portfolio impact in dollars and percentage.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client ID to stress test" },
          scenario: {
            type: "string",
            enum: ["2008_crisis", "covid_crash", "2022_rate_shock", "oil_spike", "tech_selloff", "all"],
            description: "Which scenario to run. Use 'all' to run all 5 scenarios."
          }
        },
        required: ["client_id", "scenario"]
      }
    }
  }
];


// ══════════════════════════════════════════════════════════════════════
// TOOL IMPLEMENTATIONS
// ══════════════════════════════════════════════════════════════════════

const STRESS_SCENARIOS = {
  "2008_crisis": {
    name: "2008 Financial Crisis", desc: "Lehman collapse, S&P -57%",
    shocks: { tech: -0.52, financials: -0.68, energy: -0.45, healthcare: -0.22, bonds: 0.08, commodities: 0.05, international: -0.55, cash: 0.0 }
  },
  "covid_crash": {
    name: "2020 COVID Crash", desc: "Fastest bear market, -34%",
    shocks: { tech: -0.22, financials: -0.40, energy: -0.52, healthcare: -0.18, bonds: 0.06, commodities: -0.35, international: -0.32, cash: 0.0 }
  },
  "2022_rate_shock": {
    name: "2022 Rate Shock", desc: "Fed hikes 425bp, worst bond year",
    shocks: { tech: -0.38, financials: -0.15, energy: 0.58, healthcare: -0.05, bonds: -0.16, commodities: 0.22, international: -0.20, cash: 0.02 }
  },
  "oil_spike": {
    name: "Oil Spike +30%", desc: "OPEC+ surprise cut + supply shock",
    shocks: { tech: -0.06, financials: -0.04, energy: 0.22, healthcare: 0.0, bonds: -0.03, commodities: 0.18, international: -0.04, cash: 0.0 }
  },
  "tech_selloff": {
    name: "Tech Selloff -25%", desc: "AI bubble deflation / antitrust",
    shocks: { tech: -0.25, financials: -0.05, energy: 0.02, healthcare: 0.03, bonds: 0.04, commodities: 0.0, international: -0.08, cash: 0.0 }
  }
};

function runStressOnClient(client, scenarioKey) {
  const sc = STRESS_SCENARIOS[scenarioKey];
  if (!sc) return { error: `Unknown scenario: ${scenarioKey}` };

  let impact = 0;
  const holdingImpacts = [];
  for (const [ticker, weight] of Object.entries(client.holdings)) {
    const sector = TICKERS[ticker]?.sector ?? "cash";
    const shock = sc.shocks[sector] ?? 0;
    const hi = weight * shock;
    impact += hi;
    if (Math.abs(shock) > 0.01) {
      holdingImpacts.push({
        ticker, sector, weight_pct: (weight * 100).toFixed(1),
        shock_pct: (shock * 100).toFixed(1),
        impact_pct: (hi * 100).toFixed(2),
        impact_dollar: Math.round(hi * client.portfolio_value)
      });
    }
  }
  holdingImpacts.sort((a, b) => Math.abs(parseFloat(b.impact_pct)) - Math.abs(parseFloat(a.impact_pct)));

  return {
    scenario: sc.name, description: sc.desc,
    total_impact_pct: (impact * 100).toFixed(2),
    total_impact_dollar: Math.round(impact * client.portfolio_value),
    severity: impact < -0.25 ? "SEVERE" : impact < -0.10 ? "HIGH" : impact < -0.05 ? "MEDIUM" : "LOW",
    holding_impacts: holdingImpacts.slice(0, 5)
  };
}


const chatToolImplementations = {

  async get_client_portfolio(args) {
    const client = CLIENTS.find(c => c.client_id === args.client_id);
    if (!client) return { error: `Client ${args.client_id} not found` };

    const holdings = Object.entries(client.holdings).map(([ticker, weight]) => ({
      ticker,
      name: TICKERS[ticker]?.name || ticker,
      sector: TICKERS[ticker]?.sector || "unknown",
      weight_pct: parseFloat((weight * 100).toFixed(1)),
      value: Math.round(weight * client.portfolio_value),
      beta: TICKERS[ticker]?.beta || 0
    }));

    const sectors = {};
    for (const h of holdings) sectors[h.sector] = (sectors[h.sector] || 0) + h.weight_pct;

    const varMetrics = computeVaR(client);

    return {
      client_id: client.client_id, name: client.name, age: client.age,
      portfolio_value: client.portfolio_value,
      risk_tolerance: client.risk_tolerance,
      time_horizon_years: client.time_horizon_years,
      threshold_pct: (RISK_THRESHOLDS[client.risk_tolerance] * 100).toFixed(1),
      holdings, sector_breakdown: sectors, var_metrics: varMetrics
    };
  },

  async get_client_insights(args) {
    const limit = args.limit || 3;
    const insights = await getLatestInsights(args.client_id || null, limit);
    if (insights.length === 0) return { message: "No insights found. Run the pipeline first." };
    return insights.map(i => ({
      client_id: i.client_id, urgency: i.urgency,
      summary: i.summary, impact_analysis: i.impact_analysis,
      risk_assessment: i.risk_assessment, recommendations: i.recommendations,
      talking_points: i.talking_points,
      created_at: i.created_at
    }));
  },

  async get_client_alerts(args) {
    const alerts = await getActiveAlerts(args.client_id || null);
    if (alerts.length === 0) return { message: "No active alerts." };
    return alerts.map(a => ({
      client_id: a.client_id, severity: a.severity,
      title: a.title, description: a.description,
      suggested_action: a.suggested_action,
      related_event: a.related_event,
      created_at: a.created_at
    }));
  },

  async get_all_clients_summary() {
    return CLIENTS.map(client => {
      const sectors = {};
      for (const [ticker, weight] of Object.entries(client.holdings)) {
        const sec = TICKERS[ticker]?.sector || "other";
        sectors[sec] = (sectors[sec] || 0) + parseFloat((weight * 100).toFixed(1));
      }
      const topSectors = Object.entries(sectors)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s, p]) => `${s}: ${p.toFixed(0)}%`);

      return {
        client_id: client.client_id, name: client.name, age: client.age,
        portfolio_value: client.portfolio_value,
        risk_tolerance: client.risk_tolerance,
        time_horizon_years: client.time_horizon_years,
        top_sectors: topSectors.join(", ")
      };
    });
  },

  async get_recent_news(args) {
    const limit = args.limit || 10;
    const db = await getDB();
    const events = await db.collection("news_events").find({}).sort({ timestamp: -1 }).limit(limit).toArray();
    if (events.length === 0) return { message: "No news events found. Run the pipeline first." };
    return events.map(e => ({
      headline: e.headline, category: e.category,
      keywords: e.keywords, sentiment_hint: e.raw_sentiment_hint,
      source: e.source, timestamp: e.timestamp
    }));
  },

  async run_stress_test(args) {
    const client = CLIENTS.find(c => c.client_id === args.client_id);
    if (!client) return { error: `Client ${args.client_id} not found` };

    if (args.scenario === "all") {
      return Object.keys(STRESS_SCENARIOS).map(key => runStressOnClient(client, key));
    }
    return runStressOnClient(client, args.scenario);
  }
};


/**
 * Execute a chat tool by name
 */
export async function executeChatTool(toolName, args) {
  const impl = chatToolImplementations[toolName];
  if (!impl) return { error: `Unknown tool: ${toolName}` };
  try {
    return await impl(args);
  } catch (err) {
    console.error(`[ChatTools] Error in ${toolName}:`, err.message);
    return { error: err.message };
  }
}

/**
 * Get a short human-readable summary of a tool call for the UI
 */
export function toolCallSummary(toolName, args) {
  const clientName = args.client_id
    ? CLIENTS.find(c => c.client_id === args.client_id)?.name || args.client_id
    : null;

  switch (toolName) {
    case "get_client_portfolio":
      return `Fetching portfolio for ${clientName}`;
    case "get_client_insights":
      return clientName ? `Loading insights for ${clientName}` : "Loading all client insights";
    case "get_client_alerts":
      return clientName ? `Checking alerts for ${clientName}` : "Checking all active alerts";
    case "get_all_clients_summary":
      return "Loading all clients overview";
    case "get_recent_news":
      return "Fetching recent news events";
    case "run_stress_test":
      const scenarioLabel = args.scenario === "all" ? "all scenarios" : args.scenario?.replace(/_/g, " ");
      return `Running stress test: ${scenarioLabel} on ${clientName}`;
    default:
      return `Calling ${toolName}`;
  }
}
