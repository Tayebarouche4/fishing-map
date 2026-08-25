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

// ===== تيارات البحر =====
var current1Layer      = null, current1Visible  = false;
var current50Layer     = null, current50Visible = false;
var sshGeojsonLayer    = null, sshGeojsonVisible = false;
var tcontLayer         = null, tcontVisible = false;
var sstnOverlay        = null, sstnVisible = false;

// أرشيف تيار السطح (1م) — يُعرض عبر شريط تمرير زمني (الآن ← +12 ساعة، كل 3 ساعات)
var CURRENTS_REPO_OWNER     = 'Tayebarouche4';
var CURRENTS_REPO_NAME      = 'fishing-map';
var CURRENT1_HISTORY_FOLDER = 'currents/current1';

// صيغة اسم الملف من خط الأنابيب: current1_YYYY-MM-DD_HHh00Z.geojson
// الساعة داخل الاسم هي توقيت UTC الفعلي للبيانات — القراءة تعتمد عليها مباشرة
// (لا على ترتيب افتراضي) لضمان عرض الساعة الصحيحة دائمًا حتى لو تغيّر عدد
// المحطات أو تأخرت إحداها.
var CURRENT1_FILENAME_RE = /^current1_(\d{4})-(\d{2})-(\d{2})_(\d{2})h00Z\.geojson$/i;

var current1LayerCache   = {};     // filename -> L.GeoJSON (مُحمّل مسبقاً، غير مضاف بالضرورة للخريطة)
var current1TimeSteps    = null;   // [{name, utcDate, download_url}] مرتبة تصاعديًا حسب الوقت
var current1SliderOpen   = false;
var current1ActiveIndex  = null;   // index المحطة المعروضة حالياً على الخريطة
var current1Btn          = null;

function toggleCurrent1(btn) {
  current1Btn = btn;
  if (current1SliderOpen) { closeCurrent1Slider(); return; }
  openCurrent1Slider(btn);
}

function parseCurrent1UtcDate(filename) {
  var m = filename.match(CURRENT1_FILENAME_RE);
  if (!m) return null;
  var iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':00:00Z';
  var d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// عرض الساعة بتوقيت الجزائر (UTC+1 ثابت، بدون توقيت صيفي)
function formatLocalHour(utcDate) {
  var local = new Date(utcDate.getTime() + 60 * 60 * 1000);
  return String(local.getUTCHours()).padStart(2, '0') + ':00';
}

function openCurrent1Slider(btn) {
  var panel = getCurrent1HistoryPanel();
  panel.style.display = 'block';
  current1SliderOpen = true;

  if (current1TimeSteps) {
    renderCurrent1Slider();
    return;
  }

  panel.innerHTML = '<div style="padding:10px;color:#94a3b8;">جاري التحميل...</div>';
  var listUrl = 'https://api.github.com/repos/' + CURRENTS_REPO_OWNER + '/' + CURRENTS_REPO_NAME
              + '/contents/' + CURRENT1_HISTORY_FOLDER;

  fetch(listUrl)
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(items) {
      var steps = (items || [])
        .filter(function(it) { return it.type === 'file' && /\.geojson$/i.test(it.name); })
        .map(function(it) {
          var utcDate = parseCurrent1UtcDate(it.name);
          return utcDate ? { name: it.name, utcDate: utcDate, download_url: it.download_url } : null;
        })
        .filter(Boolean)
        .sort(function(a, b) { return a.utcDate - b.utcDate; }); // الأقدم أولاً = الآن، ثم +3 +6 +9 +12

      if (steps.length === 0) {
        panel.innerHTML = '<div style="padding:10px;color:#94a3b8;">لا توجد بيانات تيار حالياً في مجلد "' + CURRENT1_HISTORY_FOLDER + '"</div>';
        return;
      }
      current1TimeSteps = steps;
      current1ActiveIndex = 0;
      renderCurrent1Slider();
    })
    .catch(function(e) {
      console.error('تعذر جلب أرشيف تيار السطح:', e);
      panel.innerHTML = '<div style="padding:10px;color:#f87171;">تعذر تحميل الأرشيف — تحقق من الاتصال أو من وجود المجلد "' + CURRENT1_HISTORY_FOLDER + '"</div>';
    });
}

function closeCurrent1Slider() {
  var panel = document.getElementById('current1-history-panel');
  if (panel) panel.style.display = 'none';
  current1SliderOpen = false;
}

function getCurrent1HistoryPanel() {
  var panel = document.getElementById('current1-history-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'current1-history-panel';
    panel.style.cssText = [
      'position:fixed', 'bottom:150px', 'left:16px', 'z-index:1060',
      'background:rgba(6,13,24,0.97)', 'border:1px solid rgba(239,68,68,0.35)',
      'border-radius:12px', 'padding:8px', 'font-family:Tajawal,sans-serif',
      'font-size:.75rem', 'color:#e2e8f0', 'direction:rtl', 'min-width:180px',
      'max-height:280px', 'overflow-y:auto', 'box-shadow:0 4px 16px rgba(0,0,0,0.5)'
    ].join(';');
    document.body.appendChild(panel);

    // إغلاق عند النقر خارج اللوحة — لا يُغلق عند النقر/السحب داخل الشريط نفسه
    document.addEventListener('click', function(ev) {
      if (!current1SliderOpen) return;
      var withinPanel = panel.contains(ev.target);
      var withinBtn   = current1Btn && current1Btn.contains(ev.target);
      if (!withinPanel && !withinBtn) closeCurrent1Slider();
    });
  }
  return panel;
}

function renderCurrent1Slider() {
  var panel = getCurrent1HistoryPanel();
  var steps = current1TimeSteps;
  var idx = (current1ActiveIndex != null) ? current1ActiveIndex : 0;

  var html = '<div style="font-weight:700;margin-bottom:8px;color:#fff;">🌊 تيار السطح — توقّع الساعات</div>';

  if (current1Visible) {
    html += '<div class="c1-hide" style="padding:6px 10px;margin-bottom:8px;border-radius:8px;'
      + 'cursor:pointer;background:rgba(255,255,255,0.08);color:#f87171;font-weight:700;text-align:center;">'
      + '&#10006; إخفاء الطبقة</div>';
  }

  html += '<div id="c1-slider-hour" style="text-align:center;font-weight:700;color:#fff;'
    + 'margin-bottom:6px;font-size:.95rem;">' + formatLocalHour(steps[idx].utcDate) + '</div>';

  html += '<input type="range" class="c1-slider" min="0" max="' + (steps.length - 1)
    + '" step="1" value="' + idx + '" style="width:100%;">';

  html += '<div style="display:flex;justify-content:space-between;margin-top:4px;color:#94a3b8;font-size:.65rem;">';
  steps.forEach(function(s) { html += '<span>' + formatLocalHour(s.utcDate) + '</span>'; });
  html += '</div>';

  html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);'
    + 'color:#64748b;font-size:.65rem;text-align:center;">🔄 تُحدَّث تلقائيًا كل 3 ساعات</div>';

  panel.innerHTML = html;

  var hideBtn = panel.querySelector('.c1-hide');
  if (hideBtn) hideBtn.onclick = function() { hideCurrent1Layer(); };

  var slider = panel.querySelector('.c1-slider');
  slider.oninput = function() {
    var i = parseInt(this.value, 10);
    current1ActiveIndex = i;
    document.getElementById('c1-slider-hour').textContent = formatLocalHour(steps[i].utcDate);
    loadCurrent1Snapshot(steps[i]);
  };
}

function loadCurrent1Snapshot(entry) {
  if (current1Layer) { map.removeLayer(current1Layer); current1Layer = null; }
  var hourLabel = formatLocalHour(entry.utcDate);

  if (current1LayerCache[entry.name]) {
    current1Layer = current1LayerCache[entry.name];
    current1Layer.addTo(map);
    finishCurrent1Load(entry, hourLabel);
    return;
  }

  fetch(entry.download_url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      current1Layer = buildCurrent1Layer(data, hourLabel);
      current1LayerCache[entry.name] = current1Layer;
      current1Layer.addTo(map);
      finishCurrent1Load(entry, hourLabel);
    })
    .catch(function(e) {
      console.error('خطأ في تحميل تيار السطح:', e);
      alert('فشل في تحميل بيانات تيار السطح للساعة ' + hourLabel);
    });
}

function finishCurrent1Load(entry, hourLabel) {
  current1Visible = true;
  if (current1Btn) {
    current1Btn.style.background  = 'rgba(239,68,68,0.25)';
    current1Btn.style.borderColor = '#ef4444';
  }
  showCurrent1Legend(hourLabel);
}

function hideCurrent1Layer() {
  if (current1Layer) map.removeLayer(current1Layer);
  current1Visible = false;
  if (current1Btn) {
    current1Btn.style.background  = 'rgba(239,68,68,0.1)';
    current1Btn.style.borderColor = 'rgba(239,68,68,0.3)';
  }
  hideCurrent1Legend();
  closeCurrent1Slider();
}

function toggleCurrent50(btn) {
  if (current50Visible) {
    if (current50Layer) map.removeLayer(current50Layer);
    current50Visible = false;
    btn.style.background  = 'rgba(139,92,246,0.1)';
    btn.style.borderColor = 'rgba(139,92,246,0.3)';
  } else { loadCurrent50(btn); }
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

function loadCurrent50(btn) {
  if (current50Layer) {
    current50Layer.addTo(map); current50Visible = true;
    btn.style.background  = 'rgba(139,92,246,0.25)';
    btn.style.borderColor = '#8b5cf6'; return;
  }
  fetch('current50.geojson')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      current50Layer = L.geoJSON(data, {
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
            + '<b>🌊 تيار العمق (50م)</b><br>'
            + (p.name      ? 'الاسم: '   + p.name      + '<br>' : '')
            + (p.speed     ? 'السرعة: '  + p.speed     + ' كم/س<br>' : '')
            + (p.direction ? 'الاتجاه: ' + p.direction + '<br>' : '')
            + (p.depth     ? 'العمق: '   + p.depth     + ' م<br>' : '')
            + '</div>';
          layer.bindPopup(html);
        }
      }).addTo(map);
      current50Visible = true;
      btn.style.background  = 'rgba(139,92,246,0.25)';
      btn.style.borderColor = '#8b5cf6';
    })
    .catch(function(e) {
      console.error('خطأ في تحميل تيار العمق:', e);
      alert('فشل في تحميل بيانات تيار العمق. تأكد من وجود ملف current50.geojson');
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
// Legend تيار السطح — يبقى ظاهراً طالما الطبقة مفعّلة
// ============================================================
function showCurrent1Legend(dateLabel) {
  // احذف القديم إن وُجد وأنشئ جديداً دائماً
  hideCurrent1Legend();

  var el = document.createElement('div');
  el.id = 'current1-legend';
  el.style.cssText = [
    'position:fixed',
    'bottom:90px',
    'left:16px',
    'z-index:1050',
    'background:rgba(6,13,24,0.92)',
    'border:1px solid rgba(255,255,255,0.15)',
    'border-radius:12px',
    'padding:10px 14px',
    'font-family:Tajawal,sans-serif',
    'font-size:0.75rem',
    'color:#e2e8f0',
    'direction:rtl',
    'min-width:160px',
    'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
    'pointer-events:none'
  ].join(';');

  el.innerHTML = [
    '<div style="font-weight:700;margin-bottom:8px;font-size:.8rem;color:#fff;">🌊 تيار السطح (م/ث)' + (dateLabel ? ' — ' + dateLabel : '') + '</div>',
    _c1LegendRow('#ffffff', 'ضعيف   < 0.15'),
    _c1LegendRow('#facc15', 'متوسط  0.15 – 0.35'),
    _c1LegendRow('#f97316', 'قوي    0.35 – 0.50'),
    _c1LegendRow('#dc2626', 'شديد   > 0.50')
  ].join('');

  document.body.appendChild(el);
}

function hideCurrent1Legend() {
  var el = document.getElementById('current1-legend');
  if (el) el.parentNode.removeChild(el);
}

function _c1LegendRow(color, label) {
  return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
    + '<span style="display:inline-block;width:14px;height:14px;border-radius:3px;'
    + 'background:' + color + ';flex-shrink:0;'
    + 'border:1px solid rgba(255,255,255,0.3);"></span>'
    + '<span style="color:#cbd5e1;">' + label + '</span></div>';
}
