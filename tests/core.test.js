import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  calculatePortfolio,
  computeCumulativeReturn,
  computeVaRAndCorrelations,
  projectScenarioOutcome,
  backtestPortfolioStrategies,
  MONTHLY_RETURNS
} from '../app-core.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('calculatePortfolio', () => {
  it('calculates totals and allocations using available price data', () => {
    const portfolio = [
      { id: 'bitcoin', amount: 1, buyPrice: 20000, symbol: 'BTC' },
      { id: 'ethereum', amount: 2, buyPrice: 1000, symbol: 'ETH' }
    ];
    const priceData = {
      bitcoin: { usd: 30000, usd_24h_change: 5 }
    };

    const res = calculatePortfolio(portfolio, priceData);

    expect(res.totals.totalValue).toBeCloseTo(32000);
    expect(res.totals.totalCost).toBeCloseTo(22000);
    expect(res.totals.totalPnlAbs).toBeCloseTo(10000);
    expect(res.totals.totalPnlPct).toBeCloseTo(45.45, 1);
    expect(res.totals.dayChangeAbs).toBeCloseTo(1500);
    expect(res.totals.dayChangePct).toBeCloseTo(4.69, 2);

    const btc = res.holdings.find(h => h.id === 'bitcoin');
    const eth = res.holdings.find(h => h.id === 'ethereum');
    expect(btc.allocationPct).toBeCloseTo(93.75);
    expect(eth.allocationPct).toBeCloseTo(6.25);
    expect(res.best.id).toBe('bitcoin');
    expect(res.worst.id).toBe('ethereum');
  });
});

describe('computeCumulativeReturn', () => {
  it('returns growth between first and last points', () => {
    const series = [
      { value: 100 },
      { value: 110 },
      { value: 121 }
    ];
    expect(computeCumulativeReturn(series)).toBeCloseTo(0.21, 2);
  });

  it('returns NaN when not enough data', () => {
    expect(Number.isNaN(computeCumulativeReturn([{ value: 10 }]))).toBe(true);
  });
});

describe('computeVaRAndCorrelations', () => {
  it('uses the 5th percentile without negative indices', () => {
    const portfolioData = {
      totals: { totalValue: 1000 },
      holdings: [
        { id: 'a', value: 600, symbol: 'A', change24hPct: 0 },
        { id: 'b', value: 400, symbol: 'B', change24hPct: 0 }
      ]
    };

    const returnsA = [0.02, -0.01, -0.03, 0.01, -0.02];
    const returnsB = [0.01, -0.02, -0.04, 0.0, -0.01];
    const simulateFn = (asset) => asset.id === 'a' ? returnsA : returnsB;

    const res = computeVaRAndCorrelations(portfolioData, simulateFn);

    expect(res.varPct1d).toBeCloseTo(0.034, 6);
    expect(res.varAbs1d).toBeCloseTo(34, 6);
    expect(res.assets).toHaveLength(2);
    expect(res.matrix[0][1]).toBeGreaterThan(-1);
  });

  it('returns null when there are no usable simulated returns', () => {
    const portfolioData = {
      totals: { totalValue: 5000 },
      holdings: [
        { id: 'solo', value: 5000, symbol: 'S', change24hPct: 0 }
      ]
    };

    const simulateFn = () => [];

    expect(computeVaRAndCorrelations(portfolioData, simulateFn)).toBeNull();
  });
});

describe('projectScenarioOutcome', () => {
  it('applies macro presets with asset-sensitive adjustments', () => {
    const portfolioData = {
      totals: { totalValue: 1000 },
      holdings: [
        { id: 'bitcoin', value: 600, symbol: 'BTC', name: 'Bitcoin' },
        { id: 'tether', value: 400, symbol: 'USDT', name: 'Tether' }
      ]
    };

    const result = projectScenarioOutcome(portfolioData, {
      scenarioKey: 'inflation',
      extraInvestment: 100,
      customMove: -0.1
    });

    const btc = result.assetImpacts.find(a => a.id === 'bitcoin');
    const usdt = result.assetImpacts.find(a => a.id === 'tether');
    expect(result.projectedValue).toBeGreaterThan(0);
    expect(usdt.adjustment).toBeGreaterThan(btc.adjustment); // stables cushioned vs beta
    expect(result.pnlAbs).toBeLessThan(0); // negative shock still hurts
  });
});

describe('backtestPortfolioStrategies', () => {
  it('builds a synthetic equity curve from sample monthly data', () => {
    const portfolioData = {
      totals: { totalValue: 1000 },
      holdings: [
        { id: 'bitcoin', value: 600, symbol: 'BTC' },
        { id: 'ethereum', value: 400, symbol: 'ETH' }
      ]
    };

    const res = backtestPortfolioStrategies(portfolioData, MONTHLY_RETURNS);

    expect(res).not.toBeNull();
    expect(res.portfolioCurve.length).toBeGreaterThan(2);
    expect(res.cagr).toBeGreaterThan(-1);
    expect(res.winRate).toBeGreaterThan(0);
  });
});
