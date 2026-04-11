// ── Sample Data: Tickers, Sector Mappings, Risk Thresholds ─────────────
// Client portfolios are now loaded from MongoDB at startup via db.js loadClients().
// This file retains static reference data (ticker metadata, sectors, thresholds)
// and helper functions for converting between holdings formats.

export const TICKERS = {
  MSFT: { sector: "tech", name: "Microsoft", beta: 1.15 },
  AAPL: { sector: "tech", name: "Apple", beta: 1.10 },
  NVDA: { sector: "tech", name: "NVIDIA", beta: 1.60 },
  AMZN: { sector: "tech", name: "Amazon", beta: 1.20 },
  GOOGL: { sector: "tech", name: "Google", beta: 1.05 },
  TSLA: { sector: "consumer", name: "Tesla", beta: 1.80 },
  JPM:  { sector: "financials", name: "JPMorgan", beta: 1.10 },
  BAC:  { sector: "financials", name: "Bank of America", beta: 1.30 },
  V:    { sector: "financials", name: "Visa", beta: 0.95 },
  XOM:  { sector: "energy", name: "ExxonMobil", beta: 0.90 },
  CVX:  { sector: "energy", name: "Chevron", beta: 0.85 },
  JNJ:  { sector: "healthcare", name: "Johnson & Johnson", beta: 0.65 },
  PFE:  { sector: "healthcare", name: "Pfizer", beta: 0.75 },
  UNH:  { sector: "healthcare", name: "UnitedHealth", beta: 0.70 },
  AGG:  { sector: "bonds", name: "US Agg Bond ETF", beta: 0.10 },
  BND:  { sector: "bonds", name: "Vanguard Total Bond", beta: 0.08 },
  GLD:  { sector: "commodities", name: "Gold ETF", beta: 0.05 },
  VEA:  { sector: "international", name: "Vanguard FTSE Developed", beta: 0.80 },
  CASH: { sector: "cash", name: "Cash", beta: 0.00 },
  PG:   { sector: "consumer", name: "Procter & Gamble", beta: 0.55 },
  KO:   { sector: "consumer", name: "Coca-Cola", beta: 0.60 },
  AMT:  { sector: "real_estate", name: "American Tower", beta: 0.75 },
};

export const SECTORS = [
  "tech", "financials", "energy", "healthcare",
  "bonds", "commodities", "international", "cash",
  "consumer", "real_estate"
];

// Risk tolerance thresholds — max acceptable portfolio impact before alert
export const RISK_THRESHOLDS = {
  conservative: 0.02,  // 2% max
  moderate:     0.05,  // 5% max
  aggressive:   0.10   // 10% max
};

/**
 * Convert a { ticker: weight } map (used for proposed/hypothetical portfolios)
 * into the new holdings array format, using TICKERS for metadata fallback.
 */
export function holdingsMapToArray(holdingsMap) {
  return Object.entries(holdingsMap).map(([symbol, weight]) => ({
    symbol,
    name: TICKERS[symbol]?.name || symbol,
    sector: TICKERS[symbol]?.sector || "other",
    weight: Number(weight),
    purchase_price: 0,
    current_price: 0,
    quantity: 0,
  }));
}
