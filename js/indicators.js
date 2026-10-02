// js/indicators.js
// Технические индикаторы, корректировка на сплиты и дивиденды.

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
// Корректировка на сплиты (backward adjustment)
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
// Корректировка на дивиденды (backward adjustment)
// =====================================================
function applyDividendAdjustment(data, dividends) {
  if (!dividends || dividends.length === 0) {
    return { adjusted: data.map(d => ({ ...d })), gapDates: [] };
  }

  const adjusted = data.map(d => ({ ...d }));
  const gapDates = [];

  const sortedDivs = [...dividends]
    .filter(d => d.date && Number(d.amount) > 0)
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

// =====================================================
// Универсальный helper: применяет сплиты, затем дивиденды
// =====================================================
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
// Комплексный анализ
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
