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

function resizeCharts() {
  chart.applyOptions({ width: chartEl.clientWidth });
  equityChart.applyOptions({ width: equityEl.clientWidth });
}
window.addEventListener('resize', resizeCharts);
resizeCharts();

// ===== Кэш данных =====
const dataCache = new Map();

// Поддерживаем оба формата: массив (старый) и объект с полями (новый)
function normalizeTickerPayload(raw, ticker) {
  if (Array.isArray(raw)) {
    return { ticker, name: ticker, lotSize: 1, candles: raw };
  }
  if (raw && Array.isArray(raw.candles)) {
    return {
      ticker: raw.ticker || ticker,
      name: raw.name || ticker,
      lotSize: Number.isFinite(raw.lotSize) && raw.lotSize > 0 ? raw.lotSize : 1,
      candles: raw.candles,
    };
  }
  throw new Error('Неизвестный формат файла данных');
}

async function loadRealData(ticker) {
  if (dataCache.has(ticker)) return dataCache.get(ticker);
  const resp = await fetch(`./data/${ticker}.json`);
  if (!resp.ok) throw new Error(`Не удалось загрузить data/${ticker}.json: HTTP ${resp.status}`);
  const raw = await resp.json();
  const payload = normalizeTickerPayload(raw, ticker);
  if (payload.candles.length === 0) throw new Error(`Файл data/${ticker}.json пустой`);
  dataCache.set(ticker, payload);
  return payload;
}

// ===== Тост =====
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ===== Счётчик заметок =====
function updateNotesBadge() {
  const count = loadWatchlist().length;
  document.getElementById('notesCount').textContent = count;
}

// ===== Метрики =====
function metricCard(label, value, cls = 'neutral') {
  return `
    <div class="metric">
      <div class="label">${label}</div>
      <div class="value ${cls}">${value}</div>
    </div>
  `;
}

function renderMetricsInto(elId, r) {
  const fmtRub = v => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
  const fmtPct = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

  const totalCls = r.totalReturnPct > 0 ? 'good' : r.totalReturnPct < 0 ? 'bad' : 'neutral';
  const alphaCls = r.alphaPct > 0 ? 'good' : r.alphaPct < 0 ? 'bad' : 'neutral';
  const ddCls    = r.maxDrawdownPct < -20 ? 'bad' : r.maxDrawdownPct < -10 ? 'neutral' : 'good';

  document.getElementById(elId).innerHTML = [
    metricCard('Итог портфеля', fmtRub(r.finalValue), totalCls),
    metricCard('Доходность',    fmtPct(r.totalReturnPct), totalCls),
    metricCard('Buy & Hold',    fmtPct(r.bhReturnPct), r.bhReturnPct > 0 ? 'good' : 'bad'),
    metricCard('Альфа vs B&H',  fmtPct(r.alphaPct), alphaCls),
    metricCard('Макс. просадка', fmtPct(r.maxDrawdownPct), ddCls),
    metricCard('Сделок',        `${r.tradesCount} (win ${r.winRatePct.toFixed(0)}%)`),
    metricCard('Комиссии съели', fmtRub(r.totalFees)),
    metricCard('Ср. длительность', `${Math.round(r.avgTradeDays)} дн.`),
  ].join('');
}

// ===== Анализ =====
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

  return analysis;
}

// ===== Динамические параметры стратегии =====
function renderStrategyParams() {
  const sid = document.getElementById('strategy').value;
  const wrap = document.getElementById('strategyParams');
  const defaults = STRATEGIES[sid].defaults;

  if (sid === 'ema') {
    wrap.innerHTML = `
      <label>EMA быстрая:
        <input id="pFast" type="number" value="${defaults.fast}" min="2" max="200" />
      </label>
      <label>EMA медленная:
        <input id="pSlow" type="number" value="${defaults.slow}" min="3" max="400" />
      </label>
    `;
  } else if (sid === 'rsi') {
    wrap.innerHTML = `
      <label>Период RSI:
        <input id="pPeriod" type="number" value="${defaults.period}" min="2" max="50" />
      </label>
      <label>Перепродан (&lt;):
        <input id="pOversold" type="number" value="${defaults.oversold}" min="5" max="50" />
      </label>
      <label>Перекуплен (&gt;):
        <input id="pOverbought" type="number" value="${defaults.overbought}" min="50" max="95" />
      </label>
    `;
  } else if (sid === 'bollinger') {
    wrap.innerHTML = `
      <label>Период BB:
        <input id="pPeriod" type="number" value="${defaults.period}" min="5" max="100" />
      </label>
      <label>Множитель σ:
        <input id="pMult" type="number" value="${defaults.mult}" min="0.5" max="4" step="0.1" />
      </label>
    `;
  } else {
    wrap.innerHTML = `<span class="hint">У Buy &amp; Hold нет параметров — одна покупка в начале и удержание до конца.</span>`;
  }
}

function readStrategyParams() {
  const sid = document.getElementById('strategy').value;
  const defaults = STRATEGIES[sid].defaults;
  const get = (id, fallback) => {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const v = parseFloat(el.value);
    return isNaN(v) ? fallback : v;
  };
  if (sid === 'ema') {
    return { fast: get('pFast', defaults.fast), slow: get('pSlow', defaults.slow) };
  }
  if (sid === 'rsi') {
    return {
      period: get('pPeriod', defaults.period),
      oversold: get('pOversold', defaults.oversold),
      overbought: get('pOverbought', defaults.overbought),
    };
  }
  if (sid === 'bollinger') {
    return { period: get('pPeriod', defaults.period), mult: get('pMult', defaults.mult) };
  }
  return {};
}

// ===== Состояние =====
let currentState = null;
let currentLastResult = null; // для экспорта CSV

function updateAddButton() {
  document.getElementById('addToNotes').disabled = !currentState;
}

// ===== Основной рендер =====
async function render() {
  const ticker      = document.getElementById('ticker').value;
  const strategyId  = document.getElementById('strategy').value;
  const capital     = parseFloat(document.getElementById('capital').value);
  const commission  = parseFloat(document.getElementById('commission').value);
  const slippage    = parseFloat(document.getElementById('slippage').value);
  const useSplit    = document.getElementById('useSplit').checked;

  const params = readStrategyParams();

  // Валидация EMA
  if (strategyId === 'ema' && params.fast >= params.slow) {
    document.getElementById('stats').innerHTML =
      '<b style="color:#ef5350">Быстрая EMA должна быть меньше медленной.</b>';
    document.getElementById('metrics').innerHTML = '';
    document.getElementById('splitSection').style.display = 'none';
    currentState = null;
    currentLastResult = null;
    updateAddButton();
    return;
  }

  let payload;
  try {
    document.getElementById('stats').innerHTML = 'Загрузка данных…';
    payload = await loadRealData(ticker);
  } catch (err) {
    console.error(err);
    document.getElementById('stats').innerHTML =
      `<b style="color:#ef5350">Ошибка загрузки: ${err.message}</b>`;
    document.getElementById('metrics').innerHTML = '';
    document.getElementById('splitSection').style.display = 'none';
    currentState = null;
    currentLastResult = null;
    updateAddButton();
    return;
  }

  const data = payload.candles;
  const closes = data.map(d => d.close);
  const strategy = STRATEGIES[strategyId];
  const signals = strategy.generate(data, params);

  // Свечи
  candleSeries.setData(data);

  // EMA-линии на графике рисуем только для EMA-стратегии
  if (strategyId === 'ema') {
    const fastArr = ema(closes, params.fast);
    const slowArr = ema(closes, params.slow);
    emaFastSeries.setData(
      data.map((d, i) => fastArr[i] == null ? null : { time: d.time, value: +fastArr[i].toFixed(2) }).filter(Boolean)
    );
    emaSlowSeries.setData(
      data.map((d, i) => slowArr[i] == null ? null : { time: d.time, value: +slowArr[i].toFixed(2) }).filter(Boolean)
    );
  } else {
    emaFastSeries.setData([]);
    emaSlowSeries.setData([]);
  }

  // Метки
  candleSeries.setMarkers(signals.map(s => ({
    time: data[s.index].time,
    position: s.type === 'buy' ? 'belowBar' : 'aboveBar',
    color: s.type === 'buy' ? '#26a69a' : '#ef5350',
    shape: s.type === 'buy' ? 'arrowUp' : 'arrowDown',
    text: s.type === 'buy' ? 'BUY' : 'SELL',
  })));

  const backtestOptions = {
    initialCapital: isNaN(capital) ? 100000 : capital,
    commissionPct:  isNaN(commission) ? 0.05 : commission,
    slippagePct:    isNaN(slippage) ? 0.05 : slippage,
    lotSize:        payload.lotSize,
  };

  // Бэктест
  const result = runBacktest(data, signals, backtestOptions);
  currentLastResult = { ticker, strategyId, params, result, payload };

  equitySeries.setData(result.equity);
  renderMetricsInto('metrics', result);

  // Out-of-sample
  if (useSplit) {
    const split = runSplitBacktest(data, signals, backtestOptions, 0.7);
    renderMetricsInto('trainMetrics', split.train);
    renderMetricsInto('testMetrics', split.test);
    document.getElementById('splitSection').style.display = 'block';
  } else {
    document.getElementById('splitSection').style.display = 'none';
  }

  const lastBar = data[data.length - 1];
  const buys  = signals.filter(s => s.type === 'buy').length;
  const sells = signals.filter(s => s.type === 'sell').length;

  document.getElementById('stats').innerHTML =
    `Тикер: <b>${ticker}</b> (${payload.name}) · Лот: <b>${payload.lotSize}</b> · ` +
    `Стратегия: <b>${strategy.label}</b> · ` +
    `Баров: <b>${data.length}</b> · Последний: <b>${lastBar.time}</b> ` +
    `@ <b>${lastBar.close.toFixed(2)}</b> · ` +
    `Сигналов: <b>${signals.length}</b> ` +
    `(<span style="color:#26a69a">BUY ${buys}</span> / ` +
    `<span style="color:#ef5350">SELL ${sells}</span>)`;

  renderAnalysis(data);

  currentState = {
    ticker,
    price: lastBar.close,
    lotSize: payload.lotSize,
    strategyId,
    params,
  };
  updateAddButton();

  chart.timeScale().fitContent();
  equityChart.timeScale().fitContent();
}

// ===== Кнопка «В заметки» =====
document.getElementById('addToNotes').addEventListener('click', () => {
  if (!currentState) return;

  const entry = {
    ticker: currentState.ticker,
    addedAt: new Date().toISOString(),
    priceAtAdd: currentState.price,
    lotSize: currentState.lotSize,
    strategyId: currentState.strategyId,
    params: currentState.params,
  };

  const { action } = addOrUpdateWatchlist(entry);
  updateNotesBadge();

  showToast(
    action === 'added'
      ? `${entry.ticker} добавлен в заметки`
      : `${entry.ticker} обновлён в заметках`
  );
});

// ===== Оптимизация =====
document.getElementById('optimize').addEventListener('click', async () => {
  const ticker = document.getElementById('ticker').value;
  const capital = parseFloat(document.getElementById('capital').value);
  const commission = parseFloat(document.getElementById('commission').value);
  const slippage = parseFloat(document.getElementById('slippage').value);

  let payload;
  try {
    payload = await loadRealData(ticker);
  } catch (err) {
    showToast(`Не удалось загрузить данные: ${err.message}`);
    return;
  }

  const btn = document.getElementById('optimize');
  btn.disabled = true;
  btn.textContent = '⏳ Перебираем…';

  // Даём браузеру отрисовать кнопку перед тяжёлым циклом
  await new Promise(r => setTimeout(r, 20));

  const results = optimizeEmaPairs(payload.candles, {
    initialCapital: isNaN(capital) ? 100000 : capital,
    commissionPct:  isNaN(commission) ? 0.05 : commission,
    slippagePct:    isNaN(slippage) ? 0.05 : slippage,
    lotSize:        payload.lotSize,
  });

  btn.disabled = false;
  btn.textContent = '🔬 Оптимизировать EMA';

  if (results.length === 0) {
    showToast('Не нашлось ни одной комбинации с достаточным числом сделок');
    return;
  }

  const top = results.slice(0, 10);
  const current = readStrategyParams();

  const rows = top.map((r, i) => {
    const isCurrent = r.fast === current.fast && r.slow === current.slow;
    const retCls = r.returnPct > 0 ? 'good' : 'bad';
    const ddCls = r.drawdownPct < -20 ? 'bad' : r.drawdownPct < -10 ? 'neutral' : 'good';
    return `
      <tr class="${isCurrent ? 'row-current' : ''}">
        <td>${i + 1}</td>
        <td><b>${r.fast} / ${r.slow}</b>${isCurrent ? ' <span class="tag">текущая</span>' : ''}</td>
        <td class="${retCls}">${(r.returnPct >= 0 ? '+' : '') + r.returnPct.toFixed(2)}%</td>
        <td class="${ddCls}">${r.drawdownPct.toFixed(2)}%</td>
        <td>${r.trades}</td>
        <td>${r.winRate.toFixed(0)}%</td>
        <td class="${r.alpha > 0 ? 'good' : 'bad'}">${(r.alpha >= 0 ? '+' : '') + r.alpha.toFixed(2)}%</td>
      </tr>
    `;
  }).join('');

  document.getElementById('optimizerResults').innerHTML = `
    <table class="opt-table">
      <thead>
        <tr>
          <th>#</th>
          <th>EMA</th>
          <th>Доходность</th>
          <th>Просадка</th>
          <th>Сделок</th>
          <th>Win rate</th>
          <th>Альфа</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="opt-warning">
      ⚠️ Лучшая комбинация на истории не гарантирует лучший результат в будущем.
      Включи Out-of-sample 70/30, чтобы проверить, работает ли она на новых данных.
    </p>
  `;
  document.getElementById('optimizerSection').style.display = 'block';
  document.getElementById('optimizerSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ===== Экспорт сделок в CSV =====
function downloadBlob(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('exportCsv').addEventListener('click', () => {
  if (!currentLastResult) {
    showToast('Сначала посчитай бэктест');
    return;
  }
  const { ticker, strategyId, result } = currentLastResult;
  const header = 'entry_date,exit_date,entry_price,exit_price,shares,lots,pnl,pnl_pct,fees,open_at_end\n';
  const rows = result.trades.map(t => [
    t.entryTime,
    t.exitTime,
    t.entryPrice.toFixed(4),
    t.exitPrice.toFixed(4),
    t.shares,
    t.lots || '',
    t.pnl.toFixed(2),
    t.pnlPct.toFixed(2),
    (t.entryFee + t.exitFee).toFixed(2),
    t.openAtEnd ? 1 : 0,
  ].join(',')).join('\n');

  downloadBlob(`${ticker}_${strategyId}_trades.csv`, header + rows);
  showToast(`Скачано: ${result.trades.length} сделок`);
});

// ===== Экспорт сводки по всем тикерам =====
document.getElementById('exportSummary').addEventListener('click', async () => {
  const btn = document.getElementById('exportSummary');
  btn.disabled = true;
  btn.textContent = '⏳ Считаем…';

  const tickers = Array.from(document.getElementById('ticker').options).map(o => o.value);
  const strategyId = document.getElementById('strategy').value;
  const params = readStrategyParams();
  const capital = parseFloat(document.getElementById('capital').value);
  const commission = parseFloat(document.getElementById('commission').value);
  const slippage = parseFloat(document.getElementById('slippage').value);

  const rows = [['ticker', 'strategy', 'params', 'return_pct', 'bh_return_pct', 'alpha_pct', 'max_dd_pct', 'trades', 'win_rate_pct', 'fees_rub'].join(',')];

  for (const t of tickers) {
    try {
      const payload = await loadRealData(t);
      const signals = STRATEGIES[strategyId].generate(payload.candles, params);
      const r = runBacktest(payload.candles, signals, {
        initialCapital: isNaN(capital) ? 100000 : capital,
        commissionPct:  isNaN(commission) ? 0.05 : commission,
        slippagePct:    isNaN(slippage) ? 0.05 : slippage,
        lotSize:        payload.lotSize,
      });
      rows.push([
        t,
        strategyId,
        JSON.stringify(params).replace(/,/g, ';'),
        r.totalReturnPct.toFixed(2),
        r.bhReturnPct.toFixed(2),
        r.alphaPct.toFixed(2),
        r.maxDrawdownPct.toFixed(2),
        r.tradesCount,
        r.winRatePct.toFixed(0),
        r.totalFees.toFixed(2),
      ].join(','));
    } catch (err) {
      rows.push([t, strategyId, 'error', '', '', '', '', '', '', err.message].join(','));
    }
  }

  btn.disabled = false;
  btn.textContent = '📊 Сводка CSV';
  downloadBlob(`summary_${strategyId}.csv`, rows.join('\n'));
  showToast('Сводка скачана');
});

// ===== Инициализация =====
document.getElementById('reload').addEventListener('click', render);
document.getElementById('ticker').addEventListener('change', render);
document.getElementById('strategy').addEventListener('change', () => {
  renderStrategyParams();
  document.getElementById('optimizerSection').style.display = 'none';
  render();
});
document.getElementById('useSplit').addEventListener('change', render);

(function initFromUrl() {
  const p = new URLSearchParams(window.location.search);
  const t = p.get('ticker');
  if (!t) return;
  const select = document.getElementById('ticker');
  const exists = Array.from(select.options).some(o => o.value === t);
  if (exists) select.value = t;
})();

renderStrategyParams();
updateNotesBadge();
render();
