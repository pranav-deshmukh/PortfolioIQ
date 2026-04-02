// ── Server + Scheduler ────────────────────────────────────────────────
// Express server with simple dashboard + 3hr scheduled pipeline runs

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { connectDB, getLatestInsights, getActiveAlerts, getAllAlerts, getPipelineRuns, dismissAlert } from "./db.js";
import { runPipeline } from "./pipeline.js";
import { CLIENTS, TICKERS } from "./data/sample_data.js";
import { computeVaR } from "./analytics_engine.js";
import { CHAT_TOOL_DEFINITIONS, executeChatTool, toolCallSummary } from "./chat_tools.js";
import path from "path";
import { fileURLToPath } from "url";

// Disable SSL verification for development (handles certificate issues)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const CHAT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

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

// Get clients list
app.get("/api/clients", (req, res) => {
  res.json(CLIENTS.map(c => ({
    client_id: c.client_id,
    name: c.name,
    portfolio_value: c.portfolio_value,
    risk_tolerance: c.risk_tolerance
  })));
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

const CHAT_SYSTEM_PROMPT = `You are an AI copilot for LPL Financial advisors. You help advisors understand how market events affect their client portfolios.

You have access to tools that let you fetch portfolio data, insights, alerts, news, and run stress tests. ALWAYS use these tools to get data before answering — never make up numbers.

## Available clients:
${CLIENTS.map(c => `- ${c.client_id}: ${c.name} (${c.risk_tolerance}, $${c.portfolio_value.toLocaleString()})`).join("\n")}

## How to answer:
1. First, call the relevant tools to get the data you need
2. Then, synthesize the data into a clear, actionable answer
3. Be specific with dollar amounts and percentages
4. Consider the client's age, risk tolerance, and time horizon
5. Provide talking points the advisor can use directly with the client
6. Keep answers concise — advisors are busy

## Tool usage hints:
- For questions about a specific client → get_client_portfolio + get_client_insights
- For "who's most at risk" → get_all_clients_summary + get_client_alerts
- For "what happened" → get_recent_news + get_client_insights
- For "what if" scenarios → run_stress_test
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
  if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY === "your_openrouter_api_key_here") {
    return res.status(500).json({ error: "OPENROUTER_API_KEY not configured" });
  }

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    const clientLabel = client_id
      ? CLIENTS.find(c => c.client_id === client_id)?.name || client_id
      : "All Clients";

    console.log(`[Chat] Query for "${clientLabel}": ${message.substring(0, 80)}...`);

    // Build a lean system prompt — NO data stuffing
    let systemContent = CHAT_SYSTEM_PROMPT;
    if (client_id) {
      systemContent += `\n\nThe advisor is currently viewing client ${client_id}. Focus on this client unless they ask about others.`;
    }

    const messages = [{ role: "system", content: systemContent }];

    // Add conversation history (last 10 turns)
    const recentHistory = (history || []).slice(-10);
    for (const h of recentHistory) {
      if (h.role === "user" || h.role === "assistant") {
        messages.push({ role: h.role, content: h.content });
      }
    }
    messages.push({ role: "user", content: message });

    // ── Agentic loop ──────────────────────────────────────────────
    let iterationCount = 0;
    const maxIterations = 10;

    while (iterationCount < maxIterations) {
      iterationCount++;

      const llmRes = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "http://localhost:3001",
          "X-Title": "LPL Advisor Copilot Chat"
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages,
          tools: CHAT_TOOL_DEFINITIONS,
          tool_choice: "auto",
          temperature: 0.3,
          max_tokens: 3000
        })
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text();
        console.error(`[Chat] LLM error ${llmRes.status}:`, errText);
        sendEvent("error", { message: `LLM API error: ${llmRes.status}` });
        break;
      }

      const data = await llmRes.json();
      const choice = data.choices?.[0];
      if (!choice) {
        sendEvent("error", { message: "No response from LLM" });
        break;
      }

      const msg = choice.message;
      messages.push(msg);

      // ── Tool calls ────────────────────────────────────────────
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const toolCall of msg.tool_calls) {
          const toolName = toolCall.function.name;
          let args;
          try { args = JSON.parse(toolCall.function.arguments); } catch { args = {}; }

          const summary = toolCallSummary(toolName, args);
          console.log(`[Chat] Tool: ${toolName}(${JSON.stringify(args).substring(0, 60)})`);

          // Stream: tool call started
          sendEvent("tool_call", { name: toolName, args, summary });

          // Execute
          const result = await executeChatTool(toolName, args);

          // Stream: tool result
          const resultPreview = JSON.stringify(result).substring(0, 200);
          sendEvent("tool_result", { name: toolName, summary, preview: resultPreview });

          // Feed back to LLM
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        }
      }

      // ── Done (no more tool calls) ─────────────────────────────
      if (choice.finish_reason === "stop" || !msg.tool_calls || msg.tool_calls.length === 0) {
        const reply = msg.content || "";
        console.log(`[Chat] Done in ${iterationCount} iteration(s): ${reply.substring(0, 100)}...`);
        sendEvent("response", { content: reply });
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
