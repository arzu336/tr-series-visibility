"""Modül 3 — İddia Katmanı (Claims Engine) veri modelleri.

NEDEN AYRI BİR KATMAN
---------------------
AI Müşavir modülü ham sayılar üzerinde akıl yürütürse iki şey olur: (1) modelin halüsinasyon
yüzeyi tüm veri setidir — kendi yüzdesini kendisi uydurabilir, (2) çıktı denetlenemez, üç ay
sonra "bu iddia neye dayanıyordu" sorusu cevapsız kalır.

Bu katman aradaki sözleşmedir: LLM sayı ÜRETMEZ, yapılandırılmış ve doğrulama kapılarından
geçmiş `Claim` nesnelerini SEÇER ve yorumlar. Her iddia kendi kanıtını, kaynağını, penceresini
ve güven derecesini yanında taşır.

DİL Mİ ÜLKE Mİ — bu katmanın en kritik ayrımı
---------------------------------------------
Kaynaklar farklı coğrafi birimler ölçüyor:
    Wikipedia okunma  -> DİL   ("fa" = Farsça; İran mı Afganistan mı BELLİ DEĞİL)
    Google Trends     -> ÜLKE  ("TR" = Türkiye)
    Telegram/Dizilla  -> kanal/site düzeyi, coğrafyası çıkarımsal
Bunlar tek bir `geo_or_lang` dizgesinde tutulursa aşağı akışta ayırt edilemez ve bülten
"İran'da ilgi arttı" yazar — oysa elde yalnızca "Farsça'da arttı" vardır. `geo_kind` bu
karışmayı yapısal olarak engeller.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator

# İddia üretiminin deterministik olması için sabit ad alanı: aynı girdi -> aynı claim_id.
# uuid4 kullanılsaydı her koşu yeni kimlik üretir, aynı iddia bültene iki kez girer ve
# arşivde önceki sürümüyle eşleşmezdi.
CLAIM_NAMESPACE = uuid.UUID("6f1b6d2e-2a9f-5c3d-9e77-3c1f0a5b8d41")


class SourceTrustLevel(str, Enum):
    """Kaynağın sertlik derecesi. Güven skorundan AYRI bir eksen: bir iddia tek bir resmi
    kaynaktan gelebilir (official + MEDIUM) ya da üç korsan kaynaktan (unofficial + LOW)."""

    OFFICIAL = "official"  # Wikipedia, TMDB, IMDb, Google Trends — kimliği ve yöntemi açık
    UNOFFICIAL_TELEMETRY = "unofficial_telemetry"  # Dizilla, Telegram — korsan dağıtım kaynaklı


class ConfidenceScore(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class GeoKind(str, Enum):
    """`geo_or_lang` alanının NE olduğunu söyler. Bu ayrım olmadan dil ve ülke karışır."""

    LANGUAGE = "language"  # Wikipedia dil sürümü — ülkeye ÇEVRİLEMEZ
    COUNTRY = "country"  # ISO-3166 alfa-2
    REGION = "region"  # kaynak yalnızca bölge veriyorsa
    UNKNOWN = "unknown"  # coğrafi kırılım yok (global/toplam)


class RejectionReason(str, Enum):
    """Bir aday iddianın neden reddedildiği. Reddedilenler de sayılır ve raporlanır:
    "hiçbir hareket yok" ile "ölçemedik" farklı şeylerdir ve karışmamalıdır."""

    VOLUME = "volume"  # taban + güncel toplamı eşiğin altında
    ZERO_BASELINE = "zero_baseline"  # taban sıfır — yüzde tanımsız
    NEAR_ZERO_BASELINE = "near_zero_baseline"  # taban o kadar küçük ki yüzde yapay
    WINDOW_INCOMPLETE = "window_incomplete"  # pencerede eksik ay var
    WINDOW_GAP = "window_gap"  # pencere takvimsel olarak bitişik değil
    EFFECT_TOO_SMALL = "effect_too_small"  # değişim raporlanmaya değmeyecek kadar küçük
    WINDOW_UNSTABLE = "window_unstable"  # pencere içinde aykırı ay var — toplam temsili değil
    COHORT_NEUTRAL = "cohort_neutral"  # dizi kendi dil kohortuyla birlikte hareket etti
    TELEMETRY_ONLY = "telemetry_only"  # yalnızca gayriresmî/telemetri kaynağa dayanıyor


class MetricPoint(BaseModel):
    """Zaman serisinin tek bir aylık noktası."""

    year: int
    month: int
    value: float

    @field_validator("month")
    @classmethod
    def _ay_araligi(cls, v: int) -> int:
        if not 1 <= v <= 12:
            raise ValueError(f"ay 1-12 aralığında olmalı: {v}")
        return v

    @property
    def ordinal(self) -> int:
        """Takvimsel bitişikliği kontrol edebilmek için ay sırası (yıl*12+ay)."""
        return self.year * 12 + (self.month - 1)


class MetricSeries(BaseModel):
    """Tek bir kaynaktan, tek bir coğrafi/dilsel birim için gelen zaman serisi."""

    metric_type: str  # "views" | "searches" | "telegram_forwards" | "rating_delta" ...
    source: str  # "wikipedia:fa" | "telegram:channel_x" | "dizilla:views"
    trust: SourceTrustLevel
    geo_or_lang: str  # "fa" | "so" | "TR"
    geo_kind: GeoKind
    points: list[MetricPoint] = Field(default_factory=list)


class CohortStats(BaseModel):
    """Bir (metrik, coğrafi birim) kohortunun toplu hareketi.

    NEDEN GEREKLİ — canlı veriyle yakalandı: 51 Farsça dizinin 50'si aynı pencerede 3 kattan
    fazla büyüdü (kohort medyanı 4,23x). Aynı dönemde tr 0,96x, ar 1,30x, ru 0,88x, es 0,93x.
    Yani 50 dizi birden İran'da popüler olmadı — fa.wikipedia korpusunun TAMAMI kaydı.
    Dizi bazlı hiçbir kapı bunu yakalayamaz çünkü her iddia tek tek bakıldığında geçerlidir;
    sorun toplu düzeydedir. Kohort medyanı, "bu dizi kendi kohortundan ayrıştı mı" sorusunu
    sorulabilir hale getirir.
    """

    key: str  # "views|fa|language"
    median_ratio: float  # kohortun medyan (güncel / taban) çarpanı
    series_count: int


class SupportingData(BaseModel):
    """İddianın arkasındaki ham noktalar — bülten üç ay sonra denetlenebilsin diye.
    Bu alan olmadan 'yeniden üretilebilirlik' iddiası boştur."""

    baseline_points: list[MetricPoint]
    current_points: list[MetricPoint]


class Claim(BaseModel):
    claim_id: str
    canonical_id: str
    claim_text: str
    metric_type: str
    sources: list[str]
    source_trust_level: SourceTrustLevel
    window: str  # "2026-06..2026-08 vs 2026-03..2026-05"
    baseline_value: float
    current_value: float
    # KEŞİF MODU: sıfır tabanda yüzde TANIMSIZDIR (0'a bölme). Uydurma bir sayı üretmek
    # yerine None kalır ve `from_zero` bayrağı "sıfırdan bir şeye çıktı" bilgisini taşır —
    # bu gerçek bir olaydır, yalnızca yüzde olarak ifade edilemez.
    change_pct: Optional[float] = None
    from_zero: bool = False

    # --- Doğrulama kapısı sonucu -------------------------------------------------------
    # Varsayılan modda üretilen her iddia tüm kapılardan geçmiştir (passed_gates=True).
    # Keşif modunda kapıya takılan adaylar da iddiaya dönüşür ama passed_gates=False olur ve
    # hangi kapılara takıldığı `failed_gates`te taşınır.
    #
    # TÜKETEN TARAFIN SÖZLEŞMESİ: bülten, LLM özeti ve karar destek çıktıları YALNIZCA
    # passed_gates=True olanları kullanır. Keşif çıktısı ayrı bir bölümde, "doğrulanmamış"
    # etiketiyle gösterilir.
    passed_gates: bool = True
    failed_gates: list[str] = Field(default_factory=list)

    # Kohort bağlamı. `cohort_change_pct` kohortun kendi hareketi, `excess_change_pct` ise
    # dizinin ondan SAPMASI — bülten metni bunu kullanmalı. Kohort verilmediyse ikisi de None
    # kalır ve iddia mutlak (kohortsuz) okunur.
    cohort_change_pct: Optional[float] = None
    excess_change_pct: Optional[float] = None
    cohort_series_count: Optional[int] = None
    confidence_score: ConfidenceScore
    geo_or_lang: str
    geo_kind: GeoKind
    supporting_data: SupportingData
    generated_at: datetime

    @property
    def direction(self) -> str:
        """Yön. Sıfır tabanda yüzde yok ama yön VAR: sıfırdan bir şeye çıkmak artıştır."""
        if self.change_pct is None:
            return "artis" if self.from_zero else "belirsiz"
        return "artis" if self.change_pct > 0 else "dusus"


class RejectedCandidate(BaseModel):
    """Kapılardan geçemeyen aday. Sessizce düşürülmez — sayılır ve raporlanır."""

    canonical_id: str
    metric_type: str
    source: str
    geo_or_lang: str
    reason: RejectionReason
    detail: Optional[str] = None
