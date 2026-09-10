"""
ci_wave_period_pipeline.py

خط أنابيب "فترة الموج" (VTM10) — خريطة منطقة كاملة (وهران-مستغانم) لمتوسط
فترة الموج خلال الليلة الحالية أو القادمة (19:00 -> 07:00)، مصمّم للعمل
داخل GitHub Actions كل 8 ساعات.

الفكرة الزمنية: نحسب دائماً "من مساء اليوم الحالي (19:00) إلى صباح الغد
(07:00)"، بغض النظر عن الساعة التي تشتغل فيها التشغيلة — حتى لو كانت
التشغيلة في الصباح الباكر، الهدف يبقى ليلة اليوم القادمة (وليس ليلة أمس).
هذا مفيد لتخطيط رحلة الليلة القادمة، ويعتمد على بيانات التوقّع (forecast)
لأن الليلة المستهدفة غالباً لم تبدأ بعد وقت التشغيل.

المخرجات:
- weather/wave_period_night.png   : خريطة ملوّنة (RGBA شفافة خارج البيانات)
                                     تُعرض كـ L.imageOverlay فوق خريطة Leaflet
- data/wave_period_night.json     : الحدود الجغرافية + شبكة القيم الخام
                                     (لعرض القيمة عند تمرير الفأرة/اللمس)
                                     + حدود مقياس الألوان لرسم مفتاح الخريطة
"""

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent

# نفس صندوق الإحداثيات المستعمل في السكريبت الأصلي (وهران - مستغانم)
LON_MIN, LON_MAX = -0.43, 1.00
LAT_MIN, LAT_MAX = 35.70, 36.70

# نفس المنتج والمتغير
DATASET_ID = "cmems_mod_ibi_wav_anfc_0.027deg_PT1H-i_202411"
VARIABLE   = ["VTM10"]

LOCAL_UTC_OFFSET = 1  # الجزائر UTC+1 طوال السنة (بدون توقيت صيفي)

# مقياس ألوان ثابت (بالثواني) حتى تبقى الألوان قابلة للمقارنة بين التشغيلات
COLOR_MIN = 2.0
COLOR_MAX = 12.0
COLORMAP  = "turbo"

RETRY_ATTEMPTS = 3
RETRY_INTERVAL_SEC = 5 * 60


def _read_credentials():
    creds_file = Path("C:/fishing_data/credentials.txt")
    # في GitHub Actions نقرأ من متغيرات البيئة بدل الملف المحلي
    import os
    username = os.environ.get("CMEMS_USERNAME")
    password = os.environ.get("CMEMS_PASSWORD")
    if username and password:
        return username, password
    if creds_file.exists():
        username, password = None, None
        for line in creds_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("username="):
                username = line.split("=", 1)[1].strip()
            elif line.startswith("password="):
                password = line.split("=", 1)[1].strip()
        return username, password
    return None, None


def _current_or_upcoming_night():
    """دائماً: من مساء اليوم الحالي (19:00) إلى صباح الغد (07:00)، بتوقيت الجزائر"""
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc + timedelta(hours=LOCAL_UTC_OFFSET)

    night_start_local = now_local.replace(hour=19, minute=0, second=0, microsecond=0)
    night_end_local   = night_start_local + timedelta(hours=12)

    night_start_utc = night_start_local - timedelta(hours=LOCAL_UTC_OFFSET)
    night_end_utc   = night_end_local - timedelta(hours=LOCAL_UTC_OFFSET)
    return night_start_utc, night_end_utc, night_start_local, night_end_local


def _download(start_dt, end_dt, username, password, out_path):
    import subprocess
    import sys
    try:
        import copernicusmarine as cm
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "install", "copernicusmarine", "--quiet"], check=True)
        import copernicusmarine as cm

    last_error = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        print("محاولة تحميل VTM10 [" + str(attempt) + "/" + str(RETRY_ATTEMPTS) + "] ...")
        try:
            cm.subset(
                dataset_id        = DATASET_ID,
                variables         = VARIABLE,
                minimum_longitude = LON_MIN,
                maximum_longitude = LON_MAX,
                minimum_latitude  = LAT_MIN,
                maximum_latitude  = LAT_MAX,
                start_datetime    = start_dt.strftime("%Y-%m-%dT%H:00:00"),
                end_datetime      = end_dt.strftime("%Y-%m-%dT%H:00:00"),
                output_filename   = out_path.name,
                output_directory  = str(out_path.parent),
                username          = username,
                password          = password,
                overwrite         = True,
            )
            if out_path.exists():
                return
        except Exception as e:
            last_error = e
            print(" فشلت المحاولة: " + str(e))
            if attempt < RETRY_ATTEMPTS:
                time.sleep(RETRY_INTERVAL_SEC)

    raise RuntimeError("فشل تحميل VTM10 بعد " + str(RETRY_ATTEMPTS) + " محاولات. آخر خطأ: " + str(last_error))


def _process(nc_path):
    """يحسب متوسط الليل، يرجع: lon(1D), lat(1D), avg(2D)"""
    import xarray as xr

    ds = xr.open_dataset(nc_path)
    vtm = None
    for var in ["VTM10", "vtm10"]:
        if var in ds:
            vtm = ds[var]
            break
    if vtm is None:
        raise RuntimeError("المتغير VTM10 غير موجود في الملف المحمّل")

    data = vtm.mean(dim="time").values if "time" in vtm.dims else vtm.values
    data = np.squeeze(np.asarray(data, dtype="float64"))

    lon = ds["longitude"].values if "longitude" in ds else ds["lon"].values
    lat = ds["latitude"].values if "latitude" in ds else ds["lat"].values
    ds.close()
    return np.asarray(lon), np.asarray(lat), data


def _save_colored_png(lon, lat, data, out_path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.colors as mcolors
    import matplotlib.image as mpimg

    norm = mcolors.Normalize(vmin=COLOR_MIN, vmax=COLOR_MAX, clip=True)
    try:
        cmap = matplotlib.colormaps[COLORMAP]  # matplotlib >= 3.5 (الواجهة الحالية المعتمدة)
    except AttributeError:
        import matplotlib.cm as cm
        cmap = cm.get_cmap(COLORMAP)  # توافق مع نسخ matplotlib الأقدم

    rgba = cmap(norm(data))
    # شفافية كاملة أينما لا توجد بيانات (يابسة/خارج التغطية)
    mask_nan = np.isnan(data)
    rgba[..., 3] = np.where(mask_nan, 0.0, 0.85)

    # lat عادة تتصاعد من الجنوب للشمال في NetCDF؛ الصورة تحتاج أعلى=شمال
    if lat[0] < lat[-1]:
        rgba = np.flipud(rgba)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    mpimg.imsave(out_path, rgba)


def _downsample_grid(lon, lat, data, max_points=60):
    """تقليل دقة الشبكة المصدَّرة لـJSON (كافية لتلميح الفأرة، بدون تضخيم حجم الملف)"""
    lon_step = max(1, len(lon) // max_points)
    lat_step = max(1, len(lat) // max_points)
    lon_ds = lon[::lon_step]
    lat_ds = lat[::lat_step]
    data_ds = data[::lat_step, ::lon_step]
    # استبدال NaN بـ None حتى يصلح JSON
    values = [[(None if np.isnan(v) else round(float(v), 2)) for v in row] for row in data_ds]
    return lon_ds.tolist(), lat_ds.tolist(), values


def main():
    night_start_utc, night_end_utc, night_start_local, night_end_local = _current_or_upcoming_night()
    print("===== خط أنابيب فترة الموج (VTM10) =====")
    print("الليلة المستهدفة (محلي): " + night_start_local.strftime("%Y-%m-%d %H:%M") + " -> " + night_end_local.strftime("%Y-%m-%d %H:%M"))

    username, password = _read_credentials()
    if not username:
        raise RuntimeError("بيانات اعتماد Copernicus Marine غير متوفرة (CMEMS_USERNAME/CMEMS_PASSWORD)")

    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        nc_path = Path(tmp) / "vtm10_night.nc"
        _download(night_start_utc, night_end_utc, username, password, nc_path)
        lon, lat, data = _process(nc_path)

    valid = data[~np.isnan(data)]
    if valid.size == 0:
        raise RuntimeError("لا توجد بيانات صالحة بعد المعالجة")
    print(f"عدد نقاط الشبكة: {data.size} | المتوسط: {valid.mean():.2f}s | أدنى: {valid.min():.2f}s | أقصى: {valid.max():.2f}s")

    png_path = REPO_ROOT / "weather" / "wave_period_night.png"
    _save_colored_png(lon, lat, data, png_path)
    print("تم حفظ الخريطة الملوّنة في: " + str(png_path))

    lon_ds, lat_ds, values_ds = _downsample_grid(lon, lat, data)
    json_payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "night_start_local": night_start_local.strftime("%Y-%m-%dT%H:%M:%S"),
        "night_end_local": night_end_local.strftime("%Y-%m-%dT%H:%M:%S"),
        "bounds": {"lon_min": LON_MIN, "lon_max": LON_MAX, "lat_min": LAT_MIN, "lat_max": LAT_MAX},
        "color_scale": {"min": COLOR_MIN, "max": COLOR_MAX, "colormap": COLORMAP, "unit": "s"},
        "stats": {"min": round(float(valid.min()), 2), "max": round(float(valid.max()), 2), "avg": round(float(valid.mean()), 2)},
        "grid": {"lon": lon_ds, "lat": lat_ds, "values": values_ds},
    }
    json_path = REPO_ROOT / "data" / "wave_period_night.json"
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(json_payload, ensure_ascii=False), encoding="utf-8")
    print("تم تصدير بيانات التلميح إلى: " + str(json_path))

    # تحديث version.json (نفس تنسيق باقي الطبقات)
    v = datetime.now().strftime("%Y-%m-%d-%H%M")
    version_path = REPO_ROOT / "version.json"
    version_path.write_text(
        json.dumps({"v": v, "msg": "تحديث تلقائي كل 8 ساعات — خريطة فترة الموج الليلية"}, ensure_ascii=False),
        encoding="utf-8",
    )

    print("===== انتهت التشغيلة بنجاح — جاهز للـ commit =====")


if __name__ == "__main__":
    main()
