import { Router } from "express";
import { runDataSyncController } from "../controllers/dataSync.controller";

const router = Router();

router.post("/sync/all", runDataSyncController);

export default router;
