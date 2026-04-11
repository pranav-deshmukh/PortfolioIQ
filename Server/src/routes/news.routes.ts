import { Router } from "express";
import { getNews, postNews, getRecentNews } from "../controllers/news.controller";

const router = Router();

router.get("/news", getNews);
router.get("/news/recent", getRecentNews);
router.post("/news", postNews);

export default router;
