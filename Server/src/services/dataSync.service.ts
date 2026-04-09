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

function getArticleUniqKey(article: Record<string, unknown>): string | undefined {
  const articleId = asOptionalString(article.article_id);
  const sourceId = asOptionalString(article.source_id);
  const link = asOptionalString(article.link);
  const title = asOptionalString(article.title);
  const pubDate = asOptionalString(article.pubDate);

  if (articleId && sourceId) {
    return `id:${articleId}|src:${sourceId}`;
  }

  if (link) {
    return `link:${link}`;
  }

  if (title && pubDate) {
    return `title:${title}|date:${pubDate}`;
  }

  return undefined;
}

function getArticleMongoFilter(article: Record<string, unknown>) {
  const articleId = asOptionalString(article.article_id);
  const sourceId = asOptionalString(article.source_id);
  const link = asOptionalString(article.link);
  const title = asOptionalString(article.title);
  const pubDate = asOptionalString(article.pubDate);
  const sourceName = asOptionalString(article.source_name);

  if (articleId && sourceId) {
    return { article_id: articleId, source_id: sourceId };
  }

  if (link) {
    return { link };
  }

  return { title, pubDate, source_name: sourceName };
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
            article_id: 1,
            source_id: 1,
            link: 1,
            title: 1,
            pubDate: 1,
          }
        ).lean();

        for (const doc of existingDocs) {
          const existingKey = getArticleUniqKey(doc as unknown as Record<string, unknown>);
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

  const newsDocs = articles.map((article) => ({
    article_id: asOptionalString(article.article_id),
    title: asOptionalString(article.title),
    description: asOptionalString(article.description),
    link: asOptionalString(article.link),
    pubDate: asOptionalString(article.pubDate),
    source_id: asOptionalString(article.source_id),
    source_name: asOptionalString(article.source_name),
    language: asOptionalString(article.language),
    country: asStringArray(article.country),
    category: asStringArray(article.category),
    keywords: asStringArray(article.keywords),
    ai_tag: asOptionalString(article.ai_tag),
    raw: article,
    fetched_at: new Date(),
  }));

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
    macroSaved: true,
    timestamp: new Date().toISOString(),
  };
}
