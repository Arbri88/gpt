# Minimal Crypto Portfolio Dashboard

A single-page crypto portfolio tracker with live pricing, news, and advanced analytics. The dashboard runs fully in the browser using a Tailwind CDN build and ES modules.

## Features
- Portfolio valuation, allocation breakdown, and daily movers.
- Scenario modeling presets (inflation, rate hikes, liquidity crunch, reflation) with asset-aware shocks.
- Synthetic VaR and correlation estimates across top holdings.
- Backtesting utility with sample monthly returns to derive CAGR, volatility, Sharpe, drawdowns, and win rate.
- Customizable pinned dashboard so users can save their preferred metrics and charts.
- Watchlist, alerts, and news feed sourced from public APIs (CoinGecko/CryptoCompare).

## Getting Started
1. Install dependencies (for tests only):
   ```bash
   npm ci
   ```
2. Open `crypto-portfolio.html` directly in a modern browser to use the dashboard.

## Testing
Run the Vitest suite:
```bash
npm test
```
