// ── Manual Pipeline Runner ────────────────────────────────────────────
// Run this to manually trigger one pipeline cycle:
//   node run_pipeline.js
// Optionally pass the number of news events:
//   node run_pipeline.js 5

import dotenv from "dotenv";
dotenv.config();

import { connectDB, closeConnection } from "./db.js";
import { runPipeline } from "./pipeline.js";

const newsCount = parseInt(process.argv[2]) || 3;

async function main() {
  await connectDB();
  const result = await runPipeline(newsCount);
  console.log("\n── Result ──");
  console.log(`Status: ${result.status}`);
  console.log(`Duration: ${result.duration_seconds?.toFixed(1) || "?"}s`);
  if (result.error) console.log(`Error: ${result.error}`);
  await closeConnection();
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
