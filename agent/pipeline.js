// ── Pipeline Runner ───────────────────────────────────────────────────
// Orchestrates: News Ingestion → Analytics → AI Agent

import { fetchNewsBatch, fetchNews } from "./news_ingestion.js";
import { runAnalytics } from "./analytics_engine.js";
import { runAgent } from "./agent.js";
import { saveNewsEvents, savePipelineRun, saveAnalyticsSnapshots } from "./db.js";

/**
 * Run the full pipeline end-to-end
 * @param {number} newsCount - Number of news events to fetch (default 3)
 * @returns Pipeline run result
 */
export async function runPipeline(newsCount = 3) {
  const startedAt = new Date();
  console.log(`\n${"═".repeat(60)}`);
  console.log(`[Pipeline] Starting at ${startedAt.toISOString()}`);
  console.log(`${"═".repeat(60)}`);

  let result = {
    started_at: startedAt,
    status: "running",
    news_count: 0,
    alerts_created: 0,
    insights_created: 0,
    agent_summary: ""
  };

  try {
    // Step 1: Fetch news (live from Server API or sample data, controlled by USE_LIVE_NEWS env)
    console.log(`\n[Pipeline] Step 1: Fetching news (${newsCount} events)...`);
    const news = await fetchNews(newsCount);
    result.news_count = news.length;
    console.log(`[Pipeline] Got ${news.length} events:`);
    news.forEach(n => console.log(`  → ${n.headline}`));

    // Save news to DB
    try {
      await saveNewsEvents(news);
    } catch (dbErr) {
      console.warn(`[Pipeline] Warning: Could not save to DB - ${dbErr.message}`);
    }

    // Step 2: Run analytics (calls ML model via HF Spaces)
    console.log(`\n[Pipeline] Step 2: Running analytics engine...`);
    const analyticsResults = await runAnalytics(news);

    // Step 2b: Save per-client analytics snapshots (each client keeps last 5)
    try {
      const eventContext = {
        event_count: analyticsResults.event_count,
        events: analyticsResults.event_metrics.map(em => ({
          headline: em.headline,
          category: em.category,
          sentiment: em.sentiment,
          confidence: em.confidence,
          severity: em.severity,
          sector_impacts: em.sector_impacts,
          net_impact: em.net_impact
        })),
        aggregated_sector_impacts: analyticsResults.aggregated_sector_impacts,
        avg_confidence: analyticsResults.avg_confidence,
        summary: analyticsResults.summary
      };

      const clientSnapshots = analyticsResults.client_impacts.map(ci => ({
        client_id: ci.client_id,
        client_name: ci.client_name,
        portfolio_value: ci.portfolio_value,
        risk_tolerance: ci.risk_tolerance,
        total_impact_pct: ci.total_impact_pct,
        total_impact_dollar: ci.total_impact_dollar,
        effective_impact_pct: ci.effective_impact_pct,
        exceeds_threshold: ci.exceeds_threshold,
        var_metrics: ci.var_metrics,
        holding_impacts: ci.holding_impacts,
        event_context: eventContext
      }));

      await saveAnalyticsSnapshots(clientSnapshots);
    } catch (snapErr) {
      console.warn(`[Pipeline] Warning: Could not save analytics snapshot - ${snapErr.message}`);
    }

    // Step 3: Run AI agent
    console.log(`\n[Pipeline] Step 3: Running AI agent...`);
    const agentResult = await runAgent(analyticsResults);

    result.agent_summary = agentResult.summary;
    result.agent_iterations = agentResult.iterations;
    result.status = "completed";
    result.completed_at = new Date();
    result.duration_seconds = (result.completed_at - startedAt) / 1000;

    // Count alerts and insights created during this pipeline run
    try {
      const db = await import("./db.js").then(m => m.getDB());
      result.alerts_created = await db.collection("alerts")
        .countDocuments({ created_at: { $gte: startedAt } });
      result.insights_created = await db.collection("insights")
        .countDocuments({ created_at: { $gte: startedAt } });
    } catch (countErr) {
      console.warn(`[Pipeline] Warning: Could not count created records - ${countErr.message}`);
    }

    console.log(`\n${"═".repeat(60)}`);
    console.log(`[Pipeline] COMPLETED in ${result.duration_seconds.toFixed(1)}s`);
    console.log(`${"═".repeat(60)}`);

    if (agentResult.summary) {
      console.log(`\n[Agent Summary]\n${agentResult.summary}\n`);
    }

  } catch (err) {
    result.status = "failed";
    result.error = err.message;
    result.completed_at = new Date();
    console.error(`\n[Pipeline] FAILED:`, err.message);
    console.error(`[Pipeline] Full error:`, err);
  }

  // Save pipeline run to DB
  try {
    await savePipelineRun(result);
  } catch (dbErr) {
    console.warn(`[Pipeline] Warning: Could not save pipeline run - ${dbErr.message}`);
  }

  return result;
}
