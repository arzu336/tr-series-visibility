"""YouTube dil analizcisi testleri.

Metinler UYDURMA DEĞİL: gerçek cümleler ve fasttext lid.176.ftz ile CANLI ölçülmüş sonuçlar
(2026-09-22). Ölçümün kendisi bu modülün en önemli bulgusunu ortaya çıkardı — Latin alfabeli
Afrika dilleri güvenilir tespit edilemiyor.
"""
from __future__ import annotations

import pytest

from youtube_lang_tracker import (
    GUVENILMEZ_DILLER,
    detect_language,
    language_distribution,
)

# Ölçümde DOĞRU tespit edilen diller (Latin dışı alfabeler + Türkçe).
GUVENILIR = {
    "am": "ይህን የቱርክ ተከታታይ ድራማ በጣም እወዳለሁ በጣም ጥሩ ነው",
    "ur": "مجھے یہ ترک ڈرامہ بہت پسند ہے بہت اچھا ہے",
    "fa": "من این سریال ترکی را خیلی دوست دارم بسیار عالی است",
    "tr": "Bu Türk dizisini gerçekten çok seviyorum harika bir yapım",
}

# Ölçümde YANLIŞ tespit edilenler: so->en (0,25), ha->en (0,12), sw->eo (0,32).
LATIN_AFRIKA = {
    "so": "Waan jeclahay musalsalka Turkiga, aad iyo aad ayuu u fiican yahay walaal",
    "ha": "Ina son wannan jerin talabijin na Turkiyya sosai, yana da kyau matuka",
    "sw": "Napenda sana tamthilia hii ya Kituruki, ni nzuri sana kweli",
}


class TestGuvenilirDiller:
    @pytest.mark.parametrize("beklenen,metin", GUVENILIR.items())
    def test_latin_disi_alfabeler_dogru_tespit_edilir(self, beklenen, metin):
        sonuc = detect_language(metin)
        assert sonuc.lang == beklenen
        assert sonuc.confidence >= 0.35
        assert sonuc.unreliable is False


class TestLatinAfrikaSinirlamasi:
    """Bu sınıf bir HATA'yı değil, ÖLÇÜLMÜŞ BİR SINIRI sabitliyor. Davranış değişirse
    (model güncellenirse ya da eşik oynatılırsa) test bunu haber verir."""

    @pytest.mark.parametrize("dil,metin", LATIN_AFRIKA.items())
    def test_guvenilmez_dil_ya_elenir_ya_isaretlenir(self, dil, metin):
        sonuc = detect_language(metin)
        # Ya tespit edilemez (None), ya yanlış bir dile düşer, ya da doğru bulunup
        # `unreliable` işaretlenir. HİÇBİR durumda sessizce "kesin" sayılmaz.
        if sonuc.lang == dil:
            assert sonuc.unreliable is True
        else:
            assert sonuc.lang is None or sonuc.lang != dil

    def test_somalice_INGILIZCE_diye_sayilmamali(self):
        # Ölçümde so -> en (0,25). Eşik bunu eler; elemeseydi Somali talebi
        # sessizce İngilizce konuşan bir ülkeye atfedilirdi.
        sonuc = detect_language(LATIN_AFRIKA["so"])
        assert sonuc.lang != "en" or sonuc.confidence < 0.35

    def test_guvenilmez_liste_hedef_dilleri_kapsar(self):
        for d in ("so", "ha", "sw"):
            assert d in GUVENILMEZ_DILLER


class TestKisaMetin:
    def test_cok_kisa_yorum_tespit_edilmez(self):
        for metin in ("👏", "süper", "❤️❤️", ""):
            assert detect_language(metin).lang is None

    def test_none_girdide_cokmez(self):
        assert detect_language(None).lang is None


class TestDagilim:
    def test_oran_TESPIT_EDILENLER_uzerinden_hesaplanir(self):
        yorumlar = [GUVENILIR["fa"], GUVENILIR["fa"], GUVENILIR["tr"], "👏", "❤️"]
        d = language_distribution(yorumlar)
        assert d["total_comments"] == 5
        assert d["undetected"] == 2
        assert d["detected"] == 3
        # 2/3 = %66,7 — 2/5 = %40 DEĞİL. Kapsama kaybı "ilgi yok" diye okunmamalı.
        assert d["by_language"]["fa"]["share_of_detected"] == 66.7

    def test_hic_tespit_edilemezse_cokmez(self):
        d = language_distribution(["👏", "🔥", ""])
        assert d["detected"] == 0
        assert d["by_language"] == {}

    def test_bos_girdi(self):
        d = language_distribution([])
        assert d["total_comments"] == 0
        assert d["detected"] == 0


class TestKesifModu:
    """Karantina listesi SİLİNMEDİ; keşif modunda eşik altı tespitler de DÖNER ama
    `below_threshold` / `unreliable` ile işaretlenir. `trustworthy` tek bakılacak alandır."""

    def test_varsayilanda_esik_alti_ELENIR(self):
        sonuc = detect_language(LATIN_AFRIKA["ha"])  # ölçümde 0.12
        assert sonuc.lang is None

    def test_kesifte_esik_alti_DONER_ama_isaretli(self):
        sonuc = detect_language(LATIN_AFRIKA["ha"], exploratory=True)
        assert sonuc.lang is not None
        assert sonuc.below_threshold is True
        assert sonuc.trustworthy is False

    def test_guvenilmez_dil_kesifte_de_trustworthy_DEGIL(self):
        sonuc = detect_language(LATIN_AFRIKA["sw"], exploratory=True)
        if sonuc.lang in GUVENILMEZ_DILLER:
            assert sonuc.trustworthy is False

    def test_temiz_tespit_her_iki_modda_da_guvenilir(self):
        for mod in (False, True):
            sonuc = detect_language(GUVENILIR["fa"], exploratory=mod)
            assert sonuc.lang == "fa"
            assert sonuc.trustworthy is True

    def test_dagilim_kesifte_guvenilmez_sayisini_AYRI_tutar(self):
        yorumlar = [LATIN_AFRIKA["ha"], LATIN_AFRIKA["so"], GUVENILIR["fa"]]
        d = language_distribution(yorumlar, exploratory=True)
        assert d["exploratory"] is True
        # Farsça güvenilir, diğer ikisi değil — sayım ayrıştırılabilmeli.
        assert d["by_language"]["fa"]["untrustworthy_count"] == 0
        assert sum(d["unreliable_detections"].values()) >= 2

    def test_varsayilan_dagilim_DEGISMEDI(self):
        d = language_distribution([GUVENILIR["fa"], "👏"])
        assert d["exploratory"] is False
        assert d["detected"] == 1
