import { Request, Response } from "express";
import { MacroAPIService } from "../services/macroData-api.service";

export const getMacro = async (req: Request, res: Response) => {
  try {
    const macroService = new MacroAPIService();

    const [interestRates, cpi, gdp, unemployment, yieldCurve] = await Promise.all([
      macroService.getInterestRates(),
      macroService.getCPI(),
      macroService.getGDP(),
      macroService.getUnemployment(),
      macroService.getYieldCurve(),
    ]);

    res.json({
      success: true,
      data: {
        interest_rates: interestRates,
        cpi,
        gdp,
        unemployment,
        yield_curve: yieldCurve,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch macro data" });
  }
};
