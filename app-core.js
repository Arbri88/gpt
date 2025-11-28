const calculatePortfolio = (portfolio, priceData) => {
  let totalValue = 0;
  let totalCost = 0;
  let dayChangeAbs = 0;

  const detailed = portfolio.map(h => {
    const info = priceData[h.id] || {};
    const hasPrice = typeof info.usd === "number";
    const price = hasPrice ? info.usd : (h.buyPrice || 0);
    const changePct = typeof info.usd_24h_change === "number" ? info.usd_24h_change : 0;

    const amount = Number(h.amount) || 0;
    const value = amount * price;
    const costPer = h.buyPrice > 0 ? h.buyPrice : price;
    const cost = amount * costPer;
    const pnlAbs = value - cost;
    const pnlPct = cost ? pnlAbs / cost * 100 : 0;

    totalValue += value;
    totalCost += cost;
    dayChangeAbs += value * (changePct / 100);

    return { ...h, amount, price, value, cost, pnlAbs, pnlPct, change24hPct: changePct };
  });

  const dayChangePct = totalValue ? dayChangeAbs / totalValue * 100 : 0;
  const totalPnlAbs = totalValue - totalCost;
  const totalPnlPct = totalCost ? totalPnlAbs / totalCost * 100 : 0;

  if (totalValue > 0) {
    detailed.forEach(h => { h.allocationPct = h.value / totalValue * 100; });
  } else {
    detailed.forEach(h => { h.allocationPct = 0; });
  }

  let best = null, worst = null;
  const movers = detailed.filter(h => h.value > 10 && isFinite(h.change24hPct));
  if (movers.length) {
    movers.sort((a,b) => b.change24hPct - a.change24hPct);
    best = movers[0];
    worst = movers[movers.length - 1];
  }

  detailed.sort((a,b) => b.value - a.value);

  return {
    totals: { totalValue, totalCost, totalPnlAbs, totalPnlPct, dayChangeAbs, dayChangePct },
    holdings: detailed,
    best, worst
  };
};

const computeCumulativeReturn = (series) => {
  if (!series || series.length<2) return NaN;
  const first = series[0].value, last = series[series.length-1].value;
  if (!first || !last) return NaN;
  return last/first - 1;
};

const simulateAssetReturns = (asset, days) => {
  const dailyChangePct = typeof asset.change24hPct === "number" ? asset.change24hPct : 0;
  const mean = dailyChangePct/100 / 2;      // shrinked
  const vol  = 0.06;                        // 6% daily stdev as rough crypto
  const arr = [];
  for (let i=0;i<days;i++) {
    const z = (Math.random()+Math.random()+Math.random()+Math.random()-2)/2; // approx normal
    arr.push(mean + vol*z);
  }
  return arr;
};

const computeVaRAndCorrelations = (portfolioData, simulateFn = simulateAssetReturns) => {
  const totalValue = portfolioData.totals.totalValue || 0;
  if (!totalValue || !portfolioData.holdings.length) return null;

  const top = portfolioData.holdings.slice(0,6);
  const weights = {};
  top.forEach(h => { weights[h.id]=(h.value||0)/totalValue; });

  const targetDays = 60;
  const returnsByAsset = {};
  top.forEach(a => { returnsByAsset[a.id]=(simulateFn(a, targetDays) || []).slice(); });

  const availableLengths = top.map(a => returnsByAsset[a.id].length).filter(len => len>0);
  const days = availableLengths.length ? Math.min(targetDays, ...availableLengths) : 0;
  if (days < 1) return null;

  const portfolioReturns=[];
  for (let i=0;i<days;i++) {
    let r=0;
    top.forEach(a => {
      const arr=returnsByAsset[a.id]||[];
      if (!isFinite(arr[i])) return;
      r += (weights[a.id]||0)*arr[i];
    });
    portfolioReturns.push(r);
  }

  const sorted = portfolioReturns.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!sorted.length) return null;
  const idx = Math.max(0, Math.min(sorted.length-1, Math.floor(0.05*(sorted.length-1))));
  const q = sorted[idx];
  const varPct1d = Math.max(0,-q);
  const varAbs1d = totalValue*varPct1d;
  const varPct5d = varPct1d*Math.sqrt(5);
  const varAbs5d = totalValue*varPct5d;

  // correlation matrix
  const n = top.length;
  const matrix = Array.from({length:n},()=>Array(n).fill(1));
  function mean(a){return a.reduce((s,x)=>s+x,0)/a.length;}
  for (let i=0;i<n;i++) {
    const rI = returnsByAsset[top[i].id];
    if (!rI || rI.length<2) continue;
    const muI = mean(rI); let varI=0;
    for (let k=0;k<rI.length;k++) varI+=(rI[k]-muI)**2;
    varI /= Math.max(1,(rI.length-1));
    const sigmaI = Math.sqrt(Math.max(varI,1e-9));
    for (let j=i+1;j<n;j++) {
      const rJ = returnsByAsset[top[j].id];
      if (!rJ || rJ.length<2) continue;
      const muJ = mean(rJ); let varJ=0;
      for (let k=0;k<rJ.length;k++) varJ+=(rJ[k]-muJ)**2;
      varJ/=Math.max(1,(rJ.length-1));
      const sigmaJ = Math.sqrt(Math.max(varJ,1e-9));
      let cov=0;
      const loopDays = Math.min(rI.length, rJ.length);
      for (let k=0;k<loopDays;k++) cov+=(rI[k]-muI)*(rJ[k]-muJ);
      cov/=Math.max(1,(loopDays-1));
      const corr = cov/(sigmaI*sigmaJ);
      matrix[i][j]=matrix[j][i]=corr;
    }
  }
  for (let i=0;i<n;i++) matrix[i][i]=1;
  return { varAbs1d,varPct1d,varAbs5d,varPct5d, matrix, assets: top };
};

const MACRO_SCENARIOS = {
  inflation: {
    label: "Inflation spike",
    shock: -0.12,
    growthPenalty: -0.18,
    defensiveBoost: 0.05,
    note: "Inflation hurting growth; stables and quality fare better."
  },
  rateHike: {
    label: "Rate hike cycle",
    shock: -0.18,
    growthPenalty: -0.16,
    defensiveBoost: 0.02,
    note: "Higher rates pressure duration-heavy and speculative assets."
  },
  liquidity: {
    label: "Liquidity crunch",
    shock: -0.25,
    growthPenalty: -0.22,
    defensiveBoost: -0.05,
    note: "Dollar strength and deleveraging favor stables, hurt alts."
  },
  reflation: {
    label: "Risk-on reflation",
    shock: 0.08,
    growthPenalty: 0.14,
    defensiveBoost: -0.06,
    note: "Liquidity returns; growth and beta lead while stables lag."
  }
};

const MONTHLY_RETURNS = {
  bitcoin: [0.08, -0.12, 0.04, 0.06, -0.05, 0.10, 0.03, -0.02, 0.05, 0.01, -0.07, 0.09],
  ethereum:[0.10, -0.15, 0.06, 0.07, -0.06, 0.12, 0.05, -0.03, 0.06, 0.02, -0.09, 0.11],
  solana:  [0.14, -0.18, 0.08, 0.09, -0.08, 0.16, 0.06, -0.04, 0.08, 0.03, -0.12, 0.13],
  tether:  [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  market:  [0.03, -0.04, 0.02, 0.025, -0.015, 0.035, 0.015, -0.01, 0.02, 0.01, -0.02, 0.03]
};

const classifyAssetBucket = (id) => {
  const stableIds = ["tether","usdt","usd-coin","usdc"];
  const mega = ["bitcoin","ethereum"];
  if (stableIds.includes(id)) return "stable";
  if (mega.includes(id)) return "mega";
  return "alt";
};

const projectScenarioOutcome = (portfolioData, { scenarioKey = "inflation", extraInvestment = 0, customMove = null } = {}) => {
  if (!portfolioData || !portfolioData.holdings?.length) return null;
  const scenario = MACRO_SCENARIOS[scenarioKey] || MACRO_SCENARIOS.inflation;
  const baseShock = typeof customMove === "number" && isFinite(customMove) ? customMove : scenario.shock;
  const totalValue = portfolioData.totals.totalValue || 0;
  const workingTotal = totalValue + Math.max(0, extraInvestment || 0);

  let projected = 0;
  const assetImpacts = [];
  portfolioData.holdings.forEach(h => {
    const bucket = classifyAssetBucket((h.id || "").toLowerCase());
    let adj = baseShock;
    if (bucket === "stable") adj = Math.max(adj * 0.08, -0.02) + scenario.defensiveBoost;
    else if (bucket === "mega") adj += scenario.defensiveBoost * 0.5;
    else adj += scenario.growthPenalty;
    const value = (h.value || 0) * (1 + adj);
    projected += value;
    assetImpacts.push({ id: h.id, symbol: h.symbol, name: h.name, adjustment: adj, projectedValue: value });
  });

  const pnlAbs = projected - workingTotal;
  const pnlPct = workingTotal ? pnlAbs / workingTotal : 0;
  return {
    scenarioKey,
    label: scenario.label,
    note: scenario.note,
    projectedValue: projected,
    invested: workingTotal,
    pnlAbs,
    pnlPct,
    assetImpacts
  };
};

const backtestPortfolioStrategies = (portfolioData, history = MONTHLY_RETURNS) => {
  if (!portfolioData || !portfolioData.holdings?.length) return null;
  const total = portfolioData.totals.totalValue || 0;
  if (!total) return null;
  const weights = {};
  portfolioData.holdings.forEach(h => {
    const v = h.value || 0;
    if (v > 0) weights[h.id] = v / total;
  });
  const ids = Object.keys(weights);
  if (!ids.length) return null;
  const lengths = ids.map(id => (history[id] || history.market || []).length).filter(Boolean);
  const periods = lengths.length ? Math.min(...lengths) : 0;
  if (periods < 3) return null;

  const portfolioCurve = [100];
  const benchmarkCurve = [100];
  let wins = 0;
  for (let i = 0; i < periods; i++) {
    const marketRet = (history.market && isFinite(history.market[i])) ? history.market[i] : 0;
    let r = 0;
    ids.forEach(id => {
      const series = history[id] || history.market || [];
      const val = isFinite(series[i]) ? series[i] : marketRet;
      r += (weights[id] || 0) * val;
    });
    const prev = portfolioCurve[portfolioCurve.length - 1];
    const next = prev * (1 + r);
    portfolioCurve.push(next);
    const bmPrev = benchmarkCurve[benchmarkCurve.length - 1];
    benchmarkCurve.push(bmPrev * (1 + marketRet));
    if (r >= 0) wins++;
  }

  const returns = [];
  for (let i = 1; i < portfolioCurve.length; i++) {
    const prev = portfolioCurve[i - 1];
    const curr = portfolioCurve[i];
    if (prev > 0) returns.push((curr - prev) / prev);
  }
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - avg) * (r - avg), 0) / returns.length;
  const vol = Math.sqrt(Math.max(variance, 0));
  const annualizedReturn = Math.pow(1 + avg, 12) - 1;
  const annualizedVol = vol * Math.sqrt(12);
  const sharpe = annualizedVol ? annualizedReturn / annualizedVol : NaN;
  let peak = portfolioCurve[0], maxDD = 0;
  portfolioCurve.forEach(v => {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  });

  return {
    cagr: annualizedReturn,
    volatility: annualizedVol,
    sharpe,
    maxDrawdown: maxDD,
    winRate: wins / periods,
    portfolioCurve,
    benchmarkCurve
  };
};

const api = {
  calculatePortfolio,
  computeCumulativeReturn,
  computeVaRAndCorrelations,
  simulateAssetReturns,
  projectScenarioOutcome,
  backtestPortfolioStrategies,
  MACRO_SCENARIOS,
  MONTHLY_RETURNS
};
if (typeof globalThis !== 'undefined' && globalThis.window) {
  globalThis.PortfolioCore = api;
}

export {
  calculatePortfolio,
  computeCumulativeReturn,
  computeVaRAndCorrelations,
  simulateAssetReturns,
  projectScenarioOutcome,
  backtestPortfolioStrategies,
  MACRO_SCENARIOS,
  MONTHLY_RETURNS
};
export default api;
