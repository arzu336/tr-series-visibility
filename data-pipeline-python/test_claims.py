"""Modül 3 — İddia Katmanı testleri.

Buradaki sayılar UYDURMA DEĞİL: Wikipedia Pageviews API'sinden canlı çekilmiş gerçek
ölçümlere dayanır (Kuruluş Osman, fa.wikipedia: önceki 3 ay 6.929 -> son 3 ay 10.081,
yani %45,5 artış — aynı hesap server/services/languageInterest.js'te de yapılıyor).

ZAMAN BAĞIMSIZLIĞI: Motor "tamamlanmamış takvim ayı"nı pencereden atıyor ve bu karar
`date.today()`'e bakıyor. Testler gerçek bugüne bağlı kalsaydı takvim ilerledikçe
fixture'lar sessizce başka kapılara takılmaya başlardı — nitekim bir kez başladı. Bu yüzden
her motor SABIT_AS_OF ile kuruluyor.
"""
from __future__ import annotations

from datetime import date

import pytest

from claims import ClaimEngine
from claims_models import (
    ConfidenceScore,
    GeoKind,
    MetricPoint,
    MetricSeries,
    RejectionReason,
    SourceTrustLevel,
)

# 2026 Eylül'ün ortası: Eylül tamamlanmamış sayılır, Ağustos ve öncesi geçerlidir.
SABIT_AS_OF = date(2026, 9, 21)


def motor(**kw) -> ClaimEngine:
    """Determinist motor fabrikası — aksi belirtilmedikçe sabit 'bugün' ile kurar."""
    kw.setdefault("as_of", SABIT_AS_OF)
    return ClaimEngine(**kw)


def seri(
    degerler: list[float],
    *,
    source: str = "wikipedia:fa",
    trust: SourceTrustLevel = SourceTrustLevel.OFFICIAL,
    geo: str = "fa",
    geo_kind: GeoKind = GeoKind.LANGUAGE,
    metric: str = "views",
    baslangic: tuple[int, int] = (2026, 1),
    atla: set[int] | None = None,
) -> MetricSeries:
    """degerler[i] -> baslangic'tan i ay sonrası.

    Varsayılan başlangıç 2026-01: 6 değerli bir seri 2026-01..2026-06 olur, yani
    tamamlanmamış-ay filtresine takılmaz ve kapılar izole test edilebilir.
    `atla` verilen indeksleri ÜRETMEZ — seride kasıtlı delik açmak için.
    """
    yil, ay = baslangic
    noktalar = []
    for i, v in enumerate(degerler):
        if atla and i in atla:
            continue
        noktalar.append(
            MetricPoint(year=yil + (ay - 1 + i) // 12, month=(ay - 1 + i) % 12 + 1, value=v)
        )
    return MetricSeries(
        metric_type=metric,
        source=source,
        trust=trust,
        geo_or_lang=geo,
        geo_kind=geo_kind,
        points=noktalar,
    )


# --- Mutlu yol ---------------------------------------------------------------------
class TestHappyPath:
    def test_gercek_olcumden_iddia_uretilir(self):
        # fa.wikipedia Kuruluş Osman: 2310+2309+2310 = 6929 -> 3360+3360+3361 = 10081
        claims = motor().generate_claims(
            "wd:Q64878719", [seri([2310, 2309, 2310, 3360, 3360, 3361])]
        )
        assert len(claims) == 1
        c = claims[0]
        assert c.baseline_value == 6929
        assert c.current_value == 10081
        assert c.change_pct == 45.5
        assert c.confidence_score is ConfidenceScore.MEDIUM  # tek resmi kaynak
        assert c.source_trust_level is SourceTrustLevel.OFFICIAL
        assert c.window == "2026-04..2026-06 vs 2026-01..2026-03"

    def test_kanit_iddiayla_birlikte_tasinir(self):
        c = motor().generate_claims(
            "wd:Q64878719", [seri([2310, 2309, 2310, 3360, 3360, 3361])]
        )[0]
        assert len(c.supporting_data.baseline_points) == 3
        assert len(c.supporting_data.current_points) == 3
        assert sum(p.value for p in c.supporting_data.current_points) == c.current_value
        assert sum(p.value for p in c.supporting_data.baseline_points) == c.baseline_value

    def test_claim_id_deterministik(self):
        # Aynı girdi iki kez çalıştırılınca aynı kimlik üretilmeli, yoksa aynı iddia
        # bültene iki kez girer ve arşivde önceki sürümüyle eşleşmez.
        girdi = [seri([1000, 1000, 1000, 2000, 2000, 2000])]
        a = motor().generate_claims("wd:Q1", girdi)[0]
        b = motor().generate_claims("wd:Q1", girdi)[0]
        assert a.claim_id == b.claim_id

    def test_farkli_icerik_farkli_kimlik_uretir(self):
        a = motor().generate_claims("wd:Q1", [seri([1000] * 3 + [2000] * 3)])[0]
        b = motor().generate_claims("wd:Q2", [seri([1000] * 3 + [2000] * 3)])[0]
        assert a.claim_id != b.claim_id

    def test_dusus_de_iddiadir(self):
        c = motor().generate_claims("wd:Q1", [seri([3000, 3000, 3000, 1000, 1000, 1000])])[0]
        assert c.change_pct == -66.7
        assert c.direction == "dusus"
        assert "azaldı" in c.claim_text


# --- TAMAMLANMAMIŞ AY: canlı veriyle yakalanan hata --------------------------------
class TestIncompleteMonthGate:
    """21 Eylül 2026'da üretilen iddialar Eylül'ü pencereye alıyordu. Wikimedia'nın
    güncel ay verisi ciddi gecikmeli geliyor (2026-08: 1.088.250 -> 2026-09: 33.657,
    yani normal ayın %3'ü). Sonuç: 191 iddianın çoğu SAHTE DÜŞÜŞTÜ."""

    # Mart..Eylül. Eylül kasıtlı olarak çok düşük — gerçekte olduğu gibi yarım/gecikmeli.
    MART_EYLUL = [2310, 2309, 2310, 3360, 3360, 3361, 100]

    def test_yarim_ay_pencereye_ALINMAZ(self):
        c = motor().generate_claims(
            "wd:Q64878719", [seri(self.MART_EYLUL, baslangic=(2026, 3))]
        )[0]
        assert "2026-09" not in c.window
        assert c.window == "2026-06..2026-08 vs 2026-03..2026-05"

    def test_yarim_ay_ALINSAYDI_sahte_dusus_uretirdi(self):
        # Filtre olmasaydı pencere Nisan..Eylül olurdu: taban 7979, güncel 6821 -> -%14,5.
        # Yani gerçekte %45,5 ARTAN bir seri, DÜŞÜŞ diye raporlanırdı.
        # (Kararlılık kapısı bu yarım ayı zaten aykırı görüp reddediyor — aritmetiği
        #  açıkça göstermek için burada bilerek gevşetiliyor.)
        filtresiz = motor(as_of=date(2026, 12, 1), max_outlier_ratio=10_000)
        c_hatali = filtresiz.generate_claims(
            "wd:Q64878719", [seri(self.MART_EYLUL, baslangic=(2026, 3))]
        )[0]
        assert c_hatali.change_pct < 0  # sahte düşüş

        c_dogru = motor().generate_claims(
            "wd:Q64878719", [seri(self.MART_EYLUL, baslangic=(2026, 3))]
        )[0]
        assert c_dogru.change_pct == 45.5  # gerçek yön

    def test_kararlilik_kapisi_IKINCI_savunma_hatti(self):
        # Tamamlanmamış-ay filtresi bir şekilde devre dışı kalsa bile (yanlış as_of,
        # farklı kaynak), yarım ay pencereye girdiğinde kararlılık kapısı onu yakalar.
        m = motor(as_of=date(2026, 12, 1))
        assert m.generate_claims("wd:Q1", [seri(self.MART_EYLUL, baslangic=(2026, 3))]) == []
        assert m.rejected[0].reason is RejectionReason.WINDOW_UNSTABLE


# --- Pencere kararlılığı: fa.wikipedia 2026-04 çöküşüyle yakalandı -----------------
class TestWindowStabilityGate:
    """Farsça Wikipedia'da 2026-04 komşularının dörtte biriydi (76.458 / 19.434 / 96.607),
    muhtemelen İran'daki bir erişim kesintisi. `tr` ve `ar`'da böyle bir çöküş yoktu.
    Bu çökük ay tabana girince üstüne kurulan iddialar %280-620 arası SAHTE artış
    üretiyordu."""

    # Gerçek fa.wikipedia toplamları: Mart..Ağustos 2026.
    FA_GERCEK = [76458, 19434, 96607, 323921, 263644, 255049]

    def test_cokuk_ay_tabanda_iddia_URETILMEZ(self):
        m = motor()
        assert m.generate_claims("wd:Q1", [seri(self.FA_GERCEK, baslangic=(2026, 1))]) == []
        assert m.rejected[0].reason is RejectionReason.WINDOW_UNSTABLE
        assert "2026-02" in m.rejected[0].detail  # çökük ay işaretleniyor

    def test_kapati_gevsetince_SAHTE_artis_ortaya_cikar(self):
        # Kapı olmasaydı ne raporlanacaktı: 192.499 -> 842.614 = +%337,7
        gevsek = motor(max_outlier_ratio=10_000)
        c = gevsek.generate_claims("wd:Q1", [seri(self.FA_GERCEK, baslangic=(2026, 1))])[0]
        assert c.change_pct > 300  # bozuk tabanın ürettiği şişkin yüzde

    def test_duzenli_buyume_ELENMEZ(self):
        # Kapı gerçek büyümeyi kesmemeli: [1000,1500,2000] medyandan en fazla 2 kat sapar.
        assert len(motor().generate_claims(
            "wd:Q1", [seri([1000, 1500, 2000, 2500, 3000, 3500])]
        )) == 1

    def test_ani_ama_TUTARLI_sicrama_gecer(self):
        # Taban da güncel de kendi içinde kararlı — sıçrama pencereler ARASINDA.
        # Bu gerçek bir olaydır ve raporlanmalıdır.
        c = motor().generate_claims("wd:Q1", [seri([1000, 1000, 1000, 5000, 5000, 5000])])[0]
        assert c.change_pct == 400.0

    def test_guncel_penceredeki_aykiri_da_yakalanir(self):
        # Kapı yalnızca tabanı değil, güncel pencereyi de korur.
        m = motor()
        assert m.generate_claims("wd:Q1", [seri([1000, 1000, 1000, 2000, 50, 2000])]) == []
        assert m.rejected[0].reason is RejectionReason.WINDOW_UNSTABLE
        assert "güncel" in m.rejected[0].detail

    def test_kapanmis_aylar_normal_islenir(self):
        # Filtre yalnızca İÇİNDE BULUNULAN ayı atmalı, geçmişi budamamalı.
        c = motor().generate_claims("wd:Q1", [seri([1000] * 3 + [2000] * 3, baslangic=(2025, 1))])[0]
        assert c.window == "2025-04..2025-06 vs 2025-01..2025-03"


# --- Sıfır taban kapısı (şartname maddesi) -----------------------------------------
class TestZeroBaselineGate:
    def test_sifir_taban_sahte_trend_uretmez(self):
        m = motor()
        assert m.generate_claims("wd:Q1", [seri([0, 0, 0, 5000, 5000, 5000])]) == []
        assert m.rejected[0].reason is RejectionReason.ZERO_BASELINE

    def test_cok_kucuk_taban_yapay_sicrama_uretmez(self):
        # 1 -> 400 matematiksel olarak %39.900 ama gürültü. Hacim kapısına takılmasın diye
        # güncel değer yüksek tutuldu: kapıların SIRASI da test ediliyor.
        m = motor()
        assert m.generate_claims("wd:Q1", [seri([1, 1, 1, 400, 400, 400])]) == []
        assert m.rejected[0].reason is RejectionReason.NEAR_ZERO_BASELINE

    def test_saglikli_taban_gecer(self):
        assert len(motor().generate_claims("wd:Q1", [seri([100, 100, 100, 300, 300, 300])])) == 1


# --- Hacim kapısı (şartname maddesi) -----------------------------------------------
class TestVolumeGate:
    def test_dusuk_hacim_elenir(self):
        m = motor()
        # toplam 60 + 120 = 180 < 500
        assert m.generate_claims("wd:Q1", [seri([20, 20, 20, 40, 40, 40])]) == []
        assert m.rejected[0].reason is RejectionReason.VOLUME

    def test_esigin_hemen_ustu_gecer(self):
        # 150 + 450 = 600 >= 500, taban 150 >= 50
        assert len(motor().generate_claims("wd:Q1", [seri([50, 50, 50, 150, 150, 150])])) == 1

    def test_esik_ayarlanabilir(self):
        m = motor(min_total_volume=100)
        assert len(m.generate_claims("wd:Q1", [seri([20, 20, 20, 40, 40, 40])])) == 1


# --- Zaman penceresi kapısı (şartname maddesi) -------------------------------------
class TestTimeWindowGate:
    def test_eksik_ay_reddedilir(self):
        m = motor()
        assert m.generate_claims("wd:Q1", [seri([1000, 1000, 1000, 2000])]) == []  # 4 ay, 6 gerekli
        assert m.rejected[0].reason is RejectionReason.WINDOW_INCOMPLETE

    def test_pencerede_DELIK_varsa_reddedilir(self):
        # En sinsi hata: 7 aylık seriden ortadaki ay eksik. Son 6 noktayı almak
        # 7 aylık aralığı "3+3 ay" diye raporlar — pencere etiketi yalan söyler.
        m = motor()
        sonuc = m.generate_claims(
            "wd:Q1", [seri([1000, 1000, 1000, 1000, 2000, 2000, 2000], atla={3})]
        )
        assert sonuc == []
        assert m.rejected[0].reason is RejectionReason.WINDOW_GAP

    def test_bitisik_seri_gecer(self):
        assert len(motor().generate_claims("wd:Q1", [seri([1000] * 3 + [2000] * 3)])) == 1

    def test_pencere_uzunlugu_ayarlanabilir(self):
        claims = motor().generate_claims(
            "wd:Q1", [seri([1000, 1000, 3000, 3000])], window_months=2
        )
        assert len(claims) == 1
        assert claims[0].window == "2026-03..2026-04 vs 2026-01..2026-02"


# --- Etki büyüklüğü ----------------------------------------------------------------
class TestEffectSizeGate:
    def test_kucuk_degisim_bulteni_kirletmez(self):
        m = motor()
        assert m.generate_claims("wd:Q1", [seri([1000, 1000, 1000, 1030, 1030, 1030])]) == []  # %3
        assert m.rejected[0].reason is RejectionReason.EFFECT_TOO_SMALL


# --- Güven skoru matrisi (şartname maddesi) ----------------------------------------
class TestConfidenceScoring:
    def test_tek_resmi_kaynak_MEDIUM(self):
        c = motor().generate_claims("wd:Q1", [seri([1000] * 3 + [2000] * 3)])[0]
        assert c.confidence_score is ConfidenceScore.MEDIUM
        assert c.source_trust_level is SourceTrustLevel.OFFICIAL

    def test_tek_korsan_telemetri_kaynak_LOW(self):
        # TELEMETRY_ONLY kapısı yalnız-telemetri iddialarını VARSAYILAN modda düşürüyor
        # (kullanıcı kararı: bültene/arayüze sızmasın). Güven matrisi keşif modunda test
        # edilir — kapı güven skorunu değiştirmiyor, yalnızca nereye gidebileceğini sınırlıyor.
        c = motor(exploratory=True).generate_claims(
            "wd:Q1",
            [
                seri(
                    [1000] * 3 + [2000] * 3,
                    source="telegram:kanal_x",
                    trust=SourceTrustLevel.UNOFFICIAL_TELEMETRY,
                )
            ],
        )[0]
        assert c.confidence_score is ConfidenceScore.LOW
        assert c.source_trust_level is SourceTrustLevel.UNOFFICIAL_TELEMETRY
        # Bülten metni kaynağın zayıflığını GİZLEMEMELİ.
        assert "gayriresmi" in c.claim_text
        # Ve varsayılan yoldan GEÇEMEZ.
        assert c.passed_gates is False
        assert "telemetry_only" in c.failed_gates

    def test_iki_resmi_kaynak_HIGH(self):
        claims = motor().generate_claims(
            "wd:Q1",
            [
                seri([1000] * 3 + [2000] * 3, source="wikipedia:fa"),
                seri([1000] * 3 + [2000] * 3, source="trends:fa"),
            ],
        )
        assert len(claims) == 1  # aynı yön -> tek iddiada birleşti
        assert claims[0].confidence_score is ConfidenceScore.HIGH
        assert claims[0].sources == ["trends:fa", "wikipedia:fa"]

    def test_resmi_arti_telemetri_HIGH_ama_trust_ZAYIF_halkayi_gosterir(self):
        c = motor().generate_claims(
            "wd:Q1",
            [
                seri([1000] * 3 + [2000] * 3, source="wikipedia:fa"),
                seri(
                    [1000] * 3 + [2000] * 3,
                    source="dizilla:views",
                    trust=SourceTrustLevel.UNOFFICIAL_TELEMETRY,
                ),
            ],
        )[0]
        assert c.confidence_score is ConfidenceScore.HIGH  # bağımsız kaynak teyit ediyor
        # Ama gayriresmi kaynağın karıştığı gizlenmez:
        assert c.source_trust_level is SourceTrustLevel.UNOFFICIAL_TELEMETRY

    def test_iki_korsan_kaynak_HALA_LOW(self):
        # Bilinçli karar: iki korsan kaynağın aynı şeyi söylemesi bağımsız teyit DEĞİLDİR,
        # ikisi de aynı korsan kitleyi ölçer — yanlılıkları ortaktır.
        # (Yalnız-telemetri olduğu için varsayılan modda düşer; keşif modunda inceleniyor.)
        c = motor(exploratory=True).generate_claims(
            "wd:Q1",
            [
                seri(
                    [1000] * 3 + [2000] * 3,
                    source="telegram:a",
                    trust=SourceTrustLevel.UNOFFICIAL_TELEMETRY,
                ),
                seri(
                    [1000] * 3 + [2000] * 3,
                    source="dizilla:b",
                    trust=SourceTrustLevel.UNOFFICIAL_TELEMETRY,
                ),
            ],
        )[0]
        assert c.confidence_score is ConfidenceScore.LOW
        assert c.passed_gates is False


# --- Dil / ülke karışmasının engellenmesi ------------------------------------------
class TestGeoKindSeparation:
    def test_dil_sinyali_metinde_ACIKCA_isaretlenir(self):
        c = motor().generate_claims(
            "wd:Q1", [seri([1000] * 3 + [2000] * 3, geo="fa", geo_kind=GeoKind.LANGUAGE)]
        )[0]
        assert c.geo_kind is GeoKind.LANGUAGE
        assert "DİL sinyalidir" in c.claim_text
        assert "ülkesinde" not in c.claim_text

    def test_ulke_sinyali_ulke_olarak_ifade_edilir(self):
        c = motor().generate_claims(
            "wd:Q1",
            [
                seri(
                    [1000] * 3 + [2000] * 3,
                    geo="TR",
                    geo_kind=GeoKind.COUNTRY,
                    source="trends:TR",
                    metric="searches",
                )
            ],
        )[0]
        assert "TR ülkesinde" in c.claim_text
        assert "DİL sinyalidir" not in c.claim_text

    def test_ayni_kod_farkli_TURDE_ise_BIRLESMEZ(self):
        # "fa" dil olarak ve "fa" ülke olarak gelirse bunlar AYNI ŞEY DEĞİL —
        # birleştirilip sahte bir HIGH üretilemez.
        claims = motor().generate_claims(
            "wd:Q1",
            [
                seri([1000] * 3 + [2000] * 3, geo="fa", geo_kind=GeoKind.LANGUAGE, source="wikipedia:fa"),
                seri([1000] * 3 + [2000] * 3, geo="fa", geo_kind=GeoKind.COUNTRY, source="trends:fa"),
            ],
        )
        assert len(claims) == 2
        assert all(c.confidence_score is ConfidenceScore.MEDIUM for c in claims)


# --- Çelişen kaynaklar --------------------------------------------------------------
class TestConflictingSources:
    def test_zit_yonlu_kaynaklar_BIRLESTIRILMEZ(self):
        # Çelişki gizlenmemeli: biri artış biri düşüş diyorsa ortalamasını alıp
        # "değişim yok" demek gerçek bilgiyi yok etmektir.
        claims = motor().generate_claims(
            "wd:Q1",
            [
                seri([1000] * 3 + [2000] * 3, source="wikipedia:fa"),
                seri([2000] * 3 + [1000] * 3, source="trends:fa"),
            ],
        )
        assert len(claims) == 2
        assert {c.direction for c in claims} == {"artis", "dusus"}
        # İkisi de tek kaynaklı kaldı — sahte HIGH üretilmedi.
        assert all(c.confidence_score is ConfidenceScore.MEDIUM for c in claims)


# --- Reddedilenlerin raporlanması ---------------------------------------------------
class TestRejectionReporting:
    def test_reddedilenler_sessizce_kaybolmaz(self):
        m = motor()
        m.generate_claims(
            "wd:Q1",
            [
                seri([0, 0, 0, 5000, 5000, 5000], source="a"),
                seri([20, 20, 20, 40, 40, 40], source="b"),
                seri([1000] * 3 + [2000] * 3, source="c"),
            ],
        )
        assert len(m.rejected) == 2
        assert {r.reason for r in m.rejected} == {
            RejectionReason.ZERO_BASELINE,
            RejectionReason.VOLUME,
        }
        # Hangi kaynağın neden elendiği geri izlenebilmeli.
        assert {r.source for r in m.rejected} == {"a", "b"}

    def test_red_gerekcesi_detay_tasir(self):
        m = motor()
        m.generate_claims("wd:Q1", [seri([20, 20, 20, 40, 40, 40])])
        assert "500" in m.rejected[0].detail

    def test_bos_seri_cokmez(self):
        m = motor()
        assert m.generate_claims("wd:Q1", [seri([])]) == []
        assert m.generate_claims("wd:Q1", []) == []


# --- Kohort normalizasyonu: fa.wikipedia korpus kayması ----------------------------
class TestCohortNormalization:
    """CANLI ÖLÇÜM: 51 Farsça dizinin 50'si aynı pencerede 3 kattan fazla büyüdü
    (kohort medyanı 4,23x). Aynı dönemde tr 0,96x, ar 1,30x, ru 0,88x, es 0,93x.
    Yani 50 dizi birden İran'da popüler olmadı — fa.wikipedia korpusunun TAMAMI kaydı.
    Dizi bazlı kapılar bunu yakalayamaz; her iddia tek tek bakıldığında geçerlidir."""

    FA_MEDYAN = 4.23

    def _korpus(self, carpanlar, *, geo="fa"):
        """Her dizi için taban 1000, güncel 1000*carpan olan basit bir korpus."""
        return [
            (f"wd:Q{i}", [seri([1000] * 3 + [round(1000 * c)] * 3, geo=geo)])
            for i, c in enumerate(carpanlar)
        ]

    def test_kohort_medyani_korpustan_hesaplanir(self):
        from claims import build_cohort_stats, cohort_key
        from claims_models import GeoKind

        korpus = self._korpus([3.0, 4.0, 4.23, 4.5, 5.0, 6.0])
        stats = build_cohort_stats(korpus, as_of=SABIT_AS_OF)
        k = cohort_key("views", "fa", GeoKind.LANGUAGE)
        assert k in stats
        assert stats[k].series_count == 6
        assert 4.0 <= stats[k].median_ratio <= 4.6

    def test_kohortla_BIRLIKTE_hareket_eden_dizi_iddia_URETMEZ(self):
        from claims import build_cohort_stats

        korpus = self._korpus([4.0, 4.1, 4.2, 4.23, 4.3, 4.4])
        stats = build_cohort_stats(korpus, as_of=SABIT_AS_OF)

        m = motor()
        # 4,23x büyüyen bir dizi: ham yüzde +%323 ama kohort medyanıyla aynı.
        sonuc = m.generate_claims("wd:Q1", [seri([1000] * 3 + [4230] * 3)], cohorts=stats)
        assert sonuc == []
        assert m.rejected[0].reason is RejectionReason.COHORT_NEUTRAL
        assert "kohortla birlikte" in m.rejected[0].detail

    def test_kohorttan_AYRISAN_dizi_iddia_URETIR(self):
        from claims import build_cohort_stats

        korpus = self._korpus([4.0, 4.1, 4.2, 4.23, 4.3, 4.4])
        stats = build_cohort_stats(korpus, as_of=SABIT_AS_OF)

        # 8x büyüyen dizi: kohort 4,2x iken bu gerçekten ayrışmış.
        c = motor().generate_claims("wd:Q1", [seri([1000] * 3 + [8000] * 3)], cohorts=stats)[0]
        assert c.excess_change_pct is not None
        assert c.excess_change_pct > 50  # kohortun belirgin üzerinde
        assert c.cohort_series_count == 6

    def test_iddia_metni_HAM_yuzdeyi_kohortla_birlikte_verir(self):
        from claims import build_cohort_stats

        stats = build_cohort_stats(self._korpus([4.0, 4.1, 4.2, 4.23, 4.3, 4.4]), as_of=SABIT_AS_OF)
        c = motor().generate_claims("wd:Q1", [seri([1000] * 3 + [8000] * 3)], cohorts=stats)[0]
        # Ham yüzde tek başına yanıltıcı — kohort bağlamı aynı cümlede olmalı.
        assert "kohortunun tamamı" in c.claim_text
        assert "kohort medyanının" in c.claim_text

    def test_dusen_kohortta_yatay_dizi_AYRISMA_sayilir(self):
        from claims import build_cohort_stats

        # Kohort yarıya inerken (0,5x) sabit kalan bir dizi, kohortun %100 üzerindedir.
        stats = build_cohort_stats(self._korpus([0.45, 0.48, 0.5, 0.52, 0.55, 0.5]), as_of=SABIT_AS_OF)
        m = motor()
        sonuc = m.generate_claims("wd:Q1", [seri([1000] * 3 + [1000] * 3)], cohorts=stats)
        # Ham değişim %0 — Effect-Size kapısı bunu kohorttan ÖNCE eler.
        assert sonuc == []
        assert m.rejected[0].reason is RejectionReason.EFFECT_TOO_SMALL

    def test_KUCUK_kohortta_duzeltme_UYGULANMAZ(self):
        from claims import build_cohort_stats

        # 3 dizilik kohortun medyanı tek bir dizinin hareketini yansıtır — gürültü ekler.
        stats = build_cohort_stats(self._korpus([4.0, 4.2, 4.4]), as_of=SABIT_AS_OF)
        assert stats == {}
        c = motor().generate_claims("wd:Q1", [seri([1000] * 3 + [4230] * 3)], cohorts=stats)[0]
        assert c.cohort_change_pct is None  # düzeltme yok, iddia mutlak okunur

    def test_kohort_VERILMEZSE_davranis_degismez(self):
        # Geriye uyumluluk: mevcut çağıranlar kohort göndermiyor, sonuç aynı kalmalı.
        a = motor().generate_claims("wd:Q1", [seri([1000] * 3 + [4230] * 3)])[0]
        assert a.change_pct == 323.0
        assert a.cohort_change_pct is None
        assert a.excess_change_pct is None

    def test_FARKLI_dil_kohortlari_karismaz(self):
        from claims import build_cohort_stats, cohort_key
        from claims_models import GeoKind

        korpus = self._korpus([4.0, 4.2, 4.3, 4.4, 4.5, 4.6], geo="fa") + self._korpus(
            [0.9, 0.95, 1.0, 1.05, 1.1, 0.96], geo="tr"
        )
        stats = build_cohort_stats(korpus, as_of=SABIT_AS_OF)
        fa = stats[cohort_key("views", "fa", GeoKind.LANGUAGE)]
        tr = stats[cohort_key("views", "tr", GeoKind.LANGUAGE)]
        assert fa.median_ratio > 4
        assert 0.9 < tr.median_ratio < 1.1


# --- KEŞİF MODU: veri akar, kapı silinmez ------------------------------------------
class TestKesifModu:
    """Kullanıcı kararı: "tüm ham veri iddiaya dönüşebilsin, ama sahte sayı bültene girmesin".
    Kapılar SİLİNMEDİ; keşif modunda adayı düşürmek yerine `passed_gates=False` ile
    işaretliyorlar. Tüketen taraf (bülten, LLM özeti) yalnızca passed_gates=True olanı kullanır.
    """

    def test_dusuk_hacim_VARSAYILANDA_elenir(self):
        assert motor().generate_claims("wd:Q1", [seri([20, 20, 20, 40, 40, 40])]) == []

    def test_dusuk_hacim_KESIFTE_iddiaya_donusur_ama_ISARETLENIR(self):
        c = motor(exploratory=True).generate_claims("wd:Q1", [seri([20, 20, 20, 40, 40, 40])])[0]
        assert c.passed_gates is False
        assert "volume" in c.failed_gates
        assert c.change_pct == 100.0  # hesap yine doğru, sadece doğrulanmamış

    def test_kucuk_degisim_KESIFTE_gecer(self):
        c = motor(exploratory=True).generate_claims(
            "wd:Q1", [seri([1000, 1000, 1000, 1030, 1030, 1030])]
        )[0]
        assert c.passed_gates is False
        assert "effect_too_small" in c.failed_gates

    def test_aykiri_pencere_KESIFTE_gecer_ama_isaretli(self):
        c = motor(exploratory=True).generate_claims(
            "wd:Q1", [seri(TestWindowStabilityGate.FA_GERCEK, baslangic=(2026, 1))]
        )[0]
        assert c.passed_gates is False
        assert "window_unstable" in c.failed_gates

    def test_birden_fazla_kapi_HEPSI_kaydedilir(self):
        # Taban 180 (near_zero eşiği 50'nin üstünde), toplam 369 < 500 -> volume;
        # değişim %5 < %10 -> effect_too_small. İki kapı birden, üçüncüsü DEĞİL.
        c = motor(exploratory=True).generate_claims("wd:Q1", [seri([60, 60, 60, 63, 63, 63])])[0]
        assert c.passed_gates is False
        assert set(c.failed_gates) == {"volume", "effect_too_small"}

    def test_cok_kucuk_taban_ayri_kapi_olarak_kaydedilir(self):
        # Taban 30 < 50: hem volume hem near_zero_baseline tetiklenir, ikisi de kaydedilmeli.
        c = motor(exploratory=True).generate_claims("wd:Q1", [seri([10, 10, 10, 11, 11, 11])])[0]
        assert set(c.failed_gates) == {"volume", "near_zero_baseline"}

    def test_TEMIZ_veri_kesif_modunda_da_DOGRULANMIS_kalir(self):
        c = motor(exploratory=True).generate_claims("wd:Q1", [seri([1000] * 3 + [2000] * 3)])[0]
        assert c.passed_gates is True
        assert c.failed_gates == []

    def test_dogrulanmamis_iddia_METINDE_de_uyarir(self):
        # Çıktı bağlamından koparılıp kopyalansa bile uyarı onunla gitmeli.
        c = motor(exploratory=True).generate_claims("wd:Q1", [seri([20, 20, 20, 40, 40, 40])])[0]
        assert "DOĞRULANMAMIŞ" in c.claim_text
        assert "volume" in c.claim_text

    def test_varsayilan_mod_DEGISMEDI(self):
        # Geriye uyumluluk: exploratory verilmezse hiçbir çağıranın davranışı değişmez.
        m = motor()
        assert m.exploratory is False
        assert m.generate_claims("wd:Q1", [seri([0, 0, 0, 5000, 5000, 5000])]) == []


class TestSifirTabanKesifte:
    """Sıfır taban TEK İSTİSNA: keşif modunda bile yüzde üretilmez. 0'a bölme esnetilecek
    bir eşik değil, tanımsız bir işlem. Olay `from_zero` ile taşınır."""

    def test_sifirdan_cikis_YUZDE_uretmez(self):
        c = motor(exploratory=True).generate_claims(
            "wd:Q1", [seri([0, 0, 0, 5000, 5000, 5000])]
        )[0]
        assert c.change_pct is None
        assert c.from_zero is True
        assert "zero_baseline" in c.failed_gates

    def test_sifirdan_cikis_OLAY_olarak_korunur(self):
        c = motor(exploratory=True).generate_claims(
            "wd:Q1", [seri([0, 0, 0, 5000, 5000, 5000])]
        )[0]
        assert c.baseline_value == 0
        assert c.current_value == 15000
        assert c.direction == "artis"  # yön var, yüzde yok
        assert "SIFIRDAN" in c.claim_text

    def test_uydurma_sonsuz_yuzde_URETILMEZ(self):
        c = motor(exploratory=True).generate_claims("wd:Q1", [seri([0] * 3 + [9999] * 3)])[0]
        assert c.change_pct is None
        assert not isinstance(c.change_pct, float)


class TestCikisSozlesmesi:
    """Doğrulanmamış iddialar arayüze/bültene/LLM'e ASLA ulaşmamalı. Sözleşme kaynakta:
    dışarı çıkış tek kapıdan geçiyor ve kapı varsayılan olarak kapalı."""

    def _karisik(self):
        m = motor(exploratory=True)
        return m.generate_claims(
            "wd:Q1",
            [
                seri([1000] * 3 + [2000] * 3, source="wikipedia:fa"),  # temiz
                seri([20, 20, 20, 40, 40, 40], source="wikipedia:tr", geo="tr"),  # hacim kapısı
            ],
        )

    def test_verified_only_yalnizca_temizi_birakir(self):
        from claims import verified_only

        hepsi = self._karisik()
        temiz = verified_only(hepsi)
        assert len(hepsi) > len(temiz)
        assert all(c.passed_gates for c in temiz)

    def test_to_public_payload_KIRLI_listede_HATA_verir(self):
        from claims import UnverifiedClaimError, to_public_payload

        with pytest.raises(UnverifiedClaimError, match="doğrulanmamış"):
            to_public_payload(self._karisik())

    def test_sessiz_suzme_BILINCLI_olmali(self):
        # strict=False bilinçli bir tercih; varsayılan değil. Keşif çıktısını yanlışlıkla
        # bülten yoluna vermek gürültüsüz başarısız olmamalı.
        from claims import to_public_payload

        sonuc = to_public_payload(self._karisik(), strict=False)
        assert all(d["passed_gates"] for d in sonuc)

    def test_temiz_liste_sorunsuz_gecer(self):
        from claims import to_public_payload, verified_only

        sonuc = to_public_payload(verified_only(self._karisik()))
        assert len(sonuc) >= 1
        assert all(d["passed_gates"] for d in sonuc)
