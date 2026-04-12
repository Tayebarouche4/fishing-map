// ============================================================
//  reports.js — تسجيل الدخول، التقييمات، التصحيحات، تقارير الصيادين
//  النسخة 2.0 — مع تفعيل نظام التتبع وSOS
// ============================================================

var VALID_CODES    = [];
var selectedRating = null;

// ============================================================
// تسجيل الدخول
// ============================================================

function doLogin() {
  var code = document.getElementById('login-input').value.trim().toUpperCase();
  if (!code) return;

  var errorEl = document.getElementById('login-error');
  errorEl.style.display = 'none';
  errorEl.textContent   = 'جاري التحقق...';
  errorEl.style.color   = 'var(--gold)';
  errorEl.style.display = 'block';

  fetch(API_BASE_URL + '/api/login/' + code, {
    headers: { 'x-api-key': API_KEY }
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    if (data.status === 'success') {
      currentUser     = code;
      userPermissions = data.permissions;

      document.getElementById('login-overlay').style.display  = 'none';
      document.getElementById('report-fab').style.display     = 'flex';
      document.getElementById('correction-fab').style.display = 'flex';

      applyPermissions(data.permissions);
      startGPS();

      // ===== تفعيل نظام التتبع إذا كان للصياد الصلاحية =====
      if (data.permissions && data.permissions.tracking) {
        initTrackerUI();
        injectSOSButton();
      }

    } else {
      errorEl.style.color = '#ef233c';
      errorEl.textContent = (data.detail || 'كود غير صحيح');
    }
  })
  .catch(function() {
    errorEl.style.color = '#ef233c';
    errorEl.textContent = 'تعذر الاتصال بالسيرفر';
  });
}

// ============================================================
// تطبيق الصلاحيات على الأزرار
// ============================================================

function applyPermissions(perms) {
  var map_ = {
    'reports-btn':       perms.reports,
    'route-btn':         perms.routes,
    'bathy-depth-btn':   perms.depth,
    'bathy-contour-btn': perms.depth,
    'bathy-wrecks-btn':  perms.depth,
    'ssh-btn':           perms.clarity,
    'dangers-tab':       perms.alerts,
    'current50-btn':     perms.current_deep,
    'tracking-btn':      perms.tracking,
    'boats-btn':         perms.tracking,
  };
  for (var id in map_) {
    var el = document.getElementById(id);
    if (el) el.style.display = map_[id] ? 'flex' : 'none';
  }
  // معالمي — لكل المستخدمين دائماً
  var myBtn = document.getElementById('my-markers-btn');
  if (myBtn) myBtn.style.display = 'flex';
}

// ============================================================
// تهيئة واجهة التتبع — يُستدعى بعد تسجيل الدخول
// ============================================================

function initTrackerUI() {
  // تسجيل periodicSync للتتبع في الخلفية
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(function(reg) {
      if (!('periodicSync' in reg)) return;
      reg.periodicSync.register('gps-sync', { minInterval: 15 * 60 * 1000 })
        .then(function() { console.log('[Tracker] periodicSync مسجّل'); })
        .catch(function(e) { console.warn('[Tracker] periodicSync:', e); });
    });
  }
  console.log('[Tracker] واجهة التتبع جاهزة للصياد:', currentUser);
}

// ============================================================
// زر SOS — يُحقن في الصفحة بعد تسجيل الدخول
// ============================================================

function injectSOSButton() {
  if (document.getElementById('sos-fab')) return;

  var style = document.createElement('style');
  style.textContent = [
    '@keyframes sosPulse {',
    '  0%  { box-shadow:0 4px 20px rgba(220,38,38,0.7); }',
    '  50% { box-shadow:0 0 0 16px rgba(220,38,38,0); }',
    '  100%{ box-shadow:0 4px 20px rgba(220,38,38,0.7); }',
    '}'
  ].join('');
  document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.id        = 'sos-fab';
  btn.type      = 'button';
  btn.innerHTML = '🆘';
  btn.title     = 'نداء طوارئ SOS';
  btn.style.cssText = [
    'position:fixed',
    'left:16px',
    'bottom:200px',
    'z-index:1200',
    'width:56px',
    'height:56px',
    'border-radius:50%',
    'background:linear-gradient(135deg,#dc2626,#991b1b)',
    'border:3px solid rgba(255,120,120,0.5)',
    'color:white',
    'font-size:1.5rem',
    'cursor:pointer',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'animation:sosPulse 2s infinite'
  ].join(';');
  btn.onclick = triggerSOS;
  document.body.appendChild(btn);
}

// ============================================================
// التقييم (صيد / لا صيد ...)
// ============================================================

function openRating() {
  closeCorrection();
  selectedRating = null;
  document.querySelectorAll('.rating-btn').forEach(function(b){ b.classList.remove('selected'); });
  document.getElementById('boxes-wrap').classList.remove('show');
  document.getElementById('boxes-input').value = '';
  document.getElementById('send-status').style.display = 'none';
  document.getElementById('rating-coords').textContent = (gpsLat && gpsLon)
    ? gpsLat.toFixed(4) + 'N    ' + gpsLon.toFixed(4) + 'E'
    : 'GPS غير نشط — فعّله أولاً';
  document.getElementById('rating-panel').classList.add('open');
}

function closeRating() {
  document.getElementById('rating-panel').classList.remove('open');
}

function selectRating(btn, rating) {
  document.querySelectorAll('.rating-btn').forEach(function(b){ b.classList.remove('selected'); });
  btn.classList.add('selected');
  selectedRating = rating;
  document.getElementById('boxes-wrap').classList.toggle('show', rating === 'صيد');
}

function sendRating() {
  if (!selectedRating) { alert('اختر نوع التقييم أولاً'); return; }
  if (!gpsLat || !gpsLon) { alert('فعّل GPS أولاً لتحديد موقعك'); return; }
  var now     = new Date();
  var payload = {
    date:   now.toLocaleDateString('fr-DZ'),
    time:   now.toLocaleTimeString('fr-DZ'),
    code:   currentUser,
    lat:    gpsLat.toFixed(6),
    lon:    gpsLon.toFixed(6),
    rating: selectedRating,
    boxes:  document.getElementById('boxes-input').value,
  };
  var status = document.getElementById('send-status');
  status.style.display = 'block';
  status.style.color   = 'var(--gold)';
  status.textContent   = 'جاري الإرسال...';
  fetch(API_BASE_URL + '/api/reports/add', {
    method:  'POST',
    headers: { 'Content-Type':'application/json', 'x-api-key': API_KEY },
    body:    JSON.stringify(payload),
  })
  .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
  .then(function() {
    status.style.color = 'var(--green)';
    status.textContent = 'تم الإرسال بنجاح!';
    setTimeout(closeRating, 2000);
  })
  .catch(function(err) {
    status.style.color = '#ef233c';
    status.textContent = 'فشل الإرسال — تحقق من الاتصال';
    console.error(err);
  });
}

// ============================================================
// التصحيح (إبلاغ عن مخاطر)
// ============================================================

function openCorrection() {
  closeRating();
  document.getElementById('obstacleType').selectedIndex = 0;
  document.getElementById('correction-other-wrap').style.display = 'none';
  document.getElementById('correction-note').value = '';
  document.getElementById('correction-send-status').style.display = 'none';
  document.getElementById('correction-coords').textContent = (gpsLat && gpsLon)
    ? gpsLat.toFixed(4) + 'N    ' + gpsLon.toFixed(4) + 'E'
    : 'GPS غير نشط — فعّله أولاً';
  document.getElementById('correction-panel').classList.add('open');
}

function closeCorrection() {
  document.getElementById('correction-panel').classList.remove('open');
}

function onObstacleTypeChange() {
  var v = document.getElementById('obstacleType').value;
  document.getElementById('correction-other-wrap').style.display = v === 'أخرى' ? 'block' : 'none';
  if (v !== 'أخرى') document.getElementById('correction-note').value = '';
}

function sendCorrection() {
  if (!gpsLat || !gpsLon) { alert('فعّل GPS أولاً لتحديد موقعك'); return; }
  var optionText = document.getElementById('obstacleType').value.trim();
  if (!optionText) { alert('اختر نوع العائق من القائمة'); return; }
  var now    = new Date();
  var extra  = document.getElementById('correction-note').value.trim();
  var payload = {
    date:         now.toLocaleDateString('fr-DZ'),
    time:         now.toLocaleTimeString('fr-DZ'),
    code:         currentUser,
    lat:          String(gpsLat.toFixed(6)),
    lon:          String(gpsLon.toFixed(6)),
    obstacleType: optionText,
    rating:       optionText,
    note:         extra ? (optionText + ' — ' + extra) : optionText,
    reportType:   'correction',
    category:     optionText,
    categoryText: optionText,
    optionText:   optionText,
    hazardLabel:  optionText,
    sheetRow: [
      now.toLocaleDateString('fr-DZ'),
      now.toLocaleTimeString('fr-DZ'),
      currentUser,
      String(gpsLat.toFixed(6)),
      String(gpsLon.toFixed(6)),
      optionText,
      extra
    ],
  };
  var status = document.getElementById('correction-send-status');
  status.style.display = 'block';
  status.style.color   = 'var(--gold)';
  status.textContent   = 'جاري الإرسال...';
  fetch(API_BASE_URL + '/api/reports/add', {
    method:  'POST',
    headers: { 'Content-Type':'application/json', 'x-api-key': API_KEY },
    body:    JSON.stringify(payload),
  })
  .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
  .then(function() {
    status.style.color = 'var(--green)';
    status.textContent = 'تم الإرسال بنجاح!';
    setTimeout(closeCorrection, 2000);
  })
  .catch(function(err) {
    status.style.color = '#ef233c';
    status.textContent = 'فشل الإرسال — تحقق من الاتصال أو إعدادات النشر';
    console.error(err);
  });
}

// ============================================================
// تقارير الصيادين على الخريطة
// ============================================================

var reportsLayer   = null;
var reportsTimer   = null;
var reportsVisible = false;

var RATING_STYLE = {
  'لا يوجد صيد':      { color:'#ef4444', icon:'❌' },
  'تجمع بدون اصطياد': { color:'#38bdf8', icon:'🔍' },
  'نتوء صخري':         { color:'#f97316', icon:'⚠️' },
  'حطام سفينة':        { color:'#a855f7', icon:'🚢' },
  'كابلات':            { color:'#eab308', icon:'⚡' },
  'صيد':               { color:'#22c55e', icon:'🎣' },
  'لا صيد':            { color:'#ef4444', icon:'❌' },
  'غير آمن':           { color:'#f97316', icon:'⚠️' },
  'استكشاف':           { color:'#38bdf8', icon:'🔍' },
};

function loadReports() {
  fetch(API_BASE_URL + '/api/reports?code=' + (currentUser||'') + '&t=' + Date.now(), {
    method:'GET', headers:{ 'x-api-key': API_KEY }
  })
  .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
  .then(function(data) { if (data.data) drawReports(data.data); })
  .catch(function(err) { console.warn('تقارير: ' + err.message); });
}

function drawReports(reports) {
  if (reportsLayer) map.removeLayer(reportsLayer);
  reportsLayer = L.layerGroup();
  reports.forEach(function(r) {
    var s = RATING_STYLE[r.rating] || { color:'#a3a3a3', icon:'📍' };
    var m = L.circleMarker([r.lat, r.lon], {
      radius:8, fillColor:s.color, color:'#fff', weight:2, opacity:1, fillOpacity:0.9
    });
    var box = (r.boxes && r.boxes !== '' && r.boxes !== '0')
      ? '<div>📦 الصناديق: <strong>' + r.boxes + '</strong></div>' : '';
    m.bindPopup(
      '<div style="text-align:right;direction:rtl;font-family:Tajawal,sans-serif;min-width:140px;">'
      + '<div style="font-size:1rem;margin-bottom:6px;">' + s.icon + ' ' + r.rating + '</div>'
      + '<div style="color:#888;font-size:.75rem;">👤 ' + r.code + '</div>'
      + '<div style="color:#888;font-size:.75rem;">📅 ' + r.date + ' — ' + r.time + '</div>'
      + box + '</div>'
    );
    reportsLayer.addLayer(m);
  });
  if (reportsVisible) reportsLayer.addTo(map);
}

function toggleReports(btn) {
  reportsVisible = !reportsVisible;
  if (reportsVisible) {
    btn.classList.add('active');
    loadReports();
    reportsTimer = setInterval(loadReports, 60000);
  } else {
    btn.classList.remove('active');
    if (reportsTimer) { clearInterval(reportsTimer); reportsTimer = null; }
    if (reportsLayer) map.removeLayer(reportsLayer);
  }
}

// ============================================================
// معالمي — نقاط الصياد الخاصة
// ============================================================

var myMarkersLayer   = null;
var myMarkersVisible = false;
var myMarkersTimer   = null;

function toggleMyMarkers(btn) {
  myMarkersVisible = !myMarkersVisible;
  if (myMarkersVisible) {
    btn.classList.add('active');
    loadMyMarkers();
    myMarkersTimer = setInterval(loadMyMarkers, 60000);
  } else {
    btn.classList.remove('active');
    if (myMarkersLayer) map.removeLayer(myMarkersLayer);
    if (myMarkersTimer) clearInterval(myMarkersTimer);
  }
}

function loadMyMarkers() {
  if (!currentUser) return;
  fetch(API_BASE_URL + '/api/reports?code=' + currentUser + '&own=true&t=' + Date.now(), {
    method:'GET', headers:{ 'x-api-key': API_KEY }
  })
  .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
  .then(function(data) { if (data.data) drawMyMarkers(data.data); })
  .catch(function(err) { console.warn('معالمي: ' + err.message); });
}

function drawMyMarkers(reports) {
  if (myMarkersLayer) map.removeLayer(myMarkersLayer);
  myMarkersLayer = L.layerGroup();
  reports.forEach(function(r) {
    var lat = parseFloat(r.lat), lon = parseFloat(r.lon);
    if (isNaN(lat) || isNaN(lon)) return;
    if (r.code.toUpperCase() !== currentUser.toUpperCase()) return;
    var s = RATING_STYLE[r.rating] || { color:'#38bdf8', icon:'📌' };
    var m = L.circleMarker([lat, lon], {
      radius:8, fillColor:s.color, color:'#38bdf8', weight:2, opacity:1, fillOpacity:0.9
    });
    var box = (r.boxes && r.boxes !== '' && r.boxes !== '0')
      ? '<div>📦 الصناديق: <strong>' + r.boxes + '</strong></div>' : '';
    m.bindPopup(
      '<div style="text-align:right;direction:rtl;font-family:Tajawal,sans-serif;min-width:140px;">'
      + '<div style="font-size:1rem;margin-bottom:6px;">📌 ' + r.rating + '</div>'
      + '<div style="color:#888;font-size:.75rem;">📅 ' + r.date + ' — ' + r.time + '</div>'
      + box + '</div>'
    );
    myMarkersLayer.addLayer(m);
  });
  if (myMarkersVisible) myMarkersLayer.addTo(map);
}
