// ============================================================
//  tracker.js — نظام تتبع القوارب v2.0
// ============================================================

var trackerTimer  = null;
var boatsLayer    = null;
var boatsVisible  = false;
var boatsTimer    = null;
var isTracking    = false;

// ============================================================
// إرسال الموقع للسيرفر
// ============================================================
function sendLocationToServer(lat, lon, isSOS) {
    if (!currentUser) return;

    var sendData = function(battery) {
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
        .then(function() {
            if (isSOS) showSOSConfirmation();
            console.log('[Tracker] موقع أُرسل:', lat.toFixed(4), lon.toFixed(4));
        })
        .catch(function(err) {
            console.warn('[Tracker] فشل إرسال الموقع:', err);
        });
    };

    if (navigator.getBattery) {
        navigator.getBattery()
            .then(function(b) { sendData(Math.round(b.level * 100)); })
            .catch(function()  { sendData(null); });
    } else {
        sendData(null);
    }
}

// ============================================================
// بدء التتبع التلقائي — يُستدعى من reports.js بعد الدخول
// ============================================================
function startTracking() {
    if (!currentUser) return;
    if (isTracking) return;
    isTracking = true;

    // إرسال فوري إذا كان GPS جاهزاً
    if (typeof gpsLat !== 'undefined' && gpsLat && gpsLon) {
        sendLocationToServer(gpsLat, gpsLon, false);
    }

    // إرسال كل دقيقتين
    trackerTimer = setInterval(function() {
        if (typeof gpsLat !== 'undefined' && gpsLat && gpsLon) {
            sendLocationToServer(gpsLat, gpsLon, false);
        }
    }, 120000);

    registerPeriodicSync();
    saveTrackerDataToSW();

    console.log('[Tracker] بدأ التتبع التلقائي للصياد:', currentUser);
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
           .catch(function(e) { console.warn('[SW] periodicSync:', e); });
    });
}

function saveTrackerDataToSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function(reg) {
        if (reg.active) {
            reg.active.postMessage({
                type: 'SAVE_TRACKER_DATA',
                payload: {
                    code:    currentUser,
                    lat:     gpsLat,
                    lon:     gpsLon,
                    apiBase: API_BASE_URL,
                    apiKey:  API_KEY
                }
            });
        }
    });
}

// استقبال رسائل SW
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'SW_SEND_LOCATION') {
            if (typeof gpsLat !== 'undefined' && gpsLat && gpsLon) {
                sendLocationToServer(gpsLat, gpsLon, false);
            }
        }
    });
}

// ============================================================
// عرض القوارب — لمن يملك perm_see_boats فقط
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
        var isSOS = boat.sos;
        var emoji = isSOS ? '🆘' : '🚢';
        var pulse = isSOS ? 'animation:boatSOS 0.8s infinite;' : '';

        var icon = L.divIcon({
            className: '',
            html: '<div style="font-size:22px;' + pulse + 'filter:drop-shadow(0 2px 4px rgba(0,0,0,0.7));">' + emoji + '</div>',
            iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16]
        });

        var battery = boat.battery ? '🔋 ' + boat.battery + '%' : '';
        var timeStr = boat.timestamp ? new Date(boat.timestamp).toLocaleTimeString('ar-DZ') : '';
        var sosLine = isSOS ? '<div style="color:#ef4444;font-weight:700;font-size:.9rem;">🆘 نداء طوارئ!</div>' : '';

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
    boatsVisible = !boatsVisible;
    if (boatsVisible) {
        btn.classList.add('active');
        loadBoats();
        boatsTimer = setInterval(loadBoats, 30000);
    } else {
        btn.classList.remove('active');
        if (boatsLayer) map.removeLayer(boatsLayer);
        if (boatsTimer) { clearInterval(boatsTimer); boatsTimer = null; }
    }
}

// ============================================================
// زر SOS — لكل من له tracking
// ============================================================
function triggerSOS() {
    if (!currentUser) { alert('سجّل دخولك أولاً'); return; }
    if (!gpsLat || !gpsLon) { alert('فعّل GPS أولاً'); return; }
    var ok = window.confirm('⚠️ هل تريد إرسال نداء SOS؟\nسيصل موقعك لكل المستخدمين فوراً.');
    if (!ok) return;
    sendLocationToServer(gpsLat, gpsLon, true);
}

function showSOSConfirmation() {
    var banner = document.getElementById('data-banner');
    if (!banner) return;
    banner.textContent      = '🆘 تم إرسال SOS — موقعك يظهر للجميع الآن';
    banner.style.display    = 'block';
    banner.style.background = 'rgba(239,68,68,0.9)';
    setTimeout(function() {
        banner.style.display    = 'none';
        banner.style.background = '';
    }, 8000);
}

function injectSOSButton() {
    if (document.getElementById('sos-fab')) return;

    var style = document.createElement('style');
    style.textContent = [
        '@keyframes sosPulse {',
        '  0%,100%{ box-shadow:0 4px 20px rgba(220,38,38,0.7); }',
        '  50%    { box-shadow:0 0 0 14px rgba(220,38,38,0); }',
        '}',
        '@keyframes boatSOS { 0%,100%{transform:scale(1)} 50%{transform:scale(1.3)} }'
    ].join('');
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.id            = 'sos-fab';
    btn.type          = 'button';
    btn.innerHTML     = '🆘';
    btn.title         = 'نداء طوارئ SOS';
    btn.style.cssText = [
        'position:fixed', 'left:16px', 'bottom:200px', 'z-index:1200',
        'width:56px', 'height:56px', 'border-radius:50%',
        'background:linear-gradient(135deg,#dc2626,#991b1b)',
        'border:3px solid rgba(255,100,100,0.6)',
        'color:white', 'font-size:1.4rem', 'cursor:pointer',
        'display:flex', 'align-items:center', 'justify-content:center',
        'animation:sosPulse 2s infinite'
    ].join(';');
    btn.onclick = triggerSOS;
    document.body.appendChild(btn);
}
