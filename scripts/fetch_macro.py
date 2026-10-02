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


def fetch_imoex(session):
    """Тянет историю IMOEX с MOEX ISS. Возвращает [{time, close}, ...]."""
    params = {
        "from": START_DATE,
        "iss.meta": "off",
        "history.columns": "TRADEDATE,CLOSE",
    }
    try:
        resp = session.get(ISS_IMOEX, params=params, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"  [IMOEX] ошибка запроса: {e}", file=sys.stderr)
        return None

    block = resp.json().get("history", {})
    cols = block.get("columns", [])
    rows = block.get("data", [])
    if not rows:
        print("  [IMOEX] пустой ответ", file=sys.stderr)
        return None

    df = pd.DataFrame(rows, columns=cols)
    df = df.dropna(subset=["CLOSE"])
    df = df.rename(columns={"TRADEDATE": "time", "CLOSE": "close"})
    df["time"] = pd.to_datetime(df["time"]).dt.strftime("%Y-%m-%d")
    df["close"] = df["close"].astype(float).round(2)
    df = df[["time", "close"]].sort_values("time").reset_index(drop=True)
    return df.to_dict(orient="records")


def fetch_usdrub(session):
    """Тянет историю USD/RUB фиксинга с MOEX ISS. Возвращает [{time, close}, ...]."""
    params = {
        "from": START_DATE,
        "iss.meta": "off",
        "history.columns": "TRADEDATE,CLOSE",
    }
    try:
        resp = session.get(ISS_USD, params=params, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"  [USD/RUB] ошибка запроса: {e}", file=sys.stderr)
        return None

    block = resp.json().get("history", {})
    cols = block.get("columns", [])
    rows = block.get("data", [])
    if not rows:
        print("  [USD/RUB] пустой ответ", file=sys.stderr)
        return None

    df = pd.DataFrame(rows, columns=cols)
    df = df.dropna(subset=["CLOSE"])
    df = df.rename(columns={"TRADEDATE": "time", "CLOSE": "close"})
    df["time"] = pd.to_datetime(df["time"]).dt.strftime("%Y-%m-%d")
    df["close"] = df["close"].astype(float).round(4)
    df = df[["time", "close"]].sort_values("time").reset_index(drop=True)
    return df.to_dict(orient="records")


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

    for df in tables:
        cols_lower = [str(c).strip().lower() for c in df.columns]
        if "дата" in cols_lower and "ставка" in cols_lower:
            date_col = df.columns[cols_lower.index("дата")]
            rate_col = df.columns[cols_lower.index("ставка")]

            result = []
            for _, row in df.iterrows():
                d_raw = row[date_col]
                r_raw = row[rate_col]
                if pd.isna(d_raw) or pd.isna(r_raw):
                    continue
                try:
                    d_obj = pd.to_datetime(str(d_raw).strip(), format="%d.%m.%Y")
                except Exception:
                    continue
                try:
                    rate_val = float(str(r_raw).replace(",", ".").strip())
                except Exception:
                    continue
                result.append({
                    "date": d_obj.strftime("%Y-%m-%d"),
                    "rate": rate_val,
                })

            result.sort(key=lambda x: x["date"])
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
                f"последняя: {imoex[-1]['time']} @ {imoex[-1]['close']}",
                flush=True,
            )
        time.sleep(0.5)

        print("\n=== Загрузка USD/RUB ===", flush=True)
        usdrub = fetch_usdrub(session)
        if usdrub:
            print(
                f"  [USD/RUB] {len(usdrub)} точек, "
                f"последняя: {usdrub[-1]['time']} @ {usdrub[-1]['close']}",
                flush=True,
            )

    print("\n=== Загрузка ключевой ставки ЦБ ===", flush=True)
    keyrate = fetch_key_rate()
    if keyrate:
        print(
            f"  [KeyRate] {len(keyrate)} точек, "
            f"последняя: {keyrate[-1]['date']} @ {keyrate[-1]['rate']}%",
            flush=True,
        )

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
