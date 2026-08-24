"""
ssh_process.py
منطق مشترك لتحويل شبكة بيانات ارتفاع سطح البحر (SSH، netCDF من CMEMS DUACS)
إلى خطوط تساوي ارتفاع (GeoJSON) بنفس الصيغة التي يقرأها الموقع
(js/layers.js -> fetch('ssh.geojson'), كل feature فيه properties.level).

نفس منطق الكونتور تمامًا الموجود في ssh_levels.py المحلي (matplotlib.contour +
LEVEL_INTERVAL)، لكن بدون أي اعتماد على QGIS — يعمل headless داخل GitHub
Actions. يُستخدم من:
  - ssh_levels.py (سكربت QGIS المحلي)          -> يرسم الطبقة في QGIS أيضًا
  - ci_ssh_pipeline.py (السحابي عبر GitHub Actions) -> يولّد ssh.geojson فقط

الاستخدام المباشر (اختباري):
    python ssh_process.py /path/to/ssh.nc /path/to/ssh.geojson
"""

import json
import sys
from pathlib import Path

import numpy as np

# ================= الإعدادات الافتراضية (مطابقة لـ ssh_levels.py المحلي) =================
LEVEL_INTERVAL = 0.005  # الفاصل بين خطوط تساوي الارتفاع (بالمتر)

VAR_CANDIDATES = ["zos", "sla", "adt", "ssh"]
LAT_CANDIDATES = ["latitude", "lat", "nav_lat", "y"]
LON_CANDIDATES = ["longitude", "lon", "nav_lon", "x"]


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


def load_ssh(nc_path, lon_min, lon_max, lat_min, lat_max):
    """يقرأ متغير SSH من ملف netCDF ويقصّه على حدود المنطقة."""
    import xarray as xr

    ds = xr.open_dataset(nc_path, decode_times=False)

    var_name = guess_var(list(ds.data_vars), VAR_CANDIDATES)
    if var_name is None:
        ds.close()
        raise RuntimeError(
            "لم يجد متغير SSH في الملف. المتغيرات المتوفرة: " + str(list(ds.data_vars))
        )

    z = ds[var_name].squeeze().values.astype(float)
    while z.ndim > 2:
        z = z[0]

    lon = lat = None
    for c in ds.coords:
        cl = c.lower()
        if "lon" in cl:
            lon = ds[c].values
        elif "lat" in cl:
            lat = ds[c].values

    if lon is not None and lon.ndim == 1 and lat is not None:
        lon_mask = (lon >= lon_min) & (lon <= lon_max)
        lat_mask = (lat >= lat_min) & (lat <= lat_max)
        lon = lon[lon_mask]
        lat = lat[lat_mask]
        z = z[np.ix_(lat_mask, lon_mask)]

    ds.close()
    return z, lon, lat


def build_contours_geojson(z, lon, lat, lon_min, lon_max, lat_min, lat_max,
                            level_interval=LEVEL_INTERVAL):
    """يبني خطوط تساوي الارتفاع عبر matplotlib.contour (headless، Agg)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    z_min = float(np.nanmin(z))
    z_max = float(np.nanmax(z))
    levels = np.arange(
        np.floor(z_min / level_interval) * level_interval,
        np.ceil(z_max / level_interval) * level_interval + level_interval,
        level_interval,
    )

    fig, ax = plt.subplots()
    if lon is not None and lon.ndim == 1:
        cs = ax.contour(lon, lat, z, levels=levels)
    else:
        lo = np.linspace(lon_min, lon_max, z.shape[1])
        la = np.linspace(lat_min, lat_max, z.shape[0])
        cs = ax.contour(lo, la, z, levels=levels)
    plt.close(fig)

    features = []
    # allsegs مستقرة عبر كل إصدارات matplotlib (بخلاف .collections الملغاة حديثاً)
    for level, segs in zip(cs.levels, cs.allsegs):
        for coords_arr in segs:
            coords = coords_arr.tolist()
            if len(coords) < 2:
                continue
            features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": {"level": round(float(level), 4)},
            })

    geojson = {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "variable": "ssh",
            "min": round(z_min, 4),
            "max": round(z_max, 4),
            "interval": level_interval,
        },
    }
    return geojson, z_min, z_max, len(features)


def process(nc_path, out_geojson, lon_min, lon_max, lat_min, lat_max,
            level_interval=LEVEL_INTERVAL):
    """الدالة الرئيسية: ssh.nc -> ssh.geojson. تُستخدم من ci_ssh_pipeline.py."""
    z, lon, lat = load_ssh(nc_path, lon_min, lon_max, lat_min, lat_max)
    geojson, z_min, z_max, n = build_contours_geojson(
        z, lon, lat, lon_min, lon_max, lat_min, lat_max, level_interval
    )
    Path(out_geojson).write_text(json.dumps(geojson, ensure_ascii=False), encoding="utf-8")
    return {
        "min": z_min, "max": z_max,
        "contour_count": n,
        "path": str(out_geojson),
    }


if __name__ == "__main__":
    nc_path = sys.argv[1] if len(sys.argv) > 1 else "ssh.nc"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "ssh.geojson"
    info = process(nc_path, out_path, -0.43, 1.00, 35.70, 36.70)
    print(json.dumps(info, ensure_ascii=False, default=str, indent=2))
