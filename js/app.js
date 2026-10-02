// js/app.js

// ===== Графики =====
const chartEl = document.getElementById('chart');
const chart = LightweightCharts.createChart(chartEl, {
  layout: { background: { color: '#0e1116' }, textColor: '#d1d4dc' },
  grid: { vertLines: { color: '#1f2430' }, horzLines: { color: '#1f2430' } },
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

const equityEl = document.getElementById('equityChart');
const equityChart = LightweightCharts.createChart(equityEl, {
  layout: { background: { color: '#0e1116' }, textColor: '#d1d4dc' },
  grid: { vertLines: { color: '#1f2430' }, horzLines: { color: '#1f2430' } },
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

const dataCache = new Map();

function normalizeTickerPayload(raw, ticker) {
  if (Array.isArray(raw)) {
    return {
      ticker, name: ticker, lotSize: 1, candles: raw,
      dividends: [], splits: [], fundamentals: null,
    };
  }
  if (raw && Array.isArray(raw.candles)) {
    return {
      ticker: raw.ticker || ticker,
      name: raw.name || ticker,
      lotSize: Number.isFinite(raw.lotSize) && raw.lotSize > 0 ? raw.lotSize : 1,
      candles: raw.candles,
      dividends: Array.isArray(raw.dividends) ? raw.dividends : [],
      splits: Array.isArray(raw.splits) ? raw.splits : [],
      fundamentals: raw.fundamentals || null,
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

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2400);
}

function updateNotesBadge() {
  document.getElementById('notesCount').textContent = loadWatchlist().length;
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

  const cards = [
    metricCard('Итог портфеля', fmtRub(r.finalValue), totalCls),
    metricCard('Доходность',    fmtPct(r.totalReturnPct), totalCls),
    metricCard('Buy & Hold',    fmtPct(r.bhReturnPct), r.bhReturnPct > 0 ? 'good' : 'bad'),
    metricCard('Альфа vs B&H',  fmtPct(r.alphaPct), alphaCls),
    metricCard('Макс. просадка', fmtPct(r.maxDrawdownPct), ddCls),
    metricCard('Сделок',        `${r.tradesCount} (win ${r.winRatePct.toFixed(0)}%)`),
    metricCard('Комиссии съели', fmtRub(r.totalFees)),
    metricCard('Ср. длительность', `${Math.round(r.avgTradeDays)} дн.`),
  ];

  if (r.totalDividends > 0) {
    cards.push(metricCard('Дивиденды (gross)', fmtRub(r.totalDividends), 'good'));
    cards.push(metricCard('НДФЛ 13%', fmtRub(r.totalDividendTax), 'neutral'));
  }

  document.getElementById(elId).innerHTML = cards.join('');
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

  const rsiVal = indicators.rsi != null ? indicators.rsi.toFixed(1) : '—';
  const macdVal = indicators.macd.macdValue != null ? indicators.macd.macdValue.toFixed(4) : '—';
  const sigVal = indicators.macd.signalValue != null ? indicators.macd.signalValue.toFixed(4) : '—';

  document.getElementById('indicatorValues').innerHTML = `
    <div class="indicator-value"><span>RSI(14):</span> <b>${rsiVal}</b></div>
    <div class="indicator-value"><span>MACD:</span> <b>${macdVal}</b></div>
    <div class="indicator-value"><span>Signal:</span> <b>${sigVal}</b></div>
  `;

  document.getElementById('reasons').innerHTML =
    reasons.map(r => `<li>${r}</li>`).join('');

  return analysis;
}

// ===== Фундаментальный анализ =====
function renderFundamentalSection(payload) {
  const section = document.getElementById('fundamentalSection');
  if (!section) return;

  const analysis = analyzeFundamentals(payload);
  if (!analysis) {
    section.style.display = 'none';
    return;
  }

  // Шапка: asOf
  const asOfEl = document.getElementById('fundamentalAsOf');
  if (asOfEl) {
    asOfEl.textContent = analysis.asOf ? `Данные на: ${analysis.asOf}` : '';
  }

  // Вердикт
  const vEl = document.getElementById('fundamentalVerdict');
  vEl.className = `verdict fundamental-verdict-box ${analysis.verdictClass}`;
  vEl.innerHTML = `
    <div class="verdict-main">${analysis.verdict}</div>
    <div class="verdict-score">Сумма баллов: ${analysis.score}</div>
  `;

  // Карточки метрик
  const cardsHtml = analysis.cards.map(c => `
    <div class="fundamental-card">
      <div class="fundamental-card-head">
        <div class="fundamental-card-key">${c.key}</div>
        <div class="fundamental-card-badge ${c.cls}">${c.verdict || ''}</div>
      </div>
      <div class="fundamental-card-value">${c.value}</div>
      <div class="fundamental-card-full">${c.full}</div>
      <div class="fundamental-card-hint">${c.hint}</div>
    </div>
  `).join('');
  document.getElementById('fundamentalMetrics').innerHTML = cardsHtml;

  // История по годам (таблица)
  const histWrap = document.querySelector('.fundamental-history-wrap');
  if (analysis.history && analysis.history.length > 0) {
    const keys = ['pe', 'pb', 'roe', 'roa', 'eps', 'divYield'];
    const labels = {
      pe: 'P/E', pb: 'P/B', roe: 'ROE %', roa: 'ROA %',
      eps: 'EPS ₽', divYield: 'Div %',
    };
    const head = '<tr><th>Год</th>' + keys.map(k => `<th>${labels[k]}</th>`).join('') + '</tr>';
    const rows = analysis.history.map(h => {
      const cells = keys.map(k => {
        const v = h[k];
        if (v == null) return '<td>—</td>';
        const digits = (k === 'roe' || k === 'roa' || k === 'divYield') ? 1 : 2;
        return `<td>${Number(v).toFixed(digits)}</td>`;
      }).join('');
      return `<tr><td><b>${h.year}</b></td>${cells}</tr>`;
    }).join('');
    document.getElementById('fundamentalHistory').innerHTML =
      `<table class="fundamental-history-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    if (histWrap) histWrap.style.display = '';
  } else {
    if (histWrap) histWrap.style.display = 'none';
  }

  section.style.display = 'block';
}

// ===== Секция корпоративных действий =====
function renderCorpSection(payload, result, splitEvents, gapDates, useSplits, useDividends) {
  const section = document.getElementById('corpSection');
  if (!section) return;

  // Санити-фильтр: дивиденд не может быть больше 50% цены акции.
  const MAX_DIV_RATIO = 0.5;
  const allDivs = (payload.dividends || []).filter(d => {
    if (!d || !d.date || !(Number(d.amount) > 0)) return false;
    const amount = Number(d.amount);
    const bar = payload.candles.find(b => b.time === d.date);
    if (bar && amount > bar.close * MAX_DIV_RATIO) {
      console.warn(
        `[app] Пропускаем подозрительный дивиденд ${amount} ₽ на ${d.date} ` +
        `(цена ${bar.close} ₽) — вероятно, ошибка парсинга`
      );
      return false;
    }
    return true;
  });
  const allSplits = payload.splits || [];

  if (allDivs.length === 0 && allSplits.length === 0) {
    section.style.display = 'none';
    return;
  }

  const totalDivPerShare = allDivs.reduce((s, d) => s + Number(d.amount), 0);
  const totalNet = result.totalDividends - result.totalDividendTax;

  const parts = [];
  if (allSplits.length > 0) {
    parts.push(`сплитов: <b>${allSplits.length}</b> (${useSplits ? 'учтены' : 'не учтены'})`);
  }
  if (allDivs.length > 0) {
    parts.push(
      `дивидендов: <b>${allDivs.length}</b> · ` +
      `суммарно <b>${totalDivPerShare.toFixed(2)} ₽</b> на акцию · ` +
      `начислено в бэктест <b>${result.totalDividends.toFixed(2)} ₽</b> gross ` +
      `(<b>${totalNet.toFixed(2)} ₽</b> после НДФЛ)`
    );
  }

  document.getElementById('corpSummary').innerHTML =
    `💼 Корпоративные действия · ` + parts.join(' · ');

  // Карта: дата -> событие начисления дивидендов в бэктесте
  const eventsByDate = new Map();
  for (const e of result.dividendEvents) {
    eventsByDate.set(e.date, e);
  }

  const rows = [];

  // Сплиты
  for (const s of allSplits) {
    rows.push({
      date: s.date,
      type: 'Сплит',
      detail: `1 → ${s.ratio} (дробление)`,
      effect: useSplits
        ? `<span class="good">учтён</span>`
        : `<span class="muted">выключен</span>`,
      sortKey: s.date,
    });
  }

  // Дивиденды (свежие сверху)
  const sortedDivs = [...allDivs].sort((a, b) => b.date.localeCompare(a.date));
  for (const d of sortedDivs) {
    const ev = eventsByDate.get(d.date);
    const received = ev
      ? `${ev.shares} акц. × ${Number(ev.amountPerShare).toFixed(2)} ₽ = <b>${Number(ev.net).toFixed(2)} ₽</b>`
      : '<span class="muted">позиции не было</span>';
    rows.push({
      date: d.date,
      type: 'Дивиденд',
      detail: `${Number(d.amount).toFixed(2)} ₽ на акцию`,
      effect: received,
      sortKey: d.date,
    });
  }

  rows.sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  document.getElementById('corpTable').innerHTML = `
    <table class="corp-table">
      <thead>
        <tr>
          <th>Дата</th>
          <th>Событие</th>
          <th>Параметры</th>
          <th>Влияние на бэктест</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.date}</td>
            <td>${r.type}</td>
            <td>${r.detail}</td>
            <td>${r.effect}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p class="corp-note">
      ℹ️ Дивиденд начисляется на каждую акцию в позиции в день отсечки.
      Сплиты приводят исторические цены к текущему масштабу — это убирает
      ложные провалы на графике. Текущая цена в строке статистики всегда реальная.
    </p>
  `;

  section.style.display = 'block';
}

// ===== Параметры стратегии =====
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
    wrap.innerHTML = `<span class="hint">У Buy &amp; Hold нет параметров.</span>`;
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

let currentState = null;
let currentLastResult = null;

function updateAddButton() {
  document.getElementById('addToNotes').disabled = !currentState;
}

// ===== Рендер =====
async function render() {
  const ticker      = document.getElementById('ticker').value;
  const strategyId  = document.getElementById('strategy').value;
  const capital     = parseFloat(document.getElementById('capital').value);
  const commission  = parseFloat(document.getElementById('commission').value);
  const slippage    = parseFloat(document.getElementById('slippage').value);
  const useSplit    = document.getElementById('useSplit').checked;
  const useSplits   = document.getElementById('useCorpSplits').checked;
  const useDividends = document.getElementById('useCorpDividends').checked;

  const params = readStrategyParams();

  if (strategyId === 'ema' && params.fast >= params.slow) {
    document.getElementById('stats').innerHTML =
      '<b style="color:#ef5350">Быстрая EMA должна быть меньше медленной.</b>';
    document.getElementById('metrics').innerHTML = '';
    document.getElementById('splitSection').style.display = 'none';
    document.getElementById('corpSection').style.display = 'none';
    document.getElementById('fundamentalSection').style.display = 'none';
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
    document.getElementById('corpSection').style.display = 'none';
    document.getElementById('fundamentalSection').style.display = 'none';
    currentState = null;
    currentLastResult = null;
    updateAddButton();
    return;
  }

  const realData = payload.candles;

  // Применяем корпоративные действия
  const { adjusted, splitEvents, gapDates } = applyCorporateActions(realData, payload, {
    useSplits,
    useDividends,
  });

  const closes = adjusted.map(d => d.close);
  const strategy = STRATEGIES[strategyId];
  const signals = strategy.generate(adjusted, params);

  candleSeries.setData(adjusted);

  if (strategyId === 'ema') {
    const fastArr = ema(closes, params.fast);
    const slowArr = ema(closes, params.slow);
    emaFastSeries.setData(
      adjusted.map((d, i) => fastArr[i] == null ? null : { time: d.time, value: +fastArr[i].toFixed(2) }).filter(Boolean)
    );
    emaSlowSeries.setData(
      adjusted.map((d, i) => slowArr[i] == null ? null : { time: d.time, value: +slowArr[i].toFixed(2) }).filter(Boolean)
    );
  } else {
    emaFastSeries.setData([]);
    emaSlowSeries.setData([]);
  }

  // ===== Маркеры =====
  const markers = signals.map(s => ({
    time: adjusted[s.index].time,
    position: s.type === 'buy' ? 'belowBar' : 'aboveBar',
    color: s.type === 'buy' ? '#26a69a' : '#ef5350',
    shape: s.type === 'buy' ? 'arrowUp' : 'arrowDown',
    text: s.type === 'buy' ? 'BUY' : 'SELL',
  }));

  if (useSplits) {
    for (const e of splitEvents) {
      markers.push({
        time: e.date,
        position: 'aboveBar',
        color: '#4a9eff',
        shape: 'square',
        text: 'S',
      });
    }
  }

  if (useDividends) {
    for (const g of gapDates) {
      markers.push({
        time: g.date,
        position: 'aboveBar',
        color: '#d4a72c',
        shape: 'circle',
        text: 'D',
      });
    }
  }

  markers.sort((a, b) => a.time.localeCompare(b.time));
  candleSeries.setMarkers(markers);

  const backtestOptions = {
    initialCapital: isNaN(capital) ? 100000 : capital,
    commissionPct:  isNaN(commission) ? 0.05 : commission,
    slippagePct:    isNaN(slippage) ? 0.05 : slippage,
    lotSize:        payload.lotSize,
    dividends:      useDividends ? payload.dividends : [],
  };

  const result = runBacktest(adjusted, signals, backtestOptions);
  currentLastResult = { ticker, strategyId, params, result, payload };

  equitySeries.setData(result.equity);
  renderMetricsInto('metrics', result);

  if (useSplit) {
    const split = runSplitBacktest(adjusted, signals, backtestOptions, 0.7);
    renderMetricsInto('trainMetrics', split.train);
    renderMetricsInto('testMetrics', split.test);
    document.getElementById('splitSection').style.display = 'block';
  } else {
    document.getElementById('splitSection').style.display = 'none';
  }

  const lastBar = adjusted[adjusted.length - 1];
  const rawLastBar = realData[realData.length - 1];
  const buys  = signals.filter(s => s.type === 'buy').length;
  const sells = signals.filter(s => s.type === 'sell').length;

  const showRawPrice = Math.abs(lastBar.close - rawLastBar.close) > 0.01;

  document.getElementById('stats').innerHTML =
    `Тикер: <b>${ticker}</b> (${payload.name}) · Лот: <b>${payload.lotSize}</b> · ` +
    `Стратегия: <b>${strategy.label}</b> · ` +
    `Баров: <b>${adjusted.length}</b> · Последний: <b>${lastBar.time}</b> ` +
    `@ <b>${rawLastBar.close.toFixed(2)} ₽</b> ` +
    (showRawPrice ? `<span class="badge-adjusted" title="На графике цена приведена к текущему масштабу">скорр.</span>` : '') +
    ` · Сигналов: <b>${signals.length}</b> ` +
    `(<span style="color:#26a69a">BUY ${buys}</span> / ` +
    `<span style="color:#ef5350">SELL ${sells}</span>)`;

  renderCorpSection(payload, result, splitEvents, gapDates, useSplits, useDividends);
  renderAnalysis(adjusted);
  renderFundamentalSection(payload);

  currentState = {
    ticker,
    price: rawLastBar.close,
    lotSize: payload.lotSize,
    strategyId,
    params,
  };
  updateAddButton();

  chart.timeScale().fitContent();
  equityChart.timeScale().fitContent();
}

// ===== Кнопки =====
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

document.getElementById('optimize').addEventListener('click', async () => {
  const ticker = document.getElementById('ticker').value;
  const capital = parseFloat(document.getElementById('capital').value);
  const commission = parseFloat(document.getElementById('commission').value);
  const slippage = parseFloat(document.getElementById('slippage').value);
  const useSplits = document.getElementById('useCorpSplits').checked;
  const useDividends = document.getElementById('useCorpDividends').checked;

  let payload;
  try {
    payload = await loadRealData(ticker);
  } catch (err) {
    showToast(`Не удалось загрузить данные: ${err.message}`);
    return;
  }

  const { adjusted: optData } = applyCorporateActions(payload.candles, payload, {
    useSplits, useDividends,
  });

  const btn = document.getElementById('optimize');
  btn.disabled = true;
  btn.textContent = '⏳ Перебираем…';
  await new Promise(r => setTimeout(r, 20));

  const results = optimizeEmaPairs(optData, {
    initialCapital: isNaN(capital) ? 100000 : capital,
    commissionPct:  isNaN(commission) ? 0.05 : commission,
    slippagePct:    isNaN(slippage) ? 0.05 : slippage,
    lotSize:        payload.lotSize,
    dividends:      useDividends ? payload.dividends : [],
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
          <th>#</th><th>EMA</th><th>Доходность</th><th>Просадка</th>
          <th>Сделок</th><th>Win rate</th><th>Альфа</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="opt-warning">
      ⚠️ Лучшая комбинация на истории не гарантирует лучший результат в будущем.
    </p>
  `;
  document.getElementById('optimizerSection').style.display = 'block';
  document.getElementById('optimizerSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

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
    t.entryTime, t.exitTime,
    t.entryPrice.toFixed(4), t.exitPrice.toFixed(4),
    t.shares, t.lots || '',
    t.pnl.toFixed(2), t.pnlPct.toFixed(2),
    (t.entryFee + t.exitFee).toFixed(2),
    t.openAtEnd ? 1 : 0,
  ].join(',')).join('\n');

  let text = header + rows;

  if (result.dividendEvents.length > 0) {
    text += '\n\n# Dividends\n';
    text += 'date,amount_per_share,shares,lots,gross,tax,net\n';
    text += result.dividendEvents.map(e => [
      e.date, e.amountPerShare.toFixed(4), e.shares, e.lots,
      e.gross.toFixed(2), e.tax.toFixed(2), e.net.toFixed(2),
    ].join(',')).join('\n');
  }

  downloadBlob(`${ticker}_${strategyId}_trades.csv`, text);
  showToast(`Скачано: ${result.trades.length} сделок, ${result.dividendEvents.length} дивидендов`);
});

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
  const useSplits = document.getElementById('useCorpSplits').checked;
  const useDividends = document.getElementById('useCorpDividends').checked;

  const rows = [['ticker', 'strategy', 'params', 'return_pct', 'bh_return_pct', 'alpha_pct', 'max_dd_pct', 'trades', 'win_rate_pct', 'fees_rub', 'dividends_gross', 'dividends_tax'].join(',')];

  for (const t of tickers) {
    try {
      const payload = await loadRealData(t);
      const { adjusted } = applyCorporateActions(payload.candles, payload, { useSplits, useDividends });
      const signals = STRATEGIES[strategyId].generate(adjusted, params);
      const r = runBacktest(adjusted, signals, {
        initialCapital: isNaN(capital) ? 100000 : capital,
        commissionPct:  isNaN(commission) ? 0.05 : commission,
        slippagePct:    isNaN(slippage) ? 0.05 : slippage,
        lotSize:        payload.lotSize,
        dividends:      useDividends ? payload.dividends : [],
      });
      rows.push([
        t, strategyId,
        JSON.stringify(params).replace(/,/g, ';'),
        r.totalReturnPct.toFixed(2),
        r.bhReturnPct.toFixed(2),
        r.alphaPct.toFixed(2),
        r.maxDrawdownPct.toFixed(2),
        r.tradesCount,
        r.winRatePct.toFixed(0),
        r.totalFees.toFixed(2),
        r.totalDividends.toFixed(2),
        r.totalDividendTax.toFixed(2),
      ].join(','));
    } catch (err) {
      rows.push([t, strategyId, 'error', '', '', '', '', '', '', '', '', err.message].join(','));
    }
  }

  btn.disabled = false;
  btn.textContent = '📊 Сводка CSV';
  downloadBlob(`summary_${strategyId}.csv`, rows.join('\n'));
  showToast('Сводка скачана');
});

document.getElementById('reload').addEventListener('click', render);
document.getElementById('ticker').addEventListener('change', render);
document.getElementById('strategy').addEventListener('change', () => {
  renderStrategyParams();
  document.getElementById('optimizerSection').style.display = 'none';
  render();
});
document.getElementById('useSplit').addEventListener('change', render);
document.getElementById('useCorpSplits').addEventListener('change', render);
document.getElementById('useCorpDividends').addEventListener('change', render);

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
