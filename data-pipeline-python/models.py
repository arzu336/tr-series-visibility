"""Pydantic veri şemaları — dizilah_scraper.py ve imdb_dataset.py'nin ürettiği her
şey bu modellerden geçer. Amaç: iki kaynaktan gelen veri, projenin geri kalanına
(SQLite yazımı, exports/*.json) hep aynı, doğrulanmış şekilde ulaşsın.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


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


# --- Ülke bazlı Netflix Top 10 sinyali (netflix_country_ranker.py) ---


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


# --- Kanonik Kimlik Katmanı (identity.py) ------------------------------------------------
# SORUN: Dizilla, IMDb, Telegram, Wikipedia ve TMDB aynı diziyi farklı adlandırıyor
# ("Kuruluş Osman" / "Kuruluş: Osman" / "المؤسس عثمان (مسلسل)" / "Themelimi Osman").
# İsimden eşleştirme Latin dışı alfabelerde ve alt başlıklarda kırılıyor; yanlış eşleşen iki
# kayıt sessizce birleşir, analiz katmanı bunu "trend" diye okur ve hata bülten metnine kadar
# gider. Bu yüzden kanonik kimlik SADECE sert dış kimliklerden kurulur.
#
# ÖLÇÜLEN GERÇEK (60 dizilik TMDB örneği, canlı external_ids):
#     wikidata_id var : 47  (%78)
#     imdb_id var     : 57  (%95)
#     hiçbiri yok     :  3  (%5)
# Bu yüzden wikidata_id TEK BAŞINA birincil anahtar OLAMAZ — katalogun %22'si düşerdi
# (ayrıca null olabilen bir alan zaten PRIMARY KEY olamaz). Öncelik sırası korunuyor ama
# anahtar, sırayı KODLAYAN türetilmiş bir dizge: "wd:Q64878719" > "imdb:tt11712058" > "tmdb:95603".


class ResolutionTier(str, Enum):
    """Kimliğin hangi sertlikte bir dış anahtardan geldiği. Sıra = güvenilirlik sırası."""

    WIKIDATA = "wikidata"  # diller arası birleştirme mümkün (Wikipedia okunma katmanı buna bağlı)
    IMDB = "imdb"  # global olarak tekil ama dil sürümü bilgisi yok
    TMDB = "tmdb"  # yalnızca kendi kataloğumuz içinde anlamlı


class UnresolvedReason(str, Enum):
    NO_EXTERNAL_ID = "no_external_id"  # hiçbir sert kimlik yok
    NAME_ONLY = "name_only"  # kaynak yalnızca isim verdi (Dizilla slug, Telegram kanal adı)
    AMBIGUOUS = "ambiguous"  # birden fazla aday, aralarında seçim yapılamaz
    CONFLICT = "conflict"  # iki sert kimlik birbiriyle çelişiyor
    MALFORMED_ID = "malformed_id"  # kimlik biçimi geçersiz (Q123 / tt123 kalıbına uymuyor)


class CanonicalIdentity(BaseModel):
    """Tek bir içeriğin kanonik kimliği. canonical_id, öncelik sırasını kodlayan türetilmiş
    dizgedir — tahminle DEĞİL, yalnızca sert dış kimliklerden üretilir."""

    canonical_id: str
    tier: ResolutionTier
    wikidata_id: Optional[str] = None
    imdb_id: Optional[str] = None
    tmdb_id: Optional[int] = None
    primary_title: str
    resolved_at: datetime

    @field_validator("wikidata_id")
    @classmethod
    def _wikidata_bicimi(cls, v: Optional[str]) -> Optional[str]:
        # Bozuk kimliği sessizce kabul etmek, onu anahtar yapıp yanlış birleştirmek demek.
        if v is not None and not re.fullmatch(r"Q\d+", v):
            raise ValueError(f"geçersiz wikidata_id: {v!r} (Q<sayı> bekleniyor)")
        return v

    @field_validator("imdb_id")
    @classmethod
    def _imdb_bicimi(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not re.fullmatch(r"tt\d+", v):
            raise ValueError(f"geçersiz imdb_id: {v!r} (tt<sayı> bekleniyor)")
        return v


class UnresolvedRecord(BaseModel):
    """Kanonik kimliğe bağlanamayan kayıt. KESİNLİKLE SİLİNMEZ: 'drop' geri alınamaz ve
    denetlenemez — üç ay sonra 'neyi kaybettik' sorusu cevapsız kalır. Kuyruğa alınır,
    kaynak sonradan kimlik kazanırsa aynı kayıt yeniden çözülür."""

    source: str  # 'dizilla' | 'telegram' | 'wikipedia' | 'tmdb' | ...
    source_ref: str  # slug / kanal / satır kimliği — kaynakta geri bulunabilsin diye
    raw_title: str
    reason: UnresolvedReason
    # Aday listesi SADECE insan incelemesi içindir; otomatik birleştirmede ASLA kullanılmaz.
    candidates: list[str] = Field(default_factory=list)
    detail: Optional[str] = None
    seen_at: datetime
