// ============================================================
//  measurement.js — أدوات قياس المسافة والمساحة
// ============================================================

var measurementMode   = null; // 'distance' | 'area' | null
var measurementPoints = [];
var measurementLayer  = null;
var distanceMarkers   = [];
var areaPolygon       = null;

function toggleMeasurementToolbar() {
  var toolbar = document.getElementById('measurement-toolbar');
  var fab     = document.getElementById('measurement-fab');
  var hidden  = toolbar.style.display === 'none' || toolbar.style.display === '';
  toolbar.style.display = hidden ? 'flex' : 'none';
  fab.classList.toggle('active', hidden);
  if (!hidden && measurementMode) stopMeasurement();
}

function toggleDistanceMeasurement() {
  var btn     = document.getElementById('measure-distance-btn');
  var areaBtn = document.getElementById('measure-area-btn');
  if (measurementMode === 'distance') {
    stopMeasurement();
  } else {
    stopMeasurement();
    measurementMode = 'distance';
    btn.classList.add('active');
    areaBtn.classList.remove('active');
    map.getContainer().style.cursor = 'crosshair';
    map.on('click', handleDistanceClick);
  }
}

function toggleAreaMeasurement() {
  var btn         = document.getElementById('measure-area-btn');
  var distanceBtn = document.getElementById('measure-distance-btn');
  if (measurementMode === 'area') {
    stopMeasurement();
  } else {
    stopMeasurement();
    measurementMode = 'area';
    btn.classList.add('active');
    distanceBtn.classList.remove('active');
    map.getContainer().style.cursor = 'crosshair';
    map.on('click', handleAreaClick);
  }
}

function handleDistanceClick(e) {
  if (measurementMode !== 'distance') return;
  var latlng = e.latlng;
  measurementPoints.push(latlng);

  var marker = L.marker(latlng, {
    icon: L.divIcon({
      className:'',
      html:'<div style="background:#f59e0b;color:white;border-radius:50%;width:12px;height:12px;'
        + 'display:flex;align-items:center;justify-content:center;font-size:8px;border:2px solid white;">'
        + measurementPoints.length + '</div>',
      iconSize:[12,12], iconAnchor:[6,6]
    })
  }).addTo(map);
  distanceMarkers.push(marker);

  if (measurementPoints.length >= 2) {
    var latlngs = measurementPoints.slice(-2);
    if (!measurementLayer) measurementLayer = L.layerGroup().addTo(map);

    var line = L.polyline(latlngs, {
      color:'#f59e0b', weight:3, opacity:0.8, dashArray:'10, 5'
    });
    measurementLayer.addLayer(line);

    var distance = calculateDistance(latlngs[0], latlngs[1]);
    var midpoint = L.latLng(
      (latlngs[0].lat + latlngs[1].lat) / 2,
      (latlngs[0].lng + latlngs[1].lng) / 2
    );
    var distLabel = L.marker(midpoint, {
      icon: L.divIcon({
        className:'',
        html:'<div style="background:rgba(245,158,11,0.9);color:white;padding:4px 8px;'
          + 'border-radius:4px;font-size:.75rem;font-weight:700;white-space:nowrap;border:1px solid white;">'
          + distance + '</div>',
        iconSize:[80,20], iconAnchor:[40,10]
      })
    });
    measurementLayer.addLayer(distLabel);
    measurementPoints = [latlngs[1]];
  }
}

function handleAreaClick(e) {
  if (measurementMode !== 'area') return;
  var latlng = e.latlng;
  measurementPoints.push(latlng);

  var marker = L.marker(latlng, {
    icon: L.divIcon({
      className:'',
      html:'<div style="background:#8b5cf6;color:white;border-radius:50%;width:12px;height:12px;'
        + 'display:flex;align-items:center;justify-content:center;font-size:8px;border:2px solid white;">'
        + measurementPoints.length + '</div>',
      iconSize:[12,12], iconAnchor:[6,6]
    })
  }).addTo(map);
  distanceMarkers.push(marker);

  if (measurementPoints.length >= 3) {
    if (!measurementLayer) measurementLayer = L.layerGroup().addTo(map);
    if (areaPolygon) measurementLayer.removeLayer(areaPolygon);

    areaPolygon = L.polygon(measurementPoints, {
      color:'#8b5cf6', weight:2, opacity:0.8,
      fillColor:'#8b5cf6', fillOpacity:0.2
    });
    measurementLayer.addLayer(areaPolygon);

    var area    = calculateArea(measurementPoints);
    var center  = getPolygonCenter(measurementPoints);
    var areaLbl = L.marker(center, {
      icon: L.divIcon({
        className:'',
        html:'<div style="background:rgba(139,92,246,0.9);color:white;padding:6px 10px;'
          + 'border-radius:4px;font-size:.75rem;font-weight:700;white-space:nowrap;border:1px solid white;">'
          + area + '</div>',
        iconSize:[100,20], iconAnchor:[50,10]
      })
    });
    measurementLayer.addLayer(areaLbl);
  }
}

function stopMeasurement() {
  measurementMode = null;
  measurementPoints = [];
  map.off('click', handleDistanceClick);
  map.off('click', handleAreaClick);
  map.getContainer().style.cursor = '';
  document.getElementById('measure-distance-btn').classList.remove('active');
  document.getElementById('measure-area-btn').classList.remove('active');
}

function clearMeasurements() {
  if (measurementLayer) { map.removeLayer(measurementLayer); measurementLayer = null; }
  distanceMarkers.forEach(function(m) { map.removeLayer(m); });
  distanceMarkers = [];
  measurementPoints = [];
  areaPolygon = null;
  stopMeasurement();
}

function calculateDistance(latlng1, latlng2) {
  var d = latlng1.distanceTo(latlng2);
  return d < 1000 ? Math.round(d) + ' م' : (d/1000).toFixed(2) + ' كم';
}

function calculateArea(points) {
  var area = 0;
  for (var i = 0; i < points.length; i++) {
    var j = (i + 1) % points.length;
    area += points[i].lat * points[j].lng;
    area -= points[j].lat * points[i].lng;
  }
  area = Math.abs(area) / 2 * 111.32 * 111.32;
  return area < 1 ? Math.round(area * 1000000) + ' م²' : area.toFixed(2) + ' كم²';
}

function getPolygonCenter(points) {
  var lat = 0, lng = 0;
  for (var i = 0; i < points.length; i++) { lat += points[i].lat; lng += points[i].lng; }
  return L.latLng(lat / points.length, lng / points.length);
}
