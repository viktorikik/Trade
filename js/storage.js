// js/storage.js
// Общие утилиты для работы со списком «Заметки» через localStorage.

const STORAGE_KEY = 'trading-signals-watchlist';

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('Не удалось прочитать заметки:', e);
    return [];
  }
}

function saveWatchlist(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Не удалось сохранить заметки:', e);
  }
}

function addOrUpdateWatchlist(entry) {
  const list = loadWatchlist();
  const idx = list.findIndex(x => x.ticker === entry.ticker);
  let action;
  if (idx >= 0) {
    list[idx] = entry;
    action = 'updated';
  } else {
    list.push(entry);
    action = 'added';
  }
  saveWatchlist(list);
  return { action, count: list.length };
}

function removeFromWatchlist(ticker) {
  const list = loadWatchlist().filter(x => x.ticker !== ticker);
  saveWatchlist(list);
  return list.length;
}

function clearWatchlist() {
  saveWatchlist([]);
}
