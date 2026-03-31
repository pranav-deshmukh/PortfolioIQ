# How the LPL Advisor Copilot Agent Works

## End-to-End Flow

```
┌─────────────────────┐
│   SCHEDULER          │  Every 3 hours (or manual trigger)
│   server.js          │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  LAYER 1             │
│  News Ingestion      │  Fetches a batch of 2-4 news events
│  news_ingestion.js   │
└────────┬────────────┘
         │  Raw news events (headline, body, keywords, category)
         ▼
┌─────────────────────┐
│  LAYER 2             │
│  Analytics Engine    │  ML/Quant models classify & compute metrics
│  analytics_engine.js │
└────────┬────────────┘
         │  Structured metrics (sector impacts, confidence, VaR, client exposures)
         ▼
┌─────────────────────┐
│  LAYER 3             │
│  AI Agent            │  LLM connects dots, reasons across clients
│  agent.js            │
└────────┬────────────┘
         │  Tool calls
         ▼
┌─────────────────────┐
│  LAYER 4             │
│  Tools               │  save_client_insight(), create_alert()
│  tools.js            │
└────────┬────────────┘
         │  Writes to database
         ▼
┌─────────────────────┐
│  LAYER 5             │
│  MongoDB             │  Stores insights, alerts, pipeline runs
│  db.js               │
└────────┬────────────┘
         │  Read by
         ▼
┌─────────────────────┐
│  LAYER 6             │
│  Dashboard UI        │  Simple web page to view results
│  views/dashboard.html│
└─────────────────────┘
```

---

## Layer-by-Layer Breakdown

---

### Layer 1: News Ingestion (`news_ingestion.js`)

**What it does:** Simulates a batch of real-world news arriving every 3 hours.

**How it works:**
- There's a pool of 12 realistic news events (Iran war, US tariffs, Fed rate hikes, NVIDIA shortage, oil sanctions, banking crisis, pandemic, Apple buyback, gold surge, European recession, chip export controls, OPEC production changes)
- Each pipeline run randomly picks 2-4 events from the pool
- Each event has: `headline`, `body`, `category` (macro/earnings/geopolitical/policy), `keywords`, `raw_sentiment_hint`, `regions`

**What it outputs:**
```json
{
  "event_id": "batch_1711..._0",
  "headline": "NVIDIA reports AI chip shortage, delays next-gen GPU shipments",
  "body": "NVIDIA announced significant production delays...",
  "category": "earnings",
  "keywords": ["nvidia", "ai", "chips", "semiconductor", "gpu", "shortage", "tech"],
  "raw_sentiment_hint": "bearish"
}
```

**In production:** This would call a real API (Bloomberg, Reuters, Alpha Vantage News) and deduplicate against previously seen events.

---

### Layer 2: Analytics Engine (`analytics_engine.js`)

**What it does:** Takes raw news events and produces quantitative metrics. This is the ML/quant layer — all heavy computation happens here, NOT in the LLM.

**How it works (3 sub-steps):**

#### Step 2a: Event Classification + Sector Impact

The engine scans each event's text against a keyword→sector impact mapping table:

```
Keyword "iran" matches →
  energy: +15%, bonds: -2%, tech: -3%, commodities: +10%, international: -6%, financials: -3%

Keyword "oil" matches →
  energy: +12%, bonds: -3%, tech: -4%, commodities: +8%, international: -5%
```

If an event matches multiple keywords, their impacts **accumulate**. For example, "Iran launches missiles, oil routes threatened" matches both "iran" AND "oil", so energy gets +15% + 12% = +27%.

It also computes:
- **Confidence score** (0-95%): Based on how many keywords matched and the event category. Earnings events get higher confidence (concrete data), geopolitical events get lower confidence (more uncertain).
- **Severity** (HIGH/MEDIUM/LOW): Based on maximum absolute sector impact.
- **Sentiment** (BULLISH/BEARISH/MIXED): Based on net impact across all sectors.

**Output per event:**
```json
{
  "headline": "NVIDIA reports AI chip shortage...",
  "sentiment": "BEARISH",
  "confidence": 80,
  "severity": "HIGH",
  "sector_impacts": { "tech": -0.16, "healthcare": 0, "energy": 0 },
  "matched_keywords": ["nvidia", "ai", "semiconductor", "shortage", "tech"]
}
```

#### Step 2b: Portfolio Impact Calculation

For **each client**, the engine maps sector impacts to their specific holdings:

```
Client C004 (Marcus Johnson):
  Holdings: MSFT 20%, AAPL 18%, NVDA 18%, AMZN 15% (all "tech" sector)
  
  Tech sector impact: -16%
  His tech exposure: 71%

  Portfolio impact = 0.20 * (-0.16) + 0.18 * (-0.16) + 0.18 * (-0.16) + 0.15 * (-0.16) + ...
                   = -11.36% raw
  
  Confidence-weighted: -11.36% * (80/100) = -9.09% effective impact
  
  His risk threshold (aggressive): ±10%
  -9.09% < -10%? NO → within limits
```

It also checks: does the effective impact breach the client's risk tolerance threshold?
- Conservative clients: ±2% threshold
- Moderate clients: ±5% threshold  
- Aggressive clients: ±10% threshold

#### Step 2c: VaR (Value at Risk)

For each client, computes:
- **VaR(95%)**: "On 95% of days, the worst loss won't exceed this amount"
- **VaR(99%)**: Same but 99% confidence
- **CVaR(95%)**: "If we're in the worst 5% of days, the average loss is this"

Uses 500 simulated daily returns based on each holding's beta.

**Final analytics output (fed to the AI agent):**
```json
{
  "event_count": 3,
  "event_metrics": [...per-event classification...],
  "aggregated_sector_impacts": { "tech": -0.19, "healthcare": +0.24, ... },
  "avg_confidence": 72,
  "client_impacts": [
    {
      "client_id": "C004",
      "client_name": "Marcus Johnson",
      "total_impact_pct": -3.14,
      "total_impact_dollar": -6908,
      "effective_impact_pct": -2.26,
      "exceeds_threshold": false,
      "holding_impacts": [
        { "ticker": "NVDA", "sector": "tech", "weight": 18, "holding_impact_pct": -2.88 },
        ...
      ],
      "var_metrics": { "var_95": 4200, "var_99": 6100 }
    },
    ...for all 5 clients...
  ],
  "alert_candidates": ["C003"]
}
```

---

### Layer 3: AI Agent (`agent.js`)

**What it does:** Takes ALL the structured metrics from Layer 2 and uses an LLM to:
1. **Connect the dots** — understand causal chains (e.g., "virus → healthcare up → but international down because travel restrictions → energy down because lockdown fears")
2. **Reason across clients** — "C003 has 18% healthcare, they benefit the most, but their conservative profile means even gains can breach thresholds"
3. **Decide what to do** — create alerts or just save insights
4. **Generate human-readable explanations** — plain English that an advisor can read or tell a client

**How it works:**

1. A **system prompt** tells the LLM its role, alert guidelines (CRITICAL >8%, WARNING 3-8%, MONITOR 1-3%), and that it must use tools for every client.

2. A **user message** is constructed with ALL the analytics data — every event's metrics, every client's impact breakdown, their VaR numbers, whether thresholds were breached.

3. The LLM responds with **tool calls**. It has 3 tools available:
   - `get_client_portfolio` — retrieves a client's full holdings details
   - `save_client_insight` — saves an analysis report for a client
   - `create_alert` — creates an alert if a threshold is breached

4. The agent runs in a **loop**: LLM responds → execute tool calls → feed results back → LLM responds again → more tool calls → ... until the LLM is done (no more tool calls).

**Example agent loop (from the real run):**
```
Iteration 1:  LLM calls get_client_portfolio("C004")     → gets Marcus's holdings
Iteration 2:  LLM calls save_client_insight("C004", ...) → saves Marcus's analysis
Iteration 3:  LLM calls get_client_portfolio("C003")     → gets Wong's holdings
Iteration 4:  LLM calls save_client_insight("C003", ...) → saves Wong's analysis
...
Iteration 12: LLM calls create_alert("C003", "WARNING")  → creates alert for Wongs
Iteration 13: LLM done, outputs final summary
```

The agent took **13 iterations** and **263 seconds** to analyze all 5 clients, save 5 insights, and create 1 alert.

**Why the LLM fetches portfolios even though it already has impact data:**
The system prompt encourages the agent to verify details. The analytics data includes holding impacts, but the agent sometimes wants to see the full breakdown (sector %, dollar value per holding) before writing the insight. This is the "agentic" behavior — it plans, gathers info, then acts.

---

### Layer 4: Tools (`tools.js`)

**What it does:** Executes the actions the AI agent decides to take.

**Available tools:**

| Tool | What it does | Writes to DB? |
|------|-------------|---------------|
| `get_client_portfolio` | Returns full holdings, sector breakdown, VaR for a client | No (read-only) |
| `save_client_insight` | Saves a per-client insight with summary, impact analysis, risk assessment, recommendations, talking points, urgency level | Yes → `insights` collection |
| `create_alert` | Creates an alert with severity (CRITICAL/WARNING/MONITOR), title, description, suggested action | Yes → `alerts` collection |

**Example insight saved:**
```json
{
  "client_id": "C003",
  "summary": "James & Patricia Wong's conservative portfolio gained 3.12% ($68,640) primarily due to healthcare surge...",
  "impact_analysis": "The WHO Level 3 health emergency drove healthcare stocks up 24%. With 18% healthcare allocation...",
  "risk_assessment": "Despite the gain being positive, the 3.12% move exceeds the ±2% conservative threshold...",
  "recommendations": "Consider partial profit-taking on JNJ and PFE to rebalance...",
  "talking_points": [
    "Your healthcare holdings performed well, gaining approximately $68,640",
    "However, this level of movement exceeds your comfort zone",
    "We should discuss whether to lock in some gains"
  ],
  "urgency": "medium",
  "created_at": "2026-03-31T15:58:00Z"
}
```

---

### Layer 5: MongoDB (`db.js`)

**What it does:** Persists everything for retrieval by the dashboard.

**Collections:**

| Collection | Contents |
|-----------|----------|
| `news_events` | Raw news events from each batch |
| `insights` | Per-client AI-generated insights (indexed by client_id + timestamp) |
| `alerts` | Active/dismissed alerts (indexed by client_id + status) |
| `pipeline_runs` | Metadata for each pipeline execution (start time, duration, status) |

---

### Layer 6: Dashboard + API (`server.js` + `views/dashboard.html`)

**What it does:** Simple web UI to view the agent's output.

**API endpoints:**
- `GET /api/insights?client_id=C001` — get insights (optionally filtered by client)
- `GET /api/alerts?all=true` — get all alerts
- `POST /api/alerts/:id/dismiss` — dismiss an alert
- `GET /api/pipeline-runs` — get run history
- `GET /api/clients` — get client list
- `POST /api/pipeline/run` — manually trigger a pipeline run

**Dashboard tabs:**
1. **Alerts** — shows all active/dismissed alerts with severity badges
2. **Client Insights** — filterable per-client AI analysis
3. **Pipeline Runs** — history of past runs with status and duration

---

## Example: Full Trace of What Happened

Here's exactly what happened in the run you just saw:

### 1. News Arrived (3 events)
```
→ NVIDIA reports AI chip shortage, delays next-gen GPU shipments by 6 months
→ WHO declares new respiratory virus outbreak, Level 3 global health emergency
→ US semiconductor export controls expanded to include AI training chips to Middle East
```

### 2. Analytics Engine Computed
```
Event 1 (NVIDIA shortage):
  Keywords matched: nvidia, ai, shortage, semiconductor, tech, gpu, chips
  Sector impacts: tech: -16%
  Confidence: 80%, Severity: HIGH

Event 2 (WHO virus):
  Keywords matched: pandemic, virus, pharma, healthcare
  Sector impacts: healthcare: +24%, tech: -4%, international: -14%, energy: -6%
  Confidence: 65%, Severity: HIGH

Event 3 (Chip export controls):
  Keywords matched: semiconductors, ai, chips, tech, policy
  Sector impacts: tech: +1% (net offset from multiple keywords)
  Confidence: 73%, Severity: LOW

AGGREGATED across all events:
  healthcare: +24%  (big winner — pandemic fears)
  international: -14%  (global growth fears)
  energy: -6%  (lockdown demand destruction)
  tech: -19%  (shortage + export controls, slightly offset)
  commodities: -5%
```

### 3. Portfolio Impacts Calculated
```
C003 (Wongs, conservative):  +3.12% ($68,640)  — 18% healthcare helped
  ⚠ BREACHES ±2% conservative threshold

C004 (Johnson, aggressive):  -3.14% ($6,908)   — 71% tech hurt
  ✅ Within ±10% aggressive threshold

C002 (Mitchell, aggressive): -2.40% ($13,200)  — 55% tech hurt
  ✅ Within ±10% aggressive threshold

C001 (Chen, moderate):       -1.54% ($15,400)  — balanced, modest loss
  ✅ Within ±5% moderate threshold

C005 (Navarro, moderate):    +0.50% ($4,375)   — diversified, minimal
  ✅ Within ±5% moderate threshold
```

### 4. AI Agent Connected the Dots
The agent noticed:
- The virus outbreak was the **dominant event** — healthcare surged while international/energy fell
- NVIDIA shortage and chip export controls largely **canceled each other out** on tech
- C003 (Wongs) has a **paradox**: they GAINED money, but the move was too large for their conservative profile → created a WARNING alert
- C004 (Johnson) lost the most in % terms but his aggressive tolerance absorbs it
- C005 (Navarro) was barely affected due to good diversification

### 5. Agent Took Actions
- **5 insights saved** (one per client, each with tailored analysis + talking points)
- **1 alert created** (WARNING for C003 — conservative threshold breached despite positive return)

### 6. Results Visible on Dashboard
- http://localhost:3001 → Alerts tab shows the WARNING for Wongs
- Insights tab shows AI-generated analysis per client with talking points
- Pipeline Runs tab shows the run completed in 263.2s

---

## Key Architecture Principle

> **Heavy computation is done upfront in the Analytics Engine (Layer 2).**
> **The AI Agent (Layer 3) focuses on reasoning, connecting dots, and explanation — not calculation.**

The LLM never computes VaR or portfolio impact. It receives pre-computed numbers and decides:
- What do these numbers **mean** together?
- Which clients should the advisor **prioritize**?
- What should the advisor **say** to each client?
- Should an **alert** be created?

This keeps the output **deterministic** (same numbers every time) while the explanation is **intelligent** (adapts to context, connects causal chains, personalizes per client).
