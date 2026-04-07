import { Request, Response } from "express";
import { getPortfolioByClientId } from "../services/portfolioDb.service";
import { PortfolioBasicsService } from "../services/portfolioBasics.service";
import { portfolioInsightsService } from "../services/portfolioInsights.service";
import { RiskMetricsService } from "../services/riskMetrics.service";
import { MarketDataAPIService, MarketDataAPIError } from "../services/marketData-api.service";

const portfolioBasicsService = new PortfolioBasicsService();
const riskMetricsService = new RiskMetricsService();

function parseIncludeRisk(value: unknown): boolean {
  if (typeof value !== "string") {
    return true;
  }

  return value.toLowerCase() !== "false";
}

function toPlainPortfolio<T>(portfolio: T): T {
  if (
    typeof portfolio === "object" &&
    portfolio !== null &&
    "toObject" in portfolio &&
    typeof (portfolio as { toObject: () => T }).toObject === "function"
  ) {
    return (portfolio as { toObject: () => T }).toObject();
  }

  return portfolio;
}

function isCiscoBlocked(error: unknown): boolean {
  if (!(error instanceof MarketDataAPIError)) {
    return false;
  }

  const body = error.responseBody ?? "";
  return body.includes("block.sse.cisco.com");
}

export async function getPortfolioController(req: Request, res: Response) {
  try {
    let { clientId } = req.params;
    const includeRisk = parseIncludeRisk(req.query.includeRisk);

    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: "clientId is required",
      });
    }

    if (Array.isArray(clientId)) {
      clientId = clientId[0];
    }

    const portfolioDocument = await getPortfolioByClientId(clientId);

    if (!portfolioDocument) {
      return res.status(404).json({
        success: false,
        error: "Portfolio not found",
      });
    }

    const portfolio = toPlainPortfolio(portfolioDocument);
    const holdings = portfolio.holdings ?? [];
    const weights = holdings.map((holding) => holding.weight);
    const sectorData = holdings.map((holding) => ({
      sector: holding.sector,
      weight: holding.weight,
    }));

    const derivedMetrics = {
      hhi: portfolioInsightsService.calculateHHI(weights),
      effective_assets: portfolioInsightsService.calculateEffectiveAssets(
        portfolioInsightsService.calculateHHI(weights)
      ),
      top_3_concentration:
        portfolioInsightsService.calculateTop3Concentration(weights),
      sector_exposure:
        portfolioInsightsService.calculateSectorExposure(sectorData),
      asset_count: portfolioInsightsService.calculateAssetCount(weights),
    };

    let riskMetrics: Record<string, unknown> = {};
    let warnings: string[] = [];

    if (includeRisk) {
      try {
        const marketDataService = new MarketDataAPIService();
        const symbols = holdings.map((holding) => holding.symbol);
        const priceMap = await marketDataService.getMultiplePrices(symbols);
        const series = symbols
          .map((symbol, index) => {
            const returns = marketDataService.calculateReturns(priceMap[symbol] ?? []);
            return {
              returns,
              weight: weights[index] ?? 0,
            };
          })
          .filter((item) => item.returns.length > 0);

        if (series.length === 0) {
          throw new Error("No valid historical prices returned for risk calculation");
        }

        const alignedLength = Math.min(...series.map((item) => item.returns.length));

        if (alignedLength <= 0) {
          throw new Error("Insufficient historical data for risk calculation");
        }

        const normalizedReturns = series.map((item) => item.returns.slice(-alignedLength));

        const alignedWeights = series.map((item) => item.weight);
        const alignedWeightTotal = alignedWeights.reduce((sum, w) => sum + w, 0);
        const normalizedWeights =
          alignedWeightTotal > 0
            ? alignedWeights.map((w) => w / alignedWeightTotal)
            : alignedWeights.map(() => 0);

        const portfolioReturns =
          normalizedReturns.length > 0 && alignedLength > 0
            ? portfolioBasicsService.calculatePortfolioReturns(
                normalizedReturns,
                normalizedWeights
              )
            : [];

        const indexPrices = await marketDataService.getIndexPrices("SPY");
        const indexReturns = marketDataService
          .calculateReturns(indexPrices.values)
          .slice(-portfolioReturns.length);

        const volatility = riskMetricsService.calculateVolatility(
          portfolioReturns
        );
        const beta = riskMetricsService.calculateBeta(
          portfolioReturns,
          indexReturns
        );
        const maxDrawdown = riskMetricsService.calculateMaxDrawdown(
          portfolioReturns
        );
        const varAmount = riskMetricsService.calculateVaR(
          portfolioReturns,
          portfolio.portfolio_value
        );
        const var95 =
          portfolio.portfolio_value === 0
            ? 0
            : varAmount / portfolio.portfolio_value;

        riskMetrics = {
          volatility,
          beta,
          max_drawdown: maxDrawdown,
          var_95: varAmount,
          risk_level: portfolioInsightsService.calculateRiskLevel(
            volatility,
            var95,
            maxDrawdown
          ),
          risk_score: portfolioInsightsService.calculateRiskScore(
            volatility,
            var95
          ),
          key_risk_drivers: portfolioInsightsService.getRiskDrivers(
            derivedMetrics.sector_exposure,
            volatility,
            beta,
            derivedMetrics.top_3_concentration
          ),
        };
      } catch (riskError) {
        const defaultRiskMessage =
          riskError instanceof Error
            ? riskError.message
            : "Unknown risk metrics error";

        const riskMessage = isCiscoBlocked(riskError)
          ? "Market-data provider is blocked by network security (Cisco SSE). Risk metrics are temporarily unavailable."
          : defaultRiskMessage;

        console.error(
          `Risk metrics unavailable for client ${clientId}:`,
          riskError
        );

        warnings.push(`Risk metrics unavailable: ${riskMessage}`);
        riskMetrics = {
          unavailable: true,
          error: riskMessage,
        };
      }
    }

    return res.json({
      success: true,
      data: {
        portfolio,
        derived_metrics: derivedMetrics,
        risk_metrics: riskMetrics,
        warnings,
      },
    });
  } catch (error) {
    console.error("Error fetching portfolio:", error);

    const message = error instanceof Error ? error.message : "Internal server error";

    return res.status(500).json({
      success: false,
      error: message,
    });
  }
}