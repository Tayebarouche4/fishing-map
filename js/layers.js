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

// أرشيف تيار السطح (1م) — يُعرض عبر قائمة تاريخية بدل تحميل ملف واحد ثابت
var CURRENTS_REPO_OWNER     = 'Tayebarouche4';
var CURRENTS_REPO_NAME      = 'fishing-map';
var CURRENT1_HISTORY_FOLDER = 'currents/current1';

var current1LayerCache  = {};     // filename -> L.GeoJSON (مُحمّل مسبقاً، غير مضاف بالضرورة للخريطة)
var current1HistoryList = null;   // قائمة {name, date, download_url} مُخزّنة بعد أول جلب
var current1HistoryOpen = false;
var current1ActiveFile  = null;   // اسم الملف المعروض حالياً على الخريطة
var current1Btn         = null;

function toggleCurrent1(btn) {
  current1Btn = btn;
  if (current1HistoryOpen) { closeCurrent1History(); return; }
  openCurrent1History(btn);
}

function openCurrent1History(btn) {
  var panel = getCurrent1HistoryPanel();
  panel.style.display = 'block';
  current1HistoryOpen = true;

  if (current1HistoryList) {
    renderCurrent1HistoryList(current1HistoryList);
    return;
  }

  panel.innerHTML = '<div style="padding:10px;color:#94a3b8;">جاري التحميل...</div>';
  var listUrl = 'https://api.github.com/repos/' + CURRENTS_REPO_OWNER + '/' + CURRENTS_REPO_NAME
              + '/contents/' + CURRENT1_HISTORY_FOLDER;

  fetch(listUrl)
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(items) {
      var files = (items || [])
        .filter(function(it) { return it.type === 'file' && /\.geojson$/i.test(it.name); })
        .map(function(it) {
          var m = it.name.match(/(\d{4}-\d{2}-\d{2})/);
          return { name: it.name, date: m ? m[1] : it.name, download_url: it.download_url };
        })
        .sort(function(a, b) { return a.date < b.date ? 1 : -1; }); // الأحدث أولاً

      if (files.length === 0) {
        panel.innerHTML = '<div style="padding:10px;color:#94a3b8;">لا توجد بيانات تاريخية بعد في مجلد "' + CURRENT1_HISTORY_FOLDER + '"</div>';
        return;
      }
      current1HistoryList = files;
      renderCurrent1HistoryList(files);
    })
    .catch(function(e) {
      console.error('تعذر جلب أرشيف تيار السطح:', e);
      panel.innerHTML = '<div style="padding:10px;color:#f87171;">تعذر تحميل الأرشيف — تحقق من الاتصال أو من وجود المجلد "' + CURRENT1_HISTORY_FOLDER + '"</div>';
    });
}

function closeCurrent1History() {
  var panel = document.getElementById('current1-history-panel');
  if (panel) panel.style.display = 'none';
  current1HistoryOpen = false;
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

    // إغلاق عند النقر خارج القائمة
    document.addEventListener('click', function(ev) {
      if (!current1HistoryOpen) return;
      var withinPanel = panel.contains(ev.target);
      var withinBtn   = current1Btn && current1Btn.contains(ev.target);
      if (!withinPanel && !withinBtn) closeCurrent1History();
    });
  }
  return panel;
}

function renderCurrent1HistoryList(files) {
  var panel = getCurrent1HistoryPanel();
  var html = '<div style="font-weight:700;margin-bottom:6px;color:#fff;">🌊 أرشيف تيار السطح (1م)</div>';

  if (current1Visible) {
    html += '<div class="c1-history-hide" style="padding:7px 10px;margin-bottom:6px;border-radius:8px;'
      + 'cursor:pointer;background:rgba(255,255,255,0.08);color:#f87171;font-weight:700;">'
      + '&#10006; إخفاء الطبقة الحالية</div>';
  }

  files.forEach(function(f) {
    var active = (f.name === current1ActiveFile);
    html += '<div class="c1-history-item" data-file="' + f.name + '" style="'
      + 'padding:7px 10px;margin-bottom:4px;border-radius:8px;cursor:pointer;'
      + 'background:' + (active ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.05)') + ';'
      + 'border:1px solid ' + (active ? '#ef4444' : 'transparent') + ';">'
      + f.date + (active ? ' &#9679;' : '') + '</div>';
  });

  panel.innerHTML = html;

  var hideBtn = panel.querySelector('.c1-history-hide');
  if (hideBtn) hideBtn.onclick = function() { hideCurrent1Layer(); };

  Array.prototype.forEach.call(panel.querySelectorAll('.c1-history-item'), function(el) {
    el.onclick = function() {
      var fileName = this.getAttribute('data-file');
      var entry = current1HistoryList.filter(function(f) { return f.name === fileName; })[0];
      if (entry) loadCurrent1Snapshot(entry);
    };
  });
}

function loadCurrent1Snapshot(entry) {
  closeCurrent1History();

  if (current1Layer) { map.removeLayer(current1Layer); current1Layer = null; }

  if (current1LayerCache[entry.name]) {
    current1Layer = current1LayerCache[entry.name];
    current1Layer.addTo(map);
    finishCurrent1Load(entry);
    return;
  }

  fetch(entry.download_url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      current1Layer = buildCurrent1Layer(data, entry.date);
      current1LayerCache[entry.name] = current1Layer;
      current1Layer.addTo(map);
      finishCurrent1Load(entry);
    })
    .catch(function(e) {
      console.error('خطأ في تحميل تيار السطح:', e);
      alert('فشل في تحميل بيانات تيار السطح لتاريخ ' + entry.date);
    });
}

function finishCurrent1Load(entry) {
  current1Visible     = true;
  current1ActiveFile  = entry.name;
  if (current1Btn) {
    current1Btn.style.background  = 'rgba(239,68,68,0.25)';
    current1Btn.style.borderColor = '#ef4444';
  }
  showCurrent1Legend(entry.date);
}

function hideCurrent1Layer() {
  if (current1Layer) map.removeLayer(current1Layer);
  current1Visible    = false;
  current1ActiveFile = null;
  if (current1Btn) {
    current1Btn.style.background  = 'rgba(239,68,68,0.1)';
    current1Btn.style.borderColor = 'rgba(239,68,68,0.3)';
  }
  hideCurrent1Legend();
  closeCurrent1History();
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
