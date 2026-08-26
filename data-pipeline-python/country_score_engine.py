"""Ülke sıralama ve kompozit skor motoru — netflix_country_ranker.py ve
trends_country_ranker.py'nin ürettiği sinyalleri birleştirir. Kendi başına hiçbir ağ
isteği YAPMAZ — saf bir birleştirme/skorlama fonksiyonu (iki veri kaynağından bağımsız,
kolayca test edilebilir).

Kompozit formül:
  Yerel Skor = (Netflix sıra puanı × 0.4) + (Trends ilgi endeksi × 0.4) + (Yerel yayın × 0.2)

Bir sinyal mevcut değilse (ör. dizi Netflix Top 10'a hiç girmemiş) o bileşen 0 sayılır VE
`evidence` alanında açıkça belirtilir — "veri yok" ile "gerçekten düşük ilgi" birbirine
karıştırılmaz.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from models import (
    CountryLeaderboard,
    CountryLeaderboardEntry,
    NetflixCountrySignal,
    TrendsCountrySignal,
)
from netflix_country_ranker import compute_rank_score

WEIGHTS = {"netflix": 0.4, "trends": 0.4, "local_availability": 0.2}


def _score_show(
    show_title: str,
    netflix_signal: Optional[NetflixCountrySignal],
    trends_signal: Optional[TrendsCountrySignal],
    locally_available: bool,
) -> CountryLeaderboardEntry:
    evidence: list[str] = []

    netflix_component = 0.0
    if netflix_signal:
        netflix_component = compute_rank_score(netflix_signal)
        evidence.append(
            f"Netflix Top 10: en iyi #{netflix_signal.peak_position}, {netflix_signal.weeks_in_top10} hafta"
        )
    else:
        evidence.append("Netflix Top 10'da veri yok")

    trends_component = 0.0
    if trends_signal:
        trends_component = trends_signal.avg_interest
        evidence.append(
            f"Google Trends ilgi endeksi: {trends_signal.avg_interest}/100 ({trends_signal.trend_direction})"
        )
    else:
        evidence.append("Google Trends verisi yok")

    availability_component = 100.0 if locally_available else 0.0
    evidence.append("Yerel yayın: var" if locally_available else "Yerel yayın: yok")

    local_score = round(
        netflix_component * WEIGHTS["netflix"]
        + trends_component * WEIGHTS["trends"]
        + availability_component * WEIGHTS["local_availability"],
        1,
    )

    return CountryLeaderboardEntry(
        show_title=show_title,
        local_score=local_score,
        netflix_signal=netflix_signal,
        trends_signal=trends_signal,
        locally_available=locally_available,
        evidence=evidence,
    )


def generate_country_leaderboard(
    country_code: str, country_name: str, show_list: list[dict]
) -> CountryLeaderboard:
    """show_list: [{"title": str, "netflix_signal": NetflixCountrySignal|None,
    "trends_signal": TrendsCountrySignal|None, "locally_available": bool}, ...] — her iki
    sinyal de önceden (netflix_country_ranker/trends_country_ranker ile) çekilmiş olmalı;
    bu fonksiyon ağa hiç çıkmaz, sadece birleştirir/sıralar."""
    entries = [
        _score_show(
            item["title"],
            item.get("netflix_signal"),
            item.get("trends_signal"),
            item.get("locally_available", False),
        )
        for item in show_list
    ]
    entries.sort(key=lambda e: e.local_score, reverse=True)

    notes = [
        "Netflix bileşeni gerçek izlenme saati değil, Top 10 sırasına dayalı türetilmiş bir puandır (ülke kırılımında saat verisi yok).",
        "Google Trends bileşeni arama ilgisine dayalı bir yakınsamadır (proxy), gerçek izlenme rakamı değildir.",
        "Ağırlıklar (0.4 / 0.4 / 0.2) sabit ve şeffaftır — WEIGHTS sözlüğünden değiştirilebilir.",
    ]

    return CountryLeaderboard(
        country_code=country_code,
        country_name=country_name,
        generated_at=datetime.now(timezone.utc),
        entries=entries,
        notes=notes,
    )
