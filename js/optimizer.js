// js/optimizer.js
// Перебор пар EMA и поиск лучших комбинаций по доходности.

const OPTIMIZER_FAST = [5, 8, 10, 12, 15, 20, 25, 30, 40, 50];
const OPTIMIZER_SLOW = [15, 20, 25, 30, 40, 50, 75, 100, 150, 200];

function optimizeEmaPairs(data, options = {}) {
  const results = [];

  for (const fast of OPTIMIZER_FAST) {
    for (const slow of OPTIMIZER_SLOW) {
      if (fast >= slow) continue;

      const signals = emaCrossoverSignals(data, fast, slow);

      // Пропускаем, если сделок меньше 2 — нечего оптимизировать
      if (signals.length < 2) continue;

      const r = runBacktest(data, signals, options);
      results.push({
        fast,
        slow,
        returnPct: r.totalReturnPct,
        drawdownPct: r.maxDrawdownPct,
        trades: r.tradesCount,
        winRate: r.winRatePct,
        alpha: r.alphaPct,
      });
    }
  }

  results.sort((a, b) => b.returnPct - a.returnPct);
  return results;
}
