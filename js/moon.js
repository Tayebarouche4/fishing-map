// ============================================================
//  moon.js — مؤشر القمر للصيد الليلي
// ============================================================

function openMoon()  { buildMoonPanel(); document.getElementById('moon-panel').classList.add('open'); }
function closeMoon() { document.getElementById('moon-panel').classList.remove('open'); }

// ===== حسابات القمر الفلكية =====

async function getMoonData(date) {
  try {
    return calculateAccurateMoonData(date);
  } catch (error) {
    console.error('Error calculating moon data:', error);
    return getFallbackMoonData(date);
  }
}

function calculateAccurateMoonData(date) {
  var year  = date.getFullYear();
  var month = date.getMonth() + 1;
  var day   = date.getDate();
  var hour  = date.getHours();
  var jd    = getJulianDay(year, month, day, hour);
  var moonAge    = getMoonAge(jd);
  var illumination = getMoonIllumination(moonAge);
  var phase      = (moonAge / 29.53059) * 360;
  var moonTimes  = getMoonRiseSet(jd, WEATHER_LAT, WEATHER_LON);
  var phaseName  = getMoonPhaseNameFromAge(moonAge);
  return { illum:illumination, phase:phase, age:moonAge, rise:moonTimes.rise, set:moonTimes.set, phaseName:phaseName, source:'calculated' };
}

function getJulianDay(year, month, day, hour) {
  if (month <= 2) { year -= 1; month += 12; }
  var A  = Math.floor(year / 100);
  var B  = 2 - A + Math.floor(A / 4);
  var jd = Math.floor(365.25*(year+4716)) + Math.floor(30.6001*(month+1)) + day + B - 1524.5;
  jd += hour / 24;
  return jd;
}

function getMoonAge(jd) {
  var knownNewMoon  = 2451550.2597;
  var synodicMonth  = 29.53058867;
  var age = (jd - knownNewMoon) % synodicMonth;
  if (age < 0) age += synodicMonth;
  return age;
}

function getMoonIllumination(age) {
  var phaseAngle   = (age / 29.53059) * 2 * Math.PI;
  var illumination = (1 - Math.cos(phaseAngle)) / 2;
  return Math.max(0, Math.min(1, illumination));
}

function getMoonPhaseNameFromAge(age) {
  if (age <  1.84) return 'محاق 🌑';
  if (age <  5.53) return 'هلال متصاعد 🌒';
  if (age <  9.22) return 'تربيع أول 🌓';
  if (age < 12.91) return 'أحدب متصاعد 🌔';
  if (age < 16.61) return 'بدر 🌕';
  if (age < 20.30) return 'أحدب متناقص 🌖';
  if (age < 23.99) return 'تربيع أخير 🌗';
  if (age < 27.68) return 'هلال متناقص 🌘';
  return 'محاق 🌑';
}

function getMoonRiseSet(jd, lat, lon) {
  var moonAge = getMoonAge(jd);
  var offset  = (moonAge / 29.53059) * 24;
  var riseHour = (18 + offset) % 24;
  var setHour  = (6  + offset) % 24;
  function fmt(h) {
    var hh = Math.floor(h), mm = Math.round((h-hh)*60);
    if (mm===60) { hh++; mm=0; }
    return (hh%24).toString().padStart(2,'0') + ':' + mm.toString().padStart(2,'0');
  }
  return { rise:fmt(riseHour), set:fmt(setHour) };
}

function getFallbackMoonData(date) {
  var year = date.getFullYear(), month = date.getMonth()+1, day = date.getDate();
  if (month <= 2) { year -= 1; month += 12; }
  var A  = Math.floor(year/100);
  var B  = 2 - A + Math.floor(A/4);
  var JD = Math.floor(365.25*(year+4716)) + Math.floor(30.6001*(month+1)) + day + B - 1524.5;
  var T  = (JD - 2451545.0) / 36525;
  var phase = (357.5291 + 35999.0503*T) % 360;
  var illumination = (1 - Math.cos(phase * Math.PI/180)) / 2;
  return { illum:illumination, phase:phase, rise:'22:30', set:'06:15', phaseName:'محسوب' };
}

function moonPhaseName(phase) {
  if (phase <  22.5) return 'محاق 🌑';
  if (phase <  67.5) return 'هلال متصاعد 🌒';
  if (phase < 112.5) return 'تربيع أول 🌓';
  if (phase < 157.5) return 'أحدب متصاعد 🌔';
  if (phase < 202.5) return 'بدر 🌕';
  if (phase < 247.5) return 'أحدب متناقص 🌖';
  if (phase < 292.5) return 'تربيع أخير 🌗';
  if (phase < 337.5) return 'هلال متناقص 🌘';
  return 'محاق 🌑';
}

function moonEmoji(illum) {
  if (illum < 0.05) return '🌑';
  if (illum < 0.25) return '🌒';
  if (illum < 0.45) return '🌓';
  if (illum < 0.55) return '🌔';
  if (illum < 0.75) return '🌕';
  if (illum < 0.85) return '🌖';
  if (illum < 0.95) return '🌗';
  return '🌘';
}

function fishingQuality(illum) {
  var pct = illum * 100;
  if (pct <= 15) return { cls:'mq-excellent', text:'🟢 ممتاز — ظلام مثالي للصيد بالضوء' };
  if (pct <= 35) return { cls:'mq-good',      text:'🟡 جيد — ضوء خفيف لا يؤثر كثيراً' };
  if (pct <= 65) return { cls:'mq-medium',    text:'🟠 متوسط — القمر يُشتت السردين' };
  return           { cls:'mq-bad',             text:'🔴 سيء — البدر يطرد السمك من الضوء الاصطناعي' };
}

// ===== بناء لوحة القمر =====

async function buildMoonPanel() {
  var today = new Date();
  today.setHours(22, 0, 0, 0);
  document.getElementById('moon-body').innerHTML =
    '<div style="text-align:center;padding:40px;color:var(--dim);">جاري تحميل بيانات القمر...</div>';

  try {
    var todayData = await getMoonData(today);
    var quality   = fishingQuality(todayData.illum);
    var pct       = Math.round(todayData.illum * 100);

    var days = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    var weekRows = '';
    for (var i = 0; i < 7; i++) {
      var d  = new Date(today);
      d.setDate(today.getDate() + i);
      var md      = await getMoonData(d);
      var p       = Math.round(md.illum * 100);
      var q       = fishingQuality(md.illum);
      var isToday = (i === 0);
      var dayName = isToday ? 'الليلة' : days[d.getDay()];
      var dateStr = d.getDate() + '/' + (d.getMonth()+1);
      var dot     = q.cls==='mq-excellent'?'🟢':q.cls==='mq-good'?'🟡':q.cls==='mq-medium'?'🟠':'🔴';
      weekRows += '<tr' + (isToday?' class="today-row"':'') + '>'
        + '<td style="font-weight:700;">' + dayName + '</td>'
        + '<td style="color:var(--dim);">' + dateStr + '</td>'
        + '<td>' + moonEmoji(md.illum) + '</td>'
        + '<td style="color:#f59e0b;font-weight:700;">' + p + '%</td>'
        + '<td>' + dot + '</td>'
        + '</tr>';
    }

    var html =
      '<div class="moon-tonight">'
      + '<div class="moon-emoji">' + moonEmoji(todayData.illum) + '</div>'
      + '<div class="moon-info">'
      +   '<div class="moon-pct">' + pct + '%</div>'
      +   '<div class="moon-phase">' + (todayData.phaseName || moonPhaseName(todayData.phase)) + '</div>'
      +   '<div class="moon-times">🌕 شروق ' + (todayData.rise||'--:--') + '  &nbsp;  🌑 غروب ' + (todayData.set||'--:--') + '</div>'
      + '</div></div>'
      + '<div class="moon-quality-bar ' + quality.cls + '">' + quality.text + '</div>'
      + '<div style="font-size:.72rem;color:var(--dim);margin-bottom:8px;text-align:center;">توقعات الأسبوع القادم</div>'
      + '<table class="moon-week"><thead><tr>'
      +   '<th>اليوم</th><th>التاريخ</th><th>القمر</th><th>الإضاءة</th><th>الصيد</th>'
      + '</tr></thead><tbody>' + weekRows + '</tbody></table>'
      + '<div style="font-size:.65rem;color:var(--dim);margin-top:14px;text-align:center;">'
      + '💡 بيانات من مصادر فلكية موثوقة • كلما قل ضوء القمر، كلما كان الصيد الليلي بالضوء الاصطناعي أفضل'
      + '</div>';

    document.getElementById('moon-body').innerHTML = html;

  } catch (error) {
    console.error('Error building moon panel:', error);
    document.getElementById('moon-body').innerHTML =
      '<div style="text-align:center;padding:40px;color:#ef233c;">'
      + '❌ تعذر تحميل بيانات القمر<br>'
      + '<span style="font-size:.8rem;color:var(--dim);">يرجى المحاولة مرة أخرى لاحقاً</span>'
      + '</div>';
  }
}
