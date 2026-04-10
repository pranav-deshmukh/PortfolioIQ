# PortfolioIQ — What's Remaining

> Updated after full codebase audit. See `WHAT_WORKS.md` for everything functional.

---

## 🎯 Strategic Pivot After Reviewer Feedback

> Reviewer feedback: insight generation from news is already covered by other platforms.  
> The stronger differentiator is **AI copilot + portfolio simulations + advisor decision support**.

### New Product Direction
PortfolioIQ should be positioned as:

**An AI copilot for wealth advisors that helps them discuss portfolio strategy, receive recommendations, simulate proposed changes, and compare outcomes before making decisions.**

### Updated Core Workflow
**Discuss → Recommend → Modify → Simulate → Compare → Decide**

### What To De-emphasize
- News insight generation as the main feature
- Alerting as the primary value proposition
- Static AI summaries of events

### What To Emphasize
- Conversational AI copilot for advisors
- What-if portfolio analysis
- Allocation change simulation
- Stress testing and Monte Carlo simulation
- Comparing current vs proposed portfolio
- Explainable recommendations backed by quant outputs

---

## ✅ New Top Priorities

### 1. AI Copilot for Advisor Discussion
- Make chat/copilot the primary interaction model
- Support questions like:
  - “What are the biggest risks in this portfolio?”
  - “Suggest a safer allocation for the next 3 months.”
  - “What happens if I reduce tech by 10% and move to bonds?”
  - “Compare current allocation vs your recommendation.”
  - “Simulate this portfolio in a recession scenario.”

### 2. Simulation Engine as Core Feature
Focus implementation around advisor-driven simulations instead of only event insights.

#### Must-have simulations
- **Stress tests**
  - recession
  - rate hike
  - oil shock
  - tech selloff
  - geopolitical shock
- **Monte Carlo simulation**
  - 1,000 future paths
  - P10 / P25 / P50 / P75 / P90 terminal values
  - probability of positive outcome
- **Correlation shock analysis**
  - model diversification breakdown
  - recompute stressed volatility
- **Allocation change simulation**
  - compare current vs proposed portfolio
  - show risk-return tradeoff
- **Event-aware simulation**
  - evaluate proposed changes using current market/news context

### 3. Recommendation → Simulation Loop
Target user flow:
1. Advisor opens client portfolio
2. AI explains current risk/exposures
3. AI suggests allocation changes or defensive actions
4. Advisor edits or accepts proposal
5. System runs simulations
6. Dashboard shows before/after metrics and projected outcomes

---

## 🔧 New Implementation Tasks

### 1. Portfolio Comparison Engine
- **Status:** ❌ Missing
- **What:** Compare current portfolio vs proposed portfolio
- **Output:** Delta in VaR, volatility, drawdown, concentration, sector exposure, expected outcome
- **Where:** `analytics_engine.js` + chat tool + dashboard compare view
- **Effort:** 2–3 hrs

### 2. Monte Carlo Simulation
- **Status:** ❌ Not implemented
- **What:** 1,000 simulated future portfolio paths using log-normal returns
- **Math:** `drift = μ - σ²/2`, evolve over `years × 252` days using `exp(drift + σ × Z)`
- **Output:** P10, P25, Median, P75, P90, probability of gain
- **Where:** `analytics_engine.js` + new chat tool
- **Effort:** 1–2 hrs

### 3. Stress Tests in Automated Pipeline
- **Status:** ✅ Available in chat, ❌ Missing in pipeline
- **What:** Include stress test results in analytics output so AI copilot can proactively discuss them
- **Where:** `analytics_engine.js`
- **Effort:** 1 hr

### 4. Correlation Shock Analysis
- **Status:** ❌ Not implemented
- **What:** Increase cross-sector correlations and recompute stressed volatility
- **Output:** Current vol vs stressed vol
- **Where:** `analytics_engine.js` + chat tool
- **Effort:** 1–2 hrs

### 5. Advisor-Editable Allocation Simulation
- **Status:** ❌ Missing
- **What:** Let advisor input revised weights/holdings and simulate immediately
- **Output:** before/after metrics and projected outcomes
- **Where:** chat tool + dashboard UI
- **Effort:** 2–3 hrs

### 6. AI Recommendation Engine
- **Status:** ⚠️ Partial
- **What:** AI suggests allocation changes based on:
  - client risk profile
  - sector concentration
  - event exposure
  - volatility / VaR / drawdown
- **Output:** recommendation text + proposed allocation payload for simulation
- **Where:** `agent.js` / `chat_tools.js`
- **Effort:** 2 hrs

### 7. Simulation Result Explanations
- **Status:** ❌ Missing
- **What:** AI should explain simulation output in advisor-friendly language
- **Examples:**
  - “This change reduces VaR by 18%.”
  - “The portfolio becomes less exposed to rate hikes.”
  - “Upside is slightly lower, but drawdown risk improves materially.”
- **Where:** agent response generation
- **Effort:** 1 hr

---

## 🖥️ Dashboard Priorities for Final Demo

### Must-have
- Chat-first copilot experience
- Compare current vs proposed portfolio
- Stress test output cards
- Monte Carlo summary output
- Before/after risk metrics
- Advisor-editable allocation form

### Nice-to-have
- Charts for simulation paths and before/after comparison
- Saved scenarios
- Simulation history
- Exportable recommendation summary

---

## 🎤 Presentation Repositioning

### Updated problem statement
Advisors need a fast and explainable way to test portfolio decisions before making changes for clients.

### Updated solution statement
PortfolioIQ is an AI copilot that helps advisors discuss portfolio strategy, receive recommendations, simulate the effect of changes, and compare outcomes before execution.

### Strong one-line pitch
**PortfolioIQ is an AI copilot that helps wealth advisors test portfolio decisions through simulations before acting.**

### Demo flow to prioritize
1. Open a client portfolio
2. Ask AI copilot for current risks
3. Ask for a safer or optimized allocation
4. Accept/edit recommendation
5. Run stress test + Monte Carlo + compare metrics
6. Show before/after outcomes
7. Conclude with explainable decision support for advisors

---

## 🐛 Bugs to Fix (Quick Wins)

### 1. Bearish Sentiment Hint Ignored
- **File:** `analytics_engine.js` — `classifyEvent()` sentiment loop
- **Issue:** The `raw_sentiment_hint` field on news events is never used. The loop body is empty — bearish events score identically to bullish ones with the same keywords.
- **Fix:** When `raw_sentiment_hint === "bearish"`, amplify negative sector impacts by ~1.3× and dampen positive ones by ~0.7×. Inverse for `"bullish"`.
- **Effort:** 15 min

---

## 🔧 Missing Quant Engines in Pipeline

> **Note:** Stress tests exist as a **chat tool** (5 scenarios via `run_stress_test` in `chat_tools.js`), but they are NOT part of the automated pipeline. The analytics engine never runs stress tests, Monte Carlo, or correlation shocks — the agent never sees these results during automated runs.

### 1. Stress Tests → Pipeline Integration
- **Status:** ✅ Available in chat, ❌ Missing from pipeline
- **What's needed:** Run stress tests in `analytics_engine.js` during pipeline, include results in the analytics output passed to the agent so it can proactively warn clients.
- **Effort:** 1 hr

### 2. Monte Carlo Simulation
- **Status:** ❌ Not implemented anywhere
- **What:** 1,000 random future paths per client using log-normal returns.
- **Math:** `drift = μ - σ²/2`, compound `exp(drift + σ × Z)` for `years × 252` days.
- **Output:** P10, P25, Median, P75, P90 terminal values, probability of positive outcome.
- **Where:** Add to `analytics_engine.js` + new chat tool.
- **Effort:** 1–2 hrs

### 3. Correlation Shock Analysis
- **Status:** ❌ Not implemented anywhere
- **What:** Test diversification failure when sector correlations spike.
- **Math:** Increase off-diagonal covariance entries (e.g., tech correlation 0.6 → 0.9), recompute portfolio volatility.
- **Output:** Portfolio vol change under stressed correlations.
- **Effort:** 1–2 hrs

### 4. Factor Exposure Analysis
- **Status:** ❌ Not implemented anywhere
- **What:** Fama-French style factor decomposition (market, value, momentum, size, quality).
- **Math:** OLS regression of portfolio returns on factor returns.
- **Output:** Factor loadings per client.
- **Effort:** 2–3 hrs

---

## 📊 Dashboard Features Missing

### 1. Charts & Visualizations
- **Issue:** No charts anywhere — KPI cards show numbers but no trends over time, no portfolio pie charts, no VaR distributions.
- **What's needed:** Recharts or Chart.js integration for:
  - Portfolio allocation pie/donut chart per client
  - Stress test impact bar chart
  - Monte Carlo fan chart (percentile bands over time)
  - Risk heatmap across clients
  - Alert trend over time
- **Effort:** 3–5 hrs

### 2. Chat Persistence
- **Issue:** Chat messages are lost on page refresh. Only server-side conversation history (last 10 turns per session) exists, but no persistence across browser reloads.
- **Fix:** Save messages to `localStorage` or a new MongoDB collection.
- **Effort:** 1 hr

### 3. Alert Filtering & Sorting
- **Issue:** AlertsTab shows all alerts unsorted with no filtering. No way to filter by severity, client, or date.
- **Fix:** Add filter chips (by severity, by client) and sort dropdown (newest, highest severity).
- **Effort:** 1 hr

### 4. Client Detail Page
- **Issue:** No dedicated view for a single client showing their full portfolio, all insights, alerts, and risk metrics in one place.
- **Fix:** New route or modal with portfolio breakdown, historical insights timeline, alert history.
- **Effort:** 2–3 hrs

### 5. Responsive / Mobile Layout
- **Issue:** Dashboard is desktop-only. 65/35 split and horizontal tabs don't work on mobile.
- **Fix:** Tailwind responsive breakpoints, collapsible chat panel, stacked layout on small screens.
- **Effort:** 2 hrs

---

## 🤖 ML Models to Replace Simulated Logic

Currently rule-based. These are the real ML models described in `prompt.md`.

### 1. Event Impact Classifier (currently: keyword lookup)
- **Current:** `SECTOR_IMPACT_RULES` — string matching keywords to sector impacts.
- **Real:** XGBoost/GradientBoosting on TF-IDF features + historical price reactions.
- **Stack:** Python scikit-learn, deploy via API or SageMaker endpoint.

### 2. Volatility Forecasting (currently: seeded PRNG)
- **Current:** VaR uses synthetic seeded returns. No actual volatility forecast.
- **Real:** GARCH(1,1) / EGARCH on 1-year daily returns per ticker.
- **Stack:** Python `arch` library.

### 3. Risk Scoring (currently: threshold comparison)
- **Current:** Checks if impact exceeds risk tolerance threshold.
- **Real:** RandomForest on 12+ features (beta, sector exposure, drawdown, Sharpe, age, horizon, vol).
- **Output:** Risk score 0–100 per client + feature importances.

### 4. Anomaly Detection (not implemented)
- **Real:** Isolation Forest or Z-score on portfolio return residuals (30-day rolling).
- **Output:** Flag unusual moves — "Gold -4% today = 3σ event."

### 5. Regime Detection (currently: keyword rules)
- **Current:** `detectRegime()` matches trigger keywords to preset regimes.
- **Real:** Hidden Markov Model on returns + volatility (3 states: low/med/high vol).

---

## 📡 Production Data Feeds (Currently All Simulated)

| Feed | Current | Production |
|------|---------|------------|
| News | `NEWS_POOL` array (12 events) | Bloomberg, Reuters, Alpha Vantage News API |
| Market data | Seeded PRNG returns | Alpha Vantage, Yahoo Finance, Polygon.io |
| Portfolio holdings | Static `CLIENTS` array (5 clients) | Custodian API / Wealthbox / Orion CRM |
| Macro calendar | Not implemented | Fed API, economic calendar feeds |
| Earnings/events | Baked into news pool | Earnings whisper API, SEC EDGAR |

---

## 🛡️ Governance & Compliance (Not Started)

- [ ] **Audit log writer** — log every agent decision with reasoning
- [ ] **Source citation tracker** — attach news sources to every insight
- [ ] **Human approval workflow** — advisor approves before client-facing comms
- [ ] **Threshold and cooldown rules** — don't spam alerts on same event
- [ ] **Model monitoring and fallback** — detect when ML models degrade
- [ ] **Explainability layer** — show why each recommendation was made (FINRA req)

---

## 💬 Communication Tools (Not Started)

- [ ] **Advisor summary generator** — daily digest email/report
- [ ] **Client-friendly explanation generator** — plain English for clients
- [ ] **Meeting prep note generator** — pre-meeting brief per client
- [ ] **Compliance review draft generator** — reviewable notes for compliance team

---

## 🔐 Production Infrastructure (Not Started)

- [ ] **Authentication** — login for advisors (OAuth / SSO)
- [ ] **Authorization** — role-based access (advisor sees own clients only)
- [ ] **HTTPS / TLS** — proper SSL certificates
- [ ] **Rate limiting** — protect API from abuse
- [ ] **Error monitoring** — Sentry or similar
- [ ] **Database backups** — scheduled MongoDB snapshots
- [ ] **CI/CD** — automated testing + deployment pipeline
- [ ] **Docker** — containerize backend + frontend

---

## Priority Order (Recommended)

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 1 | Fix bugs (bearish sentiment, pipeline counters, fetchPipelineRuns) | 30 min | 🟢 Low effort, removes wrong data |
| 2 | Add `.env.example` | 2 min | 🟢 Dev experience |
| 3 | Add stress tests to pipeline (already in chat) | 1 hr | 🟡 Agent gives proactive warnings |
| 4 | Charts & visualizations (Recharts) | 3–5 hrs | 🔴 Major UX upgrade |
| 5 | Monte Carlo simulation | 1–2 hrs | 🟡 Key quant feature |
| 6 | Chat persistence | 1 hr | 🟡 UX improvement |
| 7 | Alert filtering & sorting | 1 hr | 🟡 UX improvement |
| 8 | Correlation shocks | 1–2 hrs | 🟡 Risk analysis depth |
| 9 | Factor exposure analysis | 2–3 hrs | 🟡 Portfolio decomposition |
| 10 | Client detail page | 2–3 hrs | 🟡 Single-client deep dive |
| 11 | ML model swap-in | Days/weeks | 🔴 Production quality |
| 12 | Governance/compliance | Days | 🔴 Production requirement |
| 13 | Production infrastructure | Days | 🔴 Deployment readiness |
