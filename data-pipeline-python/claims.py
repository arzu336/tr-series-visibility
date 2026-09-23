"""Modül 3 — İddia Motoru (ClaimEngine).

Ham zaman serilerini alır, doğrulama kapılarından geçirir ve LLM'in üzerine strateji
kurabileceği `Claim` nesneleri üretir.

TEMEL İLKE: LLM SAYI ÜRETMEZ
----------------------------
Yüzde, taban ve pencere burada hesaplanır; AI Müşavir modülü bunları yalnızca seçer ve
yorumlar. Bu, halüsinasyon yüzeyini tüm veri setinden sonlu bir iddia listesine indirir.

KAPILAR
-------
Üçü şartnamede istendi, ikisi ölçümden doğdu:
  1. Volume Gate        — taban+güncel toplamı MIN_TOTAL_VOLUME altındaysa iddia yok.
  2. Zero-Baseline Gate — taban 0 ise yüzde TANIMSIZ (sonsuz), iddia kurulamaz.
     Near-Zero          — taban çok küçükse yüzde matematiksel olarak doğru ama anlamsız:
                          3 -> 9 "%200 artış" değildir, gürültüdür.
  3. Time-Window Gate   — her iki pencerede tam sayıda ay olmalı VE aylar takvimsel olarak
                          BİTİŞİK olmalı. Bitişiklik kontrolü kritik: seride bir ay eksikse
                          son N noktayı almak sessizce 5 aylık bir aralığı "3 ay" diye
                          raporlar. Bu, tam olarak bu katmanın engellemek için var olduğu
                          sessiz hata sınıfı.
  4. Effect-Size Gate   — %10'un altındaki değişim raporlanmaya değmez; bülteni gürültüyle
                          doldurur ve gerçek hareketleri gizler.
  5. Window-Stability   — pencere içinde medyandan 3 kattan fazla sapan ay varsa toplam o
                          pencereyi TEMSİL ETMEZ. Canlı veriyle yakalandı: fa.wikipedia'da
                          2026-04 komşularının dörtte biriydi ve üstüne kurulan iddialar
                          %280-620 arası sahte artışlar üretiyordu.

GÜVEN SKORU MATRİSİ
-------------------
`source_trust_level` (kaynağın sertliği) ile `confidence_score` (iddiaya ne kadar
güvenilebileceği) AYRI eksenlerdir:

    >= 2 resmi kaynak                    -> HIGH    (çapraz doğrulanmış)
    1 resmi + >= 1 gayriresmi kaynak     -> HIGH    (bağımsız kaynak teyit ediyor)
    tek resmi kaynak                     -> MEDIUM
    yalnızca gayriresmi (kaç tane olursa) -> LOW
Son satır bilinçli: iki korsan kaynağın aynı şeyi söylemesi bağımsız teyit DEĞİLDİR —
ikisi de aynı korsan izleyici kitlesini ölçer, yanlılıkları ortaktır.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Iterable, Optional

from claims_models import (
    CLAIM_NAMESPACE,
    Claim,
    CohortStats,
    ConfidenceScore,
    GeoKind,
    MetricPoint,
    MetricSeries,
    RejectedCandidate,
    RejectionReason,
    SourceTrustLevel,
    SupportingData,
)

# Wikipedia okunma katmanındaki (server/services/languageInterest.js) eşiklerle BİLEREK aynı:
# iki katman aynı veriye farklı eşiklerle baksaydı, panelde görünen bir hareket bültende
# yok sayılır ve tam tersi olurdu.
MIN_TOTAL_VOLUME = 500
MIN_WINDOW_MONTHS = 3
MIN_EFFECT_PCT = 10.0

# Taban bu değerin altındaysa yüzde matematiksel olarak doğru ama anlamsız.
NEAR_ZERO_BASELINE = 50.0

# Pencere içinde bir ay medyandan bu kattan fazla saparsa toplam temsili değildir
# (gerekçe: _aykiri_ay docstring'i — canlı fa.wikipedia 2026-04 çöküşü).
MAX_OUTLIER_RATIO = 3.0

# Bir kohort medyanının anlamlı olması için gereken en az dizi sayısı. Altında kalırsa
# medyan tek bir dizinin hareketini yansıtır ve düzeltme gürültü ekler — kohort uygulanmaz.
MIN_COHORT_SIZE = 5

# Coğrafi birimin insan-okur karşılığı. Dil ile ülkeyi aynı cümlede kullanmamak için
# iddia metni bu ayrımı AÇIKÇA taşır.
GEO_KIND_IFADE = {
    GeoKind.LANGUAGE: "{v} dilindeki Wikipedia sayfasında",
    GeoKind.COUNTRY: "{v} ülkesinde",
    GeoKind.REGION: "{v} bölgesinde",
    GeoKind.UNKNOWN: "genel toplamda",
}

METRIC_IFADE = {
    "views": "sayfa görüntülenmesi",
    "searches": "arama ilgisi",
    "telegram_forwards": "Telegram paylaşımı",
    "rating_delta": "reyting",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ay_etiketi(p: MetricPoint) -> str:
    return f"{p.year}-{p.month:02d}"


def _pencere_etiketi(baseline: list[MetricPoint], current: list[MetricPoint]) -> str:
    return (
        f"{_ay_etiketi(current[0])}..{_ay_etiketi(current[-1])} vs "
        f"{_ay_etiketi(baseline[0])}..{_ay_etiketi(baseline[-1])}"
    )


def _aykiri_ay(noktalar: list[MetricPoint], kat: float) -> Optional[MetricPoint]:
    """Pencere içinde medyandan `kat` katından fazla sapan ay varsa onu döndürür.

    CANLI VERİYLE YAKALANDI: Farsça Wikipedia'da 2026-04 komşularının dörtte biriydi
    (2026-03: 76.458 / 2026-04: 19.434 / 2026-05: 96.607) — büyük olasılıkla İran'daki
    bir erişim kesintisi. Aynı dönemde `tr` ve `ar` serilerinde böyle bir çöküş YOK, yani
    küresel bir Wikimedia sorunu değil, dile özgü.
    Bu çökük ay tabana girdiği için taban yapay olarak düşüyor ve ÜSTÜNE kurulan her iddia
    şişiyordu: %281, %450, %622 gibi "artışların" büyük kısmı gerçek yükseliş değil,
    bozuk tabanın ürünüydü.

    Medyan kullanılıyor çünkü ortalama, aykırı değerin kendisinden etkilenir. Kat eşiği
    gerçek büyümeyi elemeyecek kadar gevşek: düzenli yükselen bir seri ([10, 20, 30])
    medyandan en fazla 2 kat sapar, bu kapıdan geçer.
    """
    if len(noktalar) < 3:
        return None  # 2 noktada medyan aykırılık tespiti anlamsız
    degerler = sorted(p.value for p in noktalar)
    medyan = degerler[len(degerler) // 2]
    if medyan <= 0:
        return None  # sıfır taban ayrı bir kapının işi
    for p in noktalar:
        if p.value <= 0:
            continue
        oran = medyan / p.value if p.value < medyan else p.value / medyan
        if oran > kat:
            return p
    return None


def _pencereler(noktalar, pencere: int, as_of: date):
    """Tamamlanmamış ayı atıp (taban, güncel) pencerelerini döndürür; kurulamıyorsa None.

    Hem iddia üretimi hem kohort istatistiği BU fonksiyonu kullanır — pencere mantığının iki
    kopyası olsaydı kohort düzeltmesi başka bir aralığa uygulanabilirdi.
    """
    kapanis = as_of.year * 12 + (as_of.month - 1)
    sirali = sorted((p for p in noktalar if p.ordinal < kapanis), key=lambda p: p.ordinal)
    if len(sirali) < pencere * 2:
        return None
    current = sirali[-pencere:]
    baseline = sirali[-pencere * 2 : -pencere]
    if not _bitisik_mi(baseline + current):
        return None
    return baseline, current


def _bitisik_mi(noktalar: list[MetricPoint]) -> bool:
    """Aylar takvimsel olarak ardışık mı. Seride delik varsa son N nokta 3 ay değil
    5 aylık bir aralığı temsil ediyor olabilir — pencere etiketi yalan söyler."""
    ordinaller = [p.ordinal for p in noktalar]
    return all(b - a == 1 for a, b in zip(ordinaller, ordinaller[1:]))


def cohort_key(metric_type: str, geo_or_lang: str, geo_kind) -> str:
    """Kohort kimliği. `geo_kind` anahtara DAHİL: "fa" dil olarak ve "fa" ülke olarak aynı
    kohort değildir (bkz. claims_models.GeoKind)."""
    tur = getattr(geo_kind, "value", geo_kind)
    return f"{metric_type}|{geo_or_lang}|{tur}"


def build_cohort_stats(corpus, *, window_months=MIN_WINDOW_MONTHS, as_of=None, min_cohort_size=MIN_COHORT_SIZE):
    """Tüm korpustan (metrik, coğrafi birim) başına medyan çarpanı çıkarır.

    `corpus`: (canonical_id, [MetricSeries]) çiftlerinden oluşan yinelenebilir.

    Pencereler iddia üretimiyle AYNI yardımcıdan (`_pencereler`) geliyor — iki yerde ayrı
    hesaplanırsa kohort düzeltmesi yanlış pencereye uygulanır ve düzeltme bozuk olur.
    Medyan kullanılıyor: ortalama, kohortun içindeki tek bir uç değerden etkilenir.
    """
    motor_as_of = as_of or date.today()
    oranlar: dict[str, list[float]] = {}
    for _canonical_id, seriler in corpus:
        for seri in seriler:
            p = _pencereler(seri.points, window_months, motor_as_of)
            if p is None:
                continue
            baseline, current = p
            taban = sum(x.value for x in baseline)
            guncel = sum(x.value for x in current)
            if taban <= 0:
                continue
            oranlar.setdefault(cohort_key(seri.metric_type, seri.geo_or_lang, seri.geo_kind), []).append(guncel / taban)

    sonuc: dict[str, CohortStats] = {}
    for anahtar, degerler in oranlar.items():
        if len(degerler) < min_cohort_size:
            continue  # medyan anlamsız — kohort düzeltmesi uygulanmaz
        sirali = sorted(degerler)
        orta = len(sirali) // 2
        medyan = sirali[orta] if len(sirali) % 2 else (sirali[orta - 1] + sirali[orta]) / 2
        sonuc[anahtar] = CohortStats(key=anahtar, median_ratio=medyan, series_count=len(degerler))
    return sonuc


class ClaimEngine:
    def __init__(
        self,
        *,
        min_total_volume: float = MIN_TOTAL_VOLUME,
        min_window_months: int = MIN_WINDOW_MONTHS,
        min_effect_pct: float = MIN_EFFECT_PCT,
        near_zero_baseline: float = NEAR_ZERO_BASELINE,
        max_outlier_ratio: float = MAX_OUTLIER_RATIO,
        as_of: Optional[date] = None,
        exploratory: bool = False,
    ) -> None:
        self.min_total_volume = min_total_volume
        self.min_window_months = min_window_months
        self.min_effect_pct = min_effect_pct
        self.near_zero_baseline = near_zero_baseline
        self.max_outlier_ratio = max_outlier_ratio
        # KEŞİF MODU — kullanıcı kararı: "veri aksın ama sahte sayı bülten'e girmesin".
        # Kapılar SİLİNMEDİ, eşikler DEĞİŞMEDİ. Bu bayrak yalnızca kapıya takılan adayın ne
        # olacağını değiştirir: düşürülmek yerine `passed_gates=False` ile iddiaya dönüşür.
        # Varsayılan False — yani mevcut davranış bozulmaz, hiçbir çağıran etkilenmez.
        self.exploratory = exploratory
        # TAMAMLANMAMIŞ AY — canlı veriyle yakalanan gerçek bir hata:
        # 21 Eylül 2026'da üretilen iddialar Eylül'ü pencereye alıyordu. Wikimedia'nın
        # güncel ay verisi yalnızca eksik değil, CİDDİ GECİKMELİ de geliyor:
        #     2026-07  1.123.167
        #     2026-08  1.088.250
        #     2026-09     33.657   <- ayın %70'i geçmişken normal ayın %3'ü
        # Bu, ayın dörtte üçü geçmiş olmasına rağmen neredeyse boş bir ay demek ve her
        # iddiayı sistematik olarak AŞAĞI çekiyordu: üretilen 191 iddianın çoğu sahte
        # düşüştü (-%90'a varan). Aylık toplamlar ancak ay KAPANINCA karşılaştırılabilir.
        # (Aynı kural pipeline'da zaten var: backfill_reytingtv.py "mevcut takvim ayı hariç".)
        self.as_of = as_of or date.today()
        # Reddedilen adaylar SAYILIR. "Hiçbir hareket yok" ile "ölçemedik" farklı şeyler.
        self.rejected: list[RejectedCandidate] = []

    # --- Ana giriş noktası ---------------------------------------------------------
    def generate_claims(
        self,
        canonical_id: str,
        raw_metrics_time_series: Iterable[MetricSeries],
        *,
        window_months: Optional[int] = None,
        cohorts: Optional[dict] = None,
    ) -> list[Claim]:
        """Bir kanonik içerik için doğrulanmış iddialar üretir.

        Aynı (metrik, coğrafi birim) için birden fazla kaynak AYNI YÖNDE hareket
        gösteriyorsa tek bir iddiada birleştirilir ve güven skoru yükselir. Zıt yönde
        hareket gösteriyorlarsa birleştirilmez — çelişki gizlenmez, iki ayrı iddia kalır
        ve ikisi de kendi tek-kaynak güven skorunu taşır.
        """
        pencere = window_months or self.min_window_months
        adaylar = []
        for seri in raw_metrics_time_series:
            aday = self._evaluate(canonical_id, seri, pencere, cohorts or {})
            if aday is not None:
                adaylar.append(aday)

        return self._merge_and_score(canonical_id, adaylar)

    # --- Kapılar -------------------------------------------------------------------
    def _evaluate(self, canonical_id: str, seri: MetricSeries, pencere: int, cohorts: dict) -> Optional[dict]:
        """Bir seriyi kapılardan geçirir.

        VARSAYILAN MOD: ilk başarısız kapıda None döner — iddia üretilmez.
        KEŞİF MODU (`exploratory=True`): hiçbir kapı adayı düşürmez; hangi kapılara takıldığı
        toplanır ve iddia `passed_gates=False` + `failed_gates=[...]` ile üretilir. Kapı kodu
        AYNI kalır — eşikler değişmez, yalnızca sonucun ne yapıldığı değişir. Böylece
        "doğrulanmış" ile "ham" çıktı tek bir kod yolundan, aynı hesapla çıkar.

        Pencere kurulamıyorsa (eksik ay / delik) keşif modunda bile iddia ÜRETİLEMEZ: taban ve
        güncel pencere yoksa hesaplanacak bir şey de yoktur. Bu bir eşik değil, veri yokluğudur.
        """
        basarisiz: list[str] = []

        def reddet(reason: RejectionReason, detail: Optional[str] = None) -> bool:
            """Kapıya takılmayı kaydeder. Dönen değer: akış DURMALI mı?"""
            self.rejected.append(
                RejectedCandidate(
                    canonical_id=canonical_id,
                    metric_type=seri.metric_type,
                    source=seri.source,
                    geo_or_lang=seri.geo_or_lang,
                    reason=reason,
                    detail=detail,
                )
            )
            basarisiz.append(reason.value)
            return not self.exploratory

        # Tamamlanmamış takvim ayı ATILIR (gerekçe __init__'te) — keşif modunda da atılır:
        # yarım ay bir eşik meselesi değil, ölçümün henüz tamamlanmamış olmasıdır.
        kapanis_ordinali = self.as_of.year * 12 + (self.as_of.month - 1)
        sirali = sorted(
            (p for p in seri.points if p.ordinal < kapanis_ordinali),
            key=lambda p: p.ordinal,
        )

        # --- Time-Window Gate --- (keşif modunda da bağlayıcı: pencere yoksa hesap yok)
        if len(sirali) < pencere * 2:
            reddet(RejectionReason.WINDOW_INCOMPLETE, f"{len(sirali)} ay var, {pencere * 2} gerekli")
            return None

        current = sirali[-pencere:]
        baseline = sirali[-pencere * 2 : -pencere]

        if not _bitisik_mi(baseline + current):
            reddet(
                RejectionReason.WINDOW_GAP,
                f"{_ay_etiketi(baseline[0])}..{_ay_etiketi(current[-1])} aralığında eksik ay var",
            )
            return None

        # --- Window-Stability Gate ---
        for ad, pencere_noktalari in (("taban", baseline), ("güncel", current)):
            aykiri = _aykiri_ay(pencere_noktalari, self.max_outlier_ratio)
            if aykiri is not None:
                if reddet(
                    RejectionReason.WINDOW_UNSTABLE,
                    f"{ad} penceresinde aykırı ay: {_ay_etiketi(aykiri)}={aykiri.value:g}",
                ):
                    return None

        baseline_value = sum(p.value for p in baseline)
        current_value = sum(p.value for p in current)

        # --- Volume Gate ---
        if baseline_value + current_value < self.min_total_volume:
            if reddet(
                RejectionReason.VOLUME,
                f"toplam {baseline_value + current_value:g} < {self.min_total_volume:g}",
            ):
                return None

        # --- Zero-Baseline Gate ---
        # Sıfır taban tek istisna: KEŞİF MODUNDA BİLE yüzde üretilmez, çünkü 0'a bölme
        # matematiksel olarak tanımsızdır — "esnetilecek bir eşik" değil. Bunun yerine
        # change_pct None kalır ve from_zero bayrağı olayı taşır.
        from_zero = False
        if baseline_value == 0:
            from_zero = True
            if reddet(RejectionReason.ZERO_BASELINE, "taban 0 — yüzde tanımsız"):
                return None
        elif baseline_value < self.near_zero_baseline:
            if reddet(
                RejectionReason.NEAR_ZERO_BASELINE,
                f"taban {baseline_value:g} < {self.near_zero_baseline:g} — yüzde yapay",
            ):
                return None

        change_pct = (
            None if from_zero else round((current_value - baseline_value) / baseline_value * 100, 1)
        )

        # --- Effect-Size Gate ---
        if change_pct is not None and abs(change_pct) < self.min_effect_pct:
            if reddet(RejectionReason.EFFECT_TOO_SMALL, f"%{change_pct} < %{self.min_effect_pct}"):
                return None

        # --- Cohort Gate ---
        cohort_change_pct = None
        excess_change_pct = None
        cohort_series_count = None
        kohort = cohorts.get(cohort_key(seri.metric_type, seri.geo_or_lang, seri.geo_kind))
        if kohort is not None and kohort.median_ratio > 0 and baseline_value > 0:
            dizi_orani = current_value / baseline_value
            cohort_change_pct = round((kohort.median_ratio - 1) * 100, 1)
            excess_change_pct = round((dizi_orani / kohort.median_ratio - 1) * 100, 1)
            cohort_series_count = kohort.series_count
            if abs(excess_change_pct) < self.min_effect_pct:
                if reddet(
                    RejectionReason.COHORT_NEUTRAL,
                    f"kohortla birlikte hareket etti (dizi %{change_pct}, kohort %{cohort_change_pct}, "
                    f"sapma %{excess_change_pct}, n={kohort.series_count})",
                ):
                    return None

        return {
            "seri": seri,
            "baseline": baseline,
            "current": current,
            "baseline_value": baseline_value,
            "current_value": current_value,
            "change_pct": change_pct,
            "from_zero": from_zero,
            "failed_gates": basarisiz,
            "cohort_change_pct": cohort_change_pct,
            "excess_change_pct": excess_change_pct,
            "cohort_series_count": cohort_series_count,
        }

    # --- Birleştirme ve güven skoru ------------------------------------------------
    def _merge_and_score(self, canonical_id: str, adaylar: list[dict]) -> list[Claim]:
        gruplar: dict[tuple, list[dict]] = {}
        for a in adaylar:
            s = a["seri"]
            # Yön de anahtara dahil: zıt yönde hareket eden iki kaynak BİRLEŞTİRİLMEZ.
            # Sıfır tabanda yüzde yok; yön "sıfırdan çıkış" olarak ayrı bir grup.
            if a["change_pct"] is None:
                yon = "from_zero"
            else:
                yon = "up" if a["change_pct"] > 0 else "down"
            gruplar.setdefault((s.metric_type, s.geo_or_lang, s.geo_kind, yon), []).append(a)

        claims = []
        for (metric_type, geo, geo_kind, _yon), grup in sorted(gruplar.items(), key=lambda kv: str(kv[0])):
            kaynaklar = sorted(a["seri"].source for a in grup)
            trust_seviyeleri = {a["seri"].trust for a in grup}
            resmi = sum(1 for a in grup if a["seri"].trust is SourceTrustLevel.OFFICIAL)
            gayriresmi = len(grup) - resmi

            confidence = self._confidence(resmi, gayriresmi)
            # Karma kaynakta iddianın taşıdığı sertlik en ZAYIF halkadır — gayriresmi bir
            # kaynak karıştıysa bu gizlenmez.
            trust = (
                SourceTrustLevel.UNOFFICIAL_TELEMETRY
                if SourceTrustLevel.UNOFFICIAL_TELEMETRY in trust_seviyeleri
                else SourceTrustLevel.OFFICIAL
            )

            # Birden fazla kaynak varsa değerler kaynaklar arası ORTALANIR; toplanmaz
            # (farklı kaynakların ölçekleri aynı değil, toplamak anlamsız bir sayı üretir).
            baseline_value = sum(a["baseline_value"] for a in grup) / len(grup)
            current_value = sum(a["current_value"] for a in grup) / len(grup)
            yuzdeler = [a["change_pct"] for a in grup if a["change_pct"] is not None]
            change_pct = round(sum(yuzdeler) / len(yuzdeler), 1) if yuzdeler else None
            from_zero = any(a["from_zero"] for a in grup)
            # Kapı sonuçları kaynaklar arası BİRLEŞTİRİLİR: bir kaynak bile kapıya takıldıysa
            # birleşik iddia "doğrulanmış" sayılamaz.
            failed_gates = sorted({g for a in grup for g in a["failed_gates"]})
            # Kohort bilgisi kaynaklar arası aynı olmalı (aynı metrik+coğrafya kohortu),
            # temsilciden alınıyor.
            cohort_change_pct = grup[0].get("cohort_change_pct")
            excess_change_pct = grup[0].get("excess_change_pct")
            cohort_series_count = grup[0].get("cohort_series_count")

            # --- TELEMETRY-ONLY KAPISI -------------------------------------------------
            # Kullanıcı kararı: FlixPatrol / Telegram / korsan izleme gibi GAYRİRESMÎ
            # kaynaklardan türeyen iddialar bültene ve varsayılan arayüze SIZMAZ; yalnızca
            # keşif modunda erişilebilir. Kaynakların TAMAMI gayriresmîyse iddia doğrulanmış
            # sayılamaz — hiçbir bağımsız resmî kaynak onu teyit etmiyor demektir.
            #
            # Kapı `passed_gates`i düşürür, iddiayı SİLMEZ: keşif modunda veri yine elde.
            # Bir tek resmî kaynak eşlik ediyorsa (karma) kapı devreye girmez — o durumda
            # güven skoru zaten HIGH'a çıkıyor (bkz. _confidence).
            if trust is SourceTrustLevel.UNOFFICIAL_TELEMETRY and resmi == 0:
                failed_gates = sorted(set(failed_gates) | {RejectionReason.TELEMETRY_ONLY.value})
                self.rejected.append(
                    RejectedCandidate(
                        canonical_id=canonical_id,
                        metric_type=metric_type,
                        source=",".join(kaynaklar),
                        geo_or_lang=geo,
                        reason=RejectionReason.TELEMETRY_ONLY,
                        detail=f"yalnızca gayriresmî kaynak: {', '.join(kaynaklar)}",
                    )
                )
                # Varsayılan modda diğer kapılarla AYNI davranış: iddia hiç üretilmez.
                # Keşif modunda üretilir ama passed_gates=False taşır.
                if not self.exploratory:
                    continue

            temsilci = grup[0]
            window = _pencere_etiketi(temsilci["baseline"], temsilci["current"])
            claims.append(
                Claim(
                    claim_id=self._claim_id(canonical_id, metric_type, geo, window, kaynaklar),
                    canonical_id=canonical_id,
                    claim_text=self._metin(
                        metric_type, geo, geo_kind, change_pct, window, confidence,
                        cohort_change_pct, excess_change_pct, cohort_series_count,
                        from_zero, failed_gates,
                    ),
                    metric_type=metric_type,
                    sources=kaynaklar,
                    source_trust_level=trust,
                    window=window,
                    baseline_value=round(baseline_value, 2),
                    current_value=round(current_value, 2),
                    change_pct=change_pct,
                    from_zero=from_zero,
                    passed_gates=not failed_gates,
                    failed_gates=failed_gates,
                    cohort_change_pct=cohort_change_pct,
                    excess_change_pct=excess_change_pct,
                    cohort_series_count=cohort_series_count,
                    confidence_score=confidence,
                    geo_or_lang=geo,
                    geo_kind=geo_kind,
                    supporting_data=SupportingData(
                        baseline_points=temsilci["baseline"],
                        current_points=temsilci["current"],
                    ),
                    generated_at=_now(),
                )
            )
        return claims

    def _confidence(self, resmi: int, gayriresmi: int) -> ConfidenceScore:
        if resmi >= 2:
            return ConfidenceScore.HIGH
        if resmi == 1 and gayriresmi >= 1:
            return ConfidenceScore.HIGH
        if resmi == 1:
            return ConfidenceScore.MEDIUM
        return ConfidenceScore.LOW

    @staticmethod
    def _claim_id(canonical_id: str, metric_type: str, geo: str, window: str, kaynaklar: list[str]) -> str:
        """Deterministik: aynı girdi aynı kimliği üretir. uuid4 olsaydı her koşuda yeni
        kimlik doğar, aynı iddia bültene iki kez girer ve arşivde eşleşmezdi."""
        imza = "|".join([canonical_id, metric_type, geo, window, ",".join(kaynaklar)])
        return str(uuid.uuid5(CLAIM_NAMESPACE, imza))

    def _metin(
        self,
        metric_type: str,
        geo: str,
        geo_kind: GeoKind,
        change_pct: float,
        window: str,
        confidence: ConfidenceScore,
        cohort_change_pct: Optional[float] = None,
        excess_change_pct: Optional[float] = None,
        cohort_series_count: Optional[int] = None,
        from_zero: bool = False,
        failed_gates: Optional[list] = None,
    ) -> str:
        yer = GEO_KIND_IFADE[geo_kind].format(v=geo)
        metrik = METRIC_IFADE.get(metric_type, metric_type)
        if change_pct is None:
            # Sıfır tabandan çıkış: yüzde tanımsız ama olay gerçek ve raporlanabilir.
            cumle = (
                f"{yer} {metrik} {window} penceresinde SIFIRDAN ölçülebilir bir düzeye çıktı "
                f"(yüzde değişim tanımsız — taban sıfır)."
            )
        else:
            yon = "arttı" if change_pct > 0 else "azaldı"
            cumle = f"{yer} {metrik} {window} penceresinde %{abs(change_pct)} {yon}."
        # Kohort varsa ham yüzde TEK BAŞINA yanıltıcıdır — kohortun kendi hareketi ve diziden
        # sapması aynı cümlede verilir ki okuyan "bu dizi mi yükseldi, korpus mu" diye
        # sormak zorunda kalmasın.
        if cohort_change_pct is not None and excess_change_pct is not None:
            kohort_yon = "arttı" if cohort_change_pct > 0 else "azaldı"
            sapma_yon = "üzerinde" if excess_change_pct > 0 else "altında"
            cumle += (
                f" Aynı pencerede {geo} kohortunun tamamı ({cohort_series_count} dizi) "
                f"%{abs(cohort_change_pct)} {kohort_yon}; dizi kohort medyanının "
                f"%{abs(excess_change_pct)} {sapma_yon}."
            )
        # DOĞRULANMAMIŞ İDDİA: keşif modunda üretilmiş ve kapıya takılmış. Etiketi metnin
        # İÇİNDE taşınıyor — çıktı bir yerden kopyalanıp bağlamından koparılsa bile uyarı
        # onunla birlikte gidiyor.
        if failed_gates:
            cumle += f" ⚠ DOĞRULANMAMIŞ — geçemediği kapılar: {', '.join(failed_gates)}."
        if geo_kind is GeoKind.LANGUAGE:
            # Aşağı akıştaki en olası hata: dil sinyalini ülkeye çevirmek.
            cumle += " (Bu bir DİL sinyalidir, ülke kırılımı değildir.)"
        if confidence is ConfidenceScore.LOW:
            cumle += " (Tek gayriresmi/telemetri kaynağa dayanır.)"
        return cumle


# --- DIŞARI AÇILAN ÇIKTI SÖZLEŞMESİ ------------------------------------------------------------
# Kullanıcı kararı: doğrulanmamış iddialar arayüze, bültene ve LLM katmanına ASLA ulaşmayacak.
# Keşif modu çıktısı yalnızca iç analiz içindir.
#
# Bu sözleşme "tüketen taraf filtrelesin" şeklinde bırakılmadı: her yeni tüketici filtreyi
# hatırlamak zorunda kalırdı ve unutulan bir yer sessizce sahte sayı yayardı. Bunun yerine
# dışarı çıkış TEK BİR kapıdan geçiyor ve kapı varsayılan olarak kapalı.


class UnverifiedClaimError(Exception):
    """Doğrulanmamış bir iddia dışarı açılan bir yola verilmeye çalışıldı."""


def verified_only(claims: Iterable[Claim]) -> list[Claim]:
    """Yalnızca tüm kapılardan geçmiş iddialar. Arayüz/bülten/LLM yolunun TEK girişi."""
    return [c for c in claims if c.passed_gates]


def to_public_payload(claims: Iterable[Claim], *, strict: bool = True) -> list[dict]:
    """İddiaları dışarı verilebilir sözlüklere çevirir.

    `strict=True` (varsayılan): listede doğrulanmamış bir iddia varsa HATA verir — sessizce
    süzmek yerine. Sessiz süzme, çağıranın yanlış listeyi geçirdiğini fark etmesini engellerdi;
    keşif çıktısını yanlışlıkla bülten yoluna vermek gürültüsüz başarısız olmamalı.
    Bilinçli olarak süzmek isteyen `verified_only()` çağırır.
    """
    liste = list(claims)
    if strict:
        kirli = [c for c in liste if not c.passed_gates]
        if kirli:
            raise UnverifiedClaimError(
                f"{len(kirli)} doğrulanmamış iddia dışarı verilmek istendi "
                f"(ilk: {kirli[0].claim_id}, kapılar: {kirli[0].failed_gates}). "
                "Keşif çıktısı arayüze/bültene gönderilemez — önce verified_only() uygulayın."
            )
    else:
        liste = verified_only(liste)
    return [c.model_dump(mode="json") for c in liste]
