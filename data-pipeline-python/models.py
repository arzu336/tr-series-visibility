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


# --- Ülke bazlı yerel popülerlik sıralaması (netflix_country_ranker.py,
# trends_country_ranker.py, country_score_engine.py) ---


class NetflixCountrySignal(BaseModel):
    show_title: str
    # Netflix'in kendi ayrımı: "Films" | "TV" (TV dizisi olmayanlar filtrelenir, bkz.
    # netflix_country_ranker.py). all-weeks-countries.tsv'de İZLENME SAATİ YOK — sadece
    # haftalık sıra (1-10) ve o ülkede Top 10'da kaldığı toplam hafta sayısı var. Saatlik/
    # görüntülenme verisi sadece GLOBAL dosyada mevcut, ülke kırılımında yok.
    category: Optional[str] = None
    weeks_in_top10: int
    peak_position: int
    latest_week: Optional[str] = None
    latest_rank: Optional[int] = None


class TrendsCountrySignal(BaseModel):
    show_title: str
    geo: str
    # SerpAPI/Google Trends tek seferde EN FAZLA 5 terimi karşılaştırabiliyor (doğrulandı —
    # 6. terimde "Maximum number of queries accepted is 5" hatası döner). Bu yüzden N>5
    # dizi karşılaştırılırken 5'erli gruplara bölünür, her grupta ORTAK BİR ÇAPA (anchor)
    # dizi tekrarlanır — çapa değeri gruplar arası normalize etmek için kullanılır (bkz.
    # trends_country_ranker.py compare_shows_interest). Normalize edilmemiş ham skorlar
    # SADECE aynı grup içinde karşılaştırılabilir, gruplar arası değil.
    avg_interest: float
    trend_direction: str  # "yükseliyor" | "düşüyor" | "sabit" | "yetersiz-veri"
    trend_change_pct: Optional[float] = None


class CountryLeaderboardEntry(BaseModel):
    show_title: str
    local_score: float
    netflix_signal: Optional[NetflixCountrySignal] = None
    trends_signal: Optional[TrendsCountrySignal] = None
    locally_available: bool
    # Skora katkıda bulunan gerçek kanıtların kısa, insan-okur özeti — "local_score: 62.3"
    # tek başına neye dayandığını göstermez, bu liste gösterir.
    evidence: list[str] = Field(default_factory=list)


class CountryLeaderboard(BaseModel):
    country_code: str
    country_name: str
    generated_at: datetime
    entries: list[CountryLeaderboardEntry]
    notes: list[str] = Field(default_factory=list)


class NetflixCountryRanking(BaseModel):
    """netflix_country_ranker.py'nin NetflixCountrySignal'ini TMDB kimliğiyle eşleyip
    kalıcı hale getiren, db.py'ye yazılan satır (bkz. netflix_pipeline.py). weeks_in_top10/
    peak_rank dışında bir 'toplam puan' YOK — Netflix'in ülke bazlı dosyasında izlenme
    saati/sayısı hiç yer almıyor (bkz. netflix_country_ranker.py modül docstring'i)."""

    country_iso2: str
    tmdb_id: int
    show_title: str
    matched_title: str
    weeks_in_top10: int
    peak_rank: int
    rank_score: float
    last_week_date: Optional[str] = None
    updated_at: datetime


class ReytingTvDailyRank(BaseModel):
    """reytingtv.com'un günlük Top 10 makalesinden çıkarılan tek bir satır — bkz.
    reytingtv_ranker.py. SAYISAL reyting/pay değeri YOK (sitenin kendisi TİAK kararı
    gereği bunları yayınlamadığını açıkça belirtiyor) — sadece o günkü SIRA (1-10)."""

    tmdb_id: int
    matched_title: str
    program_raw: str
    category: str  # "Total" | "AB" | "20+ABC1"
    rank: int
    rank_score: float
    air_date: date
    source_url: str
