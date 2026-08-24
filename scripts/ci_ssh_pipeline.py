"""
ci_ssh_pipeline.py
نسخة من خط أنابيب ارتفاع سطح البحر (SSH) مصمّمة للعمل داخل GitHub Actions
(سحابيًا، بدون أي جهاز محلي ولا QGIS). يُشغَّل من جذر مستودع fishing-map بعد
checkout، ويكتب ssh.geojson مباشرة في جذر المستودع — الـ commit/push تسويه
خطوة الـ workflow نفسها.

بيانات اعتماد CMEMS تُقرأ من متغيرات البيئة CMEMS_USERNAME / CMEMS_PASSWORD
(تُمرَّر عبر GitHub Secrets — نفس الأسرار المستخدمة أصلاً في sst-daily.yml
و currents-6h.yml)، وليس من credentials.txt المحلي.

الاستخدام (داخل workflow):
    python scripts/ci_ssh_pipeline.py
"""

import json
import os
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent  # .../scripts/../  = جذر المستودع
sys.path.insert(0, str(Path(__file__).resolve().parent))  # عشان يلقى ssh_process.py

from ssh_process import process  # noqa: E402 — نفس منطق الكونتور بدون أي تعديل

LON_MIN, LON_MAX = -0.43, 1.00
LAT_MIN, LAT_MAX = 35.70, 36.70

SSH_DATASET = {
    "dataset_id": "cmems_obs-sl_eur_phy-ssh_nrt_allsat-l4-duacs-0.0625deg_P1D",
    "variable":   ["sla", "adt"],
}

# إعادة المحاولة لو بيانات اليوم لسا ما نُشرت — منتجات الـ altimetry (DUACS)
# غالبًا تُنشر بتأخير عن اليوم الفعلي. 11 محاولة كل 30 دقيقة = 5 ساعات تغطية،
# تبدأ من موعد التشغيلة نفسه (9:00 صباحًا).
RETRY_ATTEMPTS = 11
RETRY_INTERVAL_SEC = 30 * 60


def download_ssh_nc(date_str, out_path):
    username = os.environ.get("CMEMS_USERNAME")
    password = os.environ.get("CMEMS_PASSWORD")
    if not username or not password:
        raise RuntimeError("متغيرات البيئة CMEMS_USERNAME / CMEMS_PASSWORD غير موجودة")

    import copernicusmarine as cm

    last_error = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        print("محاولة تحميل ssh.nc [" + str(attempt) + "/" + str(RETRY_ATTEMPTS) + "] ...")
        try:
            cm.subset(
                dataset_id        = SSH_DATASET["dataset_id"],
                variables         = SSH_DATASET["variable"],
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
                overwrite         = True,
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

    raise RuntimeError("فشل تحميل ssh.nc بعد " + str(RETRY_ATTEMPTS) + " محاولات. آخر خطأ: " + str(last_error))


def main():
    # يقبل تاريخ محدد اختياريًا كمعامل سطر أوامر — مفيد للتجربة اليدوية.
    # بدون معامل = تاريخ اليوم.
    date_str = sys.argv[1] if len(sys.argv) > 1 else datetime.now().strftime("%Y-%m-%d")
    print("===== خط أنابيب SSH السحابي لتاريخ " + date_str + " =====")

    with tempfile.TemporaryDirectory() as tmp:
        nc_path = os.path.join(tmp, "ssh.nc")
        print("تحميل ssh.nc ...")
        download_ssh_nc(date_str, nc_path)
        print("تم التحميل: " + nc_path)

        out_geojson = REPO_ROOT / "ssh.geojson"
        info = process(nc_path, out_geojson, LON_MIN, LON_MAX, LAT_MIN, LAT_MAX)
        print("نتيجة المعالجة: " + str(info))

    # تحديث version.json عشان يتفعل إشعار التحديث في الموقع
    v = datetime.now().strftime("%Y-%m-%d-%H%M")
    version_path = REPO_ROOT / "version.json"
    version_path.write_text(
        json.dumps({"v": v, "msg": "تحديث تلقائي سحابي لبيانات ارتفاع سطح البحر " + date_str}, ensure_ascii=False),
        encoding="utf-8",
    )

    print("===== انتهت التشغيلة بنجاح — جاهز للـ commit =====")


if __name__ == "__main__":
    main()
