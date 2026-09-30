"""Ortak liste sözleşmesi. Tüm sağlayıcılar `ChartEntry` üretir; `db.save_chart_entries` tek tabloya yazar.

program_kind: 'series' (kataloğa eşleşen Türk dizisi) | 'other' (haber, yarışma, spor, magazin —
liste bağlamı için tutulur, "yalnızca diziler" süzgeci varsayılan olarak gizler) | 'unknown'
(eşleşmeyen; katalog dışı bir dizi olabilir). 'other' sınıflaması anahtar kelime sezgiselidir
(aşağıda), kesin değildir; arayüz süzgeç kapatıldığında hepsini gösterir.
"""
from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

PROGRAM_KINDS = ("series", "other", "unknown")

# Türkiye TV Top 10'da sık görülen dizi-dışı program kalıpları (haber, yarışma, spor, magazin, talk, sinema).
# Hem Türkçe hem ASCII'ye düşürülmüş yazımlar (reytingtv eski makalelerde "MUGE ANLI", "MILYONER" yazar).
# "(ÖZET)" burada DEĞİL: bir dizinin özet yayını dizidir; arayüz adına "(özet)" ekler.
_OTHER_PATTERNS = re.compile(
    r"(HABER|BÜLTEN|BULTEN|MASTERCHEF|SURVIVOR|SURVİVOR|EXATLON|O SES|GÜLDÜR|GULDUR|MİLYONER|MILYONER|"
    r"ÇARKIFELEK|CARKIFELEK|YARIŞMA|YARISMA|MAÇ|MACI|FUTBOL|DERBİ|DERBI|UEFA|SÜPER LİG|SUPER LIG|"
    r"ŞAMPİYON|SAMPIYON|MİLLİ|MILLI|SPOR|BASKETBOL|VOLEYBOL|KARŞILAŞMA|KARSILASMA|KUPA|"
    r"MÜGE ANLI|MUGE ANLI|ESRA EROL|GELİNİM MUTFAKTA|GELINIM MUTFAKTA|KISMETSE OLUR|DOYA DOYA MODA|"
    r"İBO SHOW|IBO SHOW|BEYAZ SHOW|MAGAZİN|MAGAZIN|TALK|PROGRAM|YETENEK|DİDEM ARSLAN|DIDEM ARSLAN|ZAHİDE|ZAHIDE|"
    r"SABAH|GÜNAYDIN|GUNAYDIN|KUŞAĞI|KUSAGI|SICAK GELİŞME|SICAK GELISME|İFTAR|IFTAR|RAMAZAN|KONSER|"
    r"ÖDÜL|ODUL|TÖREN|TOREN|\(T\.S\)|\(Y\.S\)|SİNEMA|SINEMA|FİLM|FILM|ŞARKILAR|SARKILAR|TAŞ KAĞIT|TAS KAGIT)"
)

# Bundan uzun "başlık" bir program adı değil, ayrıştırıcının yanlışlıkla aldığı makale özetidir.
_MAX_TITLE_LEN = 90


def classify_program_kind(program_raw: str, matched_series_id: Optional[int]) -> str:
    """Kalıp önce gelir: MasterChef Türkiye TMDB kataloğunda bir 'dizi' olarak bulunsa da yarışmadır.
    Katalog eşleşmesi yalnızca kalıba takılmayan adlar için 'series' verir."""
    text = (program_raw or "").upper()
    if len(text) > _MAX_TITLE_LEN:
        return "unknown"
    if _OTHER_PATTERNS.search(text):
        return "other"
    if matched_series_id is not None:
        return "series"
    return "unknown"


@dataclass(frozen=True)
class ChartEntry:
    provider: str  # 'netflix_tudum' | 'reytingtv' | 'flixpatrol' | ...
    platform: str  # 'netflix' | 'tv' | ...
    country_iso2: str
    period_type: str  # 'day' | 'week'
    period_date: str  # ISO gün (günlük) ya da hafta sonu Pazar tarihi (haftalık)
    segment: str  # 'TV' (Netflix kategorisi) | 'Total' | 'AB' | '20+ABC1'
    rank: int
    title_raw: str
    series_id: Optional[int] = None
    program_kind: str = "unknown"
    metric_value: Optional[float] = None
    metric_unit: Optional[str] = None
    source_url: str = ""
    fetched_at: str = ""

    def as_row(self) -> tuple:
        return (
            self.provider, self.platform, self.country_iso2, self.period_type, self.period_date, self.segment,
            self.rank, self.series_id, self.title_raw, self.program_kind, self.metric_value, self.metric_unit,
            self.source_url, self.fetched_at,
        )


class ChartProvider(ABC):
    """Bir liste kaynağı. `enabled` False ise zamanlayıcı ve CLI atlar (yapılandırma eksikliği hata değildir)."""

    name: str = ""
    platform: str = ""
    period_type: str = "week"
    terms: str = ""  # robots.txt / kullanım koşulu notu — arayüzde kaynak etiketiyle gösterilir

    @property
    def enabled(self) -> bool:
        return True

    @abstractmethod
    def coverage(self) -> dict:
        """{'countries': [...] | 'TR', 'period_type': ..., 'since': 'YYYY-MM-DD' | None}"""

    @abstractmethod
    def fetch(self, **kwargs) -> list[ChartEntry]:
        """Kaynaktan liste satırlarını döner. Ağ hatasında istisna fırlatabilir; çağıran loglar."""
