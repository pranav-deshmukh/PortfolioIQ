import PortfolioModel from "../models/portfolio.model";
import MacroDataModel from "../models/macroData.model";
import NewsEventModel from "../models/newsEvent.model";
import { fetchNewsData } from "./newsData-api.service";
import { MacroAPIService } from "./macroData-api.service";
import { MarketDataAPIService } from "./marketData-api.service";
import { connectDB } from "./portfolioDb.service";

interface SyncSummary {
  portfoliosUpdated: number;
  holdingsUpdated: number;
  purchasePriceBackfilled: number;
  latestPricesFetched: number;
  newsEventsStored: number;
  newsEventsSaved: Record<string, unknown>[];
  macroSaved: boolean;
  timestamp: string;
}

const MIN_UNIQUE_NEWS_ARTICLES = 10;
const NEWS_FETCH_SIZE_PER_TOPIC = 5;
const MAX_NEWS_FETCH_ROUNDS = 8;

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return [];
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// ── Article dedup helpers ─────────────────────────────────────────────

function getArticleUniqKey(article: Record<string, unknown>): string | undefined {
  const articleId = asOptionalString(article.article_id);
  const link = asOptionalString(article.link);
  const title = asOptionalString(article.title);
  const pubDate = asOptionalString(article.pubDate);

  if (articleId) return `aid:${articleId}`;
  if (link) return `link:${link}`;
  if (title && pubDate) return `title:${title}|date:${pubDate}`;
  return undefined;
}

function getArticleMongoFilter(article: Record<string, unknown>) {
  const articleId = asOptionalString(article.article_id);
  const link = asOptionalString(article.link);
  const title = asOptionalString(article.title);

  if (articleId) return { _article_id: articleId };
  if (link) return { _link: link };
  return { headline: title };
}

// ── News article → agent-compatible event transformation ──────────────

function inferCategory(article: Record<string, unknown>): string {
  const cats = asStringArray(article.category).map((c) => c.toLowerCase());
  const kws = asStringArray(article.keywords).map((k) => k.toLowerCase());
  const title = (asOptionalString(article.title) || "").toLowerCase();
  const all = [...cats, ...kws, title].join(" ");

  if (/earnings|revenue|profit|quarterly|eps|13f|institutional/i.test(all)) return "earnings";
  if (/fed|gdp|inflation|cpi|rate|treasury|macro|economic/i.test(all)) return "macro";
  if (/war|sanction|tariff|geopolit|invasion|military|nato/i.test(all)) return "geopolitical";
  if (/regulation|policy|ban|law|legislation|government|bill/i.test(all)) return "policy";
  return "sector";
}

function inferSentiment(article: Record<string, unknown>): string {
  const text = `${asOptionalString(article.title) || ""} ${asOptionalString(article.description) || ""}`.toLowerCase();
  const bearish = ["crash","fall","drop","decline","loss","miss","slash","cut","warn","plunge","tumble","fear","risk","downturn","recession","layoff","bankrupt"];
  const bullish = ["surge","rally","gain","jump","beat","soar","boost","record","breakthrough","upgrade","bull","growth","profit","optimistic","rise"];

  let score = 0;
  for (const w of bearish) { if (text.includes(w)) score--; }
  for (const w of bullish) { if (text.includes(w)) score++; }

  if (score <= -1) return "bearish";
  if (score >= 1) return "bullish";
  return "neutral";
}

function inferRegions(article: Record<string, unknown>): string[] {
  const countries = asStringArray(article.country).map((c) => c.toLowerCase());
  const regions: string[] = [];
  if (countries.some((c) => c.includes("united states"))) regions.push("us");
  if (countries.some((c) => c.includes("china"))) regions.push("china", "asia");
  if (countries.some((c) => c.includes("india"))) regions.push("india", "asia");
  if (countries.some((c) => c.includes("japan") || c.includes("korea") || c.includes("taiwan"))) regions.push("asia");
  if (countries.some((c) => c.includes("germany") || c.includes("france") || c.includes("united kingdom"))) regions.push("europe");
  if (countries.some((c) => c.includes("saudi") || c.includes("iran") || c.includes("iraq"))) regions.push("middle_east");
  if (countries.some((c) => c.includes("russia"))) regions.push("russia");
  if (regions.length === 0) regions.push("global");
  return [...new Set(regions)];
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function mapArticleToNewsEvent(
  article: Record<string, unknown>,
  batchId: string,
  index: number,
  fetchedAt: Date
) {
  const pubDate = asOptionalString(article.pubDate);
  const timestamp = pubDate
    ? formatTimestamp(new Date(pubDate))
    : formatTimestamp(fetchedAt);

  return {
    event_id: `${batchId}_${index}`,
    batch_id: batchId,
    timestamp,
    headline: asOptionalString(article.title) || "Untitled",
    body: asOptionalString(article.description) || asOptionalString(article.title) || "",
    category: inferCategory(article),
    source: asOptionalString(article.source_name) || asOptionalString(article.source_id) || "Unknown",
    raw_sentiment_hint: inferSentiment(article),
    regions: inferRegions(article),
    keywords: asStringArray(article.keywords),
    _live: true,
    _article_id: asOptionalString(article.article_id),
    _link: asOptionalString(article.link),
    _source_url: asOptionalString(article.source_url),
    fetched_at: fetchedAt,
  };
}

export async function runFullDataSync(): Promise<SyncSummary> {
  await connectDB();

  const marketService = new MarketDataAPIService();
  const macroService = new MacroAPIService();

  // 1) Fetch + store macro data in `macro_data`
  const macroInsights = await macroService.getMacroInsights();
  await MacroDataModel.create({
    macro_insights: macroInsights.macro_insights,
    fetched_at: new Date(),
  });

  // 2) Fetch + store news in `news_events`
  const newsTopics = ["tech", "energy", "commodities", "market", "ai"] as const;

  const topicState = new Map<string, { page?: string; exhausted: boolean }>(
    newsTopics.map((topic) => [topic, { exhausted: false }])
  );

  const selectedUniqueNewArticles = new Map<string, Record<string, unknown>>();
  const seenFetchedKeys = new Set<string>();
  const knownExistingKeys = new Set<string>();

  for (let round = 0; round < MAX_NEWS_FETCH_ROUNDS; round += 1) {
    if (selectedUniqueNewArticles.size >= MIN_UNIQUE_NEWS_ARTICLES) {
      break;
    }

    const activeTopics = newsTopics.filter((topic) => !topicState.get(topic)?.exhausted);
    if (activeTopics.length === 0) {
      break;
    }

    const topicPayloads = await Promise.all(
      activeTopics.map(async (topic) => {
        const state = topicState.get(topic);

        const payload = await fetchNewsData({
          q: topic,
          language: "en",
          country: "us",
          size: NEWS_FETCH_SIZE_PER_TOPIC,
          page: state?.page,
        });

        return { topic, payload };
      })
    );

    for (const { topic, payload } of topicPayloads) {
      const results = Array.isArray(payload?.results)
        ? (payload.results as Record<string, unknown>[])
        : [];

      const pendingCandidates = new Map<string, Record<string, unknown>>();

      for (const article of results) {
        const uniqKey = getArticleUniqKey(article);

        if (!uniqKey) {
          continue;
        }

        if (
          seenFetchedKeys.has(uniqKey)
          || knownExistingKeys.has(uniqKey)
          || selectedUniqueNewArticles.has(uniqKey)
          || pendingCandidates.has(uniqKey)
        ) {
          continue;
        }

        seenFetchedKeys.add(uniqKey);
        pendingCandidates.set(uniqKey, article);
      }

      if (pendingCandidates.size > 0) {
        const checks = [...pendingCandidates.values()];
        const existingDocs = await NewsEventModel.find(
          {
            $or: checks.map((candidate) => getArticleMongoFilter(candidate)),
          },
          {
            _article_id: 1,
            _link: 1,
            headline: 1,
          }
        ).lean();

        for (const doc of existingDocs) {
          // Map persisted field names back to raw article keys for dedup
          const mapped: Record<string, unknown> = {
            article_id: (doc as any)._article_id,
            link: (doc as any)._link,
            title: (doc as any).headline,
          };
          const existingKey = getArticleUniqKey(mapped);
          if (existingKey) {
            knownExistingKeys.add(existingKey);
          }
        }

        for (const [uniqKey, article] of pendingCandidates) {
          if (knownExistingKeys.has(uniqKey)) {
            continue;
          }

          if (selectedUniqueNewArticles.size >= MIN_UNIQUE_NEWS_ARTICLES) {
            break;
          }

          selectedUniqueNewArticles.set(uniqKey, article);
        }
      }

      const nextPage = asOptionalString(payload?.nextPage);
      const state = topicState.get(topic);

      if (state) {
        state.page = nextPage;
        state.exhausted = !nextPage || results.length === 0;
      }

      if (selectedUniqueNewArticles.size >= MIN_UNIQUE_NEWS_ARTICLES) {
        break;
      }
    }
  }

  const articles = [...selectedUniqueNewArticles.values()];

  if (articles.length < MIN_UNIQUE_NEWS_ARTICLES) {
    throw new Error(
      `Data sync requires ${MIN_UNIQUE_NEWS_ARTICLES} unique new news articles, but only ${articles.length} were available.`
    );
  }

  const batchId = `live_${Date.now()}`;
  const fetchedAt = new Date();
  const newsDocs = articles.map((article, index) =>
    mapArticleToNewsEvent(article, batchId, index, fetchedAt)
  );

  if (newsDocs.length > 0) {
    await NewsEventModel.insertMany(newsDocs, { ordered: false });
  }

  // 3) Update all portfolio holdings with latest market prices and backfill purchase prices
  const portfolios = await PortfolioModel.find({});

  const uniqueSymbols = [
    ...new Set(
      portfolios.flatMap((portfolio) =>
        (portfolio.holdings ?? []).map((holding) => holding.symbol)
      )
    ),
  ];

  const latestPriceMap: Record<string, number> = {};
  const failedSymbols: string[] = [];
  await Promise.all(
    uniqueSymbols.map(async (symbol) => {
      try {
        const latestPrice = await marketService.getLatestPrice(symbol);
        if (Number.isFinite(latestPrice) && latestPrice > 0) {
          latestPriceMap[symbol] = latestPrice;
        }
      } catch (error) {
        failedSymbols.push(symbol);
        console.warn(`Primary latest price failed for ${symbol}. Will try historical fallback.`);
      }
    })
  );

  if (failedSymbols.length > 0) {
    try {
      const historicalMap = await marketService.getMultiplePrices(failedSymbols);

      for (const symbol of failedSymbols) {
        const series = historicalMap[symbol] ?? [];
        const lastPoint = series[series.length - 1];

        if (lastPoint && Number.isFinite(lastPoint.close) && lastPoint.close > 0) {
          latestPriceMap[symbol] = lastPoint.close;
        }
      }
    } catch (fallbackError) {
      console.warn("Historical fallback failed for remaining symbols:", fallbackError);
    }
  }

  let portfoliosUpdated = 0;
  let holdingsUpdated = 0;
  let purchasePriceBackfilled = 0;

  for (const portfolio of portfolios) {
    let portfolioChanged = false;

    for (const holding of portfolio.holdings) {
      const latest = latestPriceMap[holding.symbol];

      if (typeof latest === "number" && Number.isFinite(latest) && latest > 0) {
        if (holding.current_price !== latest) {
          holding.current_price = latest;
          holdingsUpdated += 1;
          portfolioChanged = true;
        }
      }

      const hasPurchasePrice =
        typeof holding.purchase_price === "number" &&
        Number.isFinite(holding.purchase_price) &&
        holding.purchase_price > 0;

      if (!hasPurchasePrice) {
        const fallbackPrice =
          (typeof latest === "number" && Number.isFinite(latest) && latest > 0)
            ? latest
            : holding.current_price;

        if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
          holding.purchase_price = fallbackPrice;
          purchasePriceBackfilled += 1;
          portfolioChanged = true;
        }
      }
    }

    if (portfolioChanged) {
      portfolio.portfolio_value = portfolio.holdings.reduce(
        (sum, item) => sum + item.current_price * item.quantity,
        0
      );
      await portfolio.save();
      portfoliosUpdated += 1;
    }
  }

  return {
    portfoliosUpdated,
    holdingsUpdated,
    purchasePriceBackfilled,
    latestPricesFetched: Object.keys(latestPriceMap).length,
    newsEventsStored: newsDocs.length,
    newsEventsSaved: newsDocs,
    macroSaved: true,
    timestamp: new Date().toISOString(),
  };
}
