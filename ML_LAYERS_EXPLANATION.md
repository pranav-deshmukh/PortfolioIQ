# ML Layers — How the Algorithms Work

PortfolioIQ uses three ML layers to turn raw portfolio data and market news into structured, explainable signals before anything is passed to the LLM.

---

## 1) Event Impact Classifier

### What it does
This model takes a financial headline and optional description, then predicts the expected impact on 7 market sectors:

- tech
- financials
- energy
- healthcare
- bonds
- commodities
- international

It also predicts a confidence score for how reliable that impact estimate is.

### Why it exists
Financial news is unstructured text. A portfolio engine cannot directly reason over headlines like *"Saudi Arabia halts petroleum exports"* or *"ECB surprises with aggressive tightening"*.  
This layer converts those headlines into structured sector-impact signals that downstream portfolio logic can use.

### How the algorithm works

#### Step 1: Define target sector impact rules
The notebook starts from a rule base copied from `analytics_engine.js`.

Each keyword is mapped to sector impact values, for example:

- `"oil"` → energy up, commodities up, tech down, bonds down
- `"rate hike"` → bonds down, tech down, financials up
- `"banking crisis"` → financials down, bonds down, tech down

These rules act as the initial source of truth.

#### Step 2: Generate synthetic training data
Because there is no large labeled dataset of headlines with exact sector-return labels, the notebook creates one synthetically.

For each keyword:
- it defines many synonyms
- it defines multiple headline templates
- it defines short body/description templates
- it randomly combines them into realistic text samples

Example idea:
- keyword: `oil`
- synonym: `petroleum`
- template: `"Global {kw} markets rattled by geopolitical tensions"`
- final text: `"Global petroleum markets rattled by geopolitical tensions. Energy markets reacted sharply..."`

The label for that text is the sector impact vector associated with the original keyword.

A small amount of Gaussian noise is added to the label values so the model does not memorize a single exact number per pattern.

The notebook also creates neutral samples with near-zero impacts so the model can learn when a story should have no meaningful market effect.

#### Step 3: Convert text into embeddings
Instead of TF-IDF, the notebook uses the sentence-transformer model:

- `all-MiniLM-L6-v2`

This converts each full text sample into a 384-dimensional embedding vector.

Why this matters:
- TF-IDF mainly matches words
- embeddings capture meaning

So:
- *"petroleum exports halted"* and *"oil supply disrupted"* land near each other
- unseen phrasing can still map to the right market theme

#### Step 4: Train the sector impact model
The model uses:

- `XGBRegressor`
- wrapped inside `MultiOutputRegressor`

This means:
- one XGBoost regressor is trained per sector
- all 7 sector outputs are predicted from the same 384-dim embedding input

Input:
- embedded headline + description

Output:
- 7 continuous values, one per sector impact

So the model is not classifying a headline into one label.  
It is doing **multi-output regression**, which is more useful because one event can affect several sectors at once.

#### Step 5: Evaluate the model
The notebook evaluates:
- **MAE** for prediction error magnitude
- **R²** for fit quality
- **direction accuracy** for whether the model got positive / negative / neutral direction right

That last metric matters because in markets, knowing the correct direction of impact is often more important than predicting the exact basis-point magnitude.

#### Step 6: Test on novel headlines
The notebook explicitly tests the model on headlines that do not match the original keyword rules word-for-word.

Examples include:
- petroleum export halts
- ECB tightening
- TSMC production delays
- bank failures
- vaccine announcements

This checks whether the embedding-based model generalizes beyond direct keyword matching.

#### Step 7: Train a confidence estimator
A second XGBoost regressor is trained to estimate confidence.

Confidence labels are generated using a heuristic:
- earnings and policy items get higher base confidence
- geopolitical items get lower confidence
- neutral/unknown items get low confidence

This lets the system return both:
- predicted sector impacts
- how much trust to place in them

#### Step 8: Inference output
At runtime, the notebook’s `predict_impact()` logic:
1. concatenates headline + description
2. encodes the text into an embedding
3. predicts the 7 sector impacts
4. predicts confidence
5. derives:
   - sentiment
   - severity
   - net impact

### In one sentence
The Event Impact Classifier converts raw financial news into structured, sector-level impact predictions using semantic text embeddings and XGBoost regression.

---

## 2) Portfolio Risk Scorer

> Note: this section should be checked against the exact notebook implementation.

### What it does
This model takes a client portfolio allocation and returns:
- a risk score
- a risk category
- key drivers of that risk
- rebalance guidance

### Why it exists
A raw portfolio allocation is hard to interpret quickly.  
An advisor or downstream system needs a single risk signal that explains whether the portfolio is concentrated, defensive, aggressive, or misaligned with the intended profile.

### How the algorithm works

#### Step 1: Start from portfolio weights
The model uses the portfolio’s sector allocation as the base input.

Typical inputs are likely percentages across major sectors or asset buckets such as:
- tech
- financials
- energy
- healthcare
- bonds
- commodities
- international

#### Step 2: Engineer portfolio-level risk features
The notebook likely derives features that summarize the structure of the portfolio rather than relying only on raw weights.

Common examples:
- max sector concentration
- top-2 / top-3 concentration
- diversification score
- bond allocation
- cyclical vs defensive exposure
- international exposure
- commodity exposure
- overall balance across sectors

These features matter because risk is not just about *what* is in the portfolio, but also *how concentrated* the portfolio is.

#### Step 3: Build target risk labels
The notebook likely creates a target risk score using portfolio rules and synthetic scenarios.

Typical logic:
- concentrated portfolios get higher risk
- portfolios with low bond allocation get higher risk
- aggressive growth-heavy mixes get higher risk
- diversified or defensive allocations get lower risk

From that score, the system can map into categories such as:
- Conservative
- Moderate
- Aggressive

#### Step 4: Train an XGBoost model
The model then learns the mapping:

**portfolio features → risk score**

XGBoost is a strong choice here because:
- it handles nonlinear interactions well
- it works well on tabular data
- it can capture combinations like:
  - high tech + low bonds
  - high concentration + low diversification
  - high international + high cyclical exposure

#### Step 5: Explain the drivers
After scoring, the notebook likely translates the feature values into human-readable drivers such as:
- high technology concentration
- low defensive allocation
- limited bond buffer
- excessive exposure to one or two sectors

This is important because an advisor does not just need a number — they need a reason.

#### Step 6: Suggest rebalance actions
Once the risk score is produced, the system can generate practical actions, for example:
- reduce overconcentrated sectors
- increase bonds or defensive sectors
- improve diversification
- reduce cyclical exposure

### In one sentence
The Portfolio Risk Scorer converts portfolio allocation patterns into a single explainable risk score using engineered diversification and concentration features plus XGBoost.

---

## 3) Volatility / VaR Forecasting Model

> Note: this section should be checked against the exact notebook implementation.

### What it does
This model forecasts future portfolio volatility and downside loss measures such as:
- volatility
- VaR (Value at Risk)
- CVaR (Conditional Value at Risk)
- stressed VaR

### Why it exists
A static allocation-based risk score tells how risky the portfolio looks structurally.  
It does not estimate how much the portfolio could actually move or lose over the next period.  
This model adds a market-statistical risk layer.

### How the algorithm works

#### Step 1: Pull historical market data
The notebook uses historical price data for sector proxies, usually ETFs or market indices representing the portfolio exposures.

Examples:
- tech ETF
- financials ETF
- energy ETF
- healthcare ETF
- bond ETF
- commodity proxy
- international ETF

#### Step 2: Convert prices into returns
The model calculates return series from the price history.

This gives a time series of how each sector proxy moved day by day.

#### Step 3: Construct portfolio return history
Using the client’s portfolio weights, the notebook combines the sector return series into a synthetic historical portfolio return series.

That creates a realistic view of how this exact portfolio would have behaved through time.

#### Step 4: Fit a volatility model
The notebook likely fits a **GARCH-family model** to the portfolio return series.

Why GARCH:
- financial returns show volatility clustering
- calm periods and stressed periods come in waves
- GARCH models changing variance over time better than a simple constant-volatility assumption

So instead of saying "volatility is always the same," the model says:
- recent shocks increase expected future volatility
- quiet periods reduce expected future volatility

#### Step 5: Forecast future volatility
From the fitted model, the notebook forecasts near-term volatility.

This gives a forward-looking estimate of expected portfolio turbulence rather than only a backward-looking historical standard deviation.

#### Step 6: Compute downside risk metrics
Using forecasted volatility and/or simulated return distributions, the notebook computes:

- **VaR**: the loss threshold that should only be exceeded with low probability
- **CVaR**: the average loss in the tail once VaR is breached
- **Stressed VaR**: expected loss under stressed market conditions

This helps answer practical questions like:
- how bad could a 1-day or multi-day loss be?
- what happens under unusually volatile conditions?
- how fat is the downside tail?

#### Step 7: Use portfolio-specific outputs
Because the return series is built from the actual portfolio weights, the results are customized to each client rather than being generic market risk estimates.

### In one sentence
The Volatility / VaR model uses historical sector returns and GARCH-style forecasting to estimate future portfolio volatility and potential downside loss.

---

# How the 3 ML layers work together

These three layers are complementary:

1. **Event Impact Classifier**  
   Converts new market news into structured sector impact signals.

2. **Portfolio Risk Scorer**  
   Measures how risky the client portfolio is structurally based on allocation.

3. **Volatility / VaR Forecasting Model**  
   Quantifies likely future fluctuation and downside loss using historical market behavior.

Together, they answer three different questions:

- **What just happened in the market?** → Event Impact Classifier
- **How risky is this client’s portfolio setup?** → Portfolio Risk Scorer
- **How much could this portfolio move or lose?** → Volatility / VaR Model

---

# Final summary

PortfolioIQ does not rely on a single model.  
It uses a layered ML approach:

- one model to understand **news**
- one model to understand **portfolio structure**
- one model to understand **future statistical risk**

Those structured outputs are then passed to the quant layer and finally to the LLM, which turns them into advisor-ready insights and memory.