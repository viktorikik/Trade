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


def parse_amount(raw):
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


def looks_like_year(value):
    if value is None:
        return False
    if value != int(value):
        return False
    return 1900 <= value <= 2100


def header_score(header: str) -> float:
    """
    Оценка заголовка колонки как кандидата на 'сумма дивиденда в рублях'.
    """
    h = str(header).lower()
    score = 0.0

    # Явные признаки "правильной" колонки
    if "дивиденд" in h:
        score += 10
    if "выплат" in h:
        score += 6
    if "на акцию" in h or "на 1 акцию" in h:
        score += 6
    if "₽" in h or "руб" in h or "rub" in h:
        score += 5

    # Явные признаки "неправильной" колонки
    if "%" in h or "процент" in h:
        score -= 15
    if "доходность" in h:
        score -= 15
    if "период" in h:
        score -= 12
    if "год" in h or "year" in h:
        score -= 12
    if "t-1" in h or "t+1" in h:
        score -= 6

    return score


def value_score(df: pd.DataFrame, col_idx: int) -> float:
    """Оценка значений колонки (запасной вариант)."""
    sample = df.iloc[:, col_idx].dropna().head(10)
    if len(sample) == 0:
        return -1.0

    parsed = [parse_amount(v) for v in sample]
    valid = [v for v in parsed if v is not None and v > 0]
    if not valid:
        return -1.0

    total = len(valid)
    year_penalty = sum(1 for v in valid if looks_like_year(v))
    if year_penalty == total:
        return -1.0

    score = 0.0
    score -= year_penalty * 2.0

    # Если все значения в диапазоне 1..20 — это, скорее всего, проценты
    all_small = all(v <= 20 for v in valid)
    if all_small:
        score -= 5.0

    # Бонус за копейки — у рублёвых дивидендов часто есть десятичные
    has_decimals = sum(1 for v in valid if v != int(v))
    score += has_decimals * 0.3

    # Бонус за "крупные" значения — для таких бумаг как LKOH это 100+ ₽
    large = sum(1 for v in valid if 50 <= v <= 100000)
    score += large * 0.5

    return score


def find_dividend_table(tables):
    best = None
    best_total = -1.0

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

        # Ищем колонку с суммой дивиденда
        best_amount_col = None
        best_amount_score = -1e9

        for col_idx in range(df.shape[1]):
            if col_idx == date_col:
                continue

            h_score = header_score(df.columns[col_idx])
            v_score = value_score(df, col_idx)

            # Если заголовок явно говорит "не то" — пропускаем
            if h_score <= -10:
                continue

            total = h_score * 2.0 + v_score

            if total > best_amount_score:
                best_amount_score = total
                best_amount_col = col_idx

        if best_amount_col is None or best_amount_score < 0:
            continue

        if best_amount_score > best_total:
            best_total = best_amount_score
            best = (df, date_col, best_amount_col)

    return best


def fetch_dividends_for_ticker(ticker, start_date):
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

    # Печатаем первые строки для контроля
    print(f"  [{ticker}] первые строки таблицы:", flush=True)
    for i, row in df.head(3).iterrows():
        d = row.iloc[date_col]
        a = row.iloc[amount_col]
        print(f"    дата={d!r}  сумма={a!r}", flush=True)

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


def fetch_all(tickers, start_date):
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
