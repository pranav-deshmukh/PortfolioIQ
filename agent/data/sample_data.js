// ── Sample Data: Clients, Tickers, Sector Mappings ─────────────────────
// Ported from index.html for the agent pipeline

export const CLIENTS = [
  {
    client_id: "C001",
    name: "Robert & Linda Chen",
    age: 58,
    portfolio_value: 1000000,
    risk_tolerance: "moderate",
    time_horizon_years: 10,
    holdings: {
      MSFT: 0.10, AAPL: 0.08, NVDA: 0.05, JPM: 0.08, XOM: 0.10,
      CVX: 0.05, JNJ: 0.07, AGG: 0.20, BND: 0.05, VEA: 0.10, CASH: 0.12
    }
  },
  {
    client_id: "C002",
    name: "Sarah Mitchell",
    age: 42,
    portfolio_value: 550000,
    risk_tolerance: "aggressive",
    time_horizon_years: 20,
    holdings: {
      MSFT: 0.18, AAPL: 0.15, NVDA: 0.12, AMZN: 0.10, JPM: 0.08,
      BAC: 0.07, JNJ: 0.05, AGG: 0.10, VEA: 0.10, CASH: 0.05
    }
  },
  {
    client_id: "C003",
    name: "James & Patricia Wong",
    age: 68,
    portfolio_value: 2200000,
    risk_tolerance: "conservative",
    time_horizon_years: 5,
    holdings: {
      MSFT: 0.05, JPM: 0.08, BAC: 0.05, XOM: 0.05, JNJ: 0.10,
      PFE: 0.08, AGG: 0.28, BND: 0.12, GLD: 0.07, VEA: 0.05, CASH: 0.07
    }
  },
  {
    client_id: "C004",
    name: "Marcus Johnson",
    age: 35,
    portfolio_value: 220000,
    risk_tolerance: "aggressive",
    time_horizon_years: 30,
    holdings: {
      MSFT: 0.20, AAPL: 0.18, NVDA: 0.18, AMZN: 0.15, JPM: 0.10,
      XOM: 0.05, AGG: 0.07, CASH: 0.07
    }
  },
  {
    client_id: "C005",
    name: "Eleanor & Frank Navarro",
    age: 63,
    portfolio_value: 875000,
    risk_tolerance: "moderate",
    time_horizon_years: 8,
    holdings: {
      MSFT: 0.08, AAPL: 0.07, JPM: 0.08, BAC: 0.05, XOM: 0.08,
      CVX: 0.07, JNJ: 0.08, PFE: 0.05, AGG: 0.15, BND: 0.08,
      GLD: 0.05, VEA: 0.08, CASH: 0.08
    }
  }
];

export const TICKERS = {
  MSFT: { sector: "tech", name: "Microsoft", beta: 1.15 },
  AAPL: { sector: "tech", name: "Apple", beta: 1.10 },
  NVDA: { sector: "tech", name: "NVIDIA", beta: 1.60 },
  AMZN: { sector: "tech", name: "Amazon", beta: 1.20 },
  JPM:  { sector: "financials", name: "JPMorgan", beta: 1.10 },
  BAC:  { sector: "financials", name: "Bank of America", beta: 1.30 },
  XOM:  { sector: "energy", name: "ExxonMobil", beta: 0.90 },
  CVX:  { sector: "energy", name: "Chevron", beta: 0.85 },
  JNJ:  { sector: "healthcare", name: "Johnson & Johnson", beta: 0.65 },
  PFE:  { sector: "healthcare", name: "Pfizer", beta: 0.75 },
  AGG:  { sector: "bonds", name: "US Agg Bond ETF", beta: 0.10 },
  BND:  { sector: "bonds", name: "Vanguard Total Bond", beta: 0.08 },
  GLD:  { sector: "commodities", name: "Gold ETF", beta: 0.05 },
  VEA:  { sector: "international", name: "Vanguard FTSE Developed", beta: 0.80 },
  CASH: { sector: "cash", name: "Cash", beta: 0.00 }
};

export const SECTORS = [
  "tech", "financials", "energy", "healthcare",
  "bonds", "commodities", "international", "cash"
];

// Risk tolerance thresholds — max acceptable portfolio impact before alert
export const RISK_THRESHOLDS = {
  conservative: 0.02,  // 2% max
  moderate:     0.05,  // 5% max
  aggressive:   0.10   // 10% max
};
