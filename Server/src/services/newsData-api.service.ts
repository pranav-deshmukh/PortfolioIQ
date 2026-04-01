const BASE_URL = "https://finnhub.io/api/v1";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// ---------- TYPES ---------- //

export interface NewsItem {
  headline: string;
  source: string;
  datetime: number;
  url: string;
  symbol?: string;
  relevanceScore?: number;
  fullContent?: string; // 🔥 NEW
}

export class NewsAPIService {
  private apiKey: string;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private CACHE_TTL = 5 * 60 * 1000;

  constructor() {
    if (!process.env.FINNHUB_API_KEY) {
      throw new Error("FINNHUB_API_KEY is not set");
    }
    this.apiKey = process.env.FINNHUB_API_KEY;
  }

  // ---------- FETCH ---------- //
  private async fetchWithRetry(url: string, retries = 2): Promise<any> {
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url);

        if (!res.ok) {
          throw new Error(`HTTP Error: ${res.status}`);
        }

        const text = await res.text();

        if (text.startsWith("<!DOCTYPE")) {
          throw new Error("HTML response from Finnhub");
        }

        return JSON.parse(text);
      } catch (err) {
        if (i === retries) throw err;
      }
    }
  }

  // ---------- CACHE ---------- //
  private getCache<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  private setCache(key: string, data: any) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  // ---------- URL BUILDER ---------- //
  private buildUrl(endpoint: string, params: Record<string, any>) {
    const url = new URL(`${BASE_URL}/${endpoint}`);

    Object.entries(params).forEach(([k, v]) => {
      url.searchParams.append(k, String(v));
    });

    url.searchParams.append("token", this.apiKey);

    return url.toString();
  }

  // ---------- 🧠 FETCH FULL ARTICLE (JINA) ---------- //
  private async fetchFullArticle(url: string): Promise<string> {
    try {
      const finalUrl = await this.resolveFinalUrl(url);
      console.log(finalUrl);
      const readerUrl = `https://r.jina.ai/${finalUrl}`;

      const res = await fetch(readerUrl);

      if (!res.ok) return "";

      const text = await res.text();
      console.log(text);

      // ⚠️ limit content size (important for LLM)
      return text.slice(0, 3000);
    } catch (err) {
      console.error("Full article fetch failed:", err);
      return "";
    }
  }

  // ---------- 1. COMPANY NEWS ---------- //
  async getCompanyNews(
    symbol: string,
    from: string,
    to: string,
  ): Promise<NewsItem[]> {
    const cacheKey = `company_${symbol}_${from}_${to}`;

    const cached = this.getCache<NewsItem[]>(cacheKey);
    if (cached) return cached;

    const url = this.buildUrl("company-news", {
      symbol,
      from,
      to,
    });

    const data = await this.fetchWithRetry(url);

    const parsed: NewsItem[] = data.map((item: any) => ({
      headline: item.headline,
      source: item.source,
      datetime: item.datetime,
      url: item.url,
      symbol,
    }));

    const filtered = this.filterNews(parsed);

    this.setCache(cacheKey, filtered);
    return filtered;
  }

  // ---------- 2. MARKET NEWS ---------- //
  async getMarketNews(): Promise<NewsItem[]> {
    const cacheKey = "market_news";

    const cached = this.getCache<NewsItem[]>(cacheKey);
    if (cached) return cached;

    const url = this.buildUrl("news", { category: "general" });
    const data = await this.fetchWithRetry(url);

    const parsed: NewsItem[] = data.map((item: any) => ({
      headline: item.headline,
      source: item.source,
      datetime: item.datetime,
      url: item.url,
    }));

    const filtered = this.filterNews(parsed);

    this.setCache(cacheKey, filtered);
    return filtered;
  }

  // ---------- 3. PORTFOLIO NEWS ---------- //
  async getPortfolioNews(
    symbols: string[],
    from: string,
    to: string,
  ): Promise<NewsItem[]> {
    const allNews = await Promise.all(
      symbols.map((symbol) => this.getCompanyNews(symbol, from, to)),
    );

    return allNews.flat();
  }

  private async resolveFinalUrl(url: string): Promise<string> {
    try {
      const res = await fetch(url, {
        redirect: "follow",
      });

      return res.url; // ✅ final redirected URL
    } catch (err) {
      console.error("URL resolve failed:", err);
      return url;
    }
  }

  // ---------- 🔥 4. ENRICH WITH FULL CONTENT ---------- //
  async enrichNewsWithContent(news: NewsItem[]): Promise<NewsItem[]> {
    const topNews = news.slice(0, 5); // ⚠️ limit to avoid slow calls

    const enriched = await Promise.all(
      topNews.map(async (item) => {
        const fullContent = await this.fetchFullArticle(item.url);

        return {
          ...item,
          fullContent,
        };
      }),
    );

    return enriched;
  }

  // ---------- 5. FILTER ---------- //
  private filterNews(news: NewsItem[]): NewsItem[] {
    return news.filter((item) => item.headline).slice(0, 20);
  }

  // ---------- 6. SCORING ---------- //
  scoreNews(news: NewsItem[], portfolioSymbols: string[]): NewsItem[] {
    return news
      .map((item) => {
        let score = 0;

        const text = item.headline.toLowerCase();

        portfolioSymbols.forEach((symbol) => {
          if (text.includes(symbol.toLowerCase())) {
            score += 2;
          }
        });

        if (text.includes("earnings")) score += 1.5;
        if (text.includes("upgrade")) score += 1.5;
        if (text.includes("downgrade")) score += 1.5;

        return {
          ...item,
          relevanceScore: score,
        };
      })
      .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  }
}
