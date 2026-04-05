/**
 * Service Worker — خريطة الصيد
 * يتيح عمل التطبيق بدون إنترنت
 */

const CACHE_NAME = 'fishing-map-v1';

// الملفات التي تُحفظ للعمل Offline
const STATIC_FILES = [
  '/fishing-map/',
  '/fishing-map/index.html',
  '/fishing-map/manifest.json',
  '/fishing-map/rocks.geojson',
  '/fishing-map/hotam.geojson',
  '/fishing-map/mokhalfat.geojson',
  '/fishing-map/current1.geojson',
  '/fishing-map/current50.geojson',
];

// ======================================================
// التثبيت — تخزين الملفات الأساسية
// ======================================================
self.addEventListener('install', function(event) {
  console.log('[SW] تثبيت Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] تخزين الملفات الأساسية...');
      return cache.addAll(STATIC_FILES.map(url => new Request(url, { cache: 'reload' })));
    }).catch(function(err) {
      console.warn('[SW] خطأ في التخزين:', err);
    })
  );
  self.skipWaiting();
});

// ======================================================
// التفعيل — حذف الكاش القديم
// ======================================================
self.addEventListener('activate', function(event) {
  console.log('[SW] تفعيل Service Worker...');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] حذف كاش قديم:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// ======================================================
// الاعتراض — يقدم من الكاش أو الشبكة
// ======================================================
self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);

  // بيانات السيرفر والطقس — دائماً من الشبكة (لا تُكاش)
  if (
    url.hostname.includes('railway.app') ||
    url.hostname.includes('open-meteo.com') ||
    url.hostname.includes('google.com')
  ) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(
          JSON.stringify({ error: 'لا يوجد اتصال بالإنترنت' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // باقي الملفات — من الكاش أولاً ثم الشبكة
  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      if (cachedResponse) {
        // موجود في الكاش — أرجعه فوراً
        return cachedResponse;
      }
      // غير موجود — اجلبه من الشبكة وخزّنه
      return fetch(event.request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(function() {
        // لا إنترنت ولا كاش
        console.warn('[SW] لا يمكن الوصول لـ:', event.request.url);
      });
    })
  );
});
