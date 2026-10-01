"""
Скачивает дневные свечи с MOEX ISS напрямую через requests.
Сохраняет в data/{ticker}.json в формате Lightweight Charts.
"""

import json
import sys
import time
from datetime import date
from pathlib import Path

import pandas as pd
import requests

# ===== Конфигурация =====
TICKERS = ["SBER", "GAZP", "LKOH", "GMKN", "ROSN", "NVTK"]
BOARD = "TQBR"
START_DATE = "2023-01-01"
OUTPUT_DIR = Path("data")

# Явно указываем, какие колонки тянем с ISS
COLUMNS = "TRADEDATE,OPEN,HIGH,LOW,CLOSE,VOLUME"

# Праздники РФ, когда торгов нет вообще (МСК)
MARKET_HOLIDAYS = {
    (1, 1), (1, 2), (1, 7), (3, 8), (5, 9), (12, 31),
}

ISS_BASE = "https://iss.moex.com/iss/history/engines/stock/markets/shares/boards"


def is_trading_day(d: date) -> bool:
    return (d.month, d.day) not in MARKET_HOLIDAYS


def fetch_ticker(session: requests.Session, ticker: str) -> list[dict] | None:
    """Постранично скачивает всю историю по тикеру."""
    url = f"{ISS_BASE}/{BOARD}/securities/{ticker}.json"
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
        try:
            resp = session.get(url, params=params, timeout=30)
            resp.raise_for_status()
        except Exception as e:
            print(f"  [{ticker}] ошибка запроса: {e}", file=sys.stderr)
            return None

        block = resp.json().get("history", {})
        page_cols = block.get("columns", [])
        page_rows = block.get("data", [])

        if columns is None:
            columns = page_cols

        if not page_rows:
            break

        all_rows.extend(page_rows)
        start += len(page_rows)

        # ISS отдаёт максимум 100 строк за раз.
        # Если пришло меньше — это была последняя страница.
        if len(page_rows) < 100:
            break

        time.sleep(0.2)  # вежливая пауза, чтобы не долбить ISS

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

    written = 0
    with requests.Session() as session:
        session.headers.update({"User-Agent": "trading-signals-mvp/1.0"})
        for ticker in TICKERS:
            print(f"[{ticker}] тянем...", flush=True)
            rows = fetch_ticker(session, ticker)
            if rows is None:
                continue

            out_path = OUTPUT_DIR / f"{ticker}.json"
            out_path.write_text(
                json.dumps(rows, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"  [{ticker}] сохранено {len(rows)} баров → {out_path}", flush=True)
            written += 1

    print(f"\nГотово. Обновлено тикеров: {written}/{len(TICKERS)}", flush=True)
    return 0 if written > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
