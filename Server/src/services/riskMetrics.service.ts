export class RiskMetricsService {

    /* ------------------------------------------------------------
     *  VOLATILITY  (Annualized)
     *  volatility = std(portfolio_returns) * sqrt(252)
     * ------------------------------------------------------------ */

    calculateVolatility(portfolioReturns: number[]): number {
        const n = portfolioReturns.length;
        if (n < 2) return 0;

        const mean = portfolioReturns.reduce((s, r) => s + r, 0) / n;

        const variance =
            portfolioReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);

        const dailyStd = Math.sqrt(variance);

        // Annualise: 252 trading days
        return dailyStd * Math.sqrt(252);
    }

    /* ------------------------------------------------------------
     *  BETA  (vs Market)
     *  beta = cov(portfolio, market) / var(market)
     * ------------------------------------------------------------ */

    calculateBeta(portfolioReturns: number[], marketReturns: number[]): number {
        const n = Math.min(portfolioReturns.length, marketReturns.length);
        if (n < 2) return 0;

        const pSlice = portfolioReturns.slice(0, n);
        const mSlice = marketReturns.slice(0, n);

        const pMean = pSlice.reduce((s, r) => s + r, 0) / n;
        const mMean = mSlice.reduce((s, r) => s + r, 0) / n;

        let covariance = 0;
        let marketVariance = 0;

        for (let i = 0; i < n; i++) {
            const pDiff = pSlice[i] - pMean;
            const mDiff = mSlice[i] - mMean;
            covariance += pDiff * mDiff;
            marketVariance += mDiff * mDiff;
        }

        // sample covariance / sample variance (n-1 cancels out)
        if (marketVariance === 0) return 0;
        return covariance / marketVariance;
    }

    /* ------------------------------------------------------------
     *  MAX DRAWDOWN
     *  cumulative = cumprod(1 + r)
     *  drawdown   = (cumulative - rolling_max) / rolling_max
     *  max_dd     = min(drawdown)
     * ------------------------------------------------------------ */

    calculateMaxDrawdown(portfolioReturns: number[]): number {
        if (portfolioReturns.length === 0) return 0;

        let cumulative = 1;
        let peak = 1;
        let maxDrawdown = 0;

        for (const r of portfolioReturns) {
            cumulative *= (1 + r);

            if (cumulative > peak) {
                peak = cumulative;
            }

            const drawdown = (cumulative - peak) / peak;

            if (drawdown < maxDrawdown) {
                maxDrawdown = drawdown;
            }
        }

        return maxDrawdown; // negative number (e.g. -0.15 means -15 %)
    }

    /* ------------------------------------------------------------
     *  VALUE AT RISK  (VaR 95 %)
     *  var_95     = percentile(portfolio_returns, 5)
     *  var_amount = var_95 * total_value
     *
     *  Returns the monetary VaR amount (negative number).
     * ------------------------------------------------------------ */

    calculateVaR(portfolioReturns: number[], totalValue: number): number {
        if (portfolioReturns.length === 0) return 0;

        const sorted = [...portfolioReturns].sort((a, b) => a - b);

        // 5th percentile (linear interpolation)
        const index = 0.05 * (sorted.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        const frac = index - lower;

        const var95 =
            lower === upper
                ? sorted[lower]
                : sorted[lower] * (1 - frac) + sorted[upper] * frac;

        return var95 * totalValue; // monetary VaR
    }
}
