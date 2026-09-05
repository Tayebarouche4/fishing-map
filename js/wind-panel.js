(function(){
  var WIND_DATA_URL   = 'data/wind_forecast.json';
  var WIND_CACHE_KEY  = 'wx_wind_cache_v1';
  var WIND_CACHE_HRS  = 8;
  var NIGHT_START = 19, NIGHT_END = 7;   // 19:00 - 07:00 (نفس تعريف wind.py)

  var windLoaded = false;
  var windChartInstance = null;

  window.toggleWindPanel = function(force){
    var panel = document.getElementById('wind-panel');
    var open = typeof force === 'boolean' ? force : !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    if(open && !windLoaded) bootWind();
  };
  // إبقاء التوافق مع onclick القديم في الأيقونة
  window.openWindPanel = function(){ window.toggleWindPanel(); };

  function windCacheRead(){
    try{ var raw = localStorage.getItem(WIND_CACHE_KEY); return raw ? JSON.parse(raw) : null; }
    catch(e){ return null; }
  }
  function windCacheWrite(data){
    try{ localStorage.setItem(WIND_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data })); }catch(e){}
  }
  function windCacheAgeHrs(c){ return (Date.now() - c.ts) / 3600000; }

  function bootWind(){
    var cache = windCacheRead();
    if(cache && windCacheAgeHrs(cache) < WIND_CACHE_HRS){
      renderWind(cache.data);
    } else {
      fetchWind();
    }
  }
  function fetchWind(){
    var body = document.getElementById('wind-panel-body');
    body.innerHTML = '<div class="wind-modal-state"><div class="wind-modal-spinner"></div><div>جاري تحميل المنحنى...</div></div>';
    fetch(WIND_DATA_URL + '?_=' + Date.now(), { cache: 'no-store' })
      .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(payload){
        windCacheWrite(payload);
        renderWind(payload);
      })
      .catch(function(err){
        var cache = windCacheRead();
        if(cache){ renderWind(cache.data); }
        else {
          body.innerHTML =
            '<div class="wind-modal-state">'
            + '<div style="font-size:1.6rem;">⚠️</div>'
            + '<div>تعذر تحميل بيانات الرياح<br><small>' + err.message + '</small></div>'
            + '<button class="wind-modal-refresh" onclick="windLoaded=false;window.__reloadWind()">إعادة المحاولة</button>'
            + '</div>';
        }
      });
  }
  window.__reloadWind = fetchWind;

  function fmtHour(iso){ var t = iso.split('T')[1]; return t ? t.substring(0,5) : iso; }
  function fmtDayLabel(iso){
    var dt = new Date(iso);
    var days = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    var months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    return days[dt.getDay()] + ' ' + dt.getDate() + ' ' + months[dt.getMonth()];
  }
  function isNightHour(h){ return (h >= NIGHT_START) || (h < NIGHT_END); }

  function renderWind(payload){
    windLoaded = true;
    var times  = payload.hourly.time;
    var speeds = payload.hourly.speed_kmh;
    var gusts  = payload.hourly.gusts_kmh;
    var calmMax     = (payload.thresholds_kmh && payload.thresholds_kmh.calm_max) || 20;
    var moderateMax = (payload.thresholds_kmh && payload.thresholds_kmh.moderate_max) || 39;

    var days = {};
    for(var i=0;i<times.length;i++){
      var dk = times[i].split('T')[0];
      if(!days[dk]) days[dk] = [];
      days[dk].push(gusts[i]);
    }
    var dayKeys = Object.keys(days).slice(0,5);
    var stripHtml = '<div class="wind-day-strip">';
    dayKeys.forEach(function(dk){
      var vals = days[dk].filter(function(v){ return v!=null; });
      var max = vals.length ? Math.max.apply(null, vals) : null;
      var cls = max==null ? '' : (max < calmMax ? 'low' : max < moderateMax ? 'mid' : 'high');
      stripHtml += '<div class="wind-day-pill">'
        + '<div class="wind-day-pill-label">' + fmtDayLabel(dk+'T12:00') + '</div>'
        + '<div class="wind-day-pill-val ' + cls + '">' + (max!=null? Math.round(max)+' كم/س':'—') + '</div>'
        + '</div>';
    });
    stripHtml += '</div>';

    var body = document.getElementById('wind-panel-body');
    body.innerHTML = stripHtml
      + '<div class="wind-chart-box"><canvas id="wind-canvas"></canvas></div>'
      + '<div class="wind-legend-row">'
      + '<div class="wind-legend-item"><span class="wind-legend-swatch" style="background:#a3e635;"></span>السرعة</div>'
      + '<div class="wind-legend-item"><span class="wind-legend-swatch" style="background:#ef4135;"></span>الهبات</div>'
      + '<div class="wind-legend-item"><span class="wind-legend-swatch" style="background:rgba(99,102,241,.35);"></span>ليل (19:00–07:00)</div>'
      + '<div class="wind-legend-item"><span style="display:inline-block;width:12px;border-top:2px dashed #f77f00;"></span>حذر ' + calmMax + ' كم/س</div>'
      + '<div class="wind-legend-item"><span style="display:inline-block;width:12px;border-top:2px dashed #d62828;"></span>خطر ' + moderateMax + ' كم/س</div>'
      + '</div>'
      + '<div class="wind-status-line" style="margin-top:6px;">آخر تحديث: ' + (payload.generated_at || '—') + '</div>';

    drawWindChart(times, speeds, gusts, calmMax, moderateMax);
  }

  function drawWindChart(times, speeds, gusts, calmMax, moderateMax){
    if(typeof Chart === 'undefined'){
      document.getElementById('wind-panel-body').insertAdjacentHTML('beforeend',
        '<div class="wind-modal-state"><div style="font-size:1.6rem;">⚠️</div>'
        + '<div>تعذر تحميل مكتبة الرسم البياني (Chart.js)<br><small>تحقق من الاتصال بالإنترنت أو أعد فتح الصفحة</small></div></div>');
      return;
    }
    var ctx = document.getElementById('wind-canvas').getContext('2d');
    var labels = times.map(fmtHour);
    var nightMeta = times.map(function(t){ return isNightHour(parseInt(t.split('T')[1].substring(0,2),10)); });

    var dayShortNames = ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
    var dayStartIdx = [];
    for(var i=0;i<times.length;i++){
      var h = parseInt(times[i].split('T')[1].substring(0,2),10);
      if(h===0 || i===0) dayStartIdx.push(i);
    }
    var daySegments = dayStartIdx.map(function(startIdx, k){
      var endIdx = (k+1 < dayStartIdx.length) ? dayStartIdx[k+1]-1 : times.length-1;
      var dt = new Date(times[startIdx]);
      return { start:startIdx, end:endIdx, label: dayShortNames[dt.getDay()] + ' ' + dt.getDate() + '/' + (dt.getMonth()+1) };
    });

    var nightBandsPlugin = {
      id:'windNightBands',
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
      id:'windThresholds',
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
      id:'windDayBoundary',
      afterDraw: function(chart){
        var xScale = chart.scales.x, yScale = chart.scales.y, c = chart.ctx;
        c.save();
        dayStartIdx.forEach(function(idx){
          if(idx===0) return;
          var x = xScale.getPixelForValue(idx);
          c.strokeStyle = 'rgba(255,255,255,.22)';
          c.setLineDash([3,3]);
          c.lineWidth = 1;
          c.beginPath(); c.moveTo(x, yScale.top); c.lineTo(x, yScale.bottom); c.stroke();
        });
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

    if(windChartInstance) windChartInstance.destroy();
    windChartInstance = new Chart(ctx, {
      type:'line',
      data:{ labels:labels, datasets:[
        {
          label:'سرعة الرياح (كم/س)', data:speeds,
          borderColor:'#a3e635', backgroundColor:'rgba(163,230,53,.12)',
          borderWidth:2.2, pointRadius:0, pointHoverRadius:4, tension:.35, fill:true
        },
        {
          label:'هبات الرياح (كم/س)', data:gusts,
          borderColor:'#ef4135', backgroundColor:'transparent',
          borderDash:[5,3], borderWidth:1.6, pointRadius:0, pointHoverRadius:4, tension:.35, fill:false
        }
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        layout:{ padding:{ top:16 } },
        interaction:{ mode:'index', intersect:false },
        plugins:{
          legend:{ display:false },
          tooltip:{ rtl:true, titleFont:{family:'Tajawal'}, bodyFont:{family:'Tajawal'},
            callbacks:{ label:function(c){ return c.dataset.label + ': ' + c.parsed.y.toFixed(1) + ' كم/س'; } } }
        },
        scales:{
          x:{ ticks:{ color:'#8a93ac', font:{family:'Tajawal',size:8},
                callback:function(v,i){ return i % 12 === 0 ? labels[i] : ''; }, maxRotation:0, autoSkip:false },
              grid:{ color:'rgba(255,255,255,.05)' } },
          y:{ beginAtZero:true, ticks:{ color:'#8a93ac', font:{family:'Tajawal',size:9},
                callback:function(v){ return v+' كم/س'; } },
              grid:{ color:'rgba(255,255,255,.05)' } }
        }
      },
      plugins:[nightBandsPlugin, thresholdPlugin, dayBoundaryPlugin]
    });
  }
})();
