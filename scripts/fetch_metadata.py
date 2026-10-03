"""
Собирает паспорт всех бумаг основного режима TQBR:
тикер, имя, отрасль, размер лота.
Пишет data/tickers.json.

Отрасли размечиваются гибридно:
1. Автоматически — через отраслевые индексы MOEX (MOEXOG, MOEXFN, ...).
2. Что не размечено — из словаря SECTORS_OVERRIDE.
3. Что осталось — в группу «Прочее».

Все запросы к MOEX ISS — с retry (15 сек timeout, 2 попытки, пауза 3 сек).
Если индекс не отдался — пропускаем его, разметка не ломается.
"""

import json
import sys
import time
from collections import Counter
from datetime import date
from pathlib import Path

import requests

# ===== Конфигурация =====
BOARD = "TQBR"
OUTPUT_DIR = Path("data")
OUTPUT_FILE = OUTPUT_DIR / "tickers.json"

ISS_BASE = "https://iss.moex.com/iss"
ISS_SECURITIES = f"{ISS_BASE}/engines/stock/markets/shares/boards"
ISS_ANALYTICS = f"{ISS_BASE}/statistics/engines/stock/markets/index/analytics"

REQUEST_TIMEOUT = 15
RETRY_ATTEMPTS = 2
RETRY_DELAY = 3

# Отраслевые индексы MOEX → название группы в шторке.
# Если какого-то кода нет в ISS — он просто пропустится с предупреждением.
SECTOR_INDICES = {
    "MOEXOG": "Нефть и газ",
    "MOEXFN": "Финансы",
    "MOEXMM": "Металлургия",
    "MOEXTL": "Телеком",
    "MOEXCN": "Ритейл",
    "MOEXEU": "Энергетика",
    "MOEXCH": "Химия",
    "MOEXTR": "Транспорт",
    "MOEXIT": "IT",
}

# Ручная разметка — что не покрыто индексами или требует уточнения.
# Перебивает автоматику. Заполняется по мере необходимости.
SECTORS_OVERRIDE = {
    # "SBER": "Финансы",
    # "GAZP": "Нефть и газ",
}

DEFAULT_SECTOR = "Прочее"


def _get_with_retry(session, url, params, label):
    """GET с retry. Возвращает Response или None."""
    last_err = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            return resp
        except Exception as e:
            last_err = e
            if attempt < RETRY_ATTEMPTS:
                print(
                    f"    [{label}] попытка {attempt} не удалась ({type(e).__name__}), "
                    f"повтор через {RETRY_DELAY}с",
                    file=sys.stderr,
                )
                time.sleep(RETRY_DELAY)
    print(
        f"    [{label}] все {RETRY_ATTEMPTS} попытки провалились: {last_err}",
        file=sys.stderr,
    )
    return None


def fetch_all_securities(session):
    """
    Возвращает список dict {ticker, name, lotSize} по всем бумагам TQBR.
    Пагинация — по 100 строк, но обычно всё приходит одной страницей.
    """
    url = f"{ISS_SECURITIES}/{BOARD}/securities.json"
    params = {
        "iss.meta": "off",
        "securities.columns": "SECID,SHORTNAME,LOTSIZE",
    }

    all_rows = []
    columns = None
    start = 0

    while True:
        params["start"] = start
        resp = _get_with_retry(session, url, params, f"securities start={start}")
        if resp is None:
            if start == 0:
                return None
            break

        try:
            data = resp.json()
        except Exception as e:
            print(f"  список бумаг: битый JSON ({e})", file=sys.stderr)
            break

        block = data.get("securities", {})
        page_cols = block.get("columns", [])
        page_rows = block.get("data", [])

        if columns is None:
            columns = page_cols

        if not page_rows or columns is None:
            break

        all_rows.extend(page_rows)
        start += len(page_rows)

        if len(page_rows) < 100:
            break

        time.sleep(0.2)

    if not all_rows or columns is None:
        return None

    result = []
    for row in all_rows:
        d = dict(zip(columns, row))
        ticker = d.get("SECID")
        if not ticker:
            continue
        try:
            lot = int(d.get("LOTSIZE") or 1)
        except (TypeError, ValueError):
            lot = 1
        result.append({
            "ticker": ticker,
            "name": d.get("SHORTNAME") or ticker,
            "lotSize": lot,
        })
    return result


def fetch_index_constituents(session, index_code):
    """
    Возвращает set(ticker) — состав индекса.
    Пустой set при любой ошибке (это не критично).
    Ограничение max_pages защищает от бесконечной пагинации.
    """
    url = f"{ISS_ANALYTICS}/{index_code}.json"
    params = {
        "iss.meta": "off",
        "analytics.columns": "SECID",
    }

    tickers = set()
    columns = None
    start = 0
    max_pages = 5  # достаточно, чтобы захватить текущие составы

    pages = 0
    while pages < max_pages:
        params["start"] = start
        resp = _get_with_retry(session, url, params, index_code)
        if resp is None:
            break

        try:
            data = resp.json()
        except Exception:
            break

        block = data.get("analytics", {})
        page_cols = block.get("columns", [])
        page_rows = block.get("data", [])

        if columns is None:
            columns = page_cols

        if not page_rows or columns is None:
            break

        for row in page_rows:
            d = dict(zip(columns, row))
            secid = d.get("SECID")
            if secid:
                tickers.add(secid)

        start += len(page_rows)
        pages += 1

        if len(page_rows) < 100:
            break

        time.sleep(0.2)

    return tickers


def assign_sectors(securities, session):
    """
    Возвращает dict {ticker: sector_name}.
    Сначала все в «Прочее», потом индексы, потом override.
    """
    sectors = {s["ticker"]: DEFAULT_SECTOR for s in securities}
    valid_tickers = set(sectors.keys())

    for index_code, sector_name in SECTOR_INDICES.items():
        print(f"  [{index_code}] тянем состав индекса...", flush=True)
        constituents = fetch_index_constituents(session, index_code)

        if not constituents:
            print(f"    → пусто (индекс недоступен или нет данных)", flush=True)
            continue

        assigned = 0
        for ticker in constituents:
            if ticker in valid_tickers and sectors[ticker] == DEFAULT_SECTOR:
                sectors[ticker] = sector_name
                assigned += 1

        print(
            f"    → {len(constituents)} бумаг в индексе, "
            f"{assigned} размечено как «{sector_name}»",
            flush=True,
        )

    # Ручные переопределения (перебивают автоматику)
    override_applied = 0
    for ticker, sector in SECTORS_OVERRIDE.items():
        if ticker in valid_tickers:
            sectors[ticker] = sector
            override_applied += 1
    if override_applied:
        print(f"  Override: применено {override_applied} правил", flush=True)

    return sectors


def main() -> int:
    OUTPUT_DIR.mkdir(exist_ok=True)

    with requests.Session() as session:
        session.headers.update({"User-Agent": "trading-signals-mvp/1.0"})

        print("=== Загрузка списка бумаг TQBR ===", flush=True)
        securities = fetch_all_securities(session)
        if not securities:
            print("Не удалось получить список бумаг TQBR", file=sys.stderr)
            return 1

        print(f"  Найдено бумаг: {len(securities)}", flush=True)

        print("\n=== Разметка отраслей ===", flush=True)
        sectors = assign_sectors(securities, session)

        # Итоговое распределение
        counter = Counter(sectors.values())
        print("\n=== Распределение по отраслям ===", flush=True)
        for sector, count in counter.most_common():
            print(f"  {sector}: {count}", flush=True)

        # Собираем финальный payload
        tickers_sorted = sorted(securities, key=lambda x: x["ticker"])
        payload = {
            "updatedAt": date.today().isoformat(),
            "board": BOARD,
            "count": len(tickers_sorted),
            "tickers": [
                {
                    "ticker": s["ticker"],
                    "name": s["name"],
                    "sector": sectors.get(s["ticker"], DEFAULT_SECTOR),
                    "lotSize": s["lotSize"],
                }
                for s in tickers_sorted
            ],
        }

    OUTPUT_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    size_kb = OUTPUT_FILE.stat().st_size / 1024
    print(
        f"\nГотово. Записано: {OUTPUT_FILE} "
        f"({len(payload['tickers'])} бумаг, ~{size_kb:.1f} КБ)",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
