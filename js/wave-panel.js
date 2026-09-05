(function(){
  var WAVE_DATA_URL   = 'data/vmxl_forecast.json';
  var WAVE_CACHE_KEY  = 'wx_wave_cache_v1';
  var NIGHT_START = 19, NIGHT_END = 6;

  var waveChartInstance = null;

  window.toggleWavePanel = function(force){
    var panel = document.getElementById('wave-panel');
    var open = typeof force === 'boolean' ? force : !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    if(open) bootWave();
  };

  function waveCacheRead(){
    try{ var raw = localStorage.getItem(WAVE_CACHE_KEY); return raw ? JSON.parse(raw) : null; }
    catch(e){ return null; }
  }
  function waveCacheWrite(data){
    try{ localStorage.setItem(WAVE_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data })); }catch(e){}
  }

  function bootWave(){
    // اعرض النسخة المحفوظة فوراً (بدون فراغ/تحميل) إن وُجدت، لكن اجلب الأحدث دائماً في الخلفية
    var cache = waveCacheRead();
    if(cache){ renderWave(cache.data); }
    fetchWave(!cache);
  }
  function fetchWave(showLoading){
    var body = document.getElementById('wave-panel-body');
    if(showLoading){
      body.innerHTML = '<div class="wave-modal-state"><div class="wave-modal-spinner"></div><div>جاري تحميل المنحنى...</div></div>';
    }
    fetch(WAVE_DATA_URL + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(payload){
        waveCacheWrite(payload);
        renderWave(payload);
      })
      .catch(function(err){
        var cache = waveCacheRead();
        if(cache){ renderWave(cache.data); }
        else {
          body.innerHTML =
            '<div class="wave-modal-state">'
            + '<div style="font-size:1.6rem;">⚠️</div>'
            + '<div>تعذر تحميل بيانات الأمواج<br><small>' + err.message + '</small></div>'
            + '<button class="wave-modal-refresh" onclick="window.__reloadWave()">إعادة المحاولة</button>'
            + '</div>';
        }
      });
  }
  window.__reloadWave = function(){ fetchWave(true); };

  function fmtHour(iso){ var t = iso.split('T')[1]; return t ? t.substring(0,5) : iso; }
  function fmtDayLabel(iso){
    var dt = new Date(iso);
    var days = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    var months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    return days[dt.getDay()] + ' ' + dt.getDate() + ' ' + months[dt.getMonth()];
  }
  function isNightHour(h){ return (h >= NIGHT_START) || (h < NIGHT_END); }

  function renderWave(payload){
    var times  = payload.hourly.time;
    var values = payload.hourly.vmxl_m;
    var calmMax     = (payload.thresholds_m && payload.thresholds_m.calm_max) || 0.8;
    var moderateMax = (payload.thresholds_m && payload.thresholds_m.moderate_max) || 1.5;

    var days = {};
    for(var i=0;i<times.length;i++){
      var dk = times[i].split('T')[0];
      if(!days[dk]) days[dk] = [];
      days[dk].push(values[i]);
    }
    var dayKeys = Object.keys(days).slice(0,5);
    var stripHtml = '<div class="wave-day-strip">';
    dayKeys.forEach(function(dk){
      var vals = days[dk].filter(function(v){ return v!=null; });
      var max = vals.length ? Math.max.apply(null, vals) : null;
      var cls = max==null ? '' : (max < calmMax ? 'low' : max < moderateMax ? 'mid' : 'high');
      stripHtml += '<div class="wave-day-pill">'
        + '<div class="wave-day-pill-label">' + fmtDayLabel(dk+'T12:00') + '</div>'
        + '<div class="wave-day-pill-val ' + cls + '">' + (max!=null? max.toFixed(1)+' م':'—') + '</div>'
        + '</div>';
    });
    stripHtml += '</div>';

    var body = document.getElementById('wave-panel-body');
    body.innerHTML = stripHtml
      + '<div class="wave-chart-box"><canvas id="wave-canvas"></canvas></div>'
      + '<div class="wave-legend-row">'
      + '<div class="wave-legend-item"><span class="wave-legend-swatch" style="background:rgba(99,102,241,.35);"></span>ليل (19:00–06:00)</div>'
      + '<div class="wave-legend-item"><span style="display:inline-block;width:12px;border-top:2px dashed #f77f00;"></span>حذر ' + calmMax + ' م</div>'
      + '<div class="wave-legend-item"><span style="display:inline-block;width:12px;border-top:2px dashed #d62828;"></span>خطر ' + moderateMax + ' م</div>'
      + '</div>'
      + '<div class="wave-status-line" style="margin-top:6px;">آخر تحديث: ' + (payload.generated_at || '—') + '</div>';

    drawWaveChart(times, values, calmMax, moderateMax);
  }

  function drawWaveChart(times, values, calmMax, moderateMax){
    if(typeof Chart === 'undefined'){
      document.getElementById('wave-panel-body').insertAdjacentHTML('beforeend',
        '<div class="wave-modal-state"><div style="font-size:1.6rem;">⚠️</div>'
        + '<div>تعذر تحميل مكتبة الرسم البياني (Chart.js)<br><small>تحقق من الاتصال بالإنترنت أو أعد فتح الصفحة</small></div></div>');
      return;
    }
    var ctx = document.getElementById('wave-canvas').getContext('2d');
    var labels = times.map(fmtHour);
    var nightMeta = times.map(function(t){ return isNightHour(parseInt(t.split('T')[1].substring(0,2),10)); });

    var dayShortNames = ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
    var dayStartIdx = [];
    for(var i=0;i<times.length;i++){
      var h = parseInt(times[i].split('T')[1].substring(0,2),10);
      if(h===0 || i===0) dayStartIdx.push(i);
    }
    // بناء نطاقات كل يوم (من بداية يوم لبداية اليوم التالي) لعرض اسم اليوم فوق كل نطاق
    var daySegments = dayStartIdx.map(function(startIdx, k){
      var endIdx = (k+1 < dayStartIdx.length) ? dayStartIdx[k+1]-1 : times.length-1;
      var dt = new Date(times[startIdx]);
      return { start:startIdx, end:endIdx, label: dayShortNames[dt.getDay()] + ' ' + dt.getDate() + '/' + (dt.getMonth()+1) };
    });

    var nightBandsPlugin = {
      id:'waveNightBands',
      beforeDatasetsDraw: function(chart){
        var xScale = chart.scales.x, yScale = chart.scales.y, c = chart.ctx;
        var half = (xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) / 2;
        c.save();
        var start = null;
        for(var i=0;i<=nightMeta.length;i++){
          var night = i<nightMeta.length ? nightMeta[i] : null;
          if(night && start===null){ start = i; }
          else if(!night && start!==null){
            var x1 = xScale.getPixelForValue(start)-half, x2 = xScale.getPixelForValue(i-1)+half;
            c.fillStyle = 'rgba(99,102,241,.16)';
            c.fillRect(x1, yScale.top, x2-x1, yScale.bottom-yScale.top);
            start = null;
          }
        }
        c.restore();
      }
    };
    var thresholdPlugin = {
      id:'waveThresholds',
      afterDatasetsDraw: function(chart){
        var xScale = chart.scales.x, yScale = chart.scales.y, c = chart.ctx;
        function line(val,color){
          var y = yScale.getPixelForValue(val);
          if(y<yScale.top || y>yScale.bottom) return;
          c.save(); c.setLineDash([5,4]); c.strokeStyle=color; c.lineWidth=1.3;
          c.beginPath(); c.moveTo(xScale.left,y); c.lineTo(xScale.right,y); c.stroke(); c.restore();
        }
        line(calmMax,'#f77f00'); line(moderateMax,'#d62828');
      }
    };
    var dayBoundaryPlugin = {
      id:'waveDayBoundary',
      afterDraw: function(chart){
        var xScale = chart.scales.x, yScale = chart.scales.y, c = chart.ctx;
        c.save();
        // خطوط فاصلة عمودية عند بداية كل يوم
        dayStartIdx.forEach(function(idx){
          if(idx===0) return;
          var x = xScale.getPixelForValue(idx);
          c.strokeStyle = 'rgba(255,255,255,.22)';
          c.setLineDash([3,3]);
          c.lineWidth = 1;
          c.beginPath(); c.moveTo(x, yScale.top); c.lineTo(x, yScale.bottom); c.stroke();
        });
        // اسم اليوم + تاريخه في منتصف كل نطاق، أعلى المنحنى
        c.setLineDash([]);
        c.font = "bold 10px Tajawal";
        c.fillStyle = "#e9edf6";
        c.textAlign = "center";
        daySegments.forEach(function(seg){
          var xStart = xScale.getPixelForValue(seg.start);
          var xEnd = xScale.getPixelForValue(seg.end);
          var xMid = (xStart + xEnd) / 2;
          c.fillText(seg.label, xMid, yScale.top + 12);
        });
        c.restore();
      }
    };

    if(waveChartInstance) waveChartInstance.destroy();
    waveChartInstance = new Chart(ctx, {
      type:'line',
      data:{ labels:labels, datasets:[{
        label:'قمة الموجة VMXL (م)', data:values,
        borderColor:'#22d3ee', backgroundColor:'rgba(34,211,238,.14)',
        borderWidth:2.2, pointRadius:0, pointHoverRadius:4, tension:.35, fill:true
      }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        layout:{ padding:{ top:16 } },
        interaction:{ mode:'index', intersect:false },
        plugins:{
          legend:{ display:false },
          tooltip:{ rtl:true, titleFont:{family:'Tajawal'}, bodyFont:{family:'Tajawal'},
            callbacks:{ label:function(c){ return 'الأمواج: ' + c.parsed.y.toFixed(2) + ' م'; } } }
        },
        scales:{
          x:{ ticks:{ color:'#8a93ac', font:{family:'Tajawal',size:8},
                callback:function(v,i){ return i % 12 === 0 ? labels[i] : ''; }, maxRotation:0, autoSkip:false },
              grid:{ color:'rgba(255,255,255,.05)' } },
          y:{ beginAtZero:true, ticks:{ color:'#8a93ac', font:{family:'Tajawal',size:9},
                callback:function(v){ return v+' م'; } },
              grid:{ color:'rgba(255,255,255,.05)' } }
        }
      },
      plugins:[nightBandsPlugin, thresholdPlugin, dayBoundaryPlugin]
    });
  }
})();


// ===== أيقونة "الأمواج الهادئة" مؤقتة (سيتم ربطها لاحقاً بالكود الخاص بها) =====
function openCalmWavesPanel(){
  alert('الأمواج الهادئة — قريباً');
  // TODO: ربط هذا الزر بالكود القادم لعرض بيانات الأمواج الهادئة
}
