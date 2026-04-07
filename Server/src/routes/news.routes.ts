import { Router } from "express";
import { getNews, postNews } from "../controllers/news.controller";

const router = Router();

router.get("/news", getNews);
router.post("/news", postNews);

export default router;
