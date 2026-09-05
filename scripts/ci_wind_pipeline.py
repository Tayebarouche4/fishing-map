"""
ci_wind_pipeline.py

خط أنابيب توقّع سرعة وهبات الرياح — مصمّم للعمل داخل GitHub Actions
كل 8 ساعات، بدون أي اعتماد على جهاز محلي.

Open-Meteo لا يحتاج بيانات اعتماد (API عام مجاني)، فما فيهش أسرار مطلوبة.

يدمج ثلاث طبقات (كل طبقة تبدّل فوق اللي قبلها أينما توفرت بيانات لها)
لمدة 3 أيام فقط — المدة اللي تضمن جودة ساعية كاملة من ECMWF قبل ما تتخشّن،
تفضيلاً للدقة على عدد الأيام:
1. Meteo-France Seamless — شبكة أمان لأي ساعة نادرة تفوت من الطبقتين التاليتين، ليس لتمديد المدة.
2. ARPEGE Europe (Météo-France) — 11 كم، يغطي أوروبا وشمال أفريقيا (يشمل الجزائر).
3. ECMWF IFS — 9 كم، عالمي، نفس المصدر الافتراضي في تطبيق Windy، يُعتبر من أدق
   النماذج العالمية المتاحة؛ يبدّل الطبقتين السابقتين أينما توفرت بياناته (أعلى أولوية).

النتيجة: أدق بيانات متاحة لكل ساعة، في ملف JSON واحد موحّد
(data/wind_forecast.json) يقرأه index.html كمنحنى Chart.js تفاعلي.
"""

import json
import time
from datetime import datetime
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent

POINT_LAT = 36.25500
POINT_LON = 0.32410

FORECAST_DAYS = 3  # مقصودة قصيرة: دقة كاملة الساعة بدل تمديد المدة بجودة أضعف

MODEL_EXTENDED = "meteofrance_seamless"       # شبكة أمان فقط — يملأ أي ساعة ناقصة من الطبقتين التاليتين
MODEL_ARPEGE   = "meteofrance_arpege_europe"  # 11 كم، أوروبا + شمال أفريقيا
MODEL_ECMWF    = "ecmwf_ifs"                  # 9 كم، عالمي، الأدق — نفس مصدر Windy الافتراضي

CALM_MAX     = 20   # km/h — هادئ (آمن) أقل من هذا
MODERATE_MAX = 39   # km/h — معتدل (حذر) بين الحدين، فوقه قوي/خطير

RETRY_ATTEMPTS = 3
RETRY_INTERVAL_SEC = 60


def _safe_max(vals):
    """أقصى قيمة متجاهلاً أي None (ساعات النهاية غالباً غير مكتملة عند بعض النماذج)"""
    nums = [v for v in vals if v is not None]
    return max(nums) if nums else None


def _fetch_model(model, days, retries=RETRY_ATTEMPTS):
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": POINT_LAT,
        "longitude": POINT_LON,
        "hourly": ["wind_speed_10m", "wind_gusts_10m"],
        "models": model,
        "wind_speed_unit": "kmh",
        "forecast_days": days,
        "timezone": "auto",
    }

    last_error = None
    for attempt in range(1, retries + 1):
        print("محاولة تحميل [" + model + "] [" + str(attempt) + "/" + str(retries) + "] ...")
        try:
            res = requests.get(url, params=params, timeout=20)
            res.raise_for_status()
            data = res.json().get("hourly", {})
            if not data or "time" not in data:
                raise RuntimeError("استجابة فارغة من Open-Meteo لنموذج " + model)
            return data
        except Exception as e:
            last_error = e
            print(" فشلت المحاولة: " + str(e))
            if attempt < retries:
                time.sleep(RETRY_INTERVAL_SEC)

    raise RuntimeError("فشل تحميل نموذج " + model + " بعد " + str(retries) + " محاولات. آخر خطأ: " + str(last_error))


def _try_fetch(model, days, label, retries=RETRY_ATTEMPTS):
    """يحاول جلب نموذج، ويرجع None بهدوء عند الفشل بدل ما يوقف كامل الأنبوب"""
    try:
        return _fetch_model(model, days, retries=retries)
    except Exception as e:
        print("⚠️ تعذر جلب " + label + " (" + model + "): " + str(e))
        print("   المتابعة بدون هذه الطبقة.")
        return None


def _overlay(base_times, speeds, gusts, source, layer_data, layer_name):
    """يبدّل قيم speeds/gusts أينما توفرت بيانات في layer_data لنفس الوقت"""
    if not layer_data:
        return 0
    speed_by_time = dict(zip(layer_data["time"], layer_data["wind_speed_10m"]))
    gust_by_time  = dict(zip(layer_data["time"], layer_data["wind_gusts_10m"]))
    replaced = 0
    for i, t in enumerate(base_times):
        if t in speed_by_time and speed_by_time[t] is not None:
            speeds[i] = speed_by_time[t]
            gusts[i]  = gust_by_time[t]
            source[i] = layer_name
            replaced += 1
    return replaced


def fetch_wind_blended():
    """يدمج 3 طبقات لمدة 3 أيام فقط: Seamless (شبكة أمان) ← ARPEGE Europe ← ECMWF IFS (الأعلى أولوية/الأدق)"""
    extended = _fetch_model(MODEL_EXTENDED, FORECAST_DAYS)  # لازم ينجح، هذا الضمان الأساسي

    arpege = _try_fetch(MODEL_ARPEGE, FORECAST_DAYS, "ARPEGE Europe")
    ecmwf  = _try_fetch(MODEL_ECMWF, FORECAST_DAYS, "ECMWF IFS")

    times  = extended["time"]
    speeds = list(extended["wind_speed_10m"])
    gusts  = list(extended["wind_gusts_10m"])
    source = ["extended"] * len(times)

    n_arpege = _overlay(times, speeds, gusts, source, arpege, "arpege_europe")
    if arpege:
        print(f"تم استبدال {n_arpege} ساعة بقيم ARPEGE Europe ({MODEL_ARPEGE})")

    n_ecmwf = _overlay(times, speeds, gusts, source, ecmwf, "ecmwf_ifs")
    if ecmwf:
        print(f"تم استبدال {n_ecmwf} ساعة بقيم ECMWF IFS ({MODEL_ECMWF}) — أعلى أولوية")

    return {"time": times, "wind_speed_10m": speeds, "wind_gusts_10m": gusts, "source": source}


def export_json(hourly, out_path):
    payload = {
        "generated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "point": {"lat": POINT_LAT, "lon": POINT_LON, "label": "مستغانم"},
        "models": {"ecmwf": MODEL_ECMWF, "arpege_europe": MODEL_ARPEGE, "extended": MODEL_EXTENDED},
        "forecast_days": FORECAST_DAYS,
        "thresholds_kmh": {"calm_max": CALM_MAX, "moderate_max": MODERATE_MAX},
        "hourly": {
            "time": hourly["time"],
            "speed_kmh": hourly["wind_speed_10m"],
            "gusts_kmh": hourly["wind_gusts_10m"],
            "source": hourly["source"],
        },
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    now = datetime.utcnow()
    print("===== خط أنابيب الرياح — تشغيلة " + now.strftime("%Y-%m-%d %H:00") + " UTC =====")

    hourly = fetch_wind_blended()
    n = len(hourly["time"])
    if n == 0:
        raise RuntimeError("لم يتم استخراج أي بيانات رياح")

    speeds = hourly["wind_speed_10m"]
    gusts  = hourly["wind_gusts_10m"]
    max_speed = _safe_max(speeds)
    max_gust  = _safe_max(gusts)
    print(
        "عدد النقاط: " + str(n)
        + " | أقصى سرعة: " + (f"{max_speed:.1f}" if max_speed is not None else "—")
        + " كم/س | أقصى هبة: " + (f"{max_gust:.1f}" if max_gust is not None else "—") + " كم/س"
    )

    out_path = REPO_ROOT / "data" / "wind_forecast.json"
    export_json(hourly, out_path)
    print("تم تصدير JSON إلى: " + str(out_path))

    # تحديث version.json (نفس تنسيق الأمواج/التيارات/الحرارة)
    v = datetime.now().strftime("%Y-%m-%d-%H%M")
    version_path = REPO_ROOT / "version.json"
    version_path.write_text(
        json.dumps(
            {"v": v, "msg": "تحديث تلقائي كل 8 ساعات — توقّع سرعة وهبات الرياح لـ 3 أيام (دقة كاملة)"},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print("===== انتهت التشغيلة بنجاح — جاهز للـ commit =====")


if __name__ == "__main__":
    main()

