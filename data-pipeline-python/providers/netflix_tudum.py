"""Netflix Top 10 (Tudum) sağlayıcısı — mevcut netflix_country_ranker/netflix_pipeline üzerine ince kabuk.

İndirme, tamlık ve eşleştirme mantığı o modüllerde kalır; burada yalnızca ortak ChartEntry biçimi
üretilir. Haftalık satırlar (iso2, hafta, tmdb_id, show_title, sıra) → provider 'netflix_tudum',
platform 'netflix', period_type 'week', segment 'TV'.
"""
from __future__ import annotations

import netflix_country_ranker as nf
from providers.base import ChartEntry, ChartProvider


def weekly_rows_to_entries(weekly_rows: list[tuple], fetched_at: str) -> list[ChartEntry]:
    return [
        ChartEntry(
            provider="netflix_tudum",
            platform="netflix",
            country_iso2=iso2,
            period_type="week",
            period_date=week,
            segment="TV",
            rank=int(rank),
            title_raw=show_title,
            series_id=tmdb_id,
            program_kind="series",
            source_url=nf.DATA_URL,
            fetched_at=fetched_at,
        )
        for iso2, week, tmdb_id, show_title, rank in weekly_rows
    ]


class NetflixTudumProvider(ChartProvider):
    name = "netflix_tudum"
    platform = "netflix"
    period_type = "week"
    terms = "Netflix Tudum kamuya açık TSV; robots.txt /tudum izinli; bot atlatma yok."

    def coverage(self) -> dict:
        return {"countries": "netflix_market_countries (pipeline_meta)", "period_type": "week", "since": "2021-07-04"}

    def fetch(self, **kwargs) -> list[ChartEntry]:
        raise NotImplementedError("Netflix satırları netflix_pipeline.sync_all içinde yazılır (bkz. weekly_rows_to_entries).")
