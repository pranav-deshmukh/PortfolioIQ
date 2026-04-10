// ── Analytics Engine ──────────────────────────────────────────────────
// ML models + quant layers that analyze incoming news events.
// Produces structured metrics: sector impacts, confidence, severity, VaR, stress tests.
// These metrics get fed to the AI agent.

import { CLIENTS, TICKERS, SECTORS, RISK_THRESHOLDS } from "./data/sample_data.js";

// ══════════════════════════════════════════════════════════════════════
// 1. EVENT CLASSIFICATION — ML Model (HuggingFace Spaces)
//    Calls the deployed Event Impact Classifier via Gradio API.
//    Falls back to keyword rules if the API is unreachable.
// ══════════════════════════════════════════════════════════════════════

const HF_EVENT_IMPACT_URL = "https://pranavdeshmukh-event-impact.hf.space/gradio_api/call/predict";
const HF_RISK_SCORER_URL = "https://pranavdeshmukh-portfolio-risk-score.hf.space/gradio_api/call/predict";
const HF_VOLATILITY_URL = "https://pranavdeshmukh-volatility-var.hf.space/gradio_api/call/predict";
const HF_TIMEOUT_MS = 15000;  // 15s max wait

// Sector order expected by the risk scorer model
const RISK_SCORER_SECTORS = ["tech", "financials", "energy", "healthcare", "bonds", "commodities", "international"];

export const STRESS_SCENARIOS = {
  "2008_crisis": {
    name: "2008 Financial Crisis",
    desc: "Lehman collapse, S&P -57%",
    shocks: { tech: -0.52, financials: -0.68, energy: -0.45, healthcare: -0.22, bonds: 0.08, commodities: 0.05, international: -0.55, cash: 0.0 }
  },
  "covid_crash": {
    name: "2020 COVID Crash",
    desc: "Fastest bear market, -34%",
    shocks: { tech: -0.22, financials: -0.40, energy: -0.52, healthcare: -0.18, bonds: 0.06, commodities: -0.35, international: -0.32, cash: 0.0 }
  },
  "2022_rate_shock": {
    name: "2022 Rate Shock",
    desc: "Fed hikes 425bp, worst bond year",
    shocks: { tech: -0.38, financials: -0.15, energy: 0.58, healthcare: -0.05, bonds: -0.16, commodities: 0.22, international: -0.20, cash: 0.02 }
  },
  "oil_spike": {
    name: "Oil Spike +30%",
    desc: "OPEC+ surprise cut + supply shock",
    shocks: { tech: -0.06, financials: -0.04, energy: 0.22, healthcare: 0.0, bonds: -0.03, commodities: 0.18, international: -0.04, cash: 0.0 }
  },
  "tech_selloff": {
    name: "Tech Selloff -25%",
    desc: "AI bubble deflation / antitrust",
    shocks: { tech: -0.25, financials: -0.05, energy: 0.02, healthcare: 0.03, bonds: 0.04, commodities: 0.0, international: -0.08, cash: 0.0 }
  }
};

const DEFAULT_SECTOR_TICKERS = {
  tech: ["MSFT", "AAPL", "NVDA", "AMZN"],
  financials: ["JPM", "BAC"],
  energy: ["XOM", "CVX"],
  healthcare: ["JNJ", "PFE"],
  bonds: ["AGG", "BND"],
  commodities: ["GLD"],
  international: ["VEA"],
  cash: ["CASH"]
};

const RECOMMENDATION_PROFILES = {
  defensive: { tech: 0.20, financials: 0.08, energy: 0.07, healthcare: 0.12, bonds: 0.30, commodities: 0.06, international: 0.12, cash: 0.05 },
  balanced: { tech: 0.28, financials: 0.10, energy: 0.08, healthcare: 0.10, bonds: 0.22, commodities: 0.05, international: 0.12, cash: 0.05 },
  growth: { tech: 0.40, financials: 0.12, energy: 0.07, healthcare: 0.08, bonds: 0.15, commodities: 0.03, international: 0.10, cash: 0.05 }
};

/**
 * Call the HF Spaces Portfolio Risk Scorer model.
 * Input: sector weights as 7 floats [tech, financials, energy, healthcare, bonds, commodities, international]
 * Returns { risk_score (0-100), risk_category } or null on failure.
 */
async function callRiskScorerML(sectorWeights) {
  try {
    const submitRes = await fetch(HF_RISK_SCORER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: sectorWeights }),
      signal: AbortSignal.timeout(HF_TIMEOUT_MS)
    });
    if (!submitRes.ok) return null;
    const { event_id } = await submitRes.json();
    if (!event_id) return null;

    const resultRes = await fetch(`${HF_RISK_SCORER_URL}/${event_id}`, {
      signal: AbortSignal.timeout(HF_TIMEOUT_MS)
    });
    if (!resultRes.ok) return null;

    const rawText = await resultRes.text();
    const dataLine = rawText.split("\n").find(line => line.startsWith("data: "));
    if (!dataLine) return null;

    const parsed = JSON.parse(dataLine.replace("data: ", ""));
    // parsed = [26.4, "MODERATE"]
    if (!Array.isArray(parsed) || parsed.length < 2) return null;

    return { risk_score: parsed[0], risk_category: parsed[1] };
  } catch (err) {
    console.warn(`[ML] Risk scorer API error: ${err.message}`);
    return null;
  }
}

/**
 * Call the HF Spaces Volatility/VaR Forecaster (GARCH model).
 * Input: 7 sector weights, portfolio value, horizon ("1"/"5"/"21"), event severity
 * Returns { vol_pct, var_95, var_99 } or null on failure.
 */
async function callVolatilityML(sectorWeights, portfolioValue, horizon = "1", severity = "LOW") {
  try {
    const submitRes = await fetch(HF_VOLATILITY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [...sectorWeights, portfolioValue, horizon, severity] }),
      signal: AbortSignal.timeout(HF_TIMEOUT_MS)
    });
    if (!submitRes.ok) return null;
    const { event_id } = await submitRes.json();
    if (!event_id) return null;

    const resultRes = await fetch(`${HF_VOLATILITY_URL}/${event_id}`, {
      signal: AbortSignal.timeout(HF_TIMEOUT_MS)
    });
    if (!resultRes.ok) return null;

    const rawText = await resultRes.text();
    const dataLine = rawText.split("\n").find(line => line.startsWith("data: "));
    if (!dataLine) return null;

    const parsed = JSON.parse(dataLine.replace("data: ", ""));
    // parsed = [0.767, 12611.47, 17836.64]  (vol%, VaR95$, VaR99$)
    if (!Array.isArray(parsed) || parsed.length < 3) return null;

    return { vol_pct: parsed[0], var_95: parsed[1], var_99: parsed[2] };
  } catch (err) {
    console.warn(`[ML] Volatility API error: ${err.message}`);
    return null;
  }
}

/**
 * Call the HF Spaces ML model for a single event.
 * Returns { sector_impacts, confidence } or null on failure.
 */
async function callMLModel(headline, description) {
  try {
    // Step 1: Submit
    const submitRes = await fetch(HF_EVENT_IMPACT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [headline, description] }),
      signal: AbortSignal.timeout(HF_TIMEOUT_MS)
    });
    if (!submitRes.ok) return null;
    const { event_id } = await submitRes.json();
    if (!event_id) return null;

    // Step 2: Poll for result
    const resultRes = await fetch(`${HF_EVENT_IMPACT_URL}/${event_id}`, {
      signal: AbortSignal.timeout(HF_TIMEOUT_MS)
    });
    if (!resultRes.ok) return null;

    const rawText = await resultRes.text();
    // Gradio SSE format: "event: complete\ndata: [...]"
    const dataLine = rawText.split("\n").find(line => line.startsWith("data: "));
    if (!dataLine) return null;

    const parsed = JSON.parse(dataLine.replace("data: ", ""));
    // parsed = [{ tech: -0.05, financials: ..., ... }, 65]
    if (!Array.isArray(parsed) || parsed.length < 2) return null;

    const sectorImpacts = parsed[0];
    const confidence = parsed[1];

    return { sector_impacts: sectorImpacts, confidence };
  } catch (err) {
    console.warn(`[ML] HF API error: ${err.message}`);
    return null;
  }
}


// ── Keyword Fallback (used when ML model is unreachable) ─────────────

const SECTOR_IMPACT_RULES = {
  // Geopolitical / Oil
  oil:          { energy: +0.12, bonds: -0.03, tech: -0.04, commodities: +0.08, international: -0.05 },
  iran:         { energy: +0.15, bonds: -0.02, tech: -0.03, commodities: +0.10, international: -0.06, financials: -0.03 },
  russia:       { energy: +0.10, bonds: -0.02, commodities: +0.06, international: -0.08, financials: -0.02 },
  war:          { energy: +0.08, bonds: +0.04, commodities: +0.12, tech: -0.05, international: -0.10, financials: -0.04 },
  sanctions:    { energy: +0.06, international: -0.06, financials: -0.03 },

  // Trade / Tariffs
  tariff:       { tech: -0.08, international: -0.06, commodities: +0.03 },
  "trade war":  { tech: -0.10, international: -0.08, financials: -0.04 },
  china:        { tech: -0.06, international: -0.05 },
  "electric vehicles": { tech: -0.05, energy: +0.04 },

  // Monetary policy
  "interest rates": { bonds: -0.08, tech: -0.10, financials: +0.04, commodities: -0.03 },
  "rate hike":  { bonds: -0.10, tech: -0.12, financials: +0.05, commodities: -0.04 },
  "rate cut":   { bonds: +0.06, tech: +0.08, financials: -0.03, commodities: +0.02 },
  fed:          { bonds: -0.05, tech: -0.06, financials: +0.03 },
  inflation:    { bonds: -0.06, commodities: +0.05, tech: -0.04 },

  // Tech / Earnings
  nvidia:       { tech: +0.08 },
  apple:        { tech: +0.05 },
  semiconductor:{ tech: -0.06 },
  ai:           { tech: +0.07 },
  shortage:     { tech: -0.10 },
  buyback:      { tech: +0.04 },

  // Banking
  bank:         { financials: -0.08, bonds: -0.03 },
  "banking crisis": { financials: -0.15, bonds: -0.05, tech: -0.04 },
  "unrealized losses": { financials: -0.10 },

  // Healthcare
  pandemic:     { healthcare: +0.10, tech: -0.04, international: -0.08, energy: -0.06 },
  virus:        { healthcare: +0.08, international: -0.06 },
  pharma:       { healthcare: +0.06 },

  // Commodities
  gold:         { commodities: +0.08, bonds: +0.02 },
  "safe haven": { commodities: +0.06, bonds: +0.04 },

  // Recession
  recession:    { international: -0.10, financials: -0.06, tech: -0.05, energy: -0.04, bonds: +0.05 },
  gdp:          { international: -0.04, financials: -0.03 },

  // Oil down
  opec:         { energy: -0.10, commodities: -0.05, tech: +0.03, bonds: +0.02 },
  oversupply:   { energy: -0.12, commodities: -0.06 }
};

function keywordFallback(event) {
  const text = `${event.headline} ${event.body || ""} ${(event.keywords || []).join(" ")}`.toLowerCase();
  const sectorImpacts = {};
  const matchedKeywords = [];

  for (const [keyword, impacts] of Object.entries(SECTOR_IMPACT_RULES)) {
    if (text.includes(keyword)) {
      matchedKeywords.push(keyword);
      for (const [sector, impact] of Object.entries(impacts)) {
        sectorImpacts[sector] = (sectorImpacts[sector] || 0) + impact;
      }
    }
  }

  // Sentiment-based amplification/dampening
  if (matchedKeywords.length > 0 && event.raw_sentiment_hint) {
    for (const sector of Object.keys(sectorImpacts)) {
      const impact = sectorImpacts[sector];
      if (event.raw_sentiment_hint === "bearish") {
        sectorImpacts[sector] = impact < 0 ? impact * 1.3 : impact * 0.7;
      } else if (event.raw_sentiment_hint === "bullish") {
        sectorImpacts[sector] = impact > 0 ? impact * 1.3 : impact * 0.7;
      }
    }
  }

  for (const sector of Object.keys(sectorImpacts)) {
    sectorImpacts[sector] = Math.max(-0.40, Math.min(0.40, sectorImpacts[sector]));
  }

  // Compute confidence from keyword match count + category
  let confidence = 50;
  confidence += Math.min(matchedKeywords.length * 10, 30);
  if (event.category === "earnings") confidence += 10;
  if (event.category === "macro") confidence += 5;
  if (event.category === "geopolitical") confidence -= 5;
  if (event.category === "policy") confidence += 8;
  confidence = Math.min(Math.max(confidence, 20), 95);

  return { sector_impacts: sectorImpacts, confidence, matched_keywords: matchedKeywords };
}


/**
 * Analyze a single news event → produce sector impact metrics.
 * Tries ML model first, falls back to keyword rules.
 */
export async function analyzeEvent(event) {
  const description = event.body || "";

  // Try ML model first
  let mlResult = await callMLModel(event.headline, description);
  let source = "ml_model";
  let matchedKeywords = [];

  if (mlResult) {
    // ML succeeded — use its sector impacts and confidence
    console.log(`[ML] ✅ ${event.headline.substring(0, 50)}... → confidence: ${mlResult.confidence}`);
  } else {
    // ML failed — fall back to keyword rules
    console.warn(`[ML] ⚠️  Fallback to keywords for: ${event.headline.substring(0, 50)}...`);
    const fallback = keywordFallback(event);
    mlResult = { sector_impacts: fallback.sector_impacts, confidence: fallback.confidence };
    matchedKeywords = fallback.matched_keywords;
    source = "keyword_fallback";
  }

  const sectorImpacts = mlResult.sector_impacts;
  const confidence = Math.min(Math.max(Math.round(mlResult.confidence), 20), 95);

  // Filter out near-zero impacts (< 0.5%)
  const filteredImpacts = {};
  for (const [sector, val] of Object.entries(sectorImpacts)) {
    if (Math.abs(val) > 0.005) {
      filteredImpacts[sector] = parseFloat(val.toFixed(4));
    }
  }

  // Derive sentiment from net impact
  const netImpact = Object.values(filteredImpacts).reduce((s, v) => s + v, 0);
  let sentiment;
  if (netImpact > 0.05) sentiment = "BULLISH";
  else if (netImpact < -0.05) sentiment = "BEARISH";
  else sentiment = "MIXED";

  // Severity from max absolute impact
  const maxImpact = Math.max(...Object.values(filteredImpacts).map(Math.abs), 0);
  let severity;
  if (maxImpact >= 0.15) severity = "HIGH";
  else if (maxImpact >= 0.08) severity = "MEDIUM";
  else severity = "LOW";

  return {
    event_id: event.event_id,
    headline: event.headline,
    category: event.category,
    sentiment,
    confidence,
    severity,
    sector_impacts: filteredImpacts,
    matched_keywords: matchedKeywords,
    net_impact: parseFloat(netImpact.toFixed(4)),
    source   // "ml_model" or "keyword_fallback"
  };
}


// ══════════════════════════════════════════════════════════════════════
// 2. PORTFOLIO IMPACT CALCULATION (per client)
// ══════════════════════════════════════════════════════════════════════

/**
 * Map sector impacts to a specific client portfolio
 */
export function computePortfolioImpact(client, sectorImpacts, confidence) {
  let totalImpact = 0;
  const holdingImpacts = [];

  for (const [ticker, weight] of Object.entries(client.holdings)) {
    const tickerInfo = TICKERS[ticker];
    if (!tickerInfo) continue;

    const sectorImpact = sectorImpacts[tickerInfo.sector] || 0;
    const holdingImpact = weight * sectorImpact;
    totalImpact += holdingImpact;

    if (Math.abs(sectorImpact) > 0.01) {
      holdingImpacts.push({
        ticker,
        name: tickerInfo.name,
        sector: tickerInfo.sector,
        weight: parseFloat((weight * 100).toFixed(1)),
        sector_impact_pct: parseFloat((sectorImpact * 100).toFixed(2)),
        holding_impact_pct: parseFloat((holdingImpact * 100).toFixed(2)),
        holding_impact_dollar: Math.round(holdingImpact * client.portfolio_value)
      });
    }
  }

  // Confidence-weighted effective impact
  const effectiveImpact = totalImpact * (confidence / 100);

  // Check if impact exceeds risk tolerance threshold
  const threshold = RISK_THRESHOLDS[client.risk_tolerance] || 0.05;
  const exceedsThreshold = Math.abs(effectiveImpact) > threshold;

  return {
    client_id: client.client_id,
    client_name: client.name,
    portfolio_value: client.portfolio_value,
    risk_tolerance: client.risk_tolerance,
    total_impact_pct: parseFloat((totalImpact * 100).toFixed(2)),
    total_impact_dollar: Math.round(totalImpact * client.portfolio_value),
    effective_impact_pct: parseFloat((effectiveImpact * 100).toFixed(2)),
    effective_impact_dollar: Math.round(effectiveImpact * client.portfolio_value),
    exceeds_threshold: exceedsThreshold,
    threshold_pct: parseFloat((threshold * 100).toFixed(1)),
    holding_impacts: holdingImpacts.sort((a, b) => Math.abs(b.holding_impact_pct) - Math.abs(a.holding_impact_pct))
  };
}


// ══════════════════════════════════════════════════════════════════════
// 3. RISK METRICS — VaR, Volatility, Beta, Max Drawdown, Concentration
//    Uses proper financial formulas on simulated daily returns derived
//    from each holding's beta and realistic market volatility.
// ══════════════════════════════════════════════════════════════════════

// ── Deterministic PRNG (reproducible per client) ─────────────────────
function seededRand(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// ── Generate realistic simulated daily returns ───────────────────────
// Uses each holding's beta × market return + idiosyncratic noise.
// Market volatility calibrated to ~16% annualized (realistic S&P).
const MARKET_DAILY_VOL = 0.01;  // ~16% annualized (0.01 * sqrt(252) ≈ 0.159)
const IDIO_DAILY_VOL = 0.008;   // stock-specific noise

function generateMarketReturns(rand, days = 500) {
  return Array.from({ length: days }, () => (rand() - 0.5) * 2 * MARKET_DAILY_VOL);
}

function generatePortfolioReturns(client, days = 500) {
  const rand = seededRand(1337 + client.client_id.charCodeAt(3));
  const mkt = generateMarketReturns(rand, days);

  return Array.from({ length: days }, (_, i) => {
    let r = 0;
    for (const [t, w] of Object.entries(client.holdings)) {
      const beta = TICKERS[t]?.beta || 0;
      r += w * (beta * mkt[i] + (rand() - 0.5) * 2 * IDIO_DAILY_VOL);
    }
    return r;
  });
}

// ── Volatility: annualized std of portfolio returns ──────────────────
//    σ_p = std(daily_returns) × √252
function calculateVolatility(returns) {
  const n = returns.length;
  if (n < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / n;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

// ── Beta: cov(portfolio, market) / var(market) ───────────────────────
function calculateBeta(portfolioReturns, marketReturns) {
  const n = Math.min(portfolioReturns.length, marketReturns.length);
  if (n < 2) return 0;
  const pSlice = portfolioReturns.slice(0, n);
  const mSlice = marketReturns.slice(0, n);
  const pMean = pSlice.reduce((s, r) => s + r, 0) / n;
  const mMean = mSlice.reduce((s, r) => s + r, 0) / n;

  let covariance = 0, marketVariance = 0;
  for (let i = 0; i < n; i++) {
    covariance += (pSlice[i] - pMean) * (mSlice[i] - mMean);
    marketVariance += (mSlice[i] - mMean) ** 2;
  }
  return marketVariance === 0 ? 0 : covariance / marketVariance;
}

// ── Max Drawdown: cumulative peak-to-trough ──────────────────────────
function calculateMaxDrawdown(returns) {
  if (returns.length === 0) return 0;
  let cumulative = 1, peak = 1, maxDD = 0;
  for (const r of returns) {
    cumulative *= (1 + r);
    if (cumulative > peak) peak = cumulative;
    const dd = (cumulative - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;  // negative (e.g. -0.15 = -15%)
}

// ── VaR: historical 5th/1st percentile with linear interpolation ─────
function percentileValue(sorted, p) {
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  const frac = idx - lo;
  return lo === hi ? sorted[lo] : sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// ── Concentration Metrics ────────────────────────────────────────────
function calculateConcentration(client) {
  const weights = Object.values(client.holdings);

  // HHI = sum(w^2) — lower is more diversified
  const hhi = weights.reduce((s, w) => s + w * w, 0);

  // Effective number of assets = 1/HHI
  const effectiveAssets = hhi === 0 ? 0 : 1 / hhi;

  // Top 3 concentration
  const sorted = [...weights].sort((a, b) => b - a);
  const top3 = sorted.slice(0, 3).reduce((s, w) => s + w, 0);

  // Sector breakdown
  const sectorExposure = {};
  for (const [ticker, weight] of Object.entries(client.holdings)) {
    const sec = TICKERS[ticker]?.sector || "other";
    sectorExposure[sec] = (sectorExposure[sec] || 0) + weight;
  }

  return { hhi, effectiveAssets, top3Concentration: top3, sectorExposure };
}

// ── Risk Level: composite of volatility, VaR, drawdown ──────────────
function calculateRiskLevel(volatility, var95Pct, maxDrawdown) {
  let score = 0;
  if (volatility > 0.30) score += 2;
  else if (volatility > 0.20) score += 1;
  if (var95Pct < -0.03) score += 2;
  else if (var95Pct < -0.02) score += 1;
  if (maxDrawdown < -0.25) score += 2;
  else if (maxDrawdown < -0.15) score += 1;
  if (score >= 4) return "HIGH";
  if (score >= 2) return "MEDIUM";
  return "LOW";
}

// ── Risk Drivers: human-readable reasons ─────────────────────────────
function getRiskDrivers(sectorExposure, volatility, beta, top3) {
  const drivers = [];
  for (const [sector, weight] of Object.entries(sectorExposure)) {
    if (weight > 0.30) drivers.push(`High ${sector} concentration (${(weight * 100).toFixed(0)}%)`);
  }
  if (volatility > 0.25) drivers.push("High portfolio volatility");
  if (beta > 1.2) drivers.push("High market sensitivity (beta > 1.2)");
  if (top3 > 0.50) drivers.push("Heavy concentration in top 3 holdings");
  return drivers;
}

function sumObjectValues(obj) {
  return Object.values(obj).reduce((sum, value) => sum + value, 0);
}

function normalizeHoldings(holdings) {
  const entries = Object.entries(holdings || {})
    .map(([ticker, weight]) => [ticker, Number(weight)])
    .filter(([_, weight]) => Number.isFinite(weight) && weight > 0);

  const total = entries.reduce((sum, [_, weight]) => sum + weight, 0);
  if (total <= 0) {
    throw new Error("Proposed holdings must include at least one positive weight");
  }

  return Object.fromEntries(
    entries.map(([ticker, weight]) => [ticker, parseFloat((weight / total).toFixed(6))])
  );
}

function buildPortfolioVariant(client, holdings, label = "Proposed") {
  return {
    ...client,
    name: `${client.name} (${label})`,
    holdings: normalizeHoldings(holdings)
  };
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function randomNormal(rand) {
  const u1 = Math.max(rand(), 1e-9);
  const u2 = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function formatHoldingsForOutput(holdings, portfolioValue = null) {
  return Object.entries(holdings)
    .map(([ticker, weight]) => ({
      ticker,
      sector: TICKERS[ticker]?.sector || "unknown",
      name: TICKERS[ticker]?.name || ticker,
      weight_pct: parseFloat((weight * 100).toFixed(2)),
      value: portfolioValue ? Math.round(weight * portfolioValue) : undefined
    }))
    .sort((a, b) => b.weight_pct - a.weight_pct);
}

function diffSectorExposure(currentExposure, proposedExposure) {
  const sectors = new Set([...Object.keys(currentExposure || {}), ...Object.keys(proposedExposure || {})]);
  return Object.fromEntries(
    [...sectors].sort().map(sector => {
      const current = currentExposure?.[sector] || 0;
      const proposed = proposedExposure?.[sector] || 0;
      return [sector, parseFloat((proposed - current).toFixed(1))];
    })
  );
}

function chooseRecommendationProfile(client, objective = "auto") {
  if (objective && objective !== "auto" && RECOMMENDATION_PROFILES[objective]) {
    return { objective, profile: RECOMMENDATION_PROFILES[objective] };
  }

  if (client.risk_tolerance === "conservative") {
    return { objective: "defensive", profile: RECOMMENDATION_PROFILES.defensive };
  }
  if (client.risk_tolerance === "aggressive") {
    return { objective: "growth", profile: RECOMMENDATION_PROFILES.growth };
  }
  return { objective: "balanced", profile: RECOMMENDATION_PROFILES.balanced };
}

function buildSectorBasedHoldings(client, sectorTargets) {
  const normalizedTargets = normalizeHoldings(sectorTargets);
  const proposed = {};

  for (const [sector, sectorWeight] of Object.entries(normalizedTargets)) {
    if (sectorWeight <= 0) continue;

    const currentTickers = Object.entries(client.holdings)
      .filter(([ticker]) => (TICKERS[ticker]?.sector || "other") === sector)
      .map(([ticker, weight]) => ({ ticker, weight }));

    const distribution = currentTickers.length > 0
      ? currentTickers
      : (DEFAULT_SECTOR_TICKERS[sector] || []).map(ticker => ({ ticker, weight: 1 }));

    const totalWeight = distribution.reduce((sum, item) => sum + item.weight, 0) || distribution.length || 1;
    for (const item of distribution) {
      proposed[item.ticker] = (proposed[item.ticker] || 0) + sectorWeight * (item.weight / totalWeight);
    }
  }

  return normalizeHoldings(proposed);
}

export function runStressTest(client, scenarioKey) {
  const scenario = STRESS_SCENARIOS[scenarioKey];
  if (!scenario) {
    return { error: `Unknown scenario: ${scenarioKey}` };
  }

  let impact = 0;
  const holdingImpacts = [];
  for (const [ticker, weight] of Object.entries(client.holdings)) {
    const sector = TICKERS[ticker]?.sector ?? "cash";
    const shock = scenario.shocks[sector] ?? 0;
    const holdingImpact = weight * shock;
    impact += holdingImpact;

    if (Math.abs(shock) > 0.01) {
      holdingImpacts.push({
        ticker,
        sector,
        weight_pct: parseFloat((weight * 100).toFixed(1)),
        shock_pct: parseFloat((shock * 100).toFixed(1)),
        impact_pct: parseFloat((holdingImpact * 100).toFixed(2)),
        impact_dollar: Math.round(holdingImpact * client.portfolio_value)
      });
    }
  }

  holdingImpacts.sort((a, b) => Math.abs(b.impact_pct) - Math.abs(a.impact_pct));

  return {
    scenario_key: scenarioKey,
    scenario: scenario.name,
    description: scenario.desc,
    total_impact_pct: parseFloat((impact * 100).toFixed(2)),
    total_impact_dollar: Math.round(impact * client.portfolio_value),
    severity: impact < -0.25 ? "SEVERE" : impact < -0.10 ? "HIGH" : impact < -0.05 ? "MEDIUM" : "LOW",
    holding_impacts: holdingImpacts.slice(0, 5)
  };
}

export function runStressTestSuite(client) {
  const scenarios = Object.keys(STRESS_SCENARIOS).map(key => runStressTest(client, key));
  const worstCase = [...scenarios].sort((a, b) => a.total_impact_pct - b.total_impact_pct)[0] || null;
  return {
    scenarios,
    worst_case: worstCase
  };
}

export function runMonteCarloSimulation(client, options = {}) {
  const years = Math.max(1, Math.min(Number(options.years) || Math.min(client.time_horizon_years || 3, 3), 30));
  const paths = Math.max(100, Math.min(Number(options.paths) || 1000, 5000));
  const tradingDays = years * 252;

  const historicalReturns = generatePortfolioReturns(client, 756);
  const dailyMean = mean(historicalReturns);
  const sigma = standardDeviation(historicalReturns);
  const drift = dailyMean - (sigma ** 2) / 2;
  const initialValue = Number(options.initial_value) || client.portfolio_value;
  const rand = seededRand(9000 + client.client_id.charCodeAt(3) + years + paths);

  const terminalValues = [];
  for (let pathIndex = 0; pathIndex < paths; pathIndex++) {
    let portfolioValue = initialValue;
    for (let day = 0; day < tradingDays; day++) {
      const shock = randomNormal(rand);
      portfolioValue *= Math.exp(drift + sigma * shock);
    }
    terminalValues.push(portfolioValue);
  }

  const sorted = [...terminalValues].sort((a, b) => a - b);
  const percentile = p => Math.round(percentileValue(sorted, p));
  const probabilityGain = terminalValues.filter(value => value > initialValue).length / terminalValues.length;
  const expectedTerminalValue = mean(terminalValues);

  return {
    years,
    paths,
    initial_value: Math.round(initialValue),
    expected_terminal_value: Math.round(expectedTerminalValue),
    expected_return_pct: parseFloat((((expectedTerminalValue / initialValue) - 1) * 100).toFixed(2)),
    probability_of_gain_pct: parseFloat((probabilityGain * 100).toFixed(1)),
    percentile_terminal_values: {
      p10: percentile(0.10),
      p25: percentile(0.25),
      p50: percentile(0.50),
      p75: percentile(0.75),
      p90: percentile(0.90)
    },
    downside_loss_pct_p10: parseFloat((((percentile(0.10) / initialValue) - 1) * 100).toFixed(2)),
    upside_gain_pct_p90: parseFloat((((percentile(0.90) / initialValue) - 1) * 100).toFixed(2)),
    assumptions: {
      daily_mean_return: parseFloat(dailyMean.toFixed(6)),
      daily_volatility: parseFloat(sigma.toFixed(6)),
      drift: parseFloat(drift.toFixed(6))
    }
  };
}

export async function comparePortfolioChange(client, proposedHoldings, options = {}) {
  const proposedClient = buildPortfolioVariant(client, proposedHoldings, options.label || "Proposed");

  const [currentRisk, proposedRisk] = await Promise.all([
    computeVaR(client, options.severity || "LOW"),
    computeVaR(proposedClient, options.severity || "LOW")
  ]);

  const monteCarloYears = options.years || Math.min(client.time_horizon_years || 3, 3);
  const monteCarloPaths = options.paths || 1000;
  const currentMonteCarlo = runMonteCarloSimulation(client, { years: monteCarloYears, paths: monteCarloPaths });
  const proposedMonteCarlo = runMonteCarloSimulation(proposedClient, { years: monteCarloYears, paths: monteCarloPaths });

  const improvements = [];
  if (proposedRisk.var_95 < currentRisk.var_95) improvements.push("Lower VaR(95%)");
  if (proposedRisk.volatility_pct < currentRisk.volatility_pct) improvements.push("Lower volatility");
  if (proposedRisk.max_drawdown_pct > currentRisk.max_drawdown_pct) improvements.push("Shallower max drawdown");
  if (proposedMonteCarlo.probability_of_gain_pct > currentMonteCarlo.probability_of_gain_pct) improvements.push("Higher probability of gain");

  return {
    client_id: client.client_id,
    client_name: client.name,
    current_portfolio: {
      holdings: formatHoldingsForOutput(client.holdings, client.portfolio_value),
      risk_metrics: currentRisk,
      monte_carlo: currentMonteCarlo
    },
    proposed_portfolio: {
      holdings: formatHoldingsForOutput(proposedClient.holdings, proposedClient.portfolio_value),
      risk_metrics: proposedRisk,
      monte_carlo: proposedMonteCarlo
    },
    delta: {
      var_95: proposedRisk.var_95 - currentRisk.var_95,
      var_99: proposedRisk.var_99 - currentRisk.var_99,
      volatility_pct: parseFloat((proposedRisk.volatility_pct - currentRisk.volatility_pct).toFixed(2)),
      max_drawdown_pct: parseFloat((proposedRisk.max_drawdown_pct - currentRisk.max_drawdown_pct).toFixed(2)),
      risk_score: parseFloat((proposedRisk.risk_score - currentRisk.risk_score).toFixed(1)),
      top_3_concentration_pct: parseFloat((proposedRisk.top_3_concentration_pct - currentRisk.top_3_concentration_pct).toFixed(1)),
      probability_of_gain_pct: parseFloat((proposedMonteCarlo.probability_of_gain_pct - currentMonteCarlo.probability_of_gain_pct).toFixed(1)),
      expected_return_pct: parseFloat((proposedMonteCarlo.expected_return_pct - currentMonteCarlo.expected_return_pct).toFixed(2)),
      sector_exposure_pct: diffSectorExposure(currentRisk.sector_exposure, proposedRisk.sector_exposure)
    },
    interpretation: {
      risk_improvements: improvements,
      tradeoff: improvements.length >= 2
        ? "Risk profile improves materially with manageable return trade-offs."
        : "Changes are mixed; advisor should balance protection vs upside."
    }
  };
}

export async function generateAllocationRecommendation(client, objective = "auto") {
  const currentConcentration = calculateConcentration(client);
  const { objective: resolvedObjective, profile } = chooseRecommendationProfile(client, objective);
  const proposedHoldings = buildSectorBasedHoldings(client, profile);
  const comparison = await comparePortfolioChange(client, proposedHoldings, {
    label: `Recommended ${resolvedObjective}`,
    years: Math.min(client.time_horizon_years || 3, 3),
    paths: 1000
  });

  const sectorAdjustments = Object.entries(profile)
    .map(([sector, targetWeight]) => {
      const currentWeight = currentConcentration.sectorExposure[sector] || 0;
      return [sector, parseFloat(((targetWeight - currentWeight) * 100).toFixed(1))];
    })
    .filter(([_, delta]) => Math.abs(delta) >= 2)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([sector, delta]) => `${delta > 0 ? "Increase" : "Reduce"} ${sector} by ${Math.abs(delta).toFixed(1)} pts`);

  const holdingChanges = Object.entries(proposedHoldings)
    .map(([ticker, newWeight]) => {
      const currentWeight = client.holdings[ticker] || 0;
      return {
        ticker,
        current_weight_pct: parseFloat((currentWeight * 100).toFixed(2)),
        proposed_weight_pct: parseFloat((newWeight * 100).toFixed(2)),
        delta_pct_points: parseFloat(((newWeight - currentWeight) * 100).toFixed(2))
      };
    })
    .filter(change => Math.abs(change.delta_pct_points) >= 1.5)
    .sort((a, b) => Math.abs(b.delta_pct_points) - Math.abs(a.delta_pct_points));

  return {
    client_id: client.client_id,
    client_name: client.name,
    objective: resolvedObjective,
    rationale: [
      `Recommendation profile aligned to ${resolvedObjective} objective for a ${client.risk_tolerance} client.`,
      ...sectorAdjustments.slice(0, 5)
    ],
    sector_targets_pct: Object.fromEntries(
      Object.entries(profile).map(([sector, weight]) => [sector, parseFloat((weight * 100).toFixed(1))])
    ),
    proposed_holdings: formatHoldingsForOutput(proposedHoldings, client.portfolio_value),
    key_holding_changes: holdingChanges.slice(0, 8),
    comparison
  };
}


/**
 * Compute full risk metrics for a client portfolio.
 * Calls 2 ML models: Volatility/VaR (GARCH) + Risk Scorer, both with fallback.
 * @param {object} client - client object with holdings, portfolio_value, etc.
 * @param {string} [severity="LOW"] - event severity for GARCH model ("LOW"/"MEDIUM"/"HIGH")
 * Returns VaR, CVaR, volatility, beta, max drawdown, concentration, risk level.
 */
export async function computeVaR(client, severity = "LOW") {
  const rand = seededRand(1337 + client.client_id.charCodeAt(3));
  const marketReturns = generateMarketReturns(rand);
  const portfolioReturns = generatePortfolioReturns(client);

  // Concentration (needed by both ML models + risk drivers)
  const concentration = calculateConcentration(client);
  const sectorWeights = RISK_SCORER_SECTORS.map(sec => {
    const raw = concentration.sectorExposure[sec] || 0;
    return parseFloat(raw.toFixed(4));
  });

  // ── Call both ML models in parallel ────────────────────────────────
  const [volResult, riskResult] = await Promise.all([
    callVolatilityML(sectorWeights, client.portfolio_value, "1", severity),
    callRiskScorerML(sectorWeights)
  ]);

  // ── Volatility & VaR: prefer ML (GARCH), fallback to simulated ────
  let var95, var99, cvar95, volatility, volatilityPct, volSource;

  if (volResult) {
    // ML GARCH model returns daily vol% and dollar VaR
    const dailyVol = volResult.vol_pct / 100;  // e.g. 0.767% → 0.00767
    volatility = parseFloat((dailyVol * Math.sqrt(252)).toFixed(4));  // annualized
    volatilityPct = parseFloat((volatility * 100).toFixed(2));
    var95 = Math.round(volResult.var_95);
    var99 = Math.round(volResult.var_99);
    // CVaR ≈ VaR95 × 1.16 (normal approximation for Expected Shortfall)
    cvar95 = Math.round(volResult.var_95 * 1.16);
    volSource = "ml_garch";
    console.log(`[ML] ✅ Volatility ${client.client_id}: vol=${volatilityPct}% VaR95=$${var95} VaR99=$${var99}`);
  } else {
    // Fallback: simulated returns
    const sorted = [...portfolioReturns].sort((a, b) => a - b);
    const var95Pct = percentileValue(sorted, 0.05);
    const var99Pct = percentileValue(sorted, 0.01);
    const i95 = Math.floor(sorted.length * 0.05);
    const tail = sorted.slice(0, i95);

    volatility = parseFloat(calculateVolatility(portfolioReturns).toFixed(4));
    volatilityPct = parseFloat((volatility * 100).toFixed(2));
    var95 = Math.round(-var95Pct * client.portfolio_value);
    var99 = Math.round(-var99Pct * client.portfolio_value);
    cvar95 = tail.length > 0
      ? Math.round(-(tail.reduce((s, r) => s + r, 0) / tail.length) * client.portfolio_value)
      : 0;
    volSource = "simulated_fallback";
    console.warn(`[ML] ⚠️  Volatility fallback for ${client.client_id}`);
  }

  // ── Beta & Drawdown (always from simulated — no ML replacement) ────
  const beta = calculateBeta(portfolioReturns, marketReturns);
  const maxDrawdown = calculateMaxDrawdown(portfolioReturns);
  const riskDrivers = getRiskDrivers(
    concentration.sectorExposure, volatility, beta, concentration.top3Concentration
  );

  // ── Risk Scorer ML: risk_score (0-100) + category ─────────────────
  let riskScore, riskCategory, riskSource;

  if (riskResult) {
    riskScore = riskResult.risk_score;
    riskCategory = riskResult.risk_category;
    riskSource = "ml_model";
    console.log(`[ML] ✅ Risk score ${client.client_id}: ${riskScore} (${riskCategory})`);
  } else {
    const sorted = [...portfolioReturns].sort((a, b) => a - b);
    const var95Pct = percentileValue(sorted, 0.05);
    const riskLevel = calculateRiskLevel(volatility, var95Pct, maxDrawdown);
    riskCategory = riskLevel;
    riskScore = riskLevel === "HIGH" ? 65 : riskLevel === "MEDIUM" ? 40 : 20;
    riskSource = "rule_fallback";
    console.warn(`[ML] ⚠️  Risk scorer fallback for ${client.client_id}: ${riskScore} (${riskCategory})`);
  }

  return {
    var_95: var95,
    var_99: var99,
    cvar_95: cvar95,

    volatility: volatility,
    volatility_pct: volatilityPct,
    vol_source: volSource,
    beta: parseFloat(beta.toFixed(3)),
    max_drawdown_pct: parseFloat((maxDrawdown * 100).toFixed(2)),
    risk_score: riskScore,
    risk_category: riskCategory,
    risk_level: riskCategory,  // backward compat alias
    risk_source: riskSource,
    risk_drivers: riskDrivers,

    hhi: parseFloat(concentration.hhi.toFixed(4)),
    effective_assets: parseFloat(concentration.effectiveAssets.toFixed(1)),
    top_3_concentration_pct: parseFloat((concentration.top3Concentration * 100).toFixed(1)),
    sector_exposure: Object.fromEntries(
      Object.entries(concentration.sectorExposure).map(([k, v]) => [k, parseFloat((v * 100).toFixed(1))])
    )
  };
}


// ══════════════════════════════════════════════════════════════════════
// 4. QUANT AGGREGATION LAYER
//    Combines per-event sector impacts into realistic aggregated signals.
//    Handles: diminishing returns, regime detection, conflict resolution, caps.
// ══════════════════════════════════════════════════════════════════════

// Realistic single-batch sector caps (no sector moves >15% from 3-4 news items)
const SECTOR_CAPS = {
  tech: 0.15, financials: 0.15, energy: 0.18, healthcare: 0.12,
  bonds: 0.08, commodities: 0.12, international: 0.12, cash: 0.01
};

// Macro regime definitions — when a regime is dominant, it overrides conflicting signals
const MACRO_REGIMES = {
  risk_off: {
    // In risk-off: bonds UP, gold UP, equities DOWN
    triggers: ["war", "recession", "banking crisis", "pandemic", "virus", "geopolitical risk"],
    overrides: { bonds: "positive", commodities: "positive", cash: "positive" }
  },
  rate_tightening: {
    // Rate hikes: bonds DOWN, tech DOWN, financials UP
    triggers: ["rate hike", "interest rates", "inflation"],
    overrides: { financials: "positive" }
  },
  rate_easing: {
    // Rate cuts: bonds UP, tech UP, financials DOWN
    triggers: ["rate cut"],
    overrides: { bonds: "positive", tech: "positive" }
  },
  energy_shock: {
    // Oil supply disruption: energy UP, everything else pressured
    triggers: ["oil", "opec", "crude", "sanctions"],
    overrides: { energy: "preserve_direction" }
  }
};

/**
 * Detect the dominant macro regime from event keywords
 */
function detectRegime(eventMetrics) {
  const allKeywords = eventMetrics.flatMap(em => em.matched_keywords);
  const regimeScores = {};

  for (const [regime, config] of Object.entries(MACRO_REGIMES)) {
    const matchCount = config.triggers.filter(t => allKeywords.includes(t)).length;
    if (matchCount > 0) {
      regimeScores[regime] = matchCount;
    }
  }

  // Return the regime with the most trigger matches, or null
  const entries = Object.entries(regimeScores).sort((a, b) => b[1] - a[1]);
  return entries.length > 0 ? { name: entries[0][0], strength: entries[0][1], all: regimeScores } : null;
}

/**
 * Dampened aggregation — diminishing returns for correlated signals.
 * Uses signed square-root scaling: sign(sum) * sqrt(|sum|) * scale_factor
 * This means: first signal has full weight, additional signals add less and less.
 */
function dampenedSum(values) {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  // Weight by confidence: higher confidence events contribute more
  const sum = values.reduce((s, v) => s + v, 0);
  const absSum = Math.abs(sum);

  // Square-root dampening: compresses multiple correlated signals
  // Scale factor calibrated so a single event passes through ~unchanged
  // but 3+ correlated events compress significantly
  const dampened = Math.sign(sum) * Math.sqrt(absSum) * 0.7;

  // Never exceed the simple average * 1.5 (prevents any explosion)
  const avg = sum / values.length;
  const maxAllowed = Math.abs(avg) * 1.8;

  if (Math.abs(dampened) > maxAllowed) {
    return Math.sign(dampened) * maxAllowed;
  }

  return dampened;
}

/**
 * Main aggregation function: combines per-event sector impacts into
 * realistic aggregated sector-level signals.
 */
function aggregateSectorImpacts(eventMetrics) {
  // Step 1: Collect all per-event impacts by sector
  const sectorSignals = {};  // sector → [impact1, impact2, ...]
  for (const em of eventMetrics) {
    for (const [sector, impact] of Object.entries(em.sector_impacts)) {
      if (!sectorSignals[sector]) sectorSignals[sector] = [];
      sectorSignals[sector].push({
        value: impact,
        confidence: em.confidence,
        category: em.category
      });
    }
  }

  // Step 2: Detect dominant macro regime
  const regime = detectRegime(eventMetrics);
  if (regime) {
    console.log(`[Analytics] Detected regime: ${regime.name} (strength: ${regime.strength})`);
  }

  // Step 3: Aggregate each sector with dampening
  const result = {};
  for (const [sector, signals] of Object.entries(sectorSignals)) {
    // Confidence-weighted values
    const weightedValues = signals.map(s => s.value * (s.confidence / 100));

    // Apply dampened aggregation (diminishing returns)
    let aggregated = dampenedSum(weightedValues);

    // Step 4: Regime-based conflict resolution
    if (regime) {
      const regimeConfig = MACRO_REGIMES[regime.name];
      const override = regimeConfig?.overrides?.[sector];

      if (override === "positive" && aggregated < 0) {
        // Regime says this sector should be positive, but signals say negative
        // Resolve: flip to positive but at reduced magnitude (regime wins with dampening)
        aggregated = Math.abs(aggregated) * 0.5;
        console.log(`[Analytics] Regime override: ${sector} flipped to +${(aggregated * 100).toFixed(1)}% (${regime.name} regime)`);
      } else if (override === "negative" && aggregated > 0) {
        aggregated = -Math.abs(aggregated) * 0.5;
      }
      // "preserve_direction" means don't override, just let it through
    }

    // Step 5: Apply realistic sector caps
    const cap = SECTOR_CAPS[sector] || 0.15;
    aggregated = Math.max(-cap, Math.min(cap, aggregated));

    result[sector] = parseFloat(aggregated.toFixed(4));
  }

  return result;
}


// ══════════════════════════════════════════════════════════════════════
// 5. FULL PIPELINE: Analyze a batch of events
// ══════════════════════════════════════════════════════════════════════

/**
 * Run the full analytics pipeline on a batch of news events.
 * Returns structured metrics ready for the AI agent.
 */
export async function runAnalytics(newsEvents) {
  console.log(`\n[Analytics] Processing ${newsEvents.length} events...`);

  // 1. Classify via ML model (parallel calls to HF Spaces)
  const eventMetrics = await Promise.all(newsEvents.map(event => analyzeEvent(event)));
  const mlCount = eventMetrics.filter(e => e.source === "ml_model").length;
  const fbCount = eventMetrics.filter(e => e.source === "keyword_fallback").length;
  console.log(`[Analytics] Event classification complete (${mlCount} ML, ${fbCount} fallback)`);

  // 2. Aggregate sector impacts using quant-grade normalization
  //    (NOT simple addition — that causes unrealistic explosions)
  const aggregatedSectorImpacts = aggregateSectorImpacts(eventMetrics);

  // 3. Compute per-client portfolio impacts
  const avgConfidence = eventMetrics.reduce((s, e) => s + e.confidence, 0) / eventMetrics.length;

  // Determine dominant event severity for GARCH volatility model
  const highCount = eventMetrics.filter(e => e.severity === "HIGH").length;
  const medCount = eventMetrics.filter(e => e.severity === "MEDIUM").length;
  const dominantSeverity = highCount > 0 ? "HIGH" : medCount > 0 ? "MEDIUM" : "LOW";

  const clientImpacts = await Promise.all(CLIENTS.map(async client => {
    const varMetrics = await computeVaR(client, dominantSeverity);
    const stressTests = runStressTestSuite(client);
    const monteCarlo = runMonteCarloSimulation(client, {
      years: Math.min(client.time_horizon_years || 3, 3),
      paths: 1000
    });

    return {
      ...computePortfolioImpact(client, aggregatedSectorImpacts, avgConfidence),
      var_metrics: varMetrics,
      stress_tests: stressTests,
      monte_carlo: monteCarlo
    };
  }));

  // Sort by absolute impact (most affected first)
  clientImpacts.sort((a, b) => Math.abs(b.total_impact_pct) - Math.abs(a.total_impact_pct));

  // 4. Determine which clients need alerts
  const alertCandidates = clientImpacts.filter(ci => ci.exceeds_threshold);

  const result = {
    batch_timestamp: new Date().toISOString(),
    event_count: newsEvents.length,
    event_metrics: eventMetrics,
    aggregated_sector_impacts: aggregatedSectorImpacts,
    avg_confidence: parseFloat(avgConfidence.toFixed(1)),
    client_impacts: clientImpacts,
    alert_candidates: alertCandidates.map(c => c.client_id),
    summary: {
      total_events: newsEvents.length,
      high_severity: eventMetrics.filter(e => e.severity === "HIGH").length,
      medium_severity: eventMetrics.filter(e => e.severity === "MEDIUM").length,
      low_severity: eventMetrics.filter(e => e.severity === "LOW").length,
      clients_at_risk: alertCandidates.length,
      most_affected_sector: Object.entries(aggregatedSectorImpacts)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0] || ["none", 0]
    }
  };

  console.log(`[Analytics] Pipeline complete:`);
  console.log(`  Events: ${result.event_count} (${result.summary.high_severity} HIGH, ${result.summary.medium_severity} MED)`);
  console.log(`  Clients at risk: ${result.summary.clients_at_risk}`);
  console.log(`  Most affected sector: ${result.summary.most_affected_sector[0]} (${(result.summary.most_affected_sector[1] * 100).toFixed(1)}%)`);

  return result;
}
