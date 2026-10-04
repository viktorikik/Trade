#!/usr/bin/env python3
"""
fetch_correlation.py — предрасчёт матрицы корреляции всех бумаг.

Что делает:
  1. Читает все data/{TICKER}.json (свечи).
  2. Берёт последние 2 года (от текущей даты).
  3. Считает корреляцию Пирсона по дневным доходностям.
  4. Сохраняет плоскую матрицу в data/correlation.json.

Запускается в GitHub Actions после fetch_moex.py.

Формат data/correlation.json:
  {
    "generated_at": "2026-10-05T23:00:00Z",
    "period_start": "2024-10-05",
    "period_end":   "2026-10-05",
    "period_years": 2,
    "min_overlap_days": 100,
    "tickers": ["SBER", "GAZP", ...],
    "sectors": {"SBER": "Финансы", ...},
    "matrix": [r_01, r_02, ..., r_0n, r_12, ..., r_(n-1)n]
  }

  matrix — плоский верхний треугольник (i < j), т.к. матрица симметрична.
"""

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

# ---------- Настройки ----------

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TICKERS_FILE = DATA_DIR / "tickers.json"
OUT_FILE = DATA_DIR / "correlation.json"

PERIOD_YEARS = 2            # окно корреляции: 2 года от текущей даты
MIN_OVERLAP_DAYS = 100      # мин. общих торговых дней для осмысленной корреляции
ROUND_DIGITS = 2            # округление корреляций

# Файлы в data/, которые НЕ являются свечами тикера (в нижнем регистре)
EXCLUDE = {"tickers", "macro", "smartlab-rotation", "correlation"}


# ---------- Утилиты ----------

def load_sector_map():
    """Достаёт карту {TICKER: отрасль} из tickers.json. Формат — любой."""
    if not TICKERS_FILE.exists():
        print(f"[i] {TICKERS_FILE.name} не найден — отрасли будут 'Прочее'")
        return {}
    try:
        with open(TICKERS_FILE, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as e:
        print(f"[!] Не удалось прочитать tickers.json: {e}")
        return {}

    # Возможные форматы:
    #  A) {"tickers": [{"ticker": "SBER", "sector": "Финансы"}, ...]}
    #  B) {"tickers": {"SBER": {"sector": ...}, ...}}
    #  C) [{"ticker": "SBER", ...}, ...]
    #  D) {"SBER": {"sector": ...}, ...}

    items = None
    if isinstance(payload, dict):
        items = payload.get("tickers", payload)
    elif isinstance(payload, list):
        items = payload

    result = {}
    if isinstance(items, dict):
        for k, v in items.items():
            sector = "Прочее"
            if isinstance(v, dict):
                sector = v.get("sector") or v.get("industry") or "Прочее"
            result[str(k).upper()] = sector
    elif isinstance(items, list):
        for it in items:
            if not isinstance(it, dict):
                continue
            t = it.get("ticker") or it.get("secid") or it.get("SECID")
            sector = it.get("sector") or it.get("industry") or "Прочее"
            if t:
                result[str(t).upper()] = sector
    return result


def extract_candles(payload):
    """Достаёт список свечей из JSON любой формы."""
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return None
    for key in ("candles", "data", "history", "rows", "bars", "prices"):
        if key not in payload:
            continue
        node = payload[key]
        # Формат MOEX ISS: {"candles": {"columns": [...], "data": [[...], ...]}}
        if isinstance(node, dict) and "columns" in node and "data" in node:
            cols = node["columns"]
            return [dict(zip(cols, row)) for row in node["data"]]
        # Формат «уже список словарей»
        if isinstance(node, list):
            return node
    return None


def pick(c, *keys):
    """Возвращает первое непустое значение из словаря по списку ключей."""
    for k in keys:
        if k in c and c[k] is not None and c[k] != "":
            return c[k]
    return None


def load_prices(ticker, cutoff_date):
    """Читает свечи тикера, возвращает pandas.Series дневных Close."""
    path = DATA_DIR / f"{ticker}.json"
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        return None

    candles = extract_candles(payload)
    if not candles:
        return None

    dates, closes = [], []
    for c in candles:
        if not isinstance(c, dict):
            continue
        d = pick(c, "TRADEDATE", "tradedate", "date", "begin", "trade_date")
        cl = pick(c, "CLOSE", "close", "Close", "close_price")
        if d is None or cl is None:
            continue
        try:
            cl = float(str(cl).replace(",", "."))
        except (TypeError, ValueError):
            continue
        if cl <= 0:
            continue
        dates.append(d)
        closes.append(cl)

    if not dates:
        return None

    s = pd.Series(closes, index=pd.to_datetime(dates, errors="coerce"), name=ticker)
    s = s[s.index.notna()]
    s = s[~s.index.duplicated(keep="last")].sort_index()
    s = s[s.index >= cutoff_date]
    return s if len(s) > 0 else None


# ---------- Основная логика ----------

def main():
    now = datetime.now(timezone.utc)
    cutoff = pd.Timestamp((now - timedelta(days=PERIOD_YEARS * 365)).date())
    period_start = cutoff.strftime("%Y-%m-%d")
    period_end = now.strftime("%Y-%m-%d")

    print("=" * 60)
    print("fetch_correlation.py")
    print(f"Период: {period_start} .. {period_end}  (~{PERIOD_YEARS} года)")
    print("=" * 60)

    sector_map = load_sector_map()
    print(f"Отраслей в паспорте: {len(sector_map)}")

    # Собираем цены по всем файлам data/*.json, кроме служебных
    prices = {}
    files = sorted(DATA_DIR.glob("*.json"))
    print(f"Файлов в data/: {len(files)}")

    for path in files:
        name = path.stem.upper()
        if path.stem.lower() in EXCLUDE:
            continue
        s = load_prices(name, cutoff)
        if s is None or len(s) < MIN_OVERLAP_DAYS:
            continue
        prices[name] = s

    print(f"Бумаг с достаточной историей (>= {MIN_OVERLAP_DAYS} дней): {len(prices)}")

    if len(prices) < 2:
        print("[!] Слишком мало бумаг — матрица не имеет смысла. Выход.")
        return

    # Общий DataFrame: даты × тикеры
    df = pd.DataFrame(prices).sort_index()

    # Дневные доходности
    returns = df.pct_change()

    # Корреляция Пирсона, pairwise (у каждого столбца — своё перекрытие)
    corr = returns.corr(method="pearson", min_periods=MIN_OVERLAP_DAYS)

    tickers = list(corr.columns)
    n = len(tickers)
    print(f"Матрица: {n} x {n}  (уникальных пар: {n * (n - 1) // 2})")

    # Плоский верхний треугольник (i < j)
    flat = []
    for i in range(n):
        for j in range(i + 1, n):
            v = corr.iat[i, j]
            if v is None or pd.isna(v) or (isinstance(v, float) and math.isnan(v)):
                flat.append(None)
            else:
                flat.append(round(float(v), ROUND_DIGITS))

    sectors = {t: sector_map.get(t, "Прочее") for t in tickers}

    out = {
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "period_start": period_start,
        "period_end": period_end,
        "period_years": PERIOD_YEARS,
        "min_overlap_days": MIN_OVERLAP_DAYS,
        "tickers": tickers,
        "sectors": sectors,
        "matrix": flat,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = OUT_FILE.stat().st_size / 1024
    print("-" * 60)
    print(f"[OK] Сохранено: {OUT_FILE}")
    print(f"     Размер: {size_kb:.1f} КБ")
    print(f"     Пар в матрице: {len(flat)}")


if __name__ == "__main__":
    main()
