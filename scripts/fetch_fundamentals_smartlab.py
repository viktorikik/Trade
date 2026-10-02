"""
Парсит фундаментальные показатели с Smart-Lab.
Возвращает {ticker: fundamentals_dict | None}.

Структура fundamentals:
{
  "asOf": "LTM",
  "source": "smart-lab.ru",
  "metrics": {
    "pe": 3.35, "pb": 0.73, "roe": 24.0, "roa": 3.0,
    "eps": 86.6, "divYield": 13.6,
    "netProfitBln": 1869, "capitalizationBln": 6255, "equityBln": 8537
  },
  "history": [
    {"year": "2021", "pe": 5.28, "roe": 24.2, ...},
    ...
    {"year": "LTM", "pe": 3.35, "roe": 24.0, ...}
  ]
}
"""

import io
import re
import sys
import time

import pandas as pd
import requests

SMARTLAB_URL = "https://smart-lab.ru/q/{ticker}/f/"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "ru-RU,ru;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# Год — только 4 цифры (2020-2029)
YEAR_ONLY_RE = re.compile(r'^(20\d{2})$')

# LTM / TTM в любой обёртке: 'LTM', 'LTM ?', 'LTM (12м)', 'TTM', 'LTM*' и т.п.
LTM_RE = re.compile(r'(?<![A-Za-z])(LTM|TTM)(?![A-Za-z])', re.IGNORECASE)

# Метрики, которые тянем.
METRIC_PATTERNS = {
    "pe": [r'^P\s*/\s*E\b'],
    "pb": [r'^P\s*/\s*B\b'],
    "roe": [r'^ROE\b'],
    "roa": [r'^ROA\b'],
    "eps": [r'^EPS\b'],
    "divYield": [
        r'^Див\.?\s*доход.*\bао\b',
        r'^Див\.?\s*доход.*\bап\b',
        r'^Дивидендная\s*доходность',
    ],
    "netProfitBln": [r'^Чистая\s+прибыль'],
    "capitalizationBln": [r'^Капитализация'],
    "equityBln": [r'^Капитал(?!изация)'],
}


def parse_number(raw):
    """
    '1 251' -> 1251, '17.7%' -> 17.7, '0.000' -> 0.0, '—' -> None.
    """
    if raw is None:
        return None
    if isinstance(raw, float) and pd.isna(raw):
        return None

    s = str(raw).strip()
    if not s or s in ("—", "–", "-", "n/a", "N/A", "nan", "None"):
        return None

    s = s.replace("%", "").replace("₽", "")
    s = s.replace("\xa0", "").replace(" ", "")
    s = s.replace(",", ".")
    s = re.sub(r"[^\d.\-]", "", s)

    if not s or s in ("-", ".", "-.", "--"):
        return None

    try:
        return float(s)
    except ValueError:
        return None


def classify_header_cell(v):
    """
    Возвращает '2023' / 'LTM' / None для ячейки заголовка таблицы.
    Устойчиво к мусору вокруг: 'LTM ?', 'LTM (12м)', '2023 ' и т.п.
    """
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None

    s = str(v).strip()
    if not s:
        return None

    # Убираем типовой мусор: '?', '*', неразрывные пробелы, скобочные пояснения
    s_clean = s.rstrip('?*').strip()
    # Если что-то вроде 'LTM (12 мес.)' — отрезаем скобку
    s_clean = re.sub(r'\s*\([^)]*\)\s*$', '', s_clean).strip()

    # Год — ровно 4 цифры
    if YEAR_ONLY_RE.match(s_clean):
        return s_clean

    # LTM / TTM в любом контексте
    if LTM_RE.search(s_clean):
        return 'LTM'

    return None


def find_year_header_row(df):
    """
    Ищет строку, в которой >= 3 ячейки выглядят как годы или LTM.
    """
    max_scan = min(20, len(df))
    for i in range(max_scan):
        row = df.iloc[i]
        count = 0
        for v in row:
            if classify_header_cell(v) is not None:
                count += 1
        if count >= 3:
            return i
    return None


def collect_year_columns(df, header_row_idx):
    """
    Возвращает {col_idx: year_name}. LTM/TTM нормализуются в 'LTM'.
    """
    row = df.iloc[header_row_idx]
    cols = {}
    for col_idx, v in enumerate(row):
        classified = classify_header_cell(v)
        if classified is not None:
            cols[col_idx] = classified
    return cols


def find_metric_row(df, patterns, start_idx):
    """
    Ищет строку, первая колонка которой матчит хотя бы один из patterns.
    """
    for i in range(start_idx, len(df)):
        v = df.iloc[i, 0]
        if pd.isna(v):
            continue
        s = str(v).strip()
        s = re.sub(r"\s*\?\s*$", "", s)
        for pat in patterns:
            if re.match(pat, s):
                return i
    return None


def is_fundamentals_table(df):
    """
    Проверка: это таблица с фундаменталом? Возвращает индекс строки-заголовка или None.
    """
    header_row = find_year_header_row(df)
    if header_row is None:
        return None
    for i in range(header_row + 1, min(header_row + 60, len(df))):
        v = df.iloc[i, 0]
        if pd.isna(v):
            continue
        s = str(v).strip()
        if re.match(r"^P\s*/\s*E\b", s) or re.match(r"^ROE\b", s):
            return header_row
    return None


def extract_fundamentals(df, header_row_idx):
    """Извлекает метрики и историю из найденной таблицы."""
    year_cols = collect_year_columns(df, header_row_idx)
    if not year_cols:
        return None

    # Сортируем: обычные годы по возрастанию, LTM — в самом конце.
    sorted_years = sorted(
        year_cols.items(),
        key=lambda x: (x[1] == "LTM", x[1] if x[1] != "LTM" else "ZZZZ"),
    )
    last_col_idx, last_year_name = sorted_years[-1]

    # Находим все нужные строки метрик
    metric_rows = {}
    for metric_name, patterns in METRIC_PATTERNS.items():
        row_idx = find_metric_row(df, patterns, header_row_idx + 1)
        if row_idx is not None:
            metric_rows[metric_name] = row_idx

    if not metric_rows:
        return None

    # Текущие значения (LTM или последний год)
    metrics = {}
    for metric_name, row_idx in metric_rows.items():
        v = parse_number(df.iloc[row_idx, last_col_idx])
        if v is not None:
            metrics[metric_name] = v

    if not metrics:
        return None

    # История по годам
    history = []
    for col_idx, year_name in sorted_years:
        entry = {"year": year_name}
        for metric_name, row_idx in metric_rows.items():
            v = parse_number(df.iloc[row_idx, col_idx])
            if v is not None:
                entry[metric_name] = v
        if len(entry) > 1:
            history.append(entry)

    return {
        "asOf": last_year_name,
        "source": "smart-lab.ru",
        "metrics": metrics,
        "history": history,
    }


def fetch_fundamentals_for_ticker(ticker):
    """Возвращает dict с фундаменталом или None."""
    url = SMARTLAB_URL.format(ticker=ticker.upper())

    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"  [{ticker}] ошибка запроса к Smart-Lab: {e}", file=sys.stderr)
        return None

    print(
        f"  [{ticker}] HTTP {resp.status_code}, длина HTML: {len(resp.text)} символов",
        flush=True,
    )

    try:
        tables = pd.read_html(io.StringIO(resp.text), header=None)
    except ValueError as e:
        print(f"  [{ticker}] pandas не нашёл таблиц: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  [{ticker}] ошибка парсинга HTML: {e}", file=sys.stderr)
        return None

    print(f"  [{ticker}] найдено таблиц: {len(tables)}", flush=True)

    for df in tables:
        if df.shape[1] < 4 or df.shape[0] < 5:
            continue
        header_row = is_fundamentals_table(df)
        if header_row is None:
            continue

        # === DEBUG: показываем, что именно увидел парсер в строке-заголовке ===
        print(f"  [{ticker}] строка-заголовок (строка {header_row}):", flush=True)
        header_row_values = []
        for col_idx, v in enumerate(df.iloc[header_row]):
            if pd.isna(v):
                continue
            classified = classify_header_cell(v)
            mark = f" -> {classified}" if classified else ""
            print(f"    col {col_idx}: {v!r}{mark}", flush=True)
            header_row_values.append((col_idx, v, classified))

        result = extract_fundamentals(df, header_row)
        if result is None:
            continue

        print(
            f"  [{ticker}] фундаментал: asOf={result['asOf']}, "
            f"метрик: {len(result['metrics'])}, "
            f"лет в истории: {len(result['history'])}",
            flush=True,
        )
        for k, v in result["metrics"].items():
            print(f"    {k}: {v}", flush=True)
        years = [h['year'] for h in result['history']]
        print(f"    годы в истории: {years}", flush=True)
        return result

    print(f"  [{ticker}] не нашли таблицу с фундаменталом", file=sys.stderr)
    return None


def fetch_all(tickers):
    """Возвращает {ticker: fundamentals | None}."""
    result = {}
    for ticker in tickers:
        print(f"[{ticker}] тянем фундаментал со Smart-Lab...", flush=True)
        try:
            result[ticker] = fetch_fundamentals_for_ticker(ticker)
        except Exception as e:
            print(f"  [{ticker}] непредвиденная ошибка: {e}", file=sys.stderr)
            result[ticker] = None
        time.sleep(0.7)
    return result


if __name__ == "__main__":
    tickers = (
        sys.argv[1:]
        if len(sys.argv) > 1
        else ["SBER", "GAZP", "LKOH", "GMKN", "ROSN", "NVTK"]
    )
    data = fetch_all(tickers)
    print("\n=== ИТОГ ===")
    for t, f in data.items():
        if f is None:
            print(f"{t}: не удалось получить данные")
        else:
            print(f"{t}: {len(f['metrics'])} метрик, asOf={f['asOf']}, "
                  f"лет: {len(f['history'])}")
