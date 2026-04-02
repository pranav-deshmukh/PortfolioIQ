import mongoose from "mongoose";
import Portfolio, { IHolding } from "../models/portfolio.model";

// ─── MongoDB Connection ──────────────────────────────────────────────
const MONGO_URI =
  "mongodb+srv://vns444555_db_user:gw3cpBkxCvqHOgqk@cluster-ain.imjr9lg.mongodb.net/portfolio-db?appName=Cluster-main";

// ─── Asset Pool (realistic tickers across sectors) ───────────────────
export const ASSETS: { symbol: string; name: string; sector: string; priceRange: [number, number] }[] = [
  // Tech
  { symbol: "AAPL",  name: "Apple Inc.",                  sector: "Technology",    priceRange: [165, 195] },
  { symbol: "MSFT",  name: "Microsoft Corp.",             sector: "Technology",    priceRange: [370, 430] },
  { symbol: "GOOGL", name: "Alphabet Inc.",               sector: "Technology",    priceRange: [140, 175] },
  { symbol: "NVDA",  name: "NVIDIA Corp.",                sector: "Technology",    priceRange: [450, 950] },
  { symbol: "META",  name: "Meta Platforms Inc.",          sector: "Technology",    priceRange: [330, 510] },
  { symbol: "TSM",   name: "Taiwan Semiconductor",        sector: "Technology",    priceRange: [100, 160] },

  // Finance
  { symbol: "JPM",   name: "JPMorgan Chase & Co.",        sector: "Finance",       priceRange: [180, 220] },
  { symbol: "V",     name: "Visa Inc.",                   sector: "Finance",       priceRange: [260, 300] },
  { symbol: "GS",    name: "Goldman Sachs Group",         sector: "Finance",       priceRange: [370, 460] },
  { symbol: "BAC",   name: "Bank of America Corp.",       sector: "Finance",       priceRange: [33, 42] },
  { symbol: "BLK",   name: "BlackRock Inc.",              sector: "Finance",       priceRange: [750, 900] },

  // Healthcare
  { symbol: "JNJ",   name: "Johnson & Johnson",           sector: "Healthcare",    priceRange: [150, 170] },
  { symbol: "UNH",   name: "UnitedHealth Group",          sector: "Healthcare",    priceRange: [480, 560] },
  { symbol: "PFE",   name: "Pfizer Inc.",                 sector: "Healthcare",    priceRange: [26, 32] },
  { symbol: "ABBV",  name: "AbbVie Inc.",                 sector: "Healthcare",    priceRange: [160, 195] },
  { symbol: "LLY",   name: "Eli Lilly & Co.",             sector: "Healthcare",    priceRange: [580, 800] },

  // Energy
  { symbol: "XOM",   name: "Exxon Mobil Corp.",           sector: "Energy",        priceRange: [100, 120] },
  { symbol: "CVX",   name: "Chevron Corp.",               sector: "Energy",        priceRange: [145, 170] },
  { symbol: "COP",   name: "ConocoPhillips",              sector: "Energy",        priceRange: [110, 135] },
  { symbol: "SLB",   name: "Schlumberger Ltd.",            sector: "Energy",        priceRange: [45, 60] },

  // Consumer
  { symbol: "AMZN",  name: "Amazon.com Inc.",             sector: "Consumer",      priceRange: [145, 190] },
  { symbol: "TSLA",  name: "Tesla Inc.",                  sector: "Consumer",      priceRange: [175, 340] },
  { symbol: "WMT",   name: "Walmart Inc.",                sector: "Consumer",      priceRange: [160, 185] },
  { symbol: "PG",    name: "Procter & Gamble Co.",        sector: "Consumer",      priceRange: [150, 170] },
  { symbol: "KO",    name: "Coca-Cola Co.",               sector: "Consumer",      priceRange: [58, 65] },
  { symbol: "MCD",   name: "McDonald's Corp.",            sector: "Consumer",      priceRange: [270, 310] },

  // Industrials
  { symbol: "CAT",   name: "Caterpillar Inc.",            sector: "Industrials",   priceRange: [260, 340] },
  { symbol: "BA",    name: "Boeing Co.",                  sector: "Industrials",   priceRange: [180, 240] },
  { symbol: "HON",   name: "Honeywell International",    sector: "Industrials",   priceRange: [195, 220] },
  { symbol: "UPS",   name: "United Parcel Service",      sector: "Industrials",   priceRange: [140, 170] },

  // Real Estate
  { symbol: "AMT",   name: "American Tower Corp.",        sector: "Real Estate",   priceRange: [190, 225] },
  { symbol: "PLD",   name: "Prologis Inc.",               sector: "Real Estate",   priceRange: [110, 135] },

  // Materials
  { symbol: "LIN",   name: "Linde PLC",                  sector: "Materials",     priceRange: [400, 460] },
  { symbol: "APD",   name: "Air Products & Chemicals",   sector: "Materials",     priceRange: [230, 280] },

  // Utilities
  { symbol: "NEE",   name: "NextEra Energy Inc.",         sector: "Utilities",     priceRange: [60, 78] },
  { symbol: "DUK",   name: "Duke Energy Corp.",           sector: "Utilities",     priceRange: [95, 110] },
];

// ─── Helper Functions ────────────────────────────────────────────────

/** Random float between min and max, rounded to `decimals` places */
export function randomFloat(min: number, max: number, decimals = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

/** Random integer between min and max (inclusive) */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick `count` unique random items from an array */
export function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

/**
 * Generate weights that sum to ~1.0
 * Uses Dirichlet-like distribution for realistic allocation spreads
 */
export function generateWeights(count: number): number[] {
  // Generate random raw values using exponential-like distribution
  const raw = Array.from({ length: count }, () => -Math.log(Math.random()));
  const sum = raw.reduce((a, b) => a + b, 0);

  // Normalize so they sum to 1, round to 4 decimals
  let weights = raw.map((v) => parseFloat((v / sum).toFixed(4)));

  // Adjust last weight so total is exactly 1.0000
  const weightSum = weights.reduce((a, b) => a + b, 0);
  weights[weights.length - 1] = parseFloat(
    (weights[weights.length - 1] + (1 - weightSum)).toFixed(4)
  );

  return weights;
}

/** Generate a realistic client ID like "CLT-0001" */
export function generateClientId(index: number): string {
  return `CLT-${String(index + 1).padStart(4, "0")}`;
}

/** Determine risk-aware portfolio value and horizon */
export function getRiskParams(risk: "low" | "medium" | "high") {
  switch (risk) {
    case "low":
      return {
        valueRange: [50_000, 200_000] as [number, number],
        horizonRange: [1, 5] as [number, number],
      };
    case "medium":
      return {
        valueRange: [150_000, 600_000] as [number, number],
        horizonRange: [3, 10] as [number, number],
      };
    case "high":
      return {
        valueRange: [300_000, 1_500_000] as [number, number],
        horizonRange: [5, 20] as [number, number],
      };
  }
}

/**
 * Build holdings array ensuring sector diversity per risk profile:
 *  - low  → heavier on finance, utilities, healthcare (defensive)
 *  - high → heavier on tech, consumer, energy (growth / volatile)
 */
export function buildHoldings(
  risk: "low" | "medium" | "high",
  portfolioValue: number
): IHolding[] {
  const numAssets = randomInt(5, 10);

  // Bias the sector pool depending on risk profile
  let pool = [...ASSETS];
  if (risk === "low") {
    // Double-weight defensive sectors
    const defensive = ASSETS.filter((a) =>
      ["Finance", "Healthcare", "Utilities", "Real Estate"].includes(a.sector)
    );
    pool = [...pool, ...defensive, ...defensive];
  } else if (risk === "high") {
    // Double-weight growth sectors
    const growth = ASSETS.filter((a) =>
      ["Technology", "Consumer", "Energy"].includes(a.sector)
    );
    pool = [...pool, ...growth, ...growth];
  }

  const selected = pickRandom(pool, numAssets);

  // De-duplicate (since bias can duplicate tickers)
  const uniqueMap = new Map(selected.map((a) => [a.symbol, a]));
  const uniqueAssets = [...uniqueMap.values()].slice(0, numAssets);

  const weights = generateWeights(uniqueAssets.length);

  return uniqueAssets.map((asset, i) => {
    const current_price = randomFloat(asset.priceRange[0], asset.priceRange[1]);
    const allocationValue = portfolioValue * weights[i];
    const quantity = Math.max(1, Math.round(allocationValue / current_price));

    return {
      symbol: asset.symbol,
      name: asset.name,
      sector: asset.sector,
      weight: weights[i],
      current_price,
      quantity,
    };
  });
}

// ─── Main Seeder ─────────────────────────────────────────────────────

export async function seed() {
  console.log("🔌 Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to portfolio-db\n");

  // Clear existing data
  const deleted = await Portfolio.deleteMany({});
  console.log(`🗑️  Cleared ${deleted.deletedCount} existing portfolios\n`);

  const riskProfiles: ("low" | "medium" | "high")[] = [
    "low", "low", "low", "low", "low", "low", "low",           // 7 low
    "medium", "medium", "medium", "medium", "medium", "medium", // 6 medium
    "high", "high", "high", "high", "high", "high", "high",     // 7 high
  ];

  // Shuffle risk distribution so it's not ordered
  riskProfiles.sort(() => 0.5 - Math.random());

  const portfolios = riskProfiles.map((risk, index) => {
    const { valueRange, horizonRange } = getRiskParams(risk);
    const portfolio_value = randomFloat(valueRange[0], valueRange[1], 0);
    const investment_horizon_years = randomInt(horizonRange[0], horizonRange[1]);
    const holdings = buildHoldings(risk, portfolio_value);

    return {
      client_id: generateClientId(index),
      portfolio_value,
      risk_profile: risk,
      investment_horizon_years,
      holdings,
    };
  });

  // Insert into DB
  const inserted = await Portfolio.insertMany(portfolios);
  console.log(`🚀 Successfully seeded ${inserted.length} portfolios:\n`);

  // Print summary
  inserted.forEach((p) => {
    const weightSum = p.holdings.reduce((sum, h) => sum + h.weight, 0).toFixed(4);
    const sectors = [...new Set(p.holdings.map((h) => h.sector))].join(", ");
    console.log(
      `  📁 ${p.client_id} | ₹${Number(p.portfolio_value).toLocaleString("en-IN")} | ` +
      `${p.risk_profile.toUpperCase().padEnd(6)} | ${p.investment_horizon_years}yr | ` +
      `${p.holdings.length} assets | Σw=${weightSum} | [${sectors}]`
    );
  });

  console.log("\n✅ Seeding complete!");
  await mongoose.disconnect();
  console.log("🔌 Disconnected from MongoDB.");
  process.exit(0);
}

// Only run when executed directly (not when imported by tests)
const isDirectRun =
  process.argv[1]?.includes("portfolioSeeder") ?? false;

if (isDirectRun) {
  seed().catch((err) => {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
  });
}
