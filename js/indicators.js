// Простые технические индикаторы. Без внешних зависимостей.

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
  // Сидим первую точку SMA из первых period значений
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

// Определяет пересечения двух линий.
// fast и slow — массивы той же длины, что и data.
// Возвращает массив { index, type } с type: 'buy' | 'sell'.
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
