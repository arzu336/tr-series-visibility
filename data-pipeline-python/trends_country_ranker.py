"""SerpApi Google Trends ülke bazlı karşılaştırma motoru — server/serpapi.js/regional-interest.js
ile aynı desen (google_trends engine), buradaki fark: TEK bir ülkeye (`geo`) sabitlenip
BİRDEN FAZLA dizi adı aynı anda karşılaştırılıyor (data_type=TIMESERIES, çoklu q).

DOĞRULANMIŞ SINIR (2026-08-20, gerçek SerpApi çağrısıyla test edildi): Google Trends tek
seferde EN FAZLA 5 terimi karşılaştırabiliyor — 6. terimde SerpApi açıkça
"Maximum number of queries accepted is 5" hatası döndürüyor. 5'ten fazla dizi karşılaştırılmak
istendiğinde 5'erli gruplara bölünüyor; her grupta ORTAK BİR ÇAPA (anchor) dizi tekrarlanıyor
ve grup içi 0-100 değerler bu çapaya göre normalize ediliyor — aksi halde iki farklı grubun
"100"ü birbirine kıyaslanamaz (her grubun 0-100 skalası SADECE o gruptaki en yüksek terime
göredir).
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

from models import TrendsCountrySignal

MAX_TERMS_PER_QUERY = 5
RISING_THRESHOLD_PCT = 5
FALLING_THRESHOLD_PCT = -5


def _serpapi_get(params: dict, api_key: str) -> dict:
    url = "https://serpapi.com/search.json"
    res = requests.get(url, params={**params, "api_key": api_key}, timeout=30)
    if not res.ok:
        if res.status_code == 429:
            raise RuntimeError("SerpAPI aylık kota dolmuş görünüyor (429).")
        raise RuntimeError(f"SerpAPI isteği başarısız ({res.status_code})")
    data = res.json()
    if data.get("error"):
        raise RuntimeError(f"SerpAPI hatası: {data['error']}")
    return data


def _trend_direction(timeline: list[dict], show_title: str) -> tuple[str, Optional[float]]:
    """Zaman serisinin ilk yarısı ile ikinci yarısının ortalamasını kıyaslar — projedeki
    diğer trend hesaplamalarıyla (server/history.js) aynı ±%5 eşiği kullanır. <4 veri
    noktası varsa dürüstçe 'yetersiz-veri' döner, uydurma bir yön göstermez."""
    values = []
    for point in timeline:
        for v in point.get("values", []):
            if v.get("query") == show_title:
                values.append(v.get("extracted_value", 0))
    if len(values) < 4:
        return "yetersiz-veri", None

    mid = len(values) // 2
    first_half = sum(values[:mid]) / mid
    second_half = sum(values[mid:]) / (len(values) - mid)
    if first_half == 0:
        return ("yükseliyor" if second_half > 0 else "sabit"), None

    change_pct = round(((second_half - first_half) / first_half) * 100, 1)
    if change_pct >= RISING_THRESHOLD_PCT:
        return "yükseliyor", change_pct
    if change_pct <= FALLING_THRESHOLD_PCT:
        return "düşüyor", change_pct
    return "sabit", change_pct


def _query_batch(show_titles: list[str], geo: str, timeframe: str, api_key: str) -> dict:
    data = _serpapi_get(
        {
            "engine": "google_trends",
            "q": ",".join(show_titles),
            "geo": geo,
            "date": timeframe,
            "data_type": "TIMESERIES",
            "hl": "tr",
        },
        api_key,
    )
    timeline = data.get("interest_over_time", {}).get("timeline_data", [])
    averages = {
        a["query"]: a["value"] for a in data.get("interest_over_time", {}).get("averages", [])
    }
    return {"timeline": timeline, "averages": averages}


def compare_shows_interest(
    show_titles: list[str], geo: str, api_key: str, timeframe: str = "today 12-m"
) -> list[TrendsCountrySignal]:
    """5'ten fazla dizi varsa 5'erli gruplara böler; ilk dizi her grupta ÇAPA olarak
    tekrarlanır. İlk grupta çapanın ham değeri baz alınır (anchor_baseline); sonraki
    gruplarda çapanın o gruptaki değeri baz alınıp diğer değerler
    `deger * (anchor_baseline / grup_icindeki_capa_degeri)` ile normalize edilir. Çapanın
    kendi değeri 0 çıkarsa (ilgi yok) o grup normalize edilemez, ham değerler NOT'lanarak
    (bkz. çağıran tarafın loglaması) olduğu gibi bırakılır."""
    if not show_titles:
        return []

    anchor = show_titles[0]
    others = show_titles[1:]
    batches = [others[i : i + MAX_TERMS_PER_QUERY - 1] for i in range(0, len(others), MAX_TERMS_PER_QUERY - 1)] or [[]]

    results: list[TrendsCountrySignal] = []
    anchor_baseline: Optional[float] = None

    for batch_titles in batches:
        group = [anchor, *batch_titles]
        batch = _query_batch(group, geo, timeframe, api_key)
        anchor_value = batch["averages"].get(anchor)

        if anchor_baseline is None:
            anchor_baseline = anchor_value or 0.0

        scale = 1.0
        if anchor_value and anchor_baseline:
            scale = anchor_baseline / anchor_value

        for title in group:
            if any(r.show_title == title for r in results):
                continue  # çapa her grupta tekrarlanıyor, tekilleştir
            raw = batch["averages"].get(title, 0)
            normalized = round(raw * scale, 1)
            direction, change_pct = _trend_direction(batch["timeline"], title)
            results.append(
                TrendsCountrySignal(
                    show_title=title,
                    geo=geo,
                    avg_interest=normalized,
                    trend_direction=direction,
                    trend_change_pct=change_pct,
                )
            )

    return results
