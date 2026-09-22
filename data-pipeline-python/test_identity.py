"""Kanonik Kimlik Katmanı testleri.

Buradaki kimlikler UYDURMA DEĞİL: TMDB /tv/{id}/external_ids ucundan canlı çekilmiş
gerçek değerler (Kuruluş Osman 95603 -> Q64878719 / tt11093718, Çukur 74823 -> Q45504593,
Uzak Şehir 274556 -> Q131195670).

Testler bellek-içi SQLite kullanır — pipeline.db'ye de app.db'ye de dokunmaz.
"""
from __future__ import annotations

import sqlite3

import pytest

import db as db_module
from identity import IdentityConflict, IdentityResolver, build_canonical_id
from models import ResolutionTier, UnresolvedReason


@pytest.fixture()
def resolver() -> IdentityResolver:
    conn = sqlite3.connect(":memory:")
    conn.executescript(db_module.SCHEMA)
    return IdentityResolver(conn)


# --- Anahtar türetme ---------------------------------------------------------------
class TestBuildCanonicalId:
    def test_wikidata_oncelikli(self):
        assert build_canonical_id("Q64878719", "tt11093718", 95603) == ("wd:Q64878719", ResolutionTier.WIKIDATA)

    def test_wikidata_yoksa_imdb(self):
        assert build_canonical_id(None, "tt11093718", 95603) == ("imdb:tt11093718", ResolutionTier.IMDB)

    def test_ikisi_de_yoksa_tmdb(self):
        # Ölçüldü: dizilerin %22'sinde wikidata_id yok. Bu kayıtlar ELENMEZ.
        assert build_canonical_id(None, None, 95603) == ("tmdb:95603", ResolutionTier.TMDB)

    def test_hicbiri_yoksa_none(self):
        assert build_canonical_id(None, None, None) is None

    def test_bicimi_bozuk_kimlik_atlanir(self):
        # 'BOZUK' anahtar yapılırsa yanlış birleştirmenin kapısı açılır.
        assert build_canonical_id("BOZUK", "tt11093718", 95603) == ("imdb:tt11093718", ResolutionTier.IMDB)


# --- Temel çözümleme ---------------------------------------------------------------
class TestResolve:
    def test_tam_kimlikli_kayit_wikidata_kademesinde_cozulur(self, resolver):
        k = resolver.resolve(
            source="tmdb", source_ref="95603", title="Kuruluş Osman",
            wikidata_id="Q64878719", imdb_id="tt11093718", tmdb_id=95603,
        )
        assert k is not None
        assert k.canonical_id == "wd:Q64878719"
        assert k.tier is ResolutionTier.WIKIDATA
        assert resolver.pending() == []

    def test_ayni_kayit_iki_kez_gelirse_tek_satir(self, resolver):
        for _ in range(2):
            resolver.resolve(source="tmdb", source_ref="74823", title="Çukur",
                             wikidata_id="Q45504593", tmdb_id=74823)
        n = resolver.conn.execute("SELECT COUNT(*) FROM canonical_identity").fetchone()[0]
        assert n == 1

    def test_sert_kimlik_yoksa_KUYRUGA_alinir_silinmez(self, resolver):
        k = resolver.resolve(source="telegram", source_ref="kanal/123", title="Bilinmeyen Dizi")
        assert k is None
        bekleyen = resolver.pending()
        assert len(bekleyen) == 1
        assert bekleyen[0].reason is UnresolvedReason.NO_EXTERNAL_ID
        assert bekleyen[0].raw_title == "Bilinmeyen Dizi"

    def test_bozuk_kimlik_kuyruga_alinir(self, resolver):
        k = resolver.resolve(source="dizilla", source_ref="x", title="T", wikidata_id="Q-YOK")
        assert k is None
        assert resolver.pending()[0].reason is UnresolvedReason.MALFORMED_ID


# --- Kademe yükseltme --------------------------------------------------------------
class TestUpgrade:
    def test_tmdb_kaydi_sonradan_wikidata_kazanirsa_yukselir(self, resolver):
        ilk = resolver.resolve(source="tmdb", source_ref="95603", title="Kuruluş Osman", tmdb_id=95603)
        assert ilk.canonical_id == "tmdb:95603"

        sonra = resolver.resolve(
            source="tmdb", source_ref="95603", title="Kuruluş Osman",
            wikidata_id="Q64878719", imdb_id="tt11093718", tmdb_id=95603,
        )
        assert sonra.canonical_id == "wd:Q64878719"
        assert sonra.tier is ResolutionTier.WIKIDATA
        # Tek kayıt olmalı — yükseltme KOPYA üretmemeli.
        assert resolver.conn.execute("SELECT COUNT(*) FROM canonical_identity").fetchone()[0] == 1

    def test_eski_anahtar_takma_ad_olarak_calismaya_devam_eder(self, resolver):
        resolver.resolve(source="tmdb", source_ref="95603", title="Kuruluş Osman", tmdb_id=95603)
        resolver.resolve(source="tmdb", source_ref="95603", title="Kuruluş Osman",
                         wikidata_id="Q64878719", tmdb_id=95603)
        # Eski anahtarla yazılmış satırlar kırılmamalı.
        eski = resolver.lookup("tmdb:95603")
        assert eski is not None
        assert eski.canonical_id == "wd:Q64878719"

    def test_kademe_geri_alinmaz(self, resolver):
        resolver.resolve(source="tmdb", source_ref="95603", title="Kuruluş Osman",
                         wikidata_id="Q64878719", tmdb_id=95603)
        # Sonradan yalnızca imdb taşıyan bir kaynak gelirse wikidata kademesi korunmalı.
        sonuc = resolver.resolve(source="imdb", source_ref="tt11093718", title="Kurulus Osman",
                                 imdb_id="tt11093718", tmdb_id=95603)
        assert sonuc.canonical_id == "wd:Q64878719"
        assert sonuc.tier is ResolutionTier.WIKIDATA

    def test_takma_ad_zinciri_kopmaz(self, resolver):
        resolver.resolve(source="tmdb", source_ref="1", title="X", tmdb_id=95603)
        resolver.resolve(source="imdb", source_ref="1", title="X", imdb_id="tt11093718", tmdb_id=95603)
        resolver.resolve(source="wd", source_ref="1", title="X",
                         wikidata_id="Q64878719", imdb_id="tt11093718", tmdb_id=95603)
        # İlk anahtar iki yükseltme sonrasında hâlâ güncel kayda ulaşmalı.
        assert resolver.lookup("tmdb:95603").canonical_id == "wd:Q64878719"
        assert resolver.lookup("imdb:tt11093718").canonical_id == "wd:Q64878719"


# --- Çelişki: sessiz birleştirmenin engellendiği yer -------------------------------
class TestConflict:
    def test_farkli_kayitlara_isaret_eden_kimlikler_kuyruga_dusr(self, resolver):
        resolver.resolve(source="a", source_ref="1", title="Kuruluş Osman", wikidata_id="Q64878719")
        resolver.resolve(source="b", source_ref="2", title="Çukur", imdb_id="tt11093718")
        # Şimdi ikisini tek kayıtmış gibi bağlamaya çalış — bu bir çelişkidir.
        sonuc = resolver.resolve(source="c", source_ref="3", title="?",
                                 wikidata_id="Q64878719", imdb_id="tt11093718")
        assert sonuc is None
        kuyruk = [r for r in resolver.pending() if r.source == "c"]
        assert kuyruk[0].reason is UnresolvedReason.CONFLICT

    def test_var_olan_kimlik_farkli_degerle_EZILMEZ(self, resolver):
        resolver.resolve(source="a", source_ref="1", title="Kuruluş Osman",
                         wikidata_id="Q64878719", imdb_id="tt11093718")
        with pytest.raises(IdentityConflict):
            resolver.resolve(source="a", source_ref="1", title="Kuruluş Osman",
                             wikidata_id="Q64878719", imdb_id="tt99999999")


# --- İsimden eşleştirme: ASLA otomatik değil ---------------------------------------
class TestTitleProposal:
    def test_isimden_oneri_kanonik_kayit_OLUSTURMAZ(self, resolver):
        resolver.resolve(source="tmdb", source_ref="95603", title="Kuruluş Osman",
                         wikidata_id="Q64878719", tmdb_id=95603)
        oncesi = resolver.conn.execute("SELECT COUNT(*) FROM canonical_identity").fetchone()[0]

        adaylar = resolver.propose_by_title("Kuruluş")

        assert len(adaylar) == 1
        assert adaylar[0].canonical_id == "wd:Q64878719"
        # Kritik: öneri yapmak kayıt YARATMAZ.
        assert resolver.conn.execute("SELECT COUNT(*) FROM canonical_identity").fetchone()[0] == oncesi

    def test_isim_bazli_kaynak_adaylarla_birlikte_kuyruga_alinir(self, resolver):
        resolver.resolve(source="tmdb", source_ref="95603", title="Kuruluş Osman",
                         wikidata_id="Q64878719", tmdb_id=95603)
        adaylar = [k.canonical_id for k in resolver.propose_by_title("Kuruluş")]
        resolver.queue("dizilla", "kurulus-osman", "Kuruluş Osman",
                       UnresolvedReason.NAME_ONLY, candidates=adaylar)

        bekleyen = resolver.pending(source="dizilla")[0]
        assert bekleyen.reason is UnresolvedReason.NAME_ONLY
        assert bekleyen.candidates == ["wd:Q64878719"]


# --- Kuyruk yaşam döngüsü ----------------------------------------------------------
class TestQueue:
    def test_cozulen_kayit_bekleyenlerden_cikar(self, resolver):
        resolver.resolve(source="telegram", source_ref="k/1", title="X")
        assert len(resolver.pending()) == 1
        resolver.mark_queue_resolved("telegram", "k/1")
        assert resolver.pending() == []

    def test_ayni_kaynak_tekrar_gelirse_kuyrukta_tek_satir(self, resolver):
        for _ in range(3):
            resolver.resolve(source="telegram", source_ref="k/1", title="X")
        n = resolver.conn.execute("SELECT COUNT(*) FROM unresolved_queue").fetchone()[0]
        assert n == 1
