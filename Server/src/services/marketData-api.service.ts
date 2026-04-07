const BASE_URL = "https://api.twelvedata.com";
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";

export class MarketDataAPIError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly url?: string,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = "MarketDataAPIError";
  }
}

export interface PricePoint {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TimeSeriesResponse {
  meta: {
    symbol: string;
    interval: string;
    currency: string;
    exchange_timezone: string;
  };
  values: PricePoint[];
}

interface CacheEntry {
  data: PricePoint[];
  timestamp: number;
}

export class MarketDataAPIService {
  private apiKey: string;
  private cache: Map<string, CacheEntry> = new Map();
  private CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    if (!process.env.TWELVE_DATA_API_KEY) {
      throw new Error("TWELVE_DATA_API_KEY is not set");
    }
    this.apiKey = process.env.TWELVE_DATA_API_KEY;
  }

  // ---------- CORE FETCH WITH RETRY ---------- //
  private async fetchWithRetry(url: string, retries = 2): Promise<any> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url);

        if (!res.ok) {
          const responseBody = await res.text();
          throw new MarketDataAPIError(
            `HTTP Error: ${res.status}`,
            res.status,
            url,
            responseBody
          );
        }

        const data = await res.json();

        if (data.status === "error") {
          throw new MarketDataAPIError(data.message, undefined, url);
        }

        return data;
      } catch (err) {
        const isForbidden =
          err instanceof MarketDataAPIError && err.status === 403;

        // 403s (including network security blocks) are non-retryable in this flow.
        if (isForbidden) {
          throw err;
        }

        if (attempt === retries) {
          throw err;
        }
      }
    }
  }

  // ---------- URL BUILDER ---------- //
  private buildUrl(endpoint: string, params: Record<string, any>) {
    const url = new URL(`${BASE_URL}/${endpoint}`);

    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });

    url.searchParams.append("apikey", this.apiKey);

    return url.toString();
  }

  private toYahooSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();

    if (upper === "SPX") return "^GSPC";

    return symbol.replace(".", "-");
  }

  private async fetchYahooHistoricalPrices(
    symbol: string,
    outputsize: number = 100
  ): Promise<TimeSeriesResponse> {
    const yahooSymbol = this.toYahooSymbol(symbol);
    const range = outputsize <= 100 ? "1y" : "2y";

    const url = `${YAHOO_CHART_URL}/${encodeURIComponent(
      yahooSymbol
    )}?interval=1d&range=${range}&includePrePost=false&events=div%2Csplits`;

    const res = await fetch(url);

    if (!res.ok) {
      const body = await res.text();
      throw new MarketDataAPIError(
        `Yahoo Finance HTTP Error: ${res.status}`,
        res.status,
        url,
        body
      );
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      throw new MarketDataAPIError(
        `Yahoo Finance returned no data for symbol ${symbol}`,
        undefined,
        url,
        JSON.stringify(data)
      );
    }

    const timestamps: number[] = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};

    const openArr: Array<number | null> = quote.open ?? [];
    const highArr: Array<number | null> = quote.high ?? [];
    const lowArr: Array<number | null> = quote.low ?? [];
    const closeArr: Array<number | null> = quote.close ?? [];
    const volumeArr: Array<number | null> = quote.volume ?? [];

    const parsedValues: PricePoint[] = [];

    for (let idx = 0; idx < timestamps.length; idx++) {
      const ts = timestamps[idx];
      const close = closeArr[idx];
      const openVal = openArr[idx];
      const highVal = highArr[idx];
      const lowVal = lowArr[idx];
      const volumeVal = volumeArr[idx];

      if (typeof close !== "number" || Number.isNaN(close)) {
        continue;
      }

      const point: PricePoint = {
        datetime: new Date(ts * 1000).toISOString().slice(0, 10),
        open:
          typeof openVal === "number" && !Number.isNaN(openVal)
            ? openVal
            : close,
        high:
          typeof highVal === "number" && !Number.isNaN(highVal)
            ? highVal
            : close,
        low:
          typeof lowVal === "number" && !Number.isNaN(lowVal)
            ? lowVal
            : close,
        close,
      };

      if (typeof volumeVal === "number" && !Number.isNaN(volumeVal)) {
        point.volume = volumeVal;
      }

      parsedValues.push(point);
    }

    const trimmedValues = parsedValues.slice(-outputsize);

    return {
      meta: {
        symbol,
        interval: "1day",
        currency: result.meta?.currency ?? "USD",
        exchange_timezone: result.meta?.exchangeTimezoneName ?? "America/New_York",
      },
      values: trimmedValues,
    };
  }

  // ---------- CACHE CHECK ---------- //
  private getCache(key: string): PricePoint[] | null {
    const entry = this.cache.get(key);

    if (!entry) return null;

    const isExpired = Date.now() - entry.timestamp > this.CACHE_TTL;

    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  private setCache(key: string, data: PricePoint[]) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  // ---------- 1. HISTORICAL PRICES ---------- //
  async getHistoricalPrices(
    symbol: string,
    interval: string = "1day",
    outputsize: number = 100
  ): Promise<TimeSeriesResponse> {
    const cacheKey = `${symbol}_${interval}_${outputsize}`;

    const cached = this.getCache(cacheKey);
    if (cached) {
      return {
        meta: {} as any,
        values: cached,
      };
    }

    const url = this.buildUrl("time_series", {
      symbol,
      interval,
      outputsize,
      order: "ASC",
    });

    try {
      const data = await this.fetchWithRetry(url);

      const parsedValues: PricePoint[] = data.values.map((item: any) => ({
        datetime: item.datetime,
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        close: parseFloat(item.close),
        volume: item.volume ? parseFloat(item.volume) : undefined,
      }));

      this.setCache(cacheKey, parsedValues);

      return {
        meta: data.meta,
        values: parsedValues,
      };
    } catch (primaryError) {
      const fallbackData = await this.fetchYahooHistoricalPrices(symbol, outputsize);
      this.setCache(cacheKey, fallbackData.values);

      console.warn(`Twelve Data failed for ${symbol}. Falling back to Yahoo Finance.`, {
        error:
          primaryError instanceof Error
            ? primaryError.message
            : "Unknown primary provider error",
      });

      return fallbackData;
    }
  }

  // ---------- 2. MULTIPLE SYMBOLS (SAFE BATCH) ---------- //
  async getMultiplePrices(
    symbols: string[]
  ): Promise<Record<string, PricePoint[]>> {
    const results: Record<string, PricePoint[]> = {};

    const BATCH_SIZE = 10;

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async (symbol) => {
          const data = await this.getHistoricalPrices(symbol);
          return { symbol, values: data.values };
        })
      );

      let firstFailure: unknown = null;

      batchResults.forEach((result) => {
        if (result.status === "fulfilled") {
          const { symbol, values } = result.value;
          results[symbol] = values;
        } else if (!firstFailure) {
          firstFailure = result.reason;
        }
      });

      if (Object.keys(results).length === 0 && firstFailure) {
        throw firstFailure;
      }
    }

    return results;
  }

  // ---------- 3. INDEX PRICES ---------- //
  async getIndexPrices(
    indexSymbol: string = "SPX"
  ): Promise<TimeSeriesResponse> {
    return this.getHistoricalPrices(indexSymbol, "1day", 200);
  }

  // ---------- 4. LATEST PRICE ---------- //
  async getLatestPrice(symbol: string): Promise<number> {
    const url = this.buildUrl("price", { symbol });

    try {
      const data = await this.fetchWithRetry(url);
      return parseFloat(data.price);
    } catch {
      const yahooSymbol = this.toYahooSymbol(symbol);
      const yahooUrl = `${YAHOO_QUOTE_URL}?symbols=${encodeURIComponent(yahooSymbol)}`;

      const res = await fetch(yahooUrl);

      if (!res.ok) {
        throw new Error(`Unable to fetch latest price for ${symbol} from any provider`);
      }

      const data = await res.json();
      const price = data?.quoteResponse?.result?.[0]?.regularMarketPrice;

      if (typeof price !== "number" || Number.isNaN(price)) {
        throw new Error(`No latest price returned for symbol ${symbol}`);
      }

      return price;
    }
  }

  // ---------- 5. RETURNS ---------- //
  calculateReturns(prices: PricePoint[]): number[] {
    const returns: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      const prev = prices[i - 1].close;
      const curr = prices[i].close;

      returns.push((curr - prev) / prev);
    }

    return returns;
  }
}