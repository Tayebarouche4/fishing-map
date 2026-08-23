"""
ci_sst_pipeline.py
نسخة من خط أنابيب SST مصمّمة للعمل داخل GitHub Actions (سحابيًا، بدون أي جهاز
محلي). يُشغَّل من جذر مستودع fishing-map بعد checkout، ويكتب المخرجات مباشرة
في هيكل المستودع (tiles/YYYY-MM-DD/, tcont.geojson, tiles/dates.json,
version.json) بدون رفع عبر API — الـ commit/push تسويه خطوة الـ workflow نفسها.

بيانات اعتماد CMEMS تُقرأ من متغيرات البيئة CMEMS_USERNAME / CMEMS_PASSWORD
(تُمرَّر عبر GitHub Secrets)، وليس من credentials.txt المحلي.

الاستخدام (داخل workflow):
    python scripts/ci_sst_pipeline.py
"""

import json
import os
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent  # .../scripts/../  = جذر المستودع
sys.path.insert(0, str(Path(__file__).resolve().parent))  # عشان يلقى sst_process.py

from sst_process import process  # noqa: E402  — نفس منطق المعالجة بدون أي تعديل

LON_MIN, LON_MAX = -0.43, 1.00
LAT_MIN, LAT_MAX = 35.70, 36.70

SST_DATASET = {
    "dataset_id": "SST_MED_SST_L4_NRT_OBSERVATIONS_010_004_c_V2",
    "variable":   ["analysed_sst"],
}

# إعادة المحاولة لو بيانات اليوم لسا ما نُشرت — بيانات SST تتوفر عادة من الساعة
# 12:00 ظهرًا بتوقيت الجزائر (11:00 UTC)، وقد تتأخر أحيانًا حتى 17:00 (16:00 UTC).
# 11 محاولة كل 30 دقيقة = 5 ساعات تغطية، تبدأ من موعد التشغيلة نفسه.
RETRY_ATTEMPTS = 11
RETRY_INTERVAL_SEC = 30 * 60


def download_sst_nc(date_str, out_path):
    username = os.environ.get("CMEMS_USERNAME")
    password = os.environ.get("CMEMS_PASSWORD")
    if not username or not password:
        raise RuntimeError("متغيرات البيئة CMEMS_USERNAME / CMEMS_PASSWORD غير موجودة")

    import copernicusmarine as cm

    last_error = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        print("محاولة تحميل sst.nc [" + str(attempt) + "/" + str(RETRY_ATTEMPTS) + "] ...")
        try:
            cm.subset(
                dataset_id        = SST_DATASET["dataset_id"],
                variables         = SST_DATASET["variable"],
                minimum_longitude = LON_MIN,
                maximum_longitude = LON_MAX,
                minimum_latitude  = LAT_MIN,
                maximum_latitude  = LAT_MAX,
                start_datetime    = date_str + "T00:00:00",
                end_datetime      = date_str + "T00:00:00",
                output_filename   = os.path.basename(out_path),
                output_directory  = os.path.dirname(out_path),
                username          = username,
                password          = password,
            )
            if os.path.exists(out_path):
                return  # نجح
        except Exception as e:
            last_error = e
            print("  فشلت المحاولة: " + str(e))

        if attempt < RETRY_ATTEMPTS:
            print("  البيانات غير متوفرة بعد، إعادة المحاولة بعد " +
                  str(RETRY_INTERVAL_SEC // 60) + " دقيقة...")
            time.sleep(RETRY_INTERVAL_SEC)

    raise RuntimeError("فشل تحميل sst.nc بعد " + str(RETRY_ATTEMPTS) + " محاولات. آخر خطأ: " + str(last_error))


def main():
    # يقبل تاريخ محدد اختياريًا كمعامل سطر أوامر — مفيد للتجربة اليدوية على تاريخ
    # معروف إنه متوفر، بدل انتظار نشر بيانات اليوم. بدون معامل = تاريخ اليوم.
    date_str = sys.argv[1] if len(sys.argv) > 1 else datetime.now().strftime("%Y-%m-%d")
    print("===== خط أنابيب SST السحابي لتاريخ " + date_str + " =====")

    with tempfile.TemporaryDirectory() as tmp:
        nc_path = os.path.join(tmp, "sst.nc")
        print("تحميل sst.nc ...")
        download_sst_nc(date_str, nc_path)
        print("تم التحميل: " + nc_path)

        # المعالجة تنتج sst.png + sst_values.json + tcont.geojson في مجلد مؤقت
        info = process(nc_path, tmp)
        print("نتيجة المعالجة: " + str(info))

        # نقل المخرجات لمكانها الصحيح داخل المستودع
        tiles_day_dir = REPO_ROOT / "tiles" / date_str
        tiles_day_dir.mkdir(parents=True, exist_ok=True)

        (Path(tmp) / "sst.png").replace(tiles_day_dir / "sst.png")
        (Path(tmp) / "sst_values.json").replace(tiles_day_dir / "sst_values.json")
        (Path(tmp) / "tcont.geojson").replace(REPO_ROOT / "tcont.geojson")

    # تحديث tiles/dates.json
    dates_path = REPO_ROOT / "tiles" / "dates.json"
    dates_path.write_text(json.dumps({"latest": date_str}, ensure_ascii=False), encoding="utf-8")

    # تحديث version.json
    v = datetime.now().strftime("%Y-%m-%d-%H%M")
    version_path = REPO_ROOT / "version.json"
    version_path.write_text(
        json.dumps({"v": v, "msg": "تحديث تلقائي سحابي لبيانات الحرارة " + date_str}, ensure_ascii=False),
        encoding="utf-8",
    )

    print("===== انتهت التشغيلة بنجاح — جاهز للـ commit =====")


if __name__ == "__main__":
    main()
