// ── Server + Scheduler ────────────────────────────────────────────────
// Express server with simple dashboard + 3hr scheduled pipeline runs

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { connectDB, getLatestInsights, getActiveAlerts, getAllAlerts, getPipelineRuns, dismissAlert, getClientSnapshots, getLatestSnapshots } from "./db.js";
import { runPipeline } from "./pipeline.js";
import { CLIENTS, TICKERS } from "./data/sample_data.js";
import { computeVaR } from "./analytics_engine.js";
import { CHAT_TOOL_DEFINITIONS, executeChatTool, toolCallSummary } from "./chat_tools.js";
import { createClientMemory, loadClientMemory } from "./memory_manager.js";
import { callLLM, streamLLM, makeToolResultMessage, isConfigured, getProviderName } from "./llm.js";
import path from "path";
import { fileURLToPath } from "url";

// Disable SSL verification for development (handles certificate issues)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const MEMORY_RETRIEVAL_TOOL_NAMES = new Set([
  "get_client_portfolio",
  "get_client_insights",
  "get_client_alerts",
  "get_recent_news"
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const INTERVAL_HOURS = parseFloat(process.env.PIPELINE_INTERVAL_HOURS || 3);

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "views")));

// ── API Routes ────────────────────────────────────────────────────────

// Get all insights (optionally filter by client)
app.get("/api/insights", async (req, res) => {
  try {
    const { client_id, limit } = req.query;
    const insights = await getLatestInsights(client_id || null, parseInt(limit) || 20);
    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all alerts
app.get("/api/alerts", async (req, res) => {
  try {
    const { client_id, all } = req.query;
    const alerts = all === "true"
      ? await getAllAlerts()
      : await getActiveAlerts(client_id || null);
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dismiss an alert
app.post("/api/alerts/:id/dismiss", async (req, res) => {
  try {
    await dismissAlert(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get pipeline run history
app.get("/api/pipeline-runs", async (req, res) => {
  try {
    const runs = await getPipelineRuns();
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get analytics snapshots for a specific client (last 20)
app.get("/api/analytics-snapshots/:clientId", async (req, res) => {
  try {
    const { limit } = req.query;
    const snapshots = await getClientSnapshots(req.params.clientId, parseInt(limit) || 20);
    res.json(snapshots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get latest analytics snapshot for every client (one each)
app.get("/api/analytics-latest", async (req, res) => {
  try {
    const snapshots = await getLatestSnapshots();
    if (snapshots.length === 0) return res.json({ message: "No analytics snapshots yet. Run the pipeline first." });
    res.json(snapshots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get clients list
app.get("/api/clients", (req, res) => {
  res.json(CLIENTS.map(c => ({
    client_id: c.client_id,
    name: c.name,
    portfolio_value: c.portfolio_value,
    risk_tolerance: c.risk_tolerance
  })));
});

// Get full client portfolio details (holdings, sectors, risk metrics)
app.get("/api/clients/:clientId", async (req, res) => {
  try {
    const client = CLIENTS.find(c => c.client_id === req.params.clientId);
    if (!client) return res.status(404).json({ error: "Client not found" });

    const holdings = Object.entries(client.holdings).map(([ticker, weight]) => ({
      ticker,
      name: TICKERS[ticker]?.name || ticker,
      sector: TICKERS[ticker]?.sector || "unknown",
      weight_pct: parseFloat((weight * 100).toFixed(1)),
      value: Math.round(weight * client.portfolio_value),
      beta: TICKERS[ticker]?.beta || 0
    }));

    const sectorBreakdown = {};
    for (const h of holdings) {
      sectorBreakdown[h.sector] = (sectorBreakdown[h.sector] || 0) + h.weight_pct;
    }

    const varMetrics = await computeVaR(client);

    // Get latest insights and alerts for this client
    const [allAlerts, allInsights] = await Promise.all([
      getAllAlerts(),
      getLatestInsights(req.params.clientId)
    ]);
    const clientAlerts = allAlerts.filter(a => a.client_id === req.params.clientId);
    const clientInsights = allInsights.filter(i => i.client_id === req.params.clientId);

    res.json({
      client_id: client.client_id,
      name: client.name,
      age: client.age,
      portfolio_value: client.portfolio_value,
      risk_tolerance: client.risk_tolerance,
      time_horizon_years: client.time_horizon_years,
      holdings,
      sector_breakdown: sectorBreakdown,
      risk_metrics: {
        var_95: varMetrics.var_95,
        var_99: varMetrics.var_99,
        cvar_95: varMetrics.cvar_95,
        volatility_pct: varMetrics.volatility_pct,
        vol_source: varMetrics.vol_source,
        beta: varMetrics.beta,
        max_drawdown_pct: varMetrics.max_drawdown_pct,
        risk_score: varMetrics.risk_score,
        risk_category: varMetrics.risk_category,
        risk_level: varMetrics.risk_level,
        risk_source: varMetrics.risk_source,
        risk_drivers: varMetrics.risk_drivers,
        hhi: varMetrics.hhi,
        effective_assets: varMetrics.effective_assets,
        top_3_concentration_pct: varMetrics.top_3_concentration_pct,
        sector_exposure: varMetrics.sector_exposure
      },
      alerts: clientAlerts,
      insights: clientInsights.slice(0, 5)
    });
  } catch (err) {
    console.error(`[Server] Client detail error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/memory/:clientId", async (req, res) => {
  try {
    const memory = await loadClientMemory(req.params.clientId);
    res.json(memory);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memory/:clientId/create", async (req, res) => {
  try {
    const memory = await createClientMemory(req.params.clientId);
    res.json({
      success: true,
      client_id: memory.client_id,
      file_path: memory.file_path,
      generated_at: memory.generated_at,
      alerts_count: memory.alerts_count,
      insights_count: memory.insights_count,
      snapshot_count: memory.snapshot_count,
      news_count: memory.news_count
    });
  } catch (err) {
    console.error("[Server] Memory creation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger pipeline
app.post("/api/pipeline/run", async (req, res) => {
  try {
    const { news_count } = req.body;
    res.json({ message: "Pipeline started", status: "running" });
    // Run async (don't block the response)
    runPipeline(news_count || 3).catch(err =>
      console.error("[Server] Pipeline error:", err.message)
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Chat Endpoint (SSE + Agentic Tool Calling) ───────────────────────

const CHAT_SYSTEM_PROMPT = `You are an AI copilot for LPL Financial advisors. Your main job is to help advisors discuss portfolio strategy, recommend changes, simulate those changes, and explain the results clearly.

You have access to tools that let you fetch portfolio data, alerts, news context, stress tests, Monte Carlo simulations, recommendation payloads, and before/after portfolio comparisons. ALWAYS use these tools to get data before answering — never make up numbers.

## Available clients:
${CLIENTS.map(c => `- ${c.client_id}: ${c.name} (${c.risk_tolerance}, $${c.portfolio_value.toLocaleString()})`).join("\n")}

## How to answer:
1. First, call the relevant tools to get the data you need
2. If the advisor asks for a recommendation, generate a proposed allocation and discuss simulated before/after trade-offs
3. If the advisor suggests manual changes, compare the current vs proposed allocation before answering
4. Then synthesize the data into a clear, actionable answer
5. Explain trade-offs: risk reduction, diversification, downside protection, and upside impact
6. Be specific with dollar amounts and percentages
7. Consider the client's age, risk tolerance, and time horizon
8. Provide talking points the advisor can use directly with the client
9. Keep answers concise — advisors are busy

## Workflow to prefer:
- Discuss current risks
- Recommend a change
- Simulate the recommendation
- Explain before/after metrics
- Give advisor-ready talking points

## Tool usage hints:
- For questions about a specific client → get_client_portfolio + get_client_alerts
- For recent context → get_recent_news + get_client_insights
- For what-if scenarios → run_stress_test or compare_portfolio_change
- For future outcome ranges → run_monte_carlo_simulation
- For allocation suggestions → generate_allocation_recommendation
- Always check alerts when discussing risk`;

/**
 * POST /api/chat — Server-Sent Events (SSE) agentic endpoint
 * Streams: tool_call → tool_result → ... → response
 */
app.post("/api/chat", async (req, res) => {
  const { message, client_id, history } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  if (!isConfigured()) {
    return res.status(500).json({ error: `LLM not configured. Set LLM_PROVIDER and the matching API key in .env` });
  }

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });

  // Disable response buffering / compression so each write reaches the client immediately
  res.flushHeaders();

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    // Force TCP flush on Node — needed for SSE over proxies
    if (typeof res.flush === "function") res.flush();
  };

  try {
    const clientLabel = client_id
      ? CLIENTS.find(c => c.client_id === client_id)?.name || client_id
      : "All Clients";

    const clientMemory = client_id ? await loadClientMemory(client_id) : null;
    const needsFreshData = /\b(refresh|latest|live|current news|current alerts|updated|re-fetch)\b/i.test(message);
    const availableTools = clientMemory?.exists && client_id && !needsFreshData
      ? CHAT_TOOL_DEFINITIONS.filter(tool => !MEMORY_RETRIEVAL_TOOL_NAMES.has(tool.function.name))
      : CHAT_TOOL_DEFINITIONS;

    const memoryLoaded = !!(clientMemory?.exists && clientMemory.content);
    console.log(`[Chat] Query for "${clientLabel}": ${message.substring(0, 80)}...`);
    console.log(`[Chat] Memory: ${memoryLoaded ? `LOADED (${clientMemory.updated_at})` : "NOT FOUND"} | Tools: ${availableTools.length}/${CHAT_TOOL_DEFINITIONS.length} | Fresh-data override: ${needsFreshData}`);

    // Build a lean system prompt — NO data stuffing
    let systemContent = CHAT_SYSTEM_PROMPT;
    if (client_id) {
      systemContent += `\n\nThe advisor is currently viewing client ${client_id}. Focus on this client unless they ask about others.`;
      if (clientMemory?.exists && clientMemory.content) {
        systemContent += `\n\nA persisted client memory snapshot is available. Use it as the default source of truth for this client and avoid calling portfolio/insight/alert/news retrieval tools unless the advisor explicitly asks for refresh, live/latest data, or information not present in memory.`;
      }
    }

    const messages = [{ role: "system", content: systemContent }];

    if (clientMemory?.exists && clientMemory.content) {
      messages.push({
        role: "system",
        content: `Persisted client memory snapshot for ${client_id} (updated ${clientMemory.updated_at}):\n\n${clientMemory.content}`
      });
    }

    // Add conversation history (last 10 turns)
    const recentHistory = (history || []).slice(-10);
    for (const h of recentHistory) {
      if (h.role === "user" || h.role === "assistant") {
        messages.push({ role: h.role, content: h.content });
      }
    }
    messages.push({ role: "user", content: message });

    // ── Helper: streaming LLM call via llm.js ──
    async function streamFinalResponse() {
      sendEvent("stream_start", {});

      let fullContent = "";
      const toolCalls = [];
      let bufferedTokens = [];
      let hasToolCalls = false;

      for await (const event of streamLLM(messages, availableTools, { temperature: 0.3, maxTokens: 3000 })) {
        if (event.type === "token") {
          fullContent += event.content;
          bufferedTokens.push(event.content);
          // Flush tokens only if no tool calls have appeared
          if (!hasToolCalls) {
            for (const tok of bufferedTokens) {
              sendEvent("token", { content: tok });
            }
            bufferedTokens = [];
          }
        } else if (event.type === "tool_call") {
          hasToolCalls = true;
          toolCalls.push(event.tool_call);
        }
      }

      if (hasToolCalls) {
        sendEvent("stream_end", {});
      } else {
        for (const tok of bufferedTokens) {
          sendEvent("token", { content: tok });
        }
        sendEvent("stream_end", {});
      }

      return { content: fullContent, tool_calls: hasToolCalls ? toolCalls : null };
    }

    // ── Agentic loop ──────────────────────────────────────────────
    let iterationCount = 0;
    const maxIterations = 10;

    while (iterationCount < maxIterations) {
      iterationCount++;

      let choice, msg;

      try {
        // First iteration or after tool results: try streaming
        const streamResult = await streamFinalResponse();

        if (streamResult.tool_calls && streamResult.tool_calls.length > 0) {
          // LLM wants to call tools — handle them and loop back
          msg = { role: "assistant", content: streamResult.content || null, tool_calls: streamResult.tool_calls };
          messages.push(msg);

          for (const toolCall of streamResult.tool_calls) {
            const toolName = toolCall.function.name;
            let args;
            try { args = JSON.parse(toolCall.function.arguments); } catch { args = {}; }

            const summary = toolCallSummary(toolName, args);
            console.log(`[Chat] Tool: ${toolName}(${JSON.stringify(args).substring(0, 60)})`);

            // Block suppressed retrieval tools
            if (memoryLoaded && !needsFreshData && MEMORY_RETRIEVAL_TOOL_NAMES.has(toolName)) {
              console.log(`[Chat] ⛔ Blocked suppressed tool: ${toolName} (memory is loaded)`);
              const blockedResult = { _blocked: true, reason: "This tool is not available because client memory is already loaded. Use the memory content instead." };
              messages.push(makeToolResultMessage(toolCall.id, toolName, blockedResult));
              sendEvent("tool_result", { name: toolName, summary: "Skipped (using memory)", preview: "Using cached memory" });
              continue;
            }

            sendEvent("tool_call", { name: toolName, args, summary });

            const result = await executeChatTool(toolName, args);

            const resultPreview = JSON.stringify(result).substring(0, 200);
            sendEvent("tool_result", { name: toolName, summary, preview: resultPreview });

            messages.push(makeToolResultMessage(toolCall.id, toolName, result));
          }
          // Continue loop — next iteration will stream the final answer
          continue;
        }

        // No tool calls — text was already streamed token-by-token
        console.log(`[Chat] Done in ${iterationCount} iteration(s): ${(streamResult.content || "").substring(0, 100)}...`);
        break;

      } catch (err) {
        console.error(`[Chat] LLM error:`, err.message);
        sendEvent("error", { message: err.message });
        break;
      }
    }

    if (iterationCount >= maxIterations) {
      sendEvent("error", { message: "Agent hit max iterations" });
    }
  } catch (err) {
    console.error("[Chat] Error:", err.message);
    sendEvent("error", { message: err.message });
  } finally {
    sendEvent("done", {});
    res.end();
  }
});


// Serve dashboard
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "dashboard.html"));
});


// ── Start ─────────────────────────────────────────────────────────────

async function start() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`\n[Server] Running at http://localhost:${PORT}`);
    console.log(`[Server] LLM provider: ${getProviderName()}`);
    console.log(`[Server] Pipeline interval: ${INTERVAL_HOURS}h`);
    console.log(`[Server] Dashboard: http://localhost:${PORT}\n`);
  });

  // Schedule pipeline runs
  const intervalMs = INTERVAL_HOURS * 60 * 60 * 1000;
  setInterval(() => {
    console.log(`\n[Scheduler] Triggering scheduled pipeline run...`);
    runPipeline(3).catch(err =>
      console.error("[Scheduler] Pipeline error:", err.message)
    );
  }, intervalMs);

  console.log(`[Scheduler] Next automatic run in ${INTERVAL_HOURS}h`);
  console.log(`[Server] Trigger manually: POST http://localhost:${PORT}/api/pipeline/run`);
}

start().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
