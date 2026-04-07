import { Router } from "express";
import { getMacro } from "../controllers/macro.controller";

const router = Router();

router.get("/", getMacro);

export default router;
