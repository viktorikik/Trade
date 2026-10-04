"""
Скачивает дневные свечи с MOEX ISS для всех тикеров из data/tickers.json,
дивиденды и фундаментал со Smart-Lab (умная ротация: 6 приоритетных + 25 из
дневной группы), макро-контекст (IMOEX, USD/RUB, ключевая ставка).
Сохраняет в data/{ticker}.json и data/macro.json.

Список тикеров берётся из data/tickers.json (генерится fetch_metadata.py).
Если файла нет — используем FALLBACK_TICKERS (6 бумаг).

ДИВИДЕНДЫ И ФУНДАМЕНТАЛ — ПО УМНОЙ РОТАЦИИ:
  — 6 приоритетных (SBER, GAZP, LKOH, GMKN, ROSN, NVTK) обновляются КАЖДЫЙ день.
  — Остальные 469 бумаг разбиты на группы по 25 (~19 групп).
  — Каждый прогон обрабатывается ОДНА группа.
  — Порядок: сначала популярные (из SECTORS_OVERRIDE в fetch_metadata.py),
    потом — все остальные по алфавиту.
  — Указатель «где мы сейчас» хранится в data/smartlab-rotation.json.
  — Полный цикл — ~19 дней. Потом начинается заново.

ЗАЩИТА ОТ РЕГРЕССИИ:
  Если тикер НЕ в текущей дневной группе — его dividends и fundamentals
  берутся из старого JSON-файла, а не перезаписываются пустыми.
  Так данные для тикеров, которые уже прошли ротацию, не теряются.

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
from fetch_metadata import SECTORS_OVERRIDE

# ===== Конфигурация =====
BOARD = "TQBR"
START_DATE = "2023-01-01"
OUTPUT_DIR = Path("data")
TICKERS_FILE = OUTPUT_DIR / "tickers.json"
ROTATION_STATE_FILE = OUTPUT_DIR / "smartlab-rotation.json"

# Если tickers.json не найден или битый — берём эти тикеры.
FALLBACK_TICKERS = ["SBER", "GAZP", "LKOH", "GMKN", "ROSN", "NVTK"]

# Приоритетные бумаги — обновляем КАЖДЫЙ прогон.
PRIORITY_TICKERS = ["SBER", "GAZP", "LKOH", "GMKN", "ROSN", "NVTK"]

# Размер дневной группы ротации (без приоритетных).
ROTATION_GROUP_SIZE = 25

COLUMNS = "TRADEDATE,OPEN,HIGH,LOW,CLOSE,VOLUME"

MARKET_HOLIDAYS = {
    (1, 1), (1, 2), (1, 7), (3, 8), (5, 9), (12, 31),
}

ISS_BASE = "https://iss.moex.com/iss"
ISS_HISTORY = f"{ISS_BASE}/history/engines/stock/markets/shares/boards"
ISS_SECURITIES = f"{ISS_BASE}/engines/stock/markets/shares/boards"

# Таймауты и retry
REQUEST_TIMEOUT = 15
RETRY_ATTEMPTS = 2
RETRY_DELAY = 3

# Сплиты (дробления акций)
SPLITS = {
    "GMKN": [
        {"date": "2024-04-04", "ratio": 100},
    ],
}


def is_trading_day(d: date) -> bool:
    return (d.month, d.day) not in MARKET_HOLIDAYS


def load_tickers() -> list[str]:
    """Читает тикеры из data/tickers.json. При отсутствии/ошибке — fallback."""
    if not TICKERS_FILE.exists():
        print(
            f"  {TICKERS_FILE} не найден — используем fallback "
            f"({len(FALLBACK_TICKERS)} бумаг)",
            flush=True,
        )
        return list(FALLBACK_TICKERS)

    try:
        payload = json.loads(TICKERS_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(
            f"  {TICKERS_FILE} битый ({e}) — используем fallback",
            file=sys.stderr,
            flush=True,
        )
        return list(FALLBACK_TICKERS)

    raw = payload.get("tickers", [])
    tickers = [t["ticker"] for t in raw if isinstance(t, dict) and t.get("ticker")]

    if not tickers:
        print(
            f"  {TICKERS_FILE} пустой — используем fallback",
            file=sys.stderr,
            flush=True,
        )
        return list(FALLBACK_TICKERS)

    print(f"  Загружено {len(tickers)} тикеров из {TICKERS_FILE}", flush=True)
    return tickers


# ============================================================
# РОТАЦИЯ SMART-LAB
# ============================================================

def load_rotation_state() -> dict:
    """Читает состояние ротации. Если файла нет — начальное состояние."""
    if not ROTATION_STATE_FILE.exists():
        return {"lastGroupIndex": -1, "totalGroups": 0}
    try:
        return json.loads(ROTATION_STATE_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  rotation state error ({e}) — начинаем с нуля", file=sys.stderr, flush=True)
        return {"lastGroupIndex": -1, "totalGroups": 0}


def save_rotation_state(state: dict) -> None:
    """Записывает состояние ротации в файл."""
    ROTATION_STATE_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def build_rotation_order(all_tickers: list[str]) -> list[str]:
    """
    Список тикеров в порядке обхода ротации.
    Сначала — популярные (в порядке SECTORS_OVERRIDE), потом — остальные по алфавиту.
    Приоритетные (PRIORITY_TICKERS) исключаются — они обновляются отдельно.
    """
    all_set = set(all_tickers)
    priority_set = set(PRIORITY_TICKERS)
    popular_set = set(SECTORS_OVERRIDE.keys())

    # Популярные — в порядке, в котором они перечислены в SECTORS_OVERRIDE
    popular_ordered = [
        t for t in SECTORS_OVERRIDE.keys()
        if t in all_set and t not in priority_set
    ]

    # Остальные — по алфавиту
    rest = sorted([
        t for t in all_tickers
        if t not in popular_set and t not in priority_set
    ])

    return popular_ordered + rest


def get_today_smartlab_batch(all_tickers: list[str]) -> tuple[list[str], dict]:
    """
    Определяет, какие тикеры качать сегодня.
    Возвращает (batch, new_state) — batch без дублей, state для сохранения.
    """
    order = build_rotation_order(all_tickers)

    if not order:
        # Некуда ротировать — только приоритетные
        return list(PRIORITY_TICKERS), {
            "lastGroupIndex": -1,
            "totalGroups": 0,
            "groupSize": ROTATION_GROUP_SIZE,
            "lastRunAt": date.today().isoformat(),
            "totalTickersInRotation": 0,
        }

    total_groups = (len(order) + ROTATION_GROUP_SIZE - 1) // ROTATION_GROUP_SIZE
    state = load_rotation_state()
    last = state.get("lastGroupIndex", -1)

    next_group = last + 1
    if next_group >= total_groups:
        # Цикл завершён — начинаем сначала
        next_group = 0

    start = next_group * ROTATION_GROUP_SIZE
    end = start + ROTATION_GROUP_SIZE
    batch = order[start:end]

    new_state = {
        "lastGroupIndex": next_group,
        "totalGroups": total_groups,
        "groupSize": ROTATION_GROUP_SIZE,
        "lastRunAt": date.today().isoformat(),
        "totalTickersInRotation": len(order),
    }

    return list(PRIORITY_TICKERS) + batch, new_state


# ============================================================
# MOEX ISS
# ============================================================

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
                    flush=True,
                )
                time.sleep(RETRY_DELAY)
    print(
        f"    [{label}] все {RETRY_ATTEMPTS} попытки провалились: {last_err}",
        file=sys.stderr,
        flush=True,
    )
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

    try:
        block = resp.json().get("securities", {})
    except Exception:
        return {"lotSize": 1, "name": ticker, "ok": False}

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
    page_num = 0
    max_pages = 20  # предохранитель: 20 страниц × 100 = 2000 баров, хватит с запасом

    while page_num < max_pages:
        params = {
            "from": START_DATE,
            "iss.meta": "off",
            "history.columns": COLUMNS,
            "start": start,
        }
        resp = _get_with_retry(session, url, params, f"{ticker} candles start={start}")
        if resp is None:
            if start == 0:
                return None
            print(
                f"    [{ticker}] оборвались на странице start={start}, "
                f"уже собрано {len(all_rows)} строк",
                file=sys.stderr,
                flush=True,
            )
            break

        try:
            block = resp.json().get("history", {})
        except Exception:
            if start == 0:
                return None
            break

        page_cols = block.get("columns", [])
        page_rows = block.get("data", [])

        if columns is None:
            columns = page_cols

        if not page_rows:
            break

        all_rows.extend(page_rows)
        page_num += 1
        start += len(page_rows)

        if len(page_rows) < 100:
            break

        time.sleep(0.1)  # небольшая пауза между страницами

    if not all_rows or columns is None:
        print(f"  [{ticker}] пустой ответ (нет торгов?)", file=sys.stderr, flush=True)
        return None

    df = pd.DataFrame(all_rows, columns=columns)

    required = ["TRADEDATE", "OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        print(f"  [{ticker}] в ответе нет колонок: {missing}", file=sys.stderr, flush=True)
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


# ============================================================
# ГЛАВНОЕ
# ============================================================

def main() -> int:
    today = date.today()
    if not is_trading_day(today):
        print(f"{today}: праздник, пропускаем", flush=True)
        return 0

    OUTPUT_DIR.mkdir(exist_ok=True)

    print("=== Загрузка списка тикеров ===", flush=True)
    tickers = load_tickers()
    total = len(tickers)

    # ---------- Определение дневной группы Smart-Lab ----------
    print("\n=== Определение дневной группы Smart-Lab ===", flush=True)
    smartlab_batch, new_rotation_state = get_today_smartlab_batch(tickers)
    rotation_tickers = [t for t in smartlab_batch if t not in PRIORITY_TICKERS]
    print(
        f"  Приоритетные: {len(PRIORITY_TICKERS)} ({', '.join(PRIORITY_TICKERS)})",
        flush=True,
    )
    print(f"  Из ротации: {len(rotation_tickers)}", flush=True)
    print(f"  Всего на сегодня: {len(smartlab_batch)}", flush=True)
    if new_rotation_state["totalGroups"] > 0:
        print(
            f"  Группа {new_rotation_state['lastGroupIndex'] + 1} "
            f"из {new_rotation_state['totalGroups']} "
            f"(всего в ротации: {new_rotation_state['totalTickersInRotation']} бумаг)",
            flush=True,
        )

    # ---------- Дивиденды ----------
    print("\n=== Загрузка дивидендов со Smart-Lab ===", flush=True)
    try:
        dividends_map = fetch_dividends_smartlab(smartlab_batch, START_DATE)
    except Exception as e:
        print(f"  [dividends] непредвиденная ошибка: {e}", file=sys.stderr, flush=True)
        dividends_map = {}

    # ---------- Фундаментал ----------
    print("\n=== Загрузка фундаментала со Smart-Lab ===", flush=True)
    try:
        fundamentals_map = fetch_fundamentals_smartlab(smartlab_batch)
    except Exception as e:
        print(f"  [fundamentals] непредвиденная ошибка: {e}", file=sys.stderr, flush=True)
        fundamentals_map = {}

    # ---------- Макро ----------
    print("\n=== Загрузка макро-контекста ===", flush=True)
    try:
        fetch_macro_main()
    except Exception as e:
        print(f"  [macro] непредвиденная ошибка: {e}", file=sys.stderr, flush=True)

    # ---------- Свечи ----------
    print(f"\n=== Загрузка свечей для {total} тикеров ===", flush=True)
    print(f"  Оценка времени: ~13-15 минут (включая ротацию)\n", flush=True)

    written = 0
    skipped = 0
    t_start = time.time()
    batch_set = set(smartlab_batch)  # быстрый lookup

    with requests.Session() as session:
        session.headers.update({"User-Agent": "trading-signals-mvp/1.0"})

        for i, ticker in enumerate(tickers, start=1):
            t_ticker = time.time()

            info = fetch_security_info(session, ticker)
            candles = fetch_candles(session, ticker)

            if candles is None:
                print(
                    f"[{i}/{total}] [{ticker}] ✗ свечи не получены — пропускаем",
                    file=sys.stderr,
                    flush=True,
                )
                skipped += 1
                continue

            out_path = OUTPUT_DIR / f"{ticker}.json"

            # ---------- Загружаем СТАРЫЙ JSON для сохранения данных ----------
            existing = {}
            if out_path.exists():
                try:
                    existing = json.loads(out_path.read_text(encoding="utf-8"))
                except Exception:
                    existing = {}

            # ---------- Дивиденды / фундаментал ----------
            if ticker in batch_set:
                # Этот тикер сегодня в дневной группе — обновляем
                dividends = dividends_map.get(ticker, [])
                fundamentals = fundamentals_map.get(ticker)

                # Если парсер не отдал данные, но в старом JSON они были — сохраняем старые
                if not dividends and existing.get("dividends"):
                    dividends = existing["dividends"]
                if fundamentals is None and existing.get("fundamentals"):
                    fundamentals = existing["fundamentals"]
            else:
                # Не в дневной группе — сохраняем из старого JSON
                dividends = existing.get("dividends", [])
                fundamentals = existing.get("fundamentals")

            splits = SPLITS.get(ticker, [])

            if not info.get("ok", True):
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

            out_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            written += 1
            dt_ticker = time.time() - t_ticker

            # Короткий тег — что обновилось именно сегодня
            tags = []
            if ticker in PRIORITY_TICKERS:
                tags.append("приоритет")
            elif ticker in batch_set:
                tags.append("ротация")
            if fundamentals:
                tags.append(f"фунд:{len(fundamentals.get('metrics', {}))}")
            if dividends:
                tags.append(f"див:{len(dividends)}")
            tag_str = f" [{' · '.join(tags)}]" if tags else ""

            print(
                f"[{i}/{total}] [{ticker}] ✓ {info['name']} · "
                f"{len(candles)} баров · {dt_ticker:.1f}с{tag_str}",
                flush=True,
            )

            # Прогресс каждые 25 бумаг
            if i % 25 == 0:
                elapsed = time.time() - t_start
                avg = elapsed / i
                remaining = avg * (total - i)
                print(
                    f"\n>>> Прогресс: {i}/{total} "
                    f"(обновлено: {written}, пропущено: {skipped}, "
                    f"прошло: {elapsed/60:.1f} мин, осталось ~{remaining/60:.1f} мин)\n",
                    flush=True,
                )

    # ---------- Сохраняем состояние ротации ----------
    try:
        save_rotation_state(new_rotation_state)
        print(
            f"\n=== Ротация сохранена: "
            f"группа {new_rotation_state['lastGroupIndex'] + 1} "
            f"из {new_rotation_state['totalGroups']} → {ROTATION_STATE_FILE}",
            flush=True,
        )
    except Exception as e:
        print(f"  [rotation] ошибка сохранения: {e}", file=sys.stderr, flush=True)

    elapsed_total = time.time() - t_start
    print(
        f"\n=== Готово ==="
        f"\n  Обновлено: {written}/{total}"
        f"\n  Пропущено: {skipped}"
        f"\n  Время: {elapsed_total/60:.1f} мин",
        flush=True,
    )
    return 0 if written > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
