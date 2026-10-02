"""
Парсит историю дивидендов с Smart-Lab.
Возвращает словарь {ticker: [{date, amount}, ...]}.
"""

import io
import re
import sys
import time

import pandas as pd
import requests

SMARTLAB_URL = "https://smart-lab.ru/q/{ticker}/dividend/"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "ru-RU,ru;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

DATE_RE = re.compile(r"^\d{2}\.\d{2}\.\d{4}$")


def parse_amount(raw) -> float | None:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw)
    s = s.replace("₽", "").replace("\xa0", "").replace(" ", "")
    s = s.replace(",", ".")
    s = re.sub(r"[^\d.]", "", s)
    if not s:
        return None
    try:
        val = float(s)
    except ValueError:
        return None
    return val if val > 0 else None


def looks_like_year(value: float) -> bool:
    """True, если значение похоже на год (1900–2100), а не на дивиденд."""
    if value is None:
        return False
    if value != int(value):
        return False
    return 1900 <= value <= 2100


def score_amount_column(df: pd.DataFrame, col_idx: int) -> float:
    """
    Оценивает столбец как кандидат на 'размер дивиденда'.
    Чем выше оценка, тем вероятнее это нужный столбец.
    """
    sample = df.iloc[:, col_idx].dropna().head(10)
    if len(sample) == 0:
        return -1.0

    parsed = [parse_amount(v) for v in sample]
    valid = [v for v in parsed if v is not None and v > 0]
    if not valid:
        return -1.0

    score = 0.0
    total = len(valid)

    # Штраф за "годы" — они не могут быть дивидендом
    year_penalty = sum(1 for v in valid if looks_like_year(v))
    if year_penalty == total:
        return -1.0  # это точно столбец с годами
    score -= year_penalty * 2.0

    # Бонус за наличие копеек (дивиденды часто с копейками)
    has_decimals = sum(1 for v in valid if v != int(v))
    score += has_decimals * 0.5

    # Бонус за правдоподобный диапазон дивиденда: 0.01 – 5000 ₽
    reasonable = sum(1 for v in valid if 0.01 <= v <= 5000 and not looks_like_year(v))
    score += reasonable * 1.0

    # Штраф за подозрительно большие значения (ID, объёмы и т.п.)
    huge = sum(1 for v in valid if v > 100000)
    score -= huge * 2.0

    return score


def find_dividend_table(tables: list[pd.DataFrame]):
    """Находит таблицу с датами DD.MM.YYYY и колонкой-дивидендом."""
    best = None
    best_score = -1.0

    for df in tables:
        if df.shape[1] < 3 or df.shape[0] < 1:
            continue

        # Ищем колонку с датами
        date_col = None
        for col_idx in range(df.shape[1]):
            sample = df.iloc[:, col_idx].dropna().astype(str).head(10)
            if len(sample) == 0:
                continue
            matches = sample.str.match(DATE_RE).sum()
            if matches >= max(1, len(sample) // 2):
                date_col = col_idx
                break

        if date_col is None:
            continue

        # Среди остальных колонок ищем лучшую по оценке
        for col_idx in range(df.shape[1]):
            if col_idx == date_col:
                continue
            s = score_amount_column(df, col_idx)
            if s > best_score:
                best_score = s
                best = (df, date_col, col_idx)

    if best is None or best_score < 0:
        return None

    return best


def fetch_dividends_for_ticker(ticker: str, start_date: str) -> list[dict]:
    url = SMARTLAB_URL.format(ticker=ticker.upper())

    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"  [{ticker}] ошибка запроса к Smart-Lab: {e}", file=sys.stderr)
        return []

    print(f"  [{ticker}] HTTP {resp.status_code}, длина HTML: {len(resp.text)} символов", flush=True)

    try:
        tables = pd.read_html(io.StringIO(resp.text), header=0)
    except ValueError as e:
        print(f"  [{ticker}] pandas не нашёл ни одной таблицы: {e}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"  [{ticker}] ошибка парсинга HTML: {e}", file=sys.stderr)
        return []

    print(f"  [{ticker}] найдено таблиц: {len(tables)}", flush=True)

    found = find_dividend_table(tables)
    if found is None:
        print(f"  [{ticker}] не удалось найти таблицу с дивидендами", file=sys.stderr)
        return []

    df, date_col, amount_col = found
    date_header = str(df.columns[date_col])[:40]
    amount_header = str(df.columns[amount_col])[:40]
    print(
        f"  [{ticker}] таблица дивидендов: дата='{date_header}' (столбец {date_col}), "
        f"сумма='{amount_header}' (столбец {amount_col})",
        flush=True,
    )

    result = []
    for _, row in df.iterrows():
        date_raw = row.iloc[date_col]
        amount_raw = row.iloc[amount_col]

        if pd.isna(date_raw):
            continue

        date_str_raw = str(date_raw).strip()
        if not DATE_RE.match(date_str_raw):
            continue

        try:
            date_obj = pd.to_datetime(date_str_raw, format="%d.%m.%Y")
        except Exception:
            continue

        date_iso = date_obj.strftime("%Y-%m-%d")
        if date_iso < start_date:
            continue

        amount = parse_amount(amount_raw)
        if amount is None or looks_like_year(amount):
            continue

        result.append({"date": date_iso, "amount": round(amount, 4)})

    seen = set()
    unique = []
    for d in result:
        key = (d["date"], d["amount"])
        if key not in seen:
            seen.add(key)
            unique.append(d)

    unique.sort(key=lambda x: x["date"])
    return unique


def fetch_all(tickers: list[str], start_date: str) -> dict:
    result = {}
    for ticker in tickers:
        print(f"[{ticker}] тянем дивиденды со Smart-Lab...", flush=True)
        divs = fetch_dividends_for_ticker(ticker, start_date)
        result[ticker] = divs
        print(f"  [{ticker}] итого найдено {len(divs)} дивидендов", flush=True)
        time.sleep(0.7)
    return result


if __name__ == "__main__":
    tickers = sys.argv[1:] if len(sys.argv) > 1 else ["SBER", "GAZP", "LKOH", "GMKN", "ROSN", "NVTK"]
    data = fetch_all(tickers, "2023-01-01")
    for t, divs in data.items():
        print(f"\n{t}:")
        for d in divs:
            print(f"  {d['date']} — {d['amount']} ₽")
