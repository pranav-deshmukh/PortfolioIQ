import { Request, Response } from "express";
import { fetchNewsData, NewsDataFilters } from "../services/newsData-api.service";
import NewsEventModel from "../models/newsEvent.model";
import { connectDB } from "../services/portfolioDb.service";

function cleanArticle(article: any) {
  return {
    article_id: article.article_id,
    link: article.link,
    title: article.title,
    description: article.description,
    keywords: article.keywords,
    symbol: article.symbol,
    language: article.language,
    country: article.country,
    pubDate: article.pubDate,
    source_id: article.source_id,
    source_name: article.source_name,
    source_url: article.source_url,
    source_icon: article.source_icon,
    source_priority: article.source_priority,
  };
}

function toNewsFilters(input: Record<string, unknown>): NewsDataFilters {
  const {
    q,
    country,
    category,
    language,
    domain,
    size,
    page,
    prioritydomain,
  } = input;

  return {
    q: typeof q === "string" ? q : "stock market",
    country: typeof country === "string" ? country : undefined,
    category: typeof category === "string" ? category : undefined,
    language: typeof language === "string" ? language : "en",
    domain: typeof domain === "string" ? domain : undefined,
    size:
      typeof size === "number"
        ? size
        : typeof size === "string" && size.trim() !== ""
        ? Number(size)
        : undefined,
    page: typeof page === "string" ? page : undefined,
    prioritydomain:
      typeof prioritydomain === "string" ? prioritydomain : undefined,
  };
}

function withDefaultMarketQuery(filters: NewsDataFilters): NewsDataFilters {
  const hasAnyFilter = Object.values(filters).some(
    (value) => value !== undefined && value !== null && value !== ""
  );

  if (hasAnyFilter) {
    return filters;
  }

  return {
    ...filters,
    q: "market",
  };
}

export async function getNews(req: Request, res: Response) {
  try {
    const filters = withDefaultMarketQuery(
      toNewsFilters(req.query as unknown as Record<string, unknown>)
    );

    const data = await fetchNewsData(filters);
    const cleanedArticles = (data.results ?? []).map(cleanArticle);

    res.json({
      success: true,
      data: {
        articles: cleanedArticles,
      },
    });
  } catch (error: any) {
    console.error("News controller error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch news",
    });
  }
}

export async function postNews(req: Request, res: Response) {
  try {
    const filters = toNewsFilters((req.body ?? {}) as Record<string, unknown>);

    const data = await fetchNewsData(filters);
    const cleanedArticles = (data.results ?? []).map(cleanArticle);

    res.json({
      success: true,
      data: {
        articles: cleanedArticles,
      },
    });
  } catch (error: any) {
    console.error("News controller error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch news",
    });
  }
}

export async function getRecentNews(req: Request, res: Response) {
  try {
    await connectDB();
    const limit = parseInt(req.query.limit as string) || 10;
    const events = await NewsEventModel.find()
      .sort({ fetched_at: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ success: true, data: { events } });
  } catch (error: any) {
    console.error("Recent news error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch recent news",
    });
  }
}
