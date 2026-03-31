// ── Analytics Engine ──────────────────────────────────────────────────
// ML models + quant layers that analyze incoming news events.
// Produces structured metrics: sector impacts, confidence, severity, VaR, stress tests.
// These metrics get fed to the AI agent.

import { CLIENTS, TICKERS, SECTORS, RISK_THRESHOLDS } from "./data/sample_data.js";

// ══════════════════════════════════════════════════════════════════════
// 1. EVENT CLASSIFICATION + SECTOR IMPACT ESTIMATION
// ══════════════════════════════════════════════════════════════════════

// Keyword → sector impact mappings (simulates ML event impact classifier)
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

// Confidence mapping by category + keyword match count
function computeConfidence(event, matchedKeywords) {
  let base = 50;
  // More keyword matches → higher confidence
  base += Math.min(matchedKeywords.length * 10, 30);
  // Category adjustments
  if (event.category === "earnings") base += 10;   // Earnings are concrete
  if (event.category === "macro") base += 5;
  if (event.category === "geopolitical") base -= 5; // More uncertain
  if (event.category === "policy") base += 8;
  // Cap at 95
  return Math.min(Math.max(base, 20), 95);
}

/**
 * Analyze a single news event → produce sector impact metrics
 */
export function analyzeEvent(event) {
  const text = `${event.headline} ${event.body} ${event.keywords.join(" ")}`.toLowerCase();
  const sectorImpacts = {};
  const matchedKeywords = [];

  // Match keywords and accumulate sector impacts
  for (const [keyword, impacts] of Object.entries(SECTOR_IMPACT_RULES)) {
    if (text.includes(keyword)) {
      matchedKeywords.push(keyword);
      for (const [sector, impact] of Object.entries(impacts)) {
        sectorImpacts[sector] = (sectorImpacts[sector] || 0) + impact;
      }
    }
  }

  // Handle bearish hints by flipping positive impacts
  if (event.raw_sentiment_hint === "bearish" && matchedKeywords.length > 0) {
    for (const sector of Object.keys(sectorImpacts)) {
      // Only amplify negative, don't flip
    }
  }

  // Clamp impacts to reasonable range
  for (const sector of Object.keys(sectorImpacts)) {
    sectorImpacts[sector] = Math.max(-0.40, Math.min(0.40, sectorImpacts[sector]));
  }

  const confidence = computeConfidence(event, matchedKeywords);

  // Determine overall sentiment from net impact
  const netImpact = Object.values(sectorImpacts).reduce((s, v) => s + v, 0);
  let sentiment;
  if (netImpact > 0.05) sentiment = "BULLISH";
  else if (netImpact < -0.05) sentiment = "BEARISH";
  else sentiment = "MIXED";

  // Severity based on max absolute impact
  const maxImpact = Math.max(...Object.values(sectorImpacts).map(Math.abs), 0);
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
    sector_impacts: sectorImpacts,
    matched_keywords: matchedKeywords,
    net_impact: parseFloat(netImpact.toFixed(4))
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
// 3. VaR CALCULATION
// ══════════════════════════════════════════════════════════════════════

function seededRand(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function generatePortfolioReturns(client, days = 500) {
  const rand = seededRand(1337 + client.client_id.charCodeAt(3));
  const mkt = Array.from({ length: days }, () => (rand() - 0.5) * 0.018);
  return Array.from({ length: days }, (_, i) => {
    let r = 0;
    for (const [t, w] of Object.entries(client.holdings)) {
      const beta = TICKERS[t]?.beta || 0;
      r += w * (beta * mkt[i] + (rand() - 0.5) * 0.012);
    }
    return r;
  });
}

export function computeVaR(client) {
  const returns = generatePortfolioReturns(client);
  const sorted = [...returns].sort((a, b) => a - b);
  const n = sorted.length;
  const i95 = Math.floor(n * 0.05);
  const i99 = Math.floor(n * 0.01);
  const tail = sorted.slice(0, i95);
  const cvar = tail.length
    ? -(tail.reduce((s, r) => s + r, 0) / tail.length) * client.portfolio_value
    : 0;

  return {
    var_95: Math.round(-sorted[i95] * client.portfolio_value),
    var_99: Math.round(-sorted[i99] * client.portfolio_value),
    cvar_95: Math.round(cvar),
    worst_day_pct: parseFloat((sorted[0] * 100).toFixed(2)),
    worst_day_dollar: Math.round(sorted[0] * client.portfolio_value)
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
export function runAnalytics(newsEvents) {
  console.log(`\n[Analytics] Processing ${newsEvents.length} events...`);

  // 1. Classify and compute sector impacts for each event
  const eventMetrics = newsEvents.map(event => analyzeEvent(event));
  console.log(`[Analytics] Event classification complete`);

  // 2. Aggregate sector impacts using quant-grade normalization
  //    (NOT simple addition — that causes unrealistic explosions)
  const aggregatedSectorImpacts = aggregateSectorImpacts(eventMetrics);

  // 3. Compute per-client portfolio impacts
  const avgConfidence = eventMetrics.reduce((s, e) => s + e.confidence, 0) / eventMetrics.length;
  const clientImpacts = CLIENTS.map(client => ({
    ...computePortfolioImpact(client, aggregatedSectorImpacts, avgConfidence),
    var_metrics: computeVaR(client)
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
