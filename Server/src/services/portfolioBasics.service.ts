// services/portfolioBasics.service.ts

export class PortfolioBasicsService {

  // calculate market value per asset
  calculateMarketValue(assets: { quantity: number; price: number }[]): number[] {
    return assets.map(asset => asset.quantity * asset.price);
  }

  // calculate total portfolio value
  calculateTotalValue(marketValues: number[]): number {
    return marketValues.reduce((sum, value) => sum + value, 0);
  }

  // calculate weights
  calculateWeights(marketValues: number[], totalValue: number): number[] {
    if (totalValue === 0) return marketValues.map(() => 0);
    return marketValues.map(value => value / totalValue);
  }

  // calculate daily returns
  calculateDailyReturns(priceHistory: number[][]): number[][] {
    // priceHistory = [[asset1 prices], [asset2 prices], ...]
    return priceHistory.map(prices => {
      const returns: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
      }
      return returns;
    });
  }

  // calculate portfolio returns
  calculatePortfolioReturns(
    dailyReturns: number[][],
    weights: number[]
  ): number[] {

    const days = dailyReturns[0].length;
    const portfolioReturns: number[] = [];

    for (let day = 0; day < days; day++) {
      let dailyPortfolioReturn = 0;

      for (let asset = 0; asset < dailyReturns.length; asset++) {
        dailyPortfolioReturn += dailyReturns[asset][day] * weights[asset];
      }

      portfolioReturns.push(dailyPortfolioReturn);
    }

    return portfolioReturns;
  }
}