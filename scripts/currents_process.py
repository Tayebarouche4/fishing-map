"""
currents_process.py
نسخة من منطق currents_full.py (تحويل التيار لسهام متجهة) بدون أي اعتماد على
QGIS — لأتمتة كاملة (محليًا أو عبر GitHub Actions). يعيد إنتاج _load_currents
و_build_arrows و_export_geojson من currents_full.py حرفيًا بدون أي تغيير في
الرياضيات أو الألوان أو العتبات، ويتجاهل فقط خطوة الرسم داخل QGIS
(_draw_arrows) التي تبقى حصرية للاستخدام اليدوي داخل برنامج QGIS نفسه.

الاستخدام:
    from currents_process import process
    info = process("C:/fishing_data/archive/2026-08-22")
    # info = {"current-1.nc": {...}, "current-50.nc": {...}}
"""

import json
import math
import os
from datetime import datetime

import numpy as np

LON_MIN, LON_MAX = -0.43, 1.00
LAT_MIN, LAT_MAX = 35.70, 36.70

SHAFT_LEN = 0.015
HEAD_LEN  = 0.005
HEAD_W    = 0.003
SHAFT_W   = 0.001

LAYERS = [
    {
        "file":      "current-1.nc",
        "label":     "تيار السطح 1م",
        "layer_key": "surface",
    },
    {
        "file":      "current-50.nc",
        "label":     "تيار الأعماق 50م",
        "layer_key": "deep",
    },
]


def _load_currents(nc_path):
    import xarray as xr

    ds = xr.open_dataset(nc_path, decode_times=False)

    u = None
    for name in ["uo", "u", "U", "eastward_sea_water_velocity"]:
        if name in ds:
            u = ds[name].squeeze().values.astype(float)
            while u.ndim > 2:
                u = u[0]
            break

    v = None
    for name in ["vo", "v", "V", "northward_sea_water_velocity"]:
        if name in ds:
            v = ds[name].squeeze().values.astype(float)
            while v.ndim > 2:
                v = v[0]
            break

    if u is None or v is None:
        raise RuntimeError("لم يجد متغيرات التيار (uo/vo) في " + nc_path)

    lon = None
    lat = None
    for c in ds.coords:
        if "lon" in c.lower():
            lon = ds[c].values
        elif "lat" in c.lower():
            lat = ds[c].values

    if lon is not None and lon.ndim == 1:
        lon_mask = (lon >= LON_MIN) & (lon <= LON_MAX)
        lat_mask = (lat >= LAT_MIN) & (lat <= LAT_MAX)
        lon = lon[lon_mask]
        lat = lat[lat_mask]
        u   = u[np.ix_(lat_mask, lon_mask)]
        v   = v[np.ix_(lat_mask, lon_mask)]

    ds.close()
    return u, v, lon, lat


def _build_arrows(u, v, lon, lat):
    target  = u.shape
    spd     = np.sqrt(u**2 + v**2)
    spd_max = float(np.nanpercentile(spd, 99)) + 1e-10

    if lon is not None and lon.ndim == 1:
        LON, LAT = np.meshgrid(lon, lat)
    else:
        lo = np.linspace(LON_MIN, LON_MAX, target[1])
        la = np.linspace(LAT_MIN, LAT_MAX, target[0])
        LON, LAT = np.meshgrid(lo, la)

    arrows = []

    for row in range(target[0]):
        for col in range(target[1]):
            uu      = float(u[row, col])
            vv      = float(v[row, col])
            spd_val = math.sqrt(uu**2 + vv**2)

            if spd_val < 0.001 or math.isnan(spd_val):
                continue

            clon = float(LON[row, col])
            clat = float(LAT[row, col])

            dx = uu / spd_val
            dy = vv / spd_val
            px = -dy
            py =  dx

            dir_deg = round((math.degrees(math.atan2(uu, vv)) + 360) % 360, 1)

            shaft = [
                [clon + px * SHAFT_W,                      clat + py * SHAFT_W],
                [clon + dx * SHAFT_LEN + px * SHAFT_W,     clat + dy * SHAFT_LEN + py * SHAFT_W],
                [clon + dx * SHAFT_LEN - px * SHAFT_W,     clat + dy * SHAFT_LEN - py * SHAFT_W],
                [clon - px * SHAFT_W,                      clat - py * SHAFT_W],
                [clon + px * SHAFT_W,                      clat + py * SHAFT_W],
            ]

            mx   = clon + dx * SHAFT_LEN
            my   = clat + dy * SHAFT_LEN
            tipx = clon + dx * (SHAFT_LEN + HEAD_LEN)
            tipy = clat + dy * (SHAFT_LEN + HEAD_LEN)

            head = [
                [tipx,                tipy],
                [mx + px * HEAD_W,    my + py * HEAD_W],
                [mx - px * HEAD_W,    my - py * HEAD_W],
                [tipx,                tipy],
            ]

            ratio = spd_val / spd_max
            if ratio >= 0.6:
                stype = "قوي"
            elif ratio >= 0.3:
                stype = "متوسط"
            else:
                stype = "ضعيف"

            arrows.append({
                "shaft":   shaft,
                "head":    head,
                "speed":   round(spd_val, 4),
                "dir_deg": dir_deg,
                "type":    stype,
            })

    return arrows


def _export_geojson(arrows, layer_cfg, date_str, day_dir):
    features = []
    for a in arrows:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [[a["shaft"]], [a["head"]]],
            },
            "properties": {
                "speed":   a["speed"],
                "dir_deg": a["dir_deg"],
                "type":    a["type"],
            },
        })

    geojson = {"type": "FeatureCollection", "date": date_str, "features": features}

    out_name = layer_cfg["file"].replace(".nc", ".geojson").replace("-", "")
    out_path = os.path.join(day_dir, out_name)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, separators=(",", ":"))

    return out_path, len(features)


def process(day_dir, date_str=None, only=None):
    """
    يعالج current-1.nc و current-50.nc الموجودين في day_dir، وينتج
    current1.geojson و current50.geojson في نفس المجلد. يفترض إن الملفين
    الخام موجودين مسبقًا (نتاج download_currents.py).
    only: قائمة أسماء ملفات .nc لتقييد المعالجة (مثلاً ["current-1.nc"] فقط).
    """
    if date_str is None:
        date_str = datetime.now().strftime("%Y-%m-%d")

    layers = [l for l in LAYERS if only is None or l["file"] in only]

    results = {}
    for layer_cfg in layers:
        nc_path = os.path.join(day_dir, layer_cfg["file"])
        if not os.path.exists(nc_path):
            results[layer_cfg["file"]] = {"error": "الملف غير موجود: " + nc_path}
            continue

        u, v, lon, lat = _load_currents(nc_path)
        arrows = _build_arrows(u, v, lon, lat)
        out_path, count = _export_geojson(arrows, layer_cfg, date_str, day_dir)

        results[layer_cfg["file"]] = {
            "geojson": out_path,
            "arrow_count": count,
            "shape": u.shape,
        }

    return results


if __name__ == "__main__":
    import sys
    day_dir_arg = sys.argv[1] if len(sys.argv) > 1 else "."
    date_arg = sys.argv[2] if len(sys.argv) > 2 else None
    info = process(day_dir_arg, date_arg)
    print(json.dumps(info, ensure_ascii=False, default=str, indent=2))
