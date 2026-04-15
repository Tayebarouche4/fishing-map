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
var current1Layer    = null, current1Visible  = false;
var current50Layer   = null, current50Visible = false;

function toggleCurrent1(btn) {
  if (current1Visible) {
    if (current1Layer) map.removeLayer(current1Layer);
    current1Visible = false;
    btn.style.background  = 'rgba(239,68,68,0.1)';
    btn.style.borderColor = 'rgba(239,68,68,0.3)';
    hideCurrent1Legend();
  } else { loadCurrent1(btn); }
}

function toggleCurrent50(btn) {
  if (current50Visible) {
    if (current50Layer) map.removeLayer(current50Layer);
    current50Visible = false;
    btn.style.background  = 'rgba(139,92,246,0.1)';
    btn.style.borderColor = 'rgba(139,92,246,0.3)';
  } else { loadCurrent50(btn); }
}

function loadCurrent1(btn) {
  if (current1Layer) {
    current1Layer.addTo(map); current1Visible = true;
    btn.style.background  = 'rgba(239,68,68,0.25)';
    btn.style.borderColor = '#ef4444'; return;
  }
  fetch('current1.geojson')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      current1Layer = L.geoJSON(data, {
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
            + '<b>🌊 تيار السطح (1م)</b><br>'
            + (p.name      ? 'الاسم: '     + p.name      + '<br>' : '')
            + (p.speed     ? 'السرعة: '    + p.speed     + ' كم/س<br>' : '')
            + (p.direction ? 'الاتجاه: '   + p.direction + '<br>' : '')
            + (p.depth     ? 'العمق: '     + p.depth     + ' م<br>' : '')
            + '</div>';
          layer.bindPopup(html);
        }
      }).addTo(map);
      current1Visible = true;
      btn.style.background  = 'rgba(239,68,68,0.25)';
      btn.style.borderColor = '#ef4444';
      showCurrent1Legend();
    })
    .catch(function(e) {
      console.error('خطأ في تحميل تيار السطح:', e);
      alert('فشل في تحميل بيانات تيار السطح. تأكد من وجود ملف current1.geojson');
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
// الأخطار البحرية
// ============================================================

var dangerLayers  = {};
var activeDangers = new Set();

function toggleDangersDropdown(tab) {
  var dropdown  = document.getElementById('dangers-dropdown');
  var isVisible = dropdown.style.display !== 'none';
  dropdown.style.display = isVisible ? 'none' : 'block';
  tab.classList.toggle('active', !isVisible);
}

function toggleDanger(type, isChecked) {
  if (isChecked) { activeDangers.add(type);    loadDangerLayer(type);   }
  else           { activeDangers.delete(type); removeDangerLayer(type); }
  updateDangersTabStatus();
}

function loadDangerLayer(type) {
  if (dangerLayers[type]) { dangerLayers[type].addTo(map); return; }

  var fileMap  = { rocks:'rocks.geojson', wrecks:'hotam.geojson', debris:'mokhalfat.geojson' };
  var styleMap = {
    rocks:  { color:'#dc2626', fillColor:'#ef4444', title:'⚠️ منطقة صخرية',  titleColor:'#dc2626' },
    wrecks: { color:'#7c3aed', fillColor:'#8b5cf6', title:'⚓ حطام سفينة',   titleColor:'#7c3aed' },
    debris: { color:'#ea580c', fillColor:'#f97316', title:'🗑️ مخلفات',      titleColor:'#ea580c' },
  };

  var file = fileMap[type];
  if (!file) {
    // أنواع غير متاحة بعد (كابلات)
    var names = { cables:'كابلات' };
    var msg = document.createElement('div');
    msg.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);'
      + 'background:rgba(6,13,24,0.95);border:1px solid var(--border);border-radius:12px;'
      + 'padding:20px;color:var(--text);text-align:center;z-index:1000;';
    msg.innerHTML = '<h3 style="margin:0 0 10px 0;">' + (names[type] || type) + '</h3>'
      + '<p>بيانات هذا النوع من الأخطار غير متاحة حالياً</p>';
    document.body.appendChild(msg);
    setTimeout(function() {
      document.body.removeChild(msg);
      document.getElementById('danger-' + type).checked = false;
      activeDangers.delete(type);
    }, 3000);
    return;
  }

  var st = styleMap[type];
  fetch(file)
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      dangerLayers[type] = L.geoJSON(data, {
        style: function() {
          return { color:st.color, weight:2, opacity:0.8, fillColor:st.fillColor, fillOpacity:0.3 };
        },
        pointToLayer: function(feature, latlng) {
          return L.circle(latlng, {
            radius:25, fillColor:st.color, color:'#fff', weight:2, opacity:1, fillOpacity:0.8
          });
        },
        onEachFeature: function(feature, layer) {
          if (!feature.properties) return;
          var html = '<div style="text-align:right;direction:rtl;font-family:Tajawal,sans-serif;">'
            + '<h4 style="margin:0 0 8px 0;color:' + st.titleColor + ';">' + st.title + '</h4>';
          for (var key in feature.properties) {
            if (feature.properties[key])
              html += '<div><strong>' + key + ':</strong> ' + feature.properties[key] + '</div>';
          }
          html += '</div>';
          layer.bindPopup(html);
        }
      }).addTo(map);
    })
    .catch(function(error) {
      console.error('Error loading ' + type + ':', error);
      alert('تعذر تحميل بيانات ' + (styleMap[type] ? styleMap[type].title : type));
      document.getElementById('danger-' + type).checked = false;
      activeDangers.delete(type);
    });
}

function removeDangerLayer(type) {
  if (dangerLayers[type]) map.removeLayer(dangerLayers[type]);
}

function updateDangersTabStatus() {
  var dangersTab  = document.getElementById('dangers-tab');
  var activeLabel = document.getElementById('active-label');
  var dangerNames = { rocks:'مناطق صخرية', wrecks:'حطام سفن', cables:'كابلات', debris:'مخلفات' };

  if (activeDangers.size > 0) {
    dangersTab.classList.add('active');
    activeLabel.textContent = activeDangers.size === 1
      ? (dangerNames[Array.from(activeDangers)[0]] || 'أخطار')
      : 'أخطار (' + activeDangers.size + ')';
    document.getElementById('legend').style.display = 'none';
  } else {
    dangersTab.classList.remove('active');
    if (!document.querySelector('.layer-tab.active:not(#dangers-tab)'))
      activeLabel.textContent = 'اختر طبقة';
    var activeLayer = document.querySelector('.layer-tab.active:not(#dangers-tab)');
    if (activeLayer) document.getElementById('legend').style.display = 'block';
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
function showCurrent1Legend() {
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
    '<div style="font-weight:700;margin-bottom:8px;font-size:.8rem;color:#fff;">🌊 تيار السطح (م/ث)</div>',
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
