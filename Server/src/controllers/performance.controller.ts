import { Request, Response } from "express";
import { performanceService } from "../services/performance.service";

export async function getPerformance(req: Request, res: Response) {
  try {
    const { clientId } = req.params;
    const rawSymbols = req.query.symbols;

    const symbols =
      typeof rawSymbols === "string"
        ? rawSymbols
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [];

    // Priority: symbol mode if query symbols are provided.
    if (symbols.length > 0) {
      const data = await performanceService.getPerformance(undefined, symbols);

      return res.json({
        success: true,
        data,
      });
    }

    if (!clientId || Array.isArray(clientId)) {
      return res.status(400).json({
        success: false,
        error: "Provide either clientId path param or symbols query",
      });
    }

    const data = await performanceService.getPerformance(clientId);

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch performance";

    const statusCode = message === "Portfolio not found" ? 404 : 500;

    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
}
