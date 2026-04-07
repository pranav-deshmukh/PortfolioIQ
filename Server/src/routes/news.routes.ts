import { Router } from "express";
import { getNews } from "../controllers/news.controller";

const router = Router();

router.get("/news", getNews);

export default router;
