import { getPortfolioByClientId } from "./portfolioDb.service";
import { MarketDataAPIService, PricePoint } from "./marketData-api.service";

export type PerformanceWindow = "1d" | "1w" | "1m" | "6m" | "1y";

export interface PerformanceReturns {
  "1d": number;
  "1w": number;
  "1m": number;
  "6m": number;
  "1y": number;
}

export interface BenchmarkComparisonRow {
  portfolio: number;
  benchmark: number;
  alpha: number;
  performance: "outperforming" | "underperforming" | "neutral";
}

export interface PerformanceResult {
  mode: "portfolio" | "symbols";
  client_id?: string;
  symbols?: string[];
  returns: PerformanceReturns;
  benchmark_comparison: {
    benchmark: string;
    comparison: Partial<Record<PerformanceWindow, BenchmarkComparisonRow>>;
    unavailable?: boolean;
    error?: string;
  };
  partial_data: {
    skipped_assets: string[];
  };
}

interface WeightedHolding {
  symbol: string;
  weight: number;
}

const WINDOWS: Record<PerformanceWindow, number> = {
  "1d": 1,
  "1w": 7,
  "1m": 30,
  "6m": 182,
  "1y": 365,
};

export class PerformanceService {
  private marketDataService = new MarketDataAPIService();
  private seriesCache: Map<string, PricePoint[]> = new Map();

  private round(value: number, digits = 6): number {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private getDateDaysAgo(days: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return this.formatDate(date);
  }

  private async getSeries(symbol: string, outputSize = 600): Promise<PricePoint[]> {
    const cacheKey = `${symbol}_${outputSize}`;
    const cached = this.seriesCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const data = await this.marketDataService.getHistoricalPrices(
      symbol,
      "1day",
      outputSize
    );

    const values = data.values ?? [];
    this.seriesCache.set(cacheKey, values);
    return values;
  }

  // Required helper: fetch current price
  async getCurrentPrice(symbol: string): Promise<number> {
    const series = await this.getSeries(symbol);

    if (series.length > 0) {
      return series[series.length - 1].close;
    }

    return this.marketDataService.getLatestPrice(symbol);
  }

  // Required helper: fetch historical price by date with previous-trading-day fallback
  async getHistoricalPrice(symbol: string, date: string): Promise<number> {
    const series = await this.getSeries(symbol);

    if (series.length === 0) {
      throw new Error(`No historical series available for symbol ${symbol}`);
    }

    const targetTime = new Date(date).getTime();

    for (let i = series.length - 1; i >= 0; i--) {
      const pointTime = new Date(series[i].datetime).getTime();
      if (pointTime <= targetTime) {
        return series[i].close;
      }
    }

    throw new Error(
      `No historical price found for ${symbol} on or before ${date}`
    );
  }

  private normalizeHoldings(holdings: WeightedHolding[]): WeightedHolding[] {
    const valid = holdings.filter(
      (h) => typeof h.symbol === "string" && h.symbol.length > 0 && h.weight > 0
    );

    const weightSum = valid.reduce((sum, h) => sum + h.weight, 0);

    if (weightSum <= 0) {
      throw new Error("Portfolio holdings have no valid positive weights");
    }

    return valid.map((h) => ({
      symbol: h.symbol,
      weight: h.weight / weightSum,
    }));
  }

  private getPerformanceLabel(alpha: number):
    | "outperforming"
    | "underperforming"
    | "neutral" {
    if (alpha > 0.002) return "outperforming";
    if (alpha < -0.002) return "underperforming";
    return "neutral";
  }

  private async computeReturnsForSymbols(
    holdings: WeightedHolding[]
  ): Promise<{ returns: PerformanceReturns; skippedAssets: string[] }> {
    const returnAcc: Record<PerformanceWindow, { weighted: number; usedWeight: number }> = {
      "1d": { weighted: 0, usedWeight: 0 },
      "1w": { weighted: 0, usedWeight: 0 },
      "1m": { weighted: 0, usedWeight: 0 },
      "6m": { weighted: 0, usedWeight: 0 },
      "1y": { weighted: 0, usedWeight: 0 },
    };

    const skippedAssets = new Set<string>();

    // Preload all series in parallel to avoid sequential external API calls.
    await Promise.all(
      [...new Set(holdings.map((h) => h.symbol))].map((symbol) =>
        this.getSeries(symbol)
      )
    );

    const holdingWindowReturns = await Promise.all(
      holdings.map(async (holding) => {
        try {
          const currentPrice = await this.getCurrentPrice(holding.symbol);

          if (!currentPrice || currentPrice <= 0) {
            skippedAssets.add(holding.symbol);
            return null;
          }

          const windowReturns = await Promise.all(
            (Object.entries(WINDOWS) as Array<[PerformanceWindow, number]>).map(
              async ([windowKey, days]) => {
                try {
                  const historicalDate = this.getDateDaysAgo(days);
                  const pastPrice = await this.getHistoricalPrice(
                    holding.symbol,
                    historicalDate
                  );

                  if (!pastPrice || pastPrice <= 0) {
                    return { windowKey, assetReturn: null as number | null };
                  }

                  return {
                    windowKey,
                    assetReturn: (currentPrice - pastPrice) / pastPrice,
                  };
                } catch {
                  return { windowKey, assetReturn: null as number | null };
                }
              }
            )
          );

          return {
            symbol: holding.symbol,
            weight: holding.weight,
            windowReturns,
          };
        } catch {
          skippedAssets.add(holding.symbol);
          return null;
        }
      })
    );

    for (const holdingResult of holdingWindowReturns) {
      if (!holdingResult) continue;

      let anyWindowMissing = false;

      for (const item of holdingResult.windowReturns) {
        if (item.assetReturn === null) {
          anyWindowMissing = true;
          continue;
        }

        returnAcc[item.windowKey].weighted += holdingResult.weight * item.assetReturn;
        returnAcc[item.windowKey].usedWeight += holdingResult.weight;
      }

      if (anyWindowMissing) {
        skippedAssets.add(holdingResult.symbol);
      }
    }

    const returns: PerformanceReturns = {
      "1d":
        returnAcc["1d"].usedWeight > 0
          ? this.round(returnAcc["1d"].weighted / returnAcc["1d"].usedWeight)
          : 0,
      "1w":
        returnAcc["1w"].usedWeight > 0
          ? this.round(returnAcc["1w"].weighted / returnAcc["1w"].usedWeight)
          : 0,
      "1m":
        returnAcc["1m"].usedWeight > 0
          ? this.round(returnAcc["1m"].weighted / returnAcc["1m"].usedWeight)
          : 0,
      "6m":
        returnAcc["6m"].usedWeight > 0
          ? this.round(returnAcc["6m"].weighted / returnAcc["6m"].usedWeight)
          : 0,
      "1y":
        returnAcc["1y"].usedWeight > 0
          ? this.round(returnAcc["1y"].weighted / returnAcc["1y"].usedWeight)
          : 0,
    };

    return {
      returns,
      skippedAssets: [...skippedAssets],
    };
  }

  private async computeBenchmarkReturns(
    benchmark: string
  ): Promise<PerformanceReturns> {
    await this.getSeries(benchmark);

    const currentPrice = await this.getCurrentPrice(benchmark);

    if (!currentPrice || currentPrice <= 0) {
      throw new Error(`Benchmark current price unavailable for ${benchmark}`);
    }

    const rows = await Promise.all(
      (Object.entries(WINDOWS) as Array<[PerformanceWindow, number]>).map(
        async ([windowKey, days]) => {
          const date = this.getDateDaysAgo(days);
          const pastPrice = await this.getHistoricalPrice(benchmark, date);

          if (!pastPrice || pastPrice <= 0) {
            throw new Error(
              `Benchmark historical price unavailable for ${benchmark} at ${date}`
            );
          }

          return {
            windowKey,
            value: this.round((currentPrice - pastPrice) / pastPrice),
          };
        }
      )
    );

    const returns: Partial<PerformanceReturns> = {};
    rows.forEach((row) => {
      returns[row.windowKey] = row.value;
    });

    return returns as PerformanceReturns;
  }

  async getPerformance(
    clientId?: string,
    symbols?: string[]
  ): Promise<PerformanceResult> {
    let holdings: WeightedHolding[] = [];
    let mode: PerformanceResult["mode"] = "portfolio";
    let normalizedSymbols: string[] = [];

    if (symbols && symbols.length > 0) {
      mode = "symbols";
      normalizedSymbols = [...new Set(symbols.map((s) => s.trim().toUpperCase()))].filter(
        (s) => s.length > 0
      );

      if (normalizedSymbols.length === 0) {
        throw new Error("No valid symbols provided");
      }

      const equalWeight = 1 / normalizedSymbols.length;
      holdings = normalizedSymbols.map((symbol) => ({
        symbol,
        weight: equalWeight,
      }));
    } else {
      if (!clientId) {
        throw new Error("Either clientId or symbols is required");
      }

      const portfolio = await getPortfolioByClientId(clientId);

      if (!portfolio) {
        throw new Error("Portfolio not found");
      }

      holdings = this.normalizeHoldings(
        (portfolio.holdings ?? []).map((h) => ({
          symbol: h.symbol,
          weight: h.weight,
        }))
      );
    }

    const { returns, skippedAssets } = await this.computeReturnsForSymbols(holdings);

    const benchmark = process.env.PERFORMANCE_BENCHMARK ?? "SPY";

    let benchmarkComparison: PerformanceResult["benchmark_comparison"] = {
      benchmark,
      comparison: {},
    };

    try {
      const benchmarkReturns = await this.computeBenchmarkReturns(benchmark);

      benchmarkComparison = {
        benchmark,
        comparison: {
          "1d": {
            portfolio: returns["1d"],
            benchmark: benchmarkReturns["1d"],
            alpha: this.round(returns["1d"] - benchmarkReturns["1d"]),
            performance: this.getPerformanceLabel(
              returns["1d"] - benchmarkReturns["1d"]
            ),
          },
          "1w": {
            portfolio: returns["1w"],
            benchmark: benchmarkReturns["1w"],
            alpha: this.round(returns["1w"] - benchmarkReturns["1w"]),
            performance: this.getPerformanceLabel(
              returns["1w"] - benchmarkReturns["1w"]
            ),
          },
          "1m": {
            portfolio: returns["1m"],
            benchmark: benchmarkReturns["1m"],
            alpha: this.round(returns["1m"] - benchmarkReturns["1m"]),
            performance: this.getPerformanceLabel(
              returns["1m"] - benchmarkReturns["1m"]
            ),
          },
          "6m": {
            portfolio: returns["6m"],
            benchmark: benchmarkReturns["6m"],
            alpha: this.round(returns["6m"] - benchmarkReturns["6m"]),
            performance: this.getPerformanceLabel(
              returns["6m"] - benchmarkReturns["6m"]
            ),
          },
          "1y": {
            portfolio: returns["1y"],
            benchmark: benchmarkReturns["1y"],
            alpha: this.round(returns["1y"] - benchmarkReturns["1y"]),
            performance: this.getPerformanceLabel(
              returns["1y"] - benchmarkReturns["1y"]
            ),
          },
        },
      };
    } catch (benchmarkError) {
      benchmarkComparison = {
        benchmark,
        comparison: {},
        unavailable: true,
        error:
          benchmarkError instanceof Error
            ? benchmarkError.message
            : "Benchmark unavailable",
      };
    }

    return {
      mode,
      client_id: mode === "portfolio" ? clientId : undefined,
      symbols: mode === "symbols" ? normalizedSymbols : undefined,
      returns,
      benchmark_comparison: benchmarkComparison,
      partial_data: {
        skipped_assets: skippedAssets,
      },
    };
  }
}

export const performanceService = new PerformanceService();
