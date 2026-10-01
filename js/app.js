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

// Ресайз
function resizeChart() {
  chart.applyOptions({ width: chartEl.clientWidth });
}
window.addEventListener('resize', resizeChart);
resizeChart();

// ===== Загрузка реальных данных =====
// Кэш в памяти, чтобы не дёргать fetch при каждом пересчёте EMA
const dataCache = new Map();

async function loadRealData(ticker) {
  if (dataCache.has(ticker)) {
    return dataCache.get(ticker);
  }

  const url = `./data/${ticker}.json`;
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`Не удалось загрузить ${url}: HTTP ${resp.status}`);
  }

  const data = await resp.json();

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Файл ${url} пустой или не массив`);
  }

  dataCache.set(ticker, data);
  return data;
}

// ===== Основной рендер =====
async function render() {
  const ticker = document.getElementById('ticker').value;
  const fastPeriod = parseInt(document.getElementById('emaFast').value, 10);
  const slowPeriod = parseInt(document.getElementById('emaSlow').value, 10);

  if (fastPeriod >= slowPeriod) {
    document.getElementById('stats').innerHTML =
      '<b style="color:#ef5350">Быстрая EMA должна быть меньше медленной.</b>';
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
    return;
  }

  const closes = data.map(d => d.close);

  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);

  candleSeries.setData(data);
  emaFastSeries.setData(
    data
      .map((d, i) => (fast[i] == null ? null : { time: d.time, value: +fast[i].toFixed(2) }))
      .filter(Boolean)
  );
  emaSlowSeries.setData(
    data
      .map((d, i) => (slow[i] == null ? null : { time: d.time, value: +slow[i].toFixed(2) }))
      .filter(Boolean)
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

  const lastBar = data[data.length - 1];

  document.getElementById('stats').innerHTML =
    `Тикер: <b>${ticker}</b> · EMA <b>${fastPeriod}/${slowPeriod}</b> · ` +
    `Баров: <b>${data.length}</b> · ` +
    `Последний: <b>${lastBar.time}</b> @ <b>${lastBar.close.toFixed(2)}</b> · ` +
    `Сигналов: <b>${signals.length}</b> ` +
    `(<span style="color:#26a69a">BUY ${buys}</span> / ` +
    `<span style="color:#ef5350">SELL ${sells}</span>)`;

  chart.timeScale().fitContent();
}

// ===== Инициализация =====
document.getElementById('reload').addEventListener('click', render);
document.getElementById('ticker').addEventListener('change', render);
render();
