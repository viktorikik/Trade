// js/notes.js
// Логика страницы заметок: подтягивает свежие данные и показывает актуальный вердикт.

const dataCache = new Map();

async function loadTickerData(ticker) {
  if (dataCache.has(ticker)) return dataCache.get(ticker);
  const resp = await fetch(`./data/${ticker}.json`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error('пустой файл');
  dataCache.set(ticker, data);
  return data;
}

function showToast(msg) {
  const el = document.getElementById('toast');
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

async function renderNoteCard(entry) {
  const card = document.createElement('div');
  card.className = 'note-card';

  try {
    const data = await loadTickerData(entry.ticker);
    const last = data[data.length - 1];
    const analysis = analyzeMarket(data);
    const changePct = (last.close / entry.priceAtAdd - 1) * 100;
    const changeCls = changePct >= 0 ? 'good' : 'bad';

    card.innerHTML = `
      <div class="note-header">
        <a class="note-ticker" href="index.html?ticker=${encodeURIComponent(entry.ticker)}">
          ${entry.ticker}
        </a>
        <button class="note-delete" title="Удалить">✕</button>
      </div>
      <div class="verdict ${analysis.verdictClass} note-verdict">
        <span class="verdict-main">${analysis.verdict}</span>
        <span class="verdict-score">${analysis.score} б.</span>
      </div>
      <div class="note-row">
        <span>Цена сейчас:</span>
        <b>${last.close.toFixed(2)} ₽</b>
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

    card.querySelector('.note-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      const remaining = removeFromWatchlist(entry.ticker);
      showToast(`${entry.ticker} удалён из заметок`);
      card.remove();
      updateStats(remaining);
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
    card.querySelector('.note-delete').addEventListener('click', () => {
      const remaining = removeFromWatchlist(entry.ticker);
      showToast(`${entry.ticker} удалён из заметок`);
      card.remove();
      updateStats(remaining);
      if (remaining === 0) toggleEmptyState(true);
    });
    return card;
  }
}

function updateStats(count) {
  document.getElementById('notesStats').innerHTML =
    `Всего бумаг: <b>${count}</b>`;
}

function toggleEmptyState(show) {
  document.getElementById('emptyState').style.display = show ? 'block' : 'none';
  document.getElementById('notesGrid').style.display = show ? 'none' : 'grid';
}

async function renderAll() {
  const list = loadWatchlist();
  const grid = document.getElementById('notesGrid');
  grid.innerHTML = '';

  updateStats(list.length);

  if (list.length === 0) {
    toggleEmptyState(true);
    return;
  }
  toggleEmptyState(false);

  // Сортируем: сначала недавно добавленные
  const sorted = [...list].sort((a, b) =>
    new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
  );

  for (const entry of sorted) {
    const card = await renderNoteCard(entry);
    grid.appendChild(card);
  }
}

// ===== Инициализация =====
document.getElementById('refresh').addEventListener('click', () => {
  dataCache.clear();
  renderAll();
});

document.getElementById('clearAll').addEventListener('click', () => {
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
});

renderAll();
