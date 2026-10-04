// js/correlation.js
// ============================================================
// Корреляция между бумагами.
// ============================================================
// Корреляция — число от −1 до +1, показывающее, насколько синхронно
// двигаются две акции. +1 — всегда вместе, 0 — связи нет, −1 — наоборот.
// Считаем по дневным доходностям, а не по ценам: у цен есть общий тренд,
// из-за которого все акции покажутся связанными.
//
// Список тикеров для матрицы теперь НЕ хардкодится. Он передаётся
// в computeCorrelations() третьим аргументом — приходит из app.js
// (дефолт / «Избранное» / ручной выбор пользователя).

// Красивые короткие имена. Если тикера нет в словаре — берём payload.name.
const CORRELATION_NAMES = {
  SBER: 'Сбер',
  GAZP: 'Газпром',
  LKOH: 'Лукойл',
  GMKN: 'Норникель',
  ROSN: 'Роснефть',
  NVTK: 'НОВАТЭК',
  MGNT: 'Магнит',
  VTBR: 'ВТБ',
  AFLT: 'Аэрофлот',
  NLMK: 'НЛМК',
};

// ===== Дневные доходности =====
// Считаем не по ценам, а по доходностям: (close[i] − close[i−1]) / close[i−1].
// Если считать корреляцию по ценам — все акции покажутся связанными,
// потому что у них общий тренд. Доходности этот тренд убирают.
function computeDailyReturns(candles) {
  const out = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    if (prev > 0 && isFinite(curr)) {
      out.push({ time: candles[i].time, ret: (curr - prev) / prev });
    }
  }
  return out;
}

// ===== Выравнивание по общим датам =====
// У разных бумаг могут быть разные торговые дни (приостановки, разные дни
// дивидендных отсечек). Чтобы корреляция считалась честно, оставляем только
// те даты, что есть у ВСЕХ бумаг одновременно.
function alignReturns(returnsByTicker, tickers) {
  let commonDates = null;
  for (const t of tickers) {
    const dates = new Set(returnsByTicker[t].map(x => x.time));
    if (commonDates === null) {
      commonDates = dates;
    } else {
      commonDates = new Set([...commonDates].filter(d => dates.has(d)));
    }
  }

  if (!commonDates || commonDates.size === 0) return [];

  const sortedDates = [...commonDates].sort();

  const maps = {};
  for (const t of tickers) {
    maps[t] = new Map(returnsByTicker[t].map(x => [x.time, x.ret]));
  }

  return sortedDates.map(time => ({
    time,
    rets: tickers.map(t => maps[t].get(time)),
  }));
}

// ===== Коэффициент корреляции Пирсона =====
// Формула: r = Σ((x − x̄)(y − ȳ)) / √(Σ(x − x̄)² × Σ(y − ȳ)²)
// Всегда в диапазоне [−1, +1].
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;

  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;

  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }

  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return null;
  return num / denom;
}

// ===== Матрица корреляции =====
// Симметричная матрица N×N. По диагонали — 1.00 (бумага сама с собой).
function computeCorrelationMatrix(aligned, tickers) {
  const n = tickers.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(null));

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      // Берём только строки, где ОБЕ доходности не null
      const pairs = aligned.filter(a =>
        a.rets[i] != null && a.rets[j] != null &&
        isFinite(a.rets[i]) && isFinite(a.rets[j])
      );
      const xs = pairs.map(a => a.rets[i]);
      const ys = pairs.map(a => a.rets[j]);
      const r = pearson(xs, ys);
      matrix[i][j] = r;
      matrix[j][i] = r;
    }
  }
  return matrix;
}

// ===== Топ пар =====
// Разбиваем все пары на «самые связанные» и «самые независимые».
function findTopPairs(matrix, tickers) {
  const pairs = [];
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const r = matrix[i][j];
      if (r != null) {
        pairs.push({ a: tickers[i], b: tickers[j], r });
      }
    }
  }
  pairs.sort((x, y) => y.r - x.r);
  return {
    most: pairs.slice(0, 3),
    least: pairs.slice(-3).reverse(),
  };
}

// ===== Классификация значения =====
// Пороги для цветовой заливки и текстовой подписи.
function correlationClass(v) {
  if (v == null) return 'na';
  if (v >= 0.7) return 'very-high';
  if (v >= 0.5) return 'high';
  if (v >= 0.3) return 'mid';
  if (v >= 0)   return 'low';
  if (v >= -0.3) return 'negative-low';
  return 'negative-high';
}

function correlationLabel(v) {
  if (v == null) return '—';
  if (v >= 0.7) return 'очень сильная';
  if (v >= 0.5) return 'сильная';
  if (v >= 0.3) return 'средняя';
  if (v >= 0)   return 'слабая';
  if (v >= -0.3) return 'слабая обратная';
  return 'обратная';
}

// ===== Сборка всего расчёта =====
// payloads: { SBER: payload, GAZP: payload, ... } — уже загруженные данные.
// options:  { useSplits, useDividends } — как корректировать историю.
// tickers:  массив тикеров, по которым строим матрицу (2..12 штук).
//           Если не передан — берём все ключи payloads.
function computeCorrelations(payloads, options, tickers) {
  // Если список не передан — берём всё, что есть в payloads
  if (!Array.isArray(tickers)) {
    tickers = Object.keys(payloads);
  }

  // Отфильтровываем те, для которых нет payloads (не загрузились)
  tickers = tickers.filter(t => payloads[t]);

  if (tickers.length < 2) {
    return null;
  }

  const returnsByTicker = {};
  for (const t of tickers) {
    const payload = payloads[t];
    // Применяем те же корректировки, что и для графика — иначе дивидендные
    // гэпы и сплиты испортят корреляцию.
    let data = payload.candles;
    try {
      const res = applyCorporateActions(payload.candles, payload, {
        useSplits: !!options.useSplits,
        useDividends: !!options.useDividends,
      });
      data = res.adjusted;
    } catch (err) {
      console.warn(`[correlation] не удалось применить корректировки ${t}:`, err.message);
    }
    returnsByTicker[t] = computeDailyReturns(data);
  }

  const aligned = alignReturns(returnsByTicker, tickers);
  if (aligned.length < 30) {
    // Слишком мало общих дней — статистика ненадёжна.
    return null;
  }

  const matrix = computeCorrelationMatrix(aligned, tickers);
  const { most, least } = findTopPairs(matrix, tickers);

  // Красивые имена: из словаря, иначе — name из payload
  const names = {};
  for (const t of tickers) {
    names[t] = CORRELATION_NAMES[t] || (payloads[t].name || t);
  }

  return {
    tickers,
    matrix,
    names,
    most,
    least,
    sampleSize: aligned.length,
    periodStart: aligned[0].time,
    periodEnd: aligned[aligned.length - 1].time,
  };
}

// ===== Рендер =====
function renderCorrelationSection(result) {
  const section = document.getElementById('correlationSection');
  if (!section) return;

  if (!result) {
    section.style.display = 'none';
    return;
  }

  // Подзаголовок: количество бумаг, период, дни
  const subtitleEl = document.getElementById('correlationSubtitle');
  if (subtitleEl) {
    subtitleEl.textContent =
      `${result.tickers.length} бумаг · ` +
      `${result.periodStart} → ${result.periodEnd} · ` +
      `${result.sampleSize} общих дней`;
  }

  // Матрица
  const matrixEl = document.getElementById('correlationMatrix');
  if (matrixEl) {
    matrixEl.innerHTML = renderMatrixHtml(result);
  }

  // Топ пары
  const pairsEl = document.getElementById('correlationPairs');
  if (pairsEl) {
    pairsEl.innerHTML = renderPairsHtml(result);
  }

  section.style.display = 'block';
}

function renderMatrixHtml(result) {
  const { tickers, matrix, names } = result;

  const header =
    '<tr><th></th>' +
    tickers.map(t => `<th title="${names[t] || t}">${t}</th>`).join('') +
    '</tr>';

  const body = tickers.map((rowTicker, i) => {
    const cells = tickers.map((colTicker, j) => {
      const v = matrix[i][j];
      if (v == null) {
        return `<td class="corr-cell corr-na">—</td>`;
      }
      const cls = correlationClass(v);
      const txt = v.toFixed(2);
      const label = correlationLabel(v);
      return `<td class="corr-cell corr-${cls}" title="${rowTicker} ↔ ${colTicker}: ${label}">${txt}</td>`;
    }).join('');
    return `<tr><th title="${names[rowTicker] || rowTicker}">${rowTicker}</th>${cells}</tr>`;
  }).join('');

  return `<table class="corr-table"><thead>${header}</thead><tbody>${body}</tbody></table>`;
}

function renderPairsHtml(result) {
  const fmt = (p) => `
    <div class="corr-pair">
      <span class="corr-pair-names">${p.a} ↔ ${p.b}</span>
      <span class="corr-pair-value corr-${correlationClass(p.r)}">${p.r.toFixed(2)}</span>
      <span class="corr-pair-label">${correlationLabel(p.r)}</span>
    </div>
  `;

  return `
    <div class="corr-pairs-block">
      <h4 class="corr-pairs-title">🔴 Самые связанные</h4>
      ${result.most.map(fmt).join('')}
      <p class="corr-pairs-hint">Плохо для диверсификации: если одна упадёт — вторая, скорее всего, тоже.</p>
    </div>
    <div class="corr-pairs-block">
      <h4 class="corr-pairs-title">🟢 Самые независимые</h4>
      ${result.least.map(fmt).join('')}
      <p class="corr-pairs-hint">Хорошо для диверсификации: падают и растут в разное время.</p>
    </div>
  `;
}
