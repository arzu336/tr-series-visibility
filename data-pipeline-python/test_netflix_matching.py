"""Netflix başlık eşleştirme testleri.

CANLI YAKALANAN HATA (2026-09-22): `_matches` alt-dize araması yapıyordu ve kataloğumuzdaki
gerçek Türk dizisi "Anne", Netflix'in "Anne Rice's Mayfair Witches" (AMC yapımı) başlığıyla
eşleşti. Sonuç: AR, BR, CL, CO, IT, MX, NL için 7 satır yazıldı — hepsi uydurma veri, bir
Amerikan dizisi Türk dizisi ihracat kaydı olarak saklandı. Satırlar silindi, eşleştirme
sıkılaştırıldı, bu dosya regresyonu engelliyor.
"""
from __future__ import annotations

import pytest

import netflix_country_ranker as nf
from netflix_pipeline import resolve_netflix_title
from reytingtv_ranker import SeriesIndexEntry, normalize_title


def idx(*adlar) -> list[SeriesIndexEntry]:
    return [SeriesIndexEntry(tmdb_id=i, name=a, normalized=normalize_title(a)) for i, a in enumerate(adlar, 1)]


class TestMatchesSikilastirma:
    def test_ANNE_yanlis_eslesmesi_ARTIK_OLMUYOR(self):
        # Regresyonun tam senaryosu. Bu satır kırmızıya dönerse yine sahte ihracat verisi yazılır.
        assert nf._matches("Anne Rice's Mayfair Witches", "", ["Anne"]) is False

    def test_tam_eslesme_kabul_edilir(self):
        assert nf._matches("Anne", "", ["Anne"]) is True

    @pytest.mark.parametrize(
        "show,season",
        [("Kurulus Osman", "Season 4"), ("Kurulus Osman: Season 4", ""), ("Kurulus Osman", "Sezon 2")],
    )
    def test_sezon_ekleri_mesru_kuyruk(self, show, season):
        assert nf._matches(show, season, ["Kurulus Osman"]) is True

    @pytest.mark.parametrize(
        "show",
        ["The Anne Frank Story", "Anne with an E", "Love Is in the Air", "Anne Boleyn"],
    )
    def test_adin_ICINDE_gecmesi_YETMEZ(self, show):
        assert nf._matches(show, "", ["Anne"]) is False

    def test_birden_fazla_adaydan_dogru_olani(self):
        assert nf._matches("Sefirin Kizi", "", ["Anne", "Sefirin Kizi"]) is True

    def test_bos_girdi_cokmez(self):
        assert nf._matches("", "", ["Anne"]) is False
        assert nf._matches("Anne", "", []) is False
        assert nf._matches("Anne", "", ["", "   "]) is False


class TestResolveNetflixTitle:
    def test_yanlis_eslesme_None_doner(self):
        assert resolve_netflix_title("Anne Rice's Mayfair Witches", idx("Anne")) is None

    def test_dogru_dizi_cozulur(self):
        e = resolve_netflix_title("Anne", idx("Anne", "Sefirin Kizi"))
        assert e is not None and e.name == "Anne"

    def test_EN_UZUN_eslesme_secilir(self):
        # match_series İLK eşleşmeyi dönüyordu: indekste "Osman" önce gelirse
        # "Kurulus Osman" başlığı yanlış diziye bağlanırdı.
        e = resolve_netflix_title("Kurulus Osman", idx("Osman", "Kurulus Osman"))
        assert e is not None and e.name == "Kurulus Osman"

    def test_sezon_ekli_baslik_cozulur(self):
        e = resolve_netflix_title("Kurulus Osman: Season 4", idx("Kurulus Osman"))
        assert e is not None and e.name == "Kurulus Osman"

    def test_cok_kisa_ad_atlanir(self):
        # 4 karakterden kısa adlar yanlış-pozitif riski taşır.
        assert resolve_netflix_title("Kim", idx("Kim")) is None

    def test_alakasiz_baslik_None(self):
        assert resolve_netflix_title("Stranger Things", idx("Anne", "Kurulus Osman")) is None
