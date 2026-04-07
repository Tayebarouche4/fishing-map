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
var overlayBounds   = null;
var overlayCanvas   = null;

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
  LAYERS = {
    sst: {
      label: "حرارة السطح (°C)",
      img:   TILES_BASE + DATE + "/sst.png",
      bounds: layerBounds('sst'),
    },
    ssh: {
      label: "شفافية المياه",
      img:   TILES_BASE + DATE + "/color.png",
      bounds: layerBounds('ssh'),
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
  document.getElementById('legend').style.display = 'block';

  if (currentOverlay) { map.removeLayer(currentOverlay); currentOverlay = null; }
  drawLegend(id);

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
      loadOverlayCanvas(cfg.img, cfg.bounds);
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

map.on('mousemove', function(e) {
  document.getElementById('info-lat').textContent = e.latlng.lat.toFixed(4)+'N';
  document.getElementById('info-lon').textContent = e.latlng.lng.toFixed(4)+'E';
  var val = getValueAtPoint(e.latlng);
  var tt  = document.getElementById('map-tooltip');
  var sc  = LAYER_SCALES[currentLayerId];
  if (val !== null && sc) {
    tt.style.display = 'block';
    tt.textContent   = val + ' ' + sc.unit;
    var cp = map.latLngToContainerPoint(e.latlng);
    tt.style.left = (cp.x + 14) + 'px';
    tt.style.top  = (cp.y - 10) + 'px';
  } else {
    tt.style.display = 'none';
  }
});
map.on('mouseout', function() {
  document.getElementById('map-tooltip').style.display = 'none';
});

// ============================================================
// سلم الألوان وقراءة قيم البكسل
// ============================================================

var LAYER_SCALES = {
  sst:  { label:"حرارة السطح °C",   vmin:13,   vmax:28,  unit:"°C", colormap:"sst"   },
  ssh:  { label:"شفافية المياه",     vmin:-0.3, vmax:0.3, unit:"m",  colormap:"ssh"   },
  vhm0: { label:"ارتفاع الأمواج m", vmin:0,    vmax:3,   unit:"m",  colormap:"waves" },
};

function drawLegend(id) {
  var sc = LAYER_SCALES[id]; if (!sc) return;
  document.getElementById('legend-title').textContent = sc.label;
  document.getElementById('legend-min').textContent   = sc.vmin + ' ' + sc.unit;
  document.getElementById('legend-max').textContent   = sc.vmax + ' ' + sc.unit;
  var canvas = document.getElementById('legend-bar');
  var ctx    = canvas.getContext('2d');
  var grad   = ctx.createLinearGradient(0, 0, canvas.width, 0);
  if (sc.colormap === 'sst') {
    grad.addColorStop(0,    '#0000ff');
    grad.addColorStop(0.25, '#00ffff');
    grad.addColorStop(0.5,  '#00ff00');
    grad.addColorStop(0.75, '#ffff00');
    grad.addColorStop(1,    '#ff0000');
  } else if (sc.colormap === 'ssh') {
    grad.addColorStop(0,   '#0000ff');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1,   '#ff0000');
  } else if (sc.colormap === 'waves') {
    grad.addColorStop(0,   '#ffffff');
    grad.addColorStop(0.5, '#87ceeb');
    grad.addColorStop(1,   '#0000ff');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function getValueAtPoint(latlng) {
  var sc = LAYER_SCALES[currentLayerId];
  if (!sc || !overlayBounds) return null;
  var latMin = overlayBounds[0][0], lonMin = overlayBounds[0][1];
  var latMax = overlayBounds[1][0], lonMax = overlayBounds[1][1];
  if (latlng.lat < latMin || latlng.lat > latMax ||
      latlng.lng < lonMin || latlng.lng > lonMax) return null;
  if (!overlayCanvas) return null;
  var ctx = overlayCanvas.getContext('2d');
  var x   = Math.floor((latlng.lng - lonMin) / (lonMax - lonMin) * overlayCanvas.width);
  var y   = Math.floor((latMax - latlng.lat) / (latMax - latMin) * overlayCanvas.height);
  var px  = ctx.getImageData(x, y, 1, 1).data;
  if (px[3] < 10) return null;
  var r = px[0]/255, g = px[1]/255, b = px[2]/255;
  var norm;
  if (sc.colormap === 'sst') {
    if (b > 0.5 && r < 0.1) norm = 0.125 * g;
    else if (g > 0.9 && b > 0.1) norm = 0.25 + 0.25 * (1-b);
    else if (g > 0.9 && r < 0.1) norm = 0.5 * g;
    else if (r > 0.9 && g > 0.5) norm = 0.5 + 0.25 * r;
    else norm = 0.75 + 0.25 * (1-g);
  } else if (sc.colormap === 'ssh') {
    if (b > r) norm = 0.5 * (1 - b);
    else norm = 0.5 + 0.5 * r;
  } else {
    norm = 1 - b;
  }
  norm = Math.max(0, Math.min(1, norm));
  return (sc.vmin + norm * (sc.vmax - sc.vmin)).toFixed(2);
}

function loadOverlayCanvas(imgUrl, bounds) {
  overlayBounds = bounds;
  overlayCanvas = document.createElement('canvas');
  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function() {
    overlayCanvas.width  = img.width;
    overlayCanvas.height = img.height;
    overlayCanvas.getContext('2d').drawImage(img, 0, 0);
  };
  img.src = imgUrl;
}

// ============================================================
// GPS
// ============================================================

var gpsMarker = null, gpsCircle = null, gpsWatchId = null, gpsActive = false;
var gpsLat = null, gpsLon = null;

function toggleGPS() { gpsActive ? stopGPS() : startGPS(); }

function startGPS() {
  if (!navigator.geolocation) { alert('المتصفح لا يدعم GPS'); return; }
  var btn = document.getElementById('gps-btn');
  btn.textContent = '...';
  gpsWatchId = navigator.geolocation.watchPosition(function(pos) {
    var lat = pos.coords.latitude, lon = pos.coords.longitude, acc = pos.coords.accuracy;
    gpsLat = lat; gpsLon = lon;
    var icon = L.divIcon({
      className:'',
      html:'<div class="gps-pulse"></div>',
      iconSize:[18,18], iconAnchor:[9,9]
    });
    if (!gpsMarker) {
      gpsMarker = L.marker([lat,lon], {icon:icon, zIndexOffset:1000})
        .addTo(map).bindPopup('موقعك الحالي');
      gpsCircle = L.circle([lat,lon], {
        radius:acc, color:'#06d6a0', fillColor:'#06d6a0', fillOpacity:0.1, weight:1
      }).addTo(map);
      map.setView([lat,lon], 12);
    } else {
      gpsMarker.setLatLng([lat,lon]);
      gpsCircle.setLatLng([lat,lon]);
      gpsCircle.setRadius(acc);
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
  gpsLat = null; gpsLon = null;
}
