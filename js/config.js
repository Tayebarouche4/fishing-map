// ============================================================
//  config.js — الإعدادات العامة للتطبيق
// ============================================================

// إعدادات API السيرفر
var API_BASE_URL = "https://fishing-map-api-production.up.railway.app";
var API_KEY      = "change-this-secret";
var SHEET_URL    = API_BASE_URL; // للتوافق مع الكود القديم

// إعدادات الطقس والموقع
var WEATHER_LAT = 36.25;
var WEATHER_LON = 0.30;

// مسارات البيانات
var TILES_BASE     = 'tiles/';
var ROUTES_GEOJSON = 'rout.geojson';

// مسارات بديلة (تجرب أماكن مختلفة)
var DATA_PATHS = [
  { tiles: 'tiles/',    routes: 'rout.geojson'    },
  { tiles: '../tiles/', routes: '../rout.geojson'  },
];

// الحدود الجغرافية الافتراضية
var DEFAULT_BOUNDS = {
  sst: [[35.7041,-0.4291],[36.6958,0.9958]],
  ssh: [[35.7041,-0.4291],[36.6958,0.9958]],
  uo:  [[35.75,-0.4166],[36.6666,1.0]],
  vo:  [[35.75,-0.4166],[36.6666,1.0]],
};

// إعدادات تقييم الرحلة
var WAVE_LIMIT  = 1.1;  // م — حد الأمواج المسموح به
var WIND_LIMIT  = 30;   // كم/س — حد الريح المسموح به
var TRIP_HOURS  = 10;   // ساعات الرحلة المطلوبة
var DEPART_HOUR = 17;   // ساعة الخروج

// متغيرات الحالة العامة
var DATE           = "loading...";
var LAYERS         = {};
var UNIFIED_BOUNDS = null;
var currentUser    = null;
var userPermissions= null;
