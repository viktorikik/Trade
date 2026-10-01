// js/app.js

// ... (код создания графиков и загрузки данных остаётся без изменений) ...
// ... (функция metricCard остаётся) ...

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

  // Отображаем значения индикаторов
  const indEl = document.getElementById('indicatorValues');
  indEl.innerHTML = `
    <div class="indicator-value"><span>RSI(14):</span> <b>${indicators.rsi != null ? indicators.rsi.toFixed(1) : '—'}</b></div>
    <div class="indicator-value"><span>MACD:</span> <b>${indicators.macd.macdLine[indicators.macd.macdLine.length-1]?.toFixed(4) ?? '—'}</b></div>
    <div class="indicator-value"><span>Signal:</span> <b>${indicators.macd.signalLine[indicators.macd.signalLine.length-1]?.toFixed(4) ?? '—'}</b></div>
  `;

  // Список обоснований
  const reasonsEl = document.getElementById('reasons');
  reasonsEl.innerHTML = reasons.map(r => `<li>${r}</li>`).join('');
}

// В функции render() вызываем renderAnalysis(data) в конце
async function render() {
  // ... (загрузка данных и расчет индикаторов) ...

  const signals = findCrossovers(fast, slow);
  // ... (рендер графика и метрик) ...

  // НОВОЕ: комплексный анализ
  renderAnalysis(data);

  chart.timeScale().fitContent();
  equityChart.timeScale().fitContent();
}

// ... (остальной код без изменений) ...
