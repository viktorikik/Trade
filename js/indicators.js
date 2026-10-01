// js/indicators.js
// Технические индикаторы и функции анализа. Без внешних зависимостей.

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

// Пересечения двух линий (для меток BUY/SELL на графике)
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

  // Сигнальная линия — EMA от непустых значений MACD
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

// Комплексный анализ рынка. Возвращает вердикт, баллы и список причин.
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

  // 1. Тренд (EMA)
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

  // 2. Моментум (RSI)
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

  // 3. Сила тренда (MACD)
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

  // 4. Волатильность (Bollinger Bands)
  if (bb.lower[i] != null && lastClose <= bb.lower[i]) {
    score += 1;
    reasons.push('✅ Цена у нижней полосы Боллинджера — зона перепроданности');
  } else if (bb.upper[i] != null && lastClose >= bb.upper[i]) {
    score -= 1;
    reasons.push('❌ Цена у верхней полосы Боллинджера — зона перекупленности');
  }

  // 5. Объём
  if (volumeSma[i] != null && volumes[i] > volumeSma[i]) {
    score += 1;
    reasons.push('✅ Объём выше среднего — движение подтверждено');
  } else {
    reasons.push('⚠️ Объём ниже среднего — движению не хватает силы');
  }

  // Вердикт
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
      macd: {
        macdValue: macdNow,
        signalValue: signalNow,
      },
    },
  };
}
