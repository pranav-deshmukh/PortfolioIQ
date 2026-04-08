import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { runFullDataSync } from "../services/dataSync.service";

async function runSeeder() {
  try {
    const summary = await runFullDataSync();

    console.log("✅ Data sync seeder completed");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error("❌ Data sync seeder failed:", error);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

const isDirectRun = process.argv[1]?.includes("dataSyncSeeder") ?? false;

if (isDirectRun) {
  runSeeder();
}
