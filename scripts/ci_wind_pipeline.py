"""
ci_wind_pipeline.py

خط أنابيب توقّع سرعة وهبات الرياح (Météo-France عبر Open-Meteo) — مصمّم
للعمل داخل GitHub Actions كل 8 ساعات، بدون أي اعتماد على جهاز محلي.

Open-Meteo لا يحتاج بيانات اعتماد (API عام مجاني)، فما فيهش أسرار مطلوبة.

يدمج نموذجين:
- AROME France HD: نموذج محلي عالي الدقة، يغطي أول 48 ساعة (يومين) فقط.
- Meteo-France Seamless: نموذج أوسع نطاقاً، يُستعمل لتغطية اليوم 3 إلى 5.

النتيجة: أول يومين من المصدر الأدق، والباقي من المصدر الأوسع، في ملف
JSON واحد موحّد (data/wind_forecast.json) يقرأه index.html كمنحنى
Chart.js تفاعلي (سرعة + هبات).
"""

import json
import time
from datetime import datetime
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent

POINT_LAT = 36.25500
POINT_LON = 0.32410

FORECAST_DAYS = 5

MODEL_LOCAL_HD   = "meteofrance_arome_france_hd"  # دقيق، يغطي ~يومين فقط
MODEL_LOCAL_DAYS = 2
MODEL_EXTENDED   = "meteofrance_seamless"          # يغطي الـ5 أيام كاملة

CALM_MAX     = 20   # km/h — هادئ (آمن) أقل من هذا
MODERATE_MAX = 39   # km/h — معتدل (حذر) بين الحدين، فوقه قوي/خطير

RETRY_ATTEMPTS = 3
RETRY_INTERVAL_SEC = 60


def _fetch_model(model, days):
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
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        print("محاولة تحميل [" + model + "] [" + str(attempt) + "/" + str(RETRY_ATTEMPTS) + "] ...")
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
            if attempt < RETRY_ATTEMPTS:
                time.sleep(RETRY_INTERVAL_SEC)

    raise RuntimeError("فشل تحميل نموذج " + model + " بعد " + str(RETRY_ATTEMPTS) + " محاولات. آخر خطأ: " + str(last_error))


def fetch_wind_blended():
    """يدمج AROME France HD (أول يومين) مع Meteo-France Seamless (اليوم 3-5)"""
    extended = _fetch_model(MODEL_EXTENDED, FORECAST_DAYS)

    try:
        local = _fetch_model(MODEL_LOCAL_HD, MODEL_LOCAL_DAYS)
    except Exception as e:
        print("⚠️ تعذر جلب النموذج المحلي الدقيق (" + MODEL_LOCAL_HD + "): " + str(e))
        print("   المتابعة بالنموذج الموسّع فقط لكامل المدة.")
        local = None

    times  = extended["time"]
    speeds = list(extended["wind_speed_10m"])
    gusts  = list(extended["wind_gusts_10m"])
    source = ["extended"] * len(times)

    if local:
        local_speed_by_time = dict(zip(local["time"], local["wind_speed_10m"]))
        local_gust_by_time  = dict(zip(local["time"], local["wind_gusts_10m"]))
        replaced = 0
        for i, t in enumerate(times):
            if t in local_speed_by_time and local_speed_by_time[t] is not None:
                speeds[i] = local_speed_by_time[t]
                gusts[i]  = local_gust_by_time[t]
                source[i] = "local_hd"
                replaced += 1
        print(f"تم استبدال {replaced} ساعة بقيم النموذج المحلي الدقيق ({MODEL_LOCAL_HD})")

    return {"time": times, "wind_speed_10m": speeds, "wind_gusts_10m": gusts, "source": source}


def export_json(hourly, out_path):
    payload = {
        "generated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "point": {"lat": POINT_LAT, "lon": POINT_LON, "label": "مستغانم"},
        "models": {"local_hd": MODEL_LOCAL_HD, "extended": MODEL_EXTENDED},
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
    print(f"عدد النقاط: {n} | أقصى سرعة: {max(speeds):.1f} كم/س | أقصى هبة: {max(gusts):.1f} كم/س")

    out_path = REPO_ROOT / "data" / "wind_forecast.json"
    export_json(hourly, out_path)
    print("تم تصدير JSON إلى: " + str(out_path))

    # تحديث version.json (نفس تنسيق الأمواج/التيارات/الحرارة)
    v = datetime.now().strftime("%Y-%m-%d-%H%M")
    version_path = REPO_ROOT / "version.json"
    version_path.write_text(
        json.dumps(
            {"v": v, "msg": "تحديث تلقائي كل 8 ساعات — توقّع سرعة وهبات الرياح لـ 5 أيام"},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print("===== انتهت التشغيلة بنجاح — جاهز للـ commit =====")


if __name__ == "__main__":
    main()

