// ============================================================
//  wave-period-layer.js — طبقة فترة الموج الليلية (VTM10) فوق الخريطة
//  أيقونة مستقلة (🌤️ الأمواج الهادئة) — تفعيل/إطفاء + قيمة حقيقية باللمس/التمرير
// ============================================================

var wavePeriodOverlay = null;
var wavePeriodVisible = false;
var wavePeriodData    = null;   // { bounds, color_scale, stats, grid:{lon,lat,values} }
var wavePeriodLoading = false;

var WAVE_PERIOD_IMG_URL  = 'weather/wave_period_night.png';
var WAVE_PERIOD_DATA_URL = 'data/wave_period_night.json';

function toggleWavePeriodLayer() {
  if (wavePeriodLoading) return;

  if (wavePeriodVisible) {
    if (wavePeriodOverlay) map.removeLayer(wavePeriodOverlay);
    wavePeriodVisible = false;
    setWavePeriodFabActive(false);
    hideWavePeriodLegend();
    return;
  }

  if (wavePeriodOverlay && wavePeriodData) {
    wavePeriodOverlay.addTo(map);
    wavePeriodVisible = true;
    setWavePeriodFabActive(true);
    showWavePeriodLegend(wavePeriodData);
    return;
  }

  loadWavePeriodLayer();
}

function loadWavePeriodLayer() {
  wavePeriodLoading = true;
  fetch(WAVE_PERIOD_DATA_URL + '?_=' + Date.now(), { cache: 'no-store' })
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      wavePeriodData = data;
      var b = data.bounds;
      var bounds = [[b.lat_min, b.lon_min], [b.lat_max, b.lon_max]];

      var img = new Image();
      img.onload = function() {
        wavePeriodOverlay = L.imageOverlay(WAVE_PERIOD_IMG_URL + '?_=' + Date.now(), bounds, { opacity: 0.85 }).addTo(map);
        wavePeriodVisible = true;
        wavePeriodLoading = false;
        setWavePeriodFabActive(true);
        showWavePeriodLegend(data);
      };
      img.onerror = function() {
        wavePeriodLoading = false;
        alert('تعذر تحميل خريطة فترة الموج — تأكد من رفع weather/wave_period_night.png');
      };
      img.src = WAVE_PERIOD_IMG_URL + '?_=' + Date.now();
    })
    .catch(function(e) {
      wavePeriodLoading = false;
      console.error('تعذر جلب بيانات فترة الموج:', e);
      alert('تعذر تحميل بيانات فترة الموج — تأكد من رفع data/wave_period_night.json');
    });
}

function setWavePeriodFabActive(on) {
  var fab = document.getElementById('wave-period-fab');
  if (fab) fab.classList.toggle('wp-active', on);
}

// ===== قيمة حقيقية عند التمرير/اللمس (أقرب نقطة شبكة) =====
function getWavePeriodValueAt(latlng) {
  var d = wavePeriodData;
  if (!d || !d.grid) return null;
  var b = d.bounds;
  if (latlng.lat > b.lat_max || latlng.lat < b.lat_min ||
      latlng.lng < b.lon_min || latlng.lng > b.lon_max) return null;

  var lons = d.grid.lon, lats = d.grid.lat, values = d.grid.values;

  var lonIdx = 0, bestLonDiff = Infinity;
  for (var i = 0; i < lons.length; i++) {
    var diff = Math.abs(lons[i] - latlng.lng);
    if (diff < bestLonDiff) { bestLonDiff = diff; lonIdx = i; }
  }
  var latIdx = 0, bestLatDiff = Infinity;
  for (var j = 0; j < lats.length; j++) {
    var diffL = Math.abs(lats[j] - latlng.lat);
    if (diffL < bestLatDiff) { bestLatDiff = diffL; latIdx = j; }
  }

  var v = values[latIdx] ? values[latIdx][lonIdx] : null;
  return (v === null || v === undefined) ? null : v;
}

// ملاحظة: يستعمل نفس عنصر #map-tooltip المشترك مع طبقات SST/التيارات.
// هذا المعالج يتدخل فقط إذا كانت طبقة فترة الموج مفعّلة — إذا كانت مطفأة
// لا يغيّر شيئاً ويترك تلميح الطبقات الأخرى يعمل بشكل طبيعي. (إذا فُعّلت
// طبقتان قيميتان في نفس الوقت، فترة الموج تكون لها الأولوية في عرض التلميح.)
map.on('mousemove', function(e) {
  if (!wavePeriodVisible) return;
  var tt = document.getElementById('map-tooltip');
  if (!tt) return;
  var val = getWavePeriodValueAt(e.latlng);
  if (val !== null) {
    tt.style.display = 'block';
    tt.textContent = val.toFixed(1) + ' ث';
    var cp = map.latLngToContainerPoint(e.latlng);
    tt.style.left = (cp.x + 14) + 'px';
    tt.style.top  = (cp.y - 10) + 'px';
  } else {
    tt.style.display = 'none';
  }
});

// ===== مفتاح ألوان صغير عائم (يظهر فقط عند تفعيل الطبقة) =====
function showWavePeriodLegend(data) {
  var el = document.getElementById('wave-period-legend');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wave-period-legend';
    el.className = 'wave-period-legend';
    document.body.appendChild(el);
  }
  var cs = data.color_scale, stats = data.stats;
  el.innerHTML =
    '<div class="wp-legend-title">🌤️ فترة الموج (ث) — ' +
      (data.night_start_local ? data.night_start_local.substring(11,16) : '') +
      ' → ' + (data.night_end_local ? data.night_end_local.substring(11,16) : '') + '</div>' +
    '<div class="wp-legend-bar"></div>' +
    '<div class="wp-legend-scale"><span>' + cs.min + '</span><span>' + cs.max + '</span></div>' +
    '<div class="wp-legend-stats">المتوسط: ' + stats.avg + ' ث — أدنى ' + stats.min + ' / أقصى ' + stats.max + '</div>';
  el.style.display = 'block';
}
function hideWavePeriodLegend() {
  var el = document.getElementById('wave-period-legend');
  if (el) el.style.display = 'none';
}
