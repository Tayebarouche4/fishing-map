// ============================================================
//  wave-period-layer.js — طبقة فترة الموج الليلية (VTM10) فوق الخريطة
//  أيقونة مستقلة (🌤️ الأمواج الهادئة) — تفعيل/إطفاء + قيمة حقيقية باللمس/التمرير
// ============================================================

var wavePeriodOverlay = null;
var wavePeriodVisible = false;
var wavePeriodData    = null;   // { bounds, color_scale, stats, grid:{lon,lat,values} }
var wavePeriodLoading = false;
var wavePeriodContrastMin = null;
var wavePeriodContrastMax = null;

var WAVE_PERIOD_IMG_URL  = 'weather/wave_period_night.png';
var WAVE_PERIOD_DATA_URL = 'data/wave_period_night.json';

// تقريب بصري لخريطة ألوان turbo (نفس المستعملة في الصورة الخادمية) عبر
// نقاط تحكّم واستيفاء خطي بينها — لإعادة رسم الألوان حياً في المتصفح
var TURBO_STOPS = [
  [48,18,59],[71,65,175],[63,118,228],[37,168,234],[30,202,187],
  [91,218,104],[170,220,50],[230,190,40],[247,137,37],[219,68,21],[122,4,3]
];
function turboColor(t) {
  t = Math.min(1, Math.max(0, t));
  var pos = t * (TURBO_STOPS.length - 1);
  var i0 = Math.floor(pos), i1 = Math.min(TURBO_STOPS.length - 1, i0 + 1);
  var f = pos - i0;
  var c0 = TURBO_STOPS[i0], c1 = TURBO_STOPS[i1];
  return [
    Math.round(c0[0] + (c1[0]-c0[0]) * f),
    Math.round(c0[1] + (c1[1]-c0[1]) * f),
    Math.round(c0[2] + (c1[2]-c0[2]) * f)
  ];
}

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
      wavePeriodContrastMin = data.color_scale.min;
      wavePeriodContrastMax = data.color_scale.max;
      var b = data.bounds;
      var bounds = [[b.lat_min, b.lon_min], [b.lat_max, b.lon_max]];

      var img = new Image();
      img.onload = function() {
        wavePeriodOverlay = L.imageOverlay(WAVE_PERIOD_IMG_URL + '?_=' + Date.now(), bounds, { opacity: 0.9 }).addTo(map);
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

// ===== إعادة رسم الألوان حياً من الشبكة الكاملة حسب نطاق تباين مختار =====
function renderWavePeriodCanvas(minVal, maxVal) {
  var grid = wavePeriodData.grid;
  var lons = grid.lon, lats = grid.lat, values = grid.values;
  var w = lons.length, h = lats.length;

  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext('2d');
  var imgData = ctx.createImageData(w, h);

  var latAscending = lats[0] < lats[lats.length - 1];
  var span = (maxVal - minVal) || 1;

  for (var row = 0; row < h; row++) {
    var srcRow = latAscending ? (h - 1 - row) : row;   // أعلى الصورة = شمال دائماً
    for (var col = 0; col < w; col++) {
      var v = values[srcRow] ? values[srcRow][col] : null;
      var idx = (row * w + col) * 4;
      if (v === null || v === undefined) {
        imgData.data[idx+3] = 0;
        continue;
      }
      var t = (v - minVal) / span;
      var rgb = turboColor(t);
      imgData.data[idx]   = rgb[0];
      imgData.data[idx+1] = rgb[1];
      imgData.data[idx+2] = rgb[2];
      imgData.data[idx+3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

function applyWavePeriodContrast(minVal, maxVal) {
  if (!wavePeriodOverlay || !wavePeriodData) return;
  wavePeriodContrastMin = minVal;
  wavePeriodContrastMax = maxVal;
  var dataUrl = renderWavePeriodCanvas(minVal, maxVal);
  wavePeriodOverlay.setUrl(dataUrl);
  var minLabel = document.getElementById('wp-min-label');
  var maxLabel = document.getElementById('wp-max-label');
  if (minLabel) minLabel.textContent = minVal.toFixed(1);
  if (maxLabel) maxLabel.textContent = maxVal.toFixed(1);
}

function onWaveContrastSliderChange() {
  var minInput = document.getElementById('wp-range-min');
  var maxInput = document.getElementById('wp-range-max');
  if (!minInput || !maxInput) return;
  var minV = parseFloat(minInput.value);
  var maxV = parseFloat(maxInput.value);
  // منع تقاطع المقبضين — نبقي فرقاً أدنى بينهما
  var GAP = 0.2;
  if (minV > maxV - GAP) {
    if (this && this.id === 'wp-range-min') { minV = maxV - GAP; minInput.value = minV; }
    else { maxV = minV + GAP; maxInput.value = maxV; }
  }
  applyWavePeriodContrast(minV, maxV);
}

function wavePeriodAutoContrast() {
  if (!wavePeriodData) return;
  var s = wavePeriodData.stats;
  document.getElementById('wp-range-min').value = s.min;
  document.getElementById('wp-range-max').value = s.max;
  applyWavePeriodContrast(s.min, s.max);
}

function wavePeriodResetContrast() {
  if (!wavePeriodData) return;
  var cs = wavePeriodData.color_scale;
  document.getElementById('wp-range-min').value = cs.min;
  document.getElementById('wp-range-max').value = cs.max;
  applyWavePeriodContrast(cs.min, cs.max);
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

// ===== مفتاح ألوان + سلايدر التباين التفاعلي (يظهر فقط عند تفعيل الطبقة) =====
function showWavePeriodLegend(data) {
  var el = document.getElementById('wave-period-legend');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wave-period-legend';
    el.className = 'wave-period-legend';
    document.body.appendChild(el);
  }
  var cs = data.color_scale, stats = data.stats;
  var curMin = wavePeriodContrastMin != null ? wavePeriodContrastMin : cs.min;
  var curMax = wavePeriodContrastMax != null ? wavePeriodContrastMax : cs.max;

  el.innerHTML =
    '<div class="wp-legend-title">🌤️ فترة الموج (ث) — ' +
      (data.night_start_local ? data.night_start_local.substring(11,16) : '') +
      ' → ' + (data.night_end_local ? data.night_end_local.substring(11,16) : '') + '</div>' +
    '<div class="wp-legend-bar"></div>' +
    '<div class="wp-legend-scale"><span id="wp-min-label">' + curMin.toFixed(1) + '</span><span id="wp-max-label">' + curMax.toFixed(1) + '</span></div>' +
    '<div class="wp-legend-stats">المتوسط الفعلي: ' + stats.avg + ' ث — أدنى ' + stats.min + ' / أقصى ' + stats.max + '</div>' +
    '<div class="wp-contrast-label">تباين تفاعلي (ضمن المقياس الثابت ' + cs.min + '-' + cs.max + ')</div>' +
    '<div class="wp-dual-range" dir="ltr">' +
      '<input type="range" id="wp-range-min" min="' + cs.min + '" max="' + cs.max + '" step="0.1" value="' + curMin + '">' +
      '<input type="range" id="wp-range-max" min="' + cs.min + '" max="' + cs.max + '" step="0.1" value="' + curMax + '">' +
    '</div>' +
    '<div class="wp-contrast-buttons">' +
      '<button onclick="wavePeriodAutoContrast()">تلقائي حسب البيانات</button>' +
      '<button onclick="wavePeriodResetContrast()">إعادة تعيين</button>' +
    '</div>';

  document.getElementById('wp-range-min').addEventListener('input', onWaveContrastSliderChange);
  document.getElementById('wp-range-max').addEventListener('input', onWaveContrastSliderChange);

  el.style.display = 'block';

  // طبّق أي تباين مخصّص محفوظ من قبل (إن وُجد) عند إعادة الفتح
  if (wavePeriodContrastMin != null && (wavePeriodContrastMin !== cs.min || wavePeriodContrastMax !== cs.max)) {
    applyWavePeriodContrast(wavePeriodContrastMin, wavePeriodContrastMax);
  }
}
function hideWavePeriodLegend() {
  var el = document.getElementById('wave-period-legend');
  if (el) el.style.display = 'none';
}
