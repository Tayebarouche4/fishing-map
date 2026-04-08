/**
 * Service Worker — خريطة الصيد
 * ============================================================
 * كيفية التحديث: غيّر رقم CACHE_VERSION فقط عند كل رفع جديد
 * مثلاً: v3 → v4 → v5 ...
 * ============================================================
 */

const CACHE_VERSION = 'v3';   // ← غيّر هذا فقط عند كل تحديث
const CACHE_NAME    = 'fishing-map-' + CACHE_VERSION;

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

// الخوادم التي تُجلب دائماً من الشبكة (لا تُكاش أبداً)
const NETWORK_ONLY = [
  'railway.app',
  'open-meteo.com',
  'google.com',
  'sheets.googleapis.com',
];

// ======================================================
// التثبيت — تخزين الملفات الأساسية
// ======================================================
self.addEventListener('install', function(event) {
  console.log('[SW] تثبيت ' + CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(
        STATIC_FILES.map(function(url) {
          return new Request(url, { cache: 'reload' });
        })
      );
    }).catch(function(err) {
      console.warn('[SW] خطأ في التخزين:', err);
    })
  );
  // فعّل النسخة الجديدة فوراً بدون انتظار إغلاق التبويبات
  self.skipWaiting();
});

// ======================================================
// التفعيل — حذف كل الكاش القديم فوراً
// ======================================================
self.addEventListener('activate', function(event) {
  console.log('[SW] تفعيل ' + CACHE_NAME + ' — حذف الكاش القديم...');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) {
            console.log('[SW] حذف كاش قديم:', name);
            return caches.delete(name);
          })
      );
    }).then(function() {
      return self.clients.claim();
    }).then(function() {
      // أخبر كل التبويبات المفتوحة أن هناك تحديثاً جديداً
      return self.clients.matchAll({ type: 'window' }).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        });
      });
    })
  );
});

// ======================================================
// الاعتراض — الاستراتيجية حسب نوع الملف
// ======================================================
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // 1) خوادم خارجية — دائماً من الشبكة
  var isNetworkOnly = NETWORK_ONLY.some(function(host) {
    return url.hostname.includes(host);
  });
  if (isNetworkOnly) {
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

  // 2) ملفات التطبيق (HTML / CSS / JS) — شبكة أولاً ثم كاش
  //    يضمن أن الصيادين يرون دائماً آخر تحديث
  var isAppFile = STATIC_FILES.some(function(f) {
    return url.pathname === f || url.href.endsWith(f);
  }) || /\.(html|css|js)$/.test(url.pathname);

  if (isAppFile) {
    event.respondWith(
      fetch(event.request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          var clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return networkResponse;
      }).catch(function() {
        // لا إنترنت — استخدم الكاش كاحتياط
        return caches.match(event.request).then(function(cached) {
          return cached || new Response('لا يوجد اتصال', { status: 503 });
        });
      })
    );
    return;
  }

  // 3) باقي الموارد (صور، geojson، إلخ) — كاش أولاً ثم شبكة
  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          var clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return networkResponse;
      }).catch(function() {
        console.warn('[SW] لا يمكن الوصول لـ:', event.request.url);
      });
    })
  );
});
