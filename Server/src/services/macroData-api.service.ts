const BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface MacroDataPoint {
  date: string;
  value: number;
}

interface InterestRateInsight {
  current: number;
  change_1w: number;
  change_1m: number;
  trend: "rising" | "falling" | "stable";
  rate_regime: "tightening" | "easing" | "neutral";
  z_score: number;
  percentile: number;
  signal:
    | "bearish_for_equities_bonds"
    | "supportive_for_duration_assets"
    | "neutral";
}

interface InflationInsight {
  current: number;
  previous: number;
  change: number;
  trend: "accelerating" | "decelerating" | "stable";
  z_score: number;
  percentile: number;
  real_rate: number;
  signal: "inflationary_pressure" | "disinflation" | "stable";
}

interface GDPInsight {
  current_growth_rate: number;
  previous_value: number;
  change: number;
  trend: "slowing" | "improving" | "stable";
  momentum: "positive" | "negative";
  signal: "growth_slowdown" | "expansion" | "stable";
}

interface UnemploymentInsight {
  current: number;
  previous: number;
  change: number;
  trend: "rising" | "falling" | "stable";
  sahm_rule_trigger: boolean;
  signal: "recession_risk_increasing" | "stable";
}

interface YieldCurveInsight {
  spread_10y_2y: number;
  previous_spread: number;
  change: number;
  inversion: boolean;
  curve_shape: "steepening" | "flattening" | "stable";
  signal: "recession_signal" | "normal";
}

export interface MacroInsightsPayload {
  macro_insights: {
    interest_rate: InterestRateInsight;
    inflation: InflationInsight;
    gdp: GDPInsight;
    unemployment: UnemploymentInsight;
    yield_curve: YieldCurveInsight;
    macro_regime:
      | "late_cycle_stress"
      | "inflation_tightening"
      | "soft_landing"
      | "mixed_transition";
    overall_signal: "risk_off" | "balanced" | "risk_on";
    confidence: number;
  };
}

export class MacroAPIService {
  private apiKey: string;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private CACHE_TTL = 15 * 60 * 1000; // 15 min (macro changes slowly)

  constructor() {
    if (!process.env.FRED_API_KEY) {
      throw new Error("FRED_API_KEY is not set");
    }
    this.apiKey = process.env.FRED_API_KEY;
  }

  // ---------- FETCH WITH RETRY ---------- //
  private async fetchWithRetry(url: string, retries = 2): Promise<any> {
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url);

        if (!res.ok) {
          throw new Error(`HTTP Error: ${res.status}`);
        }

        return await res.json();
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
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  // ---------- URL BUILDER ---------- //
  private buildUrl(series_id: string) {
    const url = new URL(BASE_URL);

    url.searchParams.append("series_id", series_id);
    url.searchParams.append("api_key", this.apiKey);
    url.searchParams.append("file_type", "json");

    return url.toString();
  }

  // ---------- GENERIC FETCH ---------- //
  private async getSeries(seriesId: string): Promise<MacroDataPoint[]> {
    const cacheKey = `macro_${seriesId}`;

    const cached = this.getCache<MacroDataPoint[]>(cacheKey);
    if (cached) return cached;

    const url = this.buildUrl(seriesId);
    const data = await this.fetchWithRetry(url);

    const parsed: MacroDataPoint[] = data.observations
      .filter((item: any) => item.value !== ".")
      .map((item: any) => ({
        date: item.date,
        value: parseFloat(item.value),
      }));

    this.setCache(cacheKey, parsed);

    return parsed;
  }

  private round(value: number, digits = 4): number {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private latestPoint(series: MacroDataPoint[]): MacroDataPoint {
    if (series.length === 0) {
      throw new Error("Macro series is empty");
    }
    return series[series.length - 1];
  }

  private previousPoint(series: MacroDataPoint[]): MacroDataPoint {
    if (series.length < 2) {
      return this.latestPoint(series);
    }
    return series[series.length - 2];
  }

  private getPointAtLeastDaysAgo(
    series: MacroDataPoint[],
    daysAgo: number
  ): MacroDataPoint {
    const latest = this.latestPoint(series);
    const latestTime = new Date(latest.date).getTime();
    const targetTime = latestTime - daysAgo * 24 * 60 * 60 * 1000;

    for (let i = series.length - 2; i >= 0; i--) {
      const t = new Date(series[i].date).getTime();
      if (t <= targetTime) {
        return series[i];
      }
    }

    return this.previousPoint(series);
  }

  private getFiveYearValues(series: MacroDataPoint[]): number[] {
    const latest = this.latestPoint(series);
    const latestTime = new Date(latest.date).getTime();
    const fiveYearsMs = 365 * 5 * 24 * 60 * 60 * 1000;
    const cutoff = latestTime - fiveYearsMs;

    const values = series
      .filter((point) => new Date(point.date).getTime() >= cutoff)
      .map((point) => point.value);

    return values.length > 0 ? values : series.map((point) => point.value);
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private stdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const avg = this.mean(values);
    const variance =
      values.reduce((sum, v) => sum + (v - avg) ** 2, 0) /
      (values.length - 1);
    return Math.sqrt(variance);
  }

  private zScore(current: number, values: number[]): number {
    const sd = this.stdDev(values);
    if (sd === 0) return 0;
    const avg = this.mean(values);
    return (current - avg) / sd;
  }

  private percentile(current: number, values: number[]): number {
    if (values.length === 0) return 50;
    const count = values.filter((v) => v <= current).length;
    return (count / values.length) * 100;
  }

  private trendFromDelta<
    TPositive extends string,
    TNegative extends string
  >(
    delta: number,
    threshold: number,
    positive: TPositive,
    negative: TNegative
  ): TPositive | TNegative | "stable" {
    if (delta > threshold) return positive;
    if (delta < -threshold) return negative;
    return "stable" as const;
  }

  private toYoYGrowth(
    series: MacroDataPoint[],
    lagPeriods: number
  ): MacroDataPoint[] {
    if (series.length <= lagPeriods) return [];

    const growth: MacroDataPoint[] = [];

    for (let i = lagPeriods; i < series.length; i++) {
      const prev = series[i - lagPeriods].value;
      const curr = series[i].value;

      if (prev === 0) continue;

      growth.push({
        date: series[i].date,
        value: ((curr - prev) / prev) * 100,
      });
    }

    return growth;
  }

  private movingAverage(values: number[], window: number): number[] {
    if (values.length < window) return [];

    const result: number[] = [];

    for (let i = window - 1; i < values.length; i++) {
      const slice = values.slice(i - window + 1, i + 1);
      result.push(this.mean(slice));
    }

    return result;
  }

  private buildInterestRateInsight(series: MacroDataPoint[]): InterestRateInsight {
    const currentPoint = this.latestPoint(series);
    const oneWeekPoint = this.getPointAtLeastDaysAgo(series, 7);
    const oneMonthPoint = this.getPointAtLeastDaysAgo(series, 30);

    const current = currentPoint.value;
    const change1w = current - oneWeekPoint.value;
    const change1m = current - oneMonthPoint.value;
    const trend = this.trendFromDelta(change1m, 0.05, "rising", "falling");

    const rate_regime: InterestRateInsight["rate_regime"] =
      trend === "rising" && current >= 3.5
        ? "tightening"
        : trend === "falling" && current <= 3
        ? "easing"
        : "neutral";

    const dist = this.getFiveYearValues(series);
    const zScore = this.zScore(current, dist);
    const percentile = this.percentile(current, dist);

    const signal: InterestRateInsight["signal"] =
      rate_regime === "tightening"
        ? "bearish_for_equities_bonds"
        : rate_regime === "easing"
        ? "supportive_for_duration_assets"
        : "neutral";

    return {
      current: this.round(current),
      change_1w: this.round(change1w),
      change_1m: this.round(change1m),
      trend,
      rate_regime,
      z_score: this.round(zScore),
      percentile: this.round(percentile, 2),
      signal,
    };
  }

  private buildInflationInsight(
    cpiSeries: MacroDataPoint[],
    interestRateCurrent: number
  ): InflationInsight {
    // CPIAUCSL is a monthly index, so derive YoY inflation (%) for interpretability.
    const yoyInflation = this.toYoYGrowth(cpiSeries, 12);
    const currentPoint = this.latestPoint(yoyInflation);
    const prevPoint = this.previousPoint(yoyInflation);

    const current = currentPoint.value;
    const previous = prevPoint.value;
    const change = current - previous;

    const trend = this.trendFromDelta(
      change,
      0.15,
      "accelerating",
      "decelerating"
    );

    const dist = this.getFiveYearValues(yoyInflation);
    const zScore = this.zScore(current, dist);
    const percentile = this.percentile(current, dist);

    const realRate = interestRateCurrent - current;

    const signal: InflationInsight["signal"] =
      current >= 3 || trend === "accelerating"
        ? "inflationary_pressure"
        : current <= 2 || trend === "decelerating"
        ? "disinflation"
        : "stable";

    return {
      current: this.round(current),
      previous: this.round(previous),
      change: this.round(change),
      trend,
      z_score: this.round(zScore),
      percentile: this.round(percentile, 2),
      real_rate: this.round(realRate),
      signal,
    };
  }

  private buildGDPInsight(gdpSeries: MacroDataPoint[]): GDPInsight {
    // GDP series is quarterly level, use YoY growth using lag 4 quarters.
    const yoyGrowth = this.toYoYGrowth(gdpSeries, 4);
    const currentPoint = this.latestPoint(yoyGrowth);
    const prevPoint = this.previousPoint(yoyGrowth);

    const current = currentPoint.value;
    const previous = prevPoint.value;
    const change = current - previous;

    const trend = this.trendFromDelta(change, 0.2, "improving", "slowing");
    const momentum: GDPInsight["momentum"] = current >= 0 ? "positive" : "negative";

    const signal: GDPInsight["signal"] =
      current < 1 || trend === "slowing"
        ? "growth_slowdown"
        : current > 2
        ? "expansion"
        : "stable";

    return {
      current_growth_rate: this.round(current),
      previous_value: this.round(previous),
      change: this.round(change),
      trend,
      momentum,
      signal,
    };
  }

  private buildUnemploymentInsight(
    unemploymentSeries: MacroDataPoint[]
  ): UnemploymentInsight {
    const currentPoint = this.latestPoint(unemploymentSeries);
    const prevPoint = this.previousPoint(unemploymentSeries);

    const current = currentPoint.value;
    const previous = prevPoint.value;
    const change = current - previous;

    const trend = this.trendFromDelta(change, 0.1, "rising", "falling");

    const monthlyValues = unemploymentSeries.map((p) => p.value);
    const ma3 = this.movingAverage(monthlyValues, 3);

    let sahmRule = false;
    if (ma3.length >= 12) {
      const currentMa3 = ma3[ma3.length - 1];
      const trailing12mMin = Math.min(...ma3.slice(-12));
      sahmRule = currentMa3 - trailing12mMin >= 0.5;
    }

    const signal: UnemploymentInsight["signal"] =
      sahmRule || (trend === "rising" && current >= 4.5)
        ? "recession_risk_increasing"
        : "stable";

    return {
      current: this.round(current),
      previous: this.round(previous),
      change: this.round(change),
      trend,
      sahm_rule_trigger: sahmRule,
      signal,
    };
  }

  private buildYieldCurveInsight(series: MacroDataPoint[]): YieldCurveInsight {
    const currentPoint = this.latestPoint(series);
    const prevPoint = this.previousPoint(series);

    const spread = currentPoint.value;
    const previous = prevPoint.value;
    const change = spread - previous;
    const inversion = spread < 0;

    const curveShape: YieldCurveInsight["curve_shape"] =
      change > 0.05 ? "steepening" : change < -0.05 ? "flattening" : "stable";

    const signal: YieldCurveInsight["signal"] = inversion
      ? "recession_signal"
      : "normal";

    return {
      spread_10y_2y: this.round(spread),
      previous_spread: this.round(previous),
      change: this.round(change),
      inversion,
      curve_shape: curveShape,
      signal,
    };
  }

  private deriveMacroRegime(
    inflation: InflationInsight,
    gdp: GDPInsight,
    unemployment: UnemploymentInsight,
    yieldCurve: YieldCurveInsight,
    rates: InterestRateInsight
  ): MacroInsightsPayload["macro_insights"]["macro_regime"] {
    if (
      unemployment.sahm_rule_trigger ||
      (yieldCurve.inversion && gdp.signal === "growth_slowdown")
    ) {
      return "late_cycle_stress";
    }

    if (
      inflation.signal === "inflationary_pressure" &&
      rates.rate_regime === "tightening"
    ) {
      return "inflation_tightening";
    }

    if (
      gdp.signal === "expansion" &&
      inflation.signal === "disinflation" &&
      rates.rate_regime !== "tightening"
    ) {
      return "soft_landing";
    }

    return "mixed_transition";
  }

  private deriveOverallSignal(
    rates: InterestRateInsight,
    inflation: InflationInsight,
    gdp: GDPInsight,
    unemployment: UnemploymentInsight,
    yieldCurve: YieldCurveInsight
  ): { overall_signal: MacroInsightsPayload["macro_insights"]["overall_signal"]; confidence: number } {
    const riskOffFlags = [
      rates.signal === "bearish_for_equities_bonds",
      inflation.signal === "inflationary_pressure",
      gdp.signal === "growth_slowdown",
      unemployment.signal === "recession_risk_increasing",
      yieldCurve.signal === "recession_signal",
    ].filter(Boolean).length;

    const riskOnFlags = [
      rates.signal === "supportive_for_duration_assets",
      inflation.signal === "disinflation",
      gdp.signal === "expansion",
      unemployment.signal === "stable",
      yieldCurve.signal === "normal",
    ].filter(Boolean).length;

    const score = riskOnFlags - riskOffFlags;

    const overall_signal: MacroInsightsPayload["macro_insights"]["overall_signal"] =
      score >= 2 ? "risk_on" : score <= -2 ? "risk_off" : "balanced";

    // Deterministic confidence: stronger agreement among signals => higher confidence.
    const confidence = Math.min(0.95, 0.55 + (Math.abs(score) / 5) * 0.4);

    return {
      overall_signal,
      confidence: this.round(confidence, 2),
    };
  }

  // ---------- PUBLIC: AI-READY INSIGHTS ---------- //
  async getMacroInsights(): Promise<MacroInsightsPayload> {
    const [interestRates, cpi, gdp, unemployment, yieldCurve] = await Promise.all([
      this.getSeries("FEDFUNDS"),
      this.getSeries("CPIAUCSL"),
      this.getSeries("GDP"),
      this.getSeries("UNRATE"),
      this.getSeries("T10Y2Y"),
    ]);

    const interest_rate = this.buildInterestRateInsight(interestRates);
    const inflation = this.buildInflationInsight(cpi, interest_rate.current);
    const gdpInsight = this.buildGDPInsight(gdp);
    const unemploymentInsight = this.buildUnemploymentInsight(unemployment);
    const yieldCurveInsight = this.buildYieldCurveInsight(yieldCurve);

    const macro_regime = this.deriveMacroRegime(
      inflation,
      gdpInsight,
      unemploymentInsight,
      yieldCurveInsight,
      interest_rate
    );

    const { overall_signal, confidence } = this.deriveOverallSignal(
      interest_rate,
      inflation,
      gdpInsight,
      unemploymentInsight,
      yieldCurveInsight
    );

    return {
      macro_insights: {
        interest_rate,
        inflation,
        gdp: gdpInsight,
        unemployment: unemploymentInsight,
        yield_curve: yieldCurveInsight,
        macro_regime,
        overall_signal,
        confidence,
      },
    };
  }
}