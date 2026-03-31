// ── Pipeline Runner ───────────────────────────────────────────────────
// Orchestrates: News Ingestion → Analytics → AI Agent

import { fetchNewsBatch } from "./news_ingestion.js";
import { runAnalytics } from "./analytics_engine.js";
import { runAgent } from "./agent.js";
import { saveNewsEvents, savePipelineRun } from "./db.js";

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
    // Step 1: Fetch news
    console.log(`\n[Pipeline] Step 1: Fetching news (${newsCount} events)...`);
    const news = fetchNewsBatch(newsCount);
    result.news_count = news.length;
    console.log(`[Pipeline] Got ${news.length} events:`);
    news.forEach(n => console.log(`  → ${n.headline}`));

    // Save news to DB
    await saveNewsEvents(news);

    // Step 2: Run analytics
    console.log(`\n[Pipeline] Step 2: Running analytics engine...`);
    const analyticsResults = runAnalytics(news);

    // Step 3: Run AI agent
    console.log(`\n[Pipeline] Step 3: Running AI agent...`);
    const agentResult = await runAgent(analyticsResults);

    result.agent_summary = agentResult.summary;
    result.agent_iterations = agentResult.iterations;
    result.status = "completed";
    result.completed_at = new Date();
    result.duration_seconds = (result.completed_at - startedAt) / 1000;

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
  }

  // Save pipeline run to DB
  await savePipelineRun(result);

  return result;
}
