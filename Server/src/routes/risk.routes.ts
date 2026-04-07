import { Router } from "express";
import { getRisk } from "../controllers/risk.controller";

const router = Router();

router.get("/:clientId", getRisk);

export default router;
