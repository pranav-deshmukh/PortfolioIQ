import { Router } from "express";
import { getPerformance } from "../controllers/performance.controller";

const router = Router();

router.get("/performance", getPerformance);
router.get("/performance/:clientId", getPerformance);

export default router;
