// ── News Ingestion Module ─────────────────────────────────────────────
// Two modes controlled by USE_LIVE_NEWS env variable:
//   OFF (default) → uses static NEWS_POOL sample data
//   ON            → fetches real news from the Server API (localhost:3002)

import { v4Ish } from "./utils.js";

// ── Live News Fetch (Server API) ──────────────────────────────────────

const SERVER_BASE_URL = process.env.SERVER_BASE_URL || "http://localhost:3002";

/**
 * Infer a category from the article's category array and keywords.
 * Maps the Server schema categories to agent categories
 * (earnings, macro, geopolitical, policy, sector).
 */
function inferCategory(article) {
  const cats = (article.category || []).map(c => c.toLowerCase());
  const kws  = (article.keywords || []).map(k => k.toLowerCase());
  const title = (article.title || "").toLowerCase();
  const all  = [...cats, ...kws, title].join(" ");

  if (/earnings|revenue|profit|quarterly|eps|13f|institutional/i.test(all)) return "earnings";
  if (/fed|gdp|inflation|cpi|rate|treasury|macro|economic/i.test(all))       return "macro";
  if (/war|sanction|tariff|geopolit|invasion|military|nato/i.test(all))      return "geopolitical";
  if (/regulation|policy|ban|law|legislation|government|bill/i.test(all))    return "policy";
  return "sector"; // generic fallback
}

/**
 * Infer a rough sentiment hint from headline & description keywords.
 * Returns "bearish", "bullish", or "neutral".
 */
function inferSentiment(article) {
  const text = `${article.title || ""} ${article.description || ""}`.toLowerCase();
  const bearishWords = ["crash","fall","drop","decline","loss","miss","slash","cut","warn","plunge","tumble","fear","risk","downturn","recession","layoff","bankrupt"];
  const bullishWords = ["surge","rally","gain","jump","beat","soar","boost","record","breakthrough","upgrade","bull","growth","profit","optimistic","rise"];

  let score = 0;
  bearishWords.forEach(w => { if (text.includes(w)) score--; });
  bullishWords.forEach(w => { if (text.includes(w)) score++; });

  if (score <= -1) return "bearish";
  if (score >=  1) return "bullish";
  return "neutral";
}

/**
 * Infer regions from the article's country array.
 */
function inferRegions(article) {
  const countries = (article.country || []).map(c => c.toLowerCase());
  const regions = [];
  if (countries.some(c => c.includes("united states")))        regions.push("us");
  if (countries.some(c => c.includes("china")))                 regions.push("china", "asia");
  if (countries.some(c => c.includes("india")))                 regions.push("india", "asia");
  if (countries.some(c => c.includes("japan") || c.includes("korea") || c.includes("taiwan"))) regions.push("asia");
  if (countries.some(c => c.includes("germany") || c.includes("france") || c.includes("united kingdom"))) regions.push("europe");
  if (countries.some(c => c.includes("saudi") || c.includes("iran") || c.includes("iraq")))   regions.push("middle_east");
  if (countries.some(c => c.includes("russia")))                regions.push("russia");
  if (regions.length === 0) regions.push("global");
  return [...new Set(regions)];
}

/**
 * Convert a Server API article to the agent's news event format.
 */
function mapArticleToAgentEvent(article, batchId, index) {
  return {
    event_id:           `${batchId}_${index}`,
    batch_id:           batchId,
    timestamp:          article.pubDate || new Date().toISOString(),
    headline:           article.title || "Untitled",
    body:               article.description || "",
    category:           inferCategory(article),
    source:             article.source_name || article.source_id || "Unknown",
    raw_sentiment_hint: inferSentiment(article),
    regions:            inferRegions(article),
    keywords:           article.keywords || [],
    // Metadata from the live article (kept for traceability)
    _live:              true,
    _article_id:        article.article_id,
    _link:              article.link,
    _source_url:        article.source_url,
  };
}

/**
 * Fetch `count` real news articles from the Server API and map them
 * to the agent's expected news event format.
 * Falls back to sample data if the Server is unreachable.
 */
export async function fetchLiveNewsBatch(count = 3) {
  const batchId = `live_${Date.now()}`;
  const url = `${SERVER_BASE_URL}/api/news?q=stock+market&language=en&size=${count}`;

  console.log(`[News] Fetching ${count} live articles from Server → ${url}`);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!res.ok) {
      throw new Error(`Server responded ${res.status}: ${await res.text()}`);
    }

    const json = await res.json();
    const articles = json?.data?.articles ?? [];

    if (articles.length === 0) {
      console.warn("[News] Server returned 0 articles — falling back to sample data");
      return fetchNewsBatch(count);
    }

    const events = articles.slice(0, count).map((a, i) => mapArticleToAgentEvent(a, batchId, i));
    console.log(`[News] ✅ Got ${events.length} live events:`);
    events.forEach(e => console.log(`  → ${e.headline.substring(0, 80)}`));
    return events;

  } catch (err) {
    console.error(`[News] ❌ Live fetch failed: ${err.message}`);
    console.warn("[News] Falling back to sample data...");
    return fetchNewsBatch(count);
  }
}

// Preset news pools — the pipeline picks a random subset each run
const NEWS_POOL = [
  {
    headline: "China invades Taiwan — US deploys carrier strike groups to the Pacific",
    body: "China launched amphibious operations on Taiwan's western coast. The US activated NATO Article 5 discussions and deployed three carrier strike groups. Global semiconductor supply faces existential risk as TSMC halts production. Markets entered circuit-breaker territory.",
    category: "geopolitical",
    source: "Reuters",
    raw_sentiment_hint: "bearish",
    regions: ["asia", "us", "global"],
    keywords: ["china", "war", "semiconductor", "geopolitical risk", "trade war"]
  },
  {
    headline: "JPMorgan CEO warns of 'financial hurricane' — pulls back on lending",
    body: "Jamie Dimon warned of an unprecedented combination of inflation, rate uncertainty, and geopolitical risk. JPMorgan announced a 20% reduction in new lending and increased loan loss reserves by $3.8B. Other major banks followed suit.",
    category: "earnings",
    source: "CNBC",
    raw_sentiment_hint: "bearish",
    regions: ["us"],
    keywords: ["bank", "financials", "banking crisis", "recession"]
  },
  {
    headline: "US Treasury yields invert to -85bps, deepest inversion since 1981",
    body: "The 2Y/10Y Treasury spread hit -85 basis points, signaling extreme recession expectations. Bond markets are pricing in 200bps of Fed cuts by year-end. Long-duration bonds rallied sharply.",
    category: "macro",
    source: "Bloomberg",
    raw_sentiment_hint: "bearish",
    regions: ["us"],
    keywords: ["bonds", "interest rates", "recession", "fed", "inflation"]
  },
  {
    headline: "Pfizer announces breakthrough weight-loss drug with 30% efficacy, stock surges 22%",
    body: "Pfizer's Phase 3 trial showed its oral GLP-1 drug achieved 30% weight loss — double the current standard. Analysts project $40B annual revenue. Competitor Eli Lilly fell 8%.",
    category: "earnings",
    source: "FDA Press Release",
    raw_sentiment_hint: "bullish",
    regions: ["us", "global"],
    keywords: ["pharma", "healthcare"]
  },
  {
    headline: "India bans all crude oil imports from Russia, realigns with Western sanctions",
    body: "India announced an immediate ban on Russian crude imports, reversing its discount-buying strategy. Brent crude surged to $112/barrel on supply fears. Indian refiners face 18% margin compression.",
    category: "geopolitical",
    source: "Economic Times",
    raw_sentiment_hint: "mixed",
    regions: ["india", "russia", "global"],
    keywords: ["oil", "russia", "sanctions", "crude", "energy", "geopolitical"]
  },
  {
    headline: "Microsoft cloud division reports 45% revenue miss, AI spending questioned",
    body: "Microsoft Azure revenue grew only 12% vs 22% expected. CEO Nadella admitted AI workloads are taking longer to monetize. The entire tech sector sold off 4% in sympathy. Questions mount over $200B industry AI capex.",
    category: "earnings",
    source: "Microsoft Earnings",
    raw_sentiment_hint: "bearish",
    regions: ["us"],
    keywords: ["tech", "ai", "semiconductor", "shortage"]
  },
  {
    headline: "Federal Reserve emergency rate cut of 75bps after market crash",
    body: "The Fed held an emergency meeting and slashed rates by 75 basis points to 4.50-4.75%. Chair Powell cited 'rapidly deteriorating financial conditions.' Stocks initially rebounded 3% before selling off again on recession fears.",
    category: "macro",
    source: "Federal Reserve",
    raw_sentiment_hint: "mixed",
    regions: ["us"],
    keywords: ["fed", "rate cut", "interest rates", "recession"]
  },
  {
    headline: "Saudi Arabia cuts oil production by 3M barrels/day in retaliation to price caps",
    body: "Saudi Arabia announced the largest single production cut in OPEC history, removing 3M barrels/day from global supply. Oil spiked 20% to $118. Gasoline futures hit record highs. Energy companies rallied 12%.",
    category: "geopolitical",
    source: "OPEC",
    raw_sentiment_hint: "mixed",
    regions: ["middle_east", "global"],
    keywords: ["oil", "opec", "energy", "crude", "sanctions", "geopolitical risk"]
  },
  {
    headline: "Gold breaks $3,200 as dollar index crashes to 2-year low",
    body: "Gold surged past $3,200/oz as the US dollar index fell below 96 for the first time in 2 years. Central banks globally are dumping dollar reserves. Bitcoin also rallied to $95K as alternative stores of value surge.",
    category: "macro",
    source: "World Gold Council",
    raw_sentiment_hint: "bullish",
    regions: ["global"],
    keywords: ["gold", "commodities", "safe haven", "dollar weakness"]
  },
  {
    headline: "Germany enters depression — industrial output collapses 8% in single quarter",
    body: "German industrial production plunged 8% QoQ, the worst since reunification. Auto exports fell 22% as Chinese competition intensifies. Eurozone PMI hit 42.1 — deep contraction territory. DAX fell 6%.",
    category: "macro",
    source: "German Federal Statistics",
    raw_sentiment_hint: "bearish",
    regions: ["europe"],
    keywords: ["europe", "recession", "gdp", "international"]
  },
  {
    headline: "US imposes 100% tariff on all Chinese tech imports including components",
    body: "In an escalation of trade tensions, the US imposed a blanket 100% tariff on all Chinese technology imports including components, PCBs, and rare earth processed materials. Apple warned of 35% cost increases. Semiconductor supply chains face total restructuring.",
    category: "policy",
    source: "White House",
    raw_sentiment_hint: "bearish",
    regions: ["us", "china"],
    keywords: ["tariff", "china", "trade war", "tech", "semiconductor", "apple"]
  },
  {
    headline: "ExxonMobil discovers massive 15B barrel oil field in Guyana, stock jumps 8%",
    body: "ExxonMobil announced a 15-billion-barrel proven reserve discovery in Guyana's Stabroek block, the largest find in 30 years. Production could add 1.5M barrels/day by 2028, reshaping global supply dynamics.",
    category: "earnings",
    source: "ExxonMobil Press Release",
    raw_sentiment_hint: "bullish",
    regions: ["us", "south_america"],
    keywords: ["oil", "energy", "crude"]
  }
];

/**
 * Simulate fetching a batch of news.
 * In production: call a news API, deduplicate, return new items.
 * For hackathon: pick 2-4 random events from the pool.
 */
export function fetchNewsBatch(count = 3) {
  const batchId = `batch_${Date.now()}`;
  const shuffled = [...NEWS_POOL].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(count, shuffled.length));

  return selected.map((item, i) => ({
    event_id: `${batchId}_${i}`,
    batch_id: batchId,
    timestamp: new Date().toISOString(),
    ...item
  }));
}

/**
 * Fetch specific events by type (for testing)
 */
export function fetchSpecificEvents(keywords) {
  const batchId = `batch_${Date.now()}`;
  const matched = NEWS_POOL.filter(item =>
    keywords.some(kw => item.keywords.some(k => k.includes(kw.toLowerCase())))
  );
  return matched.map((item, i) => ({
    event_id: `${batchId}_${i}`,
    batch_id: batchId,
    timestamp: new Date().toISOString(),
    ...item
  }));
}

export { NEWS_POOL };

/**
 * Check if live news mode is enabled.
 * Reads USE_LIVE_NEWS from environment — "ON" means live, anything else means sample.
 */
export function isLiveNewsEnabled() {
  return (process.env.USE_LIVE_NEWS || "").toUpperCase() === "ON";
}

/**
 * Smart fetch — reads the USE_LIVE_NEWS env variable and picks the right source.
 * ON  → fetchLiveNewsBatch (Server API)
 * OFF → fetchNewsBatch     (sample data)
 */
export async function fetchNews(count = 3) {
  if (isLiveNewsEnabled()) {
    console.log("[News] 🔴 LIVE mode enabled (USE_LIVE_NEWS=ON) — fetching from Server API");
    return fetchLiveNewsBatch(count);
  }
  console.log("[News] 🟡 SAMPLE mode (USE_LIVE_NEWS=OFF) — using static news pool");
  return fetchNewsBatch(count);
}
