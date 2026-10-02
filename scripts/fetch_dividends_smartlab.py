"""
Парсит историю дивидендов с Smart-Lab.
Возвращает словарь {ticker: [{date, amount}, ...]}.
"""

import io
import re
import sys
import time

import pandas as pd
import requests

SMARTLAB_URL = "https://smart-lab.ru/q/{ticker}/dividend/"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "ru-RU,ru;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

DATE_RE = re.compile(r"^\d{2}\.\d{2}\.\d{4}$")

# Санити-порог: дивиденд не может быть больше 50% цены акции.
# Всё, что выше — считаем ошибкой парсинга и отбрасываем.
MAX_DIVIDEND_TO_PRICE = 0.5


def parse_amount(raw):
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw)
    s = s.replace("₽", "").replace("\xa0", "").replace(" ", "")
    s = s.replace(",", ".")
    s = re.sub(r"[^\d.]", "", s)
    if not s:
        return None
    try:
        val = float(s)
    except ValueError:
        return None
    return val if val > 0 else None


def looks_like_year(value):
    if value is None:
        return False
    if value != int(value):
        return False
    return 1900 <= value <= 2100


# =====================================================
# Чтение таблиц с самостоятельным поиском строки заголовка
# =====================================================
def _detect_header_row(raw):
    """
    Ищет строку, которая выглядит как заголовок колонок
    (содержит ключевые слова 'дата', 'дивиденд', 'цена', 'доходность' и т.п.).
    Это нужно, потому что у Smart-Lab бывает МНОГОУРОВНЕВЫЙ заголовок,
    и pandas с header=0 ошибочно принимает первую строку данных за заголовок.
    """
    keywords = [
        "дата", "дивиденд", "цена", "доходность", "период",
        "выплат", "стоимость", "t-1", "t+1", "закрытия", "отсечк",
    ]
    best_row = None
    best_score = 0

    for i in range(min(6, len(raw))):
        row = raw.iloc[i]
        score = 0
        for v in row:
            if pd.isna(v):
                continue
            s = str(v).strip().lower()
            if not s or len(s) > 80:
                # слишком длинное — это скорее подпись к секции, не колонка
                continue
            if any(kw in s for kw in keywords):
                score += 1
        if score > best_score:
            best_score = score
            best_row = i

    # Требуем минимум 2 совпадения, иначе считаем что заголовков нет
    if best_score >= 2:
        return best_row
    return None


def _table_from_raw(raw, header_row):
    """Преобразует сырую таблицу в DataFrame с правильным заголовком."""
    headers = []
    seen = {}
    for v in raw.iloc[header_row].tolist():
        h = str(v).strip() if not pd.isna(v) else "unnamed"
        if not h:
            h = "unnamed"
        if h in seen:
            seen[h] += 1
            h = f"{h}_{seen[h]}"
        else:
            seen[h] = 0
        headers.append(h)

    df = raw.iloc[header_row + 1:].copy().reset_index(drop=True)
    df.columns = headers
    # Убираем полностью пустые колонки и строки
    df = df.dropna(axis=1, how="all")
    df = df.dropna(how="all").reset_index(drop=True)
    return df


def read_tables_robust(html):
    """
    Читает таблицы, самостоятельно определяя строку заголовка.
    Возвращает список DataFrame с нормальными именами колонок.
    """
    try:
        raw_tables = pd.read_html(io.StringIO(html), header=None)
    except ValueError:
        return []
    except Exception:
        return []

    result = []
    for raw in raw_tables:
        header_row = _detect_header_row(raw)
        if header_row is None:
            continue
        t = _table_from_raw(raw, header_row)
        if t is not None and t.shape[1] >= 3 and t.shape[0] >= 1:
            result.append(t)
    return result


# =====================================================
# Оценка колонок
# =====================================================
def header_score(header):
    """
    Оценка заголовка как кандидата на 'сумма дивиденда в рублях'.
    Чем выше — тем больше похоже на нужную колонку.
    """
    h = str(header).strip().lower()

    # Очень длинный заголовок — скорее подпись к секции, чем колонка
    if len(h) > 60:
        return -50.0

    score = 0.0

    # Точное совпадение — идеально
    exact = {
        "дивиденд", "дивиденд, руб", "дивиденд, руб.",
        "дивиденд (руб)", "дивиденд (руб.)", "dividend",
        "дивиденды", "дивиденды, руб", "дивиденды, руб.",
    }
    if h in exact:
        score += 30

    # Смысловые бонусы
    if "дивиденд" in h:
        score += 10
    if "выплат" in h:
        score += 6
    if "на акцию" in h or "на 1 акцию" in h:
        score += 6
    if "₽" in h or "руб" in h or "rub" in h:
        score += 5

    # Явные признаки "неправильной" колонки
    if "%" in h or "процент" in h:
        score -= 15
    if "доходность" in h:
        score -= 15
    if "период" in h:
        score -= 12
    if "год" in h or "year" in h:
        score -= 12
    if "t-1" in h or "t+1" in h:
        score -= 6

    # Цена/стоимость акции — это НЕ дивиденд. Сильный штраф.
    if "цена" in h or "стоимость" in h or "price" in h:
        score -= 25
    if "закрыт" in h or "close" in h or "открыт" in h or "open" in h:
        score -= 15
    # Колонка с датой — не сумма
    if "дата" in h or "date" in h:
        score -= 10

    return score


def value_score(df, col_idx):
    """Оценка значений колонки как кандидата на дивиденды."""
    sample = df.iloc[:, col_idx].dropna().head(20)
    if len(sample) == 0:
        return -1.0

    parsed = [parse_amount(v) for v in sample]
    valid = [v for v in parsed if v is not None and v > 0]
    if not valid:
        return -1.0

    total = len(valid)
    year_penalty = sum(1 for v in valid if looks_like_year(v))
    if year_penalty == total:
        return -1.0

    score = 0.0
    score -= year_penalty * 2.0

    # Если все значения в диапазоне 1..20 — вероятно проценты
    all_small = all(v <= 20 for v in valid)
    if all_small:
        score -= 5.0

    # Типичный диапазон дивидендов в рублях — бонус
    typical = sum(1 for v in valid if 0.1 <= v <= 500)
    score += typical * 0.5

    # Дивиденды часто имеют копейки — небольшой бонус
    has_decimals = sum(1 for v in valid if v != int(v))
    score += has_decimals * 0.3

    # Подозрительно большие значения (>5000) — вероятно, цена в копейках
    suspicious_large = sum(1 for v in valid if v > 5000)
    score -= suspicious_large * 3.0

    # Разброс > 100x — подозрительно (у настоящих дивидендов обычно < 20x)
    if len(valid) >= 3:
        mx, mn = max(valid), min(valid)
        if mn > 0 and mx / mn > 100:
            score -= 3.0

    return score


def find_date_column(df):
    """Ищет колонку с датами формата ДД.ММ.ГГГГ."""
    for col_idx in range(df.shape[1]):
        sample = df.iloc[:, col_idx].dropna().astype(str).head(15)
        if len(sample) == 0:
            continue
        matches = sample.str.match(DATE_RE).sum()
        if matches >= max(1, len(sample) // 3):
            return col_idx
    return None


def find_amount_column(df, date_col):
    """Ищет колонку с суммой дивиденда."""
    best_col = None
    best_score = -1e9

    for col_idx in range(df.shape[1]):
        if col_idx == date_col:
            continue

        h = df.columns[col_idx]
        h_score = header_score(h)

        # Явно "не та" колонка по заголовку
        if h_score <= -15:
            continue

        # Если колонка сама состоит из дат — пропускаем
        v_sample = df.iloc[:, col_idx].dropna().astype(str).head(15)
        if len(v_sample) > 0:
            date_matches = v_sample.str.match(DATE_RE).sum()
            if date_matches >= len(v_sample) // 2:
                continue

        v_score = value_score(df, col_idx)

        total = h_score * 2.0 + v_score * 1.5

        if total > best_score:
            best_score = total
            best_col = col_idx

    # Даже если не нашли идеальную колонку, не берём откровенно плохую
    if best_col is None or best_score < 5:
        return None

    return best_col


def find_dividend_table(tables):
    """
    Ищет среди таблиц ту, где есть колонка с датами и колонка с дивидендами.
    Возвращает (df, date_col, amount_col) или None.
    """
    best = None
    best_total = -1.0

    for df in tables:
        if df.shape[1] < 3 or df.shape[0] < 1:
            continue

        date_col = find_date_column(df)
        if date_col is None:
            continue

        amount_col = find_amount_column(df, date_col)
        if amount_col is None:
            continue

        h_score = header_score(df.columns[amount_col])
        v_score = value_score(df, amount_col)
        total = h_score * 2.0 + v_score * 1.5

        if total > best_total:
            best_total = total
            best = (df, date_col, amount_col)

    return best


def fetch_dividends_for_ticker(ticker, start_date):
    url = SMARTLAB_URL.format(ticker=ticker.upper())

    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"  [{ticker}] ошибка запроса к Smart-Lab: {e}", file=sys.stderr)
        return []

    print(
        f"  [{ticker}] HTTP {resp.status_code}, длина HTML: {len(resp.text)} символов",
        flush=True,
    )

    tables = read_tables_robust(resp.text)
    if not tables:
        print(f"  [{ticker}] не удалось прочитать таблицы", file=sys.stderr)
        return []

    print(f"  [{ticker}] найдено таблиц: {len(tables)}", flush=True)

    found = find_dividend_table(tables)
    if found is None:
        print(f"  [{ticker}] не удалось найти таблицу с дивидендами", file=sys.stderr)
        return []

    df, date_col, amount_col = found
    date_header = str(df.columns[date_col])[:60]
    amount_header = str(df.columns[amount_col])[:60]
    print(
        f"  [{ticker}] таблица дивидендов: дата='{date_header}' (столбец {date_col}), "
        f"сумма='{amount_header}' (столбец {amount_col})",
        flush=True,
    )

    print(f"  [{ticker}] первые строки:", flush=True)
    for i, row in df.head(3).iterrows():
        d = row.iloc[date_col]
        a = row.iloc[amount_col]
        print(f"    дата={d!r}  сумма={a!r}", flush=True)

    result = []
    for _, row in df.iterrows():
        date_raw = row.iloc[date_col]
        amount_raw = row.iloc[amount_col]

        if pd.isna(date_raw):
            continue

        date_str_raw = str(date_raw).strip()
        if not DATE_RE.match(date_str_raw):
            continue

        try:
            date_obj = pd.to_datetime(date_str_raw, format="%d.%m.%Y")
        except Exception:
            continue

        date_iso = date_obj.strftime("%Y-%m-%d")
        if date_iso < start_date:
            continue

        amount = parse_amount(amount_raw)
        if amount is None or looks_like_year(amount):
            continue

        result.append({"date": date_iso, "amount": round(amount, 4)})

    seen = set()
    unique = []
    for d in result:
        key = (d["date"], d["amount"])
        if key not in seen:
            seen.add(key)
            unique.append(d)

    unique.sort(key=lambda x: x["date"])
    return unique


def fetch_all(tickers, start_date):
    result = {}
    for ticker in tickers:
        print(f"[{ticker}] тянем дивиденды со Smart-Lab...", flush=True)
        divs = fetch_dividends_for_ticker(ticker, start_date)
        result[ticker] = divs
        print(f"  [{ticker}] итого найдено {len(divs)} дивидендов", flush=True)
        time.sleep(0.7)
    return result


if __name__ == "__main__":
    tickers = (
        sys.argv[1:]
        if len(sys.argv) > 1
        else ["SBER", "GAZP", "LKOH", "GMKN", "ROSN", "NVTK"]
    )
    data = fetch_all(tickers, "2023-01-01")
    for t, divs in data.items():
        print(f"\n{t}:")
        for d in divs:
            print(f"  {d['date']} — {d['amount']} ₽")
