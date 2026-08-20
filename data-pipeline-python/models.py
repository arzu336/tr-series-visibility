"""Pydantic veri şemaları — dizilah_scraper.py ve imdb_dataset.py'nin ürettiği her
şey bu modellerden geçer. Amaç: iki kaynaktan gelen veri, projenin geri kalanına
(SQLite yazımı, exports/*.json) hep aynı, doğrulanmış şekilde ulaşsın.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field


class EpisodeRating(BaseModel):
    episode_number: int
    air_date: Optional[date] = None
    total_rating: Optional[float] = None
    total_share: Optional[float] = None
    ab_rating: Optional[float] = None
    ab_share: Optional[float] = None
    abc1_rating: Optional[float] = None
    abc1_share: Optional[float] = None


class DizilahSeriesInfo(BaseModel):
    slug: str
    title: Optional[str] = None
    channel: Optional[str] = None
    status: Optional[str] = None  # "Ended" | "Returning Series" | None (bilinmiyor)
    first_air_date: Optional[date] = None
    total_episodes: Optional[int] = None
    # Agregat topluluk skoru — KESİNLİKLE bireysel kullanıcı/yorum değil.
    average_rating: Optional[float] = None
    vote_count: Optional[int] = None
    episodes: list[EpisodeRating] = Field(default_factory=list)
    source_url: str
    fetched_at: datetime
    # Veri eksik/erişilemez olduğunda NEDEN eksik olduğunu açıkça taşır — sessizce
    # boş/uydurma veri dönmek yerine (bkz. dizilah_scraper.py'deki Cloudflare notu).
    status_note: Optional[str] = None


class LocalizedTitle(BaseModel):
    region: str
    title: str
    is_original: bool = False


class ImdbSeriesInfo(BaseModel):
    tconst: str
    primary_title: str
    original_title: str
    start_year: Optional[int] = None
    end_year: Optional[int] = None
    # Agregat: IMDb'nin global ortalama puanı + toplam oy sayısı. Ülke bazlı veya
    # bireysel yorum/puan YOK — non-commercial dataset bunu vermiyor.
    average_rating: Optional[float] = None
    num_votes: Optional[int] = None
    localized_titles: list[LocalizedTitle] = Field(default_factory=list)
    fetched_at: datetime
    # Kasıtlı olarak eksik bırakılan alan hakkında dürüst not: ülke bazlı İLK YAYIN
    # TARİHİ bu veri setinde yok (bkz. imdb_dataset.py modül docstring'i).
    note: Optional[str] = (
        "IMDb non-commercial dataset ülke bazlı ilk yayın tarihi içermiyor — sadece "
        "yerelleştirilmiş isim (title.akas) ve global ortalama puan (title.ratings) var."
    )
