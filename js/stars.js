/* =============================================================
   stars.js — نظام معالم النجوم للصياد
   يُخزَّن في localStorage فقط، بدون أي سيرفر
   ============================================================= */

(function () {

  /* ---- إعدادات الألوان ---- */
  var STAR_COLORS = {
    red:    { emoji: '🔴', label: 'نقطة مهمة',  hex: '#ef4444' },
    green:  { emoji: '🟢', label: 'صيد جيد',     hex: '#22c55e' },
    yellow: { emoji: '🟡', label: 'ملاحظة',      hex: '#eab308' }
  };

  var STORAGE_KEY  = 'fishingStars_v1';
  var starMenuOpen = false;
  var activeColor  = null;
  var starMarkers  = {};        // { id: L.marker }
  var starLayer    = null;

  /* ---- انتظار تهيئة الخريطة ---- */
  function initStars() {
    if (typeof map === 'undefined' || !map) {
      setTimeout(initStars, 400);
      return;
    }
    starLayer = L.layerGroup().addTo(map);
    loadFromStorage();

    map.on('click', function (e) {
      if (!activeColor) return;
      addStar(null, e.latlng.lat, e.latlng.lng, activeColor);
      deactivateMode();
    });
  }

  /* ============================================================
     واجهة المستخدم — فتح/إغلاق القائمة
  ============================================================ */
  window.toggleStarMenu = function () {
    starMenuOpen = !starMenuOpen;
    var menu = document.getElementById('star-menu');
    var fab  = document.getElementById('star-fab');
    if (starMenuOpen) {
      menu.classList.add('open');
      fab.classList.add('menu-open');
    } else {
      menu.classList.remove('open');
      fab.classList.remove('menu-open');
    }
  };

  /* ---- تفعيل وضع الإضافة ---- */
  window.activateStarMode = function (color) {
    activeColor  = color;
    starMenuOpen = false;
    document.getElementById('star-menu').classList.remove('open');

    var fab = document.getElementById('star-fab');
    fab.classList.remove('menu-open');
    fab.classList.add('mode-active');
    fab.textContent = STAR_COLORS[color].emoji;
    fab.style.setProperty('--star-active-color', STAR_COLORS[color].hex);

    map.getContainer().style.cursor = 'crosshair';
    showHint(STAR_COLORS[color].label);
  };

  function deactivateMode() {
    activeColor = null;
    var fab = document.getElementById('star-fab');
    fab.classList.remove('mode-active');
    fab.textContent = '⭐';
    fab.style.removeProperty('--star-active-color');
    map.getContainer().style.cursor = '';
    hideHint();
  }

  /* ============================================================
     إضافة معلم
  ============================================================ */
  function addStar(id, lat, lng, color) {
    id  = id  || ('star_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
    var cfg = STAR_COLORS[color] || STAR_COLORS.yellow;

    var icon = L.divIcon({
      className: '',
      html: '<div class="star-marker-icon" style="color:' + cfg.hex + ';">★</div>',
      iconSize:   [28, 28],
      iconAnchor: [14, 14],
      popupAnchor:[0, -16]
    });

    var marker = L.marker([lat, lng], { icon: icon });

    var popup =
      '<div class="star-popup">' +
        '<div class="star-popup-title">' + cfg.emoji + ' ' + cfg.label + '</div>' +
        '<div class="star-popup-coords">' +
          lat.toFixed(5) + '° N &nbsp;/&nbsp;' + lng.toFixed(5) + '° E' +
        '</div>' +
        '<button class="star-popup-delete" onclick="deleteStar(\'' + id + '\')">🗑️ حذف المعلم</button>' +
      '</div>';

    marker.bindPopup(popup, { className: 'star-popup-wrapper', maxWidth: 230 });
    marker.addTo(starLayer);
    starMarkers[id] = { marker: marker, lat: lat, lng: lng, color: color };

    saveToStorage();
    return id;
  }

  /* ---- حذف معلم ---- */
  window.deleteStar = function (id) {
    if (starMarkers[id]) {
      starLayer.removeLayer(starMarkers[id].marker);
      delete starMarkers[id];
      saveToStorage();
    }
  };

  /* ============================================================
     localStorage
  ============================================================ */
  function saveToStorage() {
    var data = Object.keys(starMarkers).map(function (id) {
      var s = starMarkers[id];
      return { id: id, lat: s.lat, lng: s.lng, color: s.color };
    });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      JSON.parse(raw).forEach(function (d) {
        addStar(d.id, d.lat, d.lng, d.color || 'yellow');
      });
    } catch (e) {}
  }

  /* ============================================================
     لافتة التلميح
  ============================================================ */
  function showHint(label) {
    var h = getHint();
    h.textContent = '📍 انقر على الخريطة لإضافة: ' + label;
    h.style.display = 'block';
  }
  function hideHint() {
    getHint().style.display = 'none';
  }
  function getHint() {
    var h = document.getElementById('star-hint');
    if (!h) {
      h = document.createElement('div');
      h.id = 'star-hint';
      h.className = 'star-hint';
      document.body.appendChild(h);
    }
    return h;
  }

  /* ---- بدء التهيئة ---- */
  initStars();

})();
