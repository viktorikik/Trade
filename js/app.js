// ===== Настройка графика =====
const chartEl = document.getElementById('chart');
const chart = LightweightCharts.createChart(chartEl, {
  layout: {
    background: { color: '#0e1116' },
    textColor: '#d1d4dc',
  },
  grid: {
    vertLines: { color: '#1f2430' },
    horzLines: { color: '#1f2430' },
  },
  rightPriceScale: { borderColor: '#2a2e39' },
  timeScale: { borderColor: '#2a2e39', timeVisible: false },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});

const candleSeries = chart.addCandlestickSeries({
  upColor: '#26a69a',
  downColor: '#ef5350',
  borderUpColor: '#26a69a',
  borderDownColor: '#ef5350',
  wickUpColor: '#26a69a',
  wickDownColor: '#ef5350',
});

const emaFastSeries = chart.addLineSeries({ color: '#26a69a', lineWidth: 2 });
const emaSlowSeries = chart.addLineSeries({ color: '#ef5350', lineWidth: 2 });

// Реагируем на ресайз окна
window.addEventListener('resize', () => {
  chart.applyOptions({ width: chartEl.clientWidth });
});
chart.applyOptions({ width: chartEl.clientWidth });

// ===== Синтетические данные (шаг 1) =====
// На шаге 2 заменим на реальные котировки из data/{ticker}.json
function generateSyntheticData(ticker, days = 250) {
  // Простой seeded random, чтобы для одного тикера данные были стабильны
  let seed = 0;
  for (const ch of ticker) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const data = [];
  let price = 100 + rand() * 50;
  const today = new Date();
  for (let i = days; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue;

    const drift = (rand() - 0.48) * 2.5;
    price = Math.max(1, price + drift);

    const open = price + (rand() - 0.5) * 1.5;
    const close = price + (rand() - 0.5) * 1.5;
    const high = Math.max(open, close) + rand() * 1.5;
    const low = Math.min(open, close) - rand() * 1.5;

    data.push({
      time: d.toISOString().slice(0, 10),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
    });
  }
  return data;
}

// ===== Основной рендер =====
function render() {
  const ticker = document.getElementById('ticker').value;
  const fastPeriod = parseInt(document.getElementById('emaFast').value, 10);
  const slowPeriod = parseInt(document.getElementById('emaSlow').value, 10);

  if (fastPeriod >= slowPeriod) {
    document.getElementById('stats').innerHTML =
      '<b style="color:#ef5350">Быстрая EMA должна быть меньше медленной.</b>';
    return;
  }

  const data = generateSyntheticData(ticker);
  const closes = data.map(d => d.close);

  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);

  candleSeries.setData(data);
  emaFastSeries.setData(
    data.map((d, i) => (fast[i] == null ? null : { time: d.time, value: +fast[i].toFixed(2) })).filter(Boolean)
  );
  emaSlowSeries.setData(
    data.map((d, i) => (slow[i] == null ? null : { time: d.time, value: +slow[i].toFixed(2) })).filter(Boolean)
  );

  const signals = findCrossovers(fast, slow);

  candleSeries.setMarkers(
    signals.map(s => ({
      time: data[s.index].time,
      position: s.type === 'buy' ? 'belowBar' : 'aboveBar',
      color: s.type === 'buy' ? '#26a69a' : '#ef5350',
      shape: s.type === 'buy' ? 'arrowUp' : 'arrowDown',
      text: s.type === 'buy' ? 'BUY' : 'SELL',
    }))
  );

  const buys = signals.filter(s => s.type === 'buy').length;
  const sells = signals.filter(s => s.type === 'sell').length;

  document.getElementById('stats').innerHTML =
    `Тикер: <b>${ticker}</b> · EMA <b>${fastPeriod}/${slowPeriod}</b> · ` +
    `Баров: <b>${data.length}</b> · Сигналов: <b>${signals.length}</b> ` +
    `(<span style="color:#26a69a">BUY ${buys}</span> / <span style="color:#ef5350">SELL ${sells}</span>) · ` +
    `<span style="color:#8b949e">синтетические данные (шаг 1)</span>`;

  chart.timeScale().fitContent();
}

// ===== Инициализация =====
document.getElementById('reload').addEventListener('click', render);
document.getElementById('ticker').addEventListener('change', render);
render();
