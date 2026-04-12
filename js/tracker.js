// ============================================================
//  tracker.js — نظام تتبع القوارب v1.0
//  يُضاف بعد reports.js في index.html
// ============================================================

var trackerTimer     = null;
var boatsLayer       = null;
var boatsVisible     = false;
var boatsTimer       = null;
var isTracking       = false;
var lastLat          = null;
var lastLon          = null;

// ============================================================
// إرسال الموقع للسيرفر
// ============================================================
function sendLocationToServer(lat, lon, isSOS) {
    if (!currentUser) return;
    var battery = null;
    // محاولة قراءة البطارية
    if (navigator.getBattery) {
        navigator.getBattery().then(function(b) {
            battery = Math.round(b.level * 100);
        }).catch(function(){});
    }
    var endpoint = isSOS ? '/api/tracking/sos' : '/api/tracking/update';
    fetch(API_BASE_URL + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({
            code:    currentUser,
            lat:     lat,
            lon:     lon,
            battery: battery,
            sos:     isSOS || false
        })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        if (isSOS) showSOSConfirmation();
        console.log('[Tracker] موقع أُرسل:', lat.toFixed(4), lon.toFixed(4));
    })
    .catch(function(err) {
        console.warn('[Tracker] فشل إرسال الموقع:', err);
    });
}

// ============================================================
// بدء / إيقاف التتبع
// ============================================================
function startTracking() {
    if (!currentUser) return;
    if (!userPermissions || !userPermissions.tracking) return;
    isTracking = true;
    updateTrackingBtn(true);
    // إرسال فوري عند البدء
    if (gpsLat && gpsLon) {
        lastLat = gpsLat; lastLon = gpsLon;
        sendLocationToServer(gpsLat, gpsLon, false);
    }
    // ثم كل 2 دقيقة (120 ثانية) عند الشاشة مفتوحة
    trackerTimer = setInterval(function() {
        if (gpsLat && gpsLon) {
            lastLat = gpsLat; lastLon = gpsLon;
            sendLocationToServer(gpsLat, gpsLon, false);
        }
    }, 120000);
    // تسجيل periodicSync للخلفية
    registerPeriodicSync();
    console.log('[Tracker] بدأ التتبع');
}

function stopTracking() {
    isTracking = false;
    updateTrackingBtn(false);
    if (trackerTimer) { clearInterval(trackerTimer); trackerTimer = null; }
    // إيقاف الكاش في السيرفر
    fetch(API_BASE_URL + '/api/tracking/clear/' + currentUser, {
        method: 'DELETE',
        headers: { 'x-api-key': API_KEY }
    }).catch(function(){});
    console.log('[Tracker] توقف التتبع');
}

function toggleTracking() {
    if (!userPermissions || !userPermissions.tracking) {
        showDataBanner('❌ لا صلاحية تتبع — تواصل مع المشرف', true);
        return;
    }
    if (isTracking) { stopTracking(); } else { startTracking(); }
}

function updateTrackingBtn(active) {
    var btn = document.getElementById('tracking-btn');
    if (!btn) return;
    if (active) {
        btn.classList.add('active');
        btn.innerHTML = '<span class="layer-tab-icon">🚢</span><span class="layer-tab-label" style="color:#06d6a0;">تتبعي: شغّال</span>';
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '<span class="layer-tab-icon">🚢</span><span class="layer-tab-label">تتبعي</span>';
    }
}

// ============================================================
// Service Worker — periodicSync للخلفية
// ============================================================
function registerPeriodicSync() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function(reg) {
        if (!('periodicSync' in reg)) return;
        reg.periodicSync.register('gps-sync', { minInterval: 15 * 60 * 1000 })
           .then(function() { console.log('[SW] periodicSync مسجّل'); })
           .catch(function(e) { console.warn('[SW] periodicSync فشل:', e); });
    });
}

// استقبال رسائل Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'SW_SEND_LOCATION') {
            if (gpsLat && gpsLon) sendLocationToServer(gpsLat, gpsLon, false);
        }
    });
}

// ============================================================
// عرض القوارب على الخريطة
// ============================================================
function loadBoats() {
    if (!currentUser) return;
    fetch(API_BASE_URL + '/api/tracking/boats?code=' + currentUser + '&t=' + Date.now(), {
        headers: { 'x-api-key': API_KEY }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) { if (data.boats) drawBoats(data.boats); })
    .catch(function(err) { console.warn('[Boats] فشل جلب القوارب:', err); });
}

function drawBoats(boats) {
    if (boatsLayer) map.removeLayer(boatsLayer);
    boatsLayer = L.layerGroup();
    boats.forEach(function(boat) {
        var isSOS     = boat.sos;
        var color     = isSOS ? '#ef4444' : '#06d6a0';
        var emoji     = isSOS ? '🆘' : '🚢';
        var pulse     = isSOS ? 'animation:boatSOS 0.8s infinite;' : '';
        var icon = L.divIcon({
            className: '',
            html: '<div style="font-size:22px;' + pulse + 'filter:drop-shadow(0 2px 4px rgba(0,0,0,0.7));">' + emoji + '</div>',
            iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16]
        });
        var battery   = boat.battery ? '🔋 ' + boat.battery + '%' : '';
        var timeStr   = boat.timestamp ? new Date(boat.timestamp).toLocaleTimeString('ar-DZ') : '';
        var sosLine   = isSOS ? '<div style="color:#ef4444;font-weight:700;font-size:.9rem;">🆘 نداء طوارئ!</div>' : '';
        var marker = L.marker([boat.lat, boat.lon], { icon: icon });
        marker.bindPopup(
            '<div style="text-align:right;direction:rtl;font-family:Tajawal,sans-serif;min-width:150px;">'
            + sosLine
            + '<div style="font-size:.95rem;font-weight:700;margin-bottom:4px;">' + emoji + ' ' + (boat.name || boat.code) + '</div>'
            + '<div style="color:#888;font-size:.75rem;">🕐 ' + timeStr + '</div>'
            + (battery ? '<div style="color:#888;font-size:.75rem;">' + battery + '</div>' : '')
            + '</div>'
        );
        boatsLayer.addLayer(marker);
    });
    if (boatsVisible) boatsLayer.addTo(map);
}

function toggleBoats(btn) {
    if (!userPermissions || !userPermissions.tracking) {
        showDataBanner('❌ لا صلاحية مشاهدة القوارب', true);
        return;
    }
    boatsVisible = !boatsVisible;
    if (boatsVisible) {
        btn.classList.add('active');
        loadBoats();
        boatsTimer = setInterval(loadBoats, 30000); // كل 30 ثانية
    } else {
        btn.classList.remove('active');
        if (boatsLayer) map.removeLayer(boatsLayer);
        if (boatsTimer) { clearInterval(boatsTimer); boatsTimer = null; }
    }
}

// ============================================================
// زر SOS
// ============================================================
function triggerSOS() {
    if (!currentUser) { alert('سجّل دخولك أولاً'); return; }
    if (!gpsLat || !gpsLon) { alert('فعّل GPS أولاً'); return; }
    var confirm_ = window.confirm('⚠️ هل تريد إرسال نداء SOS؟\nسيصل موقعك لكل المستخدمين فوراً.');
    if (!confirm_) return;
    sendLocationToServer(gpsLat, gpsLon, true);
}

function showSOSConfirmation() {
    var banner = document.getElementById('data-banner');
    if (banner) {
        banner.textContent = '🆘 تم إرسال SOS — موقعك يظهر للجميع الآن';
        banner.style.display = 'block';
        banner.style.background = 'rgba(239,68,68,0.9)';
        setTimeout(function() { banner.style.display = 'none'; banner.style.background = ''; }, 8000);
    }
}

// ============================================================
// CSS للSOS
// ============================================================
(function() {
    var style = document.createElement('style');
    style.textContent = '@keyframes boatSOS { 0%,100%{transform:scale(1)} 50%{transform:scale(1.3)} }';
    document.head.appendChild(style);
})();

// ============================================================
// تهيئة — يُشغَّل بعد تسجيل الدخول
// ============================================================
function initTracker() {
    if (!userPermissions || !userPermissions.tracking) return;
    // إضافة أزرار التتبع في الشريط العلوي
    injectTrackingButtons();
}

function injectTrackingButtons() {
    var container = document.querySelector('.top-bar .layer-tabs');
    if (!container) return;
    if (document.getElementById('tracking-btn')) return; // لا تضيف مرتين

    // زر تتبعي
    var trackBtn = document.createElement('div');
    trackBtn.className = 'layer-tab';
    trackBtn.id = 'tracking-btn';
    trackBtn.style.cssText = 'background:rgba(6,214,160,0.1);border-color:rgba(6,214,160,0.3);';
    trackBtn.innerHTML = '<span class="layer-tab-icon">🚢</span><span class="layer-tab-label">تتبعي</span>';
    trackBtn.onclick = function() { toggleTracking(); };
    container.appendChild(trackBtn);

    // زر مشاهدة القوارب
    var boatsBtn = document.createElement('div');
    boatsBtn.className = 'layer-tab';
    boatsBtn.id = 'boats-btn';
    boatsBtn.style.cssText = 'background:rgba(56,189,248,0.1);border-color:rgba(56,189,248,0.3);';
    boatsBtn.innerHTML = '<span class="layer-tab-icon">📡</span><span class="layer-tab-label" style="color:#38bdf8;">القوارب</span>';
    boatsBtn.onclick = function() { toggleBoats(boatsBtn); };
    container.appendChild(boatsBtn);
}

// زر SOS ثابت — يظهر بعد تسجيل الدخول
function injectSOSButton() {
    if (document.getElementById('sos-fab')) return;
    var btn = document.createElement('button');
    btn.id = 'sos-fab';
    btn.type = 'button';
    btn.innerHTML = '🆘';
    btn.title = 'نداء طوارئ SOS';
    btn.style.cssText = [
        'position:fixed', 'left:16px', 'bottom:200px', 'z-index:1200',
        'width:56px', 'height:56px', 'border-radius:50%',
        'background:linear-gradient(135deg,#dc2626,#991b1b)',
        'border:3px solid rgba(255,100,100,0.6)',
        'color:white', 'font-size:1.4rem', 'cursor:pointer',
        'display:flex', 'align-items:center', 'justify-content:center',
        'box-shadow:0 4px 20px rgba(220,38,38,0.6)',
        'animation:sosPulse 2s infinite'
    ].join(';');
    btn.onclick = triggerSOS;
    document.body.appendChild(btn);

    // CSS النبض
    var style = document.createElement('style');
    style.textContent = [
        '@keyframes sosPulse {',
        '  0%,100%{box-shadow:0 4px 20px rgba(220,38,38,0.6);}',
        '  50%{box-shadow:0 0 0 12px rgba(220,38,38,0);}',
        '}'
    ].join('');
    document.head.appendChild(style);
}
