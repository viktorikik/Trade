#!/usr/bin/env python3
"""
find_splits.py — детектор пропущенных сплитов.

Проходит по всем data/*.json и ищет дни с аномальным изменением цены
(резкий скачок вверх или вниз, похожий на сплит). Сопоставляет с
уже известным словарём SPLITS из fetch_moex.py.

Запускается ВРУЧНУЮ. НЕ в основном cron-workflow.

Как скрипт оценивает:
  • Цена за день упала более чем на 35% ИЛИ выросла более чем на 55%
    — это «аномальный день».
  • Для каждого такого дня считаем средний объём ДО (5 дней) и ПОСЛЕ (5 дней).
  • Если произведение «ratio цены × ratio объёма» близко к 1 —
    это уверенно СПЛИТ (объём изменился обратно цене).
  • Если объём не изменился пропорционально — это похоже на
    дивидендный гэп или реальный обвал, НЕ сплит.

Что выводит:
  1. В консоль — отчёт по трём категориям (уверенно / возможно / гэп).
  2. В файл data/splits-report.txt — тот же отчёт.
  3. Готовый Python-словарь SPLITS для вставки в fetch_moex.py.
"""

import json
import sys
from pathlib import Path
from statistics import median

# ===== Настройки =====

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
EXCLUDE = {"tickers", "macro", "smartlab-rotation", "correlation"}
REPORT_FILE = DATA_DIR / "splits-report.txt"

# Уже учтённые сплиты — не показываем их в отчёте как «находки».
# ВАЖНО: синхронизировать с SPLITS в fetch_moex.py.
# Когда добавишь новый сплит в fetch_moex.py — добавь и сюда,
# иначе скрипт каждый раз будет находить его снова.
KNOWN_SPLITS = {
    "GMKN":  [{"date": "2024-04-08", "ratio": 100}],
    "TRNFP": [{"date": "2024-02-21", "ratio": 100}],
    "GEMA":  [{"date": "2024-02-08", "ratio": 10}],
    "KOGK":  [{"date": "2025-08-15", "ratio": 100}],
    "PLZL":  [{"date": "2025-03-27", "ratio": 10}],
    "T":     [{"date": "2026-04-17", "ratio": 10}],
    "VTBR":  [{"date": "2024-07-15", "ratio": 0.0002}],
}

# Пороги аномалии.
# PRICE_DOWN_THRESHOLD = 0.65: цена упала более чем на 35% (подозрение 1→N).
# PRICE_UP_THRESHOLD   = 1.55: цена выросла более чем на 55% (подозрение N→1).
PRICE_DOWN_THRESHOLD = 0.65
PRICE_UP_THRESHOLD = 1.55

# Сколько дней усреднять до/после события, чтобы сгладить разовый выброс объёма.
VOLUME_WINDOW = 5

# Порог для «уверенно сплит»: |ratio_price × ratio_volume − 1| < tolerance.
SPLIT_MATCH_TOLERANCE = 0.35


# ===== Утилиты =====

def load_payload(ticker):
    p = DATA_DIR / f"{ticker}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  [!] {ticker}.json битый: {e}", file=sys.stderr)
        return None


def median_volume(candles, start_idx, end_idx):
    lo = max(0, start_idx)
    hi = min(len(candles), end_idx)
    if hi <= lo:
        return None
    vals = [c.get("volume", 0) for c in candles[lo:hi] if c.get("volume")]
    if not vals:
        return None
    return median(vals)


def known_dates_for(ticker):
    return {e["date"] for e in KNOWN_SPLITS.get(ticker, [])}


def known_ratio_for(ticker, date_str):
    for e in KNOWN_SPLITS.get(ticker, []):
        if e["date"] == date_str:
            return e.get("ratio")
    return None


def detect_in_ticker(ticker, candles):
    known_dates = known_dates_for(ticker)
    found = []

    for i in range(1, len(candles)):
        c0 = candles[i - 1]
        c1 = candles[i]
        try:
            p0 = float(c0["close"])
            p1 = float(c1["close"])
        except (KeyError, TypeError, ValueError):
            continue
        if p0 <= 0 or p1 <= 0:
            continue

        ratio = p1 / p0
        if PRICE_DOWN_THRESHOLD <= ratio <= PRICE_UP_THRESHOLD:
            continue  # нормальный день

        day = c1.get("time", "")
        if day in known_dates:
            continue  # уже учтён

        vol_before = median_volume(candles, i - VOLUME_WINDOW - 1, i - 1)
        vol_after = median_volume(candles, i, i + VOLUME_WINDOW)

        ratio_vol = None
        if vol_before and vol_after and vol_before > 0:
            ratio_vol = vol_after / vol_before

        is_split_like = False
        split_ratio_est = None
        if ratio_vol and ratio_vol > 0:
            product = ratio * ratio_vol
            if abs(product - 1.0) < SPLIT_MATCH_TOLERANCE:
                is_split_like = True
                if ratio < 1:
                    # цена упала — прямой сплит 1→N
                    est = round(1 / ratio)
                    if est >= 2:
                        split_ratio_est = est
                else:
                    # цена выросла — обратный сплит N→1
                    est = round(ratio)
                    if est >= 2:
                        split_ratio_est = est

        is_gap_like = False
        if ratio < 1 and (ratio_vol is None or ratio_vol < 1.3):
            is_gap_like = True

        found.append({
            "date": day,
            "ratio_price": ratio,
            "ratio_vol": ratio_vol,
            "is_split_like": is_split_like,
            "is_gap_like": is_gap_like,
            "split_ratio_est": split_ratio_est,
            "close_before": p0,
            "close_after": p1,
        })

    return found


def fmt_ratio_vol(x):
    if x is None:
        return "—"
    return f"{x:.2f}"


def fmt_est(c):
    est = c["split_ratio_est"]
    if not est:
        return "?"
    return f"1→{est}" if c["ratio_price"] < 1 else f"{est}→1"


def build_report(sure, maybe, gaps, all_files_count, found_tickers):
    lines = []
    lines.append("=" * 78)
    lines.append("find_splits.py — детектор пропущенных сплитов")
    lines.append("=" * 78)
    lines.append(f"Файлов проверено: {all_files_count}")
    lines.append(f"Бумаг с аномалиями: {len(found_tickers)}")
    lines.append(f"Пороги: падение < {PRICE_DOWN_THRESHOLD} или рост > {PRICE_UP_THRESHOLD}")
    lines.append(f"Известных сплитов (KNOWN_SPLITS): "
                 f"{sum(len(v) for v in KNOWN_SPLITS.values())}")
    lines.append("")

    def block(title, rows):
        lines.append("")
        lines.append(f"--- {title}: {len(rows)} ---")
        if not rows:
            lines.append("(пусто)")
            return
        lines.append(
            f"{'TICKER':<8} {'DATE':<12} "
            f"{'BEFORE':>9} {'AFTER':>9} "
            f"{'rPrice':>7} {'rVol':>7} {'≈':>6}"
        )
        for ticker, c in rows:
            lines.append(
                f"{ticker:<8} {c['date']:<12} "
                f"{c['close_before']:>9.2f} {c['close_after']:>9.2f} "
                f"{c['ratio_price']:>7.3f} {fmt_ratio_vol(c['ratio_vol']):>7} "
                f"{fmt_est(c):>6}"
            )

    block("УВЕРЕННО СПЛИТ (цена × объём ≈ 1)", sure)
    block("ВОЗМОЖНО СПЛИТ (проверить)", maybe)
    block("ПОХОЖЕ НА ГЭП / ОБВАЛ (не сплит)", gaps)

    # ---- Готовый словарь ----
    lines.append("")
    lines.append("=" * 78)
    lines.append("ГОТОВЫЙ СЛОВАРЬ SPLITS — для вставки в fetch_moex.py")
    lines.append("=" * 78)
    lines.append("")

    merged = {}
    # Сначала известные — сохраняем их как есть
    for t, entries in KNOWN_SPLITS.items():
        merged[t] = [{"date": e["date"], "ratio": e.get("ratio"), "known": True}
                     for e in entries]

    # Потом — уверенные находки
    for ticker, c in sure:
        merged.setdefault(ticker, [])
        # Не дублируем
        if any(e["date"] == c["date"] for e in merged[ticker]):
            continue
        merged[ticker].append({
            "date": c["date"],
            "ratio": c["split_ratio_est"],
            "known": False,
        })

    lines.append("# ============ СКОПИРУЙ И ВСТАВЬ В fetch_moex.py ============")
    lines.append("SPLITS = {")
    for ticker in sorted(merged.keys()):
        lines.append(f'    "{ticker}": [')
        for e in sorted(merged[ticker], key=lambda x: x["date"]):
            r = e.get("ratio")
            tag = "известный" if e.get("known") else "НОВЫЙ — проверь"
            if r is None:
                lines.append(f'        # {{"date": "{e["date"]}", "ratio": ???}},  # {tag}')
            else:
                lines.append(f'        {{"date": "{e["date"]}", "ratio": {r}}},  # {tag}')
        lines.append("    ],")
    lines.append("}")
    lines.append("# ==========================================================")
    lines.append("")
    lines.append("⚠️  ВАЖНО: проверь каждую запись вручную!")
    lines.append("    • ratio оценивается как round(1/ratio_price) — может быть 2 вместо 3.")
    lines.append("    • Сверь с новостями по тикеру: был ли реальный сплит в этот день.")
    lines.append("    • Исключи записи, которые окажутся дивидендным гэпом или обвалом.")
    lines.append("")

    return "\n".join(lines)


# ===== Главное =====

def main():
    print("=" * 78)
    print("find_splits.py — детектор пропущенных сплитов")
    print("=" * 78)
    print(f"Пороги: цена упала < {PRICE_DOWN_THRESHOLD} или выросла > {PRICE_UP_THRESHOLD}")
    print(f"Известных сплитов в KNOWN_SPLITS: "
          f"{sum(len(v) for v in KNOWN_SPLITS.values())}")
    print()

    files = sorted(DATA_DIR.glob("*.json"))
    files = [f for f in files if f.stem.lower() not in EXCLUDE]
    print(f"Файлов для проверки: {len(files)}")
    print()

    all_candidates = {}
    for path in files:
        ticker = path.stem.upper()
        payload = load_payload(ticker)
        if not payload:
            continue
        candles = payload.get("candles") or []
        if len(candles) < 2:
            continue

        candidates = detect_in_ticker(ticker, candles)
        if candidates:
            all_candidates[ticker] = candidates

    sure, maybe, gaps = [], [], []
    for ticker, cands in sorted(all_candidates.items()):
        for c in cands:
            row = (ticker, c)
            if c["is_split_like"]:
                sure.append(row)
            elif c["is_gap_like"]:
                gaps.append(row)
            else:
                maybe.append(row)

    report = build_report(sure, maybe, gaps, len(files), list(all_candidates.keys()))
    print(report)

    # Сохраняем в файл — чтобы можно было открыть на GitHub с iPhone
    REPORT_FILE.write_text(report, encoding="utf-8")
    print()
    print(f"📄 Отчёт сохранён: {REPORT_FILE}")
    print("   Открой его на GitHub — там весь список кандидатов.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
