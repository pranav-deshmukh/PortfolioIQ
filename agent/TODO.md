# PortfolioIQ Agent — What's Not Done Yet

## 🐛 Bugs to Fix

### 1. Bearish Sentiment Hint Ignored
- **File:** `analytics_engine.js` (lines 93-97)
- **Issue:** The `raw_sentiment_hint` field on news events is never used. The loop body is empty — bearish events score identically to bullish ones with the same keywords.
- **Fix:** When `raw_sentiment_hint === "bearish"`, amplify negative sector impacts by ~1.3x and dampen positive ones by ~0.7x. Do the inverse for `"bullish"`.

### 2. Pipeline Run Counters Always Zero
- **File:** `pipeline.js` (lines 18-22)
- **Issue:** `alerts_created` and `insights_created` are initialized to `0` but never incremented after the agent creates alerts/insights. Dashboard always shows 0.
- **Fix:** Have `executeTool` in `tools.js` return counts, or track them in the pipeline result after the agent finishes. Alternatively, query the DB for counts created after `startedAt`.

### 3. SSL Disabled Globally
- **File:** `agent.js` (line 9)
- **Issue:** `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"` disables SSL verification for the entire Node process, including MongoDB connections.
- **Fix:** Use a custom HTTPS agent only for the OpenRouter fetch call, or remove this once certificate issues are resolved.

### 4. No `.env.example`
- **Issue:** Project requires `OPENROUTER_API_KEY` and `MONGODB_URI` but there's no example file for onboarding.
- **Fix:** Create `agent/.env.example` with placeholder values.

---

## 🔧 Missing Quant Engines (Pure Math — No ML Needed)

These are described in `prompt.md` as core quant engines. The math exists in `index.html` but is **not** in the agent pipeline — the AI agent never sees stress test or Monte Carlo results.

### 1. Stress Tests
- **What:** Apply historical crisis shocks (2008, COVID, 2022 rate shock, oil spike, tech selloff) to each client's portfolio weights.
- **Math:** `impact = sum(holding_weight × sector_shock)` for each scenario.
- **Where:** Add to `analytics_engine.js`, include results in the analytics output fed to the agent.
- **Agent benefit:** Agent can say "In a 2008-like crash, Client C004 loses 38% ($83K) due to 71% tech concentration."

### 2. Monte Carlo Simulation
- **What:** Run 1,000 random future paths per client using log-normal returns.
- **Math:** `drift = mean - σ²/2`, then compound `exp(drift + σ × Z)` for `years × 252` days.
- **Output:** P10, P25, Median, P75, P90 terminal values, probability of positive outcome.
- **Where:** Add to `analytics_engine.js`.
- **Agent benefit:** Agent can say "Marcus has a 45% chance of his $220K growing above $500K in 30 years, but a 10th-percentile outcome of $95K."

### 3. Correlation Shock Analysis
- **What:** Test what happens when sector correlations spike (diversification failure).
- **Math:** Increase off-diagonal entries in the covariance matrix (e.g., tech correlation from 0.6 → 0.9), recompute portfolio volatility.
- **Output:** Portfolio vol change under stressed correlations.
- **Where:** New function in `analytics_engine.js`.
- **Agent benefit:** Agent can say "If tech and financials become highly correlated (crisis scenario), C001's portfolio volatility rises 18%."

### 4. Factor Exposure Analysis
- **What:** Decompose each portfolio's returns into Fama-French style factors (market, value, momentum, size, quality).
- **Math:** OLS regression of portfolio returns on factor returns.
- **Output:** Factor loadings per client (e.g., "1.4 market, -0.3 momentum, 0.5 value").
- **Where:** New function in `analytics_engine.js`.
- **Agent benefit:** Agent can say "C002 has heavy momentum exposure — vulnerable if growth/momentum reverses."

---

## 🤖 ML Models to Replace Simulated Logic

Currently simulated with rule-based logic. These are the real ML models described in `prompt.md`.

### 1. Event Impact Classifier (currently: keyword lookup)
- **Current:** `SECTOR_IMPACT_RULES` in `analytics_engine.js` — string matching keywords to sector impacts.
- **Real version:** XGBoost/GradientBoosting classifier trained on TF-IDF features of news text + historical price reactions.
- **Output:** Sector impact percentages + confidence score.
- **Stack:** Python scikit-learn, deploy via API or SageMaker endpoint.

### 2. Volatility Forecasting (currently: not implemented)
- **Current:** VaR uses synthetic seeded returns. No actual volatility forecast exists.
- **Real version:** GARCH(1,1) / EGARCH model fit on 1-year daily returns per ticker.
- **Output:** 30-day forward annualized volatility per ticker.
- **Stack:** Python `arch` library, one model per ticker.

### 3. Risk Scoring (currently: threshold comparison only)
- **Current:** Just checks if impact exceeds risk tolerance threshold.
- **Real version:** RandomForest trained on 12+ features (portfolio beta, tech exposure, bond exposure, max drawdown, Sharpe ratio, age factor, time horizon, daily volatility, etc.).
- **Output:** Risk score 0-100 per client + feature importances.
- **Stack:** Python scikit-learn, retrain on portfolio changes.

### 4. Anomaly Detection (currently: not implemented)
- **Current:** Nothing.
- **Real version:** Isolation Forest or Z-score on portfolio return residuals (30-day rolling window).
- **Output:** Flag unusual moves — "Gold -4% today = 3σ event (top 1% unusual)."
- **Stack:** Python scikit-learn.

### 5. Regime Detection (currently: keyword-based rules)
- **Current:** `detectRegime()` in `analytics_engine.js` matches trigger keywords to preset regimes.
- **Real version:** Hidden Markov Model (HMM) on returns + volatility to detect bull/bear/high-vol states.
- **Output:** Current regime + transition probability (e.g., "Entering high-vol regime, prob 65%").
- **Stack:** Python `hmmlearn`, 3 states (low/med/high vol).

---

## 📡 Production Data Feeds (Currently All Simulated)

| Feed | Current | Production |
|------|---------|------------|
| News | `NEWS_POOL` array in `news_ingestion.js` | Bloomberg, Reuters, Alpha Vantage News API |
| Market data | Seeded PRNG returns | Alpha Vantage, Yahoo Finance, Polygon.io |
| Portfolio holdings | Static `CLIENTS` array | Custodian API / Wealthbox / Orion CRM |
| Macro calendar | Not implemented | Fed API, economic calendar feeds |
| Earnings/events | Baked into news pool | Earnings whisper API, SEC EDGAR |

---

## 🛡️ Governance & Compliance (Not Started)

Per `prompt.md`, a production system needs:

- [ ] **Audit log writer** — log every agent decision with reasoning
- [ ] **Source citation tracker** — attach news sources to every insight
- [ ] **Human approval workflow** — advisor must approve before client-facing comms
- [ ] **Threshold and cooldown rules** — don't spam alerts on same event
- [ ] **Model monitoring and fallback** — detect when ML models degrade
- [ ] **Explainability layer** — show why each recommendation was made (FINRA requirement)

---

## 💬 Communication Tools (Not Started)

- [ ] **Advisor summary generator** — daily digest email/report
- [ ] **Client-friendly explanation generator** — plain English for clients
- [ ] **Meeting prep note generator** — pre-meeting brief per client
- [ ] **Compliance review draft generator** — reviewable notes for compliance team

---

## Priority Order (Recommended)

1. **Fix bugs** (bearish sentiment, pipeline counters) — 30 min
2. **Add stress tests to pipeline** — 1 hr (port from index.html)
3. **Add Monte Carlo to pipeline** — 1 hr (port from index.html)
4. **Add correlation shocks** — 1 hr (new math)
5. **Add `.env.example`** — 5 min
6. **Factor exposure analysis** — 2 hrs
7. **ML model swap-in** — days/weeks per model
8. **Governance/compliance** — production phase
