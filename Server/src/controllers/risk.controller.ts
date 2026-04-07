import { Request, Response } from "express";
import { getFullPortfolioAnalysis } from "../services/portfolioOrchestrator.service";

export const getRisk = async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;

    if (!clientId || Array.isArray(clientId)) {
      return res.status(400).json({
        success: false,
        message: "Valid clientId is required",
      });
    }

    const analysis = await getFullPortfolioAnalysis(clientId, { includeRisk: true });
    const riskMetrics = analysis.riskMetrics;

    if (!riskMetrics) {
      return res.status(404).json({
        success: false,
        message: "Risk metrics not found",
      });
    }

    res.json({
      success: true,
      data: {
        volatility: riskMetrics.volatility,
        beta: riskMetrics.beta,
        var_95: riskMetrics.var95,
        max_drawdown: riskMetrics.maxDrawdown,
        risk_level: riskMetrics.riskLevel,
        drivers: riskMetrics.riskDrivers,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch risk data" });
  }
};
