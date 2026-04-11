// ── AI Agent ──────────────────────────────────────────────────────────
// The brain: takes analytics metrics, uses LLM (Gemini or OpenRouter)
// to connect dots, calls tools to create alerts and save insights.

import dotenv from "dotenv";
dotenv.config();

// Disable SSL verification for development (handles certificate issues)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { TOOL_DEFINITIONS, executeTool } from "./tools.js";
import { getClients } from "./db.js";
import { callLLMWithRetry, getProviderName } from "./llm.js";

// ══════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ══════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are an AI financial advisor copilot agent for LPL Financial advisors. Your job is to analyze market events and their computed impact metrics, connect the dots across client portfolios, and produce actionable advisor decision support.

## Your Responsibilities:
1. ANALYZE the event metrics and sector impacts provided to you
2. CONNECT THE DOTS: Understand causal chains (e.g., "Iran war → oil supply disruption → energy stocks up → but inflation risk up → bonds down → tech hurt by higher rates")
3. For EACH client portfolio, determine:
   - How are they specifically affected given their holdings?
   - Does this breach their risk tolerance?
  - What should the advisor tell them?
  - What simulations or defensive moves should the advisor discuss?
4. CREATE ALERTS for clients with significant exposure (use the create_alert tool)
5. SAVE INSIGHTS for every client (use the save_client_insight tool) — even if the impact is minimal, the advisor needs to know "this client is fine"

## Alert Guidelines:
- CRITICAL: Portfolio impact > 8% OR risk tolerance breached significantly
- WARNING: Portfolio impact 3-8% OR moderate threshold breach  
- MONITOR: Portfolio impact 1-3%, worth watching
- No alert needed if impact < 1%

## Insight Guidelines:
- Be specific with numbers (e.g., "Your 10% energy allocation gains ~$12,000")
- Explain causal relationships clearly
- Provide actionable recommendations and next-step simulations
- Include talking points the advisor can use verbatim with the client
- Rate urgency: high (act today), medium (this week), low (next review)

## Important Rules:
- Always use real numbers from the metrics provided — never make up percentages
- If confidence is low (< 50%), explicitly note the uncertainty
- Consider the client's age, risk tolerance, and time horizon in your recommendations
- For conservative/retirement-focused clients, be more cautious
- For aggressive/young clients, frame opportunities alongside risks
- Use stress test and Monte Carlo outputs to explain downside ranges and probability-weighted outcomes when available

You MUST call tools for every client. Save insights for ALL clients and create alerts where warranted.`;


// LLM CALL (delegated to llm.js)
// ══════════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════════
// AGENT LOOP (with tool calling)
// ══════════════════════════════════════════════════════════════════════

/**
 * Run the AI agent on analytics results.
 * The agent will analyze, call tools (create_alert, save_insight), and produce a summary.
 */
export async function runAgent(analyticsResults) {
  const providerName = getProviderName();
  console.log(`\n[Agent] Starting AI analysis...`);
  console.log(`[Agent] LLM provider: ${providerName}`);

  // Build the user message with all analytics data
  const userMessage = buildUserMessage(analyticsResults);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage }
  ];

  let iterationCount = 0;
  const maxIterations = 15;  // safety limit
  let finalSummary = "";

  while (iterationCount < maxIterations) {
    iterationCount++;
    console.log(`[Agent] Iteration ${iterationCount}...`);

    const result = await callLLMWithRetry(messages, TOOL_DEFINITIONS, { maxTokens: 8000 });

    if (!result.content && !result.tool_calls) {
      console.error("[Agent] No response from LLM");
      break;
    }

    // Build an assistant message in the shape the conversation expects
    const msg = { role: "assistant", content: result.content || null };
    if (result.tool_calls) msg.tool_calls = result.tool_calls;

    // Add assistant message to conversation
    messages.push(msg);

    // Check if there are tool calls
    if (result.tool_calls && result.tool_calls.length > 0) {
      console.log(`[Agent] ${result.tool_calls.length} tool call(s) to execute`);

      for (const toolCall of result.tool_calls) {
        const toolName = toolCall.function.name;
        let args;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          args = {};
          console.error(`[Agent] Failed to parse args for ${toolName}`);
        }

        const toolResult = await executeTool(toolName, args);

        // Add tool result to conversation
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
          _toolName: toolName
        });
      }
    }

    // Check if the agent is done (no more tool calls, or finish_reason is "stop")
    if (result.finish_reason === "stop" || (!result.tool_calls || result.tool_calls.length === 0)) {
      finalSummary = result.content || "";
      console.log(`[Agent] Finished after ${iterationCount} iterations`);
      break;
    }
  }

  if (iterationCount >= maxIterations) {
    console.warn(`[Agent] Hit max iterations (${maxIterations})`);
  }

  return {
    summary: finalSummary,
    iterations: iterationCount,
    model: providerName
  };
}


// ══════════════════════════════════════════════════════════════════════
// BUILD CONTEXT FOR THE AGENT
// ══════════════════════════════════════════════════════════════════════

function buildUserMessage(analytics) {
  const { event_metrics, aggregated_sector_impacts, avg_confidence, client_impacts, summary } = analytics;
  const clients = getClients();

  let msg = `## New Market Events Batch\n\n`;
  msg += `**${summary.total_events} events** just arrived. Average confidence: ${avg_confidence}%\n\n`;

  // Events
  msg += `### Events & Their Metrics:\n`;
  for (const em of event_metrics) {
    msg += `\n**${em.headline}**\n`;
    msg += `- Category: ${em.category} | Sentiment: ${em.sentiment} | Confidence: ${em.confidence}% | Severity: ${em.severity}\n`;
    msg += `- Sector impacts: ${Object.entries(em.sector_impacts).map(([s, v]) => `${s}: ${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`).join(", ")}\n`;
    msg += `- Matched keywords: ${em.matched_keywords.join(", ")}\n`;
  }

  // Aggregated sector impacts
  msg += `\n### Aggregated Sector Impacts (all events combined):\n`;
  for (const [sector, impact] of Object.entries(aggregated_sector_impacts).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))) {
    msg += `- ${sector}: ${impact > 0 ? "+" : ""}${(impact * 100).toFixed(1)}%\n`;
  }

  // Client impacts
  msg += `\n### Client Portfolio Impacts:\n`;
  for (const ci of client_impacts) {
    const client = clients.find(c => c.client_id === ci.client_id);
    msg += `\n**${ci.client_name}** (${ci.client_id})\n`;
    msg += `- Risk tolerance: ${ci.risk_tolerance} | Portfolio: $${ci.portfolio_value.toLocaleString()} | Horizon: ${client?.time_horizon_years || "?"}y\n`;
    msg += `- Total impact: ${ci.total_impact_pct > 0 ? "+" : ""}${ci.total_impact_pct}% ($${ci.total_impact_dollar.toLocaleString()})\n`;
    msg += `- Confidence-weighted impact: ${ci.effective_impact_pct > 0 ? "+" : ""}${ci.effective_impact_pct}%\n`;
    msg += `- Threshold (${ci.risk_tolerance}): ±${ci.threshold_pct}% → ${ci.exceeds_threshold ? "⚠️ BREACHED" : "✅ Within limits"}\n`;
    msg += `- VaR(95%): $${ci.var_metrics.var_95.toLocaleString()} | VaR(99%): $${ci.var_metrics.var_99.toLocaleString()} | CVaR: $${ci.var_metrics.cvar_95.toLocaleString()}\n`;
    msg += `- Volatility: ${ci.var_metrics.volatility_pct}% | Beta: ${ci.var_metrics.beta} | Max Drawdown: ${ci.var_metrics.max_drawdown_pct}% | Risk Level: ${ci.var_metrics.risk_level}\n`;
    if (ci.stress_tests?.worst_case) {
      msg += `- Worst stress test: ${ci.stress_tests.worst_case.scenario} → ${ci.stress_tests.worst_case.total_impact_pct}% ($${ci.stress_tests.worst_case.total_impact_dollar.toLocaleString()})\n`;
    }
    if (ci.monte_carlo) {
      msg += `- Monte Carlo (${ci.monte_carlo.years}y, ${ci.monte_carlo.paths} paths): P10=$${ci.monte_carlo.percentile_terminal_values.p10.toLocaleString()} | Median=$${ci.monte_carlo.percentile_terminal_values.p50.toLocaleString()} | P90=$${ci.monte_carlo.percentile_terminal_values.p90.toLocaleString()} | Prob gain=${ci.monte_carlo.probability_of_gain_pct}%\n`;
    }
    if (ci.var_metrics.risk_drivers && ci.var_metrics.risk_drivers.length > 0) {
      msg += `- Risk drivers: ${ci.var_metrics.risk_drivers.join("; ")}\n`;
    }
    msg += `- Concentration: HHI=${ci.var_metrics.hhi} | Effective assets=${ci.var_metrics.effective_assets} | Top-3=${ci.var_metrics.top_3_concentration_pct}%\n`;
    if (ci.holding_impacts.length > 0) {
      msg += `- Top affected holdings:\n`;
      for (const h of ci.holding_impacts.slice(0, 5)) {
        msg += `  - ${h.ticker} (${h.sector}, ${h.weight}%): ${h.holding_impact_pct > 0 ? "+" : ""}${h.holding_impact_pct}% ($${h.holding_impact_dollar.toLocaleString()})\n`;
      }
    }
  }

  msg += `\n---\n`;
  msg += `\nPlease analyze all events, connect the dots (explain causal chains), and for EACH of the ${clients.length} clients:\n`;
  msg += `1. Call save_client_insight with a comprehensive analysis\n`;
  msg += `2. Call create_alert if the client's portfolio is significantly affected\n`;
  msg += `\nBe thorough — cover all ${clients.length} clients.`;

  return msg;
}
