// js/app.js

// ===== График свечей =====
const chartEl = document.getElementById('chart');
const chart = LightweightCharts.createChart(chartEl, {
  layout: { background: { color: '#0e1116' }, textColor: '#d1d4dc' },
  grid: {
    vertLines: { color: '#1f2430' },
    horzLines: { color: '#1f2430' },
  },
  rightPriceScale: { borderColor: '#2a2e39' },
  timeScale: { borderColor: '#2a2e39', timeVisible: false },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});

const candleSeries = chart.addCandlestickSeries({
  upColor: '#26a69a', downColor: '#ef5350',
  borderUpColor: '#26a69a', borderDownColor: '#ef5350',
  wickUpColor: '#26a69a', wickDownColor: '#ef5350',
});
const emaFastSeries = chart.addLineSeries({ color: '#26a69a', lineWidth: 2 });
const emaSlowSeries = chart.addLineSeries({ color: '#ef5350', lineWidth: 2 });

// ===== График equity =====
const equityEl = document.getElementById('equityChart');
const equityChart = LightweightCharts.createChart(equityEl, {
  layout: { background: { color: '#0e1116' }, textColor: '#d1d4dc' },
  grid: {
    vertLines: { color: '#1f2430' },
    horzLines: { color: '#1f2430' },
  },
  rightPriceScale: { borderColor: '#2a2e39' },
  timeScale: { borderColor: '#2a2e39', timeVisible: false },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});
const equitySeries = equityChart.addAreaSeries({
  lineColor: '#4a9eff',
  topColor: 'rgba(74, 158, 255, 0.4)',
  bottomColor: 'rgba(74, 158, 255, 0.0)',
  lineWidth: 2,
});

// ===== Ресайз =====
function resizeCharts() {
  chart.applyOptions({ width: chartEl.clientWidth });
  equityChart.applyOptions({ width: equityEl.clientWidth });
}
window.addEventListener('resize', resizeCharts);
resizeCharts();

// ===== Кэш данных =====
const dataCache = new Map();

async function loadRealData(ticker) {
  if (dataCache.has(ticker)) return dataCache.get(ticker);
  const resp = await fetch(`./data/${ticker}.json`);
  if (!resp.ok) throw new Error(`Не удалось загрузить data/${ticker}.json: HTTP ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error(`Файл data/${ticker}.json пустой`);
  dataCache.set(ticker, data);
  return data;
}

// ===== Метрики бэктеста =====
function metricCard(label, value, cls = 'neutral') {
  return `
    <div class="metric">
      <div class="label">${label}</div>
      <div class="value ${cls}">${value}</div>
    </div>
  `;
}

function renderMetrics(r) {
  const fmtRub = v => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
  const fmtPct = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

  const totalCls = r.totalReturnPct > 0 ? 'good' : r.totalReturnPct < 0 ? 'bad' : 'neutral';
  const alphaCls = r.alphaPct > 0 ? 'good' : r.alphaPct < 0 ? 'bad' : 'neutral';
  const ddCls    = r.maxDrawdownPct < -20 ? 'bad' : r.maxDrawdownPct < -10 ? 'neutral' : 'good';

  document.getElementById('metrics').innerHTML = [
    metricCard('Итог портфеля', fmtRub(r.finalValue), totalCls),
    metricCard('Доходность',    fmtPct(r.totalReturnPct), totalCls),
    metricCard('Buy & Hold',    fmtPct(r.bhReturnPct), r.bhReturnPct > 0 ? 'good' : 'bad'),
    metricCard('Альфа vs B&H',  fmtPct(r.alphaPct), alphaCls),
    metricCard('Макс. просадка', fmtPct(r.maxDrawdownPct), ddCls),
    metricCard('Сделок',        `${r.tradesCount} (win ${r.winRatePct.toFixed(0)}%)`),
    metricCard('Комиссии съели', fmtRub(r.totalFees)),
  ].join('');
}

// ===== Комплексный анализ и вердикт =====
function renderAnalysis(data) {
  const analysis = analyzeMarket(data);
  const { verdict, verdictClass, reasons, indicators } = analysis;

  const verdictEl = document.getElementById('verdict');
  verdictEl.className = `verdict ${verdictClass}`;
  verdictEl.innerHTML = `
    <div class="verdict-main">${verdict}</div>
    <div class="verdict-score">Сумма баллов: ${analysis.score}</div>
  `;

  const indEl = document.getElementById('indicatorValues');
  const rsiVal = indicators.rsi != null ? indicators.rsi.toFixed(1) : '—';
  const macdVal = indicators.macd.macdValue != null ? indicators.macd.macdValue.toFixed(4) : '—';
  const sigVal = indicators.macd.signalValue != null ? indicators.macd.signalValue.toFixed(4) : '—';

  indEl.innerHTML = `
    <div class="indicator-value"><span>RSI(14):</span> <b>${rsiVal}</b></div>
    <div class="indicator-value"><span>MACD:</span> <b>${macdVal}</b></div>
    <div class="indicator-value"><span>Signal:</span> <b>${sigVal}</b></div>
  `;

  document.getElementById('reasons').innerHTML =
    reasons.map(r => `<li>${r}</li>`).join('');
}

// ===== Основной рендер =====
async function render() {
  const ticker      = document.getElementById('ticker').value;
  const fastPeriod  = parseInt(document.getElementById('emaFast').value, 10);
  const slowPeriod  = parseInt(document.getElementById('emaSlow').value, 10);
  const capital     = parseFloat(document.getElementById('capital').value);
  const commission  = parseFloat(document.getElementById('commission').value);
  const slippage    = parseFloat(document.getElementById('slippage').value);

  if (fastPeriod >= slowPeriod) {
    document.getElementById('stats').innerHTML =
      '<b style="color:#ef5350">Быстрая EMA должна быть меньше медленной.</b>';
    document.getElementById('metrics').innerHTML = '';
    return;
  }

  let data;
  try {
    document.getElementById('stats').innerHTML = 'Загрузка данных…';
    data = await loadRealData(ticker);
  } catch (err) {
    console.error(err);
    document.getElementById('stats').innerHTML =
      `<b style="color:#ef5350">Ошибка загрузки: ${err.message}</b>`;
    document.getElementById('metrics').innerHTML = '';
    return;
  }

  const closes = data.map(d => d.close);
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);

  candleSeries.setData(data);
  emaFastSeries.setData(
    data.map((d, i) => fast[i] == null ? null : { time: d.time, value: +fast[i].toFixed(2) }).filter(Boolean)
  );
  emaSlowSeries.setData(
    data.map((d, i) => slow[i] == null ? null : { time: d.time, value: +slow[i].toFixed(2) }).filter(Boolean)
  );

  const signals = findCrossovers(fast, slow);

  candleSeries.setMarkers(signals.map(s => ({
    time: data[s.index].time,
    position: s.type === 'buy' ? 'belowBar' : 'aboveBar',
    color: s.type === 'buy' ? '#26a69a' : '#ef5350',
    shape: s.type === 'buy' ? 'arrowUp' : 'arrowDown',
    text: s.type === 'buy' ? 'BUY' : 'SELL',
  })));

  // Бэктест
  const result = runBacktest(data, signals, {
    initialCapital: isNaN(capital) ? 100000 : capital,
    commissionPct:  isNaN(commission) ? 0.05 : commission,
    slippagePct:    isNaN(slippage) ? 0.05 : slippage,
  });

  equitySeries.setData(result.equity);

  const lastBar = data[data.length - 1];
  const buys  = signals.filter(s => s.type === 'buy').length;
  const sells = signals.filter(s => s.type === 'sell').length;

  document.getElementById('stats').innerHTML =
    `Тикер: <b>${ticker}</b> · EMA <b>${fastPeriod}/${slowPeriod}</b> · ` +
    `Баров: <b>${data.length}</b> · Последний: <b>${lastBar.time}</b> ` +
    `@ <b>${lastBar.close.toFixed(2)}</b> · ` +
    `Сигналов: <b>${signals.length}</b> ` +
    `(<span style="color:#26a69a">BUY ${buys}</span> / ` +
    `<span style="color:#ef5350">SELL ${sells}</span>)`;

  renderMetrics(result);
  renderAnalysis(data);

  chart.timeScale().fitContent();
  equityChart.timeScale().fitContent();
}

// ===== Инициализация =====
document.getElementById('reload').addEventListener('click', render);
document.getElementById('ticker').addEventListener('change', render);
render();
