"""
ci_currents_pipeline.py
نسخة من خط أنابيب التيارات تعتمد على النموذج الساعي من CMEMS
(cmems_mod_med_phy-cur_anfc_4.2km-3D_PT1H-m)، مصمّمة للعمل داخل GitHub
Actions كل 6 ساعات — كل تشغيلة تجيب أقرب لقطة ساعية لوقت التشغيل الفعلي،
عشان تكون أقرب ما يمكن للتوقّع الحقيقي.

current-1 (سطح، عمق ~1م): current1.geojson لليوم الحالي + توقّع +24 ساعة.
current-50 (أعماق، عمق ~50م): current50.geojson للساعة الحالية فقط، مسار ثابت.

بيانات اعتماد CMEMS من متغيرات البيئة CMEMS_USERNAME / CMEMS_PASSWORD.
الـ commit/push تسويه خطوة الـ workflow — git يتخطى تلقائيًا لو ما فيه تغيير.
"""

import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from currents_process import _load_currents, _build_arrows, _export_geojson  # noqa: E402

LON_MIN, LON_MAX = -0.43, 1.00
LAT_MIN, LAT_MAX = 35.70, 36.70

# النموذج الساعي (PT1H-m) — بديل المتوسط اليومي (P1D-m) المستخدم في الأرشيف اليومي
HOURLY_DATASET_ID = "cmems_mod_med_phy-cur_anfc_4.2km-3D_PT1H-m"
VARIABLES = ["uo", "vo"]

LAYERS = {
    "current-1": {"depth_min": 1.02, "depth_max": 1.05},
    "current-50": {"depth_min": 50.0, "depth_max": 55.0},
}

RETRY_ATTEMPTS = 3
RETRY_INTERVAL_SEC = 5 * 60


def cleanup_keep_only_current(folder, keep_filenames):
    """يحذف كل ملفات .geojson في folder ما عدا الأسماء المذكورة في keep_filenames."""
    if not folder.exists():
        return
    deleted = 0
    for f in folder.glob("*.geojson"):
        if f.name not in keep_filenames:
            print("حذف ملف قديم: " + f.name)
            f.unlink()
            deleted += 1
    if deleted:
        print("تم حذف " + str(deleted) + " ملف/ملفات قديمة — أُبقي فقط على: " + ", ".join(sorted(keep_filenames)))
    else:
        print("لا يوجد ملفات قديمة تحتاج حذف")


def download_nc(layer_key, target_datetime, out_path):
    """target_datetime: كائن datetime مقرّب لأقرب ساعة (UTC)."""
    username = os.environ.get("CMEMS_USERNAME")
    password = os.environ.get("CMEMS_PASSWORD")
    if not username or not password:
        raise RuntimeError("متغيرات البيئة CMEMS_USERNAME / CMEMS_PASSWORD غير موجودة")

    import copernicusmarine as cm
    depths = LAYERS[layer_key]
    dt_iso = target_datetime.strftime("%Y-%m-%dT%H:00:00")

    last_error = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        print("محاولة تحميل " + layer_key + " للساعة " + dt_iso + " [" + str(attempt) + "/" + str(RETRY_ATTEMPTS) + "] ...")
        try:
            cm.subset(
                dataset_id        = HOURLY_DATASET_ID,
                variables         = VARIABLES,
                minimum_longitude = LON_MIN,
                maximum_longitude = LON_MAX,
                minimum_latitude  = LAT_MIN,
                maximum_latitude  = LAT_MAX,
                minimum_depth     = depths["depth_min"],
                maximum_depth     = depths["depth_max"],
                start_datetime    = dt_iso,
                end_datetime      = dt_iso,
                output_filename   = os.path.basename(out_path),
                output_directory  = os.path.dirname(out_path),
                username          = username,
                password          = password,
                overwrite         = True,
            )
            if os.path.exists(out_path):
                return
        except Exception as e:
            last_error = e
            print("  فشلت المحاولة: " + str(e))

        if attempt < RETRY_ATTEMPTS:
            time.sleep(RETRY_INTERVAL_SEC)

    raise RuntimeError("فشل تحميل " + layer_key + " بعد " + str(RETRY_ATTEMPTS) + " محاولات. آخر خطأ: " + str(last_error))


def process_layer(nc_path, out_geojson_path):
    u, v, lon, lat = _load_currents(nc_path)
    arrows = _build_arrows(u, v, lon, lat)
    layer_cfg = {"file": os.path.basename(nc_path)}
    tmp_dir = os.path.dirname(out_geojson_path)
    date_str = datetime.now().strftime("%Y-%m-%d")
    tmp_path, count = _export_geojson(arrows, layer_cfg, date_str, tmp_dir)
    Path(tmp_path).replace(out_geojson_path)
    return count


def main():
    now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    forecast_dt = now + timedelta(hours=12)

    today_ddmmyyyy = now.strftime("%d-%m-%Y")

    print("===== خط أنابيب التيارات الساعي — تشغيلة " + now.strftime("%Y-%m-%d %H:00") + " UTC =====")

    with tempfile.TemporaryDirectory() as tmp:
        # ===== current-1 (سطح): أقرب ساعة لوقت التشغيل — بتاريخ اليوم كالمعتاد =====
        nc1_now = os.path.join(tmp, "current-1_now.nc")
        download_nc("current-1", now, nc1_now)
        out1_today = REPO_ROOT / "currents" / "current1" / (today_ddmmyyyy + ".geojson")
        out1_today.parent.mkdir(parents=True, exist_ok=True)
        count1 = process_layer(nc1_now, out1_today)
        print("current1 (الساعة الحالية): " + str(count1) + " سهم")

        # ===== current-1 (سطح): توقّع بعد 12 ساعة — داخل نفس مجلد current1/
        # عشان يظهر تلقائيًا في قائمة الملفات اللي يعرضها الموقع، بس بلاحقة
        # "_forecast12h" تميّزه عن ملف الحالة الآنية وتمنع أي تصادم بالاسم حتى
        # لو التوقع وقع بنفس اليوم التقويمي. لا يوقف التشغيلة لو فشل.
        try:
            nc1_fcst = os.path.join(tmp, "current-1_forecast.nc")
            download_nc("current-1", forecast_dt, nc1_fcst)
            forecast_name = forecast_dt.strftime("%d-%m-%Y") + "_forecast12h.geojson"
            out1_forecast = REPO_ROOT / "currents" / "current1" / forecast_name
            count1_fcst = process_layer(nc1_fcst, out1_forecast)
            print("current1 (توقّع +12 ساعة): " + str(count1_fcst) + " سهم")
        except Exception as e:
            print("تحذير: فشل توقّع +12 ساعة لتيار السطح، يُتخطى: " + str(e))

        # ===== current-50 (أعماق): أقرب ساعة لوقت التشغيل، مسار ثابت =====
        nc50_now = os.path.join(tmp, "current-50_now.nc")
        download_nc("current-50", now, nc50_now)
        out50 = REPO_ROOT / "current50.geojson"
        count50 = process_layer(nc50_now, out50)
        print("current50 (الساعة الحالية): " + str(count50) + " سهم")

    # تنظيف تلقائي: يمسح كل الأرشيف القديم، يبقي فقط ملف "الآن" وملف "التوقّع" الحاليين
    current1_folder = REPO_ROOT / "currents" / "current1"
    keep_names = {today_ddmmyyyy + ".geojson", forecast_dt.strftime("%d-%m-%Y") + "_forecast12h.geojson"}
    cleanup_keep_only_current(current1_folder, keep_names)

    # تحديث version.json
    v = datetime.now().strftime("%Y-%m-%d-%H%M")
    version_path = REPO_ROOT / "version.json"
    version_path.write_text(
        json.dumps({"v": v, "msg": "تحديث تلقائي سحابي (ساعي) لبيانات التيارات"}, ensure_ascii=False),
        encoding="utf-8",
    )

    print("===== انتهت التشغيلة بنجاح — جاهز للـ commit =====")


if __name__ == "__main__":
    main()
