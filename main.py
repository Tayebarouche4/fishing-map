"""
سيرفر الحماية - مشروع خريطة الصيد
Fishing Map Backend - FastAPI
"""

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
import gspread
from google.oauth2.service_account import Credentials
import os
from datetime import datetime
import json

app = FastAPI(title="Fishing Map API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://tayebarouche4.github.io",
        "http://localhost:3000",
        "http://127.0.0.1:5500",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

API_KEY = os.environ.get("FISHING_API_KEY", "change-this-secret-key")

def verify_api_key(x_api_key: str = Header(...)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="مفتاح API غير صحيح")
    return x_api_key

def get_sheet():
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if not creds_json:
        raise HTTPException(status_code=500, detail="GOOGLE_CREDENTIALS_JSON غير موجود")
    creds_data = json.loads(creds_json)
    scopes = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive"
    ]
    creds = Credentials.from_service_account_info(creds_data, scopes=scopes)
    client = gspread.authorize(creds)
    SHEET_ID = os.environ.get("SHEET_ID", "")
    if not SHEET_ID:
        raise HTTPException(status_code=500, detail="SHEET_ID غير موجود")
    return client.open_by_key(SHEET_ID).sheet1

@app.get("/")
def root():
    return {
        "status": "السيرفر يعمل",
        "project": "Fishing Map - Oran/Mostaganem",
        "time": datetime.now().isoformat()
    }

@app.get("/api/status")
def server_status():
    return {
        "online": True,
        "version": "1.0.0",
        "protected": True,
        "time": datetime.now().isoformat()
    }

@app.get("/api/reports", dependencies=[Depends(verify_api_key)])
def get_fishermen_reports():
    try:
        sheet = get_sheet()
        records = sheet.get_all_records()
        clean_records = []
        for row in records:
            clean_records.append({
                "date":   row.get("date",   row.get("التاريخ", "")),
                "time":   row.get("time",   row.get("الوقت", "")),
                "code":   row.get("code",   row.get("الكود", "")),
                "lat":    row.get("lat",    row.get("خط العرض", "")),
                "lon":    row.get("lon",    row.get("خط الطول", "")),
                "rating": row.get("rating", row.get("التقييم", "")),
                "boxes":  row.get("boxes",  row.get("الصناديق", "")),
            })
        return {"status": "success", "count": len(clean_records), "data": clean_records}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/reports/add", dependencies=[Depends(verify_api_key)])
async def add_fisherman_report(report: dict):
    try:
        sheet = get_sheet()
        date        = report.get("date",   datetime.now().strftime("%Y-%m-%d"))
        time        = report.get("time",   datetime.now().strftime("%H:%M"))
        code        = report.get("code",   "")
        lat         = report.get("lat",    "")
        lon         = report.get("lon",    "")
        report_type = report.get("reportType", "rating")

        if report_type == "correction":
            new_row = [
                date, time, code, lat, lon,
                report.get("obstacleType", report.get("note", "")),
                report.get("extra", ""),
                "تصحيح"
            ]
        else:
            new_row = [
                date, time, code, lat, lon,
                report.get("rating", ""),
                report.get("boxes",  ""),
                "صيد"
            ]

        sheet.append_row(new_row)
        return {"status": "success", "message": "تم إضافة التقرير بنجاح"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
