// js/notes.js
// Страница заметок. Показывает актуальные вердикты, считает изменение
// цены с момента добавления, экспортирует список в CSV.

const dataCache = new Map();

function normalizeTickerPayload(raw, ticker) {
  if (Array.isArray(raw)) {
    return { ticker, name: ticker, lotSize: 1, candles: raw, dividends: [], splits: [] };
  }
  if (raw && Array.isArray(raw.candles)) {
    return {
      ticker: raw.ticker || ticker,
      name: raw.name || ticker,
      lotSize: Number.isFinite(raw.lotSize) && raw.lotSize > 0 ? raw.lotSize : 1,
      candles: raw.candles,
      dividends: Array.isArray(raw.dividends) ? raw.dividends : [],
      splits: Array.isArray(raw.splits) ? raw.splits : [],
    };
  }
  throw new Error('Неизвестный формат файла данных');
}

async function loadTickerData(ticker) {
  if (dataCache.has(ticker)) return dataCache.get(ticker);
  const resp = await fetch(`./data/${ticker}.json`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const raw = await resp.json();
  const payload = normalizeTickerPayload(raw, ticker);
  if (payload.candles.length === 0) throw new Error('пустой файл');
  dataCache.set(ticker, payload);
  return payload;
}

function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function fmtPct(v) {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ============================================================
// КАРТОЧКА
// ============================================================

async function renderNoteCard(entry) {
  const card = document.createElement('div');
  card.className = 'note-card';

  try {
    const payload = await loadTickerData(entry.ticker);

    const { adjusted } = applyCorporateActions(payload.candles, payload, {
      useSplits: true,
      useDividends: true,
    });

    const analysis = analyzeMarket(adjusted);
    const rawLast = payload.candles[payload.candles.length - 1];

    const changePct = (rawLast.close / entry.priceAtAdd - 1) * 100;
    const changeCls = changePct >= 0 ? 'good' : 'bad';

    card.innerHTML = `
      <div class="note-header">
        <a class="note-ticker" href="index.html?ticker=${encodeURIComponent(entry.ticker)}">
          ${entry.ticker}
        </a>
        <button class="note-delete" title="Удалить">✕</button>
      </div>
      <div class="note-name">${payload.name} · лот ${payload.lotSize}</div>
      <div class="verdict ${analysis.verdictClass} note-verdict">
        <span class="verdict-main">${analysis.verdict}</span>
        <span class="verdict-score">${analysis.score} б.</span>
      </div>
      <div class="note-row">
        <span>Цена сейчас:</span>
        <b>${rawLast.close.toFixed(2)} ₽</b>
      </div>
      <div class="note-row">
        <span>При добавлении:</span>
        <b>${entry.priceAtAdd.toFixed(2)} ₽</b>
      </div>
      <div class="note-row">
        <span>Изменение:</span>
        <b class="${changeCls}">${fmtPct(changePct)}</b>
      </div>
      <div class="note-row note-row-muted">
        <span>Добавлено:</span>
        <b>${fmtDate(entry.addedAt)}</b>
      </div>
    `;

    const delBtn = card.querySelector('.note-delete');
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const remaining = removeFromWatchlist(entry.ticker);
      showToast(`${entry.ticker} удалён из заметок`);
      card.remove();
      updateBadge(remaining);
      if (remaining === 0) toggleEmptyState(true);
    });

    return card;
  } catch (err) {
    console.error(err);
    card.classList.add('note-card-error');
    card.innerHTML = `
      <div class="note-header">
        <span class="note-ticker">${entry.ticker}</span>
        <button class="note-delete" title="Удалить">✕</button>
      </div>
      <div class="note-error">Не удалось загрузить данные: ${err.message}</div>
    `;
    const delBtn = card.querySelector('.note-delete');
    delBtn.addEventListener('click', () => {
      const remaining = removeFromWatchlist(entry.ticker);
      showToast(`${entry.ticker} удалён из заметок`);
      card.remove();
      updateBadge(remaining);
      if (remaining === 0) toggleEmptyState(true);
    });
    return card;
  }
}

// ============================================================
// СЛУЖЕБНОЕ
// ============================================================

function updateBadge(count) {
  // Бейджа на странице заметок нет, но если появится — обновим.
  const badge = document.getElementById('notesCount');
  if (badge) badge.textContent = count;
}

function toggleEmptyState(show) {
  const emptyEl = document.getElementById('emptyState');
  const gridEl = document.getElementById('notesGrid');
  if (emptyEl) emptyEl.style.display = show ? 'block' : 'none';
  if (gridEl) gridEl.style.display = show ? 'none' : 'grid';
}

// ============================================================
// ЭКСПОРТ CSV
// ============================================================

function downloadBlob(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportNotesCsv() {
  const list = loadWatchlist();
  if (list.length === 0) {
    showToast('Заметок нет — экспортировать нечего');
    return;
  }

  const btn = document.getElementById('exportNotes');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Готовим…';

  const header = 'ticker,name,lot_size,price_at_add,price_now,change_pct,verdict,score,added_at\n';
  const rows = [];

  for (const entry of list) {
    try {
      const payload = await loadTickerData(entry.ticker);
      const { adjusted } = applyCorporateActions(payload.candles, payload, {
        useSplits: true,
        useDividends: true,
      });
      const analysis = analyzeMarket(adjusted);
      const rawLast = payload.candles[payload.candles.length - 1];
      const changePct = (rawLast.close / entry.priceAtAdd - 1) * 100;

      rows.push([
        entry.ticker,
        `"${payload.name}"`,
        payload.lotSize,
        entry.priceAtAdd.toFixed(2),
        rawLast.close.toFixed(2),
        changePct.toFixed(2),
        `"${analysis.verdict}"`,
        analysis.score,
        entry.addedAt,
      ].join(','));
    } catch (err) {
      rows.push([
        entry.ticker, '"—"', '', entry.priceAtAdd.toFixed(2), '', '', 'error', '', entry.addedAt,
      ].join(','));
    }
  }

  btn.disabled = false;
  btn.textContent = originalText;

  const text = header + rows.join('\n');
  downloadBlob(`watchlist_${new Date().toISOString().slice(0, 10)}.csv`, text);
  showToast(`Экспортировано: ${rows.length} бумаг`);
}

// ============================================================
// ОЧИСТКА ВСЕГО СПИСКА
// ============================================================

function clearAllNotes() {
  const list = loadWatchlist();
  if (list.length === 0) {
    showToast('Список уже пуст');
    return;
  }
  const ok = confirm(`Удалить все ${list.length} бумаг из заметок?`);
  if (!ok) return;
  clearWatchlist();
  showToast('Все заметки очищены');
  renderAll();
}

// ============================================================
// ГЛАВНЫЙ РЕНДЕР
// ============================================================

async function renderAll() {
  const list = loadWatchlist();
  const grid = document.getElementById('notesGrid');
  if (!grid) return;

  grid.innerHTML = '';
  updateBadge(list.length);

  if (list.length === 0) {
    toggleEmptyState(true);
    return;
  }
  toggleEmptyState(false);

  const sorted = [...list].sort((a, b) =>
    new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
  );

  for (const entry of sorted) {
    const card = await renderNoteCard(entry);
    grid.appendChild(card);
  }
}

// ============================================================
// НАВЕШИВАЕМ ОБРАБОТЧИКИ
// ============================================================

const exportBtn = document.getElementById('exportNotes');
if (exportBtn) exportBtn.addEventListener('click', exportNotesCsv);

const clearBtn = document.getElementById('clearNotes');
if (clearBtn) clearBtn.addEventListener('click', clearAllNotes);

renderAll();
