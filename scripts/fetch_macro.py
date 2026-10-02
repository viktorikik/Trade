"""
Загружает макро-контекст: IMOEX, USD/RUB фиксинг, ключевую ставку ЦБ РФ.
Сохраняет в data/macro.json.
"""

import io
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import requests

OUTPUT_PATH = Path("data/macro.json")
START_DATE = "2023-01-01"

ISS_BASE = "https://iss.moex.com/iss"
ISS_IMOEX = f"{ISS_BASE}/history/engines/stock/markets/index/securities/IMOEX.json"
ISS_USD = f"{ISS_BASE}/history/engines/currency/markets/index/securities/USDFIXME.json"

CBR_KEYRATE_URL = "https://www.cbr.ru/hd_base/KeyRate/"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "ru-RU,ru;q=0.9",
}

# Санити-порог для ключевой ставки: исторически она никогда
# не превышала 20% (даже в кризисы). Всё, что выше 100, — точно баг парсинга.
MAX_REASONABLE_RATE = 100.0


def _fetch_iss_history_paginated(session, url, label):
    """
    Тянет всю историю с ISS с пагинацией.
    ISS отдаёт по 100 строк за раз, нужно докручивать start.
    Возвращает [{time, close}, ...] или None.
    """
    all_rows = []
    columns = None
    start = 0

    while True:
        params = {
            "from": START_DATE,
            "iss.meta": "off",
            "history.columns": "TRADEDATE,CLOSE",
            "start": start,
        }
        try:
            resp = session.get(url, params=params, timeout=30)
            resp.raise_for_status()
        except Exception as e:
            print(f"  [{label}] ошибка запроса: {e}", file=sys.stderr)
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

        # Если страница неполная — это последняя, выходим
        if len(page_rows) < 100:
            break

        time.sleep(0.2)

    if not all_rows or columns is None:
        print(f"  [{label}] пустой ответ", file=sys.stderr)
        return None

    df = pd.DataFrame(all_rows, columns=columns)
    df = df.dropna(subset=["CLOSE"])
    df = df.rename(columns={"TRADEDATE": "time", "CLOSE": "close"})
    df["time"] = pd.to_datetime(df["time"]).dt.strftime("%Y-%m-%d")
    df["close"] = df["close"].astype(float).round(4)
    df = df[["time", "close"]].sort_values("time").reset_index(drop=True)
    return df.to_dict(orient="records")


def fetch_imoex(session):
    return _fetch_iss_history_paginated(session, ISS_IMOEX, "IMOEX")


def fetch_usdrub(session):
    return _fetch_iss_history_paginated(session, ISS_USD, "USD/RUB")


def _parse_rate_value(raw):
    """
    Парсит значение ставки из ячейки.
    Возвращает float или None.
    """
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None

    s = str(raw).strip()
    s = s.replace("%", "").replace("\xa0", "").replace(" ", "")
    s = s.replace(",", ".")

    # Убираем всё, кроме цифр, точки и минуса
    import re
    s = re.sub(r"[^\d.\-]", "", s)

    if not s or s in ("-", ".", "-."):
        return None

    try:
        val = float(s)
    except ValueError:
        return None

    # Санити-фильтр: ключевая ставка не может быть > 100% или <= 0
    if not (0 < val < MAX_REASONABLE_RATE):
        return None

    return val


def fetch_key_rate():
    """Тянет историю ключевой ставки ЦБ через HTML-таблицу."""
    params = {
        "UniDbQuery.Posted": "True",
        "UniDbQuery.From": "01.01.2023",
        "UniDbQuery.To": date.today().strftime("%d.%m.%Y"),
    }
    try:
        resp = requests.get(CBR_KEYRATE_URL, params=params, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"  [KeyRate] ошибка запроса: {e}", file=sys.stderr)
        return None

    try:
        tables = pd.read_html(io.StringIO(resp.text), header=0)
    except Exception as e:
        print(f"  [KeyRate] pandas не нашёл таблиц: {e}", file=sys.stderr)
        return None

    print(f"  [KeyRate] найдено таблиц: {len(tables)}", flush=True)

    for i, df in enumerate(tables):
        # Убираем возможные многоуровневые заголовки — оставляем как есть
        cols_lower = [str(c).strip().lower() for c in df.columns]

        # Ищем таблицу, где есть и 'дата', и 'ставка'
        if "дата" not in cols_lower or "ставка" not in cols_lower:
            continue

        print(f"  [KeyRate] таблица #{i}: колонки = {list(df.columns)}", flush=True)
        print(f"  [KeyRate] первые 3 строки:", flush=True)
        for j, row in df.head(3).iterrows():
            print(f"    {dict(row)}", flush=True)

        date_col = df.columns[cols_lower.index("дата")]
        rate_col = df.columns[cols_lower.index("ставка")]

        result = []
        skipped = 0
        for _, row in df.iterrows():
            d_raw = row[date_col]
            r_raw = row[rate_col]
            if pd.isna(d_raw) or pd.isna(r_raw):
                continue
            try:
                d_obj = pd.to_datetime(str(d_raw).strip(), format="%d.%m.%Y")
            except Exception:
                continue

            rate_val = _parse_rate_value(r_raw)
            if rate_val is None:
                skipped += 1
                continue

            result.append({
                "date": d_obj.strftime("%Y-%m-%d"),
                "rate": rate_val,
            })

        if skipped > 0:
            print(f"  [KeyRate] пропущено (не прошли валидацию): {skipped}", flush=True)

        result.sort(key=lambda x: x["date"])
        if result:
            print(
                f"  [KeyRate] взято {len(result)} точек, "
                f"первая: {result[0]['date']} @ {result[0]['rate']}%, "
                f"последняя: {result[-1]['date']} @ {result[-1]['rate']}%",
                flush=True,
            )
        return result

    print("  [KeyRate] таблица с 'Дата'/'Ставка' не найдена", file=sys.stderr)
    return None


def compute_changes(history):
    """Изменение в % за день, месяц (30д), год (365д)."""
    if not history or len(history) < 2:
        return {"day": None, "month": None, "year": None}

    last = history[-1]["close"]
    last_date = pd.to_datetime(history[-1]["time"])

    def pct_at(target_date):
        candidates = [h for h in history if pd.to_datetime(h["time"]) <= target_date]
        if not candidates:
            return None
        ref = candidates[-1]["close"]
        if ref == 0:
            return None
        return round((last / ref - 1) * 100, 2)

    return {
        "day": pct_at(last_date - timedelta(days=1)),
        "month": pct_at(last_date - timedelta(days=30)),
        "year": pct_at(last_date - timedelta(days=365)),
    }


def main():
    OUTPUT_PATH.parent.mkdir(exist_ok=True)

    with requests.Session() as session:
        session.headers.update({"User-Agent": "trading-signals-mvp/1.0"})

        print("=== Загрузка IMOEX ===", flush=True)
        imoex = fetch_imoex(session)
        if imoex:
            print(
                f"  [IMOEX] {len(imoex)} точек, "
                f"первая: {imoex[0]['time']} @ {imoex[0]['close']}, "
                f"последняя: {imoex[-1]['time']} @ {imoex[-1]['close']}",
                flush=True,
            )
        time.sleep(0.5)

        print("\n=== Загрузка USD/RUB ===", flush=True)
        usdrub = fetch_usdrub(session)
        if usdrub:
            print(
                f"  [USD/RUB] {len(usdrub)} точек, "
                f"первая: {usdrub[0]['time']} @ {usdrub[0]['close']}, "
                f"последняя: {usdrub[-1]['time']} @ {usdrub[-1]['close']}",
                flush=True,
            )

    print("\n=== Загрузка ключевой ставки ЦБ ===", flush=True)
    keyrate = fetch_key_rate()

    payload = {
        "updatedAt": date.today().isoformat(),
        "imoex": None,
        "usdrub": None,
        "keyRate": None,
    }

    if imoex:
        payload["imoex"] = {
            "current": imoex[-1]["close"],
            "date": imoex[-1]["time"],
            "changePct": compute_changes(imoex),
            "history": imoex,
        }
    if usdrub:
        payload["usdrub"] = {
            "current": usdrub[-1]["close"],
            "date": usdrub[-1]["time"],
            "changePct": compute_changes(usdrub),
            "history": usdrub,
        }
    if keyrate:
        payload["keyRate"] = {
            "current": keyrate[-1]["rate"],
            "date": keyrate[-1]["date"],
            "history": keyrate,
        }

    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nЗаписано: {OUTPUT_PATH}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
