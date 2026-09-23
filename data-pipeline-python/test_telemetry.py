"""Gayriresmî telemetri katmanı testleri.

Üç sözleşme sabitleniyor:
  1) Güven etiketi çağırana bırakılmaz — kapı zorlar.
  2) Kimlik uydurulmaz — eşleşmeyen ad `canonical_id: None` + kuyruk.
  3) Telemetri kaynaklı iddia bültene/varsayılan arayüze sızmaz; yalnızca keşif modunda.
"""
from __future__ import annotations

from datetime import date

import pytest

import telemetry_store as ts
from claims import ClaimEngine
from claims_models import (
    ConfidenceScore,
    GeoKind,
    MetricPoint,
    MetricSeries,
    RejectionReason,
    SourceTrustLevel,
)

SABIT_AS_OF = date(2026, 9, 21)


@pytest.fixture()
def db(bellek_db):
    """conftest.bellek_db üzerine iki kanonik kimlik ekler."""
    bellek_db.execute(
        "INSERT INTO canonical_identity (canonical_id, tier, primary_title, resolved_at) VALUES (?,?,?,?)",
        ("wd:Q64878719", "wikidata", "Kuruluş Osman", "2026-09-01T00:00:00Z"),
    )
    bellek_db.execute(
        "INSERT INTO canonical_identity (canonical_id, tier, primary_title, resolved_at) VALUES (?,?,?,?)",
        ("wd:Q45504593", "wikidata", "Çukur", "2026-09-01T00:00:00Z"),
    )
    bellek_db.commit()
    return bellek_db


def kayit(title, **kw):
    temel = {
        "rank": 3,
        "title": title,
        "platform": "netflix",
        "country": "brazil",
        "scraped_at": "2026-09-22T10:00:00Z",
    }
    temel.update(kw)
    return temel


# --- 1) Güven etiketi zorlanır -----------------------------------------------------
class TestGuvenEtiketiZorlanir:
    def test_kayit_her_zaman_unofficial_LOW(self, db):
        ts.save_telemetry(db, [kayit("Kuruluş Osman")], source="flixpatrol")
        satir = db.execute("SELECT source_trust_level, confidence_score FROM unofficial_telemetry").fetchone()
        assert satir["source_trust_level"] == "unofficial_telemetry"
        assert satir["confidence_score"] == "LOW"

    def test_cagiran_OFFICIAL_gonderse_bile_YOK_SAYILIR(self, db):
        # Tek bir dikkatsiz çağrı korsan veriyi resmî sınıfa sokamamalı.
        ts.save_telemetry(
            db,
            [kayit("Kuruluş Osman", source_trust_level="official", confidence_score="HIGH")],
            source="flixpatrol",
        )
        satir = db.execute("SELECT source_trust_level, confidence_score FROM unofficial_telemetry").fetchone()
        assert satir["source_trust_level"] == "unofficial_telemetry"
        assert satir["confidence_score"] == "LOW"


# --- 2) Kimlik uydurulmaz ----------------------------------------------------------
class TestKanonikEslestirme:
    def test_tam_ad_eslesmesi_canonical_id_atar(self, db):
        ozet = ts.save_telemetry(db, [kayit("Kuruluş Osman")], source="flixpatrol")
        assert ozet["resolved"] == 1
        satir = db.execute("SELECT canonical_id FROM unofficial_telemetry").fetchone()
        assert satir["canonical_id"] == "wd:Q64878719"

    def test_eslesmeyen_ad_canonical_id_NULL_birakir(self, db):
        ozet = ts.save_telemetry(db, [kayit("Bilinmeyen Bir Dizi")], source="flixpatrol")
        assert ozet["unresolved"] == 1
        satir = db.execute("SELECT canonical_id FROM unofficial_telemetry").fetchone()
        assert satir["canonical_id"] is None

    def test_eslesmeyen_kayit_KUYRUGA_dusr(self, db):
        ts.save_telemetry(db, [kayit("Bilinmeyen Bir Dizi")], source="flixpatrol")
        n = db.execute("SELECT COUNT(*) c FROM unresolved_queue WHERE source='flixpatrol'").fetchone()["c"]
        assert n == 1

    def test_ALT_DIZE_eslesmesi_KABUL_EDILMEZ(self, db):
        # Netflix katmanındaki "Anne" hatasının telemetri karşılığı.
        ozet = ts.save_telemetry(db, [kayit("Kuruluş Osman Behind The Scenes")], source="flixpatrol")
        assert ozet["resolved"] == 0
        assert db.execute("SELECT canonical_id FROM unofficial_telemetry").fetchone()["canonical_id"] is None

    def test_BELIRSIZ_ad_iki_kimlige_dusuyorsa_BAGLANMAZ(self, db):
        # Aynı normalize ad iki kanonik kayda düşerse rastgele birine bağlamak yanlış olur.
        db.execute(
            "INSERT INTO canonical_identity (canonical_id, tier, primary_title, resolved_at) VALUES (?,?,?,?)",
            ("tmdb:999", "tmdb", "Cukur", "2026-09-01T00:00:00Z"),
        )
        db.execute(
            "INSERT INTO canonical_identity (canonical_id, tier, primary_title, resolved_at) VALUES (?,?,?,?)",
            ("tmdb:998", "tmdb", "cukur", "2026-09-01T00:00:00Z"),
        )
        db.commit()
        idx = ts.build_title_index(db)
        assert "cukur" not in idx

    def test_tekrar_tarama_KOPYA_uretmez(self, db):
        for _ in range(3):
            ts.save_telemetry(db, [kayit("Kuruluş Osman")], source="flixpatrol")
        assert db.execute("SELECT COUNT(*) c FROM unofficial_telemetry").fetchone()["c"] == 1


# --- 3) Bültene/arayüze sızmaz -----------------------------------------------------
def seri(degerler, *, source, trust, geo="BR"):
    return MetricSeries(
        metric_type="rank_delta",
        source=source,
        trust=trust,
        geo_or_lang=geo,
        geo_kind=GeoKind.COUNTRY,
        points=[
            MetricPoint(year=2026, month=i + 1, value=v) for i, v in enumerate(degerler)
        ],
    )


class TestTelemetriSizintiKapisi:
    TELEMETRI = dict(source="flixpatrol:netflix", trust=SourceTrustLevel.UNOFFICIAL_TELEMETRY)
    RESMI = dict(source="tmdb", trust=SourceTrustLevel.OFFICIAL)

    def test_yalniz_telemetri_VARSAYILANDA_iddia_URETMEZ(self):
        m = ClaimEngine(as_of=SABIT_AS_OF)
        sonuc = m.generate_claims("wd:Q1", [seri([1000] * 3 + [2000] * 3, **self.TELEMETRI)])
        assert sonuc == []

    def test_yalniz_telemetri_KESIFTE_uretilir_ama_DOGRULANMAMIS(self):
        m = ClaimEngine(as_of=SABIT_AS_OF, exploratory=True)
        c = m.generate_claims("wd:Q1", [seri([1000] * 3 + [2000] * 3, **self.TELEMETRI)])[0]
        assert c.passed_gates is False
        assert "telemetry_only" in c.failed_gates
        assert c.confidence_score is ConfidenceScore.LOW

    def test_resmi_kaynak_ESLIK_ederse_kapi_ACILIR(self):
        m = ClaimEngine(as_of=SABIT_AS_OF)
        c = m.generate_claims(
            "wd:Q1",
            [
                seri([1000] * 3 + [2000] * 3, **self.TELEMETRI),
                seri([1000] * 3 + [2000] * 3, **self.RESMI),
            ],
        )[0]
        assert c.passed_gates is True
        assert c.confidence_score is ConfidenceScore.HIGH
        # Gayriresmî kaynak karıştığı GİZLENMEZ.
        assert c.source_trust_level is SourceTrustLevel.UNOFFICIAL_TELEMETRY

    def test_kapi_REDDEDILENLERDE_raporlanir(self):
        m = ClaimEngine(as_of=SABIT_AS_OF, exploratory=True)
        m.generate_claims("wd:Q1", [seri([1000] * 3 + [2000] * 3, **self.TELEMETRI)])
        assert any(r.reason is RejectionReason.TELEMETRY_ONLY for r in m.rejected)

    def test_cikis_sozlesmesi_telemetriyi_DISARI_VERMEZ(self):
        from claims import UnverifiedClaimError, to_public_payload, verified_only

        m = ClaimEngine(as_of=SABIT_AS_OF, exploratory=True)
        hepsi = m.generate_claims("wd:Q1", [seri([1000] * 3 + [2000] * 3, **self.TELEMETRI)])
        assert verified_only(hepsi) == []
        with pytest.raises(UnverifiedClaimError):
            to_public_payload(hepsi)
