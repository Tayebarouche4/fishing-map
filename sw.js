/**
 * sw.js — Service Worker مع Network-First لبيانات الصيد اليومية
 * النسخة 3.0 — نظام التتبع البحري
 */

var SW_VERSION  = '3.0.0';
var DATA_CACHE  = 'fishing-data-v1';   // بيانات tiles اليومية
var APP_CACHE   = 'app-shell-v1';      // ملفات التطبيق
var TRACK_CACHE = 'tracker-cache-v1'; // بيانات GPS

// ============================================================
// أنماط بيانات الأرشيف اليومية — tiles/YYYY-MM-DD/
// ============================================================
var DATA_PATTERNS = [
  /\/tiles\//,              // sst.png, color.png, currents...
  /\/archive\//,            // احتياطي للمسارات القديمة
  /\.nc(\?.*)?$/,           // ملفات NetCDF
  /\.geojson(\?.*)?$/       // طبقات GeoJSON
];

// ============================================================
// التثبيت — فوري بدون انتظار
// ============================================================
self.addEventListener('install', function(event) {
    console.log('[SW] تثبيت النسخة', SW_VERSION);
    self.skipWaiting();
});

// ============================================================
// التفعيل — مسح كاش البيانات القديم فقط (ليس tracker)
// ============================================================
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(keys.map(function(key) {
                if (key.startsWith('fishing-data-') && key !== DATA_CACHE) {
                    console.log('[SW] حذف كاش بيانات قديم:', key);
                    return caches.delete(key);
                }
                if (key.startsWith('app-shell-') && key !== APP_CACHE) {
                    console.log('[SW] حذف كاش تطبيق قديم:', key);
                    return caches.delete(key);
                }
            }));
        }).then(function() {
            return self.clients.claim();
        })
    );
});

// ============================================================
// اعتراض الطلبات — القلب الجديد
// ============================================================
self.addEventListener('fetch', function(event) {
    var url = event.request.url;

    // تجاهل طلبات غير HTTP
    if (!url.startsWith('http')) return;

    // تجاهل طلبات POST/PUT (API tracking, Google Sheets)
    if (event.request.method !== 'GET') return;

    // بيانات tiles اليومية → Network First (دائماً أحدث نسخة)
    if (isDataRequest(url)) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // ملفات التطبيق → Stale While Revalidate (سريع + يتحدث في الخلفية)
    event.respondWith(staleWhileRevalidate(event.request));
});

function isDataRequest(url) {
    return DATA_PATTERNS.some(function(pattern) {
        return pattern.test(url);
    });
}

// ============================================================
// Network First — للبيانات اليومية
// حاول الشبكة أولاً، إذا فشل ارجع الكاش (مفيد في البحر)
// ============================================================
async function networkFirst(request) {
    var cache = await caches.open(DATA_CACHE);
    try {
        var response = await fetchWithTimeout(request.clone(), 8000);
        if (response.ok) {
            // خزّن النسخة الجديدة
            await cache.put(request, response.clone());
            console.log('[SW] بيانات محدّثة من الشبكة:', request.url.split('/').pop());
        }
        return response;
    } catch (err) {
        // أوفلاين أو timeout → ارجع الكاش (البيانات القديمة أفضل من لا شيء)
        console.log('[SW] أوفلاين — أرجع الكاش:', request.url.split('/').pop());
        var cached = await cache.match(request);
        if (cached) return cached;
        // لا كاش ولا شبكة
        return new Response('', { status: 503 });
    }
}

// ============================================================
// Stale While Revalidate — لملفات التطبيق
// أرجع الكاش فوراً وحدّثه في الخلفية
// ============================================================
async function staleWhileRevalidate(request) {
    var cache  = await caches.open(APP_CACHE);
    var cached = await cache.match(request);

    var fetchPromise = fetch(request.clone()).then(function(response) {
        if (response && response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    }).catch(function() {
        return cached;
    });

    return cached || fetchPromise;
}

// ============================================================
// fetchWithTimeout — fetch مع حد زمني
// ============================================================
function fetchWithTimeout(request, ms) {
    return new Promise(function(resolve, reject) {
        var timer = setTimeout(function() {
            reject(new Error('SW timeout'));
        }, ms);
        fetch(request).then(function(r) {
            clearTimeout(timer);
            resolve(r);
        }).catch(function(e) {
            clearTimeout(timer);
            reject(e);
        });
    });
}

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
        var clients = await self.clients.matchAll({ type: 'window' });
        if (clients.length > 0) {
            clients.forEach(function(client) {
                client.postMessage({ type: 'SW_SEND_LOCATION' });
            });
            console.log('[SW] طلب إرسال GPS للصفحة');
        } else {
            await sendCachedLocation();
        }
    } catch(e) {
        console.warn('[SW] خطأ periodicSync:', e);
    }
}

async function sendCachedLocation() {
    try {
        var cache = await caches.open(TRACK_CACHE);
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
    // حفظ بيانات التتبع
    if (event.data && event.data.type === 'SAVE_TRACKER_DATA') {
        caches.open(TRACK_CACHE).then(function(cache) {
            cache.put('/tracker-data', new Response(JSON.stringify(event.data.payload)));
        });
    }
    // مسح بيانات التتبع عند الإيقاف
    if (event.data && event.data.type === 'CLEAR_TRACKER_DATA') {
        caches.open(TRACK_CACHE).then(function(cache) {
            cache.delete('/tracker-data');
        });
    }
    // مسح كاش البيانات يدوياً (اختياري — من زر في الواجهة)
    if (event.data && event.data.type === 'FORCE_REFRESH_DATA') {
        caches.delete(DATA_CACHE).then(function() {
            console.log('[SW] تم مسح كاش البيانات بطلب يدوي');
        });
    }
});
