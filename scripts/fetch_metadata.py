"""
Собирает паспорт всех акций основного режима TQBR:
тикер, имя, отрасль, размер лота.
Пишет data/tickers.json.

Отрасли размечиваются гибридно:
1. Автоматически — через отраслевые индексы MOEX (MOEXOG, MOEXFN, ...).
2. Что не размечено — из словаря SECTORS_OVERRIDE.
3. Что осталось — в группу «Прочее».

Из списка TQBR выбрасываются ETF, паи и прочие не-акции —
оставляем только обыкновенные (SECTYPE=1) и привилегированные (SECTYPE=2).

ВАЖНО: endpoint TQBR/securities.json игнорирует параметр start и всегда
возвращает один и тот же набор ~500 бумаг. Поэтому пагинация останавливается,
как только страница не приносит НОВЫХ тикеров, а итоговый список дедуплицируется.

Все запросы — с retry (10 сек connect + 20 сек read, 2 попытки, пауза 2 сек).
Каждый запрос логируется ДО и ПОСЛЕ — чтобы сразу видеть, где тормозит.
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

REQUEST_TIMEOUT = (10, 20)
RETRY_ATTEMPTS = 2
RETRY_DELAY = 2

# Типы бумаг, которые оставляем (из MOEX ISS).
# 1 = Акция обыкновенная, 2 = Акция привилегированная.
KEPT_SECTYPES = {1, 2}

# Отраслевые индексы MOEX → название группы в шторке.
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

# Ручная разметка — перебивает автоматику.
SECTORS_OVERRIDE = {
    # "SBER": "Финансы",
}

DEFAULT_SECTOR = "Прочее"


def log(msg: str) -> None:
    print(msg, flush=True)


def log_err(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _get_with_retry(session, url, params, label):
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        log(f"    [{label}] → GET (попытка {attempt})")
        t0 = time.time()
        try:
            resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
            dt = time.time() - t0
            log(f"    [{label}] ← HTTP {resp.status_code} за {dt:.1f}с")
            resp.raise_for_status()
            return resp
        except Exception as e:
            dt = time.time() - t0
            log_err(f"    [{label}] ✗ {type(e).__name__} за {dt:.1f}с: {e}")
            if attempt < RETRY_ATTEMPTS:
                log(f"    [{label}] повтор через {RETRY_DELAY}с...")
                time.sleep(RETRY_DELAY)
    log_err(f"    [{label}] все попытки провалились")
    return None


def fetch_all_securities(session):
    """
    Возвращает список dict {ticker, name, lotSize, sectype} по акциям TQBR.
    Пагинация с защитой от дублей: останавливаемся, когда страница
    не приносит новых тикеров. Финальный список дедуплицируется.
    """
    url = f"{ISS_SECURITIES}/{BOARD}/securities.json"
    params = {
        "iss.meta": "off",
        "iss.only": "securities",
        "securities.columns": "SECID,SHORTNAME,LOTSIZE,SECTYPE",
    }

    all_rows = []
    columns = None
    start = 0
    page_num = 0
    seen_tickers = set()

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
            log_err(f"  список бумаг: битый JSON ({e})")
            break

        block = data.get("securities", {})
        page_cols = block.get("columns", [])
        page_rows = block.get("data", [])

        if columns is None:
            columns = page_cols
            log(f"  Колонки в ответе: {columns}")

        if not page_rows or columns is None:
            log(f"  Страница {page_num + 1}: пусто — конец пагинации")
            break

        page_num += 1

        # Смотрим, сколько НОВЫХ тикеров принесла страница
        page_tickers = set()
        for row in page_rows:
            d = dict(zip(columns, row))
            t = d.get("SECID")
            if t:
                page_tickers.add(t)

        new_tickers = page_tickers - seen_tickers
        log(
            f"  Страница {page_num}: {len(page_rows)} строк, "
            f"новых тикеров: {len(new_tickers)}"
        )

        # Если страница не добавила ничего нового — дальше идти смысла нет
        if page_num > 1 and not new_tickers:
            log(f"  → новых тикеров нет, пагинация исчерпана")
            break

        seen_tickers |= page_tickers
        all_rows.extend(page_rows)
        start += len(page_rows)

        if page_num >= 20:
            log_err(f"  Достигнут предохранитель в 20 страниц — прерываем")
            break

        time.sleep(0.2)

    if not all_rows or columns is None:
        return None

    log(f"  Всего строк от ISS: {len(all_rows)}")
    log(f"  Уникальных тикеров: {len(seen_tickers)}")

    # Дедупликация + фильтр по SECTYPE
    result = []
    dropped = 0
    deduped = 0
    seen = set()

    for row in all_rows:
        d = dict(zip(columns, row))
        ticker = d.get("SECID")
        if not ticker:
            continue
        if ticker in seen:
            deduped += 1
            continue
        seen.add(ticker)

        sectype = d.get("SECTYPE")
        try:
            sectype = int(sectype) if sectype is not None else None
        except (TypeError, ValueError):
            sectype = None

        if sectype is not None and sectype not in KEPT_SECTYPES:
            dropped += 1
            continue

        try:
            lot = int(d.get("LOTSIZE") or 1)
        except (TypeError, ValueError):
            lot = 1

        result.append({
            "ticker": ticker,
            "name": d.get("SHORTNAME") or ticker,
            "lotSize": lot,
            "sectype": sectype,
        })

    log(
        f"  Уникальных тикеров: {len(seen)}, "
        f"отдублировано: {deduped}, "
        f"оставлено акций: {len(result)} (отброшено ETF/паёв: {dropped})"
    )
    return result


def fetch_index_constituents(session, index_code):
    """Возвращает set(ticker) — актуальный состав индекса."""
    url = f"{ISS_ANALYTICS}/{index_code}.json"
    params = {"iss.meta": "off"}

    tickers = set()
    columns = None
    start = 0
    max_pages = 5
    latest_date = None

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
            row_date = d.get("tradedate")
            ticker = d.get("ticker")
            if not ticker:
                continue

            if latest_date is None:
                latest_date = row_date

            if row_date != latest_date:
                log(f"    [{index_code}] дошли до {row_date} — стоп")
                log(f"    [{index_code}] итог: {len(tickers)} бумаг на {latest_date}")
                return tickers

            tickers.add(ticker)

        pages += 1
        log(f"    [{index_code}] страница {pages}: {len(page_rows)} строк")
        start += len(page_rows)

        if len(page_rows) < 100:
            break
        if pages >= max_pages:
            break

        time.sleep(0.2)

    log(f"    [{index_code}] итог: {len(tickers)} бумаг")
    return tickers


def assign_sectors(securities, session):
    """dict {ticker: sector_name}."""
    sectors = {s["ticker"]: DEFAULT_SECTOR for s in securities}
    valid_tickers = set(sectors.keys())

    for index_code, sector_name in SECTOR_INDICES.items():
        log(f"  [{index_code}] тянем состав индекса...")
        constituents = fetch_index_constituents(session, index_code)

        if not constituents:
            log(f"    → пусто (индекс недоступен или нет данных)")
            continue

        assigned = 0
        for ticker in constituents:
            if ticker in valid_tickers and sectors[ticker] == DEFAULT_SECTOR:
                sectors[ticker] = sector_name
                assigned += 1

        log(f"    → {len(constituents)} бумаг в индексе, {assigned} размечено как «{sector_name}»")

    override_applied = 0
    for ticker, sector in SECTORS_OVERRIDE.items():
        if ticker in valid_tickers:
            sectors[ticker] = sector
            override_applied += 1
    if override_applied:
        log(f"  Override: применено {override_applied} правил")

    return sectors


def main() -> int:
    OUTPUT_DIR.mkdir(exist_ok=True)

    with requests.Session() as session:
        session.headers.update({
            "User-Agent": "trading-signals-mvp/1.0",
            "Accept": "application/json",
        })

        log("=== Загрузка списка бумаг TQBR ===")
        securities = fetch_all_securities(session)
        if not securities:
            log_err("Не удалось получить список бумаг TQBR")
            return 1

        log(f"  Итого акций: {len(securities)}")

        log("\n=== Разметка отраслей ===")
        sectors = assign_sectors(securities, session)

        counter = Counter(sectors.values())
        log("\n=== Распределение по отраслям ===")
        for sector, count in counter.most_common():
            log(f"  {sector}: {count}")

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
    log(f"\nГотово. Записано: {OUTPUT_FILE} ({len(payload['tickers'])} бумаг, ~{size_kb:.1f} КБ)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
