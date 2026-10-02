"""
Парсит историю дивидендов с Smart-Lab.
Возвращает словарь {ticker: [{date, amount}, ...]}.

Источник: https://smart-lab.ru/q/{TICKER}/dividend/

Логика: страница содержит несколько таблиц. Ищем ту, где есть
колонка с датой (в формате DD.MM.YYYY) и колонка с числовым
значением дивиденда. CSS-фильтр не используем, потому что
вёрстка Smart-Lab меняется и классы нестабильны.
"""

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
    """Извлекает число из строки типа '25,00 ₽' или '1 234.5'."""
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw)
    s = s.replace("₽", "").replace("\xa0", "").replace(" ", "")
    s = s.replace(",", ".")
    # Оставляем только цифры и точку
    s = re.sub(r"[^\d.]", "", s)
    if not s:
        return None
    try:
        val = float(s)
    except ValueError:
        return None
    return val if val > 0 else None


def find_dividend_table(tables: list[pd.DataFrame]) -> pd.DataFrame | None:
    """
    Ищет таблицу, где есть колонка с датами DD.MM.YYYY и колонка
    с числовыми значениями (дивиденд).
    """
    for df in tables:
        if df.shape[1] < 3 or df.shape[0] < 1:
            continue

        # Ищем столбец с датами
        date_col = None
        for col_idx in range(df.shape[1]):
            sample = df.iloc[:, col_idx].dropna().astype(str).head(5)
            if len(sample) == 0:
                continue
            matches = sample.str.match(DATE_RE).sum()
            if matches >= max(1, len(sample) // 2):
                date_col = col_idx
                break

        if date_col is None:
            continue

        # Ищем столбец с числами (дивиденд)
        amount_col = None
        for col_idx in range(df.shape[1]):
            if col_idx == date_col:
                continue
            sample = df.iloc[:, col_idx].dropna().head(5)
            if len(sample) == 0:
                continue
            # Пробуем распарсить как числа
            parsed = [parse_amount(v) for v in sample]
            parsed_ok = [v for v in parsed if v is not None and v > 0]
            if len(parsed_ok) >= max(1, len(sample) // 2):
                amount_col = col_idx
                break

        if amount_col is None:
            continue

        return df, date_col, amount_col  # type: ignore

    return None


def fetch_dividends_for_ticker(ticker: str, start_date: str) -> list[dict]:
    """Возвращает список дивидендов по тикеру."""
    url = SMARTLAB_URL.format(ticker=ticker.upper())

    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"  [{ticker}] ошибка запроса к Smart-Lab: {e}", file=sys.stderr)
        return []

    print(f"  [{ticker}] HTTP {resp.status_code}, длина HTML: {len(resp.text)} символов", flush=True)

    try:
        tables = pd.read_html(resp.text, header=0)
    except ValueError as e:
        print(f"  [{ticker}] pandas не нашёл ни одной таблицы: {e}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"  [{ticker}] ошибка парсинга HTML: {e}", file=sys.stderr)
        return []

    print(f"  [{ticker}] найдено таблиц: {len(tables)}", flush=True)
    for i, t in enumerate(tables):
        print(f"    таблица #{i}: {t.shape[0]} строк, {t.shape[1]} столбцов", flush=True)

    found = find_dividend_table(tables)
    if found is None:
        print(f"  [{ticker}] не удалось найти таблицу с дивидендами", file=sys.stderr)
        # Сохраняем HTML для отладки
        debug_path = f"/tmp/{ticker}_smartlab.html"
        try:
            with open(debug_path, "w", encoding="utf-8") as f:
                f.write(resp.text)
            print(f"  [{ticker}] HTML сохранён в {debug_path}", file=sys.stderr)
        except Exception:
            pass
        return []

    df, date_col, amount_col = found
    print(f"  [{ticker}] таблица дивидендов: дата=столбец {date_col}, сумма=столбец {amount_col}", flush=True)

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
        if amount is None:
            continue

        result.append({"date": date_iso, "amount": round(amount, 4)})

    # Убираем дубликаты
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
