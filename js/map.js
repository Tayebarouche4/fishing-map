// ============================================================
//  map.js — تهيئة الخريطة والطبقات الأساسية
// ============================================================

// --- تهيئة الخريطة ---
var map = L.map('map', { zoomControl:false, attributionControl:false });
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom:18, attribution:'© OpenStreetMap'
}).addTo(map);
L.control.zoom({ position:'bottomright' }).addTo(map);
map.setView([36.2, 0.3], 9);

// --- متغيرات الطبقة الحالية ---
var currentOverlay  = null;
var currentOpacity  = 0.85;
var currentLayerId  = 'sst';
var currentValuesData = null;   // بيانات القيم الحقيقية (JSON) للطبقة المعروضة حالياً

// ============================================================
// اكتشاف التاريخ وتهيئة البيانات
// ============================================================

function setDateBadge() {
  var el = document.getElementById('date-badge');
  if (el) el.textContent = 'تاريخ البيانات: ' + DATE;
}

function applyBoundsFromJson(d) {
  UNIFIED_BOUNDS = null;
  if (!d) return;
  if (d.date) DATE = d.date;
  var b = d.bounds || d.bbox || d.extent;
  if (b && b.length === 2 && b[0].length === 2 && b[1].length === 2) {
    UNIFIED_BOUNDS = b;
  }
}

function fetchBoundsForDate() {
  return fetch(TILES_BASE + DATE + '/bounds.json')
    .then(function(r) {
      if (!r.ok) throw new Error('no bounds');
      return r.json();
    })
    .then(function(d) { applyBoundsFromJson(d); })
    .catch(function() { /* استخدام الحدود الافتراضية */ });
}

function hideLoadingBar() {
  var lb = document.getElementById('loading-bar');
  if (lb) lb.style.display = 'none';
  if (typeof map !== 'undefined' && map) {
    map.invalidateSize();
  }
}

function showDataBanner(msg) {
  var el = document.getElementById('data-banner');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function probeDatesJson() {
  return fetch(TILES_BASE + 'dates.json')
    .then(function(r) { if (!r.ok) throw new Error('no dates.json'); return r.json(); });
}

function tryFallbackBoundsThenStart() {
  return new Promise(function(resolve, reject) {
    var tried = 0;
    function tryNext() {
      if (tried >= DATA_PATHS.length) { reject(new Error('all paths failed')); return; }
      var p = DATA_PATHS[tried++];
      fetch(p.tiles + 'dates.json')
        .then(function(r) { if (!r.ok) throw new Error('no'); return r.json(); })
        .then(function(d) {
          TILES_BASE     = p.tiles;
          ROUTES_GEOJSON = p.routes;
          DATE = d.latest || d[0] || (typeof d === 'string' ? d : '');
          if (!DATE) throw new Error('no date');
          setDateBadge();
          return fetchBoundsForDate();
        })
        .then(resolve)
        .catch(tryNext);
    }
    tryNext();
  });
}

function startApp() {
  buildLayers();
  switchLayer('sst', document.querySelector('.layer-tab'));
  hideLoadingBar();
}

function startAppOfflineMapOnly() {
  hideLoadingBar();
  showDataBanner('وضع عدم الاتصال — عرض خريطة الأساس فقط');
}

// استدعاء عند تحميل الصفحة
probeDatesJson()
  .then(function(data) {
    DATE = data.latest;
    setDateBadge();
    return fetchBoundsForDate();
  })
  .then(function() { startApp(); })
  .catch(function() {
    tryFallbackBoundsThenStart()
      .then(function() { startApp(); })
      .catch(function() {
        var lt = document.getElementById('loading-text');
        if (lt) lt.textContent = 'تعذر الوصول لمجلد البيانات — عرض خريطة الأساس فقط';

        var now = new Date();
        DATE = now.getFullYear() + '-'
          + String(now.getMonth()+1).padStart(2,'0') + '-'
          + String(now.getDate()).padStart(2,'0');
        setDateBadge();
        showDataBanner('لم يُعثر على مجلد بيانات — تأكد من رفع مجلد tiles/YYYY-MM-DD على الخادم.');
        buildLayers();
        switchLayer('sst', document.querySelector('.layer-tab'));
        hideLoadingBar();
      });
  });

function layerBounds(id) {
  if (UNIFIED_BOUNDS) return UNIFIED_BOUNDS;
  return DEFAULT_BOUNDS[id] || DEFAULT_BOUNDS.sst;
}

function buildLayers() {
  var cb = '?v=' + DATE;   // cache-busting — يتغير مع كل تاريخ بيانات جديد
  LAYERS = {
    sst: {
      label: "حرارة السطح (°C)",
      img:   TILES_BASE + DATE + "/sst.png" + cb,
      bounds: layerBounds('sst'),
      valuesUrl: TILES_BASE + DATE + "/sst_values.json" + cb,
      unit: "°C",
    },
    ssh: {
      label: "شفافية المياه",
      img:   TILES_BASE + DATE + "/color.png" + cb,
      bounds: layerBounds('ssh'),
      valuesUrl: TILES_BASE + DATE + "/color_values.json" + cb,
      unit: "",
    },
  };
}

// ============================================================
// تبديل الطبقات
// ============================================================

function switchLayer(id, tabEl) {
  var cfg = LAYERS[id];
  if (!cfg) return;
  currentLayerId = id;

  document.querySelectorAll('.layer-tab:not(#dangers-tab)').forEach(function(t){
    t.classList.remove('active');
  });
  if (tabEl) tabEl.classList.add('active');
  document.getElementById('active-label').textContent = cfg.label;
  document.getElementById('loading-bar').style.display = 'flex';
  document.getElementById('loading-text').textContent = 'جاري تحميل ' + cfg.label + '...';
  document.getElementById('dangers-dropdown').style.display = 'none';

  if (currentOverlay) { map.removeLayer(currentOverlay); currentOverlay = null; }
  currentValuesData = null; // نفرّغها لحد ما تتحمل قيم الطبقة الجديدة (أو تفشل بصمت)

  if (cfg.valuesUrl) {
    fetch(cfg.valuesUrl)
      .then(function(r) { if (!r.ok) throw new Error('no values'); return r.json(); })
      .then(function(d) { currentValuesData = d; })
      .catch(function() { currentValuesData = null; /* الطبقة تعمل بدون أرقام حقيقية */ });
  }

  if (cfg.tiles) {
    currentOverlay = L.tileLayer(cfg.tiles, {
      opacity: currentOpacity, minZoom: 6, maxZoom: 12, tms: cfg.tms || false,
    }).addTo(map);
    currentOverlay.on('load', function() {
      document.getElementById('loading-bar').style.display = 'none';
    });
    document.getElementById('loading-bar').style.display = 'none';
  } else {
    var img = new Image();
    img.onload = function() {
      currentOverlay = L.imageOverlay(cfg.img, cfg.bounds, {opacity:currentOpacity}).addTo(map);
      document.getElementById('loading-bar').style.display = 'none';
    };
    img.onerror = function() {
      document.getElementById('loading-text').textContent =
        'تعذر تحميل الطبقة — تحقق من المسار: ' + cfg.img;
      hideLoadingBar();
    };
    img.src = cfg.img;
  }
}

function setOpacity(val) {
  currentOpacity = parseFloat(val);
  if (currentOverlay) currentOverlay.setOpacity(currentOpacity);
}

// أحداث الخريطة
map.on('zoomend', function() {
  document.getElementById('info-zoom').textContent = map.getZoom();
});

// ============================================================
// قراءة القيم الحقيقية من ملف JSON (يستبدل تخمين الألوان القديم)
// ============================================================

function getRealValueAtLatLng(latlng) {
  var d = currentValuesData;
  if (!d || !d.bounds || !d.values) return null;
  var b = d.bounds;
  if (latlng.lat > b.north || latlng.lat < b.south ||
      latlng.lng < b.west  || latlng.lng > b.east) return null;

  var row = Math.round((latlng.lat - b.north) / d.lat_step);
  var col = Math.round((latlng.lng - b.west)  / d.lon_step);
  if (row < 0 || row >= d.height || col < 0 || col >= d.width) return null;

  var v = d.values[row][col];
  return (v === null || v === undefined) ? null : v;
}

map.on('mousemove', function(e) {
  document.getElementById('info-lat').textContent = e.latlng.lat.toFixed(4)+'N';
  document.getElementById('info-lon').textContent = e.latlng.lng.toFixed(4)+'E';

  var tt = document.getElementById('map-tooltip');
  if (!tt) return;
  var val = getRealValueAtLatLng(e.latlng);
  if (val !== null) {
    var cfg = LAYERS[currentLayerId] || {};
    tt.style.display = 'block';
    tt.textContent   = val + (cfg.unit ? (' ' + cfg.unit) : '');
    var cp = map.latLngToContainerPoint(e.latlng);
    tt.style.left = (cp.x + 14) + 'px';
    tt.style.top  = (cp.y - 10) + 'px';
  } else {
    tt.style.display = 'none';
  }
});
map.on('mouseout', function() {
  var tt = document.getElementById('map-tooltip');
  if (tt) tt.style.display = 'none';
});

// ============================================================
// GPS
// ============================================================

var gpsMarker = null, gpsCircle = null, gpsWatchId = null, gpsActive = false;
var gpsLat = null, gpsLon = null, gpsHeading = 0;

// بعض خطوط الإيموجي ترسم 🚢 متجهة لجهة مختلفة عن "شمال=0°" —
// إذا لاحظت إن السفينة تشير بعكس اتجاه حركتها فعلياً، جرّب تبدّل هالرقم (0 / 90 / 180 / -90)
var BOAT_ICON_ROTATION_OFFSET = 0;

function bearingBetween(lat1, lon1, lat2, lon2) {
  var toRad = Math.PI / 180;
  var y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
  var x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
          Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
  var brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

function distanceMetersGPS(lat1, lon1, lat2, lon2) {
  var R = 6371000, toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildBoatIcon(heading) {
  // قارب مرسوم من منظور علوي: مقدمة مدببة (البروة) للأعلى = هذا هو اتجاه 0° (شمال)
  var svg = '<svg width="26" height="40" viewBox="0 0 26 40" xmlns="http://www.w3.org/2000/svg">'
    + '<polygon points="13,1 20,15 18,36 8,36 6,15" fill="#06d6a0" stroke="#ffffff" stroke-width="1.6"/>'
    + '<line x1="13" y1="8" x2="13" y2="30" stroke="#ffffff" stroke-width="1" opacity="0.5"/>'
    + '</svg>';
  return L.divIcon({
    className: '',
    html: '<div class="gps-boat" style="'
        + 'width:26px;height:40px;'
        + 'transform:rotate(' + (heading + BOAT_ICON_ROTATION_OFFSET) + 'deg);'
        + 'transform-origin:center center;'
        + 'filter:drop-shadow(0 2px 3px rgba(0,0,0,0.6));'
        + 'transition:transform 0.4s ease;">' + svg + '</div>',
    iconSize: [26, 40], iconAnchor: [13, 20]
  });
}

function rotateBoatIcon(marker, heading) {
  var el = marker.getElement();
  if (!el) return;
  var inner = el.querySelector('.gps-boat');
  if (inner) inner.style.transform = 'rotate(' + (heading + BOAT_ICON_ROTATION_OFFSET) + 'deg)';
}

function toggleGPS() { gpsActive ? stopGPS() : startGPS(); }

function startGPS() {
  if (!navigator.geolocation) { alert('المتصفح لا يدعم GPS'); return; }
  var btn = document.getElementById('gps-btn');
  btn.textContent = '...';
  gpsWatchId = navigator.geolocation.watchPosition(function(pos) {
    var lat = pos.coords.latitude, lon = pos.coords.longitude, acc = pos.coords.accuracy;

    // تحديد الاتجاه: أولوية لـ heading من رقاقة GPS نفسها (أدق)، وإلا نحسبه من آخر نقطتين
    var heading = gpsHeading;
    if (pos.coords.heading !== null && pos.coords.heading !== undefined && !isNaN(pos.coords.heading)) {
      heading = pos.coords.heading;
    } else if (gpsLat !== null && gpsLon !== null) {
      var moved = distanceMetersGPS(gpsLat, gpsLon, lat, lon);
      if (moved >= 3) { // نتجاهل اهتزاز GPS الطبيعي وقت الوقوف
        heading = bearingBetween(gpsLat, gpsLon, lat, lon);
      }
    }
    gpsHeading = heading;
    gpsLat = lat; gpsLon = lon;

    if (!gpsMarker) {
      gpsMarker = L.marker([lat,lon], {icon:buildBoatIcon(heading), zIndexOffset:1000})
        .addTo(map).bindPopup('موقعك الحالي');
      gpsCircle = L.circle([lat,lon], {
        radius:acc, color:'#06d6a0', fillColor:'#06d6a0', fillOpacity:0.1, weight:1
      }).addTo(map);
      map.setView([lat,lon], 12);
    } else {
      gpsMarker.setLatLng([lat,lon]);
      gpsCircle.setLatLng([lat,lon]);
      gpsCircle.setRadius(acc);
      rotateBoatIcon(gpsMarker, heading);
    }
    document.getElementById('info-lat').textContent = lat.toFixed(4)+'N';
    document.getElementById('info-lon').textContent = lon.toFixed(4)+'E';
    document.getElementById('info-gps').textContent = Math.round(acc)+'m';
    btn.textContent = 'GPS نشط';
    btn.classList.add('gps-on');
    gpsActive = true;
  }, function(err) {
    document.getElementById('gps-btn').textContent = 'GPS';
    alert('تعذر تحديد الموقع: ' + err.message);
  }, { enableHighAccuracy:true, maximumAge:5000, timeout:15000 });
}

function stopGPS() {
  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
  if (gpsMarker)  { map.removeLayer(gpsMarker); gpsMarker = null; }
  if (gpsCircle)  { map.removeLayer(gpsCircle); gpsCircle = null; }
  var btn = document.getElementById('gps-btn');
  btn.textContent = 'GPS';
  btn.classList.remove('gps-on');
  document.getElementById('info-gps').textContent = '--';
  gpsActive = false; gpsWatchId = null;
  gpsLat = null; gpsLon = null; gpsHeading = 0;
}
