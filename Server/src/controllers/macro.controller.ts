import { Request, Response } from "express";
import { MacroAPIService } from "../services/macroData-api.service";

export const getMacro = async (req: Request, res: Response) => {
  try {
    const macroService = new MacroAPIService();
    const insights = await macroService.getMacroInsights();

    res.json({
      success: true,
      data: insights.macro_insights,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch macro data" });
  }
};
