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

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return [];
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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

  const topicPayloads = await Promise.all(
    newsTopics.map((topic) =>
      fetchNewsData({
        q: topic,
        language: "en",
        country: "us",
        size: 2,
      })
    )
  );

  const mergedArticles = topicPayloads.flatMap((payload) =>
    Array.isArray(payload?.results)
      ? (payload.results as Record<string, unknown>[])
      : []
  );

  const deduped = new Map<string, Record<string, unknown>>();
  for (const article of mergedArticles) {
    const articleId = asOptionalString(article.article_id);
    const link = asOptionalString(article.link);
    const key = articleId || link;

    if (!key) {
      continue;
    }

    deduped.set(key, article);
  }

  const articles = [...deduped.values()];

  const newsBulkOps = articles.map((article) => {
    const articleId = asOptionalString(article.article_id);
    const sourceId = asOptionalString(article.source_id);

    const filter = articleId && sourceId
      ? { article_id: articleId, source_id: sourceId }
      : { link: asOptionalString(article.link), pubDate: asOptionalString(article.pubDate) };

    return {
      updateOne: {
        filter,
        update: {
          $set: {
            article_id: articleId,
            title: asOptionalString(article.title),
            description: asOptionalString(article.description),
            link: asOptionalString(article.link),
            pubDate: asOptionalString(article.pubDate),
            source_id: sourceId,
            source_name: asOptionalString(article.source_name),
            language: asOptionalString(article.language),
            country: asStringArray(article.country),
            category: asStringArray(article.category),
            keywords: asStringArray(article.keywords),
            ai_tag: asOptionalString(article.ai_tag),
            raw: article,
            fetched_at: new Date(),
          },
        },
        upsert: true,
      },
    };
  });

  if (newsBulkOps.length > 0) {
    await NewsEventModel.bulkWrite(newsBulkOps, { ordered: false });
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
    newsEventsStored: articles.length,
    macroSaved: true,
    timestamp: new Date().toISOString(),
  };
}
