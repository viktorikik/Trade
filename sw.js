// sw.js — Service Worker для офлайн-режима и PWA
// Версия кэша: меняй при каждом деплое фронтенда, чтобы старые файлы сбросились.
// Стратегия: сеть в первую очередь, кэш как fallback (для офлайна).
const CACHE_NAME = 'trading-signals-v17';

// Файлы, которые кэшируем сразу при установке (для офлайн-режима).
// Если что-то не скачается — установка не сломается из-за catch ниже.
const PRECACHE = [
  './',
  './index.html',
  './portfolio.html',
  './manifest.json',
  './css/style.css',
  './js/storage.js',
  './js/indicators.js',
  './js/correlation.js',
  './js/backtest.js',
  './js/optimizer.js',
  './js/app.js',
  './js/portfolio.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // addAll может упасть, если хоть один файл не скачался.
        // Кэшируем по одному, чтобы ошибка одного не валила все.
        return Promise.all(
          PRECACHE.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[SW] Не удалось закэшировать:', url, err);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// Стратегия: сеть в первую очередь, кэш как fallback.
// Это гарантирует, что свежий CSS/HTML/JS всегда долетает до пользователя.
// Если сети нет — отдаём то, что успели закэшировать.
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Не GET — не наш случай (POST, PUT и т.п.)
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Не трогаем чужое (CDN, аналитика и т.п.) — пусть идёт как обычно.
  // Lightweight Charts с unpkg — тому пример.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((resp) => {
        // Успешный ответ кладём в кэш (на случай офлайна).
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return resp;
      })
      .catch(() => {
        // Сети нет — отдаём, что есть в кэше.
        return caches.match(req);
      })
  );
});
