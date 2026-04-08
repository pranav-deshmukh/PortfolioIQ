import { Request, Response } from "express";
import { runFullDataSync } from "../services/dataSync.service";

export async function runDataSyncController(req: Request, res: Response) {
  try {
    const summary = await runFullDataSync();

    return res.json({
      success: true,
      message: "News, macro and portfolio market prices synced successfully",
      data: summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Data sync failed";

    return res.status(500).json({
      success: false,
      error: message,
    });
  }
}
