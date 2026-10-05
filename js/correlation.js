// js/correlation.js
// ============================================================
// Корреляция между бумагами.
// ============================================================
// Корреляция — число от −1 до +1, показывающее, насколько синхронно
// двигаются две акции. +1 — всегда вместе, 0 — связи нет, −1 — наоборот.
// Считаем по дневным доходностям, а не по ценам: у цен есть общий тренд,
// из-за которого все акции покажутся связанными.
//
// Список тикеров для матрицы НЕ хардкодится. Он передаётся
// в computeCorrelations() третьим аргументом — приходит из app.js
// (дефолт / «Избранное» / ручной выбор пользователя).
//
// Плюс: оценка диверсификации набора — функция scoreDiversification().
//
// Обновлено (Итерация 2):
//   — тепловая матрица (цветовая подложка через inline-стили);
//   — тап на тикер → шторка со списком всех бумаг из data/correlation.json,
//     отсортированных по возрастанию |r| («независимые» наверху);
//   — фильтр по секторам в шторке;
//   — кнопка «+ В набор» (пишет в localStorage и шлёт CustomEvent).

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

// ===== Оценка диверсификации (0..10) =====
//
// Composite-скор из трёх компонент с весами 50/30/20:
//
//  1. Эффективное число бумаг (вес 0.5).
//     N_eff = N / (1 + (N − 1) × avgCorr).
//     Если все корреляции 0 — N_eff = N. Если все 1 — N_eff = 1.
//     Компонента = N_eff / N (0..1).
//
//  2. Штраф за максимальную корреляцию (вес 0.3).
//     Если max(r) ≤ 0.7 — штрафа нет, компонента = 1.
//     Если max(r) = 1.0 — штраф 1.0, компонента = 0.
//     Линейно между 0.7 и 1.0.
//
//  3. Разнообразие секторов (вес 0.2).
//     Компонента = min(1, число уникальных секторов / 5).
//     5+ разных секторов → 1.0. Меньше — пропорционально.
//     Если sectorLookup не передан — компонента = 0.5 (нейтрально).
//
// Возвращает { insufficient } если бумаг меньше 5 — оценка ненадёжна.
function scoreDiversification(result, sectorLookup) {
  if (!result) return null;

  const { tickers, matrix } = result;
  const n = tickers.length;

  // Для 2–4 бумаг оценка малоинформативна: всего 1–6 пар.
  if (n < 5) {
    return { insufficient: true, count: n };
  }

  // ---- Все пары ----
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = matrix[i][j];
      if (r != null && isFinite(r)) {
        pairs.push({ i, j, r });
      }
    }
  }
  if (pairs.length === 0) return null;

  // ---- 1. Средняя корреляция и N_eff ----
  const avgCorr = pairs.reduce((s, p) => s + p.r, 0) / pairs.length;

  // Ограничим снизу: при отрицательной средней N_eff могло бы превысить N.
  const effectiveAvg = Math.max(0, avgCorr);
  const nEff = n / (1 + (n - 1) * effectiveAvg);
  const nEffScore = Math.max(0, Math.min(1, nEff / n));

  // ---- 2. Максимальная корреляция ----
  let maxPair = pairs[0];
  for (const p of pairs) {
    if (p.r > maxPair.r) maxPair = p;
  }
  // Штраф линейно от 0.7 (нет штрафа) до 1.0 (полный штраф).
  let maxPenalty = 0;
  if (maxPair.r > 0.7) {
    maxPenalty = Math.min(1, (maxPair.r - 0.7) / 0.3);
  }
  const maxScore = 1 - maxPenalty;

  // ---- 3. Разнообразие секторов ----
  let uniqueSectors = 0;
  let sectorCounts = {};
  let sectorScore = 0.5; // нейтральное значение, если sectorLookup не передан

  if (typeof sectorLookup === 'function') {
    const set = new Set();
    for (const t of tickers) {
      const s = sectorLookup(t) || 'Прочее';
      set.add(s);
      sectorCounts[s] = (sectorCounts[s] || 0) + 1;
    }
    uniqueSectors = set.size;
    // 5+ разных секторов = 1.0
    sectorScore = Math.min(1, uniqueSectors / 5);
  }

  // ---- Composite ----
  const composite = 0.5 * nEffScore + 0.3 * maxScore + 0.2 * sectorScore;
  // Округляем до 1..10 (минимум 1, чтобы 0 не выглядел «сломанным»)
  const score = Math.max(1, Math.min(10, Math.round(composite * 10)));

  // ---- Уровень ----
  let level, levelCls;
  if (score >= 8)      { level = 'Отлично'; levelCls = 'good'; }
  else if (score >= 6) { level = 'Хорошо';  levelCls = 'good'; }
  else if (score >= 4) { level = 'Средне';  levelCls = 'neutral'; }
  else if (score >= 2) { level = 'Слабо';   levelCls = 'bad'; }
  else                 { level = 'Плохо';   levelCls = 'bad'; }

  // ---- Рекомендации ----
  const warnings = [];

  // Если есть пара с очень высокой корреляцией
  if (maxPair.r >= 0.7) {
    const a = tickers[maxPair.i];
    const b = tickers[maxPair.j];
    warnings.push(
      `Сильная связь ${a} ↔ ${b} (${maxPair.r.toFixed(2)}). ` +
      `Одна из пары — кандидат на замену.`
    );
  }

  // Если в одном секторе ≥3 бумаг
  if (typeof sectorLookup === 'function') {
    const sorted = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      const [topSector, topCount] = sorted[0];
      if (topCount >= 3 && uniqueSectors < 5) {
        warnings.push(
          `В наборе ${topCount} бумаг из сектора «${topSector}». ` +
          `Попробуй заменить одну на бумагу из другого сектора.`
        );
      }
    }
  }

  return {
    insufficient: false,
    score,
    level,
    levelCls,
    avgCorr,
    nEff,
    nEffScore,
    maxPair: {
      a: tickers[maxPair.i],
      b: tickers[maxPair.j],
      r: maxPair.r,
    },
    uniqueSectors,
    warnings,
    paperCount: n,
  };
}

// ===== Тепловая карта: цвет по значению корреляции =====
// Возвращает { bg, fg } — фон и цвет текста для ячейки.
//   • сильный плюс (≈ +1)  → насыщенный красный (плохо для диверсификации)
//   • около нуля           → прозрачный (нейтрально)
//   • сильный минус (≈ −1) → насыщенный синий (обратная связь)
// Используем rgba, чтобы работало и на светлой, и на тёмной теме.
function heatColor(r) {
  if (r == null || !isFinite(r)) {
    return { bg: 'transparent', fg: 'inherit' };
  }
  const v = Math.max(-1, Math.min(1, r));
  // ±0.15 — «мёртвая зона», чтобы не рябило
  if (Math.abs(v) < 0.15) {
    return { bg: 'transparent', fg: 'inherit' };
  }
  if (v > 0) {
    const a = Math.min(1, (v - 0.15) / 0.85);     // 0..1
    const alpha = 0.12 + a * 0.68;                // 0.12..0.80
    return {
      bg: `rgba(220, 70, 70, ${alpha.toFixed(3)})`,
      fg: a > 0.55 ? '#fff' : 'inherit',
    };
  } else {
    const a = Math.min(1, (-v - 0.15) / 0.85);
    const alpha = 0.12 + a * 0.68;
    return {
      bg: `rgba(70, 130, 220, ${alpha.toFixed(3)})`,
      fg: a > 0.55 ? '#fff' : 'inherit',
    };
  }
}

// ===== Рендер секции =====
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
    // Делегирование клика вешаем один раз на контейнер
    if (!matrixEl.dataset.corrClickBound) {
      matrixEl.addEventListener('click', onMatrixClick);
      matrixEl.dataset.corrClickBound = '1';
    }
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
    tickers.map(t =>
      `<th data-ticker="${t}" class="corr-th-click" title="${names[t] || t}">${t}</th>`
    ).join('') +
    '</tr>';

  const body = tickers.map((rowTicker, i) => {
    const cells = tickers.map((colTicker, j) => {
      const v = matrix[i][j];
      const isDiag = i === j;

      if (v == null) {
        return `<td class="corr-cell corr-na" data-ticker-row="${rowTicker}" data-ticker-col="${colTicker}">—</td>`;
      }

      const c = heatColor(v);
      const txt = v.toFixed(2);
      const label = correlationLabel(v);
      const style = `background:${c.bg};color:${c.fg}`;
      const cls = isDiag ? 'corr-cell corr-diag' : 'corr-cell';
      return `<td class="${cls}" data-ticker-row="${rowTicker}" data-ticker-col="${colTicker}" style="${style}" title="${rowTicker} ↔ ${colTicker}: ${label}">${txt}</td>`;
    }).join('');
    return `<tr><th data-ticker="${rowTicker}" class="corr-th-click" title="${names[rowTicker] || rowTicker}">${rowTicker}</th>${cells}</tr>`;
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

// ============================================================
// ИТЕРАЦИЯ 2: шторка со списком всех бумаг + фильтр по секторам
// ============================================================

// ----- Состояние -----
let _corrMatrixCache = null;      // данные из data/correlation.json
let _corrMatrixPromise = null;    // дедупликация fetch
let _currentPanelTicker = null;   // выбранный тикер
let _currentSectorFilter = null;  // null или строка сектора
let _corrStylesInjected = false;

// ----- Загрузка data/correlation.json (лениво, один раз) -----
async function loadCorrelationMatrix() {
  if (_corrMatrixCache) return _corrMatrixCache;
  if (_corrMatrixPromise) return _corrMatrixPromise;

  _corrMatrixPromise = fetch('data/correlation.json', { cache: 'no-store' })
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(data => {
      if (!data || !Array.isArray(data.tickers) || !Array.isArray(data.matrix)) {
        throw new Error('Плохой формат correlation.json');
      }
      _corrMatrixCache = data;
      return data;
    })
    .catch(err => {
      console.warn('[correlation] не удалось загрузить correlation.json:', err);
      _corrMatrixPromise = null;
      return null;
    });

  return _corrMatrixPromise;
}

// ----- Позиция пары (i, j) в плоском верхнем треугольнике -----
// Матрица в correlation.json хранится как: (0,1), (0,2), ..., (0,n-1),
//                                            (1,2), (1,3), ..., (n-2,n-1)
function pairIndex(i, j, n) {
  if (i === j) return -1;
  let a = i, b = j;
  if (a > b) { const t = a; a = b; b = t; }
  // Сколько элементов в строках 0..a-1: a*(n-1) - a*(a-1)/2
  return a * (n - 1) - (a * (a - 1)) / 2 + (b - a - 1);
}

// ----- Корреляция пары (tickerA, tickerB) из correlation.json -----
function getPairR(data, tickerA, tickerB) {
  if (tickerA === tickerB) return 1;
  const n = data.tickers.length;
  const i = data.tickers.indexOf(tickerA);
  const j = data.tickers.indexOf(tickerB);
  if (i < 0 || j < 0) return null;
  const idx = pairIndex(i, j, n);
  if (idx < 0) return null;
  const v = data.matrix[idx];
  return (v == null || !isFinite(v)) ? null : v;
}

// ----- Стили шторки (вставляем один раз) -----
function injectPanelStyles() {
  if (_corrStylesInjected) return;
  _corrStylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .corr-th-click { cursor: pointer; }
    .corr-th-click:hover { color: #4a9eff; }

    .ticker-corr-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.55);
      z-index: 9998;
      opacity: 0; pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .ticker-corr-overlay.is-open { opacity: 1; pointer-events: auto; }

    .ticker-corr-sheet {
      position: fixed; left: 0; right: 0; bottom: 0;
      z-index: 9999;
      max-height: 82vh;
      background: var(--bg, #fff);
      color: var(--fg, #111);
      border-top-left-radius: 16px;
      border-top-right-radius: 16px;
      box-shadow: 0 -6px 24px rgba(0,0,0,0.25);
      transform: translateY(105%);
      transition: transform 0.25s ease;
      display: flex; flex-direction: column;
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    .ticker-corr-sheet.is-open { transform: translateY(0); }

    .ticker-corr-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px;
      padding: 14px 16px 10px 16px;
      border-bottom: 1px solid rgba(128,128,128,0.18);
    }
    .ticker-corr-title { font-weight: 600; font-size: 16px; }
    .ticker-corr-sub   { font-size: 12px; opacity: 0.7; margin-top: 2px; }
    .ticker-corr-close {
      background: transparent; border: 0; font-size: 22px; line-height: 1;
      padding: 4px 8px; cursor: pointer; color: inherit;
    }

    .ticker-corr-filters {
      display: flex; gap: 6px; overflow-x: auto;
      padding: 10px 16px;
      border-bottom: 1px solid rgba(128,128,128,0.18);
      -webkit-overflow-scrolling: touch;
    }
    .ticker-corr-chip {
      flex: 0 0 auto;
      padding: 5px 10px;
      border-radius: 999px;
      border: 1px solid rgba(128,128,128,0.35);
      background: transparent; color: inherit;
      font-size: 12px; cursor: pointer;
      white-space: nowrap;
    }
    .ticker-corr-chip.is-active {
      background: #4a9eff; border-color: #4a9eff; color: #fff;
    }

    .ticker-corr-list {
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 6px 8px 16px 8px;
      flex: 1;
    }

    .ticker-corr-row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      align-items: center;
      gap: 10px;
      padding: 9px 10px;
      border-bottom: 1px solid rgba(128,128,128,0.10);
      font-size: 14px;
    }
    .ticker-corr-row:last-child { border-bottom: 0; }
    .ticker-corr-name { display: flex; flex-direction: column; min-width: 0; }
    .ticker-corr-ticker { font-weight: 600; }
    .ticker-corr-sector { font-size: 11px; opacity: 0.6; }

    .ticker-corr-r {
      font-variant-numeric: tabular-nums;
      font-weight: 600; padding: 2px 8px;
      border-radius: 6px; min-width: 56px; text-align: center;
    }
    .ticker-corr-add {
      border: 1px solid rgba(128,128,128,0.4);
      background: transparent; color: inherit;
      padding: 5px 10px; border-radius: 8px;
      font-size: 12px; cursor: pointer; white-space: nowrap;
    }
    .ticker-corr-add:disabled {
      opacity: 0.5; cursor: default;
    }

    .corr-toast {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%) translateY(20px);
      background: rgba(30,30,30,0.95); color: #fff;
      padding: 10px 16px; border-radius: 10px;
      font-size: 13px; z-index: 10000;
      opacity: 0; pointer-events: none;
      transition: opacity 0.2s, transform 0.2s;
      max-width: calc(100vw - 40px);
      text-align: center;
    }
    .corr-toast.is-open {
      opacity: 1; transform: translateX(-50%) translateY(0);
    }
  `;
  document.head.appendChild(style);
}

// ----- Создание DOM шторки (один раз) -----
function ensurePanel() {
  let root = document.getElementById('tickerCorrPanel');
  if (root) return root;

  injectPanelStyles();

  root = document.createElement('div');
  root.id = 'tickerCorrPanel';
  root.innerHTML = `
    <div class="ticker-corr-overlay" id="tickerCorrOverlay"></div>
    <div class="ticker-corr-sheet" id="tickerCorrSheet">
      <div class="ticker-corr-header">
        <div>
          <div class="ticker-corr-title" id="tickerCorrTitle">—</div>
          <div class="ticker-corr-sub" id="tickerCorrSub">—</div>
        </div>
        <button class="ticker-corr-close" id="tickerCorrClose" aria-label="Закрыть">×</button>
      </div>
      <div class="ticker-corr-filters" id="tickerCorrFilters"></div>
      <div class="ticker-corr-list" id="tickerCorrList"></div>
    </div>
  `;
  document.body.appendChild(root);

  document.getElementById('tickerCorrOverlay').addEventListener('click', closeTickerPanel);
  document.getElementById('tickerCorrClose').addEventListener('click', closeTickerPanel);

  // Делегирование клика по списку — для кнопок «+ В набор»
  document.getElementById('tickerCorrList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-add-ticker]');
    if (!btn) return;
    addTickerToSet(btn.dataset.addTicker);
  });

  // Делегирование клика по чипам фильтра
  document.getElementById('tickerCorrFilters').addEventListener('click', (e) => {
    const chip = e.target.closest('button[data-sector]');
    if (!chip) return;
    const val = chip.dataset.sector || '';
    _currentSectorFilter = val === '' ? null : val;
    // Перерисовать чипы (активный класс)
    document.querySelectorAll('#tickerCorrFilters .ticker-corr-chip')
      .forEach(c => c.classList.toggle('is-active', c.dataset.sector === (val || '')));
    // Перерисовать список
    if (_currentPanelTicker && _corrMatrixCache) {
      renderTickerList(_corrMatrixCache, _currentPanelTicker);
    }
  });

  return root;
}

// ----- Обработчик клика по матрице -----
async function onMatrixClick(e) {
  const td = e.target.closest('td[data-ticker-row]');
  if (td) {
    openTickerPanel(td.dataset.tickerRow);
    return;
  }
  const th = e.target.closest('th[data-ticker]');
  if (th) {
    openTickerPanel(th.dataset.ticker);
    return;
  }
}

// ----- Открыть шторку для тикера -----
async function openTickerPanel(ticker) {
  const data = await loadCorrelationMatrix();
  if (!data) {
    showCorrToast('Не удалось загрузить корреляционную матрицу');
    return;
  }
  if (!data.tickers.includes(ticker)) {
    showCorrToast(`${ticker}: недостаточно истории для полной матрицы`);
    return;
  }

  _currentPanelTicker = ticker;
  _currentSectorFilter = null;

  const root = ensurePanel();
  const overlay = root.querySelector('#tickerCorrOverlay');
  const sheet = root.querySelector('#tickerCorrSheet');

  // Заголовок и подпись
  root.querySelector('#tickerCorrTitle').textContent = `${ticker} — корреляция с другими`;
  root.querySelector('#tickerCorrSub').textContent =
    `${data.tickers.length - 1} бумаг · ${data.period_start} → ${data.period_end}`;

  // Чипы секторов
  renderSectorFilters(data);

  // Список
  renderTickerList(data, ticker);

  // Открыть
  overlay.classList.add('is-open');
  sheet.classList.add('is-open');
}

function closeTickerPanel() {
  const root = document.getElementById('tickerCorrPanel');
  if (!root) return;
  root.querySelector('#tickerCorrOverlay').classList.remove('is-open');
  root.querySelector('#tickerCorrSheet').classList.remove('is-open');
  _currentPanelTicker = null;
  _currentSectorFilter = null;
}

// ----- Рендер чипов фильтра -----
function renderSectorFilters(data) {
  const wrap = document.getElementById('tickerCorrFilters');
  if (!wrap) return;

  const counts = {};
  for (const t of data.tickers) {
    const s = (data.sectors && data.sectors[t]) || 'Прочее';
    counts[s] = (counts[s] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = data.tickers.length;

  const chips = [
    `<button class="ticker-corr-chip is-active" data-sector="">Все (${total})</button>`,
  ];
  for (const [sec, cnt] of sorted) {
    // прячем «Прочее», если оно занимает меньше 5% — не засоряем ленту
    if (sec === 'Прочее' && cnt / total < 0.05 && sorted.length > 6) continue;
    chips.push(
      `<button class="ticker-corr-chip" data-sector="${escapeHtml(sec)}">${escapeHtml(sec)} (${cnt})</button>`
    );
  }
  wrap.innerHTML = chips.join('');
}

// ----- Рендер списка бумаг -----
function renderTickerList(data, ticker) {
  const list = document.getElementById('tickerCorrList');
  if (!list) return;

  const filter = _currentSectorFilter;

  // Собираем строки: { ticker, r, sector }
  const rows = [];
  for (const other of data.tickers) {
    if (other === ticker) continue;
    const sector = (data.sectors && data.sectors[other]) || 'Прочее';
    if (filter && sector !== filter) continue;
    const r = getPairR(data, ticker, other);
    if (r == null) continue;
    rows.push({ ticker: other, r, sector });
  }

  // Сортировка: по возрастанию |r| — самые независимые сверху.
  // При равных |r| — по возрастанию r.
  rows.sort((a, b) => {
    const aa = Math.abs(a.r), bb = Math.abs(b.r);
    if (aa !== bb) return aa - bb;
    return a.r - b.r;
  });

  if (rows.length === 0) {
    list.innerHTML = `<div style="padding:20px;text-align:center;opacity:0.6">Нет бумаг для этого сектора</div>`;
    return;
  }

  // Кто уже в текущем наборе (для подсветки кнопки)
  const currentSet = getCurrentSet();

  const html = rows.map((row, idx) => {
    const c = heatColor(row.r);
    const inSet = currentSet.includes(row.ticker);
    const rLabel = correlationLabel(row.r);
    // Метки для топ-5
    let badge = '';
    if (idx < 5 && Math.abs(row.r) < 0.35) {
      badge = ' 🟢';
    } else if (row.r >= 0.7) {
      badge = ' 🔴';
    }
    return `
      <div class="ticker-corr-row">
        <div class="ticker-corr-name">
          <span class="ticker-corr-ticker">${escapeHtml(row.ticker)}${badge}</span>
          <span class="ticker-corr-sector">${escapeHtml(row.sector)}</span>
        </div>
        <span class="ticker-corr-r" style="background:${c.bg};color:${c.fg}" title="${rLabel}">${row.r.toFixed(2)}</span>
        <button class="ticker-corr-add" data-add-ticker="${escapeHtml(row.ticker)}" ${inSet ? 'disabled' : ''}>
          ${inSet ? '✓ В наборе' : '+ В набор'}
        </button>
      </div>
    `;
  }).join('');

  list.innerHTML = html;
}

// ----- Простая HTML-экранизация -----
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ----- Текущий набор из localStorage -----
function getCurrentSet() {
  try {
    const raw = localStorage.getItem('trading-signals-correlation-set');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

// ----- Добавить тикер в набор -----
function addTickerToSet(ticker) {
  const set = getCurrentSet();
  if (set.includes(ticker)) {
    showCorrToast(`${ticker} уже в наборе`);
    return;
  }
  if (set.length >= 12) {
    showCorrToast('Лимит: 12 бумаг в наборе');
    return;
  }
  set.push(ticker);
  try {
    localStorage.setItem('trading-signals-correlation-set', JSON.stringify(set));
    localStorage.setItem('trading-signals-correlation-source', 'manual');
  } catch (e) {
    console.warn('[correlation] не удалось сохранить набор:', e);
    showCorrToast('Не удалось сохранить набор');
    return;
  }

  // Сообщаем остальному приложению (app.js может слушать)
  try {
    window.dispatchEvent(new CustomEvent('correlation-set-changed', {
      detail: { ticker, set: set.slice() },
    }));
  } catch (e) { /* ignore */ }

  showCorrToast(`${ticker} добавлен (${set.length}/12). Обнови вкладку корреляции, чтобы увидеть в матрице.`);

  // Обновляем кнопку в текущем списке
  if (_currentPanelTicker && _corrMatrixCache) {
    renderTickerList(_corrMatrixCache, _currentPanelTicker);
  }
}

// ----- Тост -----
let _corrToastTimer = null;
function showCorrToast(text) {
  let el = document.getElementById('corrToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'corrToast';
    el.className = 'corr-toast';
    document.body.appendChild(el);
    // на случай, если стили ещё не вставлены
    injectPanelStyles();
  }
  el.textContent = text;
  // перезапустить анимацию
  el.classList.remove('is-open');
  void el.offsetWidth;
  el.classList.add('is-open');
  if (_corrToastTimer) clearTimeout(_corrToastTimer);
  _corrToastTimer = setTimeout(() => el.classList.remove('is-open'), 2600);
}

// Закрытие по Escape (для десктопа)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTickerPanel();
});
