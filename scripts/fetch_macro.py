"""
Загружает макро-контекст: IMOEX, USD/RUB фиксинг, ключевую ставку ЦБ РФ.
Сохраняет в data/macro.json.

Все запросы к MOEX ISS — с retry и уменьшенным timeout (15 сек).
Ключевая ставка парсится напрямую регуляркой (без pandas.read_html).
"""

import io
import json
import re
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

# Санити-границы для ключевой ставки. Исторически (с 2013) она
# была в диапазоне 4.25% – 20%. Всё, что вне (0, 25), — точно баг.
MIN_RATE = 0.0
MAX_RATE = 25.0

REQUEST_TIMEOUT = 15
RETRY_ATTEMPTS = 2
RETRY_DELAY = 3


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
    print(f"    [{label}] все {RETRY_ATTEMPTS} попытки провалились: {last_err}", file=sys.stderr)
    return None


def _fetch_iss_history_paginated(session, url, label):
    """Тянет всю историю с ISS с пагинацией + retry."""
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
        resp = _get_with_retry(session, url, params, f"{label} start={start}")
        if resp is None:
            if start == 0:
                return None
            print(
                f"    [{label}] оборвались на start={start}, "
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


# Регулярка ищет пары: <td>ДД.ММ.ГГГГ</td> ... <td>число с запятой</td>
# Допускаем:
#   - атрибуты у <td>
#   - пробелы/переводы строк
#   - неразрывные пробелы (\xa0)
#   - ставку в виде "14,00" или "7,5"
_KEYRATE_ROW_RE = re.compile(
    r'<td[^>]*>\s*(\d{2}\.\d{2}\.\d{4})\s*</td>'
    r'.{0,200}?'
    r'<td[^>]*>\s*(\d{1,3}[,.]\d{1,2})\s*</td>',
    re.DOTALL,
)


def fetch_key_rate():
    """Тянет историю ключевой ставки ЦБ через парсинг HTML регуляркой."""
    params = {
        "UniDbQuery.Posted": "True",
        "UniDbQuery.From": "01.01.2023",
        "UniDbQuery.To": date.today().strftime("%d.%m.%Y"),
    }

    # Retry для запроса к cbr.ru
    last_err = None
    resp = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            r = requests.get(
                CBR_KEYRATE_URL, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT
            )
            r.raise_for_status()
            resp = r
            break
        except Exception as e:
            last_err = e
            if attempt < RETRY_ATTEMPTS:
                print(
                    f"    [KeyRate] попытка {attempt} не удалась ({type(e).__name__}), "
                    f"повтор через {RETRY_DELAY}с",
                    file=sys.stderr,
                )
                time.sleep(RETRY_DELAY)

    if resp is None:
        print(f"  [KeyRate] все попытки провалились: {last_err}", file=sys.stderr)
        return None

    html = resp.text
    print(f"  [KeyRate] HTTP {resp.status_code}, длина HTML: {len(html)} символов", flush=True)

    matches = _KEYRATE_ROW_RE.findall(html)
    print(f"  [KeyRate] найдено HTML-пар (дата, ставка): {len(matches)}", flush=True)

    if not matches:
        # Покажем первые 500 символов, чтобы понять структуру
        snippet = html[:500].replace("\n", " ")
        print(f"  [KeyRate] первые 500 символов HTML: {snippet}", file=sys.stderr)
        return None

    # Покажем первые 3 сырых совпадения
    print(f"  [KeyRate] первые 3 сырых совпадения:", flush=True)
    for date_raw, rate_raw in matches[:3]:
        print(f"    ({date_raw!r}, {rate_raw!r})", flush=True)

    result = []
    skipped_range = 0
    skipped_parse = 0

    for date_str, rate_str in matches:
        # Ставка: "14,00" -> "14.00" -> 14.0
        rate_clean = rate_str.replace(",", ".")
        try:
            rate_val = float(rate_clean)
        except ValueError:
            skipped_parse += 1
            continue

        # Санити-фильтр: ключевая ставка всегда в (0, 25)
        if not (MIN_RATE < rate_val < MAX_RATE):
            skipped_range += 1
            continue

        # Дата
        try:
            d_obj = pd.to_datetime(date_str, format="%d.%m.%Y")
        except Exception:
            skipped_parse += 1
            continue

        result.append({
            "date": d_obj.strftime("%Y-%m-%d"),
            "rate": round(rate_val, 4),
        })

    if skipped_parse:
        print(f"  [KeyRate] пропущено (не распарсилось): {skipped_parse}", flush=True)
    if skipped_range:
        print(f"  [KeyRate] пропущено (вне диапазона 0..25): {skipped_range}", flush=True)

    # Уникализация по дате (иногда CBR отдаёт дубли)
    seen = set()
    unique = []
    for r in result:
        if r["date"] not in seen:
            seen.add(r["date"])
            unique.append(r)

    unique.sort(key=lambda x: x["date"])

    if unique:
        print(
            f"  [KeyRate] взято {len(unique)} точек, "
            f"первая: {unique[0]['date']} @ {unique[0]['rate']}%, "
            f"последняя: {unique[-1]['date']} @ {unique[-1]['rate']}%",
            flush=True,
        )
    else:
        print("  [KeyRate] после фильтрации не осталось точек", file=sys.stderr)

    return unique or None


def compute_changes(history):
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

    # Читаем старый macro.json, чтобы не потерять данные, если что-то упало
    old_payload = {}
    if OUTPUT_PATH.exists():
        try:
            old_payload = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        except Exception:
            old_payload = {}

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
    elif old_payload.get("imoex"):
        print("  [IMOEX] новых данных нет, оставляем старые", file=sys.stderr)
        payload["imoex"] = old_payload["imoex"]

    if usdrub:
        payload["usdrub"] = {
            "current": usdrub[-1]["close"],
            "date": usdrub[-1]["time"],
            "changePct": compute_changes(usdrub),
            "history": usdrub,
        }
    elif old_payload.get("usdrub"):
        print("  [USD/RUB] новых данных нет, оставляем старые", file=sys.stderr)
        payload["usdrub"] = old_payload["usdrub"]

    if keyrate:
        payload["keyRate"] = {
            "current": keyrate[-1]["rate"],
            "date": keyrate[-1]["date"],
            "history": keyrate,
        }
    elif old_payload.get("keyRate"):
        print("  [KeyRate] новых данных нет, оставляем старые", file=sys.stderr)
        payload["keyRate"] = old_payload["keyRate"]

    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nЗаписано: {OUTPUT_PATH}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
