/**
 * Long-only бэктест по сигналам EMA-кроссовера.
 *
 * Ключевые принципы:
 * - Сигнал на баре i исполняется на open бара i+1 (защита от look-ahead bias).
 * - Комиссия берётся с обеих сторон сделки.
 * - Проскальзывание: покупка чуть дороже, продажа чуть дешевле.
 * - Открытая в конце позиция принудительно закрывается по последнему close.
 */

function runBacktest(data, signals, options = {}) {
  const initialCapital = options.initialCapital ?? 100000;
  const commissionPct   = options.commissionPct   ?? 0.05; // % от суммы сделки
  const slippagePct     = options.slippagePct     ?? 0.05; // % от цены

  const commission = commissionPct / 100;
  const slippage   = slippagePct / 100;

  // Карта: индекс бара -> тип сигнала
  const signalByIndex = new Map();
  for (const s of signals) signalByIndex.set(s.index, s.type);

  let cash = initialCapital;
  let shares = 0;
  let position = null;   // { entryTime, entryPrice, shares, entryFee }
  const trades = [];
  const equity = [];

  for (let i = 0; i < data.length; i++) {
    const bar = data[i];

    // Сигнал с предыдущего бара исполняем на open текущего
    const prevSignal = i > 0 ? signalByIndex.get(i - 1) : undefined;

    if (prevSignal === 'buy' && shares === 0) {
      const buyPrice = bar.open * (1 + slippage);
      // Сколько акций можем купить с учётом комиссии
      const maxShares = Math.floor(cash / (buyPrice * (1 + commission)));
      if (maxShares > 0) {
        const cost = maxShares * buyPrice;
        const fee = cost * commission;
        cash -= cost + fee;
        shares = maxShares;
        position = {
          entryTime: bar.time,
          entryPrice: buyPrice,
          shares: maxShares,
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

  // Принудительно закрываем позицию, если она осталась на последнем баре
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

  // ===== Метрики =====
  const finalValue = cash;
  const totalReturnPct = (finalValue / initialCapital - 1) * 100;

  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const p of equity) {
    if (p.value > peak) peak = p.value;
    const dd = (p.value / peak - 1) * 100;
    if (dd < maxDrawdownPct) maxDrawdownPct = dd;
  }

  // Buy & Hold: купили по open первого бара, держим до close последнего
  const firstBar = data[0];
  const lastBar  = data[data.length - 1];
  const bhStart  = firstBar.open * (1 + slippage);
  const bhEnd    = lastBar.close * (1 - slippage);
  const bhReturnPct = (bhEnd / bhStart - 1) * 100;

  const totalFees = trades.reduce((s, t) => s + t.entryFee + t.exitFee, 0);
  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const winRatePct = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;
  const alphaPct = totalReturnPct - bhReturnPct; // наша стратегия vs B&H

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
    equity,
  };
}
