// js/app.js

// ============================================================
// [DEBUG] Панель производительности. УДАЛИТЬ после диагностики.
// ============================================================
const __debug = {
  enabled: false,
  starts: {},
  data: {},
  start(label) { this.starts[label] = performance.now(); },
  end(label) {
    if (this.starts[label] == null) return;
    const dur = performance.now() - this.starts[label];
    this.data[label] = (this.data[label] || 0) + dur;
    delete this.starts[label];
  },
  reset() { this.starts = {}; this.data = {}; },
  show() {
    if (!this.enabled) return;
    let el = document.getElementById('__debug');
    if (!el) {
      el = document.createElement('div');
      el.id = '__debug';
      el.style.cssText = `
        position:fixed; top:56px; right:8px; z-index:9999;
        background:rgba(0,0,0,0.88); color:#4ade80;
        font-family:ui-monospace,Menlo,monospace; font-size:11px;
        padding:8px 10px; border-radius:6px;
        max-width:260px; white-space:pre; line-height:1.4;
        cursor:pointer;
      `;
      el.title = 'Тап — скрыть';
      el.addEventListener('click', () => el.remove());
      document.body.appendChild(el);
    }
    const rows = Object.entries(this.data).sort((a, b) => b[1] - a[1]);
    el.textContent = '⏱ PERFORMANCE\n' +
      rows.map(([k, v]) => `${k}: ${v.toFixed(0)} ms`).join('\n');
  },
};
// ============================================================
// [/DEBUG]
// ============================================================

// ============================================================
// 1. ГРАФИКИ
// ============================================================
// Свечной график и equity-график создаются ПО-РАЗНОМУ:
//   — Свечной создаётся сразу: он в табе «Обзор», активном по умолчанию.
//   — Equity создаётся lazy: он в табе «Стратегия», который может быть скрыт.
//     Lightweight Charts не умеет рисовать в контейнер с width=0.
//   — Macro-график тоже lazy — та же причина.

// ---------- Палитра графиков из CSS-переменных ----------
function getChartColors() {
  const styles = getComputedStyle(document.documentElement);
  const get = (name, fallback) => {
    const v = styles.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    bg: get('--bg', '#0a0d12'),
    text: get('--text', '#e6e9ef'),
    grid: get('--border', '#242933'),
    border: get('--border-strong', '#30363f'),
    accent: get('--accent', '#4ade80'),
    danger: get('--danger', '#f87171'),
    blue: get('--blue', '#60a5fa'),
  };
}

// ---------- Свечной график (Обзор) ----------
const chartEl = document.getElementById('chart');
const chart = LightweightCharts.createChart(chartEl, {
  width: chartEl.clientWidth,
  height: chartEl.clientHeight || 320,
  layout: { background: { color: getChartColors().bg }, textColor: getChartColors().text },
  grid: { vertLines: { color: getChartColors().grid }, horzLines: { color: getChartColors().grid } },
  rightPriceScale: { borderColor: getChartColors().border },
  timeScale: { borderColor: getChartColors().border, timeVisible: false },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});

const candleSeries = chart.addCandlestickSeries({
  upColor: getChartColors().accent,
  downColor: getChartColors().danger,
  borderUpColor: getChartColors().accent,
  borderDownColor: getChartColors().danger,
  wickUpColor: getChartColors().accent,
  wickDownColor: getChartColors().danger,
});
const emaFastSeries = chart.addLineSeries({ color: getChartColors().accent, lineWidth: 2 });
const emaSlowSeries = chart.addLineSeries({ color: getChartColors().danger, lineWidth: 2 });

// ---------- Equity-график (Стратегия) — LAZY ----------
let equityChart = null;
let equitySeries = null;
let pendingEquityData = null;

function ensureEquityChart() {
  if (equityChart) return;
  const el = document.getElementById('equityChart');
  if (!el || el.clientWidth === 0) return;

  const c = getChartColors();
  equityChart = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight || 180,
    layout: { background: { color: c.bg }, textColor: c.text },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    rightPriceScale: { borderColor: c.border },
    timeScale: { borderColor: c.border, timeVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });
  equitySeries = equityChart.addAreaSeries({
    lineColor: c.accent,
    topColor: 'rgba(74, 222, 128, 0.30)',
    bottomColor: 'rgba(74, 222, 128, 0.0)',
    lineWidth: 2,
  });
}

function applyEquityData(data) {
  pendingEquityData = data;
  if (!data) return;
  if (!equityChart) {
    // Создаём график только если контейнер уже виден
    if (isTabActive('strategy')) {
      ensureEquityChart();
    }
  }
  if (equityChart && equitySeries) {
    equitySeries.setData(data);
    equityChart.timeScale().fitContent();
  }
}

// ---------- Макро-график (Анализ) — LAZY ----------
let macroChart = null;
let macroSeries = null;
let pendingMacroData = null;

function ensureMacroChart() {
  if (macroChart) return;
  const el = document.getElementById('macroChart');
  if (!el || el.clientWidth === 0) return;

  const c = getChartColors();
  macroChart = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight || 180,
    layout: { background: { color: c.bg }, textColor: c.text },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    rightPriceScale: { borderColor: c.border },
    timeScale: { borderColor: c.border, timeVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });
  macroSeries = macroChart.addAreaSeries({
    lineColor: c.blue,
    topColor: 'rgba(96, 165, 250, 0.30)',
    bottomColor: 'rgba(96, 165, 250, 0.0)',
    lineWidth: 2,
  });
}

function applyMacroData(data) {
  pendingMacroData = data;
  if (!data) return;
  if (!macroChart) {
    if (isTabActive('analysis')) {
      ensureMacroChart();
    }
  }
  if (macroChart && macroSeries) {
    macroSeries.setData(data);
    const el = document.getElementById('macroChart');
    if (el && el.clientWidth > 0) {
      macroChart.applyOptions({ width: el.clientWidth });
    }
    macroChart.timeScale().fitContent();
  }
}

// ---------- Реакция на смену темы и таба ----------

function isTabActive(name) {
  const el = document.querySelector(`.tab-content[data-tab="${name}"]`);
  return !!(el && el.classList.contains('active'));
}

// Перекрашиваем все графики под текущую тему
function applyThemeToCharts() {
  const c = getChartColors();

  // Свечной
  chart.applyOptions({
    layout: { background: { color: c.bg }, textColor: c.text },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    rightPriceScale: { borderColor: c.border },
    timeScale: { borderColor: c.border },
  });
  candleSeries.applyOptions({
    upColor: c.accent,
    downColor: c.danger,
    borderUpColor: c.accent,
    borderDownColor: c.danger,
    wickUpColor: c.accent,
    wickDownColor: c.danger,
  });
  emaFastSeries.applyOptions({ color: c.accent });
  emaSlowSeries.applyOptions({ color: c.danger });

  // Equity
  if (equityChart) {
    equityChart.applyOptions({
      layout: { background: { color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border },
    });
    if (equitySeries) equitySeries.applyOptions({ lineColor: c.accent });
  }

  // Macro
  if (macroChart) {
    macroChart.applyOptions({
      layout: { background: { color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border },
    });
    if (macroSeries) macroSeries.applyOptions({ lineColor: c.blue });
  }
}

// Наблюдаем за сменой темы: inline-скрипт в index.html
// ставит/убирает атрибут data-theme на <html>.
const themeObserver = new MutationObserver(() => {
  applyThemeToCharts();
});
themeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

// Наблюдаем за сменой таба: как только таб становится активным —
// создаём графики, которые до этого момента были скрыты.
const tabObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.attributeName !== 'class') continue;
    const el = m.target;
    if (!el.classList.contains('active')) continue;

    if (el.dataset.tab === 'strategy') {
      ensureEquityChart();
      if (pendingEquityData && equitySeries) {
        equitySeries.setData(pendingEquityData);
        equityChart.timeScale().fitContent();
      }
    }
    if (el.dataset.tab === 'analysis') {
      ensureMacroChart();
      if (pendingMacroData && macroSeries) {
        macroSeries.setData(pendingMacroData);
        const mEl = document.getElementById('macroChart');
        if (mEl && mEl.clientWidth > 0) {
          macroChart.applyOptions({ width: mEl.clientWidth });
        }
        macroChart.timeScale().fitContent();
      }
    }
  }
});
document.querySelectorAll('.tab-content').forEach(tc => {
  tabObserver.observe(tc, { attributes: true, attributeFilter: ['class'] });
});

// ---------- Ресайз ----------
function resizeCharts() {
  if (chartEl.clientWidth > 0) {
    chart.applyOptions({ width: chartEl.clientWidth });
  }
  if (equityChart) {
    const el = document.getElementById('equityChart');
    if (el && el.clientWidth > 0) {
      equityChart.applyOptions({ width: el.clientWidth });
    }
  }
  if (macroChart) {
    const el = document.getElementById('macroChart');
    if (el && el.clientWidth > 0) {
      macroChart.applyOptions({ width: el.clientWidth });
    }
  }
}
window.addEventListener('resize', resizeCharts);

// ============================================================
// 2. ЗАГРУЗКА ДАННЫХ
// ============================================================

const dataCache = new Map();
let macroCache = null;
let correlationCache = null;

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

async function loadMacroData() {
  if (macroCache !== null) return macroCache;
  try {
    const resp = await fetch('./data/macro.json');
    if (!resp.ok) {
      console.warn(`[macro] не удалось загрузить macro.json: HTTP ${resp.status}`);
      macroCache = null;
      return null;
    }
    macroCache = await resp.json();
    return macroCache;
  } catch (err) {
    console.warn(`[macro] ошибка загрузки: ${err.message}`);
    macroCache = null;
    return null;
  }
}

// Загрузка данных для набора корреляции.
// Набор берётся из getCorrelationSet() — это может быть дефолт,
// «Избранное» или ручной выбор пользователя (см. раздел 16).
async function loadCorrelationData() {
  const tickers = getCorrelationSet();

  // Простой кэш: если набор не менялся и данные уже загружены — отдаём как есть.
  if (correlationCache && correlationCache.__setKey === tickers.join(',')) {
    return correlationCache;
  }

  const results = await Promise.allSettled(tickers.map(t => loadRealData(t)));
  const payloads = {};
  tickers.forEach((t, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') {
      payloads[t] = r.value;
    } else {
      console.warn(`[correlation] ${t}: ${r.reason && r.reason.message}`);
    }
  });

  // Сохраняем «отпечаток» набора, чтобы понимать, надо ли пересчитывать.
  payloads.__setKey = tickers.join(',');
  correlationCache = payloads;
  return payloads;
}

async function renderCorrelation() {
  const section = document.getElementById('correlationSection');
  if (!section) return;

  try {
    __debug.start('corr.load');
    const payloads = await loadCorrelationData();
    __debug.end('corr.load');

    const useSplits = document.getElementById('useCorpSplits').checked;
    const useDividends = document.getElementById('useCorpDividends').checked;

    // Тикеры — из текущего набора
    const tickers = getCorrelationSet();

    __debug.start('corr.compute');
    const result = computeCorrelations(payloads, { useSplits, useDividends }, tickers);
    __debug.end('corr.compute');

    __debug.start('corr.render');
    renderCorrelationSection(result);
    __debug.end('corr.render');
  } catch (err) {
    console.warn('[correlation] ошибка:', err);
    section.style.display = 'none';
  }
}

// ============================================================
// 3. ВСПОМОГАТЕЛЬНЫЕ
// ============================================================

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2400);
}

function updateNotesBadge() {
  const el = document.getElementById('notesCount');
  if (el) el.textContent = loadWatchlist().length;
}

// ============================================================
// 4. МЕТРИКИ
// ============================================================

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

// ============================================================
// 5. АНАЛИЗ (технический)
// ============================================================

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

// ============================================================
// 6. ФУНДАМЕНТАЛ
// ============================================================

function renderFundamentalSection(payload) {
  const section = document.getElementById('fundamentalSection');
  if (!section) return;

  const analysis = analyzeFundamentals(payload);
  if (!analysis) {
    // Фундаментал ещё не загружен (идёт умная ротация Smart-Lab).
    // Не скрываем секцию, а показываем понятную заглушку — иначе кажется,
    // что что-то сломалось.
    const ticker = payload.ticker || 'этой бумаги';

    const asOfEl = document.getElementById('fundamentalAsOf');
    if (asOfEl) asOfEl.textContent = '';

    const vEl = document.getElementById('fundamentalVerdict');
    if (vEl) {
      vEl.className = 'fundamental-verdict-box';
      vEl.innerHTML = '';
    }

    const metricsEl = document.getElementById('fundamentalMetrics');
    if (metricsEl) {
      metricsEl.innerHTML = `
        <div class="fundamental-stub">
          <div class="fundamental-stub-icon">📊</div>
          <div class="fundamental-stub-title">Фундаментал для ${ticker} пока не загружен</div>
          <div class="fundamental-stub-text">
            Он появится в ближайшее время — по мере обновления данных со Smart-Lab.
            Мы тянем показатели постепенно, чтобы не перегружать источник.
          </div>
        </div>
      `;
    }

    const histWrap = document.querySelector('.fundamental-history-wrap');
    if (histWrap) histWrap.style.display = 'none';

    section.style.display = 'block';
    return;
  }

  const asOfEl = document.getElementById('fundamentalAsOf');
  if (asOfEl) {
    asOfEl.textContent = analysis.asOf ? `Данные на: ${analysis.asOf}` : '';
  }

  const vEl = document.getElementById('fundamentalVerdict');
  vEl.className = `verdict fundamental-verdict-box ${analysis.verdictClass}`;
  vEl.innerHTML = `
    <div class="verdict-main">${analysis.verdict}</div>
    <div class="verdict-score">Сумма баллов: ${analysis.score}</div>
  `;

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

// ============================================================
// 7. РИСК-МЕНЕДЖМЕНТ
// ============================================================

function renderRiskSection(adjustedData, options) {
  const section = document.getElementById('riskSection');
  if (!section) return;

  const risk = analyzeRisk(adjustedData, options);
  if (!risk) {
    section.style.display = 'none';
    return;
  }

  const fmtRub = v => v.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
  const fmtPct = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

  const subEl = document.getElementById('riskSubtitle');
  if (subEl) {
    subEl.textContent =
      `Текущая цена: ${risk.price.toFixed(2)} ₽ · Лот: ${risk.lotSize} · ` +
      `Риск на сделку: ${risk.riskPct.toFixed(2)}% (${fmtRub(risk.maxRiskRub)})`;
  }

  const lotsCls = risk.recommendedLots > 0 ? 'good' : 'bad';
  const lotWord = (n) => {
    if (n === 1) return 'лот';
    if (n >= 2 && n <= 4) return 'лота';
    return 'лотов';
  };

  const cards = [
    {
      key: 'ATR(14)',
      full: `средний дневной размах`,
      value: `${risk.atr.toFixed(2)} ₽`,
      subvalue: `${risk.atrPct.toFixed(2)}% от цены`,
      cls: 'neutral',
    },
    {
      key: `Стоп-цена`,
      full: `цена − ${risk.atrMultiplier} × ATR`,
      value: `${risk.stopPrice.toFixed(2)} ₽`,
      subvalue: `${fmtPct(risk.stopPct)} от текущей`,
      cls: risk.stopPct < -20 ? 'bad' : risk.stopPct < -10 ? 'neutral' : 'good',
    },
    {
      key: 'Риск на акцию',
      full: 'сколько потеряешь на одной акции',
      value: `${risk.riskPerShare.toFixed(2)} ₽`,
      subvalue: `при срабатывании стопа`,
      cls: 'neutral',
    },
    {
      key: 'Рекомендованный размер',
      full: `чтобы риск ≤ ${risk.riskPct.toFixed(1)}% капитала`,
      value: `${risk.recommendedLots} ${lotWord(risk.recommendedLots)}`,
      subvalue: `${risk.recommendedShares} акц. · ${fmtRub(risk.positionValue)} (${risk.positionPct.toFixed(1)}% капитала)`,
      cls: lotsCls,
    },
    {
      key: 'Фактический риск',
      full: 'если стоп сработает',
      value: fmtRub(risk.actualRiskRub),
      subvalue: `${risk.actualRiskPct.toFixed(2)}% от капитала`,
      cls: risk.actualRiskPct > risk.riskPct + 0.5 ? 'bad' : 'good',
    },
  ];

  const html = cards.map(c => `
    <div class="risk-card">
      <div class="risk-card-head">
        <div class="risk-card-key">${c.key}</div>
      </div>
      <div class="risk-card-value ${c.cls}">${c.value}</div>
      <div class="risk-card-sub">${c.subvalue}</div>
      <div class="risk-card-full">${c.full}</div>
    </div>
  `).join('');

  let warnHtml = '';
  if (risk.noCash) {
    warnHtml = `<div class="risk-warn">⚠️ Капитала не хватает даже на 1 лот (${fmtRub(risk.price * risk.lotSize)}).</div>`;
  } else if (risk.riskCapped) {
    warnHtml = `<div class="risk-hint">💡 Размер позиции ограничен риском: денег хватило бы на ${risk.maxLotsByCash} лот, но риск-лимит позволяет только ${risk.maxLotsByRisk}.</div>`;
  } else {
    warnHtml = `<div class="risk-hint">💡 Размер позиции ограничен капиталом: риск-лимит позволял бы до ${risk.maxLotsByRisk} лот, но на ${risk.maxLotsByCash} хватает денег.</div>`;
  }

  document.getElementById('riskMetrics').innerHTML = html + warnHtml;
  section.style.display = 'block';
}

// ============================================================
// 8. МАКРО
// ============================================================

function renderMacroSection(macroData) {
  const section = document.getElementById('macroSection');
  if (!section) return;

  const analysis = analyzeMacro(macroData);
  if (!analysis) {
    section.style.display = 'none';
    return;
  }

  const updatedEl = document.getElementById('macroUpdatedAt');
  if (updatedEl) {
    updatedEl.textContent = analysis.updatedAt ? `Обновлено: ${analysis.updatedAt}` : '';
  }

  const cardsHtml = analysis.cards.map(c => {
    const changesHtml = c.changes && c.changes.length > 0
      ? `<div class="macro-card-changes">
          ${c.changes.map(ch => `
            <div class="macro-change">
              <span class="macro-change-label">${ch.label}</span>
              <span class="macro-change-value ${_changeCls(ch.value)}">${_fmtChange(ch.value)}</span>
            </div>
          `).join('')}
         </div>`
      : `<div class="macro-card-changes macro-card-changes-empty">—</div>`;

    return `
      <div class="macro-card">
        <div class="macro-card-head">
          <div class="macro-card-key">${c.key}</div>
          <div class="macro-card-date">${c.date || ''}</div>
        </div>
        <div class="macro-card-value">${c.value}</div>
        <div class="macro-card-full">${c.full}</div>
        ${changesHtml}
        <div class="macro-card-hint">${c.hint}</div>
      </div>
    `;
  }).join('');
  document.getElementById('macroMetrics').innerHTML = cardsHtml;

  const chartWrap = document.querySelector('.macro-chart-wrap');
  const hasChartData = analysis.chartData && analysis.chartData.length > 0;

  if (hasChartData) {
    if (chartWrap) chartWrap.style.display = '';
    // Откладываем отрисовку графика до показа таба
    pendingMacroData = analysis.chartData;
    if (isTabActive('analysis')) {
      ensureMacroChart();
      if (macroChart && macroSeries) {
        macroSeries.setData(pendingMacroData);
        const el = document.getElementById('macroChart');
        if (el && el.clientWidth > 0) {
          macroChart.applyOptions({ width: el.clientWidth });
        }
        macroChart.timeScale().fitContent();
      }
    }
  } else {
    if (chartWrap) chartWrap.style.display = 'none';
  }

  section.style.display = 'block';
}

// ============================================================
// 9. КОРПОРАТИВНЫЕ ДЕЙСТВИЯ
// ============================================================

function renderCorpSection(payload, result, splitEvents, gapDates, useSplits, useDividends) {
  const section = document.getElementById('corpSection');
  if (!section) return;

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

  const eventsByDate = new Map();
  for (const e of result.dividendEvents) {
    eventsByDate.set(e.date, e);
  }

  const rows = [];

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

// ============================================================
// 10. ПАРАМЕТРЫ СТРАТЕГИИ
// ============================================================

// Человеческие описания стратегий — для обзора «для новичка»
const STRATEGY_DESCRIPTIONS = {
  ema: 'Покупает, когда быстрая EMA пересекает медленную снизу вверх. Продаёт — когда сверху вниз.',
  rsi: 'Покупает, когда RSI падает ниже уровня перепроданности. Продаёт — когда поднимается выше уровня перекупленности.',
  bollinger: 'Покупает, когда цена пробивает нижнюю полосу Боллинджера. Продаёт — когда возвращается к средней.',
  buyhold: 'Просто покупает в начале и держит до конца. Это «точка отсчёта» для других стратегий.',
};

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
  const btn = document.getElementById('addToNotes');
  if (btn) btn.disabled = !currentState;
}

// ============================================================
// 11. ГЛАВНЫЙ РЕНДЕР
// ============================================================

async function render() {
  __debug.reset();
  __debug.start('total');

  const ticker      = document.getElementById('ticker').value;
  const strategyId  = document.getElementById('strategy').value;
  const capital     = parseFloat(document.getElementById('capital').value);
  const commission  = parseFloat(document.getElementById('commission').value);
  const slippage    = parseFloat(document.getElementById('slippage').value);
  const riskPct     = parseFloat(document.getElementById('riskPct').value);
  const useSplit    = document.getElementById('useSplit').checked;
  const useSplits   = document.getElementById('useCorpSplits').checked;
  const useDividends = document.getElementById('useCorpDividends').checked;

  const params = readStrategyParams();

  if (strategyId === 'ema' && params.fast >= params.slow) {
    document.getElementById('stats').innerHTML =
      '<b style="color:#f87171">Быстрая EMA должна быть меньше медленной.</b>';
    document.getElementById('metrics').innerHTML = '';
    document.getElementById('splitSection').style.display = 'none';
    document.getElementById('corpSection').style.display = 'none';
    document.getElementById('fundamentalSection').style.display = 'none';
    document.getElementById('riskSection').style.display = 'none';
    document.getElementById('macroSection').style.display = 'none';
    document.getElementById('correlationSection').style.display = 'none';
    currentState = null;
    currentLastResult = null;
    updateAddButton();
    __debug.end('total');
    __debug.show();
    return;
  }

  let payload;
  try {
    document.getElementById('stats').innerHTML = 'Загрузка данных…';
    __debug.start('loadData');
    payload = await loadRealData(ticker);
    __debug.end('loadData');
  } catch (err) {
    console.error(err);
    document.getElementById('stats').innerHTML =
      `<b style="color:#f87171">Ошибка загрузки: ${err.message}</b>`;
    document.getElementById('metrics').innerHTML = '';
    document.getElementById('splitSection').style.display = 'none';
    document.getElementById('corpSection').style.display = 'none';
    document.getElementById('fundamentalSection').style.display = 'none';
    document.getElementById('riskSection').style.display = 'none';
    document.getElementById('macroSection').style.display = 'none';
    document.getElementById('correlationSection').style.display = 'none';
    currentState = null;
    currentLastResult = null;
    updateAddButton();
    __debug.end('total');
    __debug.show();
    return;
  }

  const realData = payload.candles;

  __debug.start('corpActions');
  const { adjusted, splitEvents, gapDates } = applyCorporateActions(realData, payload, {
    useSplits,
    useDividends,
  });
  __debug.end('corpActions');

  const closes = adjusted.map(d => d.close);
  const strategy = STRATEGIES[strategyId];

  __debug.start('signals');
  const signals = strategy.generate(adjusted, params);
  __debug.end('signals');

  __debug.start('chart');
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

  const markers = signals.map(s => ({
    time: adjusted[s.index].time,
    position: s.type === 'buy' ? 'belowBar' : 'aboveBar',
    color: s.type === 'buy' ? getChartColors().accent : getChartColors().danger,
    shape: s.type === 'buy' ? 'arrowUp' : 'arrowDown',
    text: s.type === 'buy' ? 'BUY' : 'SELL',
  }));

  if (useSplits) {
    for (const e of splitEvents) {
      markers.push({
        time: e.date,
        position: 'aboveBar',
        color: getChartColors().blue,
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
        color: '#fbbf24',
        shape: 'circle',
        text: 'D',
      });
    }
  }

  markers.sort((a, b) => a.time.localeCompare(b.time));
  candleSeries.setMarkers(markers);
  __debug.end('chart');

  const backtestOptions = {
    initialCapital: isNaN(capital) ? 100000 : capital,
    commissionPct:  isNaN(commission) ? 0.05 : commission,
    slippagePct:    isNaN(slippage) ? 0.05 : slippage,
    lotSize:        payload.lotSize,
    dividends:      useDividends ? payload.dividends : [],
  };

  __debug.start('backtest');
  const result = runBacktest(adjusted, signals, backtestOptions);
  currentLastResult = { ticker, strategyId, params, result, payload };

  // Equity — откладываем отрисовку, если таб «Стратегия» не активен
  applyEquityData(result.equity);

  renderMetricsInto('metrics', result);
  __debug.end('backtest');

  if (useSplit) {
    __debug.start('split');
    const split = runSplitBacktest(adjusted, signals, backtestOptions, 0.7);
    renderMetricsInto('trainMetrics', split.train);
    renderMetricsInto('testMetrics', split.test);
    document.getElementById('splitSection').style.display = 'block';
    __debug.end('split');
  } else {
    document.getElementById('splitSection').style.display = 'none';
  }

  const lastBar = adjusted[adjusted.length - 1];
  const rawLastBar = realData[realData.length - 1];
  const buys  = signals.filter(s => s.type === 'buy').length;
  const sells = signals.filter(s => s.type === 'sell').length;

  const showRawPrice = Math.abs(lastBar.close - rawLastBar.close) > 0.01;

  // ---------- Обзор «для новичка» ----------
  const priceStr = rawLastBar.close.toFixed(2);
  const minPurchase = rawLastBar.close * payload.lotSize;
  const minPurchaseStr = minPurchase.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  const periodStart = adjusted[0].time;
  const periodEnd = adjusted[adjusted.length - 1].time;
  const strategyDesc = STRATEGY_DESCRIPTIONS[strategyId] || '';
  const lotWord = payload.lotSize === 1 ? 'акция'
              : (payload.lotSize >= 2 && payload.lotSize <= 4 ? 'акции' : 'акций');

  document.getElementById('stats').innerHTML = `
    <div class="overview-header">
      <div class="ov-line ov-title">📊 <b>${ticker}</b> · ${payload.name}</div>
      <div class="ov-line">Последняя цена: <b>${priceStr} ₽</b>${showRawPrice ? ' <span class="badge-adjusted" title="На графике цена приведена к текущему масштабу">скорр.</span>' : ''}</div>
      <div class="ov-line">📦 Лот: <b>${payload.lotSize} ${lotWord}</b> · минимальная покупка — <b>${minPurchaseStr} ₽</b></div>
      <div class="ov-line">🎯 Стратегия: <b>${strategy.label}</b></div>
      ${strategyDesc ? `<div class="ov-hint">ℹ️ ${strategyDesc}</div>` : ''}
      <div class="ov-line">📅 Данных: <b>${adjusted.length}</b> торговых дней (с ${periodStart} по ${periodEnd})</div>
      <div class="ov-line">🔔 Сигналов за всё время: <b>${signals.length}</b> (<span class="ov-buy">${buys} BUY</span> / <span class="ov-sell">${sells} SELL</span>)</div>
    </div>
  `;

  __debug.start('corpRender');
  renderCorpSection(payload, result, splitEvents, gapDates, useSplits, useDividends);
  __debug.end('corpRender');

  __debug.start('analysis');
  renderAnalysis(adjusted);
  renderFundamentalSection(payload);
  renderRiskSection(adjusted, {
    capital: isNaN(capital) ? 100000 : capital,
    riskPct: isNaN(riskPct) ? 1 : riskPct,
    lotSize: payload.lotSize,
    atrPeriod: 14,
    atrMultiplier: 2,
    rawPrice: rawLastBar.close,
  });
  __debug.end('analysis');

  // Макро
  __debug.start('macro');
  try {
    const macroData = await loadMacroData();
    renderMacroSection(macroData);
  } catch (err) {
    console.warn('[macro] не удалось отрисовать:', err);
    document.getElementById('macroSection').style.display = 'none';
  }
  __debug.end('macro');

  // Корреляция
  __debug.start('correlation');
  await renderCorrelation();
  __debug.end('correlation');

  __debug.start('finalize');
  currentState = {
    ticker,
    price: rawLastBar.close,
    lotSize: payload.lotSize,
    strategyId,
    params,
  };
  updateAddButton();

  if (chartEl.clientWidth > 0) chart.timeScale().fitContent();
  __debug.end('finalize');

  __debug.end('total');
  __debug.show();
}

// ============================================================
// 12. КНОПКИ
// ============================================================

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

// ============================================================
// 13. ИНИЦИАЛИЗАЦИЯ
// ============================================================

document.getElementById('reload').addEventListener('click', render);
document.getElementById('ticker').addEventListener('change', () => {
  updateTickerLabel();
  render();
});
document.getElementById('strategy').addEventListener('change', () => {
  renderStrategyParams();
  document.getElementById('optimizerSection').style.display = 'none';
  render();
});
document.getElementById('useSplit').addEventListener('change', render);
document.getElementById('useCorpSplits').addEventListener('change', render);
document.getElementById('useCorpDividends').addEventListener('change', render);
document.getElementById('riskPct').addEventListener('change', render);

// Запоминаем тикер из URL — понадобится после populateSelectOptions()
let _pendingTickerFromUrl = null;

(function initFromUrl() {
  const p = new URLSearchParams(window.location.search);
  const t = p.get('ticker');
  if (!t) return;
  _pendingTickerFromUrl = t;
  const select = document.getElementById('ticker');
  const exists = Array.from(select.options).some(o => o.value === t);
  if (exists) select.value = t;
})();

renderStrategyParams();
updateNotesBadge();
resizeCharts();
updateTickerLabel();
render();

// ============================================================
// 14. СОХРАНЕНИЕ СОСТОЯНИЯ СВОРАЧИВАЕМЫХ СЕКЦИЙ (таб «Анализ»)
// ============================================================
// Пользователь тапнул «Фундаментал» → раскрылось. Ушёл на другой таб,
// вернулся — секция всё ещё раскрыта. Сохраняем в localStorage.
// Плюс: если секция содержит график (макро) — дорисовываем его
// при раскрытии, потому что в свёрнутом виде контейнер имеет width=0.

(function initCollapsiblePersistence() {
  const STORAGE_KEY = 'trading-signals-collapsible';
  const collapsibles = document.querySelectorAll('details.collapsible[id]');
  if (collapsibles.length === 0) return;

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (e) {
    saved = {};
  }

  collapsibles.forEach(el => {
    const key = el.id;

    // Восстанавливаем сохранённое состояние
    if (typeof saved[key] === 'boolean') {
      el.open = saved[key];
    }

    // Слушаем изменения
    el.addEventListener('toggle', () => {
      saved[key] = el.open;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      } catch (e) { /* приватный режим — игнорируем */ }

      // Если раскрылась макро-секция — дорисовываем график.
      // В свёрнутом виде у контейнера width=0, и Lightweight Charts
      // не может создать canvas. Поэтому создаём график только сейчас.
      if (el.open && el.id === 'macroSection') {
        requestAnimationFrame(() => {
          if (typeof ensureMacroChart !== 'function') return;
          ensureMacroChart();
          if (macroChart && macroSeries && pendingMacroData) {
            macroSeries.setData(pendingMacroData);
            const mEl = document.getElementById('macroChart');
            if (mEl && mEl.clientWidth > 0) {
              macroChart.applyOptions({ width: mEl.clientWidth });
            }
            macroChart.timeScale().fitContent();
          }
        });
      }
    });
  });
})();

// ============================================================
// 15. ШТОРКА ВЫБОРА БУМАГ (Шаг 21, Итерация 3)
// ============================================================
// Загружает data/tickers.json (475 акций), показывает шторку снизу
// с поиском, «Недавними» и группами по отраслям. При выборе бумаги
// обновляет скрытый <select id="ticker"> и вызывает render().

const TICKERS_INDEX_URL = './data/tickers.json';
const RECENT_KEY = 'trading-signals-recent-tickers';
const DRAWER_SECTIONS_KEY = 'trading-signals-drawer-sections';
const RECENT_MAX = 8;

let tickersIndex = null;               // { updatedAt, board, count, tickers: [...] }
const tickerByCode = new Map();        // ticker -> { ticker, name, sector, lotSize }
const sectionsBySector = new Map();    // sector -> [{ ticker, name, lotSize }]
let recentTickers = [];                // ["SBER", "GAZP", ...]

// Порядок отраслей в шторке: сверху — самые популярные.
const SECTOR_ORDER = [
  'Нефть и газ',
  'Финансы',
  'Металлургия',
  'Ритейл',
  'IT',
  'Энергетика',
  'Телеком',
  'Химия',
  'Транспорт',
  'Прочее',
];

// ---------- Загрузка индекса ----------

async function loadTickersIndex() {
  if (tickersIndex) return tickersIndex;
  const resp = await fetch(TICKERS_INDEX_URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data.tickers)) throw new Error('Нет поля tickers');

  tickersIndex = data;
  tickerByCode.clear();
  sectionsBySector.clear();

  for (const t of data.tickers) {
    tickerByCode.set(t.ticker, t);
    if (!sectionsBySector.has(t.sector)) sectionsBySector.set(t.sector, []);
    sectionsBySector.get(t.sector).push(t);
  }

  // Сортируем бумаги внутри каждой секции по алфавиту тикера
  for (const list of sectionsBySector.values()) {
    list.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }

  return tickersIndex;
}

function populateSelectOptions() {
  const select = document.getElementById('ticker');
  if (!select || !tickersIndex) return;

  const current = select.value;
  select.innerHTML = '';
  for (const t of tickersIndex.tickers) {
    const opt = document.createElement('option');
    opt.value = t.ticker;
    opt.textContent = t.ticker;
    select.appendChild(opt);
  }

  // Приоритет: URL-параметр → текущее значение → первая бумага
  if (_pendingTickerFromUrl && tickerByCode.has(_pendingTickerFromUrl)) {
    select.value = _pendingTickerFromUrl;
    _pendingTickerFromUrl = null;
  } else if (current && tickerByCode.has(current)) {
    select.value = current;
  } else if (tickersIndex.tickers.length > 0) {
    select.value = tickersIndex.tickers[0].ticker;
  }
}

function updateTickerLabel() {
  const el = document.getElementById('currentTickerLabel');
  const select = document.getElementById('ticker');
  if (el && select) el.textContent = select.value || 'SBER';
}

// ---------- Недавние ----------

function loadRecentTickers() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(t => typeof t === 'string') : [];
  } catch (e) {
    return [];
  }
}

function saveRecentTickers() {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentTickers));
  } catch (e) { /* приватный режим */ }
}

function addToRecent(ticker) {
  recentTickers = [ticker, ...recentTickers.filter(t => t !== ticker)].slice(0, RECENT_MAX);
  saveRecentTickers();
}

// ---------- HTML-эскейпинг ----------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const safeText = escapeHtml(text);
  const safeQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${safeQuery})`, 'gi');
  return safeText.replace(re, '<mark>$1</mark>');
}

function tickerRowHtml(t, query) {
  const select = document.getElementById('ticker');
  const isActive = select && select.value === t.ticker;
  return `
    <div class="ticker-row${isActive ? ' active' : ''}" data-ticker="${escapeHtml(t.ticker)}">
      <div class="ticker-row-ticker">${highlight(t.ticker, query)}</div>
      <div class="ticker-row-name">${highlight(t.name || '', query)}</div>
      <div class="ticker-row-lot">${t.lotSize} акц.</div>
    </div>
  `;
}

// ---------- Рендер шторки ----------

function renderTickerDrawer(query = '') {
  const body = document.getElementById('tickerDrawerBody');
  if (!body) return;

  if (!tickersIndex) {
    body.innerHTML = '<div class="ticker-drawer-loading">Загрузка списка бумаг…</div>';
    return;
  }

  const q = query.trim().toLowerCase();

  // --- Режим поиска ---
  if (q) {
    const matches = tickersIndex.tickers.filter(t =>
      t.ticker.toLowerCase().includes(q) ||
      (t.name && t.name.toLowerCase().includes(q))
    );

    if (matches.length === 0) {
      body.innerHTML = `<div class="ticker-empty">Ничего не найдено по запросу «${escapeHtml(query)}»</div>`;
      return;
    }

    const rows = matches.slice(0, 100).map(t => tickerRowHtml(t, query)).join('');
    body.innerHTML = `
      <div class="ticker-recent-title">Найдено: ${matches.length}${matches.length > 100 ? ' (показаны первые 100)' : ''}</div>
      ${rows}
    `;
    bindTickerDrawerEvents(body);
    return;
  }

  // --- Обычный режим: недавние + секции ---
  const parts = [];

  // Недавние
  const recentValid = recentTickers.filter(t => tickerByCode.has(t));
  if (recentValid.length > 0) {
    parts.push('<div class="ticker-recent-title">Недавние</div>');
    for (const tick of recentValid) {
      parts.push(tickerRowHtml(tickerByCode.get(tick), ''));
    }
  }

  // Секции по отраслям
  const savedSections = loadDrawerSections();
  const sectors = SECTOR_ORDER.filter(s => sectionsBySector.has(s));
  for (const s of sectionsBySector.keys()) {
    if (!sectors.includes(s)) sectors.push(s);
  }

  for (const sector of sectors) {
    const list = sectionsBySector.get(sector) || [];
    if (list.length === 0) continue;
    const isOpen = savedSections[sector] === true;
    const rows = list.map(t => tickerRowHtml(t, '')).join('');
    parts.push(`
      <div class="ticker-section${isOpen ? ' open' : ''}" data-sector="${escapeHtml(sector)}">
        <button class="ticker-section-header" type="button">
          <span class="ticker-section-arrow">▸</span>
          <span>${escapeHtml(sector)}</span>
          <span class="ticker-section-count">${list.length}</span>
        </button>
        <div class="ticker-section-body">${rows}</div>
      </div>
    `);
  }

  body.innerHTML = parts.join('');
  bindTickerDrawerEvents(body);
}

function bindTickerDrawerEvents(body) {
  body.querySelectorAll('.ticker-row').forEach(row => {
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      selectTicker(row.dataset.ticker);
    });
  });

  body.querySelectorAll('.ticker-section-header').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const section = btn.closest('.ticker-section');
      if (!section) return;
      section.classList.toggle('open');
      const saved = loadDrawerSections();
      saved[section.dataset.sector] = section.classList.contains('open');
      saveDrawerSections(saved);
    });
  });
}

// ---------- Сохранение открытых секций ----------

function loadDrawerSections() {
  try {
    const raw = localStorage.getItem(DRAWER_SECTIONS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) {
    return {};
  }
}

function saveDrawerSections(obj) {
  try {
    localStorage.setItem(DRAWER_SECTIONS_KEY, JSON.stringify(obj));
  } catch (e) { /* приватный режим */ }
}

// ---------- Открытие / закрытие ----------

async function openTickerDrawer() {
  const drawer = document.getElementById('tickerDrawer');
  const body = document.getElementById('tickerDrawerBody');
  if (!drawer) return;

  drawer.classList.add('show');

  // Ленивая загрузка индекса при первом открытии
  if (!tickersIndex) {
    if (body) body.innerHTML = '<div class="ticker-drawer-loading">Загрузка списка бумаг…</div>';
    try {
      await loadTickersIndex();
      populateSelectOptions();
      updateTickerLabel();
    } catch (err) {
      console.error('[drawer] не удалось загрузить tickers.json:', err);
      if (body) {
        body.innerHTML = `<div class="ticker-empty">Не удалось загрузить список бумаг.<br>${escapeHtml(err.message)}</div>`;
      }
      return;
    }
  }

  const search = document.getElementById('tickerSearch');
  if (search) search.value = '';
  renderTickerDrawer('');
}

function closeTickerDrawer() {
  const drawer = document.getElementById('tickerDrawer');
  if (drawer) drawer.classList.remove('show');
}

// ---------- Выбор тикера ----------

function selectTicker(ticker) {
  if (!ticker) return;
  const select = document.getElementById('ticker');
  if (!select) return;

  if (!tickerByCode.has(ticker)) {
    console.warn('[drawer] неизвестный тикер:', ticker);
    return;
  }

  select.value = ticker;
  updateTickerLabel();
  addToRecent(ticker);
  closeTickerDrawer();
  render();
}

// ---------- Обработчики ----------

(function initTickerDrawer() {
  const drawer = document.getElementById('tickerDrawer');
  const openBtn = document.getElementById('openTickerDrawer');
  const closeBtn = document.getElementById('closeTickerDrawer');
  const searchInput = document.getElementById('tickerSearch');
  if (!drawer || !openBtn) return;

  recentTickers = loadRecentTickers();

  openBtn.addEventListener('click', () => {
    openTickerDrawer();
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeTickerDrawer());
  }

  // Клик по затемнению (не по самой шторке) — закрыть
  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) closeTickerDrawer();
  });

  // Escape — закрыть
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('show')) {
      closeTickerDrawer();
    }
  });

  // Поиск
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderTickerDrawer(e.target.value);
    });
  }
})();

// ============================================================
// 16. УПРАВЛЕНИЕ НАБОРОМ КОРРЕЛЯЦИИ (Шаг 21, Итерация 5)
// ============================================================
// Пользователь может выбрать, по каким бумагам считать матрицу:
//   — Дефолт: 10 популярных бумаг из разных секторов
//   — Из Избранного: все тикеры из Watchlist (до 12)
//   — Вручную: шторка с чекбоксами, отметить до 12
// Набор хранится в localStorage, при смене — пересчитываем матрицу.

const CORRELATION_DEFAULT = [
  'SBER', 'GAZP', 'LKOH', 'GMKN', 'ROSN',
  'NVTK', 'MGNT', 'VTBR', 'AFLT', 'NLMK',
];
const CORRELATION_MAX = 12;
const CORRELATION_MIN = 2;
const CORRELATION_STORAGE_KEY = 'trading-signals-correlation-set';
const CORRELATION_SOURCE_KEY = 'trading-signals-correlation-source';

// ---------- Чтение / запись набора ----------

function getCorrelationSet() {
  try {
    const raw = localStorage.getItem(CORRELATION_STORAGE_KEY);
    if (!raw) return [...CORRELATION_DEFAULT];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length < CORRELATION_MIN) {
      return [...CORRELATION_DEFAULT];
    }
    // Чистим мусор и режем до максимума
    const clean = arr
      .filter(t => typeof t === 'string' && t.length > 0)
      .slice(0, CORRELATION_MAX);
    return clean.length >= CORRELATION_MIN ? clean : [...CORRELATION_DEFAULT];
  } catch (e) {
    return [...CORRELATION_DEFAULT];
  }
}

function getCorrelationSource() {
  try {
    return localStorage.getItem(CORRELATION_SOURCE_KEY) || 'default';
  } catch (e) {
    return 'default';
  }
}

function saveCorrelationSet(tickers, source) {
  try {
    localStorage.setItem(CORRELATION_STORAGE_KEY, JSON.stringify(tickers));
    localStorage.setItem(CORRELATION_SOURCE_KEY, source || 'custom');
  } catch (e) { /* приватный режим */ }
  // Сбрасываем кэш данных и пересчитываем
  correlationCache = null;
  renderCorrelation();
  updateCorrelationSourceHint(source);
}

function resetCorrelationSet() {
  try {
    localStorage.removeItem(CORRELATION_STORAGE_KEY);
    localStorage.removeItem(CORRELATION_SOURCE_KEY);
  } catch (e) { /* приватный режим */ }
  correlationCache = null;
  renderCorrelation();
  updateCorrelationSourceHint('default');
  showToast('Набор сброшен к 10 популярным бумагам');
}

// ---------- Подсказка над матрицей ----------

function updateCorrelationSourceHint(source) {
  const el = document.getElementById('correlationSourceHint');
  if (!el) return;

  const src = source || getCorrelationSource();
  const count = getCorrelationSet().length;

  let text = '';
  if (src === 'watchlist') {
    text = `⭐ Из Избранного · ${count} бумаг`;
  } else if (src === 'custom') {
    text = `✏️ Свой выбор · ${count} бумаг`;
  } else {
    text = `По умолчанию · ${count} популярных бумаг`;
  }
  el.textContent = text;
}

// ---------- Действие: «Из Избранного» ----------

function correlationUseWatchlist() {
  const list = loadWatchlist();
  if (!list || list.length === 0) {
    showToast('В Избранном пока пусто. Добавь бумаги на вкладке «Портфель»');
    return;
  }

  let tickers = list.map(e => e.ticker).filter(Boolean);

  // Ограничиваем по лимиту
  if (tickers.length > CORRELATION_MAX) {
    tickers = tickers.slice(0, CORRELATION_MAX);
    showToast(`Взяли первые ${CORRELATION_MAX} из ${list.length} бумаг`);
  }

  if (tickers.length < CORRELATION_MIN) {
    showToast(`Нужно минимум ${CORRELATION_MIN} бумаги в Избранном`);
    return;
  }

  saveCorrelationSet(tickers, 'watchlist');
  showToast(`Корреляция из Избранного: ${tickers.length} бумаг`);
}

// ---------- Шторка с чекбоксами ----------

// Временный выбор в шторке (не сохраняется до «Готово»)
let _corrDraftSet = new Set();
let _corrDrawerQuery = '';

async function openCorrelationDrawer() {
  const drawer = document.getElementById('correlationDrawer');
  const body = document.getElementById('correlationDrawerBody');
  if (!drawer) return;

  // Стартовый черновик — текущий набор
  _corrDraftSet = new Set(getCorrelationSet());
  _corrDrawerQuery = '';

  drawer.classList.add('show');

  // Загружаем индекс (если ещё не загружен)
  if (!tickersIndex) {
    if (body) body.innerHTML = '<div class="ticker-drawer-loading">Загрузка списка бумаг…</div>';
    try {
      await loadTickersIndex();
    } catch (err) {
      console.error('[corr-drawer] не удалось загрузить tickers.json:', err);
      if (body) {
        body.innerHTML = `<div class="ticker-empty">Не удалось загрузить список бумаг.<br>${escapeHtml(err.message)}</div>`;
      }
      return;
    }
  }

  const search = document.getElementById('correlationSearch');
  if (search) search.value = '';

  renderCorrelationDrawer('');
  updateCorrelationDrawerFooter();
}

function closeCorrelationDrawer() {
  const drawer = document.getElementById('correlationDrawer');
  if (drawer) drawer.classList.remove('show');
}

function updateCorrelationDrawerFooter() {
  const counterEl = document.getElementById('correlationCounter');
  if (counterEl) {
    counterEl.textContent = `Выбрано: ${_corrDraftSet.size} из ${CORRELATION_MAX}`;
  }
  const doneBtn = document.getElementById('correlationDone');
  if (doneBtn) {
    doneBtn.disabled = _corrDraftSet.size < CORRELATION_MIN;
    doneBtn.textContent = _corrDraftSet.size < CORRELATION_MIN
      ? `Нужно минимум ${CORRELATION_MIN}`
      : `Готово (${_corrDraftSet.size})`;
  }
}

function renderCorrelationDrawer(query = '') {
  const body = document.getElementById('correlationDrawerBody');
  if (!body) return;

  if (!tickersIndex) {
    body.innerHTML = '<div class="ticker-drawer-loading">Загрузка…</div>';
    return;
  }

  _corrDrawerQuery = query;

  const q = query.trim().toLowerCase();

  // --- Режим поиска ---
  if (q) {
    const matches = tickersIndex.tickers.filter(t =>
      t.ticker.toLowerCase().includes(q) ||
      (t.name && t.name.toLowerCase().includes(q))
    );

    if (matches.length === 0) {
      body.innerHTML = `<div class="ticker-empty">Ничего не найдено по запросу «${escapeHtml(query)}»</div>`;
      return;
    }

    const rows = matches.slice(0, 100).map(t => corrCheckboxRowHtml(t, query)).join('');
    body.innerHTML = `
      <div class="ticker-recent-title">Найдено: ${matches.length}${matches.length > 100 ? ' (показаны первые 100)' : ''}</div>
      ${rows}
    `;
    bindCorrelationDrawerEvents(body);
    return;
  }

  // --- Обычный режим: секции ---
  const parts = [];

  const savedSections = loadDrawerSections();
  const sectors = SECTOR_ORDER.filter(s => sectionsBySector.has(s));
  for (const s of sectionsBySector.keys()) {
    if (!sectors.includes(s)) sectors.push(s);
  }

  for (const sector of sectors) {
    const list = sectionsBySector.get(sector) || [];
    if (list.length === 0) continue;
    const isOpen = savedSections['corr_' + sector] === true;
    const rows = list.map(t => corrCheckboxRowHtml(t, '')).join('');
    parts.push(`
      <div class="ticker-section${isOpen ? ' open' : ''}" data-sector="${escapeHtml(sector)}">
        <button class="ticker-section-header" type="button">
          <span class="ticker-section-arrow">▸</span>
          <span>${escapeHtml(sector)}</span>
          <span class="ticker-section-count">${list.length}</span>
        </button>
        <div class="ticker-section-body">${rows}</div>
      </div>
    `);
  }

  body.innerHTML = parts.join('');
  bindCorrelationDrawerEvents(body);
}

function corrCheckboxRowHtml(t, query) {
  const checked = _corrDraftSet.has(t.ticker);
  return `
    <label class="corr-check-row${checked ? ' active' : ''}" data-ticker="${escapeHtml(t.ticker)}">
      <input type="checkbox" class="corr-checkbox" ${checked ? 'checked' : ''} />
      <div class="corr-check-ticker">${highlight(t.ticker, query)}</div>
      <div class="corr-check-name">${highlight(t.name || '', query)}</div>
      <div class="corr-check-lot">${t.lotSize} акц.</div>
    </label>
  `;
}

function bindCorrelationDrawerEvents(body) {
  body.querySelectorAll('.corr-check-row').forEach(row => {
    const cb = row.querySelector('.corr-checkbox');
    if (!cb) return;

    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const ticker = row.dataset.ticker;

      if (cb.checked) {
        // Проверяем лимит
        if (_corrDraftSet.size >= CORRELATION_MAX) {
          cb.checked = false;
          showToast(`Максимум ${CORRELATION_MAX} бумаг`);
          return;
        }
        _corrDraftSet.add(ticker);
        row.classList.add('active');
      } else {
        _corrDraftSet.delete(ticker);
        row.classList.remove('active');
      }

      updateCorrelationDrawerFooter();
    });

    // Клик по строке — тоже переключает (кроме самого чекбокса)
    row.addEventListener('click', (e) => {
      if (e.target === cb) return; // уже обработано выше
      e.preventDefault();
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles: false }));
    });
  });

  body.querySelectorAll('.ticker-section-header').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const section = btn.closest('.ticker-section');
      if (!section) return;
      section.classList.toggle('open');
      const saved = loadDrawerSections();
      saved['corr_' + section.dataset.sector] = section.classList.contains('open');
      saveDrawerSections(saved);
    });
  });
}

function applyCorrelationDrawer() {
  if (_corrDraftSet.size < CORRELATION_MIN) {
    showToast(`Нужно минимум ${CORRELATION_MIN} бумаги`);
    return;
  }
  const tickers = Array.from(_corrDraftSet);
  saveCorrelationSet(tickers, 'custom');
  closeCorrelationDrawer();
  showToast(`Корреляция: ${tickers.length} бумаг`);
}

// ---------- Инициализация ----------

(function initCorrelationControls() {
  const btnWatchlist = document.getElementById('corrFromWatchlist');
  const btnPick = document.getElementById('corrPick');
  const btnReset = document.getElementById('corrReset');

  if (btnWatchlist) {
    btnWatchlist.addEventListener('click', correlationUseWatchlist);
  }
  if (btnPick) {
    btnPick.addEventListener('click', openCorrelationDrawer);
  }
  if (btnReset) {
    btnReset.addEventListener('click', resetCorrelationSet);
  }

  // Шторка
  const drawer = document.getElementById('correlationDrawer');
  const closeBtn = document.getElementById('closeCorrelationDrawer');
  const searchInput = document.getElementById('correlationSearch');
  const doneBtn = document.getElementById('correlationDone');

  if (drawer && closeBtn) {
    closeBtn.addEventListener('click', () => closeCorrelationDrawer());
  }
  if (drawer) {
    drawer.addEventListener('click', (e) => {
      if (e.target === drawer) closeCorrelationDrawer();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('show')) {
        closeCorrelationDrawer();
      }
    });
  }
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderCorrelationDrawer(e.target.value);
    });
  }
  if (doneBtn) {
    doneBtn.addEventListener('click', applyCorrelationDrawer);
  }

  // Подсказка над матрицей — при первой загрузке
  updateCorrelationSourceHint();
})();
