import { Router } from "express";
import { getRisk } from "../controllers/risk.controller";

const router = Router();

router.get("/risk/:clientId", getRisk);

export default router;
