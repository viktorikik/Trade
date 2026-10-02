// js/indicators.js
// Технические индикаторы, корректировки, фундаментал, риск, макро.

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function findCrossovers(fast, slow) {
  const signals = [];
  for (let i = 1; i < fast.length; i++) {
    const fPrev = fast[i - 1], sPrev = slow[i - 1];
    const fNow = fast[i], sNow = slow[i];
    if (fPrev == null || sPrev == null || fNow == null || sNow == null) continue;

    const prevDiff = fPrev - sPrev;
    const nowDiff = fNow - sNow;

    if (prevDiff <= 0 && nowDiff > 0) signals.push({ index: i, type: 'buy' });
    if (prevDiff >= 0 && nowDiff < 0) signals.push({ index: i, type: 'sell' });
  }
  return signals;
}

function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macd(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );

  const validMacd = macdLine.filter(v => v != null);
  const signalRaw = ema(validMacd, signal);

  const signalAligned = new Array(closes.length).fill(null);
  let j = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] != null && j < signalRaw.length) {
      signalAligned[i] = signalRaw[j++];
    }
  }

  return { macdLine, signalLine: signalAligned };
}

function bollingerBands(closes, period = 20, mult = 2) {
  const middle = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { middle, upper, lower };
}

// =====================================================
// ATR — Average True Range (средний истинный размах)
// =====================================================
function atr(data, period = 14) {
  const out = new Array(data.length).fill(null);
  if (data.length < period + 1) return out;

  const tr = new Array(data.length).fill(null);
  for (let i = 1; i < data.length; i++) {
    const h = data[i].high;
    const l = data[i].low;
    const pc = data[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  out[period] = sum / period;

  for (let i = period + 1; i < data.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }

  return out;
}

// =====================================================
// Корректировка на сплиты
// =====================================================
function applySplitAdjustment(data, splits) {
  if (!splits || splits.length === 0) {
    return { adjusted: data.map(d => ({ ...d })), splitEvents: [] };
  }

  const sorted = [...splits]
    .filter(s => s.date && Number(s.ratio) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const adjusted = data.map(d => ({ ...d }));
  const splitEvents = [];

  for (const split of sorted) {
    let exIdx = -1;
    for (let i = 0; i < adjusted.length; i++) {
      if (adjusted[i].time >= split.date) {
        exIdx = i;
        break;
      }
    }
    if (exIdx <= 0) continue;

    const factor = 1 / split.ratio;

    for (let i = 0; i < exIdx; i++) {
      adjusted[i].open  *= factor;
      adjusted[i].high  *= factor;
      adjusted[i].low   *= factor;
      adjusted[i].close *= factor;
    }

    splitEvents.push({
      date: adjusted[exIdx].time,
      ratio: split.ratio,
      factor: +factor.toFixed(6),
    });
  }

  return { adjusted, splitEvents };
}

// =====================================================
// Корректировка на дивиденды
// =====================================================
function applyDividendAdjustment(data, dividends) {
  if (!dividends || dividends.length === 0) {
    return { adjusted: data.map(d => ({ ...d })), gapDates: [] };
  }

  const adjusted = data.map(d => ({ ...d }));
  const gapDates = [];

  const MAX_DIVIDEND_RATIO = 0.5;

  const sortedDivs = [...dividends]
    .filter(d => {
      if (!d.date || !(Number(d.amount) > 0)) return false;
      const amount = Number(d.amount);
      const bar = data.find(b => b.time === d.date);
      if (bar && amount > bar.close * MAX_DIVIDEND_RATIO) {
        console.warn(
          `[indicators] Пропускаем подозрительный дивиденд ${amount} ₽ ` +
          `на ${d.date} (цена ${bar.close} ₽) — вероятно, ошибка парсинга`
        );
        return false;
      }
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const div of sortedDivs) {
    let exIdx = -1;
    for (let i = 0; i < adjusted.length; i++) {
      if (adjusted[i].time >= div.date) {
        exIdx = i;
        break;
      }
    }
    if (exIdx <= 0) continue;

    const refPrice = adjusted[exIdx - 1].close;
    if (!(refPrice > 0)) continue;

    const factor = (refPrice - div.amount) / refPrice;
    if (factor <= 0 || factor >= 1) continue;

    for (let i = 0; i < exIdx; i++) {
      adjusted[i].open  *= factor;
      adjusted[i].high  *= factor;
      adjusted[i].low   *= factor;
      adjusted[i].close *= factor;
    }

    gapDates.push({
      date: adjusted[exIdx].time,
      amount: div.amount,
      factor: +factor.toFixed(6),
    });
  }

  return { adjusted, gapDates };
}

function applyCorporateActions(data, payload, options = {}) {
  const useSplits    = options.useSplits    !== false;
  const useDividends = options.useDividends !== false;

  let result = data.map(d => ({ ...d }));
  const splitEvents = [];
  const gapDates = [];

  if (useSplits && payload.splits && payload.splits.length > 0) {
    const r = applySplitAdjustment(result, payload.splits);
    result = r.adjusted;
    splitEvents.push(...r.splitEvents);
  }

  if (useDividends && payload.dividends && payload.dividends.length > 0) {
    const r = applyDividendAdjustment(result, payload.dividends);
    result = r.adjusted;
    gapDates.push(...r.gapDates);
  }

  return { adjusted: result, splitEvents, gapDates };
}

// =====================================================
// Сигналы стратегий
// =====================================================

function emaCrossoverSignals(data, fastPeriod, slowPeriod) {
  const closes = data.map(d => d.close);
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  return findCrossovers(fast, slow);
}

function rsiMeanReversionSignals(data, period = 14, oversold = 30, overbought = 70) {
  const closes = data.map(d => d.close);
  const r = rsi(closes, period);
  const signals = [];
  let inPosition = false;
  for (let i = 1; i < r.length; i++) {
    if (r[i] == null || r[i - 1] == null) continue;
    if (!inPosition && r[i - 1] >= oversold && r[i] < oversold) {
      signals.push({ index: i, type: 'buy' });
      inPosition = true;
    } else if (inPosition && r[i - 1] <= overbought && r[i] > overbought) {
      signals.push({ index: i, type: 'sell' });
      inPosition = false;
    }
  }
  return signals;
}

function bollingerBreakoutSignals(data, period = 20, mult = 2) {
  const closes = data.map(d => d.close);
  const bb = bollingerBands(closes, period, mult);
  const signals = [];
  let inPosition = false;
  for (let i = 1; i < closes.length; i++) {
    if (bb.lower[i] == null || bb.middle[i] == null) continue;
    if (!inPosition && closes[i] < bb.lower[i]) {
      signals.push({ index: i, type: 'buy' });
      inPosition = true;
    } else if (inPosition && closes[i] > bb.middle[i]) {
      signals.push({ index: i, type: 'sell' });
      inPosition = false;
    }
  }
  return signals;
}

function buyHoldSignals(data) {
  if (data.length < 2) return [];
  return [{ index: 0, type: 'buy' }];
}

const STRATEGIES = {
  ema: {
    id: 'ema',
    label: 'EMA-кроссовер',
    generate: (data, p) => emaCrossoverSignals(data, p.fast || 9, p.slow || 21),
    params: ['fast', 'slow'],
    defaults: { fast: 9, slow: 21 },
  },
  rsi: {
    id: 'rsi',
    label: 'RSI mean-reversion',
    generate: (data, p) => rsiMeanReversionSignals(data, p.period || 14, p.oversold || 30, p.overbought || 70),
    params: ['period', 'oversold', 'overbought'],
    defaults: { period: 14, oversold: 30, overbought: 70 },
  },
  bollinger: {
    id: 'bollinger',
    label: 'Bollinger breakout',
    generate: (data, p) => bollingerBreakoutSignals(data, p.period || 20, p.mult || 2),
    params: ['period', 'mult'],
    defaults: { period: 20, mult: 2 },
  },
  buyhold: {
    id: 'buyhold',
    label: 'Buy & Hold',
    generate: (data) => buyHoldSignals(data),
    params: [],
    defaults: {},
  },
};

// =====================================================
// Комплексный технический анализ
// =====================================================

function analyzeMarket(data) {
  const closes = data.map(d => d.close);
  const volumes = data.map(d => d.volume);

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdData = macd(closes);
  const bb = bollingerBands(closes);
  const volumeSma = sma(volumes, 20);

  const i = closes.length - 1;
  const lastClose = closes[i];
  const reasons = [];
  let score = 0;

  if (ema9[i] > ema21[i] && ema21[i] > ema50[i]) {
    score += 2;
    reasons.push('✅ Сильный восходящий тренд: EMA 9 > EMA 21 > EMA 50');
  } else if (ema9[i] > ema21[i]) {
    score += 1;
    reasons.push('🔼 Краткосрочный рост: EMA 9 выше EMA 21');
  } else if (ema9[i] < ema21[i] && ema21[i] < ema50[i]) {
    score -= 2;
    reasons.push('❌ Сильный нисходящий тренд: EMA 9 < EMA 21 < EMA 50');
  } else if (ema9[i] < ema21[i]) {
    score -= 1;
    reasons.push('🔽 Краткосрочное падение: EMA 9 ниже EMA 21');
  }

  if (rsi14[i] != null) {
    if (rsi14[i] < 30) {
      score += 2;
      reasons.push(`✅ RSI перепродан (${rsi14[i].toFixed(1)}) — возможен отскок вверх`);
    } else if (rsi14[i] > 70) {
      score -= 2;
      reasons.push(`❌ RSI перекуплен (${rsi14[i].toFixed(1)}) — возможна коррекция`);
    } else if (rsi14[i] > 50) {
      score += 1;
      reasons.push(`🔼 RSI выше 50 (${rsi14[i].toFixed(1)}) — бычий моментум`);
    } else {
      reasons.push(`🔽 RSI ниже 50 (${rsi14[i].toFixed(1)}) — медвежий моментум`);
    }
  }

  const macdNow = macdData.macdLine[i];
  const signalNow = macdData.signalLine[i];
  if (macdNow != null && signalNow != null) {
    if (macdNow > signalNow) {
      score += 2;
      reasons.push('✅ MACD выше сигнальной линии — бычий импульс');
    } else {
      score -= 2;
      reasons.push('❌ MACD ниже сигнальной линии — медвежий импульс');
    }
  }

  if (bb.lower[i] != null && lastClose <= bb.lower[i]) {
    score += 1;
    reasons.push('✅ Цена у нижней полосы Боллинджера — зона перепроданности');
  } else if (bb.upper[i] != null && lastClose >= bb.upper[i]) {
    score -= 1;
    reasons.push('❌ Цена у верхней полосы Боллинджера — зона перекупленности');
  }

  if (volumeSma[i] != null && volumes[i] > volumeSma[i]) {
    score += 1;
    reasons.push('✅ Объём выше среднего — движение подтверждено');
  } else {
    reasons.push('⚠️ Объём ниже среднего — движению не хватает силы');
  }

  let verdict, verdictClass;
  if (score >= 5)       { verdict = 'СИЛЬНО КУПИТЬ'; verdictClass = 'strong-buy'; }
  else if (score >= 3)  { verdict = 'КУПИТЬ';        verdictClass = 'buy'; }
  else if (score <= -3) { verdict = 'ПРОДАТЬ';       verdictClass = 'sell'; }
  else                  { verdict = 'НЕЙТРАЛЬНО';   verdictClass = 'neutral'; }

  return {
    verdict,
    verdictClass,
    score,
    reasons,
    indicators: {
      rsi: rsi14[i],
      macd: { macdValue: macdNow, signalValue: signalNow },
    },
  };
}

// =====================================================
// Фундаментальный анализ
// =====================================================

function _fmtRatio(v, digits = 2) {
  if (v == null || !isFinite(v)) return '—';
  return Number(v).toFixed(digits);
}

function _fmtPercent(v, digits = 1) {
  if (v == null || !isFinite(v)) return '—';
  return Number(v).toFixed(digits) + '%';
}

function _fmtBln(v) {
  if (v == null || !isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) {
    return (v / 1000).toFixed(2) + ' трлн ₽';
  }
  return Number(v).toFixed(0) + ' млрд ₽';
}

function analyzeFundamentals(payload) {
  if (!payload || !payload.fundamentals || !payload.fundamentals.metrics) {
    return null;
  }

  const f = payload.fundamentals;
  const m = f.metrics;
  const reasons = [];
  const cards = [];
  let score = 0;

  if (m.pe != null && isFinite(m.pe)) {
    const pe = m.pe;
    let cls, verdict, hint;
    if (pe <= 0) {
      cls = 'bad'; verdict = 'прибыль отрицательная'; score -= 2;
      hint = 'Компания в убытке — P/E не имеет смысла.';
    } else if (pe < 5) {
      cls = 'good'; verdict = 'очень дёшево'; score += 2;
      hint = `Акция «окупится» прибылью за ~${pe.toFixed(1)} года. Это очень низкий P/E — рынок оценивает компанию с большим дисконтом.`;
    } else if (pe < 10) {
      cls = 'good'; verdict = 'дёшево'; score += 1;
      hint = `Акция окупится за ~${pe.toFixed(1)} лет. Ниже среднего по рынку (10–15).`;
    } else if (pe < 20) {
      cls = 'neutral'; verdict = 'справедливо'; score += 0;
      hint = `Акция окупится за ~${pe.toFixed(1)} лет. Это типичный диапазон для рынка.`;
    } else if (pe < 30) {
      cls = 'bad'; verdict = 'дорого'; score -= 1;
      hint = `Акция окупится за ~${pe.toFixed(1)} лет. Инвесторы ожидают быстрого роста прибыли.`;
    } else {
      cls = 'bad'; verdict = 'очень дорого'; score -= 2;
      hint = `P/E = ${pe.toFixed(1)} — очень высокий. Оправдан только при взрывном росте прибыли.`;
    }
    cards.push({ key: 'P/E', full: 'Цена / Прибыль', value: _fmtRatio(pe), cls, verdict, hint });
    reasons.push(`${cls === 'good' ? '✅' : cls === 'bad' ? '❌' : '🔸'} P/E = ${pe.toFixed(2)} — ${verdict}`);
  }

  if (m.pb != null && isFinite(m.pb)) {
    const pb = m.pb;
    let cls, verdict, hint;
    if (pb <= 0) {
      cls = 'neutral'; verdict = '—'; hint = 'Балансовая стоимость отрицательная.';
    } else if (pb < 0.8) {
      cls = 'good'; verdict = 'очень дёшево'; score += 2;
      hint = 'Компания стоит дешевле, чем всё её имущество по балансу. Рынок видит риски, но это классический «value»-сигнал.';
    } else if (pb < 1.5) {
      cls = 'good'; verdict = 'дёшево'; score += 1;
      hint = 'Цена близка к балансовой стоимости активов. Обычно так оценивают зрелые компании.';
    } else if (pb < 3) {
      cls = 'neutral'; verdict = 'справедливо'; score += 0;
      hint = 'Стандартная оценка для компаний с хорошей рентабельностью.';
    } else if (pb < 5) {
      cls = 'bad'; verdict = 'дорого'; score -= 1;
      hint = 'Инвесторы платят существенно больше балансовой стоимости — ждут высокой прибыли.';
    } else {
      cls = 'bad'; verdict = 'очень дорого'; score -= 2;
      hint = 'P/B > 5 — рынок оценивает компанию в разы дороже её активов.';
    }
    cards.push({ key: 'P/B', full: 'Цена / Балансовая стоимость', value: _fmtRatio(pb), cls, verdict, hint });
    reasons.push(`${cls === 'good' ? '✅' : cls === 'bad' ? '❌' : '🔸'} P/B = ${pb.toFixed(2)} — ${verdict}`);
  }

  if (m.roe != null && isFinite(m.roe)) {
    const roe = m.roe;
    let cls, verdict, hint;
    if (roe > 20) {
      cls = 'good'; verdict = 'отлично'; score += 2;
      hint = `На каждый рубль капитала акционеров компания зарабатывает ${roe.toFixed(1)} коп. в год. Очень эффективно.`;
    } else if (roe > 15) {
      cls = 'good'; verdict = 'хорошо'; score += 1;
      hint = `Рентабельность капитала ${roe.toFixed(1)}% — выше типичной нормы 10–15%.`;
    } else if (roe > 10) {
      cls = 'neutral'; verdict = 'нормально'; score += 0;
      hint = `ROE ${roe.toFixed(1)}% — на уровне среднего по рынку.`;
    } else if (roe > 5) {
      cls = 'bad'; verdict = 'слабо'; score -= 1;
      hint = `ROE ${roe.toFixed(1)}% — компания зарабатывает мало относительно вложенного капитала.`;
    } else {
      cls = 'bad'; verdict = 'очень слабо'; score -= 2;
      hint = `ROE ${roe.toFixed(1)}% — низкая эффективность использования капитала.`;
    }
    cards.push({ key: 'ROE', full: 'Рентабельность капитала', value: _fmtPercent(roe), cls, verdict, hint });
    reasons.push(`${cls === 'good' ? '✅' : cls === 'bad' ? '❌' : '🔸'} ROE = ${roe.toFixed(1)}% — ${verdict}`);
  }

  if (m.divYield != null && isFinite(m.divYield)) {
    const dy = m.divYield;
    let cls, verdict, hint;
    if (dy > 8) {
      cls = 'good'; verdict = 'отлично'; score += 2;
      hint = `Дивиденды дают ${dy.toFixed(1)}% годовых — существенно выше банковского вклада.`;
    } else if (dy > 5) {
      cls = 'good'; verdict = 'хорошо'; score += 1;
      hint = `Дивидендная доходность ${dy.toFixed(1)}% — выше среднего по рынку.`;
    } else if (dy > 2) {
      cls = 'neutral'; verdict = 'средне'; score += 0;
      hint = `Дивиденды ${dy.toFixed(1)}% — примерно на уровне вклада.`;
    } else if (dy > 1) {
      cls = 'bad'; verdict = 'мало'; score -= 1;
      hint = `Дивиденды ${dy.toFixed(1)}% — ниже банковского вклада.`;
    } else {
      cls = 'bad'; verdict = 'почти нет'; score -= 2;
      hint = 'Компания почти не платит дивиденды.';
    }
    cards.push({ key: 'Div Yield', full: 'Дивидендная доходность', value: _fmtPercent(dy), cls, verdict, hint });
    reasons.push(`${cls === 'good' ? '✅' : cls === 'bad' ? '❌' : '🔸'} Див. доходность = ${dy.toFixed(1)}% — ${verdict}`);
  }

  if (m.roa != null && isFinite(m.roa)) {
    cards.push({
      key: 'ROA', full: 'Рентабельность активов',
      value: _fmtPercent(m.roa), cls: 'neutral', verdict: '',
      hint: `Сколько прибыли компания получает на каждый рубль всех активов (${m.roa.toFixed(1)}%). Для банков норма ниже, чем для промышленности.`,
    });
  }

  if (m.eps != null && isFinite(m.eps)) {
    cards.push({
      key: 'EPS', full: 'Прибыль на акцию',
      value: _fmtRatio(m.eps) + ' ₽', cls: 'neutral', verdict: '',
      hint: 'Чистая прибыль компании, приходящаяся на одну акцию за год.',
    });
  }

  if (m.netProfitBln != null && isFinite(m.netProfitBln)) {
    cards.push({
      key: 'Чистая прибыль', full: 'за последний год',
      value: _fmtBln(m.netProfitBln), cls: 'neutral', verdict: '',
      hint: 'Сколько компания заработала после всех расходов и налогов.',
    });
  }

  if (m.capitalizationBln != null && isFinite(m.capitalizationBln)) {
    cards.push({
      key: 'Капитализация', full: 'рыночная стоимость',
      value: _fmtBln(m.capitalizationBln), cls: 'neutral', verdict: '',
      hint: 'Сколько стоит вся компания на бирже (цена × число акций).',
    });
  }

  let verdict, verdictClass;
  if (score >= 5)       { verdict = 'ФУНДАМЕНТАЛЬНО ДЁШЕВО';        verdictClass = 'strong-buy'; }
  else if (score >= 2)  { verdict = 'ФУНДАМЕНТАЛЬНО ПРИВЛЕКАТЕЛЬНО'; verdictClass = 'buy'; }
  else if (score >= -1) { verdict = 'ФУНДАМЕНТАЛЬНО СПРАВЕДЛИВО';   verdictClass = 'neutral'; }
  else if (score >= -4) { verdict = 'ФУНДАМЕНТАЛЬНО ДОРОГО';        verdictClass = 'sell'; }
  else                  { verdict = 'ФУНДАМЕНТАЛЬНО ОЧЕНЬ ДОРОГО';  verdictClass = 'sell'; }

  return {
    verdict,
    verdictClass,
    score,
    cards,
    reasons,
    asOf: f.asOf || '',
    history: Array.isArray(f.history) ? f.history : [],
  };
}

// =====================================================
// Управление риском
// =====================================================

function analyzeRisk(data, options = {}) {
  const capital       = options.capital ?? 100000;
  const riskPct       = options.riskPct ?? 1;
  const lotSize       = options.lotSize ?? 1;
  const atrPeriod     = options.atrPeriod ?? 14;
  const atrMultiplier = options.atrMultiplier ?? 2;
  const rawPrice      = options.rawPrice ?? null;

  if (!data || data.length < atrPeriod + 1) return null;

  const atrArr = atr(data, atrPeriod);
  const lastAtr = atrArr[data.length - 1];
  if (lastAtr == null || !(lastAtr > 0)) return null;

  const price = (rawPrice != null && rawPrice > 0) ? rawPrice : data[data.length - 1].close;
  const stopPrice = price - atrMultiplier * lastAtr;
  const riskPerShare = price - stopPrice;

  const maxRiskRub = capital * (riskPct / 100);
  const maxSharesByRisk = Math.floor(maxRiskRub / riskPerShare);
  const maxLotsByRisk = Math.floor(maxSharesByRisk / lotSize);

  const maxLotsByCash = Math.floor(capital / (lotSize * price));

  const recommendedLots = Math.max(0, Math.min(maxLotsByRisk, maxLotsByCash));
  const recommendedShares = recommendedLots * lotSize;
  const positionValue = recommendedShares * price;
  const positionPct = (positionValue / capital) * 100;
  const actualRiskRub = recommendedShares * riskPerShare;
  const actualRiskPct = (actualRiskRub / capital) * 100;

  return {
    atr: lastAtr,
    atrPct: (lastAtr / price) * 100,
    atrPeriod,
    atrMultiplier,
    price,
    stopPrice,
    stopPct: (stopPrice / price - 1) * 100,
    riskPerShare,
    maxRiskRub,
    maxLotsByRisk,
    maxLotsByCash,
    recommendedLots,
    recommendedShares,
    positionValue,
    positionPct,
    actualRiskRub,
    actualRiskPct,
    capital,
    riskPct,
    lotSize,
    noCash: maxLotsByCash === 0,
    riskCapped: maxLotsByRisk < maxLotsByCash,
  };
}

// =====================================================
// Макро-контекст
// =====================================================
//
// На вход: объект macroData из data/macro.json.
// Структура:
//   {
//     updatedAt: "2026-10-03",
//     imoex:   { current, date, changePct: {day, month, year}, history },
//     usdrub:  { current, date, changePct: {day, month, year}, history },
//     keyRate: { current, date, history }
//   }
//
// Возвращает { cards, chartData, updatedAt } или null.

function _fmtValue(v, digits = 2) {
  if (v == null || !isFinite(v)) return '—';
  return Number(v).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function _fmtChange(v) {
  if (v == null || !isFinite(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return sign + Number(v).toFixed(2) + '%';
}

function _changeCls(v) {
  if (v == null || !isFinite(v)) return 'neutral';
  if (v > 0.05) return 'good';
  if (v < -0.05) return 'bad';
  return 'neutral';
}

function analyzeMacro(macroData) {
  if (!macroData) return null;

  const hasImoex = macroData.imoex && isFinite(macroData.imoex.current);
  const hasUsd   = macroData.usdrub && isFinite(macroData.usdrub.current);
  const hasRate  = macroData.keyRate && isFinite(macroData.keyRate.current);

  if (!hasImoex && !hasUsd && !hasRate) return null;

  const cards = [];

  if (hasImoex) {
    const im = macroData.imoex;
    const ch = im.changePct || {};
    cards.push({
      key: 'IMOEX',
      full: 'Индекс Мосбиржи',
      value: _fmtValue(im.current, 2),
      date: im.date,
      changes: [
        { label: 'День',  value: ch.day },
        { label: 'Мес.',  value: ch.month },
        { label: 'Год',   value: ch.year },
      ],
      hint: 'Главный барометр российского рынка акций. Если он растёт — растут и большинство бумаг.',
    });
  }

  if (hasUsd) {
    const usd = macroData.usdrub;
    const ch = usd.changePct || {};
    cards.push({
      key: 'USD/RUB',
      full: 'Курс доллара (фиксинг)',
      value: _fmtValue(usd.current, 4),
      date: usd.date,
      changes: [
        { label: 'День',  value: ch.day },
        { label: 'Мес.',  value: ch.month },
        { label: 'Год',   value: ch.year },
      ],
      hint: 'Рост курса доллара обычно давит на акции: инвесторы уходят в валюту. Для экспортёров (Газпром, Роснефть) — наоборот, помогает.',
    });
  }

  if (hasRate) {
    const kr = macroData.keyRate;
    cards.push({
      key: 'Ключевая ставка',
      full: 'ЦБ РФ, % годовых',
      value: _fmtValue(kr.current, 2) + '%',
      date: kr.date,
      changes: [],
      hint: 'Процент, под который ЦБ даёт деньги банкам. Высокая ставка = вклады привлекательнее акций = рынок охлаждается. Низкая = наоборот.',
    });
  }

  // Мини-график IMOEX: последние ~90 точек (3 месяца)
  let chartData = null;
  if (hasImoex && Array.isArray(macroData.imoex.history)) {
    const hist = macroData.imoex.history;
    const slice = hist.slice(-90);
    chartData = slice.map(h => ({ time: h.time, value: h.close }));
  }

  return {
    cards,
    chartData,
    updatedAt: macroData.updatedAt || '',
    imoexChangeDay: hasImoex ? macroData.imoex.changePct?.day : null,
  };
}
