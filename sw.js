/**
 * sw.js — Service Worker مع periodicSync للتتبع في الخلفية
 * النسخة 2.0 — نظام التتبع البحري
 */

var SW_VERSION = '2.0.0';

// ============================================================
// التثبيت — فوري بدون انتظار
// ============================================================
self.addEventListener('install', function(event) {
    console.log('[SW] تثبيت النسخة', SW_VERSION);
    self.skipWaiting();
});

// ============================================================
// التفعيل — مسح الكاش القديم
// ============================================================
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(keys.map(function(key) {
                console.log('[SW] حذف كاش قديم:', key);
                return caches.delete(key);
            }));
        }).then(function() {
            return self.clients.claim();
        }).then(function() {
            return self.clients.matchAll({ type: 'window' }).then(function(clients) {
                clients.forEach(function(client) {
                    client.postMessage({ type: 'CACHE_CLEARED' });
                });
            });
        })
    );
});

// ============================================================
// periodicSync — إرسال GPS في الخلفية كل 15 دقيقة
// ============================================================
self.addEventListener('periodicsync', function(event) {
    if (event.tag === 'gps-sync') {
        event.waitUntil(syncGPSInBackground());
    }
});

async function syncGPSInBackground() {
    try {
        // إخبار الصفحة بإرسال الموقع
        var clients = await self.clients.matchAll({ type: 'window' });
        if (clients.length > 0) {
            clients.forEach(function(client) {
                client.postMessage({ type: 'SW_SEND_LOCATION' });
            });
            console.log('[SW] طلب إرسال GPS للصفحة');
        } else {
            // الصفحة مغلقة — محاولة قراءة الكاش وإرسال مباشرة
            await sendCachedLocation();
        }
    } catch(e) {
        console.warn('[SW] خطأ periodicSync:', e);
    }
}

async function sendCachedLocation() {
    try {
        var cache = await caches.open('tracker-cache-v1');
        var resp  = await cache.match('/tracker-data');
        if (!resp) return;
        var data  = await resp.json();
        if (!data.code || !data.lat || !data.lon) return;
        await fetch(data.apiBase + '/api/tracking/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': data.apiKey },
            body: JSON.stringify({ code: data.code, lat: data.lat, lon: data.lon })
        });
        console.log('[SW] GPS أُرسل من الكاش في الخلفية');
    } catch(e) {
        console.warn('[SW] فشل إرسال GPS من الكاش:', e);
    }
}

// ============================================================
// استقبال رسائل من الصفحة
// ============================================================
self.addEventListener('message', function(event) {
    // حفظ بيانات التتبع في الكاش للاستخدام في الخلفية
    if (event.data && event.data.type === 'SAVE_TRACKER_DATA') {
        caches.open('tracker-cache-v1').then(function(cache) {
            var response = new Response(JSON.stringify(event.data.payload));
            cache.put('/tracker-data', response);
        });
    }
    // مسح بيانات التتبع عند الإيقاف
    if (event.data && event.data.type === 'CLEAR_TRACKER_DATA') {
        caches.open('tracker-cache-v1').then(function(cache) {
            cache.delete('/tracker-data');
        });
    }
});

// لا تعترض أي طلب — المتصفح يعمل بشكل طبيعي
