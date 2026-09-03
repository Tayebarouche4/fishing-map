"""
ci_waves_pipeline.py

خط أنابيب توقّع ارتفاع قمة الموجة (VMXL) — مصمّم للعمل داخل GitHub Actions
كل 8 ساعات، بدون أي اعتماد على جهاز محلي.

يحمّل توقّع 5 أيام (ساعة بساعة) من Copernicus Marine لنقطة قرب مستغانم
(36.320°N, 0.397°E)، يرسم المنحنى البياني مع خطوط الحذر/الخطر، ويحفظه في
weather/waves_5d.png داخل المستودع.

بيانات اعتماد CMEMS من متغيرات البيئة CMEMS_USERNAME / CMEMS_PASSWORD.
الـ commit/push تسويه خطوة الـ workflow — git يتخطى تلقائياً لو ما فيه تغيير.
"""

import json
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

POINT_LAT = 36.320
POINT_LON = 0.397

DATASET_ID = "cmems_mod_ibi_wav_anfc_0.027deg_PT1H-i"
VARIABLE   = ["VMXL"]

FORECAST_DAYS = 5

THRESHOLDS = {
    "هادئ (آمن)": (0, 0.8),
    "معتدل (حذر)": (0.8, 1.5),
    "عالي / خطير (تجنب الإبحار)": (1.5, 100),
}
CALM_MAX     = 0.8
MODERATE_MAX = 1.5

RETRY_ATTEMPTS = 3
RETRY_INTERVAL_SEC = 5 * 60


def _classify(crest_height):
    for label, (lo, hi) in THRESHOLDS.items():
        if lo <= crest_height < hi:
            return label
    return "غير معروف"


def download_nc(start_dt, end_dt, out_path):
    username = os.environ.get("CMEMS_USERNAME")
    password = os.environ.get("CMEMS_PASSWORD")
    if not username or not password:
        raise RuntimeError("متغيرات البيئة CMEMS_USERNAME / CMEMS_PASSWORD غير موجودة")

    import copernicusmarine as cm

    last_error = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        print("محاولة تحميل VMXL [" + str(attempt) + "/" + str(RETRY_ATTEMPTS) + "] ...")
        try:
            cm.subset(
                dataset_id        = DATASET_ID,
                variables         = VARIABLE,
                minimum_longitude = POINT_LON,
                maximum_longitude = POINT_LON,
                minimum_latitude  = POINT_LAT,
                maximum_latitude  = POINT_LAT,
                start_datetime    = start_dt,
                end_datetime      = end_dt,
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
            print(" فشلت المحاولة: " + str(e))
            if attempt < RETRY_ATTEMPTS:
                time.sleep(RETRY_INTERVAL_SEC)

    raise RuntimeError("فشل تحميل VMXL بعد " + str(RETRY_ATTEMPTS) + " محاولات. آخر خطأ: " + str(last_error))


def read_rows(nc_path):
    import xarray as xr

    ds = xr.open_dataset(nc_path)
    da = ds["VMXL"].squeeze()
    times = ds["time"].values

    rows = []
    values = da.values.flatten() if hasattr(da.values, "flatten") else [float(da.values)]
    times_list = times if hasattr(times, "__len__") else [times]

    for t, val in zip(times_list, values):
        t_str = str(t)[:16].replace("T", " ")
        crest_val = float(val)
        rows.append({
            "time": t_str,
            "vmxl_m": round(crest_val, 2),
            "label": _classify(crest_val),
        })

    ds.close()
    return rows


def plot_chart(rows, out_path):
    import matplotlib
    matplotlib.use("Agg")  # بدون واجهة رسومية (بيئة CI)
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates

    times  = [datetime.strptime(r["time"], "%Y-%m-%d %H:%M") for r in rows]
    values = [r["vmxl_m"] for r in rows]

    plt.figure(figsize=(10, 5))
    plt.plot(times, values, color='#0077b6', linewidth=2.5, marker='o', markersize=3,
              label='قمة الموجة VMXL (متر)')

    plt.axhline(y=CALM_MAX, color='#f77f00', linestyle='--', alpha=0.8, label=f'حد الحذر ({CALM_MAX} م)')
    plt.axhline(y=MODERATE_MAX, color='#d62828', linestyle='--', alpha=0.8, label=f'حد الخطر ({MODERATE_MAX} م)')

    plt.title(
        f"توقعات أقصى ارتفاع لقمة الموجة (VMXL) لـ {FORECAST_DAYS} أيام\n"
        f"النقطة: {POINT_LAT}°N, {POINT_LON}°E (مستغانم)",
        fontsize=11
    )
    plt.xlabel("التاريخ والوقت (UTC)")
    plt.ylabel("الارتفاع (متر)")
    plt.grid(True, linestyle=':', alpha=0.6)
    plt.legend(loc='upper right')

    plt.gca().xaxis.set_major_formatter(mdates.DateFormatter('%m-%d %H:00'))
    plt.gcf().autofmt_xdate()
    plt.tight_layout()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_path, dpi=200)
    plt.close()


def main():
    now = datetime.utcnow()
    start_dt = now.strftime("%Y-%m-%dT%H:00:00")
    end_dt   = (now + timedelta(days=FORECAST_DAYS)).strftime("%Y-%m-%dT%H:00:00")

    print("===== خط أنابيب الأمواج (VMXL) — تشغيلة " + now.strftime("%Y-%m-%d %H:00") + " UTC =====")
    print(f"الفترة: من {start_dt} إلى {end_dt} (UTC)")

    with tempfile.TemporaryDirectory() as tmp:
        nc_path = os.path.join(tmp, "vmxl_5d_point.nc")
        download_nc(start_dt, end_dt, nc_path)
        rows = read_rows(nc_path)

    if not rows:
        raise RuntimeError("لم يتم استخراج أي بيانات VMXL")

    avg = sum(r["vmxl_m"] for r in rows) / len(rows)
    max_val = max(r["vmxl_m"] for r in rows)
    print(f"عدد النقاط: {len(rows)} | المتوسط: {avg:.2f} م | أقصى قمة: {max_val:.2f} م")

    out_path = REPO_ROOT / "weather" / "waves_5d.png"
    plot_chart(rows, out_path)
    print("تم حفظ المنحنى في: " + str(out_path))

    # تحديث version.json (نفس تنسيق التيارات/الحرارة)
    v = datetime.now().strftime("%Y-%m-%d-%H%M")
    version_path = REPO_ROOT / "version.json"
    version_path.write_text(
        json.dumps(
            {"v": v, "msg": "تحديث تلقائي كل 8 ساعات — توقّع ارتفاع الأمواج لـ 5 أيام"},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print("===== انتهت التشغيلة بنجاح — جاهز للـ commit =====")


if __name__ == "__main__":
    main()
