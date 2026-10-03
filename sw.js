// sw.js — Service Worker для офлайн-режима и PWA
// Версия кэша: меняй при обновлении, чтобы старые файлы сбросились
const CACHE_NAME = 'trading-signals-v1';

// Файлы, которые кэшируем сразу при установке
const PRECACHE = [
  './',
  './index.html',
  './notes.html',
  './manifest.json',
  './css/style.css',
  './js/storage.js',
  './js/indicators.js',
  './js/correlation.js',
  './js/backtest.js',
  './js/optimizer.js',
  './js/app.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Данные (data/*.json) — сеть в первую очередь, кэш как fallback.
  // Это гарантирует, что свежие котировки не будут затираться кэшем.
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return resp;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Остальное — кэш в первую очередь, сеть как fallback.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (resp.ok && url.origin === self.location.origin) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return resp;
      });
    })
  );
});
