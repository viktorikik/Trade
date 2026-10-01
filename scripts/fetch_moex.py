"""
Скачивает дневные свечи с MOEX ISS через apimoex.
Сохраняет в data/{ticker}.json в формате, который ест Lightweight Charts.

Запускается из GitHub Actions каждые 15 минут в торговые часы.
Защищён от пустых ответов и нерабочих дней.
"""

import json
import sys
from datetime import date
from pathlib import Path

import apimoex
import pandas as pd
import requests

# ===== Конфигурация =====
TICKERS = ["SBER", "GAZP", "LKOH", "GMKN", "ROSN", "NVTK"]
BOARD = "TQBR"
START_DATE = "2023-01-01"
OUTPUT_DIR = Path("data")

# Праздники РФ, когда торгов нет вообще (МСК)
MARKET_HOLIDAYS = {
    (1, 1), (1, 2), (1, 7), (3, 8), (5, 9), (12, 31),
}

# ===== Утилиты =====
def is_trading_day(d: date) -> bool:
    """
    Грубая проверка: сегодня не 1-2 января, не 7 января и т.п.
    Полный календарь MOEX тут не нужен — если данных нет,
    apimoex просто вернёт пустой список, и мы это обработаем.
    """
    if (d.month, d.day) in MARKET_HOLIDAYS:
        return False
    return True


def fetch_ticker(session: requests.Session, ticker: str) -> list[dict] | None:
    """Скачивает историю по одному тикеру. Возвращает список словарей или None."""
    try:
        data = apimoex.get_board_history(
            session,
            ticker,
            board=BOARD,
            start=START_DATE,
        )
    except Exception as e:
        print(f"  [{ticker}] ошибка запроса: {e}", file=sys.stderr)
        return None

    if not data:
        print(f"  [{ticker}] пустой ответ (нет торгов?)")
        return None

    df = pd.DataFrame(data)

    # Оставляем только нужные колонки, переименовываем под Lightweight Charts
    required = ["TRADEDATE", "OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        print(f"  [{ticker}] нет колонок: {missing}", file=sys.stderr)
        return None

    df = df[required].copy()
    df.columns = ["time", "open", "high", "low", "close", "volume"]
    df = df.dropna(subset=["open", "high", "low", "close"])

    # Lightweight Charts хочет time как строку YYYY-MM-DD
    df["time"] = pd.to_datetime(df["time"]).dt.strftime("%Y-%m-%d")

    # Приводим числовые поля к float, volume к int
    for col in ["open", "high", "low", "close"]:
        df[col] = df[col].astype(float).round(4)
    df["volume"] = pd.to_numeric(df["volume"], errors="coerce").fillna(0).astype(int)

    # Сортируем по дате на всякий случай
    df = df.sort_values("time").reset_index(drop=True)

    return df.to_dict(orient="records")


# ===== Main =====
def main() -> int:
    today = date.today()
    if not is_trading_day(today):
        print(f"{today}: праздник, пропускаем")
        return 0

    OUTPUT_DIR.mkdir(exist_ok=True)

    written = 0
    with requests.Session() as session:
        for ticker in TICKERS:
            print(f"[{ticker}] тянем...")
            rows = fetch_ticker(session, ticker)
            if rows is None:
                continue

            out_path = OUTPUT_DIR / f"{ticker}.json"
            out_path.write_text(
                json.dumps(rows, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"  [{ticker}] сохранено {len(rows)} баров → {out_path}")
            written += 1

    print(f"\nГотово. Обновлено тикеров: {written}/{len(TICKERS)}")
    # Если не удалось обновить ни одного — вернём ошибку, чтобы Action упал
    return 0 if written > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
