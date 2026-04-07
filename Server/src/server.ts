import dotenv from "dotenv";
dotenv.config();

import express from "express";

// Optional: if you have routes
import testRoutes from "./routes/test.route";
import portfolioRoutes from "./routes/portfolio.routes";
import newsRoutes from "./routes/news.routes";

const app = express();

// Middleware
app.use(express.json());

// Health check route
app.get("/", (req, res) => {
  res.send("🚀 Server is running");
});

// Routes
app.use("/api", testRoutes);
app.use("/", portfolioRoutes);
app.use("/api", newsRoutes);

// Port
const PORT = process.env.PORT || 3001;

// Start server
app.listen(PORT, () => {
  console.log(`🔥 Server running on http://localhost:${PORT}`);
});
