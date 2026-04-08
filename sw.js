/**
 * Service Worker — خريطة الصيد
 * CACHE_NAME ثابت — التحديث يتم عبر version.json
 */

const CACHE_NAME = 'fishing-map-cache';

const NETWORK_ONLY = [
  'railway.app',
  'open-meteo.com',
  'google.com',
  'sheets.googleapis.com',
];

// ======================================================
// التثبيت
// ======================================================
self.addEventListener('install', function(event) {
  console.log('[SW] تثبيت');
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll([
        '/fishing-map/',
        '/fishing-map/index.html',
        '/fishing-map/manifest.json',
        '/fishing-map/rocks.geojson',
        '/fishing-map/hotam.geojson',
        '/fishing-map/mokhalfat.geojson',
        '/fishing-map/current1.geojson',
        '/fishing-map/current50.geojson',
      ].map(function(url) {
        return new Request(url, { cache: 'reload' });
      })).catch(function(err) {
        console.warn('[SW] خطأ في التخزين:', err);
      });
    })
  );
});

// ======================================================
// التفعيل
// ======================================================
self.addEventListener('activate', function(event) {
  console.log('[SW] تفعيل');
  event.waitUntil(self.clients.claim());
});

// ======================================================
// الاعتراض
// ======================================================
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // 1) خوادم خارجية — شبكة فقط
  var isNetworkOnly = NETWORK_ONLY.some(function(h) {
    return url.hostname.includes(h);
  });
  if (isNetworkOnly) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(JSON.stringify({ error: 'لا إنترنت' }),
          { headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  // 2) ملفات التطبيق والصور — شبكة أولاً ثم كاش
  if (/\.(html|css|js|png|jpg|jpeg|webp|gif|json)$/.test(url.pathname)
      || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request).then(function(res) {
        if (res && res.status === 200) {
          caches.open(CACHE_NAME).then(function(c) { c.put(event.request, res.clone()); });
        }
        return res;
      }).catch(function() {
        return caches.match(event.request).then(function(c) {
          return c || new Response('لا يوجد اتصال', { status: 503 });
        });
      })
    );
    return;
  }

  // 3) باقي الموارد — كاش أولاً
  event.respondWith(
    caches.match(event.request).then(function(c) {
      return c || fetch(event.request).then(function(res) {
        if (res && res.status === 200)
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, res.clone()); });
        return res;
      });
    })
  );
});

// ======================================================
// رسائل من الصفحة
// ======================================================
self.addEventListener('message', function(event) {
  // أمر مسح الكاش وإعادة التحميل
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(function() {
      self.clients.matchAll({ type: 'window' }).then(function(clients) {
        clients.forEach(function(c) { c.navigate(c.url); });
      });
    });
  }
});
