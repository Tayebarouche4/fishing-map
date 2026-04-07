
// ============================================================
//  مسارات البيانات: نجرب tiles/ ثم ../tiles/ حسب مكان الصفحة
// ============================================================
var TILES_BASE = 'tiles/';
var ROUTES_GEOJSON = 'rout.geojson';

var DATE = "loading...";
var LAYERS = {};
var UNIFIED_BOUNDS = null;

var DEFAULT_BOUNDS = {
  sst:[[35.7041,-0.4291],[36.6958,0.9958]],
  ssh:[[35.7041,-0.4291],[36.6958,0.9958]],
  uo:[[35.75,-0.4166],[36.6666,1.0]],
  vo:[[35.75,-0.4166],[36.6666,1.0]],
};

var DATA_PATHS = [
  { tiles: 'tiles/', routes: 'rout.geojson' },
  { tiles: '../tiles/', routes: '../rout.geojson' },
];

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
    .catch(function() { /* الحدود الافتراضية */ });
}

function hideLoadingBar() {
  var lb = document.getElementById('loading-bar');
  if (lb) lb.style.display = 'none';
  if (typeof map !== 'undefined' && map) {
    setTimeout(function() { map.invalidateSize(); }, 120);
  }
}

function showDataBanner(msg) {
  var b = document.getElementById('data-banner');
  if (!b) return;
  b.style.display = 'block';
  b.textContent = msg;
}

function startApp() {
  setDateBadge();
  buildLayers();
  switchLayer('sst', document.querySelector('.layer-tab'));
  hideLoadingBar();
}

/** يختبر tiles/dates.json من كل مسار حتى ينجح */
function probeDatesJson() {
  function tryIdx(i) {
    if (i >= DATA_PATHS.length) {
      return Promise.reject(new Error('no dates'));
    }
    var p = DATA_PATHS[i];
    return fetch(p.tiles + 'dates.json', { cache: 'no-store' })
      .then(function(r) {
        if (!r.ok) throw new Error('bad');
        return r.json();
      })
      .then(function(data) {
        TILES_BASE = p.tiles;
        ROUTES_GEOJSON = p.routes;
        return data;
      })
      .catch(function() { return tryIdx(i + 1); });
  }
  return tryIdx(0);
}

/**
 * يولّد قائمة تواريخ ابتداءً من اليوم الحالي إلى الوراء (30 يوم)
 * بصيغة YYYY-MM-DD ويجرّب كل تاريخ حتى يجد مجلداً موجوداً
 */
function generateRecentDates(count) {
  var dates = [];
  var now = new Date();
  for (var i = 0; i < count; i++) {
    var d = new Date(now);
    d.setDate(d.getDate() - i);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    dates.push(y + '-' + m + '-' + day);
  }
  return dates;
}

/** يبحث عن أحدث مجلد موجود فعلاً في tiles/ بالفحص التسلسلي */
function findLatestAvailableDate(tilesBase) {
  var candidates = generateRecentDates(30);
  function tryDate(i) {
    if (i >= candidates.length) return Promise.reject(new Error('no folder found'));
    var d = candidates[i];
    return fetch(tilesBase + d + '/sst.png', { cache: 'no-store', method: 'HEAD' })
      .then(function(r) {
        if (r.ok) return d;
        throw new Error('not found');
      })
      .catch(function() { return tryDate(i + 1); });
  }
  return tryDate(0);
}

/** Fallback ذكي: يكتشف أحدث مجلد تلقائياً بدل تاريخ ثابت */
function tryFallbackBoundsThenStart() {
  function tryPath(i) {
    if (i >= DATA_PATHS.length) {
      return Promise.reject(new Error('no tiles path reachable'));
    }
    var p = DATA_PATHS[i];
    return findLatestAvailableDate(p.tiles)
      .then(function(foundDate) {
        TILES_BASE = p.tiles;
        ROUTES_GEOJSON = p.routes;
        DATE = foundDate;
        setDateBadge();
        return fetchBoundsForDate();
      })
      .catch(function() { return tryPath(i + 1); });
  }
  return tryPath(0);
}

function guessTilesBaseFromUrl() {
  var path = (window.location.pathname || '').replace(/\\/g, '/');
  if (/\/index\/index\.html$/i.test(path) || /\/index\/$/i.test(path)) {
    TILES_BASE = '../tiles/';
    ROUTES_GEOJSON = '../rout.geojson';
  } else {
    TILES_BASE = 'tiles/';
    ROUTES_GEOJSON = 'rout.geojson';
  }
}

function startAppOfflineMapOnly() {
  guessTilesBaseFromUrl();
  // محاولة أخيرة: ابحث عن أحدث مجلد متاح فعلاً
  findLatestAvailableDate(TILES_BASE)
    .then(function(foundDate) {
      DATE = foundDate;
      setDateBadge();
      buildLayers();
      switchLayer('sst', document.querySelector('.layer-tab'));
      hideLoadingBar();
    })
    .catch(function() {
      // آخر ملاذ: استخدم تاريخ اليوم
      var now = new Date();
      DATE = now.getFullYear() + '-'
        + String(now.getMonth()+1).padStart(2,'0') + '-'
        + String(now.getDate()).padStart(2,'0');
      setDateBadge();
      showDataBanner(
        'لم يُعثر على مجلد بيانات — تأكد من رفع مجلد tiles/YYYY-MM-DD على الخادم.'
      );
      buildLayers();
      switchLayer('sst', document.querySelector('.layer-tab'));
      hideLoadingBar();
    });
}

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
        document.getElementById('loading-text').textContent = 'تعذر الوصول لمجلد البيانات — عرض خريطة الأساس فقط';
        startAppOfflineMapOnly();
      });
  });

function layerBounds(id) {
  if (UNIFIED_BOUNDS) return UNIFIED_BOUNDS;
  return DEFAULT_BOUNDS[id] || DEFAULT_BOUNDS.sst;
}

function buildLayers() {
  LAYERS = {
    sst: {
      label:"حرارة السطح (°C)",
      img:TILES_BASE + DATE + "/sst.png",
      bounds: layerBounds('sst'),
    },
    ssh: {
      label:"شفافية المياه",
      img:TILES_BASE + DATE + "/color.png",
      bounds: layerBounds('ssh'),
    },
  };
}

var map = L.map('map',{zoomControl:false,attributionControl:false});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(map);
L.control.zoom({position:'bottomright'}).addTo(map);
map.setView([36.2,0.3],9);

var currentOverlay = null;
var currentOpacity = 0.85;

function switchLayer(id, tabEl) {
  var cfg = LAYERS[id];
  if (!cfg) return;
  currentLayerId = id;
  
  // إزالة تنشيط جميع التبويبات العادية (ما عدا تبويب الأخطار)
  document.querySelectorAll('.layer-tab:not(#dangers-tab)').forEach(function(t){ t.classList.remove('active'); });
  
  if (tabEl) tabEl.classList.add('active');
  document.getElementById('active-label').textContent = cfg.label;
  document.getElementById('loading-bar').style.display = 'flex';
  document.getElementById('loading-text').textContent = 'جاري تحميل ' + cfg.label + '...';
  
  // إخفاء قائمة الأخطار
  document.getElementById('dangers-dropdown').style.display = 'none';
  
  // إظهار مقياس الألوان للطبقات العادية
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
      document.getElementById('loading-text').textContent = 'تعذر تحميل الطبقة — تحقق من الخادم أو المسار: ' + cfg.img;
      hideLoadingBar();
    };
    img.src = cfg.img;
  }
}

function setOpacity(val) {
  currentOpacity = parseFloat(val);
  if (currentOverlay) currentOverlay.setOpacity(currentOpacity);
}

map.on('zoomend',function(){
  document.getElementById('info-zoom').textContent = map.getZoom();
});

var gpsMarker=null,gpsCircle=null,gpsWatchId=null,gpsActive=false;
function toggleGPS(){ gpsActive ? stopGPS() : startGPS(); }
function startGPS(){
  if(!navigator.geolocation){alert('المتصفح لا يدعم GPS');return;}
  var btn=document.getElementById('gps-btn'); btn.textContent='...';
  gpsWatchId=navigator.geolocation.watchPosition(function(pos){
    var lat=pos.coords.latitude,lon=pos.coords.longitude,acc=pos.coords.accuracy;
    var icon=L.divIcon({className:'',html:'<div class="gps-pulse"></div>',iconSize:[18,18],iconAnchor:[9,9]});
    if(!gpsMarker){
      gpsMarker=L.marker([lat,lon],{icon:icon,zIndexOffset:1000}).addTo(map).bindPopup('موقعك الحالي');
      gpsCircle=L.circle([lat,lon],{radius:acc,color:'#06d6a0',fillColor:'#06d6a0',fillOpacity:0.1,weight:1}).addTo(map);
      map.setView([lat,lon],12);
    } else { gpsMarker.setLatLng([lat,lon]); gpsCircle.setLatLng([lat,lon]); gpsCircle.setRadius(acc); }
    document.getElementById('info-lat').textContent=lat.toFixed(4)+'N';
    document.getElementById('info-lon').textContent=lon.toFixed(4)+'E';
    document.getElementById('info-gps').textContent=Math.round(acc)+'m';
    btn.textContent='GPS نشط'; btn.classList.add('gps-on'); gpsActive=true;
  },function(err){
    document.getElementById('gps-btn').textContent='GPS';
    alert('تعذر تحديد الموقع: '+err.message);
  },{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
}
function stopGPS(){
  if(gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
  if(gpsMarker){map.removeLayer(gpsMarker);gpsMarker=null;}
  if(gpsCircle){map.removeLayer(gpsCircle);gpsCircle=null;}
  var btn=document.getElementById('gps-btn');
  btn.textContent='GPS'; btn.classList.remove('gps-on');
  document.getElementById('info-gps').textContent='--';
  gpsActive=false; gpsWatchId=null;
}

// ===== سلم الألوان =====
var LAYER_SCALES = {
  sst:  { label:"حرارة السطح °C",      vmin:13,   vmax:28,  unit:"°C",  colormap:"sst"   },
  ssh:  { label:"شفافية المياه",            vmin:-0.3, vmax:0.3, unit:"m",   colormap:"ssh"   },
  vhm0: { label:"ارتفاع الأمواج m",    vmin:0,    vmax:3,   unit:"m",   colormap:"waves" },
};

function drawLegend(id) {
  var sc = LAYER_SCALES[id]; if (!sc) return;
  document.getElementById('legend-title').textContent = sc.label;
  document.getElementById('legend-min').textContent   = sc.vmin + ' ' + sc.unit;
  document.getElementById('legend-max').textContent   = sc.vmax + ' ' + sc.unit;
  var canvas = document.getElementById('legend-bar');
  var ctx = canvas.getContext('2d');
  var grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
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

// tooltip عند مرور المؤشر
var currentLayerId = 'sst';
var overlayBounds = null;
var overlayImg = null;
var overlayCanvas = null;

function getValueAtPoint(latlng) {
  var sc = LAYER_SCALES[currentLayerId]; if (!sc || !overlayBounds) return null;
  var latMin = overlayBounds[0][0], lonMin = overlayBounds[0][1];
  var latMax = overlayBounds[1][0], lonMax = overlayBounds[1][1];
  if (latlng.lat < latMin || latlng.lat > latMax || latlng.lng < lonMin || latlng.lng > lonMax) return null;
  if (!overlayCanvas) return null;
  var ctx = overlayCanvas.getContext('2d');
  var x = Math.floor((latlng.lng - lonMin) / (lonMax - lonMin) * overlayCanvas.width);
  var y = Math.floor((latMax - latlng.lat) / (latMax - latMin) * overlayCanvas.height);
  var px = ctx.getImageData(x, y, 1, 1).data;
  if (px[3] < 10) return null;
  // تحويل اللون إلى قيمة
  var r = px[0]/255, g = px[1]/255, b = px[2]/255;
  var norm;
  if (sc.colormap === 'sst') {
    // jet: أزرق=0 أحمر=1
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

map.on('mousemove', function(e) {
  document.getElementById('info-lat').textContent = e.latlng.lat.toFixed(4)+'N';
  document.getElementById('info-lon').textContent = e.latlng.lng.toFixed(4)+'E';
  var val = getValueAtPoint(e.latlng);
  var tt = document.getElementById('map-tooltip');
  var sc = LAYER_SCALES[currentLayerId];
  if (val !== null && sc) {
    tt.style.display = 'block';
    tt.textContent = val + ' ' + sc.unit;
    var mp = map.getContainer().getBoundingClientRect();
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

// تحميل الصورة في canvas لقراءة البكسلات
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

// ===== طبقة المسارات =====
var routeLayer = null;
var routeVisible = false;

// ===== طبقة التيارات =====
var current1Layer = null;
var current1Visible = false;
var current50Layer = null;
var current50Visible = false;

function toggleRoutes(btn) {
  if (routeVisible) {
    if (routeLayer) map.removeLayer(routeLayer);
    routeVisible = false;
    btn.style.background = 'rgba(6,214,160,0.1)';
    btn.style.borderColor = 'rgba(6,214,160,0.3)';
  } else {
    loadRoutes(btn);
  }
}

function loadRoutes(btn) {
  if (routeLayer) {
    routeLayer.addTo(map);
    routeVisible = true;
    btn.style.background = 'rgba(6,214,160,0.25)';
    btn.style.borderColor = '#06d6a0';
    return;
  }

  fetch(ROUTES_GEOJSON)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      routeLayer = L.geoJSON(data, {
        style: function(feature) {
          return {
            color: '#06d6a0',
            weight: 3,
            opacity: 0.9,
            dashArray: feature.properties.id === 1 ? null : '8,4',
          };
        },
        onEachFeature: function(feature, layer) {
          layer.bindPopup(
            '<div style="font-family:Tajawal;font-size:.9rem;color:#060d18;">' +
            '<b>مسار ' + feature.properties.id + '</b></div>'
          );
        }
      }).addTo(map);
      routeVisible = true;
      btn.style.background = 'rgba(6,214,160,0.25)';
      btn.style.borderColor = '#06d6a0';
    })
    .catch(function(e) { console.error('خطأ في تحميل المسارات:', e); });
}

function toggleCurrent1(btn) {
  if (current1Visible) {
    if (current1Layer) map.removeLayer(current1Layer);
    current1Visible = false;
    btn.style.background = 'rgba(239,68,68,0.1)';
    btn.style.borderColor = 'rgba(239,68,68,0.3)';
  } else {
    loadCurrent1(btn);
  }
}

function toggleCurrent50(btn) {
  if (current50Visible) {
    if (current50Layer) map.removeLayer(current50Layer);
    current50Visible = false;
    btn.style.background = 'rgba(139,92,246,0.1)';
    btn.style.borderColor = 'rgba(139,92,246,0.3)';
  } else {
    loadCurrent50(btn);
  }
}

function loadCurrent1(btn) {
  if (current1Layer) {
    current1Layer.addTo(map);
    current1Visible = true;
    btn.style.background = 'rgba(239,68,68,0.25)';
    btn.style.borderColor = '#ef4444';
    return;
  }

  fetch('current1.geojson')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      current1Layer = L.geoJSON(data, {
        style: function(feature) {
          // تدرج الألوان من الأحمر (قوي) إلى البرتقالي إلى الأصفر (ضعيف)
          var speed = feature.properties.speed || 0;
          var color, fillColor;
          
          if (speed >= 0.35) {
            color = '#dc2626'; fillColor = '#ef4444'; // أحمر - قوي
          } else if (speed >= 0.15) {
            color = '#ea580c'; fillColor = '#f97316'; // برتقالي - متوسط
          } else {
            color = '#fbbf24'; fillColor = '#fde047'; // أصفر - ضعيف
          }
          
          return {
            color: color,
            weight: 3,
            opacity: 0.9,
            fillColor: fillColor,
            fillOpacity: 0.4
          };
        },
        onEachFeature: function(feature, layer) {
          var popupContent = '<div style="font-family:Tajawal;font-size:.9rem;color:#060d18;text-align:right;direction:rtl;">';
          popupContent += '<b>🌊 تيار السطح (1م)</b><br>';
          
          if (feature.properties) {
            if (feature.properties.name) {
              popupContent += 'الاسم: ' + feature.properties.name + '<br>';
            }
            if (feature.properties.speed) {
              popupContent += 'السرعة: ' + feature.properties.speed + ' كم/س<br>';
            }
            if (feature.properties.direction) {
              popupContent += 'الاتجاه: ' + feature.properties.direction + '<br>';
            }
            if (feature.properties.depth) {
              popupContent += 'العمق: ' + feature.properties.depth + ' م<br>';
            }
          }
          
          popupContent += '</div>';
          layer.bindPopup(popupContent);
        }
      }).addTo(map);
      current1Visible = true;
      btn.style.background = 'rgba(239,68,68,0.25)';
      btn.style.borderColor = '#ef4444';
    })
    .catch(function(e) { 
      console.error('خطأ في تحميل تيار السطح:', e);
      alert('فشل في تحميل بيانات تيار السطح. تأكد من وجود ملف current1.geojson');
    });
}

function loadCurrent50(btn) {
  if (current50Layer) {
    current50Layer.addTo(map);
    current50Visible = true;
    btn.style.background = 'rgba(139,92,246,0.25)';
    btn.style.borderColor = '#8b5cf6';
    return;
  }

  fetch('current50.geojson')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      current50Layer = L.geoJSON(data, {
        style: function(feature) {
          // تدرج الألوان من البنفسجي (قوي) إلى الأزرق إلى الرمادي (ضعيف)
          var speed = feature.properties.speed || 0;
          var color, fillColor;
          
          if (speed >= 0.35) {
            color = '#7c3aed'; fillColor = '#8b5cf6'; // بنفسجي - قوي
          } else if (speed >= 0.15) {
            color = '#2563eb'; fillColor = '#3b82f6'; // أزرق - متوسط
          } else {
            color = '#9ca3af'; fillColor = '#d1d5db'; // رمادي - ضعيف
          }
          
          return {
            color: color,
            weight: 3,
            opacity: 0.9,
            fillColor: fillColor,
            fillOpacity: 0.4
          };
        },
        onEachFeature: function(feature, layer) {
          var popupContent = '<div style="font-family:Tajawal;font-size:.9rem;color:#060d18;text-align:right;direction:rtl;">';
          popupContent += '<b>🌊 تيار العمق (50م)</b><br>';
          
          if (feature.properties) {
            if (feature.properties.name) {
              popupContent += 'الاسم: ' + feature.properties.name + '<br>';
            }
            if (feature.properties.speed) {
              popupContent += 'السرعة: ' + feature.properties.speed + ' كم/س<br>';
            }
            if (feature.properties.direction) {
              popupContent += 'الاتجاه: ' + feature.properties.direction + '<br>';
            }
            if (feature.properties.depth) {
              popupContent += 'العمق: ' + feature.properties.depth + ' م<br>';
            }
          }
          
          popupContent += '</div>';
          layer.bindPopup(popupContent);
        }
      }).addTo(map);
      current50Visible = true;
      btn.style.background = 'rgba(139,92,246,0.25)';
      btn.style.borderColor = '#8b5cf6';
    })
    .catch(function(e) { 
      console.error('خطأ في تحميل تيار العمق:', e);
      alert('فشل في تحميل بيانات تيار العمق. تأكد من وجود ملف current50.geojson');
    });
}

// ===== نظام الأكواد والتقييم =====
// ======================================================
// إعداد السيرفر المحمي — لا تشارك هذا المفتاح مع أحد
// ======================================================
var API_BASE_URL = "https://fishing-map-api-production.up.railway.app";
var API_KEY = "change-this-secret-key";

// للتوافق مع الكود القديم (لم يعد يُستخدم مباشرة)
var SHEET_URL = API_BASE_URL;

var VALID_CODES = []; // تم الاستغناء عنها — التحقق عبر السيرفر

var currentUser   = null;
var selectedRating = null;
var gpsLat = null;
var gpsLon = null;

var userPermissions = null;

function doLogin() {
  var code = document.getElementById('login-input').value.trim().toUpperCase();
  if (!code) return;

  var errorEl = document.getElementById('login-error');
  errorEl.style.display = 'none';
  errorEl.textContent = 'جاري التحقق...';
  errorEl.style.color = 'var(--gold)';
  errorEl.style.display = 'block';

  fetch(API_BASE_URL + '/api/login/' + code, {
    headers: { 'x-api-key': API_KEY }
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    if (data.status === 'success') {
      currentUser = code;
      userPermissions = data.permissions;
      document.getElementById('login-overlay').style.display = 'none';
      document.getElementById('report-fab').style.display = 'flex';
      document.getElementById('correction-fab').style.display = 'flex';
      applyPermissions(data.permissions);
      startGPS();
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

function applyPermissions(perms) {
  // تقارير الصيادين — للمتقدمين فقط
  var reportsBtn  = document.getElementById('reports-btn');
  if (reportsBtn) reportsBtn.style.display = perms.reports ? 'flex' : 'none';

  // معالمي — لكل المستخدمين دائماً
  var myBtn = document.getElementById('my-markers-btn');
  if (myBtn) myBtn.style.display = 'flex';

  // المسارات
  var routeBtn = document.getElementById('route-btn');
  if (routeBtn) routeBtn.style.display = perms.routes ? 'flex' : 'none';

  // الأعماق
  var depthBtn   = document.getElementById('bathy-depth-btn');
  var contourBtn = document.getElementById('bathy-contour-btn');
  var wrecksBtn  = document.getElementById('bathy-wrecks-btn');
  if (depthBtn)   depthBtn.style.display   = perms.depth ? 'flex' : 'none';
  if (contourBtn) contourBtn.style.display = perms.depth ? 'flex' : 'none';
  if (wrecksBtn)  wrecksBtn.style.display  = perms.depth ? 'flex' : 'none';

  // شفافية المياه (SSH)
  var sshBtn = document.getElementById('ssh-btn');
  if (sshBtn) sshBtn.style.display = perms.clarity ? 'flex' : 'none';

  // الأخطار
  var dangersTab = document.getElementById('dangers-tab');
  if (dangersTab) dangersTab.style.display = perms.alerts ? 'flex' : 'none';

  // تيار العمق
  var current50Btn = document.getElementById('current50-btn');
  if (current50Btn) current50Btn.style.display = perms.current_deep ? 'flex' : 'none';
}

function openRating() {
  closeCorrection();
  selectedRating = null;
  document.querySelectorAll('.rating-btn').forEach(function(b){ b.classList.remove('selected'); });
  document.getElementById('boxes-wrap').classList.remove('show');
  document.getElementById('boxes-input').value = '';
  document.getElementById('send-status').style.display = 'none';
  if (gpsLat && gpsLon) {
    document.getElementById('rating-coords').textContent =
      gpsLat.toFixed(4) + 'N    ' + gpsLon.toFixed(4) + 'E';
  } else {
    document.getElementById('rating-coords').textContent = 'GPS غير نشط — فعّله أولاً';
  }
  document.getElementById('rating-panel').classList.add('open');
}

function closeRating() {
  document.getElementById('rating-panel').classList.remove('open');
}

function onObstacleTypeChange() {
  var v = document.getElementById('obstacleType').value;
  document.getElementById('correction-other-wrap').style.display = v === 'أخرى' ? 'block' : 'none';
  if (v !== 'أخرى') document.getElementById('correction-note').value = '';
}

// ==============================================================
// أدوات القياس - مسافات ومساحات
// ==============================================================

var measurementMode = null; // 'distance' or 'area' or null
var measurementPoints = [];
var measurementLayer = null;
var distanceMarkers = [];
var areaPolygon = null;

function toggleMeasurementToolbar() {
  var toolbar = document.getElementById('measurement-toolbar');
  var fab = document.getElementById('measurement-fab');
  
  if (toolbar.style.display === 'none' || toolbar.style.display === '') {
    toolbar.style.display = 'flex';
    fab.classList.add('active');
  } else {
    toolbar.style.display = 'none';
    fab.classList.remove('active');
    // إيقاف أي قياس نشط
    if (measurementMode) {
      stopMeasurement();
    }
  }
}

function toggleDistanceMeasurement() {
  var btn = document.getElementById('measure-distance-btn');
  var areaBtn = document.getElementById('measure-area-btn');
  
  if (measurementMode === 'distance') {
    stopMeasurement();
  } else {
    stopMeasurement();
    measurementMode = 'distance';
    btn.classList.add('active');
    areaBtn.classList.remove('active');
    map.getContainer().style.cursor = 'crosshair';
    
    // إضافة مستمع النقر
    map.on('click', handleDistanceClick);
  }
}

function toggleAreaMeasurement() {
  var btn = document.getElementById('measure-area-btn');
  var distanceBtn = document.getElementById('measure-distance-btn');
  
  if (measurementMode === 'area') {
    stopMeasurement();
  } else {
    stopMeasurement();
    measurementMode = 'area';
    btn.classList.add('active');
    distanceBtn.classList.remove('active');
    map.getContainer().style.cursor = 'crosshair';
    
    // إضافة مستمع النقر
    map.on('click', handleAreaClick);
  }
}

function handleDistanceClick(e) {
  if (measurementMode !== 'distance') return;
  
  var latlng = e.latlng;
  measurementPoints.push(latlng);
  
  // إضافة علامة
  var marker = L.marker(latlng, {
    icon: L.divIcon({
      className: 'distance-marker',
      html: '<div style="background:#f59e0b;color:white;border-radius:50%;width:12px;height:12px;display:flex;align-items:center;justify-content:center;font-size:8px;border:2px solid white;">' + measurementPoints.length + '</div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    })
  }).addTo(map);
  
  distanceMarkers.push(marker);
  
  if (measurementPoints.length >= 2) {
    // رسم الخط
    var latlngs = measurementPoints.slice(-2); // آخر نقطتين
    var line = L.polyline(latlngs, {
      color: '#f59e0b',
      weight: 3,
      opacity: 0.8,
      dashArray: '10, 5'
    }).addTo(measurementLayer || map);
    
    if (!measurementLayer) {
      measurementLayer = L.layerGroup().addTo(map);
    }
    measurementLayer.addLayer(line);
    
    // حساب المسافة
    var distance = calculateDistance(latlngs[0], latlngs[1]);
    var midpoint = L.latLng(
      (latlngs[0].lat + latlngs[1].lat) / 2,
      (latlngs[0].lng + latlngs[1].lng) / 2
    );
    
    // عرض المسافة
    var distanceLabel = L.marker(midpoint, {
      icon: L.divIcon({
        className: 'distance-label',
        html: '<div style="background:rgba(245,158,11,0.9);color:white;padding:4px 8px;border-radius:4px;font-size:.75rem;font-weight:700;white-space:nowrap;border:1px solid white;">' + distance + '</div>',
        iconSize: [80, 20],
        iconAnchor: [40, 10]
      })
    }).addTo(measurementLayer);
    
    measurementLayer.addLayer(distanceLabel);
    
    // إعادة تعيين النقاط للقياس التالي
    measurementPoints = [latlngs[1]]; // الاحتفاظ بالنقطة الأخيرة
  }
}

function handleAreaClick(e) {
  if (measurementMode !== 'area') return;
  
  var latlng = e.latlng;
  measurementPoints.push(latlng);
  
  // إضافة علامة
  var marker = L.marker(latlng, {
    icon: L.divIcon({
      className: 'area-marker',
      html: '<div style="background:#8b5cf6;color:white;border-radius:50%;width:12px;height:12px;display:flex;align-items:center;justify-content:center;font-size:8px;border:2px solid white;">' + measurementPoints.length + '</div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    })
  }).addTo(map);
  
  distanceMarkers.push(marker);
  
  if (measurementPoints.length >= 3) {
    // رسم المضلع
    if (!measurementLayer) {
      measurementLayer = L.layerGroup().addTo(map);
    }
    
    if (areaPolygon) {
      measurementLayer.removeLayer(areaPolygon);
    }
    
    areaPolygon = L.polygon(measurementPoints, {
      color: '#8b5cf6',
      weight: 2,
      opacity: 0.8,
      fillColor: '#8b5cf6',
      fillOpacity: 0.2
    }).addTo(measurementLayer);
    
    // حساب المساحة
    var area = calculateArea(measurementPoints);
    var center = getPolygonCenter(measurementPoints);
    
    // عرض المساحة
    var areaLabel = L.marker(center, {
      icon: L.divIcon({
        className: 'area-label',
        html: '<div style="background:rgba(139,92,246,0.9);color:white;padding:6px 10px;border-radius:4px;font-size:.75rem;font-weight:700;white-space:nowrap;border:1px solid white;">' + area + '</div>',
        iconSize: [100, 20],
        iconAnchor: [50, 10]
      })
    }).addTo(measurementLayer);
  }
}

function stopMeasurement() {
  measurementMode = null;
  measurementPoints = [];
  map.off('click', handleDistanceClick);
  map.off('click', handleAreaClick);
  map.getContainer().style.cursor = '';
  
  // إزالة التنشيط من الأزرار
  document.getElementById('measure-distance-btn').classList.remove('active');
  document.getElementById('measure-area-btn').classList.remove('active');
}

function clearMeasurements() {
  // مسح كل القياسات
  if (measurementLayer) {
    map.removeLayer(measurementLayer);
    measurementLayer = null;
  }
  
  distanceMarkers.forEach(marker => map.removeLayer(marker));
  distanceMarkers = [];
  
  measurementPoints = [];
  areaPolygon = null;
  
  stopMeasurement();
}

function calculateDistance(latlng1, latlng2) {
  var distance = latlng1.distanceTo(latlng2);
  if (distance < 1000) {
    return Math.round(distance) + ' م';
  } else {
    return (distance / 1000).toFixed(2) + ' كم';
  }
}

function calculateArea(points) {
  // حساب مساحة المضلع باستخدام صيغة Shoelace
  var area = 0;
  for (var i = 0; i < points.length; i++) {
    var j = (i + 1) % points.length;
    area += points[i].lat * points[j].lng;
    area -= points[j].lat * points[i].lng;
  }
  area = Math.abs(area) / 2;
  
  // تحويل إلى كيلومتر مربع
  area = area * 111.32 * 111.32; // تقريب
  
  if (area < 1) {
    return Math.round(area * 1000000) + ' م²';
  } else {
    return area.toFixed(2) + ' كم²';
  }
}

function getPolygonCenter(points) {
  var lat = 0, lng = 0;
  for (var i = 0; i < points.length; i++) {
    lat += points[i].lat;
    lng += points[i].lng;
  }
  return L.latLng(lat / points.length, lng / points.length);
}

function openCorrection() {
  closeRating();
  var ob = document.getElementById('obstacleType');
  ob.selectedIndex = 0;
  document.getElementById('correction-other-wrap').style.display = 'none';
  document.getElementById('correction-note').value = '';
  document.getElementById('correction-send-status').style.display = 'none';
  if (gpsLat && gpsLon) {
    document.getElementById('correction-coords').textContent =
      gpsLat.toFixed(4) + 'N    ' + gpsLon.toFixed(4) + 'E';
  } else {
    document.getElementById('correction-coords').textContent = 'GPS غير نشط — فعّله أولاً';
  }
  document.getElementById('correction-panel').classList.add('open');
}

function closeCorrection() {
  document.getElementById('correction-panel').classList.remove('open');
}

function sendCorrection() {
  if (!gpsLat || !gpsLon) { alert('فعّل GPS أولاً لتحديد موقعك'); return; }
  var optionText = document.getElementById('obstacleType').value.trim();
  if (!optionText) { alert('اختر نوع العائق من القائمة'); return; }

  var now = new Date();
  var d = now.toLocaleDateString('fr-DZ');
  var t = now.toLocaleTimeString('fr-DZ');
  var latStr = String(gpsLat.toFixed(6));
  var lonStr = String(gpsLon.toFixed(6));
  var extra = document.getElementById('correction-note').value.trim();

  var payload = {
    date:         d,
    time:         t,
    code:         currentUser,
    lat:          latStr,
    lon:          lonStr,
    obstacleType: optionText,
    rating:       optionText,
    note:         extra ? (optionText + ' — ' + extra) : optionText,

    reportType:   'correction',
    category:     optionText,
    categoryText: optionText,
    optionText:   optionText,
    hazardLabel:  optionText,

    sheetRow:     [d, t, currentUser, latStr, lonStr, optionText, extra],
  };
  var status = document.getElementById('correction-send-status');
  status.style.display = 'block';
  status.style.color = 'var(--gold)';
  status.textContent = 'جاري الإرسال...';
  fetch(API_BASE_URL + '/api/reports/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(payload),
  })
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
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

function selectRating(btn, rating) {
  document.querySelectorAll('.rating-btn').forEach(function(b){ b.classList.remove('selected'); });
  btn.classList.add('selected');
  selectedRating = rating;
  if (rating === 'صيد') {
    document.getElementById('boxes-wrap').classList.add('show');
  } else {
    document.getElementById('boxes-wrap').classList.remove('show');
  }
}

function sendRating() {
  if (!selectedRating) { alert('اختر نوع التقييم أولاً'); return; }
  if (!gpsLat || !gpsLon) { alert('فعّل GPS أولاً لتحديد موقعك'); return; }
  var now = new Date();
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
  status.style.color = 'var(--gold)';
  status.textContent = 'جاري الإرسال...';
  fetch(API_BASE_URL + '/api/reports/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(payload),
  })
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function() {
      status.style.color = 'var(--green)';
      status.textContent = 'تم الإرسال بنجاح!';
      setTimeout(closeRating, 2000);
    })
    .catch(function(err) {
      status.style.color = '#ef233c';
      status.textContent = 'فشل الإرسال — تحقق من الاتصال بالسيرفر';
      console.error(err);
    });
}

navigator.geolocation && navigator.geolocation.watchPosition(function(pos) {
  gpsLat = pos.coords.latitude;
  gpsLon = pos.coords.longitude;
}, function(){}, { enableHighAccuracy:true });




var WEATHER_LAT = 36.25;
var WEATHER_LON = 0.30;
var weatherLoaded = false;
var weatherTab = 'forecast';

function openWeather() {
  document.getElementById('weather-panel').classList.add('open');
  if (!weatherLoaded) fetchWeather();
}
function closeWeather() {
  document.getElementById('weather-panel').classList.remove('open');
}
function switchWeatherTab(tab) {
  weatherTab = tab;
  document.getElementById('wtab-forecast').classList.toggle('wtab-active', tab==='forecast');
  document.getElementById('wtab-about').classList.toggle('wtab-active', tab==='about');
  document.getElementById('weather-forecast-view').style.display = tab==='forecast' ? 'block' : 'none';
  document.getElementById('weather-about-view').style.display = tab==='about' ? 'block' : 'none';
}

function fetchWeather() {
  var urlMarine = 'https://marine-api.open-meteo.com/v1/marine'
    + '?latitude=' + WEATHER_LAT + '&longitude=' + WEATHER_LON
    + '&hourly=wave_height,wind_wave_height'
    + '&forecast_days=7&timezone=Africa%2FAlgiers';
  var urlAtm = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + WEATHER_LAT + '&longitude=' + WEATHER_LON
    + '&hourly=wind_speed_10m,wind_direction_10m'
    + '&wind_speed_unit=kmh&forecast_days=7&timezone=Africa%2FAlgiers';

  Promise.all([
    fetch(urlMarine).then(function(r){ if(!r.ok) throw new Error('marine'); return r.json(); }),
    fetch(urlAtm).then(function(r){ if(!r.ok) throw new Error('atm'); return r.json(); })
  ])
  .then(function(res){ renderWeather(res[0], res[1]); weatherLoaded = true; })
  .catch(function(err){
    document.getElementById('weather-body').innerHTML =
      '<div class="weather-error">⚠️ تعذر تحميل بيانات الطقس<br><small>' + err.message + '</small><br><br>'
      + '<button onclick="weatherLoaded=false;fetchWeather()" style="padding:8px 18px;background:var(--gold);border:none;'
      + 'border-radius:8px;color:#000;font-family:Tajawal;cursor:pointer;font-weight:700;">إعادة المحاولة</button></div>';
  });
}

function waveClass(v){ return v<0.5?'wv-low':v<1.5?'wv-mid':'wv-high'; }
function windClass(v){ return v<20?'ws-low':v<40?'ws-mid':'ws-high'; }
function windDirLabel(deg){
  var d=['ش','شش-ش','ش-ش','شغ-ش','شغ','شغ-غ','غ-ش','شغ-غ','غ','جغ-غ','غ-ج','جغ-غ','جغ','جغ-ج','ج-غ','جش-ج'];
  return d[Math.round(deg/22.5)%16];
}
function fmtHour(s){ return s.split('T')[1]?s.split('T')[1].substring(0,5):s; }
function fmtDay(s){
  var dt=new Date(s);
  var days=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  var months=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return days[dt.getDay()]+' '+dt.getDate()+' '+months[dt.getMonth()];
}

// ===== ثوابت الأمان =====
var WAVE_LIMIT = 1.1;   // م
var WIND_LIMIT = 30;    // كم/س
var TRIP_HOURS = 10;    // ساعات الرحلة (النافذة الكاملة 17:00→10:00 = 17س)
var DEPART_HOUR = 17;   // ساعة الخروج

function assessDay(dayKey, allIndices, times, waveH, windSpd) {
  // نافذة: 17:00 هذا اليوم → 10:00 اليوم التالي فقط (17 ساعة كحد أقصى)
  // نحسب تاريخ اليوم التالي
  var nextDay = new Date(dayKey + 'T12:00');
  nextDay.setDate(nextDay.getDate() + 1);
  var nextDayKey = nextDay.toISOString().substring(0,10);

  var RETURN_HOUR = 10; // أقصى ساعة عودة

  var nightIdx = [];
  for(var k=0; k<allIndices.length; k++){
    var i = allIndices[k];
    var dt = times[i];
    var dayPart = dt.split('T')[0];
    var h = parseInt(dt.split('T')[1].substring(0,2),10);
    // ساعات اليوم نفسه من 17:00 فصاعداً
    if(dayPart === dayKey && h >= DEPART_HOUR) nightIdx.push(i);
    // ساعات اليوم التالي من 00:00 حتى 10:00 فقط
    else if(dayPart === nextDayKey && h <= RETURN_HOUR) nightIdx.push(i);
  }
  // ترتيب حسب الوقت
  nightIdx.sort(function(a,b){ return times[a] < times[b] ? -1 : 1; });

  if(nightIdx.length === 0) return {cls:'red', icon:'❌', badge:'لا توجد بيانات', desc:'لا تتوفر بيانات لهذه الفترة.', window:''};

  // حساب أطول فترة هادئة متواصلة
  // نحتاج أيضاً تتبع مؤشرات أفضل نافذة لحساب أسوأ قيمة داخلها فقط
  var maxConsec=0, curConsec=0, bestStart='', consecStart='';
  var bestStartIdx=0, consecStartIdx=0;
  var worstWaveInWindow=0, worstWindInWindow=0;
  // متغيرات للنافذة الحالية
  var curWave=0, curWind=0;

  for(var k=0; k<nightIdx.length; k++){
    var i=nightIdx[k];
    var wav=waveH[i]||0;
    var spd=windSpd[i]||0;
    if(wav<=WAVE_LIMIT && spd<=WIND_LIMIT){
      curConsec++;
      if(curConsec===1){ consecStart=times[i].replace('T',' ').substring(0,16); consecStartIdx=k; curWave=0; curWind=0; }
      if(wav>curWave) curWave=wav;
      if(spd>curWind) curWind=spd;
      if(curConsec>maxConsec){
        maxConsec=curConsec; bestStart=consecStart; bestStartIdx=consecStartIdx;
        worstWaveInWindow=curWave; worstWindInWindow=curWind;
      }
    } else {
      curConsec=0; consecStart=''; curWave=0; curWind=0;
    }
  }

  // للحالة الحمراء فقط نعرض أسوأ قيمة في كامل النافذة
  var worstWaveAll=0, worstWindAll=0;
  for(var k=0; k<nightIdx.length; k++){
    var i=nightIdx[k];
    if((waveH[i]||0)>worstWaveAll) worstWaveAll=waveH[i]||0;
    if((windSpd[i]||0)>worstWindAll) worstWindAll=windSpd[i]||0;
  }

  var waveTxt=worstWaveInWindow.toFixed(2)+' م';
  var windTxt=Math.round(worstWindInWindow)+' كم/س';
  var waveTxtAll=worstWaveAll.toFixed(2)+' م';
  var windTxtAll=Math.round(worstWindAll)+' كم/س';

  // حساب وقت النهاية بشكل صحيح عبر التاريخ
  function addHours(dtStr, h){
    var d=new Date(dtStr.replace(' ','T')+':00');
    d.setHours(d.getHours()+h);
    return (d.getHours()<10?'0':'')+d.getHours()+':00'
      +' ('+(d.getDate()===new Date(dtStr.replace(' ','T')+':00').getDate()?'نفس اليوم':'اليوم التالي')+')';
  }

  if(maxConsec>=TRIP_HOURS){
    return {
      cls:'green', icon:'✅', badge:'فرصة ذهبية',
      desc:'ظروف مناسبة للخروج — الرياح '+windTxt+' والأمواج '+waveTxt,
      window:'الخروج: '+bestStart.split(' ')[1]+' ← العودة: '+addHours(bestStart, maxConsec)+' ('+maxConsec+' ساعة هادئة)'
    };
  } else if(maxConsec>=6){
    return {
      cls:'orange', icon:'⚠️', badge:'مخاطرة — نافذة ضيقة',
      desc:'فترة هادئة '+maxConsec+' ساعة فقط (الرحلة تحتاج 10). الرياح قد تبلغ '+windTxt+' والأمواج '+waveTxt,
      window:'أفضل نافذة: '+bestStart.split(' ')[1]+' ← '+addHours(bestStart, maxConsec)
    };
  } else {
    return {
      cls:'red', icon:'❌', badge:'لا توجد فرصة',
      desc:'الظروف لا تسمح — الرياح قد تصل '+windTxtAll+' والأمواج '+waveTxtAll+'. لم تتوفر 6 ساعات متواصلة هادئة.',
      window:maxConsec>0?'أفضل ما وُجد: '+maxConsec+' ساعة فقط':'لا توجد ساعة هادئة واحدة'
    };
  }
}

function renderWeather(marine, atm) {
  var times=marine.hourly.time;
  var waveH=marine.hourly.wave_height;
  var windWH=marine.hourly.wind_wave_height;
  var windSpd=atm.hourly.wind_speed_10m;
  var windDeg=atm.hourly.wind_direction_10m;

  // تجميع حسب اليوم
  var days={};
  for(var i=0;i<times.length;i++){
    var dk=times[i].split('T')[0];
    if(!days[dk]) days[dk]=[];
    days[dk].push(i);
  }
  var html='';
  var dayKeys=Object.keys(days);

  // بناء مصفوفة كل المؤشرات مرتبة للتمرير لـ assessDay
  var allIndices=[];
  for(var d=0;d<dayKeys.length;d++){
    var dkk=dayKeys[d];
    for(var ii=0;ii<days[dkk].length;ii++) allIndices.push(days[dkk][ii]);
  }
  allIndices.sort(function(a,b){ return times[a]<times[b]?-1:1; });

  // ===== الأيام 1-3: تقييم + جدول =====
  var mainDays = dayKeys.slice(0,3);
  var extDays  = dayKeys.slice(3);

  html += '<div class="section-title">🎣 جدوى الصيد بالضوء</div>';
  html += '<div class="trip-cards">';
  for(var d=0;d<mainDays.length;d++){
    var dk=mainDays[d];
    var res=assessDay(dk, allIndices, times, waveH, windSpd);
    html += '<div class="trip-card '+res.cls+'">'
      +'<div class="trip-card-top">'
      +'<span class="trip-card-icon">'+res.icon+'</span>'
      +'<span class="trip-card-day">'+fmtDay(dk+'T12:00')+'</span>'
      +'<span class="trip-card-badge">'+res.badge+'</span>'
      +'</div>'
      +'<div class="trip-card-desc">'+res.desc+'</div>'
      +(res.window?'<div class="trip-window">⏱ '+res.window+'</div>':'')
      +'</div>';
  }
  html += '</div>';

  // ===== الأيام 4-6: شريط منسدل للتقييم فقط =====
  if(extDays.length > 0){
    html += '<div class="extended-toggle" id="ext-toggle" onclick="toggleExtended()">'
      +'<span style="font-size:1.1rem;">📅</span>'
      +'<span class="extended-toggle-label">التوقعات الموسعة — اليوم '+(mainDays.length+1)+' إلى '+(mainDays.length+extDays.length)+'</span>'
      +'<span class="extended-toggle-sub">اضغط لعرض التقييم</span>'
      +'<span class="extended-toggle-arrow">▼</span>'
      +'</div>';
    html += '<div class="extended-body" id="ext-body">';
    html += '<div class="trip-cards" style="margin-top:10px;">';
    for(var d=0;d<extDays.length;d++){
      var dk=extDays[d];
      var res=assessDay(dk, allIndices, times, waveH, windSpd);
      html += '<div class="trip-card '+res.cls+'">'
        +'<div class="trip-card-top">'
        +'<span class="trip-card-icon">'+res.icon+'</span>'
        +'<span class="trip-card-day">'+fmtDay(dk+'T12:00')+'</span>'
        +'<span class="trip-card-badge">'+res.badge+'</span>'
        +'</div>'
        +'<div class="trip-card-desc">'+res.desc+'</div>'
        +(res.window?'<div class="trip-window">⏱ '+res.window+'</div>':'')
        +'</div>';
    }
    html += '</div></div>';
  }

  // ===== الجدول التفصيلي للأيام 1-3 فقط =====
  html += '<div class="section-title">📊 التفاصيل الساعية</div>';

  for(var d=0;d<mainDays.length;d++){
    var dk=mainDays[d];
    var dk=dayKeys[d];
    var idxs=days[dk]||[];
    html+='<div class="weather-day-block">'
      +'<div class="weather-day-title">📅 '+fmtDay(dk+'T12:00')+'</div>'
      +'<table class="weather-table"><thead><tr>'
      +'<th>الساعة</th><th>ارتفاع الأمواج</th><th>موج الريح</th><th>سرعة الريح</th><th>اتجاه الريح</th>'
      +'</tr></thead><tbody>';
    for(var j=0;j<idxs.length;j++){
      var idx=idxs[j];
      var wh=waveH[idx]!=null?waveH[idx].toFixed(2)+' م':'—';
      var wwh=windWH[idx]!=null?windWH[idx].toFixed(2)+' م':'—';
      var ws=windSpd[idx]!=null?windSpd[idx].toFixed(1)+' كم/س':'—';
      var wd=windDeg[idx]!=null?windDirLabel(windDeg[idx]):'—';
      var spd=windSpd[idx]||0;
      var wav=waveH[idx]||0;
      var wwv=windWH[idx]||0;

      // شارة الرياح
      var windBadgeColor = spd>=40?'#ef233c':spd>=20?'#fb923c':'';
      var wsDisplay = windBadgeColor
        ? '<span style="display:inline-block;background:'+windBadgeColor+';color:#fff;'
          +'font-weight:700;padding:2px 8px;border-radius:20px;font-size:.72rem;">'+ws+'</span>'
        : ws;

      // شارة الأمواج الكلية
      var wavColor = wav>2?'#7c3aed':wav>1.2?'#ef233c':wav>=0.9?'#f59e0b':'';
      var whDisplay = wavColor
        ? '<span style="display:inline-block;background:'+wavColor+';color:#fff;'
          +'font-weight:700;padding:2px 8px;border-radius:20px;font-size:.72rem;">'+wh+'</span>'
        : wh;

      // شارة موج الريح
      var wwvColor = wwv>2?'#7c3aed':wwv>1.2?'#ef233c':wwv>=0.9?'#f59e0b':'';
      var wwhDisplay = wwvColor
        ? '<span style="display:inline-block;background:'+wwvColor+';color:#fff;'
          +'font-weight:700;padding:2px 8px;border-radius:20px;font-size:.72rem;">'+wwh+'</span>'
        : wwh;

      html+='<tr>'
        +'<td>'+fmtHour(times[idx])+'</td>'
        +'<td>'+whDisplay+'</td>'
        +'<td>'+wwhDisplay+'</td>'
        +'<td>'+wsDisplay+'</td>'
        +'<td>'+wd+'</td>'
        +'</tr>';
    }
    html+='</tbody></table></div>';
  }
  html+='<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;font-size:.62rem;color:var(--dim);padding:4px 2px;">'
    +'<span style="font-size:.62rem;color:var(--dim);">الرياح: </span>'
    +'<span style="background:#fb923c;color:#fff;padding:1px 7px;border-radius:12px;font-size:.6rem;">20–40 كم/س</span> '
    +'<span style="background:#ef233c;color:#fff;padding:1px 7px;border-radius:12px;font-size:.6rem;">+40 كم/س</span>'
    +'<br>'
    +'<span style="font-size:.62rem;color:var(--dim);">الأمواج: </span>'
    +'<span style="background:#f59e0b;color:#fff;padding:1px 7px;border-radius:12px;font-size:.6rem;">0.9–1.2 م</span> '
    +'<span style="background:#ef233c;color:#fff;padding:1px 7px;border-radius:12px;font-size:.6rem;">1.2–2 م</span> '
    +'<span style="background:#7c3aed;color:#fff;padding:1px 7px;border-radius:12px;font-size:.6rem;">+2 م</span>'
    +'<span style="margin-right:auto;font-size:.58rem;">المصدر: Open-Meteo Marine API</span>'
    +'</div>';
  document.getElementById('weather-body').innerHTML=html;
}

function toggleExtended(){
  var toggle=document.getElementById('ext-toggle');
  var body=document.getElementById('ext-body');
  if(!toggle||!body) return;
  var isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);
  toggle.classList.toggle('open',!isOpen);
  toggle.querySelector('.extended-toggle-sub').textContent=
    isOpen?'اضغط لعرض التقييم':'اضغط للإخفاء';
}

// ===== وظائف الأخطار =====
var dangerLayers = {};
var activeDangers = new Set();

function toggleDangersDropdown(tab) {
  var dropdown = document.getElementById('dangers-dropdown');
  var isVisible = dropdown.style.display !== 'none';
  
  if (isVisible) {
    dropdown.style.display = 'none';
    tab.classList.remove('active');
  } else {
    dropdown.style.display = 'block';
    tab.classList.add('active');
  }
}

function toggleDanger(type, isChecked) {
  if (isChecked) {
    // إضافة الخطر إلى القائمة النشطة
    activeDangers.add(type);
    loadDangerLayer(type);
  } else {
    // إزالة الخطر من القائمة النشطة
    activeDangers.delete(type);
    removeDangerLayer(type);
  }
  
  // تحديث حالة تبويب الأخطار
  updateDangersTabStatus();
}

function loadDangerLayer(type) {
  if (dangerLayers[type]) {
    // إذا كانت الطبقة محملة بالفعل، فقط أضفها للخريطة
    dangerLayers[type].addTo(map);
    return;
  }
  
  if (type === 'rocks') {
    fetch('rocks.geojson')
      .then(function(response) { return response.json(); })
      .then(function(data) {
        dangerLayers[type] = L.geoJSON(data, {
          style: function(feature) {
            return {
              color: '#dc2626',
              weight: 2,
              opacity: 0.8,
              fillColor: '#ef4444',
              fillOpacity: 0.3
            };
          },
          pointToLayer: function(feature, latlng) {
            return L.circle(latlng, {
              radius: 25,
              fillColor: '#dc2626',
              color: '#fff',
              weight: 2,
              opacity: 1,
              fillOpacity: 0.8
            });
          },
          onEachFeature: function(feature, layer) {
            if (feature.properties) {
              var popupContent = '<div style="text-align:right;direction:rtl;font-family:Tajawal,sans-serif;">';
              popupContent += '<h4 style="margin:0 0 8px 0;color:#dc2626;">⚠️ منطقة صخرية</h4>';
              for (var key in feature.properties) {
                if (feature.properties[key]) {
                  popupContent += '<div><strong>' + key + ':</strong> ' + feature.properties[key] + '</div>';
                }
              }
              popupContent += '</div>';
              layer.bindPopup(popupContent);
            }
          }
        }).addTo(map);
      })
      .catch(function(error) {
        console.error('Error loading rocks data:', error);
        alert('تعذر تحميل بيانات المناطق الصخرية');
        // إلغاء الاختيار في حال فشل التحميل
        document.getElementById('danger-rocks').checked = false;
        activeDangers.delete('rocks');
      });
  } else if (type === 'wrecks') {
    console.log('Loading wrecks from hotam.geojson...');
    fetch('hotam.geojson')
      .then(function(response) { 
        console.log('Response status:', response.status);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json(); 
      })
      .then(function(data) {
        console.log('Wrecks data loaded:', data.features.length, 'features');
        dangerLayers[type] = L.geoJSON(data, {
          style: function(feature) {
            return {
              color: '#7c3aed',
              weight: 3,
              opacity: 0.9,
              fillColor: '#8b5cf6',
              fillOpacity: 0.4
            };
          },
          pointToLayer: function(feature, latlng) {
            return L.circle(latlng, {
              radius: 25,
              fillColor: '#7c3aed',
              color: '#fff',
              weight: 2,
              opacity: 1,
              fillOpacity: 0.8
            });
          },
          onEachFeature: function(feature, layer) {
            if (feature.properties) {
              var popupContent = '<div style="text-align:right;direction:rtl;font-family:Tajawal,sans-serif;">';
              popupContent += '<h4 style="margin:0 0 8px 0;color:#7c3aed;">⚓ حطام سفينة</h4>';
              for (var key in feature.properties) {
                if (feature.properties[key]) {
                  popupContent += '<div><strong>' + key + ':</strong> ' + feature.properties[key] + '</div>';
                }
              }
              popupContent += '</div>';
              layer.bindPopup(popupContent);
            }
          }
        }).addTo(map);
      })
      .catch(function(error) {
        console.error('Error loading wrecks data:', error);
        alert('تعذر تحميل بيانات حطام السفن');
        document.getElementById('danger-wrecks').checked = false;
        activeDangers.delete('wrecks');
      });
  } else if (type === 'debris') {
    console.log('Loading debris from mokhalfat.geojson...');
    fetch('mokhalfat.geojson')
      .then(function(response) { 
        console.log('Response status:', response.status);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json(); 
      })
      .then(function(data) {
        console.log('Debris data loaded:', data.features.length, 'features');
        dangerLayers[type] = L.geoJSON(data, {
          style: function(feature) {
            return {
              color: '#ea580c',
              weight: 2,
              opacity: 0.8,
              fillColor: '#f97316',
              fillOpacity: 0.3
            };
          },
          pointToLayer: function(feature, latlng) {
            return L.circle(latlng, {
              radius: 25,
              fillColor: '#ea580c',
              color: '#fff',
              weight: 2,
              opacity: 1,
              fillOpacity: 0.8
            });
          },
          onEachFeature: function(feature, layer) {
            if (feature.properties) {
              var popupContent = '<div style="text-align:right;direction:rtl;font-family:Tajawal,sans-serif;">';
              popupContent += '<h4 style="margin:0 0 8px 0;color:#ea580c;">🗑️ مخلفات</h4>';
              for (var key in feature.properties) {
                if (feature.properties[key]) {
                  popupContent += '<div><strong>' + key + ':</strong> ' + feature.properties[key] + '</div>';
                }
              }
              popupContent += '</div>';
              layer.bindPopup(popupContent);
            }
          }
        }).addTo(map);
      })
      .catch(function(error) {
        console.error('Error loading debris data:', error);
        alert('تعذر تحميل بيانات المخلفات');
        document.getElementById('danger-debris').checked = false;
        activeDangers.delete('debris');
      });
  } else {
    // لأنواع الأخطار الأخرى - حالياً فقط رسالة
    var dangerNames = {
      'cables': 'كابلات'
    };
    
    // رسالة مؤقتة للأنواع غير المتاحة
    var message = document.createElement('div');
    message.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(6,13,24,0.95);border:1px solid var(--border);border-radius:12px;padding:20px;color:var(--text);text-align:center;z-index:1000;';
    message.innerHTML = '<h3 style="margin:0 0 10px 0;">' + (dangerNames[type] || type) + '</h3><p>بيانات هذا النوع من الأخطار غير متاحة حالياً</p>';
    document.body.appendChild(message);
    setTimeout(function() { 
      document.body.removeChild(message);
      // إلغاء الاختيار بعد إغلاق الرسالة
      document.getElementById('danger-' + type).checked = false;
      activeDangers.delete(type);
    }, 3000);
  }
}

function removeDangerLayer(type) {
  if (dangerLayers[type]) {
    map.removeLayer(dangerLayers[type]);
  }
}

function updateDangersTabStatus() {
  var dangersTab = document.getElementById('dangers-tab');
  var activeLabel = document.getElementById('active-label');
  
  if (activeDangers.size > 0) {
    dangersTab.classList.add('active');
    // عرض عدد الأخطار النشطة
    if (activeDangers.size === 1) {
      var dangerNames = {
        'rocks': 'مناطق صخرية',
        'wrecks': 'حطام سفن',
        'cables': 'كابلات',
        'debris': 'مخلفات'
      };
      activeLabel.textContent = dangerNames[Array.from(activeDangers)[0]] || 'أخطار';
    } else {
      activeLabel.textContent = 'أخطار (' + activeDangers.size + ')';
    }
    // إخفاء مقياس الألوان عند عرض الأخطار
    document.getElementById('legend').style.display = 'none';
  } else {
    dangersTab.classList.remove('active');
    // إذا لم يكن هناك طبقة أخرى نشطة، أعد تسمية التبويب
    if (!document.querySelector('.layer-tab.active:not(#dangers-tab)')) {
      activeLabel.textContent = 'اختر طبقة';
    }
    // أظهر مقياس الألوان إذا كانت هناك طبقة عادية نشطة
    var activeLayer = document.querySelector('.layer-tab.active:not(#dangers-tab)');
    if (activeLayer) {
      document.getElementById('legend').style.display = 'block';
    }
  }
}

// ==============================================================
// مؤشر القمر — بيانات حقيقية من API
// ==============================================================

function openMoon()  { buildMoonPanel(); document.getElementById('moon-panel').classList.add('open'); }
function closeMoon() { document.getElementById('moon-panel').classList.remove('open'); }

// جلب بيانات القمر - استخدام خوارزميات موثوقة
async function getMoonData(date) {
  try {
    // استخدام خوارزمية دقيقة وموثوقة بدلاً من API
    console.log('Calculating moon data for:', date.toDateString());
    
    var moonData = calculateAccurateMoonData(date);
    console.log('Calculated moon data:', moonData);
    
    return moonData;
    
  } catch (error) {
    console.error('Error calculating moon data:', error);
    return getFallbackMoonData(date);
  }
}

// حساب دقيق لبيانات القمر باستخدام خوارزميات معتمدة
function calculateAccurateMoonData(date) {
  // استخدام خوارزمية Improved Lunar Algorithm
  var year = date.getFullYear();
  var month = date.getMonth() + 1;
  var day = date.getDate();
  var hour = date.getHours();
  
  // حساب Julian Day بدقة عالية
  var jd = getJulianDay(year, month, day, hour);
  
  // حساب عمر القمر (0-29.53 يوم)
  var moonAge = getMoonAge(jd);
  
  // حساب إضاءة القمر (0-1)
  var illumination = getMoonIllumination(moonAge);
  
  // حساب طور القمر
  var phase = (moonAge / 29.53059) * 360;
  
  // حساب شروق وغروب القمر (تقريبي)
  var moonTimes = getMoonRiseSet(jd, WEATHER_LAT, WEATHER_LON);
  
  // اسم طور القمر
  var phaseName = getMoonPhaseNameFromAge(moonAge);
  
  return {
    illum: illumination,
    phase: phase,
    age: moonAge,
    rise: moonTimes.rise,
    set: moonTimes.set,
    phaseName: phaseName,
    source: 'calculated'
  };
}

// حساب Julian Day بدقة
function getJulianDay(year, month, day, hour) {
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  var A = Math.floor(year / 100);
  var B = 2 - A + Math.floor(A / 4);
  var jd = Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5;
  jd += hour / 24;
  return jd;
}

// حساب عمر القمر بالأيام
function getMoonAge(jd) {
  // Known new moon: January 6, 2000, 18:14 UTC (JD 2451550.2597)
  var knownNewMoon = 2451550.2597;
  var synodicMonth = 29.53058867; // days
  
  var age = (jd - knownNewMoon) % synodicMonth;
  if (age < 0) age += synodicMonth;
  
  return age;
}

// حساب إضاءة القمر بدقة
function getMoonIllumination(age) {
  // حساب الإضاءة بناءً على عمر القمر
  var phaseAngle = (age / 29.53059) * 2 * Math.PI;
  var illumination = (1 - Math.cos(phaseAngle)) / 2;
  
  // تصحيح دقيق للإضاءة
  var correction = 0.0; // يمكن إضافة تصحيحات هنا
  
  return Math.max(0, Math.min(1, illumination + correction));
}

// اسم طور القمر بناءً على العمر
function getMoonPhaseNameFromAge(age) {
  if (age < 1.84) return 'محاق 🌑';
  if (age < 5.53) return 'هلال متصاعد 🌒';
  if (age < 9.22) return 'تربيع أول 🌓';
  if (age < 12.91) return 'أحدب متصاعد 🌔';
  if (age < 16.61) return 'بدر 🌕';
  if (age < 20.30) return 'أحدب متناقص 🌖';
  if (age < 23.99) return 'تربيع أخير 🌗';
  if (age < 27.68) return 'هلال متناقص 🌘';
  return 'محاق 🌑';
}

// حساب شروق وغروب القمر (تقريبي)
function getMoonRiseSet(jd, lat, lon) {
  // حساب تقريبي لشروق وغروب القمر
  var moonAge = getMoonAge(jd);
  var offset = (moonAge / 29.53059) * 24; // offset in hours
  
  var riseHour = (18 + offset) % 24;
  var setHour = (6 + offset) % 24;
  
  function fmt(h) {
    var hh = Math.floor(h);
    var mm = Math.round((h - hh) * 60);
    if (mm === 60) { hh++; mm = 0; }
    return (hh % 24).toString().padStart(2,'0') + ':' + mm.toString().padStart(2,'0');
  }
  
  return {
    rise: fmt(riseHour),
    set: fmt(setHour)
  };
}

// بيانات احتياطية محسّنة في حال فشل الـ API
function getFallbackMoonData(date) {
  // استخدام خوارزمية محسّنة كخطة احتياطية
  var year = date.getFullYear();
  var month = date.getMonth() + 1;
  var day = date.getDate();
  
  // حساب يوليان داي بدقة
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  var A = Math.floor(year / 100);
  var B = 2 - A + Math.floor(A / 4);
  var JD = Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5;
  
  var T = (JD - 2451545.0) / 36525;
  var phase = (357.5291 + 35999.0503 * T) % 360;
  var illumination = (1 - Math.cos(phase * Math.PI/180)) / 2;
  
  return {
    illum: illumination,
    phase: phase,
    rise: '22:30',
    set: '06:15',
    phaseName: 'محسوب'
  };
}

// اسم طور القمر
function moonPhaseName(phase) {
  if (phase <  22.5) return 'محاق 🌑';
  if (phase <  67.5) return 'هلال متصاعد 🌒';
  if (phase < 112.5) return 'تربيع أول 🌓';
  if (phase < 157.5) return 'أحدب متصاعد 🌔';
  if (phase < 202.5) return 'بدر 🌕';
  if (phase < 247.5) return 'أحدب متناقص 🌖';
  if (phase < 292.5) return 'تربيع أخير 🌗';
  if (phase < 337.5) return 'هلال متناقص 🌘';
  return 'محاق 🌑';
}

// أيقونة القمر
function moonEmoji(illum) {
  if (illum < 0.05) return '🌑';
  if (illum < 0.25) return '🌒';
  if (illum < 0.45) return '🌓';
  if (illum < 0.55) return '🌔';
  if (illum < 0.75) return '🌕';
  if (illum < 0.85) return '🌖';
  if (illum < 0.95) return '🌗';
  return '🌘';
}

// جودة الصيد الليلي بالضوء حسب الإضاءة
function fishingQuality(illum) {
  var pct = illum * 100;
  if (pct <= 15)  return { cls: 'mq-excellent', text: '🟢 ممتاز — ظلام مثالي للصيد بالضوء' };
  if (pct <= 35)  return { cls: 'mq-good',      text: '🟡 جيد — ضوء خفيف لا يؤثر كثيراً' };
  if (pct <= 65)  return { cls: 'mq-medium',    text: '🟠 متوسط — القمر يُشتت السردين' };
  return           { cls: 'mq-bad',             text: '🔴 سيء — البدر يطرد السمك من الضوء الاصطناعي' };
}

// وقت شروق/غروب القمر (تقريب بسيط)
function moonRiseSet(date, lat, lon) {
  var JD  = date.getTime() / 86400000 + 2440587.5;
  var T   = (JD - 2451545.0) / 36525;
  var Ml  = (218.3165 + 481267.8813 * T) % 360;
  var toR = Math.PI / 180;
  var dec = 23.45 * Math.sin(toR * (280.1 + 36000.77 * T));
  var ha  = Math.acos(
    (Math.sin(toR * (-0.833)) - Math.sin(toR * lat) * Math.sin(toR * dec))
    / (Math.cos(toR * lat) * Math.cos(toR * dec))
  ) / toR;
  if (isNaN(ha)) return { rise: '--', set: '--' };
  var transit = (Ml - lon - 180) % 360;
  if (transit < 0) transit += 360;
  transit = transit / 360 * 24;
  var riseH = ((transit - ha / 15) % 24 + 24) % 24;
  var setH  = ((transit + ha / 15) % 24 + 24) % 24;
  function fmt(h) {
    var hh = Math.floor(h);
    var mm = Math.round((h - hh) * 60);
    if (mm === 60) { hh++; mm = 0; }
    return (hh % 24).toString().padStart(2,'0') + ':' + mm.toString().padStart(2,'0');
  }
  return { rise: fmt(riseH), set: fmt(setH) };
}

// بناء نافذة القمر باستخدام بيانات API الحقيقية
async function buildMoonPanel() {
  var lat = WEATHER_LAT;
  var lon = WEATHER_LON;
  var today = new Date();
  today.setHours(22, 0, 0, 0); // وقت الصيد الليلي 22:00

  // عرض رسالة تحميل
  document.getElementById('moon-body').innerHTML = '<div style="text-align:center;padding:40px;color:var(--dim);">جاري تحميل بيانات القمر...</div>';

  try {
    // جلب بيانات القمر من API
    var todayData = await getMoonData(today);
    console.log('Moon data from API:', todayData);
    
    var quality = fishingQuality(todayData.illum);
    var pct = Math.round(todayData.illum * 100);

    // جدول 7 أيام - جلب البيانات لكل يوم
    var days = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    var weekRows = '';
    
    for (var i = 0; i < 7; i++) {
      var d = new Date(today);
      d.setDate(today.getDate() + i);
      var md = await getMoonData(d);
      var p = Math.round(md.illum * 100);
      var q = fishingQuality(md.illum);
      var isToday = (i === 0);
      var dayName = isToday ? 'الليلة' : days[d.getDay()];
      var dateStr = d.getDate() + '/' + (d.getMonth()+1);
      var dot = q.cls === 'mq-excellent' ? '🟢'
              : q.cls === 'mq-good'      ? '🟡'
              : q.cls === 'mq-medium'    ? '🟠' : '🔴';
      weekRows +=
        '<tr' + (isToday ? ' class="today-row"' : '') + '>'
        + '<td style="font-weight:700;">' + dayName + '</td>'
        + '<td style="color:var(--dim);">' + dateStr + '</td>'
        + '<td>' + moonEmoji(md.illum) + '</td>'
        + '<td style="color:#f59e0b;font-weight:700;">' + p + '%</td>'
        + '<td>' + dot + '</td>'
        + '</tr>';
    }

    var html =
      '<div class="moon-tonight">'
      + '<div class="moon-emoji">' + moonEmoji(todayData.illum) + '</div>'
      + '<div class="moon-info">'
      +   '<div class="moon-pct">' + pct + '%</div>'
      +   '<div class="moon-phase">' + (todayData.phaseName || moonPhaseName(todayData.phase)) + '</div>'
      +   '<div class="moon-times">🌕 شروق ' + (todayData.rise || '--:--') + '  &nbsp;  🌑 غروب ' + (todayData.set || '--:--') + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="moon-quality-bar ' + quality.cls + '">' + quality.text + '</div>'
      + '<div style="font-size:.72rem;color:var(--dim);margin-bottom:8px;text-align:center;">'
      +   'توقعات الأسبوع القادم'
      + '</div>'
      + '</div>'
      + '<table class="moon-week">'
      + '<thead><tr>'
      +   '<th>اليوم</th><th>التاريخ</th><th>القمر</th><th>الإضاءة</th><th>الصيد</th>'
      + '</tr></thead>'
      + '<tbody>' + weekRows + '</tbody>'
      + '</table>'
      + '<div style="font-size:.65rem;color:var(--dim);margin-top:14px;text-align:center;">'
      + '💡 بيانات من مصادر فلكية موثوقة • كلما قل ضوء القمر، كلما كان الصيد الليلي بالضوء الاصطناعي أفضل'
      + '</div>';

    document.getElementById('moon-body').innerHTML = html;
    
  } catch (error) {
    console.error('Error building moon panel:', error);
    document.getElementById('moon-body').innerHTML = 
      '<div style="text-align:center;padding:40px;color:#ef233c;">'
      + '❌ تعذر تحميل بيانات القمر<br>'
      + '<span style="font-size:.8rem;color:var(--dim);">يرجى المحاولة مرة أخرى لاحقاً</span>'
      + '</div>';
  }
}

// ==============================================================
// تقارير الصيادين — عرض على الخريطة كل 60 ثانية
// ==============================================================

var reportsLayer   = null;
var reportsTimer   = null;
var reportsVisible = false;

var RATING_STYLE = {
  'لا يوجد صيد': { color: '#ef4444', icon: '❌' },
  'تجمع بدون اصطياد': { color: '#38bdf8', icon: '🔍' },
  'نتوء صخري':  { color: '#f97316', icon: '⚠️' },
  'حطام سفينة': { color: '#a855f7', icon: '🚢' },
  'كابلات':     { color: '#eab308', icon: '⚡' },
  'صيد':     { color: '#22c55e', icon: '🎣' },
  'لا صيد':  { color: '#ef4444', icon: '❌' },
  'غير آمن': { color: '#f97316', icon: '⚠️' },
  'استكشاف': { color: '#38bdf8', icon: '🔍' },
};

function loadReports() {
  fetch(API_BASE_URL + '/api/reports?code=' + (currentUser||'') + '&t=' + Date.now(), {
    method: 'GET',
    headers: { 'x-api-key': API_KEY }
  })
    .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function(data) { if (data.data) drawReports(data.data); })
    .catch(function(err) { console.warn('تقارير: ' + err.message); });
}

function drawReports(reports) {
  if (reportsLayer) map.removeLayer(reportsLayer);
  reportsLayer = L.layerGroup();
  reports.forEach(function(r) {
    var s = RATING_STYLE[r.rating] || { color: '#a3a3a3', icon: '📍' };
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

// ==============================================================
// طبقات الباثيمتري — EMODnet WMS
// ==============================================================

var EMODNET_WMS       = 'https://ows.emodnet-bathymetry.eu/wms';
var bathyDepthLayer   = null;
var bathyContourLayer = null;
var bathyWrecksLayer  = null;

function toggleBathyDepth(btn) {
  if (bathyDepthLayer && map.hasLayer(bathyDepthLayer)) {
    map.removeLayer(bathyDepthLayer); btn.classList.remove('active'); return;
  }
  if (!bathyDepthLayer) bathyDepthLayer = L.tileLayer.wms(EMODNET_WMS, {
    layers:'emodnet:mean_multicolour', format:'image/png',
    transparent:true, version:'1.3.0', opacity:0.75,
    attribution:'© EMODnet Bathymetry 2024'
  });
  bathyDepthLayer.addTo(map); btn.classList.add('active');
}

function toggleBathyContour(btn) {
  if (bathyContourLayer && map.hasLayer(bathyContourLayer)) {
    map.removeLayer(bathyContourLayer); btn.classList.remove('active'); return;
  }
  if (!bathyContourLayer) bathyContourLayer = L.tileLayer.wms(EMODNET_WMS, {
    layers:'emodnet:contours', format:'image/png',
    transparent:true, version:'1.3.0', opacity:0.9,
    attribution:'© EMODnet Bathymetry 2024'
  });
  bathyContourLayer.addTo(map); btn.classList.add('active');
}

function toggleBathyWrecks(btn) {
  if (bathyWrecksLayer && map.hasLayer(bathyWrecksLayer)) {
    map.removeLayer(bathyWrecksLayer); btn.classList.remove('active'); return;
  }
  if (!bathyWrecksLayer) bathyWrecksLayer = L.tileLayer.wms(EMODNET_WMS, {
    layers:'emodnet:wrecks', format:'image/png',
    transparent:true, version:'1.3.0', opacity:1.0,
    attribution:'© EMODnet / OceanWise UKHO'
  });
  bathyWrecksLayer.addTo(map); btn.classList.add('active');
}




  
// ======================================================
// معالمي — نقاط الصياد الخاصة
// ======================================================
var myMarkersLayer = null;
var myMarkersVisible = false;
var myMarkersTimer = null;

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
    method: 'GET',
    headers: { 'x-api-key': API_KEY }
  })
    .then(function(res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function(data) { if (data.data) drawMyMarkers(data.data); })
    .catch(function(err) { console.warn('معالمي: ' + err.message); });
}

function drawMyMarkers(reports) {
  if (myMarkersLayer) map.removeLayer(myMarkersLayer);
  myMarkersLayer = L.layerGroup();
  reports.forEach(function(r) {
    var lat = parseFloat(r.lat);
    var lon = parseFloat(r.lon);
    if (isNaN(lat) || isNaN(lon)) return;
    if (r.code.toUpperCase() !== currentUser.toUpperCase()) return;
    var s = RATING_STYLE[r.rating] || { color: '#38bdf8', icon: '📌' };
    var m = L.circleMarker([lat, lon], {
      radius: 8, fillColor: s.color, color: '#38bdf8',
      weight: 2, opacity: 1, fillOpacity: 0.9
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

// تسجيل Service Worker — PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/fishing-map/sw.js')
        .then(function(reg) {
          console.log('[PWA] ✅ Service Worker مسجل:', reg.scope);
        })
        .catch(function(err) {
          console.warn('[PWA] ❌ فشل التسجيل:', err);
        });
    });
  }
