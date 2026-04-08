/**
 * sw.js — إلغاء ذاتي
 * هذا الملف يُلغي نفسه فوراً ويمسح كل الكاش القديم
 * لأننا انتقلنا لنظام version.json بدون Service Worker
 */
self.addEventListener('install', function() {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        console.log('[SW] حذف كاش:', key);
        return caches.delete(key);
      }));
    }).then(function() {
      return self.clients.claim();
    }).then(function() {
      // أخبر كل التبويبات بإعادة التحميل بعد مسح الكاش
      return self.clients.matchAll({ type: 'window' }).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'CACHE_CLEARED' });
        });
      });
    })
  );
});

// لا تعترض أي طلب — دع المتصفح يعمل بشكل طبيعي
