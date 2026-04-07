import { getPortfolioByClientId } from "./portfolioDb.service";

import { PortfolioBasicsService } from "./portfolioBasics.service";
import { PortfolioInsightsService } from "./portfolioInsights.service";
import { RiskMetricsService } from "./riskMetrics.service";
import { MarketDataAPIService } from "./marketData-api.service";

// 🔥 instantiate all services
const basicsService = new PortfolioBasicsService();
const insightsService = new PortfolioInsightsService();
const riskService = new RiskMetricsService();
const marketDataService = new MarketDataAPIService();

export async function getFullPortfolioAnalysis(
    clientId: string,
    options?: { includeRisk?: boolean }
) {
    const includeRisk = options?.includeRisk ?? true;

    // =========================
    // 1. FETCH PORTFOLIO
    // =========================
    const portfolio = await getPortfolioByClientId(clientId);

    if (!portfolio) {
        throw new Error("Portfolio not found");
    }

    const holdings = portfolio.holdings;

    // =========================
    // 2. BASIC CALCULATIONS
    // =========================
    const marketValues = basicsService.calculateMarketValue(
        holdings.map(h => ({
            quantity: h.quantity,
            price: h.current_price   // 🔥 fix here
        }))
    );
    const totalValue = basicsService.calculateTotalValue(marketValues);
    const weights = basicsService.calculateWeights(marketValues, totalValue);

    // =========================
    // 3. DERIVED METRICS
    // =========================
    const hhi = insightsService.calculateHHI(weights);
    const effectiveAssets = insightsService.calculateEffectiveAssets(hhi);
    const top3 = insightsService.calculateTop3Concentration(weights);

    const sectorExposure = insightsService.calculateSectorExposure(
        holdings.map((h, i) => ({
            sector: h.sector,
            weight: weights[i]
        }))
    );

    const assetCount = insightsService.calculateAssetCount(weights);

    const derivedMetrics = {
        totalValue,
        hhi,
        effectiveAssets,
        top3Concentration: top3,
        sectorExposure,
        assetCount
    };

    // =========================
    // 4. RISK METRICS (REAL)
    // =========================
    let riskMetrics = null;

    if (includeRisk) {
        try {
            const symbols = holdings.map(h => h.symbol);

            // 🔥 fetch price data
            const priceDataMap = await marketDataService.getMultiplePrices(symbols);

            const series = symbols
                .map((symbol, index) => {
                    const prices = priceDataMap[symbol] ?? [];

                    return {
                        returns: marketDataService.calculateReturns(prices),
                        weight: weights[index] ?? 0,
                    };
                })
                .filter(item => item.returns.length > 0);

            if (series.length === 0) {
                throw new Error("No valid historical prices returned for risk calculation");
            }

            const minLength = Math.min(...series.map(item => item.returns.length));

            if (minLength <= 0) {
                throw new Error("Insufficient historical data for risk calculation");
            }

            const alignedReturns = series.map(item => item.returns.slice(-minLength));

            const alignedWeights = series.map(item => item.weight);
            const alignedWeightTotal = alignedWeights.reduce((sum, w) => sum + w, 0);
            const normalizedWeights = alignedWeightTotal > 0
                ? alignedWeights.map(w => w / alignedWeightTotal)
                : alignedWeights.map(() => 0);

            // 🔥 portfolio returns
            const portfolioReturns = basicsService.calculatePortfolioReturns(
                alignedReturns,
                normalizedWeights
            );

            // 🔥 market returns
            const indexData = await marketDataService.getIndexPrices("SPX");
            const marketReturns = marketDataService.calculateReturns(indexData.values);

            const alignedMarketReturns = marketReturns.slice(-portfolioReturns.length);

            // =========================
            // FINAL RISK METRICS
            // =========================
            const volatility = riskService.calculateVolatility(portfolioReturns);

            const beta = riskService.calculateBeta(
                portfolioReturns,
                alignedMarketReturns
            );

            const maxDrawdown = riskService.calculateMaxDrawdown(portfolioReturns);

            const var95 = riskService.calculateVaR(portfolioReturns, totalValue);

            const riskLevel = insightsService.calculateRiskLevel(
                volatility,
                var95,
                maxDrawdown
            );

            const riskScore = insightsService.calculateRiskScore(
                volatility,
                var95
            );

            const riskDrivers = insightsService.getRiskDrivers(
                sectorExposure,
                volatility,
                beta,
                top3
            );

            riskMetrics = {
                volatility,
                beta,
                maxDrawdown,
                var95,
                riskLevel,
                riskScore,
                riskDrivers
            };
        } catch (riskError) {
            const riskMessage = riskError instanceof Error
                ? riskError.message
                : "Unknown risk metrics error";

            console.error(`Risk metrics unavailable for client ${clientId}:`, riskError);

            riskMetrics = {
                unavailable: true,
                error: riskMessage,
            };
        }
    }

    // =========================
    // FINAL RESPONSE
    // =========================
    return {
        portfolio,
        derivedMetrics,
        riskMetrics
    };
}