// js/backtest.js
// Long-only бэктест с учётом лота, комиссий, проскальзывания и дивидендов.

function runBacktest(data, signals, options = {}) {
  const initialCapital = options.initialCapital ?? 100000;
  const commissionPct  = options.commissionPct   ?? 0.05;
  const slippagePct    = options.slippagePct     ?? 0.05;
  const lotSize        = options.lotSize         ?? 1;
  const dividends      = options.dividends       ?? [];

  const commission = commissionPct / 100;
  const slippage   = slippagePct / 100;

  const signalByIndex = new Map();
  for (const s of signals) signalByIndex.set(s.index, s.type);

  // Карта: дата отсечки -> дивиденд на акцию
  const divByDate = new Map();
  for (const d of dividends) {
    if (d.date && Number(d.amount) > 0) {
      divByDate.set(d.date, Number(d.amount));
    }
  }

  let cash = initialCapital;
  let shares = 0;
  let position = null;
  const trades = [];
  const equity = [];
  const dividendEvents = [];
  let totalDividends = 0;
  let totalDividendTax = 0;

  // НДФЛ на дивиденды — 13%
  const DIVIDEND_TAX = 0.13;

  for (let i = 0; i < data.length; i++) {
    const bar = data[i];

    // === Начисление дивидендов ===
    // Если держим позицию в день отсечки — получаем дивиденды на каждую акцию
    if (shares > 0 && divByDate.has(bar.time)) {
      const amountPerShare = divByDate.get(bar.time);
      const gross = shares * amountPerShare;
      const tax = gross * DIVIDEND_TAX;
      const net = gross - tax;

      cash += net;
      totalDividends += gross;
      totalDividendTax += tax;

      dividendEvents.push({
        date: bar.time,
        amountPerShare: +amountPerShare.toFixed(4),
        shares,
        lots: Math.floor(shares / lotSize),
        gross: +gross.toFixed(2),
        tax: +tax.toFixed(2),
        net: +net.toFixed(2),
      });
    }

    const prevSignal = i > 0 ? signalByIndex.get(i - 1) : undefined;

    if (prevSignal === 'buy' && shares === 0) {
      const buyPrice = bar.open * (1 + slippage);
      const costPerLot = buyPrice * lotSize * (1 + commission);
      const maxLots = Math.floor(cash / costPerLot);
      if (maxLots > 0) {
        const maxShares = maxLots * lotSize;
        const cost = maxShares * buyPrice;
        const fee = cost * commission;
        cash -= cost + fee;
        shares = maxShares;
        position = {
          entryTime: bar.time,
          entryPrice: buyPrice,
          shares: maxShares,
          lots: maxLots,
          entryFee: fee,
        };
      }
    } else if (prevSignal === 'sell' && shares > 0) {
      const sellPrice = bar.open * (1 - slippage);
      const revenue = shares * sellPrice;
      const fee = revenue * commission;
      cash += revenue - fee;

      const pnl    = (sellPrice - position.entryPrice) * shares - position.entryFee - fee;
      const pnlPct = (sellPrice / position.entryPrice - 1) * 100;

      trades.push({
        entryTime: position.entryTime,
        exitTime: bar.time,
        entryPrice: position.entryPrice,
        exitPrice: sellPrice,
        shares: position.shares,
        lots: position.lots,
        pnl,
        pnlPct,
        entryFee: position.entryFee,
        exitFee: fee,
        openAtEnd: false,
      });

      shares = 0;
      position = null;
    }

    equity.push({ time: bar.time, value: cash + shares * bar.close });
  }

  // Принудительное закрытие позиции на последнем баре
  if (shares > 0) {
    const lastBar = data[data.length - 1];
    const sellPrice = lastBar.close * (1 - slippage);
    const revenue = shares * sellPrice;
    const fee = revenue * commission;
    const pnl    = (sellPrice - position.entryPrice) * shares - position.entryFee - fee;
    const pnlPct = (sellPrice / position.entryPrice - 1) * 100;

    trades.push({
      entryTime: position.entryTime,
      exitTime: lastBar.time,
      entryPrice: position.entryPrice,
      exitPrice: sellPrice,
      shares: position.shares,
      lots: position.lots,
      pnl,
      pnlPct,
      entryFee: position.entryFee,
      exitFee: fee,
      openAtEnd: true,
    });

    cash += revenue - fee;
    shares = 0;
    equity[equity.length - 1].value = cash;
  }

  const finalValue = cash;
  const totalReturnPct = (finalValue / initialCapital - 1) * 100;

  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const p of equity) {
    if (p.value > peak) peak = p.value;
    const dd = (p.value / peak - 1) * 100;
    if (dd < maxDrawdownPct) maxDrawdownPct = dd;
  }

  const firstBar = data[0];
  const lastBar  = data[data.length - 1];
  const bhStart  = firstBar.open * (1 + slippage);
  const bhEnd    = lastBar.close * (1 - slippage);
  const bhReturnPct = (bhEnd / bhStart - 1) * 100;

  const totalFees = trades.reduce((s, t) => s + t.entryFee + t.exitFee, 0);
  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const winRatePct = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;
  const alphaPct = totalReturnPct - bhReturnPct;

  const avgTradeDays = trades.length > 0
    ? trades.reduce((s, t) => {
        const a = new Date(t.entryTime);
        const b = new Date(t.exitTime);
        return s + Math.round((b - a) / (1000 * 60 * 60 * 24));
      }, 0) / trades.length
    : 0;

  return {
    initialCapital,
    finalValue,
    totalReturnPct,
    maxDrawdownPct,
    trades,
    tradesCount: trades.length,
    winRatePct,
    bhReturnPct,
    alphaPct,
    totalFees,
    avgTradeDays,
    lotSize,
    equity,
    totalDividends: +totalDividends.toFixed(2),
    totalDividendTax: +totalDividendTax.toFixed(2),
    dividendEvents,
  };
}

function runSplitBacktest(data, signals, options, splitRatio = 0.7) {
  const splitIdx = Math.floor(data.length * splitRatio);

  const trainData = data.slice(0, splitIdx);
  const testData  = data.slice(splitIdx);

  const trainSignals = signals.filter(s => s.index < splitIdx);
  const testSignals  = signals
    .filter(s => s.index >= splitIdx)
    .map(s => ({ index: s.index - splitIdx, type: s.type }));

  const train = runBacktest(trainData, trainSignals, options);
  const test  = runBacktest(testData, testSignals, options);

  return { train, test, splitIdx };
}
