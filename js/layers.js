// ============================================================
//  layers.js — طبقات المسارات والتيارات والأخطار والباثيمتري
// ============================================================

// ===== المسارات =====
var routeLayer   = null;
var routeVisible = false;

function toggleRoutes(btn) {
  if (routeVisible) {
    if (routeLayer) map.removeLayer(routeLayer);
    routeVisible = false;
    btn.style.background   = 'rgba(6,214,160,0.1)';
    btn.style.borderColor  = 'rgba(6,214,160,0.3)';
  } else {
    loadRoutes(btn);
  }
}

function loadRoutes(btn) {
  if (routeLayer) {
    routeLayer.addTo(map);
    routeVisible = true;
    btn.style.background  = 'rgba(6,214,160,0.25)';
    btn.style.borderColor = '#06d6a0';
    return;
  }
  fetch(ROUTES_GEOJSON)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      routeLayer = L.geoJSON(data, {
        style: function(feature) {
          return {
            color: '#06d6a0', weight: 3, opacity: 0.9,
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
      btn.style.background  = 'rgba(6,214,160,0.25)';
      btn.style.borderColor = '#06d6a0';
    })
    .catch(function(e) { console.error('خطأ في تحميل المسارات:', e); });
}

// ===== تيارات البحر (سطح + عمق) — لوحة موحّدة =====
var current1Layer      = null, current1Visible  = false;
var current50Layer     = null, current50Visible = false;
var sshGeojsonLayer    = null, sshGeojsonVisible = false;
var tcontLayer         = null, tcontVisible = false;
var sstnOverlay        = null, sstnVisible = false;

var CURRENTS_REPO_OWNER     = 'Tayebarouche4';
var CURRENTS_REPO_NAME      = 'fishing-map';
var CURRENT1_HISTORY_FOLDER  = 'currents/current1';
var CURRENT50_HISTORY_FOLDER = 'currents/current50';

// صيغة اسم الملف من خط الأنابيب: current1_/current50_ + YYYY-MM-DD_HHh00Z.geojson
// الساعة داخل الاسم هي توقيت UTC الفعلي للبيانات — القراءة تعتمد عليها مباشرة
// (لا على ترتيب افتراضي) لضمان عرض الساعة الصحيحة دائمًا حتى لو تغيّر عدد
// المحطات أو تأخرت إحداها.
var CURRENT1_FILENAME_RE  = /^current1_(\d{4})-(\d{2})-(\d{2})_(\d{2})h00Z\.geojson$/i;
var CURRENT50_FILENAME_RE = /^current50_(\d{4})-(\d{2})-(\d{2})_(\d{2})h00Z\.geojson$/i;

var current1LayerCache  = {};  // filename -> L.GeoJSON (مُحمّل مسبقاً)
var current50LayerCache = {};  // filename -> L.GeoJSON (مُحمّل مسبقاً)

// قائمة موحّدة بكل الأوقات الموجودة في أي من الطبقتين:
// [{utcDate, c1: entry|null, c50: entry|null}, ...] مرتبة تصاعديًا
var currentsCombinedSteps = null;
var currentsActiveIndex   = null;
var currentsPanelOpen     = false;
var currentsShowC1        = true;   // خانة "ت.س" — مفعّلة افتراضيًا
var currentsShowC50       = true;   // خانة "ت.ع" — مفعّلة افتراضيًا
var currentsPlaying       = false;
var currentsPlayTimer     = null;

var current1Btn  = null;
var current50Btn = null;

// عرض الساعة بتوقيت الجزائر (UTC+1 ثابت، بدون توقيت صيفي)
function formatLocalHour(utcDate) {
  var local = new Date(utcDate.getTime() + 60 * 60 * 1000);
  return String(local.getUTCHours()).padStart(2, '0') + ':00';
}

function parseCurrent1UtcDate(filename) {
  var m = filename.match(CURRENT1_FILENAME_RE);
  if (!m) return null;
  var d = new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':00:00Z');
  return isNaN(d.getTime()) ? null : d;
}

function parseCurrent50UtcDate(filename) {
  var m = filename.match(CURRENT50_FILENAME_RE);
  if (!m) return null;
  var d = new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':00:00Z');
  return isNaN(d.getTime()) ? null : d;
}

function toggleCurrent1(btn) {
  current1Btn = btn;
  if (!current50Btn) current50Btn = document.getElementById('current50-btn');

  // إذا كانت طبقة تيار السطح ظاهرة حاليًا — النقر على زرها يُخفيها مباشرة
  if (current1Visible) {
    currentsShowC1 = false;
    clearCurrent1Layer();
    if (currentsPanelOpen) renderCurrentsSlider();
    return;
  }

  currentsShowC1 = true;
  if (currentsCombinedSteps) {
    if (!currentsPanelOpen) { getCurrentsHistoryPanel().style.display = 'block'; currentsPanelOpen = true; }
    renderCurrentsSlider();
    applyCurrentsStep(currentsCombinedSteps[currentsActiveIndex]);
    return;
  }
  openCurrentsPanel();
}

function toggleCurrent50(btn) {
  current50Btn = btn;
  if (!current1Btn) current1Btn = document.getElementById('current1-btn');

  // إذا كانت طبقة تيار العمق ظاهرة حاليًا — النقر على زرها يُخفيها مباشرة
  if (current50Visible) {
    currentsShowC50 = false;
    clearCurrent50Layer();
    if (currentsPanelOpen) renderCurrentsSlider();
    return;
  }

  currentsShowC50 = true;
  if (currentsCombinedSteps) {
    if (!currentsPanelOpen) { getCurrentsHistoryPanel().style.display = 'block'; currentsPanelOpen = true; }
    renderCurrentsSlider();
    applyCurrentsStep(currentsCombinedSteps[currentsActiveIndex]);
    return;
  }
  openCurrentsPanel();
}

function openCurrentsPanel() {
  var panel = getCurrentsHistoryPanel();
  panel.style.display = 'block';
  currentsPanelOpen = true;

  if (currentsCombinedSteps) {
    renderCurrentsSlider();
    applyCurrentsStep(currentsCombinedSteps[currentsActiveIndex]);
    return;
  }

  panel.innerHTML = '<div style="padding:10px;color:#94a3b8;">جاري التحميل...</div>';

  var url1  = 'https://api.github.com/repos/' + CURRENTS_REPO_OWNER + '/' + CURRENTS_REPO_NAME + '/contents/' + CURRENT1_HISTORY_FOLDER;
  var url50 = 'https://api.github.com/repos/' + CURRENTS_REPO_OWNER + '/' + CURRENTS_REPO_NAME + '/contents/' + CURRENT50_HISTORY_FOLDER;

  Promise.all([
    fetch(url1).then(function(r)  { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(function(e) { console.error('تعذر جلب أرشيف تيار السطح:', e); return []; }),
    fetch(url50).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(function(e) { console.error('تعذر جلب أرشيف تيار العمق:', e); return []; })
  ]).then(function(results) {
    var steps1 = (results[0] || [])
      .filter(function(it) { return it.type === 'file' && /\.geojson$/i.test(it.name); })
      .map(function(it) {
        var utcDate = parseCurrent1UtcDate(it.name);
        return utcDate ? { name: it.name, utcDate: utcDate, download_url: it.download_url } : null;
      })
      .filter(Boolean);

    var steps50 = (results[1] || [])
      .filter(function(it) { return it.type === 'file' && /\.geojson$/i.test(it.name); })
      .map(function(it) {
        var utcDate = parseCurrent50UtcDate(it.name);
        return utcDate ? { name: it.name, utcDate: utcDate, download_url: it.download_url } : null;
      })
      .filter(Boolean);

    var byTime = {};
    function mergeIn(entry, key) {
      var k = entry.utcDate.getTime();
      if (!byTime[k]) byTime[k] = { utcDate: entry.utcDate, c1: null, c50: null };
      byTime[k][key] = entry;
    }
    steps1.forEach(function(e)  { mergeIn(e, 'c1'); });
    steps50.forEach(function(e) { mergeIn(e, 'c50'); });

    var combined = Object.keys(byTime)
      .map(function(k) { return byTime[k]; })
      .sort(function(a, b) { return a.utcDate - b.utcDate; }); // الأقدم أولاً = الآن، ثم +3 +6 +9 +12

    if (combined.length === 0) {
      panel.innerHTML = '<div style="padding:10px;color:#94a3b8;">لا توجد بيانات تيار حالياً</div>';
      return;
    }

    currentsCombinedSteps = combined;
    currentsActiveIndex = 0;
    renderCurrentsSlider();
    applyCurrentsStep(combined[0]);
  });
}

function closeCurrentsPanel() {
  stopCurrentsPlay();
  var panel = document.getElementById('currents-history-panel');
  if (panel) panel.style.display = 'none';
  currentsPanelOpen = false;
}

function getCurrentsHistoryPanel() {
  var panel = document.getElementById('currents-history-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'currents-history-panel';
    panel.style.cssText = [
      'position:fixed', 'bottom:20px', 'left:16px', 'z-index:1060',
      'background:rgba(6,13,24,0.97)', 'border:1px solid rgba(45,212,191,0.35)',
      'border-radius:12px', 'padding:8px', 'font-family:Tajawal,sans-serif',
      'font-size:.75rem', 'color:#e2e8f0', 'direction:rtl', 'min-width:210px',
      'max-height:300px', 'overflow-y:auto', 'box-shadow:0 4px 16px rgba(0,0,0,0.5)'
    ].join(';');
    document.body.appendChild(panel);

    // إغلاق عند النقر خارج اللوحة — لا يُغلق عند النقر/السحب داخل الشريط نفسه
    document.addEventListener('click', function(ev) {
      if (!currentsPanelOpen) return;
      var withinPanel = panel.contains(ev.target);
      var withinBtn1  = current1Btn  && current1Btn.contains(ev.target);
      var withinBtn50 = current50Btn && current50Btn.contains(ev.target);
      if (!withinPanel && !withinBtn1 && !withinBtn50) closeCurrentsPanel();
    });
  }
  return panel;
}

function renderCurrentsSlider() {
  var panel = getCurrentsHistoryPanel();
  var steps = currentsCombinedSteps;
  var idx = (currentsActiveIndex != null) ? currentsActiveIndex : 0;
  var entry = steps[idx];

  var html = '<div style="font-weight:700;margin-bottom:8px;color:#fff;">🌊 التيارات — توقّع الساعات</div>';

  html += '<div style="display:flex;gap:16px;justify-content:center;margin-bottom:10px;">'
    + '<label style="display:flex;align-items:center;gap:5px;color:#f87171;font-weight:700;cursor:pointer;">'
    + '<input type="checkbox" class="cur-chk-c1" ' + (currentsShowC1 ? 'checked' : '') + '> ت.س</label>'
    + '<label style="display:flex;align-items:center;gap:5px;color:#a78bfa;font-weight:700;cursor:pointer;">'
    + '<input type="checkbox" class="cur-chk-c50" ' + (currentsShowC50 ? 'checked' : '') + '> ت.ع</label>'
    + '</div>';

  html += '<div id="cur-slider-hour" style="text-align:center;font-weight:700;color:#fff;'
    + 'margin-bottom:6px;font-size:.95rem;">' + formatLocalHour(entry.utcDate) + '</div>';

  html += '<div style="display:flex;align-items:center;gap:8px;">'
    + '<button class="cur-play-btn" title="تشغيل تلقائي" style="flex:0 0 auto;border:none;border-radius:8px;'
    + 'background:rgba(45,212,191,0.2);color:#2dd4bf;font-weight:700;font-size:1rem;width:30px;height:30px;'
    + 'cursor:pointer;">' + (currentsPlaying ? '⏸' : '▶') + '</button>'
    + '<input type="range" class="cur-slider" min="0" max="' + (steps.length - 1)
    + '" step="1" value="' + idx + '" style="flex:1;">'
    + '</div>';

  html += '<div style="display:flex;gap:8px;margin-top:4px;">'
    + '<div style="flex:0 0 30px;"></div>'
    + '<div style="flex:1;display:flex;justify-content:space-between;color:#94a3b8;font-size:.65rem;">';
  steps.forEach(function(s) { html += '<span>' + formatLocalHour(s.utcDate) + '</span>'; });
  html += '</div></div>';

  if (!entry.c1 || !entry.c50) {
    html += '<div style="margin-top:6px;color:#fbbf24;font-size:.65rem;text-align:center;">';
    if (!entry.c1)  html += 'تيار السطح غير متوفر لهذه الساعة. ';
    if (!entry.c50) html += 'تيار العمق غير متوفر لهذه الساعة.';
    html += '</div>';
  }

  html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);'
    + 'color:#64748b;font-size:.65rem;text-align:center;">🔄 تُحدَّث تلقائيًا كل 3 ساعات</div>';

  panel.innerHTML = html;

  panel.querySelector('.cur-chk-c1').onchange = function() {
    currentsShowC1 = this.checked;
    applyCurrentsStep(currentsCombinedSteps[currentsActiveIndex]);
  };
  panel.querySelector('.cur-chk-c50').onchange = function() {
    currentsShowC50 = this.checked;
    applyCurrentsStep(currentsCombinedSteps[currentsActiveIndex]);
  };
  panel.querySelector('.cur-play-btn').onclick = function() { toggleCurrentsPlay(); };

  panel.querySelector('.cur-slider').oninput = function() {
    var i = parseInt(this.value, 10);
    currentsActiveIndex = i;
    document.getElementById('cur-slider-hour').textContent = formatLocalHour(steps[i].utcDate);
    applyCurrentsStep(steps[i]);
  };
}

function applyCurrentsStep(entry) {
  if (currentsShowC1 && entry.c1)   { setCurrent1Layer(entry.c1); }
  else                              { clearCurrent1Layer(); }

  if (currentsShowC50 && entry.c50) { setCurrent50Layer(entry.c50); }
  else                               { clearCurrent50Layer(); }
}

function toggleCurrentsPlay() {
  if (currentsPlaying) stopCurrentsPlay(); else startCurrentsPlay();
}

function startCurrentsPlay() {
  if (!currentsCombinedSteps || currentsCombinedSteps.length < 2) return;
  currentsPlaying = true;
  updateCurrentsPlayBtn();
  currentsPlayTimer = setInterval(function() {
    var steps = currentsCombinedSteps;
    var next = (currentsActiveIndex + 1) % steps.length;
    currentsActiveIndex = next;
    var slider = document.querySelector('.cur-slider');
    if (slider) slider.value = next;
    var hourEl = document.getElementById('cur-slider-hour');
    if (hourEl) hourEl.textContent = formatLocalHour(steps[next].utcDate);
    applyCurrentsStep(steps[next]);
  }, 1500);
}

function stopCurrentsPlay() {
  currentsPlaying = false;
  if (currentsPlayTimer) { clearInterval(currentsPlayTimer); currentsPlayTimer = null; }
  updateCurrentsPlayBtn();
}

function updateCurrentsPlayBtn() {
  var btn = document.querySelector('.cur-play-btn');
  if (btn) btn.textContent = currentsPlaying ? '⏸' : '▶';
}

function setCurrent1Layer(entry) {
  if (current1Layer) { map.removeLayer(current1Layer); current1Layer = null; }
  var hourLabel = formatLocalHour(entry.utcDate);

  if (current1LayerCache[entry.name]) {
    current1Layer = current1LayerCache[entry.name];
    current1Layer.addTo(map);
    markCurrent1Visible(true);
    return;
  }

  fetch(entry.download_url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      current1Layer = buildCurrent1Layer(data, hourLabel);
      current1LayerCache[entry.name] = current1Layer;
      current1Layer.addTo(map);
      markCurrent1Visible(true);
    })
    .catch(function(e) {
      console.error('خطأ في تحميل تيار السطح:', e);
      alert('فشل في تحميل بيانات تيار السطح للساعة ' + hourLabel);
    });
}

function clearCurrent1Layer() {
  if (current1Layer) { map.removeLayer(current1Layer); current1Layer = null; }
  markCurrent1Visible(false);
}

function markCurrent1Visible(v) {
  current1Visible = v;
  if (current1Btn) {
    current1Btn.style.background  = v ? 'rgba(239,68,68,0.25)' : 'rgba(239,68,68,0.1)';
    current1Btn.style.borderColor = v ? '#ef4444' : 'rgba(239,68,68,0.3)';
  }
}

function setCurrent50Layer(entry) {
  if (current50Layer) { map.removeLayer(current50Layer); current50Layer = null; }
  var hourLabel = formatLocalHour(entry.utcDate);

  if (current50LayerCache[entry.name]) {
    current50Layer = current50LayerCache[entry.name];
    current50Layer.addTo(map);
    markCurrent50Visible(true);
    return;
  }

  fetch(entry.download_url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      current50Layer = buildCurrent50Layer(data, hourLabel);
      current50LayerCache[entry.name] = current50Layer;
      current50Layer.addTo(map);
      markCurrent50Visible(true);
    })
    .catch(function(e) {
      console.error('خطأ في تحميل تيار العمق:', e);
      alert('فشل في تحميل بيانات تيار العمق للساعة ' + hourLabel);
    });
}

function clearCurrent50Layer() {
  if (current50Layer) { map.removeLayer(current50Layer); current50Layer = null; }
  markCurrent50Visible(false);
}

function markCurrent50Visible(v) {
  current50Visible = v;
  if (current50Btn) {
    current50Btn.style.background  = v ? 'rgba(139,92,246,0.25)' : 'rgba(139,92,246,0.1)';
    current50Btn.style.borderColor = v ? '#8b5cf6' : 'rgba(139,92,246,0.3)';
  }
}

function buildCurrent50Layer(data, dateLabel) {
  return L.geoJSON(data, {
    style: function(feature) {
      var speed = feature.properties.speed || 0;
      var color, fillColor;
      if      (speed >= 0.35) { color = '#7c3aed'; fillColor = '#8b5cf6'; }
      else if (speed >= 0.15) { color = '#2563eb'; fillColor = '#3b82f6'; }
      else                    { color = '#9ca3af'; fillColor = '#d1d5db'; }
      return { color, weight:3, opacity:0.9, fillColor, fillOpacity:0.4 };
    },
    onEachFeature: function(feature, layer) {
      var p = feature.properties || {};
      var html = '<div style="font-family:Tajawal;font-size:.9rem;color:#060d18;text-align:right;direction:rtl;">'
        + '<b>🌊 تيار العمق (50م)' + (dateLabel ? ' — ' + dateLabel : '') + '</b><br>'
        + (p.name      ? 'الاسم: '   + p.name      + '<br>' : '')
        + (p.speed     ? 'السرعة: '  + p.speed     + ' كم/س<br>' : '')
        + (p.direction ? 'الاتجاه: ' + p.direction + '<br>' : '')
        + (p.depth     ? 'العمق: '   + p.depth     + ' م<br>' : '')
        + '</div>';
      layer.bindPopup(html);
    }
  });
}

function buildCurrent1Layer(data, dateLabel) {
  return L.geoJSON(data, {
    style: function(feature) {
      var speed = feature.properties.speed || 0;
      var color, fillColor;
      if      (speed >= 0.50) { color = '#ffffff'; fillColor = '#dc2626'; }
      else if (speed >= 0.35) { color = '#ffffff'; fillColor = '#f97316'; }
      else if (speed >= 0.15) { color = '#ffffff'; fillColor = '#facc15'; }
      else                    { color = '#ffffff'; fillColor = '#ffffff'; }
      return { color, weight:1.5, opacity:1, fillColor, fillOpacity:0.95 };
    },
    onEachFeature: function(feature, layer) {
      var p = feature.properties || {};
      var html = '<div style="font-family:Tajawal;font-size:.9rem;color:#060d18;text-align:right;direction:rtl;">'
        + '<b>🌊 تيار السطح (1م)' + (dateLabel ? ' — ' + dateLabel : '') + '</b><br>'
        + (p.name      ? 'الاسم: '     + p.name      + '<br>' : '')
        + (p.speed     ? 'السرعة: '    + p.speed     + ' كم/س<br>' : '')
        + (p.direction ? 'الاتجاه: '   + p.direction + '<br>' : '')
        + (p.depth     ? 'العمق: '     + p.depth     + ' م<br>' : '')
        + '</div>';
      layer.bindPopup(html);
    }
  });
}

function toggleSSHGeojson(btn) {
  if (sshGeojsonVisible) {
    if (sshGeojsonLayer) map.removeLayer(sshGeojsonLayer);
    sshGeojsonVisible = false;
    btn.style.background  = 'rgba(14,165,233,0.1)';
    btn.style.borderColor = 'rgba(14,165,233,0.3)';
  } else { loadSSHGeojson(btn); }
}

function sshLevelColor(value, min, max) {
  // أزرق (أدنى ارتفاع) → رمادي (وسط) → أحمر (أعلى ارتفاع)
  var low  = [37, 99, 235];   // #2563eb أزرق
  var mid  = [148, 163, 184]; // #94a3b8 رمادي
  var high = [220, 38, 38];   // #dc2626 أحمر
  var t = (max === min) ? 0.5 : (value - min) / (max - min);
  t = Math.max(0, Math.min(1, t));
  var a, b, localT;
  if (t < 0.5) { a = low; b = mid; localT = t / 0.5; }
  else         { a = mid; b = high; localT = (t - 0.5) / 0.5; }
  var r = Math.round(a[0] + (b[0] - a[0]) * localT);
  var g = Math.round(a[1] + (b[1] - a[1]) * localT);
  var bl = Math.round(a[2] + (b[2] - a[2]) * localT);
  return 'rgb(' + r + ',' + g + ',' + bl + ')';
}

function loadSSHGeojson(btn) {
  if (sshGeojsonLayer) {
    sshGeojsonLayer.addTo(map); sshGeojsonVisible = true;
    btn.style.background  = 'rgba(14,165,233,0.25)';
    btn.style.borderColor = '#0ea5e9'; return;
  }
  fetch('ssh.geojson')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var levels = (data.features || [])
        .map(function(f) { return f.properties && f.properties.level; })
        .filter(function(v) { return typeof v === 'number'; });
      var minLevel = levels.length ? Math.min.apply(null, levels) : 0;
      var maxLevel = levels.length ? Math.max.apply(null, levels) : 1;

      sshGeojsonLayer = L.geoJSON(data, {
        style: function(feature) {
          var lvl = (feature.properties && feature.properties.level != null) ? feature.properties.level : minLevel;
          return { color: sshLevelColor(lvl, minLevel, maxLevel), weight: 2.5, opacity: 0.9 };
        },
        onEachFeature: function(feature, layer) {
          var p = feature.properties || {};
          var html = '<div style="font-family:Tajawal;font-size:.9rem;color:#060d18;text-align:right;direction:rtl;">'
            + '<b>🌐 ارتفاع سطح البحر (SSH)</b><br>'
            + (p.level != null ? 'المنسوب: ' + p.level + ' م<br>' : '')
            + '</div>';
          layer.bindPopup(html);
        }
      }).addTo(map);
      sshGeojsonVisible = true;
      btn.style.background  = 'rgba(14,165,233,0.25)';
      btn.style.borderColor = '#0ea5e9';
    })
    .catch(function(e) {
      console.error('خطأ في تحميل ارتفاع السطح:', e);
      alert('فشل في تحميل بيانات ارتفاع السطح. تأكد من وجود ملف ssh.geojson');
    });
}

// ============================================================
// ت ح 0,5 — خطوط تباين الحرارة (tcont.geojson، خاصية ELEV)
// ============================================================

function toggleTCont(btn) {
  if (tcontVisible) {
    if (tcontLayer) map.removeLayer(tcontLayer);
    tcontVisible = false;
    btn.style.background  = 'rgba(249,115,22,0.1)';
    btn.style.borderColor = 'rgba(249,115,22,0.3)';
  } else { loadTCont(btn); }
}

function loadTCont(btn) {
  if (tcontLayer) {
    tcontLayer.addTo(map); tcontVisible = true;
    btn.style.background  = 'rgba(249,115,22,0.25)';
    btn.style.borderColor = '#f97316'; return;
  }
  fetch('tcont.geojson')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var elevs = (data.features || [])
        .map(function(f) { return f.properties && f.properties.ELEV; })
        .filter(function(v) { return typeof v === 'number'; });
      var minElev = elevs.length ? Math.min.apply(null, elevs) : 0;
      var maxElev = elevs.length ? Math.max.apply(null, elevs) : 1;

      tcontLayer = L.geoJSON(data, {
        style: function(feature) {
          var v = (feature.properties && feature.properties.ELEV != null) ? feature.properties.ELEV : minElev;
          return { color: sshLevelColor(v, minElev, maxElev), weight: 2.5, opacity: 0.9 };
        },
        onEachFeature: function(feature, layer) {
          var p = feature.properties || {};
          var html = '<div style="font-family:Tajawal;font-size:.9rem;color:#060d18;text-align:right;direction:rtl;">'
            + '<b>🌡️ خطوط تباين الحرارة</b><br>'
            + (p.ELEV != null ? 'الحرارة: ' + p.ELEV + ' °م<br>' : '')
            + '</div>';
          layer.bindPopup(html);
        }
      }).addTo(map);
      tcontVisible = true;
      btn.style.background  = 'rgba(249,115,22,0.25)';
      btn.style.borderColor = '#f97316';
    })
    .catch(function(e) {
      console.error('خطأ في تحميل خطوط تباين الحرارة:', e);
      alert('فشل في تحميل بيانات ت ح 0,5. تأكد من وجود ملف tcont.geojson');
    });
}

// ============================================================
// sstn — صورة مؤقتة (بدون أرشفة بمجلد تاريخ)، تُقرأ مباشرة من tiles/
// ============================================================

function toggleSSTN(btn) {
  if (sstnVisible) {
    if (sstnOverlay) { map.removeLayer(sstnOverlay); sstnOverlay = null; }
    sstnVisible = false;
    btn.style.background  = 'rgba(236,72,153,0.1)';
    btn.style.borderColor = 'rgba(236,72,153,0.3)';
  } else { loadSSTN(btn); }
}

function loadSSTN(btn) {
  // صورة مؤقتة — تُجلب حية بدون كاش في كل مرة (بدون حفظ/إعادة استخدام overlay قديم)
  var url = TILES_BASE + 'sstn.png?_=' + Date.now();
  var img = new Image();
  img.onload = function() {
    sstnOverlay = L.imageOverlay(url, layerBounds('sst'), { opacity: currentOpacity }).addTo(map);
    sstnVisible = true;
    btn.style.background  = 'rgba(236,72,153,0.25)';
    btn.style.borderColor = '#ec4899';
  };
  img.onerror = function() {
    alert('تعذر تحميل صورة sstn. تأكد من وجود tiles/sstn.png');
  };
  img.src = url;
}

// ============================================================
// الأخطار البحرية — اكتشاف تلقائي لكل الملفات في مجلد dangers/
// ============================================================

var DANGERS_REPO_OWNER = 'Tayebarouche4';
var DANGERS_REPO_NAME  = 'fishing-map';
var DANGERS_FOLDER     = 'dangers';

var dangerLayerGroup = null;
var dangersVisible   = false;
var dangersLoading   = false;

var DANGER_STYLE_MAP = {
  rocks:  { color:'#dc2626', fillColor:'#ef4444', title:'⚠️ منطقة صخرية', titleColor:'#dc2626' },
  wrecks: { color:'#7c3aed', fillColor:'#8b5cf6', title:'⚓ حطام سفينة',  titleColor:'#7c3aed' },
  debris: { color:'#ea580c', fillColor:'#f97316', title:'🗑️ مخلفات',     titleColor:'#ea580c' },
};

// يحدد نوع الملف من اسمه — يدعم التسمية الجديدة (rocks_2026-07-10) والأسماء القديمة (hotam/mokhalfat)
function classifyDangerFile(filename) {
  var name = filename.toLowerCase();
  if (name.indexOf('rock')   === 0) return 'rocks';
  if (name.indexOf('wreck')  === 0 || name.indexOf('hotam')     === 0) return 'wrecks';
  if (name.indexOf('debris') === 0 || name.indexOf('mokhalfat') === 0) return 'debris';
  return null; // نوع غير معروف — يُعرض بشكل محايد بدل ما يُتجاهل
}

// الزر يعرض/يخفي كل ملفات مجلد dangers/ دفعة واحدة — بلا قائمة اختيار
function toggleDangersDropdown(tab) {
  if (dangersLoading) return;

  if (dangersVisible) {
    if (dangerLayerGroup) map.removeLayer(dangerLayerGroup);
    dangersVisible = false;
    updateDangersTabStatus();
    return;
  }
  loadAllDangerFiles();
}

function loadAllDangerFiles() {
  dangersLoading = true;
  var listUrl = 'https://api.github.com/repos/' + DANGERS_REPO_OWNER + '/' + DANGERS_REPO_NAME
              + '/contents/' + DANGERS_FOLDER;

  fetch(listUrl)
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(items) {
      var files = (items || []).filter(function(it) {
        return it.type === 'file' && /\.geojson$/i.test(it.name);
      });

      if (files.length === 0) {
        dangersLoading = false;
        alert('لا توجد ملفات أخطار في مجلد "' + DANGERS_FOLDER + '" حالياً');
        return;
      }

      dangerLayerGroup = L.layerGroup();

      var loaders = files.map(function(file) {
        var kind = classifyDangerFile(file.name);
        var st   = DANGER_STYLE_MAP[kind];
        return fetch(file.download_url)
          .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function(data) {
            var layer = L.geoJSON(data, {
              style: function() {
                return st
                  ? { color:st.color, weight:2, opacity:0.8, fillColor:st.fillColor, fillOpacity:0.3 }
                  : { color:'#94a3b8', weight:2, opacity:0.8, fillColor:'#cbd5e1', fillOpacity:0.3 };
              },
              pointToLayer: function(feature, latlng) {
                return L.circle(latlng, {
                  radius:25,
                  fillColor: st ? st.color : '#94a3b8',
                  color:'#fff', weight:2, opacity:1, fillOpacity:0.8
                });
              },
              onEachFeature: function(feature, layer) {
                if (!feature.properties) return;
                var title      = st ? st.title      : ('⚠️ ' + file.name);
                var titleColor = st ? st.titleColor  : '#475569';
                var html = '<div style="text-align:right;direction:rtl;font-family:Tajawal,sans-serif;">'
                  + '<h4 style="margin:0 0 8px 0;color:' + titleColor + ';">' + title + '</h4>';
                for (var key in feature.properties) {
                  if (feature.properties[key])
                    html += '<div><strong>' + key + ':</strong> ' + feature.properties[key] + '</div>';
                }
                html += '</div>';
                layer.bindPopup(html);
              }
            });
            layer.addTo(dangerLayerGroup);
          })
          .catch(function(e) { console.error('تعذر تحميل ملف الخطر ' + file.name + ':', e); });
      });

      Promise.all(loaders).then(function() {
        dangerLayerGroup.addTo(map);
        dangersVisible  = true;
        dangersLoading  = false;
        updateDangersTabStatus();
      });
    })
    .catch(function(e) {
      dangersLoading = false;
      console.error('تعذر جلب قائمة ملفات الأخطار:', e);
      alert('تعذر الاتصال بمجلد "' + DANGERS_FOLDER + '" على GitHub — تأكد من وجود المجلد في الـ repo');
    });
}

function updateDangersTabStatus() {
  var dangersTab  = document.getElementById('dangers-tab');
  var activeLabel = document.getElementById('active-label');

  if (dangersVisible) {
    dangersTab.classList.add('active');
    activeLabel.textContent = 'أخطار';
    document.getElementById('legend').style.display = 'none';
  } else {
    dangersTab.classList.remove('active');
    var activeLayer = document.querySelector('.layer-tab.active:not(#dangers-tab)');
    if (!activeLayer) activeLabel.textContent = 'اختر طبقة';
    else document.getElementById('legend').style.display = 'block';
  }
}

// ============================================================
// الباثيمتري — EMODnet WMS
// ============================================================

var EMODNET_WMS        = 'https://ows.emodnet-bathymetry.eu/wms';
var bathyDepthLayer    = null;
var bathyContourLayer  = null;
var bathyWrecksLayer   = null;

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

// ============================================================
// طرق الشاليات — اكتشاف تلقائي لكل الملفات في مجلد tractour/
// (نفس أسلوب الأخطار البحرية: أي عدد من ملفات .geojson مثل 1.geojson،
//  2.geojson... تُقرأ تلقائياً بدون تعديل الكود عند إضافة ملف جديد)
// ============================================================

var TRACTOUR_REPO_OWNER = 'Tayebarouche4';
var TRACTOUR_REPO_NAME  = 'fishing-map';
var TRACTOUR_FOLDER     = 'tractour';

var tractourLayerGroup = null;
var tractourVisible    = false;
var tractourLoading    = false;

function toggleTractour(btn) {
  if (tractourLoading) return;

  if (tractourVisible) {
    if (tractourLayerGroup) map.removeLayer(tractourLayerGroup);
    tractourVisible = false;
    btn.classList.remove('active');
    return;
  }

  if (tractourLayerGroup) {
    tractourLayerGroup.addTo(map);
    tractourVisible = true;
    btn.classList.add('active');
    return;
  }

  loadAllTractourFiles(btn);
}

function loadAllTractourFiles(btn) {
  tractourLoading = true;
  var listUrl = 'https://api.github.com/repos/' + TRACTOUR_REPO_OWNER + '/' + TRACTOUR_REPO_NAME
              + '/contents/' + TRACTOUR_FOLDER;

  fetch(listUrl)
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(items) {
      var files = (items || []).filter(function(it) {
        return it.type === 'file' && /\.geojson$/i.test(it.name);
      });

      if (files.length === 0) {
        tractourLoading = false;
        alert('لا توجد ملفات في مجلد "' + TRACTOUR_FOLDER + '" حالياً');
        return;
      }

      tractourLayerGroup = L.layerGroup();

      var loaders = files.map(function(file) {
        return fetch(file.download_url)
          .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function(data) {
            var label = file.name.replace(/\.geojson$/i, '');
            var layer = L.geoJSON(data, {
              style: function() {
                return { color: '#f59e0b', weight: 3, opacity: 0.9 };
              },
              pointToLayer: function(feature, latlng) {
                return L.circleMarker(latlng, {
                  radius: 6, color: '#fff', weight: 2,
                  fillColor: '#f59e0b', fillOpacity: 0.9
                });
              },
              onEachFeature: function(feature, layer) {
                var html = '<div style="text-align:right;direction:rtl;font-family:Tajawal,sans-serif;">'
                  + '<h4 style="margin:0 0 8px 0;color:#b45309;">🛣️ طريق الشاليات ' + label + '</h4>';
                if (feature.properties) {
                  for (var key in feature.properties) {
                    if (feature.properties[key])
                      html += '<div><strong>' + key + ':</strong> ' + feature.properties[key] + '</div>';
                  }
                }
                html += '</div>';
                layer.bindPopup(html);
              }
            });
            layer.addTo(tractourLayerGroup);
          })
          .catch(function(e) { console.error('تعذر تحميل ملف ' + file.name + ':', e); });
      });

      Promise.all(loaders).then(function() {
        tractourLayerGroup.addTo(map);
        tractourVisible = true;
        tractourLoading = false;
        btn.classList.add('active');
      });
    })
    .catch(function(e) {
      tractourLoading = false;
      console.error('تعذر جلب قائمة ملفات طرق الشاليات:', e);
      alert('تعذر الاتصال بمجلد "' + TRACTOUR_FOLDER + '" على GitHub — تأكد من وجود المجلد في الـ repo');
    });
}
