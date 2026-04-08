import dotenv from "dotenv";
dotenv.config();

import express from "express";

// Optional: if you have routes
import testRoutes from "./routes/test.route";
import portfolioRoutes from "./routes/portfolio.routes";
import newsRoutes from "./routes/news.routes";
import riskRoutes from "./routes/risk.routes";
import macroRoutes from "./routes/macro.routes";
import performanceRoutes from "./routes/performance.routes";
import dataSyncRoutes from "./routes/dataSync.routes";

const app = express();

// Middleware
app.use(express.json());

// Health check route
app.get("/", (req, res) => {
  res.send("🚀 Server is running");
});

// Routes
app.use("/api", testRoutes);
app.use("/api", portfolioRoutes);
app.use("/api", newsRoutes);
app.use("/api", riskRoutes);
app.use("/api", macroRoutes);
app.use("/api", performanceRoutes);
app.use("/api", dataSyncRoutes);

// Port
const PORT = process.env.PORT || 3001;

// Start server
app.listen(PORT, () => {
  console.log(`🔥 Server running on http://localhost:${PORT}`);
});
