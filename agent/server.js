// ── Server + Scheduler ────────────────────────────────────────────────
// Express server with simple dashboard + 3hr scheduled pipeline runs

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { connectDB, getLatestInsights, getActiveAlerts, getAllAlerts, getPipelineRuns, dismissAlert } from "./db.js";
import { runPipeline } from "./pipeline.js";
import { CLIENTS } from "./data/sample_data.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const INTERVAL_HOURS = parseFloat(process.env.PIPELINE_INTERVAL_HOURS || 3);

app.use(express.json());
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
