import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response } from "express";
import { MarketDataAPIService } from "../services/marketData-api.service";
import { MarketContextAPIService } from "../services/marketContext-api.service";
import { MacroAPIService } from "../services/macroData-api.service";
import { VolatilityAPIService } from "../services/volatility-api.service";
import { NewsAPIService } from "../services/newsData-api.service";

const router = express.Router();

// Services
const marketDataService = new MarketDataAPIService();
const marketContextService = new MarketContextAPIService();
const macroService = new MacroAPIService();
const volatilityService = new VolatilityAPIService();
const newsService = new NewsAPIService();

router.get("/test-all", async (req: Request, res: Response) => {
  try {
    // ---------- 1. STOCK DATA ----------
    const prices = await marketDataService.getHistoricalPrices("AAPL");
    const returns = marketDataService.calculateReturns(prices.values);

    // ---------- 2. INDEX DATA (NEW) ----------
    const indexPrices = await marketDataService.getIndexPrices("SPY");
    const indexReturns = marketDataService.calculateReturns(indexPrices.values);

    // ---------- 3. MARKET CONTEXT ----------
    const profile = await marketContextService.getCompanyProfile("AAPL");
    const marketStatus = await marketContextService.getMarketStatus();

    // ---------- 4. MACRO ----------
    const rates = await macroService.getInterestRates();

    // ---------- 5. VIX (optional safe call) ----------
    let vix: number | null = null;
    try {
      // vix = await volatilityService.getVIX();
    } catch {
      vix = null; // don't break API if VIX fails
    }

    res.json({
      success: true,
      data: {
        // Stock
        priceSample: prices.values.slice(0, 3),
        returnsSample: returns.slice(0, 3),

        // Index (NEW)
        indexPriceSample: indexPrices.values.slice(0, 3),
        indexReturnsSample: indexReturns.slice(0, 3),

        // Context
        companyProfile: profile,
        marketStatus,

        // Macro
        ratesSample: rates.slice(0, 3),

        // Optional
        // vix,
      },
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.get("/test-news", async (req: Request, res: Response) => {
  try {
    const symbols = ["AAPL", "MSFT"];

    const from = "2026-03-25";
    const to = "2026-04-01";

    // ---------- 1. Company News ----------
    const companyNews = await newsService.getCompanyNews(
      "AAPL",
      from,
      to
    );

    // ---------- 2. Market News ----------
    const marketNews = await newsService.getMarketNews();

    // ---------- 3. Portfolio News ----------
    const portfolioNews = await newsService.getPortfolioNews(
      symbols,
      from,
      to
    );

    // ---------- 4. Scoring ----------
    const scoredNews = newsService.scoreNews(
      portfolioNews,
      symbols
    );

    // ---------- 🔥 5. FULL CONTENT ENRICHMENT ----------
    const enrichedNews = await newsService.enrichNewsWithContent(
      scoredNews
    );

    res.json({
      success: true,
      data: {
        companyNewsSample: companyNews.slice(0, 2),
        marketNewsSample: marketNews.slice(0, 2),

        portfolioNewsSample: portfolioNews.slice(0, 2),

        scoredNewsSample: scoredNews.slice(0, 2),

        // 🔥 NEW (IMPORTANT)
        enrichedNewsSample: enrichedNews.map((item) => ({
          headline: item.headline,
          relevanceScore: item.relevanceScore,
          contentPreview: item.fullContent?.slice(0, 300), // limit response
        })),
      },
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
