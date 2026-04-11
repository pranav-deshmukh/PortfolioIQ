import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TICKERS } from "./data/sample_data.js";
import { computeVaR } from "./analytics_engine.js";
import { getLatestInsights, getActiveAlerts, getClientSnapshots, getDB, getClients } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = path.join(__dirname, "memory");

function getMemoryPath(clientId) {
  return path.join(MEMORY_DIR, `memory_${clientId}.md`);
}

async function ensureMemoryDir() {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
}

function formatCurrency(value) {
  return `$${Math.round(Number(value) || 0).toLocaleString()}`;
}

function formatPercent(value, digits = 1) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

function toSectorBreakdown(client) {
  const sectors = {};
  for (const h of client.holdings) {
    sectors[h.sector] = (sectors[h.sector] || 0) + h.weight;
  }
  return Object.fromEntries(
    Object.entries(sectors)
      .sort((a, b) => b[1] - a[1])
      .map(([sector, weight]) => [sector, parseFloat((weight * 100).toFixed(1))])
  );
}

async function getRecentNews(limit = 5) {
  const db = await getDB();
  return db.collection("news_events")
    .find({})
    .sort({ timestamp: -1, created_at: -1, fetched_at: -1 })
    .limit(limit)
    .toArray();
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") return JSON.stringify(item);
        return String(item);
      })
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(/\n|;|•/).map(item => item.trim()).filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, val]) => `${key}: ${typeof val === "string" ? val : JSON.stringify(val)}`);
  }

  return [];
}

function formatInsightLine(insight) {
  const recommendations = normalizeList(insight.recommendations);
  return `- ${insight.summary || "No summary"}${recommendations.length ? ` | Recommendations: ${recommendations.join("; ")}` : ""}`;
}

function formatNewsCategory(category) {
  if (Array.isArray(category)) return category.join(", ");
  if (typeof category === "string") return category;
  return "uncategorized";
}

function renderMemoryMarkdown({ client, riskMetrics, alerts, insights, snapshots, news, generatedAt }) {
  const sectorBreakdown = toSectorBreakdown(client);
  const latestSnapshot = snapshots[0] || null;
  const latestStress = latestSnapshot?.stress_tests?.worst_case || null;
  const latestMonteCarlo = latestSnapshot?.monte_carlo || null;

  const holdingsLines = [...client.holdings]
    .sort((a, b) => b.weight - a.weight)
    .map(h => {
      return `- ${h.symbol} (${h.name}) — ${formatPercent(h.weight * 100)} | ${h.sector} | ${formatCurrency(h.weight * client.portfolio_value)}`;
    })
    .join("\n");

  const sectorLines = Object.entries(sectorBreakdown)
    .map(([sector, pct]) => `- ${sector}: ${formatPercent(pct)}`)
    .join("\n");

  const alertLines = alerts.length
    ? alerts.slice(0, 5).map(alert => `- [${alert.severity}] ${alert.title}: ${alert.description}`).join("\n")
    : "- No active alerts";

  const insightLines = insights.length
    ? insights.slice(0, 5).map(formatInsightLine).join("\n")
    : "- No saved insights yet";

  const newsLines = news.length
    ? news.map(item => `- ${item.headline || item.title || "Untitled"} | ${formatNewsCategory(item.category)} | ${(item.raw_sentiment_hint || item.sentiment_hint || "neutral")}`).join("\n")
    : "- No recent news captured";

  return `# Client Memory — ${client.client_id}\n\nGenerated: ${generatedAt}\n\n## Client Profile\n- Name: ${client.name}\n- Age: ${client.age}\n- Risk tolerance: ${client.risk_tolerance}\n- Time horizon: ${client.time_horizon_years} years\n- Portfolio value: ${formatCurrency(client.portfolio_value)}\n\n## Portfolio Holdings\n${holdingsLines}\n\n## Sector Breakdown\n${sectorLines}\n\n## Current Risk Metrics\n- VaR (95%): ${formatCurrency(riskMetrics.var_95)}\n- VaR (99%): ${formatCurrency(riskMetrics.var_99)}\n- CVaR (95%): ${formatCurrency(riskMetrics.cvar_95)}\n- Volatility: ${formatPercent(riskMetrics.volatility_pct, 2)}\n- Beta: ${riskMetrics.beta}\n- Max drawdown: ${formatPercent(riskMetrics.max_drawdown_pct, 2)}\n- Risk score: ${riskMetrics.risk_score} (${riskMetrics.risk_category})\n- Top 3 concentration: ${formatPercent(riskMetrics.top_3_concentration_pct, 1)}\n- Risk drivers: ${(riskMetrics.risk_drivers || []).join("; ") || "None"}\n\n## Active Alerts\n${alertLines}\n\n## Latest Advisor Insights\n${insightLines}\n\n## Latest Analytics Snapshot\n${latestSnapshot ? `- Snapshot created: ${latestSnapshot.created_at}\n- Event-driven impact: ${formatPercent(latestSnapshot.total_impact_pct, 2)} | ${formatCurrency(latestSnapshot.total_impact_dollar)}\n- Confidence-weighted impact: ${formatPercent(latestSnapshot.effective_impact_pct, 2)}\n- Threshold breached: ${latestSnapshot.exceeds_threshold ? "Yes" : "No"}` : "- No analytics snapshot available yet"}\n${latestStress ? `- Worst stress test: ${latestStress.scenario} | ${formatPercent(latestStress.total_impact_pct, 2)} | ${formatCurrency(latestStress.total_impact_dollar)}` : ""}\n${latestMonteCarlo ? `- Monte Carlo (${latestMonteCarlo.years}y, ${latestMonteCarlo.paths} paths): P10=${formatCurrency(latestMonteCarlo.percentile_terminal_values.p10)}, Median=${formatCurrency(latestMonteCarlo.percentile_terminal_values.p50)}, P90=${formatCurrency(latestMonteCarlo.percentile_terminal_values.p90)}, Prob gain=${formatPercent(latestMonteCarlo.probability_of_gain_pct, 1)}` : ""}\n\n## Recent News Context\n${newsLines}\n\n## Instructions For Copilot\n- Use this memory as the default source of truth for this client.\n- Avoid re-fetching portfolio, alerts, insights, or recent news unless the advisor asks for refresh, latest/live data, or something missing from this memory.\n- For new what-if scenarios or allocation changes, run simulation tools as needed.`;
}

export async function createClientMemory(clientId) {
  const clients = getClients();
  const client = clients.find(item => item.client_id === clientId);
  if (!client) {
    throw new Error(`Client ${clientId} not found`);
  }

  await ensureMemoryDir();

  const [riskMetrics, alerts, insights, snapshots, news] = await Promise.all([
    computeVaR(client),
    getActiveAlerts(clientId),
    getLatestInsights(clientId, 5),
    getClientSnapshots(clientId, 3),
    getRecentNews(5)
  ]);

  const generatedAt = new Date().toISOString();
  const content = renderMemoryMarkdown({
    client,
    riskMetrics,
    alerts,
    insights,
    snapshots,
    news,
    generatedAt
  });

  const filePath = getMemoryPath(clientId);
  await fs.writeFile(filePath, content, "utf8");

  return {
    client_id: clientId,
    file_path: filePath,
    generated_at: generatedAt,
    alerts_count: alerts.length,
    insights_count: insights.length,
    snapshot_count: snapshots.length,
    news_count: news.length,
    content
  };
}

export async function loadClientMemory(clientId) {
  const filePath = getMemoryPath(clientId);
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(filePath, "utf8"),
      fs.stat(filePath)
    ]);
    return {
      exists: true,
      client_id: clientId,
      file_path: filePath,
      updated_at: stat.mtime.toISOString(),
      content
    };
  } catch {
    return {
      exists: false,
      client_id: clientId,
      file_path: filePath,
      content: null
    };
  }
}
