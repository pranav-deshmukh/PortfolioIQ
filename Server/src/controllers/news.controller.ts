import { Request, Response } from "express";
import { fetchNewsData, NewsDataFilters } from "../services/newsData-api.service";

export async function getNews(req: Request, res: Response) {
  try {
    const { q, country, category, language, domain, size, page, prioritydomain } =
      req.query;

    const filters: NewsDataFilters = {
      q: q as string,
      country: country as string,
      category: category as string,
      language: language as string,
      domain: domain as string,
      size: size ? Number(size) : undefined,
      page: page as string,
      prioritydomain: prioritydomain as string,
    };

    const data = await fetchNewsData(filters);

    res.json({
      success: true,
      data: {
        articles: data.results ?? [],
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
