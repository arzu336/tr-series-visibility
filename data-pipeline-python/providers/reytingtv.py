"""reytingtv.com sağlayıcısı — Türkiye TV günlük Top 10, TAM liste (Total / AB / 20+ABC1).

Mevcut reytingtv_ranker yalnızca kataloğa eşleşen dizileri saklıyordu; bu sağlayıcı her satırı
ChartEntry olarak döner: eşleşen dizi → series_id + 'series'; eşleşmeyen → 'other' (haber, yarışma,
spor sezgiseli) ya da 'unknown'. Kurallar: robots.txt `Disallow:` boş (2026-09-30 doğrulandı),
istekler arası REQUEST_DELAY_S, tek User-Agent, bot atlatma yok.
"""
from __future__ import annotations

import time
from datetime import date
from pathlib import Path
from typing import Optional

import requests

import reytingtv_ranker as rtv
from providers.base import ChartEntry, ChartProvider, classify_program_kind


def parse_article_to_entries(
    html: str, air_date: date, source_url: str, series_index, fetched_at: str
) -> list[ChartEntry]:
    out: list[ChartEntry] = []
    for category, rows in rtv.parse_article(html).items():
        for rank, program_raw in rows:
            entry = rtv.match_series(program_raw, series_index)
            sid = entry.tmdb_id if entry else None
            out.append(
                ChartEntry(
                    provider="reytingtv",
                    platform="tv",
                    country_iso2="TR",
                    period_type="day",
                    period_date=air_date.isoformat(),
                    segment=category,
                    rank=int(rank),
                    title_raw=program_raw,
                    series_id=sid,
                    program_kind=classify_program_kind(program_raw, sid),
                    source_url=source_url,
                    fetched_at=fetched_at,
                )
            )
    return out


class ReytingTvProvider(ChartProvider):
    name = "reytingtv"
    platform = "tv"
    period_type = "day"
    terms = "reytingtv.com robots.txt: Disallow boş; sayısal reyting yayımlanmaz, yalnızca sıra."

    def __init__(self, node_app_db_path: Path, request_delay_s: float = rtv.REQUEST_DELAY_S):
        self.node_app_db_path = node_app_db_path
        self.request_delay_s = request_delay_s

    def coverage(self) -> dict:
        return {"countries": ["TR"], "period_type": "day", "since": "2021-10-20"}

    def fetch(
        self,
        session: Optional[requests.Session] = None,
        limit: Optional[int] = None,
        since: Optional[date] = None,
        fetched_at: str = "",
        progress_every: int = 50,
        **kwargs,
    ) -> list[ChartEntry]:
        """Sitemap'teki reyting makalelerini tarar; `since` verilirse yalnızca o tarihten sonraki günler."""
        session = session or requests.Session()
        session.headers["User-Agent"] = rtv.USER_AGENT
        series_index = rtv.load_tmdb_series_index(self.node_app_db_path)
        articles = rtv.fetch_sitemap_article_urls(session)
        dated = []
        for url, published_at in articles:
            air_date = rtv._extract_date_from_slug(url, published_at)
            if air_date is None:
                continue
            if since and air_date < since:
                continue
            dated.append((url, air_date))
        if limit:
            dated = dated[:limit]
        out: list[ChartEntry] = []
        for i, (url, air_date) in enumerate(dated):
            if progress_every and i % progress_every == 0:
                rtv.log.info(f"reytingtv: {i}/{len(dated)} makale, {len(out)} satır")
            try:
                resp = session.get(url, timeout=30)
                resp.raise_for_status()
            except requests.RequestException as exc:
                rtv.log.warning(f"{url} alınamadı, atlanıyor: {exc}")
                continue
            finally:
                time.sleep(self.request_delay_s)
            out.extend(parse_article_to_entries(resp.text, air_date, url, series_index, fetched_at))
        return out
