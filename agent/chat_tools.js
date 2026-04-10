// ── Chat Tools ────────────────────────────────────────────────────────
// Tools the chat agent can call on-demand. Each tool fetches only the
// data the LLM needs — no upfront context stuffing.

import { getLatestInsights, getActiveAlerts, getDB } from "./db.js";
import { CLIENTS, TICKERS, RISK_THRESHOLDS } from "./data/sample_data.js";
import {
  computeVaR,
  runStressTest,
  runStressTestSuite,
  runMonteCarloSimulation,
  comparePortfolioChange,
  generateAllocationRecommendation
} from "./analytics_engine.js";


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
  },
  {
    type: "function",
    function: {
      name: "run_monte_carlo_simulation",
      description: "Run a Monte Carlo simulation on a client's current portfolio. Use when the advisor asks about future outcomes, upside/downside ranges, probability of gain, or projected portfolio value.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client ID to simulate" },
          years: { type: "number", description: "Projection horizon in years (default 3)" },
          paths: { type: "number", description: "Number of Monte Carlo paths (default 1000)" }
        },
        required: ["client_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "compare_portfolio_change",
      description: "Compare a client's current portfolio against a proposed allocation. Use when the advisor suggests changes or asks 'what if I move X% into bonds/healthcare/cash?'. Provide `proposed_holdings` as a ticker-to-weight map; weights can be decimals or percentages and will be normalized automatically.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client ID to compare" },
          proposed_holdings: {
            type: "object",
            description: "Ticker to target weight map. Example: {\"MSFT\": 0.08, \"AAPL\": 0.06, \"AGG\": 0.25, \"BND\": 0.10, \"CASH\": 0.08}",
            additionalProperties: { type: "number" }
          },
          years: { type: "number", description: "Monte Carlo horizon in years (default 3)" },
          paths: { type: "number", description: "Monte Carlo path count (default 1000)" }
        },
        required: ["client_id", "proposed_holdings"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_allocation_recommendation",
      description: "Generate an advisor-ready recommended allocation for a client and immediately simulate the before/after impact. Use when the advisor asks for a safer allocation, a balanced rebalance, or a growth-oriented proposal.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client ID for the recommendation" },
          objective: {
            type: "string",
            enum: ["auto", "defensive", "balanced", "growth"],
            description: "Recommendation objective. Use auto to infer from the client's risk profile."
          }
        },
        required: ["client_id"]
      }
    }
  }
];


// ══════════════════════════════════════════════════════════════════════
// TOOL IMPLEMENTATIONS
// ══════════════════════════════════════════════════════════════════════

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

    const varMetrics = await computeVaR(client);

    return {
      client_id: client.client_id, name: client.name, age: client.age,
      portfolio_value: client.portfolio_value,
      risk_tolerance: client.risk_tolerance,
      time_horizon_years: client.time_horizon_years,
      threshold_pct: (RISK_THRESHOLDS[client.risk_tolerance] * 100).toFixed(1),
      holdings, sector_breakdown: sectors,
      risk_metrics: {
        var_95: varMetrics.var_95,
        var_99: varMetrics.var_99,
        cvar_95: varMetrics.cvar_95,
        volatility_pct: varMetrics.volatility_pct,
        beta: varMetrics.beta,
        max_drawdown_pct: varMetrics.max_drawdown_pct,
        risk_level: varMetrics.risk_level,
        risk_drivers: varMetrics.risk_drivers,
        hhi: varMetrics.hhi,
        effective_assets: varMetrics.effective_assets,
        top_3_concentration_pct: varMetrics.top_3_concentration_pct,
        sector_exposure: varMetrics.sector_exposure
      }
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
      return runStressTestSuite(client);
    }
    return runStressTest(client, args.scenario);
  },

  async run_monte_carlo_simulation(args) {
    const client = CLIENTS.find(c => c.client_id === args.client_id);
    if (!client) return { error: `Client ${args.client_id} not found` };

    return runMonteCarloSimulation(client, {
      years: args.years,
      paths: args.paths
    });
  },

  async compare_portfolio_change(args) {
    const client = CLIENTS.find(c => c.client_id === args.client_id);
    if (!client) return { error: `Client ${args.client_id} not found` };
    if (!args.proposed_holdings || typeof args.proposed_holdings !== "object") {
      return { error: "proposed_holdings is required" };
    }

    return comparePortfolioChange(client, args.proposed_holdings, {
      years: args.years,
      paths: args.paths,
      label: "Advisor proposal"
    });
  },

  async generate_allocation_recommendation(args) {
    const client = CLIENTS.find(c => c.client_id === args.client_id);
    if (!client) return { error: `Client ${args.client_id} not found` };

    return generateAllocationRecommendation(client, args.objective || "auto");
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
    case "run_monte_carlo_simulation":
      return `Running Monte Carlo simulation for ${clientName}`;
    case "compare_portfolio_change":
      return `Comparing current vs proposed allocation for ${clientName}`;
    case "generate_allocation_recommendation":
      return `Generating simulated rebalance recommendation for ${clientName}`;
    default:
      return `Calling ${toolName}`;
  }
}
