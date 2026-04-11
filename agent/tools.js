// ── Agent Tools ───────────────────────────────────────────────────────
// These are the tools the AI agent can call via function calling.
// Each tool has a definition (for the LLM) and an implementation.

import { saveInsight, saveAlert, getClients } from "./db.js";
import { TICKERS } from "./data/sample_data.js";
import { computeVaR } from "./analytics_engine.js";

// ══════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS (OpenAI-compatible function calling format)
// ══════════════════════════════════════════════════════════════════════

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "create_alert",
      description: "Create an alert for a specific client when a risk threshold is breached or important action is needed. Use this when metrics show significant portfolio impact that the advisor needs to know about.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client ID (e.g. C001)" },
          severity: { type: "string", enum: ["CRITICAL", "WARNING", "MONITOR"], description: "Alert severity level" },
          title: { type: "string", description: "Short alert title (< 80 chars)" },
          description: { type: "string", description: "Detailed alert description with specific numbers and reasoning" },
          suggested_action: { type: "string", description: "What the advisor should consider doing" },
          related_event: { type: "string", description: "The news headline that triggered this alert" }
        },
        required: ["client_id", "severity", "title", "description", "suggested_action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "save_client_insight",
      description: "Save a comprehensive insight report for a specific client. This should include analysis of how current events affect this client's portfolio, risk assessment, and recommendations.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client ID (e.g. C001)" },
          summary: { type: "string", description: "2-3 sentence executive summary of the insight" },
          impact_analysis: { type: "string", description: "Detailed analysis of how current events affect this client's portfolio" },
          risk_assessment: { type: "string", description: "Current risk posture and whether it aligns with client's risk tolerance" },
          recommendations: { type: "string", description: "Specific recommendations for the advisor to discuss with the client" },
          talking_points: {
            type: "array",
            items: { type: "string" },
            description: "3-5 bullet points the advisor can use when talking to this client"
          },
          urgency: { type: "string", enum: ["high", "medium", "low"], description: "How urgently the advisor should act" }
        },
        required: ["client_id", "summary", "impact_analysis", "risk_assessment", "recommendations", "talking_points", "urgency"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_client_portfolio",
      description: "Retrieve a client's current portfolio holdings, allocation percentages, and basic risk metrics. Use this to understand a specific client's exposure.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "Client ID (e.g. C001)" }
        },
        required: ["client_id"]
      }
    }
  }
];


// ══════════════════════════════════════════════════════════════════════
// TOOL IMPLEMENTATIONS
// ══════════════════════════════════════════════════════════════════════

const toolImplementations = {
  async create_alert(args) {
    const alert = {
      client_id: args.client_id,
      severity: args.severity,
      title: args.title,
      description: args.description,
      suggested_action: args.suggested_action,
      related_event: args.related_event || null
    };
    await saveAlert(alert);
    return { success: true, message: `Alert created for ${args.client_id}: ${args.severity} — ${args.title}` };
  },

  async save_client_insight(args) {
    const insight = {
      client_id: args.client_id,
      summary: args.summary,
      impact_analysis: args.impact_analysis,
      risk_assessment: args.risk_assessment,
      recommendations: args.recommendations,
      talking_points: args.talking_points,
      urgency: args.urgency
    };
    await saveInsight(insight);
    return { success: true, message: `Insight saved for ${args.client_id}` };
  },

  async get_client_portfolio(args) {
    const clients = getClients();
    const client = clients.find(c => c.client_id === args.client_id);
    if (!client) return { error: `Client ${args.client_id} not found` };

    const holdingDetails = client.holdings.map(h => ({
      ticker: h.symbol,
      name: h.name,
      sector: h.sector,
      weight_pct: parseFloat((h.weight * 100).toFixed(1)),
      value: Math.round(h.weight * client.portfolio_value),
      beta: TICKERS[h.symbol]?.beta || 0
    }));

    // Sector breakdown
    const sectorBreakdown = {};
    for (const h of holdingDetails) {
      sectorBreakdown[h.sector] = (sectorBreakdown[h.sector] || 0) + h.weight_pct;
    }

    const varMetrics = await computeVaR(client);

    return {
      client_id: client.client_id,
      name: client.name,
      age: client.age,
      portfolio_value: client.portfolio_value,
      risk_tolerance: client.risk_tolerance,
      time_horizon_years: client.time_horizon_years,
      holdings: holdingDetails,
      sector_breakdown: sectorBreakdown,
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
  }
};


/**
 * Execute a tool call from the agent
 */
export async function executeTool(toolName, args) {
  const impl = toolImplementations[toolName];
  if (!impl) {
    console.error(`[Tools] Unknown tool: ${toolName}`);
    return { error: `Unknown tool: ${toolName}` };
  }
  console.log(`[Tools] Executing: ${toolName}(${JSON.stringify(args).substring(0, 100)}...)`);
  try {
    return await impl(args);
  } catch (err) {
    console.error(`[Tools] Error in ${toolName}:`, err.message);
    return { error: err.message };
  }
}
