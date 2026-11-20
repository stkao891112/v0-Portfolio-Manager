// v2：/api/* 改為 Network-Only，不再寫入 CacheStorage（舊版會把報價、策略結果快取起來，離線時回傳過期資料）
const CACHE_NAME = 'portfolio-manager-v2';
const urlsToCache = [
  '/',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 清掉舊版快取（含 v1 曾經存進去的 /api 回應）
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 只處理同源的 GET；寫入請求與跨站請求交給瀏覽器
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API：Network-Only，不快取、不回傳舊資料（失敗就讓前端顯示錯誤）
  if (url.pathname.startsWith('/api/')) return;

  // 頁面與靜態檔：Network-First，離線時退回快取
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(request, responseClone);
            });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});
