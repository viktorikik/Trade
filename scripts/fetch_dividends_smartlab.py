"""
Парсит историю дивидендов с Smart-Lab.
Возвращает словарь {ticker: [{date, amount}, ...]}.

Источник: https://smart-lab.ru/q/{TICKER}/dividend/
Основано на подходе из блога artie (smart-lab.ru/blog/631130.php).
"""

import sys
import time

import pandas as pd
import requests

SMARTLAB_URL = "https://smart-lab.ru/q/{ticker}/dividend/"

# CSS-класс таблицы с выплаченными дивидендами на Smart-Lab
TABLE_ATTRS = {"class": "simple-little-table financials dividends sort-table"}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "ru-RU,ru;q=0.9",
}


def fetch_dividends_for_ticker(ticker: str, start_date: str) -> list[dict]:
    """
    Возвращает список дивидендов по тикеру:
    [{"date": "YYYY-MM-DD", "amount": float}, ...]
    Только те, что >= start_date.
    """
    url = SMARTLAB_URL.format(ticker=ticker.upper())

    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"  [{ticker}] ошибка запроса к Smart-Lab: {e}", file=sys.stderr)
        return []

    try:
        tables = pd.read_html(
            resp.text,
            header=0,
            decimal=",",
            thousands=None,
            attrs=TABLE_ATTRS,
        )
    except ValueError:
        print(f"  [{ticker}] не нашлось таблицы дивидендов на странице", file=sys.stderr)
        return []

    if not tables:
        print(f"  [{ticker}] таблица пустая", file=sys.stderr)
        return []

    # Последняя таблица — исторические (выплаченные) дивиденды.
    # Первая часто содержит будущие/прогнозные.
    df = tables[-1]

    # Нужные столбцы: тикер, дата T-1 (гэп), размер дивиденда.
    # Ищем их по позициям: 0 — тикер, 1 — дата T-1, 4 или 5 — размер.
    if df.shape[1] < 5:
        print(f"  [{ticker}] неожиданное число столбцов: {df.shape[1]}", file=sys.stderr)
        return []

    # Определяем столбец с суммой дивиденда: обычно это 4-й или 5-й.
    # В таблице Smart-Lab: Тикер | дата T-1 | дата отсечки | Период | дивиденд | ...
    # Берём столбец с индексом 4 (дивиденд).
    div_col = None
    for col_idx in (4, 5):
        if col_idx < df.shape[1]:
            # Проверяем, похожи ли значения на числа
            sample = df.iloc[:, col_idx].dropna().head(3).astype(str)
            if sample.str.replace(",", ".").str.replace("₽", "").str.strip().str.replace(r"[^\d.]", "", regex=True).ne("").all():
                div_col = col_idx
                break

    if div_col is None:
        print(f"  [{ticker}] не удалось найти столбец с дивидендом", file=sys.stderr)
        return []

    result = []
    for _, row in df.iterrows():
        date_raw = row.iloc[1]
        amount_raw = row.iloc[div_col]

        if pd.isna(date_raw) or pd.isna(amount_raw):
            continue

        # Дата в формате DD.MM.YYYY
        try:
            date_obj = pd.to_datetime(date_raw, format="%d.%m.%Y")
        except Exception:
            continue

        date_str = date_obj.strftime("%Y-%m-%d")
        if date_str < start_date:
            continue

        # Очищаем сумму от ₽ и пробелов
        amount_str = (
            str(amount_raw)
            .replace("₽", "")
            .replace(" ", "")
            .replace(",", ".")
            .strip()
        )
        try:
            amount = float(amount_str)
        except ValueError:
            continue

        if amount <= 0:
            continue

        result.append({"date": date_str, "amount": round(amount, 4)})

    # Убираем дубликаты (бывает, что в таблице есть и обычка, и префы)
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
    """Возвращает {ticker: [dividends]} для всех тикеров."""
    result = {}
    for ticker in tickers:
        print(f"[{ticker}] тянем дивиденды со Smart-Lab...", flush=True)
        divs = fetch_dividends_for_ticker(ticker, start_date)
        result[ticker] = divs
        print(f"  [{ticker}] найдено {len(divs)} дивидендов", flush=True)
        time.sleep(0.5)  # вежливая пауза между запросами
    return result


if __name__ == "__main__":
    # Для отладки: python fetch_dividends_smartlab.py SBER GAZP LKOH
    tickers = sys.argv[1:] if len(sys.argv) > 1 else ["SBER", "GAZP", "LKOH", "GMKN", "ROSN", "NVTK"]
    data = fetch_all(tickers, "2023-01-01")
    for t, divs in data.items():
        print(f"\n{t}:")
        for d in divs:
            print(f"  {d['date']} — {d['amount']} ₽")
