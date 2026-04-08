import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Portfolio, { IHolding } from "../models/portfolio.model";

const MONGO_URI =
  process.env.MONGO_URI || process.env.MONGODB_ACCESS_URI || "mongodb+srv://vns444555_db_user:gw3cpBkxCvqHOgqk@cluster-main.imjr9lg.mongodb.net/?appName=Cluster-main";
const TARGET_DB = "portfolio-db";

/* ---------------- ASSETS ---------------- */

const ASSETS = [
  { symbol: "AAPL", name: "Apple", sector: "Technology", range: [160, 200] },
  { symbol: "MSFT", name: "Microsoft", sector: "Technology", range: [350, 420] },
  { symbol: "GOOGL", name: "Google", sector: "Technology", range: [130, 170] },
  { symbol: "NVDA", name: "NVIDIA", sector: "Technology", range: [400, 900] },

  { symbol: "JPM", name: "JPMorgan", sector: "Finance", range: [170, 220] },
  { symbol: "V", name: "Visa", sector: "Finance", range: [250, 300] },

  { symbol: "XOM", name: "Exxon", sector: "Energy", range: [95, 120] },
  { symbol: "CVX", name: "Chevron", sector: "Energy", range: [140, 170] },

  { symbol: "AMZN", name: "Amazon", sector: "Consumer", range: [140, 190] },
  { symbol: "TSLA", name: "Tesla", sector: "Consumer", range: [170, 320] },

  { symbol: "JNJ", name: "Johnson", sector: "Healthcare", range: [150, 170] },
  { symbol: "UNH", name: "UnitedHealth", sector: "Healthcare", range: [450, 550] },
];

/* ---------------- HELPERS ---------------- */

const rand = (min: number, max: number) =>
  +(Math.random() * (max - min) + min).toFixed(2);

const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const pick = (arr: any[], n: number) =>
  [...arr].sort(() => 0.5 - Math.random()).slice(0, n);

/* ---------------- HOLDINGS ---------------- */

function buildHoldings(portfolioValue: number): IHolding[] {
  const selected = pick(ASSETS, randInt(5, 8));

  const weights = selected.map(() => Math.random());
  const total = weights.reduce((a, b) => a + b, 0);
  const normalized = weights.map((w) => w / total);

  return selected.map((asset, i) => {
    const current_price = rand(asset.range[0], asset.range[1]);

    // realistic purchase price (±20%)
    const purchase_price = rand(
      current_price * 0.8,
      current_price * 1.2
    );

    const allocation = portfolioValue * normalized[i];
    const quantity = Math.max(1, Math.round(allocation / purchase_price));

    return {
      symbol: asset.symbol,
      name: asset.name,
      sector: asset.sector,
      weight: +normalized[i].toFixed(4),
      purchase_price,
      current_price,
      quantity,
    };
  });
}

/* ---------------- MAIN SEED ---------------- */

async function seed() {
  console.log("Connecting DB...");
  await mongoose.connect(MONGO_URI, { dbName: TARGET_DB });
  console.log(`Connected to DB: ${mongoose.connection.db?.databaseName}`);

  console.log("Deleting old portfolios...");
  await Portfolio.deleteMany({}); // 🔥 IMPORTANT

  const risks: ("low" | "medium" | "high")[] = [
    ...Array(7).fill("low"),
    ...Array(6).fill("medium"),
    ...Array(7).fill("high"),
  ].sort(() => 0.5 - Math.random());

  const portfolios = risks.map((risk, i) => {
    const value =
      risk === "low"
        ? randInt(50_000, 200_000)
        : risk === "medium"
        ? randInt(150_000, 600_000)
        : randInt(300_000, 1_500_000);

    return {
      client_id: `CLT-${Date.now()}-${i}`, // always unique
      portfolio_value: value,
      risk_profile: risk,
      investment_horizon_years: randInt(1, 15),
      holdings: buildHoldings(value),
    };
  });

  await Portfolio.insertMany(portfolios);

  console.log(`✅ Inserted ${portfolios.length} portfolios`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});