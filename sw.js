/**
 * sw.js — Service Worker مع Network-First لبيانات الصيد اليومية
 * النسخة 3.1 — كاش يومي تلقائي
 */

var SW_VERSION  = '3.1.0';
var today       = new Date().toISOString().slice(0, 10); // "2026-04-15"
var DATA_CACHE  = 'fishing-data-' + today;  // يتغير كل يوم تلقائياً
var APP_CACHE   = 'app-shell-v1';
var TRACK_CACHE = 'tracker-cache-v1';

// ============================================================
// أنماط بيانات الأرشيف اليومية — tiles/YYYY-MM-DD/
// ============================================================
var DATA_PATTERNS = [
  /\/tiles\//,
  /\/archive\//,
  /\.nc(\?.*)?$/,
  /\.geojson(\?.*)?$/
];

// ============================================================
// التثبيت — فوري بدون انتظار
// ============================================================
self.addEventListener('install', function(event) {
    console.log('[SW] تثبيت النسخة', SW_VERSION, '— كاش اليوم:', DATA_CACHE);
    self.skipWaiting();
});

// ============================================================
// التفعيل — مسح كاش البيانات القديم تلقائياً
// ============================================================
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(keys.map(function(key) {
                // احذف كل fishing-data-* ما عدا اليوم
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
// اعتراض الطلبات
// ============================================================
self.addEventListener('fetch', function(event) {
    var url = event.request.url;

    if (!url.startsWith('http')) return;
    if (event.request.method !== 'GET') return;

    if (isDataRequest(url)) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    event.respondWith(staleWhileRevalidate(event.request));
});

function isDataRequest(url) {
    return DATA_PATTERNS.some(function(pattern) {
        return pattern.test(url);
    });
}

// ============================================================
// Network First — للبيانات اليومية
// ============================================================
async function networkFirst(request) {
    var cache = await caches.open(DATA_CACHE);
    try {
        var response = await fetchWithTimeout(request.clone(), 8000);
        if (response.ok) {
            await cache.put(request, response.clone());
            console.log('[SW] محدّث من الشبكة:', request.url.split('/').pop());
        }
        return response;
    } catch (err) {
        console.log('[SW] أوفلاين — أرجع الكاش:', request.url.split('/').pop());
        var cached = await cache.match(request);
        if (cached) return cached;
        return new Response('', { status: 503 });
    }
}

// ============================================================
// Stale While Revalidate — لملفات التطبيق
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
// fetchWithTimeout
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
// periodicSync — إرسال GPS في الخلفية
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
    if (event.data && event.data.type === 'SAVE_TRACKER_DATA') {
        caches.open(TRACK_CACHE).then(function(cache) {
            cache.put('/tracker-data', new Response(JSON.stringify(event.data.payload)));
        });
    }
    if (event.data && event.data.type === 'CLEAR_TRACKER_DATA') {
        caches.open(TRACK_CACHE).then(function(cache) {
            cache.delete('/tracker-data');
        });
    }
    if (event.data && event.data.type === 'FORCE_REFRESH_DATA') {
        caches.delete(DATA_CACHE).then(function() {
            console.log('[SW] تم مسح كاش البيانات بطلب يدوي');
        });
    }
});
