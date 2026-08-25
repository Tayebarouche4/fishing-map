"""
ci_currents_pipeline.py
نسخة من خط أنابيب التيارات تعتمد على النموذج الساعي من CMEMS
(cmems_mod_med_phy-cur_anfc_4.2km-3D_PT1H-m)، مصمّمة للعمل داخل GitHub
Actions كل 6 ساعات — كل تشغيلة تجيب أقرب لقطة ساعية لوقت التشغيل الفعلي،
عشان تكون أقرب ما يمكن للتوقّع الحقيقي.

current-1 (سطح، عمق ~1م): 5 ملفات في currents/current1/ — الآن ثم كل 3 ساعات
حتى +12 ساعة، كل ملف باسم يحمل توقيته الفعلي بصيغة UTC
(current1_YYYY-MM-DD_HHh00Z.geojson) لضمان قراءة موثوقة من الواجهة.
current-50 (أعماق، عمق ~50م): current50.geojson للساعة الحالية فقط، مسار ثابت.

ملاحظة: يُفترض تشغيل هذا السكربت كل 3 ساعات (بدل 6) عبر cron الـ workflow،
حتى تبقى محطة "الآن" فعليًا قريبة من اللحظة الراهنة وليس متأخرة لساعات.

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


# محطات توقّع تيار السطح: الآن ثم كل 3 ساعات حتى +12 ساعة (5 محطات)
FORECAST_OFFSETS_HOURS = [0, 3, 6, 9, 12]


def current1_filename(step_dt):
    """اسم موحّد يحمل التوقيت UTC الفعلي داخل الاسم نفسه (وليس مجرد +Nh نسبي)،
    حتى تقرأ الواجهة الساعة الحقيقية للبيانات مباشرة من اسم الملف — هذا يرفع
    الموثوقية لأن العرض لا يعتمد على افتراض "الملف رقم كذا = الآن + كذا ساعة"،
    بل على الوقت المكتوب صراحة في الاسم."""
    return "current1_" + step_dt.strftime("%Y-%m-%d_%Hh00Z") + ".geojson"


def main():
    now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)

    print("===== خط أنابيب التيارات الساعي — تشغيلة " + now.strftime("%Y-%m-%d %H:00") + " UTC =====")

    keep_names = set()

    with tempfile.TemporaryDirectory() as tmp:
        # ===== current-1 (سطح): 5 محطات — الآن ثم +3/+6/+9/+12 ساعة =====
        # كل محطة تُحفظ في ملف مستقل باسم يحمل توقيتها الفعلي (UTC). فشل محطة
        # واحدة لا يوقف بقية المحطات ولا التشغيلة كاملة.
        current1_folder = REPO_ROOT / "currents" / "current1"
        current1_folder.mkdir(parents=True, exist_ok=True)

        for offset in FORECAST_OFFSETS_HOURS:
            step_dt = now + timedelta(hours=offset)
            filename = current1_filename(step_dt)
            keep_names.add(filename)
            try:
                nc1_step = os.path.join(tmp, "current-1_+%02dh.nc" % offset)
                download_nc("current-1", step_dt, nc1_step)
                out1_step = current1_folder / filename
                count1 = process_layer(nc1_step, out1_step)
                print("current1 (+" + str(offset) + "h، " + step_dt.strftime("%H:00") + " UTC): " + str(count1) + " سهم")
            except Exception as e:
                print("تحذير: فشلت محطة +" + str(offset) + "h لتيار السطح، تُتخطى: " + str(e))

        # ===== current-50 (أعماق): أقرب ساعة لوقت التشغيل، مسار ثابت =====
        nc50_now = os.path.join(tmp, "current-50_now.nc")
        download_nc("current-50", now, nc50_now)
        out50 = REPO_ROOT / "current50.geojson"
        count50 = process_layer(nc50_now, out50)
        print("current50 (الساعة الحالية): " + str(count50) + " سهم")

    # تنظيف تلقائي: يمسح كل الأرشيف القديم، يبقي فقط محطات هذه التشغيلة الخمس
    cleanup_keep_only_current(current1_folder, keep_names)

    # تحديث version.json
    v = datetime.now().strftime("%Y-%m-%d-%H%M")
    version_path = REPO_ROOT / "version.json"
    version_path.write_text(
        json.dumps(
            {"v": v, "msg": "تحديث تلقائي كل 3 ساعات — توقّع تيار السطح حتى +12 ساعة (5 محطات)"},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print("===== انتهت التشغيلة بنجاح — جاهز للـ commit =====")


if __name__ == "__main__":
    main()
