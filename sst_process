"""
sst_process.py
يعيد إنتاج منطق أداة sst_contrast_tool.html (وضع NetCDF) بالكامل تلقائيًا:
sst.nc (الملف الخام من archive_manager.py) → sst.png + sst_values.json + tcont.geojson
بدون أي تدخل يدوي — نفس القيم الافتراضية، نفس خرائط الألوان، نفس منطق القص والتمديد.
tcont.geojson عبارة عن خطوط تساوي حرارة (isotherms) كل 0.5°، بصيغة GeoJSON
(FeatureCollection من LineString)، جاهزة كطبقة Leaflet قابلة للتفعيل (زر tcont الموجود أصلاً).

الاستخدام:
    python sst_process.py /path/to/sst.nc [مجلد_الإخراج]

المتطلبات:
    pip install xarray netCDF4 numpy Pillow scikit-image --break-system-packages
"""

import io
import json
import sys
from pathlib import Path

import numpy as np
import xarray as xr
from PIL import Image
from skimage import measure

# ================= الإعدادات الافتراضية (مطابقة تمامًا لأداة HTML) =================
VAR_CANDIDATES = ['analysed_sst', 'sst', 'thetao', 'sea_surface_temperature', 'temperature', 'temp']
LAT_CANDIDATES = ['latitude', 'lat', 'nav_lat', 'y']
LON_CANDIDATES = ['longitude', 'lon', 'nav_lon', 'x']

BBOX = dict(north=36.7, south=35.7, west=-0.43, east=1.0)

SCALE_FACTOR = 0.01
ADD_OFFSET = 273.15
FILL_VALUE = -32768
TO_CELSIUS = True

P_LOW = 2       # % تجاهل أبرد
P_HIGH = 98     # % تجاهل أحر
GAMMA = 1.0
CMAP_NAME = 'turbo'
INVERT = False
HIDE_LAND = True

MAX_BYTES = 300 * 1024
UPSCALE_CANDIDATES = [8, 7, 6, 5, 4, 3.5, 3, 2.5, 2, 1.75, 1.5, 1.25, 1]

CONTOUR_STEP = 0.5   # °C — الفارق بين كل خط تساوي حرارة والذي يليه
NODATA_SENTINEL = -9999.0  # قيمة بعيدة عن أي حرارة بحر واقعية، تمنع مرور خطوط الكونتور عبر اليابسة/الفراغ


# ================= خرائط الألوان (منسوخة حرفيًا من الأداة) =================
def clamp255(v):
    return np.clip(v, 0, 255)


def turbo(t):
    t = np.clip(t, 0, 1)
    r = 34.61 + t * (1172.33 + t * (-10793.56 + t * (33300.12 + t * (-38394.49 + t * 14825.05))))
    g = 23.31 + t * (557.33 + t * (1225.33 + t * (-3574.96 + t * (1073.77 + t * 707.56))))
    b = 27.2 + t * (3211.1 + t * (-15327.97 + t * (27814 + t * (-22569.18 + t * 6838.66))))
    return clamp255(r), clamp255(g), clamp255(b)


def jet(t):
    t = np.clip(t, 0, 1)
    r = clamp255(255 * np.clip(1.5 - np.abs(4 * t - 3), 0, 1))
    g = clamp255(255 * np.clip(1.5 - np.abs(4 * t - 2), 0, 1))
    b = clamp255(255 * np.clip(1.5 - np.abs(4 * t - 1), 0, 1))
    return r, g, b


def thermal(t):
    t = np.clip(t, 0, 1)
    r = np.where(t < 0.4, t / 0.4 * 255, 255.0)
    g = np.where(t < 0.4, 0.0, np.where(t < 0.75, (t - 0.4) / 0.35 * 255, 255.0))
    b = np.where(t < 0.75, 0.0, (t - 0.75) / 0.25 * 255)
    return clamp255(r), clamp255(g), clamp255(b)


def _interp(stops, t):
    t = np.clip(t, 0, 1)
    r = np.zeros_like(t, dtype=np.float64)
    g = np.zeros_like(t, dtype=np.float64)
    b = np.zeros_like(t, dtype=np.float64)
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        mask = (t >= t0) & (t <= t1)
        denom = (t1 - t0) if (t1 - t0) != 0 else 1
        f = (t - t0) / denom
        r = np.where(mask, c0[0] + (c1[0] - c0[0]) * f, r)
        g = np.where(mask, c0[1] + (c1[1] - c0[1]) * f, g)
        b = np.where(mask, c0[2] + (c1[2] - c0[2]) * f, b)
    return r, g, b


def spectral(t):
    stops = [(0.0, (69, 117, 180)), (0.25, (145, 207, 96)), (0.5, (255, 255, 191)),
              (0.75, (253, 174, 97)), (1.0, (215, 48, 39))]
    return _interp(stops, t)


def viridis(t):
    stops = [(0.0, (68, 1, 84)), (0.25, (59, 82, 139)), (0.5, (33, 145, 140)),
              (0.75, (94, 201, 98)), (1.0, (253, 231, 37))]
    return _interp(stops, t)


CMAPS = {'turbo': turbo, 'jet': jet, 'thermal': thermal, 'spectral': spectral, 'viridis': viridis}


def guess_var(names, candidates):
    lower = {str(n).lower(): n for n in names}
    for c in candidates:
        if c in lower:
            return lower[c]
    for c in candidates:
        for n_lower, n in lower.items():
            if c in n_lower:
                return n
    return None


def coord_to_index(arr, val):
    step = arr[1] - arr[0]
    return int(round((val - arr[0]) / step))


def generate_contours_geojson(real, valid, bounds, lat_step, lon_step, step=CONTOUR_STEP):
    """
    يولّد خطوط تساوي حرارة (isotherms) كل `step` درجة من شبكة الحرارة الحقيقية،
    ويحوّلها إلى إحداثيات (lon,lat) عبر bounds/lat_step/lon_step (نفس تحويل sst_values.json)،
    ويرجّعها كـ GeoJSON FeatureCollection من LineString.

    ملاحظة مهمة: لا نمثّل اليابسة برقم وهمي (كان هذا يسبب خط تدرّج مزيّف يلاصق
    الساحل، لأن الاستيفاء الخطي بين بكسل بحر حقيقي وبكسل يابسة بقيمة وهمية بعيدة
    يمرّ حتمًا عبر كل درجة بينهما). بدلاً من ذلك نستبعد خلايا اليابسة/الفراغ تمامًا
    من الحساب عبر معامل mask في find_contours.
    """
    # توسعة قناع اليابسة/الفراغ ببكسل واحد إضافي — يمنع أي خط من ملامسة الحافة تمامًا
    invalid = ~valid
    buffered_invalid = invalid.copy()
    buffered_invalid[:-1, :] |= invalid[1:, :]
    buffered_invalid[1:, :] |= invalid[:-1, :]
    buffered_invalid[:, :-1] |= invalid[:, 1:]
    buffered_invalid[:, 1:] |= invalid[:, :-1]
    mask = ~buffered_invalid  # True = خلية محسوبة فعليًا، False = مستبعدة كليًا من الكونتور

    valid_vals = real[mask]
    if valid_vals.size == 0:
        valid_vals = real[valid]  # حماية لشبكات صغيرة جدًا يلتهمها التوسيع بالكامل
    if valid_vals.size == 0:
        return {'type': 'FeatureCollection', 'features': []}

    lo = np.floor(valid_vals.min() / step) * step
    hi = np.ceil(valid_vals.max() / step) * step
    levels = np.arange(lo, hi + step / 2, step)

    features = []
    for level in levels:
        level = round(float(level), 2)
        try:
            contours = measure.find_contours(real, level, mask=mask)
        except Exception:
            continue
        for c in contours:
            # c: مصفوفة نقاط (row, col) كأرقام عشرية — نحوّلها لإحداثيات جغرافية
            coords = [
                [bounds['west'] + col * lon_step, bounds['north'] + row * lat_step]
                for row, col in c

            ]
            if len(coords) < 2:
                continue
            features.append({
                'type': 'Feature',
                'properties': {'temperature': level, 'units': 'celsius'},
                'geometry': {'type': 'LineString', 'coordinates': coords},
            })

    return {'type': 'FeatureCollection', 'features': features}


def process(nc_path, out_dir='.'):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_png = out_dir / 'sst.png'
    out_json = out_dir / 'sst_values.json'
    out_geojson = out_dir / 'tcont.geojson'

    # قراءة القيم الخام بدون فك تشفير CF التلقائي — نفس ما تفعله الأداة (تطبيق
    # scale_factor / add_offset / fill يدويًا بالقيم الثابتة أدناه)
    ds = xr.open_dataset(nc_path, decode_cf=False)

    all_names = list(ds.data_vars) + list(ds.coords)
    var_name = guess_var(list(ds.data_vars), VAR_CANDIDATES)
    lat_name = guess_var(all_names, LAT_CANDIDATES)
    lon_name = guess_var(all_names, LON_CANDIDATES)
    if not var_name or not lat_name or not lon_name:
        raise RuntimeError(f'تعذر اكتشاف المتغيرات تلقائيًا: var={var_name}, lat={lat_name}, lon={lon_name}. '
                            f'المتغيرات المتوفرة: {list(ds.variables)}')

    lat = np.asarray(ds[lat_name].values, dtype=np.float64)
    lon = np.asarray(ds[lon_name].values, dtype=np.float64)
    raw = np.asarray(ds[var_name].values, dtype=np.float64)
    while raw.ndim > 2:
        raw = raw[0]  # إسقاط بعد الزمن/العمق إن وجد

    row_a = coord_to_index(lat, BBOX['north'])
    row_b = coord_to_index(lat, BBOX['south'])
    row_start, row_end = sorted((row_a, row_b))
    north_is_smaller = row_a <= row_b

    col_a = coord_to_index(lon, BBOX['west'])
    col_b = coord_to_index(lon, BBOX['east'])
    col_start, col_end = sorted((col_a, col_b))
    west_is_smaller = col_a <= col_b

    row_idx = np.arange(row_start, row_end + 1) if north_is_smaller else np.arange(row_end, row_start - 1, -1)
    col_idx = np.arange(col_start, col_end + 1) if west_is_smaller else np.arange(col_end, col_start - 1, -1)
    out_h, out_w = len(row_idx), len(col_idx)

    nlat, nlon = raw.shape
    # نفس سلوك الأداة: بكسل خارج حدود الشبكة الفعلية يُعتبر "فارغ" وليس خطأ
    row_oob = (row_idx < 0) | (row_idx >= nlat)
    col_oob = (col_idx < 0) | (col_idx >= nlon)
    row_idx_safe = np.clip(row_idx, 0, nlat - 1)
    col_idx_safe = np.clip(col_idx, 0, nlon - 1)
    oob_mask = row_oob[:, None] | col_oob[None, :]

    cropped = raw[np.ix_(row_idx_safe, col_idx_safe)]

    is_fill = np.isclose(cropped, FILL_VALUE, atol=1e-6) | np.isnan(cropped) | oob_mask
    real = cropped * SCALE_FACTOR + ADD_OFFSET
    if TO_CELSIUS:
        real = real - 273.15
    valid = ~is_fill

    # ================= تمديد النسبة المئوية (Percentile Stretch) =================
    sea_vals = np.sort(real[valid]) if valid.any() else np.sort(real.flatten())
    n = len(sea_vals)
    vmin = sea_vals[int(np.floor((P_LOW / 100) * (n - 1)))]
    vmax = sea_vals[int(np.floor((P_HIGH / 100) * (n - 1)))]
    rng = max(1e-6, vmax - vmin)

    t = np.clip((real - vmin) / rng, 0, 1)
    t = np.power(t, GAMMA)
    if INVERT:
        t = 1 - t

    r, g, b = CMAPS[CMAP_NAME](t)
    if HIDE_LAND:
        a = np.where(valid, 255, 0).astype(np.uint8)
    else:
        r = np.where(valid, r, 20); g = np.where(valid, g, 20); b = np.where(valid, b, 22)
        a = np.full_like(r, 255, dtype=np.uint8)

    rgba = np.stack([r, g, b, a], axis=-1).astype(np.uint8)
    base_img = Image.fromarray(rgba, mode='RGBA')

    # ================= أعلى دقة تصدير ضمن 300KB (نفس منطق الأداة) =================
    chosen_bytes = None
    for scale in UPSCALE_CANDIDATES:
        w = max(1, round(out_w * scale))
        h = max(1, round(out_h * scale))
        resized = base_img.resize((w, h), Image.LANCZOS)
        buf = io.BytesIO()
        resized.save(buf, format='PNG', optimize=True)
        if buf.tell() <= MAX_BYTES:
            chosen_bytes = buf.getvalue()
            break
    if chosen_bytes is None:
        buf = io.BytesIO()
        base_img.resize((out_w, out_h), Image.LANCZOS).save(buf, format='PNG', optimize=True)
        chosen_bytes = buf.getvalue()

    out_png.write_bytes(chosen_bytes)

    # ================= sst_values.json (نفس بنية الأداة تمامًا) =================
    lat_step = (BBOX['south'] - BBOX['north']) / (out_h - 1 if out_h > 1 else 1)
    lon_step = (BBOX['east'] - BBOX['west']) / (out_w - 1 if out_w > 1 else 1)

    values = [
        [round(float(real[ri, ci]), 2) if valid[ri, ci] else None for ci in range(out_w)]
        for ri in range(out_h)
    ]
    payload = {
        'description': 'SST grid values (row 0 = north edge, col 0 = west edge)',
        'units': 'celsius' if TO_CELSIUS else 'raw',
        'bounds': BBOX,
        'width': out_w,
        'height': out_h,
        'lat_step': lat_step,
        'lon_step': lon_step,
        'values': values,
    }
    out_json.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')

    # ================= sst_contours.json (خطوط تساوي حرارة كل 0.5°) =================
    contours_geojson = generate_contours_geojson(real, valid, BBOX, lat_step, lon_step, CONTOUR_STEP)
    out_geojson.write_text(json.dumps(contours_geojson, ensure_ascii=False), encoding='utf-8')

    return {
        'png': str(out_png), 'json': str(out_json), 'contours': str(out_geojson),
        'var': var_name, 'lat_var': lat_name, 'lon_var': lon_name,
        'vmin': float(vmin), 'vmax': float(vmax), 'dims': (out_h, out_w),
        'png_size_kb': round(len(chosen_bytes) / 1024, 1),
        'contour_count': len(contours_geojson['features']),
    }


if __name__ == '__main__':
    nc_path = sys.argv[1] if len(sys.argv) > 1 else 'sst.nc'
    out_dir = sys.argv[2] if len(sys.argv) > 2 else '.'
    info = process(nc_path, out_dir)
    print(json.dumps(info, ensure_ascii=False, default=str, indent=2))
