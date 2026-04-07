// ============================================================
//  weather.js — الطقس البحري وتقييم رحلة الصيد
// ============================================================

var weatherLoaded = false;
var weatherTab    = 'forecast';

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
  document.getElementById('weather-about-view').style.display    = tab==='about'    ? 'block' : 'none';
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
      + '<button onclick="weatherLoaded=false;fetchWeather()" style="padding:8px 18px;background:var(--gold);'
      + 'border:none;border-radius:8px;color:#000;font-family:Tajawal;cursor:pointer;font-weight:700;">'
      + 'إعادة المحاولة</button></div>';
  });
}

// ===== مساعدات التنسيق =====
function waveClass(v){ return v<0.5?'wv-low':v<1.5?'wv-mid':'wv-high'; }
function windClass(v){ return v<20?'ws-low':v<40?'ws-mid':'ws-high'; }
function windDirLabel(deg){
  var d=['ش','شش-ش','ش-ش','شغ-ش','شغ','شغ-غ','غ-ش','شغ-غ','غ','جغ-غ','غ-ج','جغ-غ','جغ','جغ-ج','ج-غ','جش-ج'];
  return d[Math.round(deg/22.5)%16];
}
function fmtHour(s){ return s.split('T')[1] ? s.split('T')[1].substring(0,5) : s; }
function fmtDay(s){
  var dt = new Date(s);
  var days   = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  var months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return days[dt.getDay()] + ' ' + dt.getDate() + ' ' + months[dt.getMonth()];
}

// ===== تقييم صلاحية الرحلة =====
function assessDay(dayKey, allIndices, times, waveH, windSpd) {
  var nextDay = new Date(dayKey + 'T12:00');
  nextDay.setDate(nextDay.getDate() + 1);
  var nextDayKey  = nextDay.toISOString().substring(0,10);
  var RETURN_HOUR = 10;

  var nightIdx = [];
  for (var k = 0; k < allIndices.length; k++) {
    var i = allIndices[k];
    var dt      = times[i];
    var dayPart = dt.split('T')[0];
    var h       = parseInt(dt.split('T')[1].substring(0,2), 10);
    if (dayPart === dayKey    && h >= DEPART_HOUR)  nightIdx.push(i);
    if (dayPart === nextDayKey && h <= RETURN_HOUR) nightIdx.push(i);
  }
  nightIdx.sort(function(a,b){ return times[a] < times[b] ? -1 : 1; });

  if (nightIdx.length === 0)
    return {cls:'red', icon:'❌', badge:'لا توجد بيانات', desc:'لا تتوفر بيانات لهذه الفترة.', window:''};

  var maxConsec=0, curConsec=0, bestStart='', consecStart='';
  var worstWaveInWindow=0, worstWindInWindow=0, curWave=0, curWind=0;

  for (var k = 0; k < nightIdx.length; k++) {
    var i = nightIdx[k];
    var wav = waveH[i]||0, spd = windSpd[i]||0;
    if (wav <= WAVE_LIMIT && spd <= WIND_LIMIT) {
      curConsec++;
      if (curConsec === 1) { consecStart = times[i].replace('T',' ').substring(0,16); curWave=0; curWind=0; }
      if (wav > curWave) curWave = wav;
      if (spd > curWind) curWind = spd;
      if (curConsec > maxConsec) {
        maxConsec = curConsec; bestStart = consecStart;
        worstWaveInWindow = curWave; worstWindInWindow = curWind;
      }
    } else { curConsec=0; consecStart=''; curWave=0; curWind=0; }
  }

  var worstWaveAll=0, worstWindAll=0;
  for (var k = 0; k < nightIdx.length; k++) {
    var i = nightIdx[k];
    if ((waveH[i]||0)  > worstWaveAll) worstWaveAll = waveH[i]||0;
    if ((windSpd[i]||0) > worstWindAll) worstWindAll = windSpd[i]||0;
  }

  var waveTxt    = worstWaveInWindow.toFixed(2) + ' م';
  var windTxt    = Math.round(worstWindInWindow) + ' كم/س';
  var waveTxtAll = worstWaveAll.toFixed(2) + ' م';
  var windTxtAll = Math.round(worstWindAll) + ' كم/س';

  function addHours(dtStr, h) {
    var d = new Date(dtStr.replace(' ','T') + ':00');
    var orig = new Date(dtStr.replace(' ','T') + ':00');
    d.setHours(d.getHours() + h);
    return (d.getHours()<10?'0':'') + d.getHours() + ':00'
      + ' (' + (d.getDate() === orig.getDate() ? 'نفس اليوم' : 'اليوم التالي') + ')';
  }

  if (maxConsec >= TRIP_HOURS) {
    return { cls:'green', icon:'✅', badge:'فرصة ذهبية',
      desc:'ظروف مناسبة للخروج — الرياح ' + windTxt + ' والأمواج ' + waveTxt,
      window:'الخروج: ' + bestStart.split(' ')[1] + ' ← العودة: ' + addHours(bestStart, maxConsec) + ' (' + maxConsec + ' ساعة هادئة)' };
  } else if (maxConsec >= 6) {
    return { cls:'orange', icon:'⚠️', badge:'مخاطرة — نافذة ضيقة',
      desc:'فترة هادئة ' + maxConsec + ' ساعة فقط (الرحلة تحتاج 10). الرياح قد تبلغ ' + windTxt + ' والأمواج ' + waveTxt,
      window:'أفضل نافذة: ' + bestStart.split(' ')[1] + ' ← ' + addHours(bestStart, maxConsec) };
  } else {
    return { cls:'red', icon:'❌', badge:'لا توجد فرصة',
      desc:'الظروف لا تسمح — الرياح قد تصل ' + windTxtAll + ' والأمواج ' + waveTxtAll + '. لم تتوفر 6 ساعات متواصلة هادئة.',
      window: maxConsec > 0 ? 'أفضل ما وُجد: ' + maxConsec + ' ساعة فقط' : 'لا توجد ساعة هادئة واحدة' };
  }
}

// ===== عرض الطقس =====
function renderWeather(marine, atm) {
  var times   = marine.hourly.time;
  var waveH   = marine.hourly.wave_height;
  var windWH  = marine.hourly.wind_wave_height;
  var windSpd = atm.hourly.wind_speed_10m;
  var windDeg = atm.hourly.wind_direction_10m;

  var days = {};
  for (var i = 0; i < times.length; i++) {
    var dk = times[i].split('T')[0];
    if (!days[dk]) days[dk] = [];
    days[dk].push(i);
  }
  var dayKeys    = Object.keys(days);
  var allIndices = [];
  for (var d = 0; d < dayKeys.length; d++) {
    for (var ii = 0; ii < days[dayKeys[d]].length; ii++) allIndices.push(days[dayKeys[d]][ii]);
  }
  allIndices.sort(function(a,b){ return times[a]<times[b]?-1:1; });

  var mainDays = dayKeys.slice(0,3);
  var extDays  = dayKeys.slice(3);
  var html     = '';

  // تقييم رحلة الصيد - 3 أيام أساسية
  html += '<div class="section-title">🎣 جدوى الصيد بالضوء</div><div class="trip-cards">';
  for (var d = 0; d < mainDays.length; d++) {
    var res = assessDay(mainDays[d], allIndices, times, waveH, windSpd);
    html += '<div class="trip-card ' + res.cls + '">'
      + '<div class="trip-card-top">'
      + '<span class="trip-card-icon">' + res.icon + '</span>'
      + '<span class="trip-card-day">' + fmtDay(mainDays[d]+'T12:00') + '</span>'
      + '<span class="trip-card-badge">' + res.badge + '</span>'
      + '</div>'
      + '<div class="trip-card-desc">' + res.desc + '</div>'
      + (res.window ? '<div class="trip-window">⏱ ' + res.window + '</div>' : '')
      + '</div>';
  }
  html += '</div>';

  // الأيام الموسعة (4-7)
  if (extDays.length > 0) {
    html += '<div class="extended-toggle" id="ext-toggle" onclick="toggleExtended()">'
      + '<span style="font-size:1.1rem;">📅</span>'
      + '<span class="extended-toggle-label">التوقعات الموسعة — اليوم '
      + (mainDays.length+1) + ' إلى ' + (mainDays.length+extDays.length) + '</span>'
      + '<span class="extended-toggle-sub">اضغط لعرض التقييم</span>'
      + '<span class="extended-toggle-arrow">▼</span>'
      + '</div>';
    html += '<div class="extended-body" id="ext-body"><div class="trip-cards" style="margin-top:10px;">';
    for (var d = 0; d < extDays.length; d++) {
      var res = assessDay(extDays[d], allIndices, times, waveH, windSpd);
      html += '<div class="trip-card ' + res.cls + '">'
        + '<div class="trip-card-top">'
        + '<span class="trip-card-icon">' + res.icon + '</span>'
        + '<span class="trip-card-day">' + fmtDay(extDays[d]+'T12:00') + '</span>'
        + '<span class="trip-card-badge">' + res.badge + '</span>'
        + '</div>'
        + '<div class="trip-card-desc">' + res.desc + '</div>'
        + (res.window ? '<div class="trip-window">⏱ ' + res.window + '</div>' : '')
        + '</div>';
    }
    html += '</div></div>';
  }

  // الجدول التفصيلي (3 أيام)
  html += '<div class="section-title">📊 التفاصيل الساعية</div>';
  for (var d = 0; d < mainDays.length; d++) {
    var dk   = mainDays[d];
    var idxs = days[dk] || [];
    html += '<div class="weather-day-block"><div class="weather-day-title">📅 ' + fmtDay(dk+'T12:00') + '</div>'
      + '<table class="weather-table"><thead><tr>'
      + '<th>الساعة</th><th>ارتفاع الأمواج</th><th>موج الريح</th><th>سرعة الريح</th><th>اتجاه الريح</th>'
      + '</tr></thead><tbody>';
    for (var j = 0; j < idxs.length; j++) {
      var idx = idxs[j];
      var wh  = waveH[idx]  != null ? waveH[idx].toFixed(2)+' م' : '—';
      var wwh = windWH[idx] != null ? windWH[idx].toFixed(2)+' م' : '—';
      var ws  = windSpd[idx]!= null ? windSpd[idx].toFixed(1)+' كم/س' : '—';
      var wd  = windDeg[idx]!= null ? windDirLabel(windDeg[idx]) : '—';
      var spd = windSpd[idx]||0, wav = waveH[idx]||0, wwv = windWH[idx]||0;

      var wsDisplay = spd>=40
        ? '<span style="display:inline-block;background:#ef233c;color:#fff;font-weight:700;padding:2px 8px;border-radius:20px;font-size:.72rem;">'+ws+'</span>'
        : spd>=20
        ? '<span style="display:inline-block;background:#fb923c;color:#fff;font-weight:700;padding:2px 8px;border-radius:20px;font-size:.72rem;">'+ws+'</span>'
        : ws;
      var wavColor = wav>2?'#7c3aed':wav>1.2?'#ef233c':wav>=0.9?'#f59e0b':'';
      var whDisplay = wavColor
        ? '<span style="display:inline-block;background:'+wavColor+';color:#fff;font-weight:700;padding:2px 8px;border-radius:20px;font-size:.72rem;">'+wh+'</span>'
        : wh;
      var wwvColor = wwv>2?'#7c3aed':wwv>1.2?'#ef233c':wwv>=0.9?'#f59e0b':'';
      var wwhDisplay = wwvColor
        ? '<span style="display:inline-block;background:'+wwvColor+';color:#fff;font-weight:700;padding:2px 8px;border-radius:20px;font-size:.72rem;">'+wwh+'</span>'
        : wwh;

      html += '<tr><td>' + fmtHour(times[idx]) + '</td><td>' + whDisplay + '</td>'
        + '<td>' + wwhDisplay + '</td><td>' + wsDisplay + '</td><td>' + wd + '</td></tr>';
    }
    html += '</tbody></table></div>';
  }

  html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;font-size:.62rem;color:var(--dim);padding:4px 2px;">'
    + '<span>الرياح: </span>'
    + '<span style="background:#fb923c;color:#fff;padding:1px 7px;border-radius:12px;font-size:.6rem;">20–40 كم/س</span> '
    + '<span style="background:#ef233c;color:#fff;padding:1px 7px;border-radius:12px;font-size:.6rem;">+40 كم/س</span>'
    + '<br><span>الأمواج: </span>'
    + '<span style="background:#f59e0b;color:#fff;padding:1px 7px;border-radius:12px;font-size:.6rem;">0.9–1.2 م</span> '
    + '<span style="background:#ef233c;color:#fff;padding:1px 7px;border-radius:12px;font-size:.6rem;">1.2–2 م</span> '
    + '<span style="background:#7c3aed;color:#fff;padding:1px 7px;border-radius:12px;font-size:.6rem;">+2 م</span>'
    + '<span style="margin-right:auto;font-size:.58rem;">المصدر: Open-Meteo Marine API</span>'
    + '</div>';

  document.getElementById('weather-body').innerHTML = html;
}

function toggleExtended() {
  var toggle = document.getElementById('ext-toggle');
  var body   = document.getElementById('ext-body');
  if (!toggle || !body) return;
  var isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  toggle.classList.toggle('open', !isOpen);
  toggle.querySelector('.extended-toggle-sub').textContent =
    isOpen ? 'اضغط لعرض التقييم' : 'اضغط للإخفاء';
}
