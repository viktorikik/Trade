"""
Скачивает дневные свечи с MOEX ISS, дивиденды и фундаментал со Smart-Lab,
макро-контекст (IMOEX, USD/RUB, ключевая ставка).
Сохраняет в data/{ticker}.json и data/macro.json.

Все запросы к MOEX ISS — с retry и уменьшенным timeout (15 сек).
Если тикер не загрузился после 2 попыток — пропускаем его,
старый JSON остаётся нетронутым.
"""

import json
import sys
import time
from datetime import date
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parent))
from fetch_dividends_smartlab import fetch_all as fetch_dividends_smartlab
from fetch_fundamentals_smartlab import fetch_all as fetch_fundamentals_smartlab
from fetch_macro import main as fetch_macro_main

# ===== Конфигурация =====
TICKERS = ["SBER", "GAZP", "LKOH", "GMKN", "ROSN", "NVTK"]
BOARD = "TQBR"
START_DATE = "2023-01-01"
OUTPUT_DIR = Path("data")

COLUMNS = "TRADEDATE,OPEN,HIGH,LOW,CLOSE,VOLUME"

MARKET_HOLIDAYS = {
    (1, 1), (1, 2), (1, 7), (3, 8), (5, 9), (12, 31),
}

ISS_BASE = "https://iss.moex.com/iss"
ISS_HISTORY = f"{ISS_BASE}/history/engines/stock/markets/shares/boards"
ISS_SECURITIES = f"{ISS_BASE}/engines/stock/markets/shares/boards"

# Таймауты и retry
REQUEST_TIMEOUT = 15          # секунд на один запрос
RETRY_ATTEMPTS = 2            # всего попыток (1 изначальная + 1 повторная)
RETRY_DELAY = 3               # пауза между попытками

# ===== Сплиты (дробления акций) =====
SPLITS = {
    "GMKN": [
        {"date": "2024-04-04", "ratio": 100},
    ],
}


def is_trading_day(d: date) -> bool:
    return (d.month, d.day) not in MARKET_HOLIDAYS


def _get_with_retry(session, url, params, label):
    """
    Делает GET с retry. Возвращает Response или None.
    Логирует каждую неудачную попытку.
    """
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
    print(f"    [{label}] все {RETRY_ATTEMPTS} попытки провалились: {last_err}", file=sys.stderr)
    return None


def fetch_security_info(session: requests.Session, ticker: str) -> dict:
    url = f"{ISS_SECURITIES}/{BOARD}/securities/{ticker}.json"
    params = {
        "iss.meta": "off",
        "securities.columns": "SECID,SHORTNAME,LOTSIZE",
    }
    resp = _get_with_retry(session, url, params, f"{ticker} meta")
    if resp is None:
        return {"lotSize": 1, "name": ticker, "ok": False}

    block = resp.json().get("securities", {})
    cols = block.get("columns", [])
    rows = block.get("data", [])
    if not rows:
        return {"lotSize": 1, "name": ticker, "ok": False}

    d = dict(zip(cols, rows[0]))
    lot_size = d.get("LOTSIZE") or 1
    try:
        lot_size = int(lot_size)
    except (TypeError, ValueError):
        lot_size = 1

    return {"lotSize": lot_size, "name": d.get("SHORTNAME") or ticker, "ok": True}


def fetch_candles(session: requests.Session, ticker: str) -> list[dict] | None:
    url = f"{ISS_HISTORY}/{BOARD}/securities/{ticker}.json"
    all_rows: list[list] = []
    columns: list[str] | None = None
    start = 0

    while True:
        params = {
            "from": START_DATE,
            "iss.meta": "off",
            "history.columns": COLUMNS,
            "start": start,
        }
        resp = _get_with_retry(session, url, params, f"{ticker} candles start={start}")
        if resp is None:
            # Если не получили даже первую страницу — совсем плохо
            if start == 0:
                return None
            # Если не получили следующую — возвращаем то, что успели
            print(
                f"    [{ticker}] оборвались на странице start={start}, "
                f"уже собрано {len(all_rows)} строк",
                file=sys.stderr,
            )
            break

        block = resp.json().get("history", {})
        page_cols = block.get("columns", [])
        page_rows = block.get("data", [])

        if columns is None:
            columns = page_cols

        if not page_rows:
            break

        all_rows.extend(page_rows)
        start += len(page_rows)

        if len(page_rows) < 100:
            break

        time.sleep(0.2)

    if not all_rows or columns is None:
        print(f"  [{ticker}] пустой ответ (нет торгов?)", file=sys.stderr)
        return None

    df = pd.DataFrame(all_rows, columns=columns)

    required = ["TRADEDATE", "OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        print(f"  [{ticker}] в ответе нет колонок: {missing}", file=sys.stderr)
        print(f"  [{ticker}] фактические колонки: {list(df.columns)}", file=sys.stderr)
        return None

    df = df[required].copy()
    df = df.dropna(subset=["OPEN", "HIGH", "LOW", "CLOSE"])
    df = df.rename(columns={
        "TRADEDATE": "time",
        "OPEN": "open",
        "HIGH": "high",
        "LOW": "low",
        "CLOSE": "close",
        "VOLUME": "volume",
    })

    df["time"] = pd.to_datetime(df["time"]).dt.strftime("%Y-%m-%d")
    for col in ["open", "high", "low", "close"]:
        df[col] = df[col].astype(float).round(4)
    df["volume"] = pd.to_numeric(df["volume"], errors="coerce").fillna(0).astype(int)

    df = df.sort_values("time").reset_index(drop=True)
    return df.to_dict(orient="records")


def main() -> int:
    today = date.today()
    if not is_trading_day(today):
        print(f"{today}: праздник, пропускаем")
        return 0

    OUTPUT_DIR.mkdir(exist_ok=True)

    print("=== Загрузка дивидендов со Smart-Lab ===", flush=True)
    dividends_map = fetch_dividends_smartlab(TICKERS, START_DATE)

    print("\n=== Загрузка фундаментала со Smart-Lab ===", flush=True)
    fundamentals_map = fetch_fundamentals_smartlab(TICKERS)

    print("\n=== Загрузка макро-контекста ===", flush=True)
    try:
        fetch_macro_main()
    except Exception as e:
        print(f"  [macro] непредвиденная ошибка: {e}", file=sys.stderr)

    written = 0
    skipped = 0
    with requests.Session() as session:
        session.headers.update({"User-Agent": "trading-signals-mvp/1.0"})

        for ticker in TICKERS:
            print(f"\n[{ticker}] тянем метаданные...", flush=True)
            info = fetch_security_info(session, ticker)

            print(f"[{ticker}] тянем свечи...", flush=True)
            candles = fetch_candles(session, ticker)
            if candles is None:
                print(
                    f"  [{ticker}] свечи не получены — старый JSON не трогаем",
                    file=sys.stderr,
                )
                skipped += 1
                continue

            dividends = dividends_map.get(ticker, [])
            splits = SPLITS.get(ticker, [])
            fundamentals = fundamentals_map.get(ticker)

            # Если метаданные не получились, но свечи есть — берём имя как есть
            if not info.get("ok", True) and len(candles) > 0:
                print(
                    f"  [{ticker}] метаданные не получены, используем имя={ticker}, лот=1",
                    file=sys.stderr,
                )
                info = {"lotSize": 1, "name": ticker, "ok": False}

            payload = {
                "ticker": ticker,
                "name": info["name"],
                "lotSize": info["lotSize"],
                "candles": candles,
                "dividends": dividends,
                "splits": splits,
                "fundamentals": fundamentals,
            }

            out_path = OUTPUT_DIR / f"{ticker}.json"
            out_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            fund_info = (
                f"фундаментал: {len(fundamentals['metrics'])} метрик (asOf={fundamentals['asOf']})"
                if fundamentals
                else "фундаментал: не получен"
            )
            print(
                f"  [{ticker}] {info['name']} · лот {info['lotSize']} · "
                f"{len(candles)} баров · {len(dividends)} дивидендов · "
                f"{len(splits)} сплитов · {fund_info} → {out_path}",
                flush=True,
            )
            written += 1

    print(
        f"\nГотово. Обновлено тикеров: {written}/{len(TICKERS)}"
        + (f", пропущено: {skipped}" if skipped else ""),
        flush=True,
    )
    return 0 if written > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
