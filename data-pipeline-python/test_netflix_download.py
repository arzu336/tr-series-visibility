"""Netflix TSV indirme hattı ve tek geçişli ülke taraması testleri.

Gerçek ağ YOK: `requests.Session` sahte bir sunucuyla değiştiriliyor. Sahte sunucu, gerçek
CDN'de 2026-09-23'te ölçülen iki davranışı da taklit edebiliyor — Range'i yok sayan (200) ve
Range'i destekleyen (206) — böylece kod her ikisinde de doğru davranıyor mu görülür.
"""
from __future__ import annotations

import json
import os
import sqlite3

import pytest

import netflix_country_ranker as nf
import netflix_pipeline
from reytingtv_ranker import SeriesIndexEntry, normalize_title

HEADER = "country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title\tseason_title\tcumulative_weeks_in_top_10\n"


def satir(name, iso2, week, category, rank, title, season="N/A", cum=1) -> str:
    return f"{name}\t{iso2}\t{week}\t{category}\t{rank}\t{title}\t{season}\t{cum}\n"


# Alfabetik ülke sıralı, gerçek dosya yapısında küçük bir örnek. Kasıtlı tuzaklar: Films
# satırı (elenmeli), alt-dize tuzağı "Anne Rice's Mayfair Witches" (eşleşmemeli).
ORNEK_TSV = HEADER + "".join(
    [
        satir("Argentina", "AR", "2026-09-06", "TV", 3, "Kurulus Osman", "Kurulus Osman: Season 4", 2),
        satir("Argentina", "AR", "2026-09-13", "TV", 1, "Kurulus Osman", "Kurulus Osman: Season 4", 3),
        satir("Argentina", "AR", "2026-09-13", "Films", 1, "Sefirin Kizi"),
        satir("Argentina", "AR", "2026-09-13", "TV", 5, "Anne Rice's Mayfair Witches"),
        satir("Brazil", "BR", "2026-09-13", "TV", 2, "Sefirin Kizi", "Sefirin Kizi: Season 1", 1),
        satir("Chile", "CL", "2026-09-13", "TV", 7, "Stranger Things"),
        satir("Denmark", "DK", "2026-09-13", "TV", 4, "Kurulus Osman", "Kurulus Osman: Season 4", 1),
    ]
)
ORNEK_BYTES = ORNEK_TSV.encode("utf-8")
TITLES = ["Kurulus Osman", "Sefirin Kizi", "Anne"]


class SahteYanit:
    def __init__(self, status: int, body: bytes, headers: dict, kes_sonra: int | None = None):
        self.status_code = status
        self._body = body
        self.headers = headers
        self._kes_sonra = kes_sonra  # bu kadar bayttan sonra bağlantı "kopar"

    def raise_for_status(self):
        if self.status_code >= 400:
            raise nf.requests.exceptions.HTTPError(f"{self.status_code}")

    def iter_content(self, chunk_size):
        gonderilen = 0
        for i in range(0, len(self._body), chunk_size):
            parca = self._body[i : i + chunk_size]
            if self._kes_sonra is not None and gonderilen + len(parca) > self._kes_sonra:
                kalan = self._kes_sonra - gonderilen
                if kalan > 0:
                    yield parca[:kalan]
                raise nf.requests.exceptions.ChunkedEncodingError("Connection broken: IncompleteRead")
            gonderilen += len(parca)
            yield parca

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class SahteSunucu:
    """`kesme_plani`: deneme sırasına göre her yanıtın kaç bayttan sonra kopacağı (None = tam).
    `range_destegi`: True ise Range başlığına 206 + kalan gövde döner; False ise yok sayar (200)."""

    def __init__(self, body: bytes, kesme_plani: list, range_destegi: bool, last_modified="Tue, 22 Sep 2026 18:56:01 GMT"):
        self.body = body
        self.kesme_plani = list(kesme_plani)
        self.range_destegi = range_destegi
        self.last_modified = last_modified
        self.istekler: list[dict] = []

    def get(self, url, stream, timeout, headers):
        self.istekler.append(dict(headers))
        kes = self.kesme_plani.pop(0) if self.kesme_plani else None
        rng = headers.get("Range")
        if rng and self.range_destegi:
            offset = int(rng.split("=")[1].rstrip("-"))
            govde = self.body[offset:]
            hdr = {
                "content-range": f"bytes {offset}-{len(self.body) - 1}/{len(self.body)}",
                "content-length": str(len(govde)),
                "last-modified": self.last_modified,
            }
            return SahteYanit(206, govde, hdr, kes)
        hdr = {"content-length": str(len(self.body)), "last-modified": self.last_modified}
        return SahteYanit(200, self.body, hdr, kes)


@pytest.fixture(autouse=True)
def sifirla(monkeypatch):
    """Süreç içi karar hafızasını ve backoff uykusunu her testte sıfırla — testler hızlı kalsın."""
    monkeypatch.setattr(nf, "_COZULMUS_DATASET", None)
    monkeypatch.setattr(nf.time, "sleep", lambda s: None)
    monkeypatch.setattr(nf, "MAX_ATTEMPTS", 4)
    yield
    nf._COZULMUS_DATASET = None


def sunucuyu_tak(monkeypatch, sunucu: SahteSunucu):
    monkeypatch.setattr(nf.requests, "Session", lambda: sunucu)


class TestLooksComplete:
    def test_tam_dosya(self, tmp_path):
        p = tmp_path / "a.tsv"
        p.write_bytes(ORNEK_BYTES)
        assert nf._looks_complete(p, len(ORNEK_BYTES)) is True

    def test_content_length_yoksa_yapisal_kontrol_yeter(self, tmp_path):
        p = tmp_path / "a.tsv"
        p.write_bytes(ORNEK_BYTES)
        assert nf._looks_complete(p, -1) is True

    def test_boyut_uyusmazligi(self, tmp_path):
        p = tmp_path / "a.tsv"
        p.write_bytes(ORNEK_BYTES)
        assert nf._looks_complete(p, len(ORNEK_BYTES) + 1) is False

    def test_kesik_son_satir_tam_sayilmaz(self, tmp_path):
        # Gerçek kısmi dosyaların hepsi böyle bitiyor: "Philippines\tPH\t2023-07-30\t"
        p = tmp_path / "a.tsv"
        kesik = ORNEK_BYTES[:-15]
        p.write_bytes(kesik)
        assert nf._looks_complete(p, -1) is False
        assert nf._looks_complete(p, len(kesik)) is False  # content-length yanlış raporlansa bile

    def test_satir_sonu_var_ama_alan_eksik(self, tmp_path):
        p = tmp_path / "a.tsv"
        p.write_bytes(ORNEK_BYTES + b"Turkey\tTR\t2026\n")
        assert nf._looks_complete(p, -1) is False

    def test_bos_ve_yok(self, tmp_path):
        p = tmp_path / "a.tsv"
        assert nf._looks_complete(p, -1) is False
        p.write_bytes(b"")
        assert nf._looks_complete(p, 0) is False


class TestDownloadRangeYokSayan:
    """Bugünkü gerçek Netflix CDN davranışı: Range → 200 + tam gövde."""

    def test_kopma_sonrasi_bastan_indirir_ve_tamamlar(self, tmp_path, monkeypatch):
        sunucu = SahteSunucu(ORNEK_BYTES, kesme_plani=[120, None], range_destegi=False)
        sunucuyu_tak(monkeypatch, sunucu)

        path, tam = nf.download_dataset(tmp_path)

        assert tam is True
        assert path == tmp_path / nf.FILENAME
        assert path.read_bytes() == ORNEK_BYTES
        # İkinci istekte Range denendi (sunucu yok saydı), kod bunu fark edip baştan yazdı.
        assert "Range" in sunucu.istekler[1]
        assert sunucu.istekler[1]["Range"] == "bytes=120-"
        assert not (tmp_path / "all-weeks-countries.tsv.partial").exists()
        assert not (tmp_path / "all-weeks-countries.tsv.partial.json").exists()

    def test_range_yok_sayildiktan_sonra_bir_daha_range_gondermez(self, tmp_path, monkeypatch):
        sunucu = SahteSunucu(ORNEK_BYTES, kesme_plani=[100, 150, None], range_destegi=False)
        sunucuyu_tak(monkeypatch, sunucu)
        nf.download_dataset(tmp_path)
        # 1. istek: Range yok. 2. istek: Range denendi → 200. 3. istek: artık denenmez.
        assert "Range" not in sunucu.istekler[0]
        assert "Range" in sunucu.istekler[1]
        assert "Range" not in sunucu.istekler[2]

    def test_hep_kopunca_en_uzun_kismi_dosya_ve_meta_kalir(self, tmp_path, monkeypatch):
        sunucu = SahteSunucu(ORNEK_BYTES, kesme_plani=[80, 200, 50, 120], range_destegi=False)
        sunucuyu_tak(monkeypatch, sunucu)

        path, tam = nf.download_dataset(tmp_path)

        assert tam is False
        assert path == tmp_path / "all-weeks-countries.tsv.partial"
        assert path.stat().st_size == 200  # en uzun deneme, son deneme değil
        meta = json.loads((tmp_path / "all-weeks-countries.tsv.partial.json").read_text(encoding="utf-8"))
        assert meta["bytes"] == 200
        assert meta["content_length"] == len(ORNEK_BYTES)
        assert meta["last_modified"] == sunucu.last_modified
        assert len(sunucu.istekler) == 4

    def test_part_gecici_dosyasi_her_durumda_temizlenir(self, tmp_path, monkeypatch):
        part = tmp_path / "all-weeks-countries.tsv.part"
        # 1) Hep kopunca: .partial kalır, .part kalmaz.
        sunucuyu_tak(monkeypatch, SahteSunucu(ORNEK_BYTES, kesme_plani=[80, 200, 50, 120], range_destegi=False))
        nf.download_dataset(tmp_path)
        assert (tmp_path / "all-weeks-countries.tsv.partial").exists()
        assert not part.exists()
        # 2) Başarıda: dest var, .part yok.
        nf._COZULMUS_DATASET = None
        sunucuyu_tak(monkeypatch, SahteSunucu(ORNEK_BYTES, kesme_plani=[None], range_destegi=False))
        nf.download_dataset(tmp_path)
        assert (tmp_path / nf.FILENAME).exists()
        assert not part.exists()

    def test_onceki_surecten_kalan_part_dosyasi_baslangicta_silinir(self, tmp_path, monkeypatch):
        # Süreç yarıda öldürüldü (zaman aşımı/SIGTERM) → 15 MB'lık .part geride kaldı.
        part = tmp_path / "all-weeks-countries.tsv.part"
        part.write_bytes(b"eski surecten kalan yarim veri")
        sunucuyu_tak(monkeypatch, SahteSunucu(ORNEK_BYTES, kesme_plani=[0, 0, 0, 0], range_destegi=False))
        with pytest.raises(RuntimeError):
            nf.download_dataset(tmp_path)
        assert not part.exists()  # istisna yolunda bile temizlendi

    def test_cleanup_temp_files_partial_ve_metaya_dokunmaz(self, tmp_path):
        (tmp_path / "all-weeks-countries.tsv.part").write_bytes(b"x")
        (tmp_path / "all-weeks-countries.tsv.partial").write_bytes(b"y")
        (tmp_path / "all-weeks-countries.tsv.partial.json").write_text("{}")
        assert nf.cleanup_temp_files(tmp_path) == 1
        assert not (tmp_path / "all-weeks-countries.tsv.part").exists()
        assert (tmp_path / "all-weeks-countries.tsv.partial").exists()
        assert (tmp_path / "all-weeks-countries.tsv.partial.json").exists()
        assert nf.cleanup_temp_files(tmp_path) == 0  # idempotent

    def test_offline_mod_da_kalan_part_dosyasini_temizler(self, tmp_path):
        (tmp_path / "all-weeks-countries.tsv.part").write_bytes(b"x")
        (tmp_path / nf.FILENAME).write_bytes(ORNEK_BYTES)
        nf.resolve_local_dataset(tmp_path)
        assert not (tmp_path / "all-weeks-countries.tsv.part").exists()

    def test_hic_veri_gelmezse_hata(self, tmp_path, monkeypatch):
        sunucu = SahteSunucu(ORNEK_BYTES, kesme_plani=[0, 0, 0, 0], range_destegi=False)
        sunucuyu_tak(monkeypatch, sunucu)
        with pytest.raises(RuntimeError, match="hiç veri indirilemedi"):
            nf.download_dataset(tmp_path)


class TestDownloadRangeDestekleyen:
    """CDN bir gün Range açarsa: 206 gelir, mevcut .part'a EKLENİR — kod değişikliği gerekmez."""

    def test_iki_parcadan_birlestirir(self, tmp_path, monkeypatch):
        sunucu = SahteSunucu(ORNEK_BYTES, kesme_plani=[150, None], range_destegi=True)
        sunucuyu_tak(monkeypatch, sunucu)

        path, tam = nf.download_dataset(tmp_path)

        assert tam is True
        assert path.read_bytes() == ORNEK_BYTES  # bayt bayt aynı, ne eksik ne mükerrer
        assert sunucu.istekler[1]["Range"] == "bytes=150-"
        assert sunucu.istekler[1]["If-Range"] == sunucu.last_modified

    def test_uc_parca(self, tmp_path, monkeypatch):
        sunucu = SahteSunucu(ORNEK_BYTES, kesme_plani=[60, 100, None], range_destegi=True)
        sunucuyu_tak(monkeypatch, sunucu)
        path, tam = nf.download_dataset(tmp_path)
        assert tam is True
        assert path.read_bytes() == ORNEK_BYTES
        # 2. deneme 60'tan, 3. deneme 60+100=160'tan devam etti.
        assert sunucu.istekler[1]["Range"] == "bytes=60-"
        assert sunucu.istekler[2]["Range"] == "bytes=160-"


class TestDownloadOnbellek:
    def test_taze_tam_dosya_varsa_ag_kullanilmaz(self, tmp_path, monkeypatch):
        (tmp_path / nf.FILENAME).write_bytes(ORNEK_BYTES)
        sunucu = SahteSunucu(ORNEK_BYTES, kesme_plani=[], range_destegi=False)
        sunucuyu_tak(monkeypatch, sunucu)
        path, tam = nf.download_dataset(tmp_path)
        assert tam is True and path == tmp_path / nf.FILENAME
        assert sunucu.istekler == []

    def test_eski_tam_dosya_yenilenemezse_yine_kullanilir(self, tmp_path, monkeypatch):
        eski = tmp_path / nf.FILENAME
        eski.write_bytes(ORNEK_BYTES[:-1] + b"\n")  # farklı içerik, ayırt edelim
        os.utime(eski, (0, 0))  # 1970 — MAX_AGE_S'den kesinlikle eski
        sunucu = SahteSunucu(ORNEK_BYTES, kesme_plani=[10, 10, 10, 10], range_destegi=False)
        sunucuyu_tak(monkeypatch, sunucu)

        path, tam = nf.download_dataset(tmp_path)

        assert tam is True
        assert path == eski
        assert len(sunucu.istekler) == 4  # yenileme gerçekten denendi
        # Tam ama eski dosya, güncel ama kısmi dosyaya TERCİH edildi: partial sonuç olarak dönmedi.

    def test_eski_tam_dosya_yenilenirse_yenisi_yazilir(self, tmp_path, monkeypatch):
        eski = tmp_path / nf.FILENAME
        eski.write_bytes(b"eski\n")
        os.utime(eski, (0, 0))
        sunucu = SahteSunucu(ORNEK_BYTES, kesme_plani=[None], range_destegi=False)
        sunucuyu_tak(monkeypatch, sunucu)
        path, tam = nf.download_dataset(tmp_path)
        assert tam is True and path.read_bytes() == ORNEK_BYTES

    def test_toplam_sure_siniri_denemeleri_keser(self, tmp_path, monkeypatch):
        monkeypatch.setattr(nf, "TOTAL_DEADLINE_S", 0.0)
        sunucu = SahteSunucu(ORNEK_BYTES, kesme_plani=[None], range_destegi=False)
        sunucuyu_tak(monkeypatch, sunucu)
        with pytest.raises(RuntimeError):
            nf.download_dataset(tmp_path)
        assert sunucu.istekler == []  # süre dolmuş, hiç deneme yapılmadı


class TestScanAllCountries:
    def test_tam_dosyada_tum_ulkeler(self, tmp_path):
        p = tmp_path / "a.tsv"
        p.write_bytes(ORNEK_BYTES)
        by_iso2, complete, truncated = nf.scan_all_countries(p, True, TITLES)

        assert truncated is None
        assert complete == {"AR", "BR", "CL", "DK"}
        # CL bloğu tam ama Türk dizisi yok → complete'te var, sözlükte yok.
        assert set(by_iso2) == {"AR", "BR", "DK"}

        ar = {s.show_title: s for s in by_iso2["AR"]}
        assert set(ar) == {"Kurulus Osman"}  # Films satırı ve "Anne Rice's..." elendi
        assert ar["Kurulus Osman"].weeks_in_top10 == 2
        assert ar["Kurulus Osman"].peak_position == 1
        assert ar["Kurulus Osman"].latest_week == "2026-09-13"
        assert ar["Kurulus Osman"].latest_rank == 1

    def test_kismi_dosyada_son_ulke_yarim_sayilir(self, tmp_path):
        p = tmp_path / "a.tsv"
        # Danimarka satırının ortasında kesilmiş dosya.
        p.write_bytes(ORNEK_BYTES[:-20])
        by_iso2, complete, truncated = nf.scan_all_countries(p, False, TITLES)

        assert truncated == "DK"
        assert "DK" not in complete
        assert "DK" not in by_iso2
        assert complete == {"AR", "BR", "CL"}
        assert set(by_iso2) == {"AR", "BR"}

    def test_kismi_dosyada_son_ulke_TAM_gorunse_bile_yarim_sayilir(self, tmp_path):
        # Dosya tam bir satır sonunda kesilebilir; DK'nın devamı olup olmadığı bilinemez.
        p = tmp_path / "a.tsv"
        p.write_bytes(ORNEK_BYTES)
        _, complete, truncated = nf.scan_all_countries(p, False, TITLES)
        assert truncated == "DK" and "DK" not in complete

    def test_bos_dosya(self, tmp_path):
        p = tmp_path / "a.tsv"
        p.write_bytes(HEADER.encode())
        by_iso2, complete, truncated = nf.scan_all_countries(p, False, TITLES)
        assert by_iso2 == {} and complete == set() and truncated is None

    def test_tek_gecis_ile_ulke_bazli_okuma_ayni_sonucu_verir(self, tmp_path):
        """get_netflix_country_rankings (ülke başına) ile scan_all_countries aynı sayıları
        üretmeli — ortak _accumulate_row bunun garantisi, bu test de regresyon kilidi."""
        p = tmp_path / nf.FILENAME
        p.write_bytes(ORNEK_BYTES)
        by_iso2, _, _ = nf.scan_all_countries(p, True, TITLES)
        for iso2 in ("AR", "BR", "DK"):
            tekil = nf.get_netflix_country_rankings(iso2, TITLES, tmp_path)
            assert sorted(s.model_dump() for s in tekil) == sorted(s.model_dump() for s in by_iso2[iso2])


def idx(*adlar) -> list[SeriesIndexEntry]:
    return [SeriesIndexEntry(tmdb_id=i, name=a, normalized=normalize_title(a)) for i, a in enumerate(adlar, 1)]


class TestSyncAll:
    def test_tam_dosya_tabloyu_eksiksiz_doldurur(self, tmp_path, monkeypatch):
        (tmp_path / nf.FILENAME).write_bytes(ORNEK_BYTES)
        db_path = tmp_path / "pipeline.db"

        sonuc = netflix_pipeline.sync_all(idx("Kurulus Osman", "Sefirin Kizi", "Anne"), cache_dir=tmp_path, db_path=db_path)

        assert sonuc["status"] == "ok"
        assert sonuc["source"] == "tsv"
        assert sonuc["file_complete"] is True
        assert sonuc["truncated_country"] is None
        assert sonuc["countries_complete"] == 4
        assert sonuc["countries_with_matches"] == ["AR", "BR", "DK"]
        assert sonuc["records_written"] == 3
        assert sonuc["unresolved_titles"] == []

        conn = sqlite3.connect(db_path)
        rows = conn.execute(
            "SELECT country_iso2, tmdb_id, matched_title, weeks_in_top10, peak_rank, rank_score, last_week_date "
            "FROM netflix_country_rankings ORDER BY country_iso2"
        ).fetchall()
        conn.close()
        assert [r[0] for r in rows] == ["AR", "BR", "DK"]
        ar = rows[0]
        assert ar[1] == 1 and ar[2] == "Kurulus Osman" and ar[3] == 2 and ar[4] == 1
        assert ar[5] == nf.compute_rank_score(nf.NetflixCountrySignal(show_title="x", weeks_in_top10=2, peak_position=1))
        assert ar[6] == "2026-09-13"
        # countryScoringEngine.js'in sorgusu birebir bu — tablo onun beklediği şekilde dolu.
        conn = sqlite3.connect(db_path)
        row = conn.execute(
            "SELECT rank_score, weeks_in_top10, peak_rank, last_week_date FROM netflix_country_rankings WHERE country_iso2 = ? AND tmdb_id = ?",
            ("BR", 2),
        ).fetchone()
        conn.close()
        assert row is not None and row[2] == 2

    def test_kismi_dosyada_kesilen_ulke_yazilmaz(self, tmp_path, monkeypatch):
        (tmp_path / "all-weeks-countries.tsv.partial").write_bytes(ORNEK_BYTES[:-20])
        # download_dataset'i ağa çıkarmadan "kısmi dosya var" durumuna sok.
        monkeypatch.setattr(nf, "_COZULMUS_DATASET", (tmp_path / "all-weeks-countries.tsv.partial", False))
        db_path = tmp_path / "pipeline.db"

        sonuc = netflix_pipeline.sync_all(idx("Kurulus Osman", "Sefirin Kizi"), cache_dir=tmp_path, db_path=db_path)

        assert sonuc["source"] == "tsv-partial"
        assert sonuc["truncated_country"] == "DK"
        assert sonuc["countries_with_matches"] == ["AR", "BR"]
        conn = sqlite3.connect(db_path)
        ulkeler = {r[0] for r in conn.execute("SELECT country_iso2 FROM netflix_country_rankings")}
        conn.close()
        assert ulkeler == {"AR", "BR"}

    def test_indirme_tamamen_basarisizsa_unavailable_doner_tablo_dokunulmaz(self, tmp_path, monkeypatch):
        sunucu = SahteSunucu(ORNEK_BYTES, kesme_plani=[0, 0, 0, 0], range_destegi=False)
        sunucuyu_tak(monkeypatch, sunucu)
        db_path = tmp_path / "pipeline.db"
        sonuc = netflix_pipeline.sync_all(idx("Kurulus Osman"), cache_dir=tmp_path, db_path=db_path)
        assert sonuc["status"] == "unavailable"
        assert not db_path.exists()

    def test_tekrar_kosu_idempotent(self, tmp_path):
        (tmp_path / nf.FILENAME).write_bytes(ORNEK_BYTES)
        db_path = tmp_path / "pipeline.db"
        seri = idx("Kurulus Osman", "Sefirin Kizi")
        netflix_pipeline.sync_all(seri, cache_dir=tmp_path, db_path=db_path)
        netflix_pipeline.sync_all(seri, cache_dir=tmp_path, db_path=db_path)
        conn = sqlite3.connect(db_path)
        (n,) = conn.execute("SELECT COUNT(*) FROM netflix_country_rankings").fetchone()
        conn.close()
        assert n == 3  # ON CONFLICT ... DO UPDATE, mükerrer satır yok

    def test_eslenemeyen_baslik_raporlanir_yazilmaz(self, tmp_path):
        (tmp_path / nf.FILENAME).write_bytes(ORNEK_BYTES)
        db_path = tmp_path / "pipeline.db"
        # "Sefirin Kizi" katalogda yok → BR'deki eşleşme TMDB'ye bağlanamaz, uydurulmaz.
        sonuc = netflix_pipeline.sync_all(idx("Kurulus Osman"), cache_dir=tmp_path, db_path=db_path)
        assert sonuc["countries_with_matches"] == ["AR", "DK"]
        assert sonuc["unresolved_titles"] == []  # Sefirin Kizi TITLES'ta da yok, hiç sinyal olmadı

    def test_offline_modu_aga_cikmaz_kismi_dosyayi_kullanir(self, tmp_path, monkeypatch):
        (tmp_path / "all-weeks-countries.tsv.partial").write_bytes(ORNEK_BYTES[:-20])
        sunucu = SahteSunucu(ORNEK_BYTES, kesme_plani=[None], range_destegi=False)
        sunucuyu_tak(monkeypatch, sunucu)
        db_path = tmp_path / "pipeline.db"

        sonuc = netflix_pipeline.sync_all(idx("Kurulus Osman", "Sefirin Kizi"), cache_dir=tmp_path, db_path=db_path, offline=True)

        assert sunucu.istekler == []
        assert sonuc["source"] == "tsv-partial" and sonuc["truncated_country"] == "DK"
        assert sonuc["countries_with_matches"] == ["AR", "BR"]

    def test_offline_modu_tam_dosya_varsa_yasina_bakmaz(self, tmp_path, monkeypatch):
        tam = tmp_path / nf.FILENAME
        tam.write_bytes(ORNEK_BYTES)
        os.utime(tam, (0, 0))
        sunucu = SahteSunucu(ORNEK_BYTES, kesme_plani=[None], range_destegi=False)
        sunucuyu_tak(monkeypatch, sunucu)
        sonuc = netflix_pipeline.sync_all(idx("Kurulus Osman"), cache_dir=tmp_path, db_path=tmp_path / "p.db", offline=True)
        assert sunucu.istekler == [] and sonuc["file_complete"] is True

    def test_offline_modu_diskte_hicbir_sey_yoksa_unavailable(self, tmp_path):
        sonuc = netflix_pipeline.sync_all(idx("Kurulus Osman"), cache_dir=tmp_path, db_path=tmp_path / "p.db", offline=True)
        assert sonuc["status"] == "unavailable" and "Çevrimdışı" in sonuc["reason"]

    def test_sync_country_db_path_parametresi(self, tmp_path):
        (tmp_path / nf.FILENAME).write_bytes(ORNEK_BYTES)
        db_path = tmp_path / "pipeline.db"
        sonuc = netflix_pipeline.sync_country("AR", idx("Kurulus Osman"), cache_dir=tmp_path, db_path=db_path)
        assert sonuc["status"] == "ok" and sonuc["resolved_to_tmdb"] == 1
        conn = sqlite3.connect(db_path)
        (n,) = conn.execute("SELECT COUNT(*) FROM netflix_country_rankings WHERE country_iso2='AR'").fetchone()
        conn.close()
        assert n == 1


# Netflix'in İngilizce yayın adları: gerçek kısmi dosyada "The Tailor" 50 ülkede Top 10'a
# girmişken kataloğumuzdaki "Terzi" ile eşleşme sıfırdı (2026-09-23). Bu sınıf o boşluğu kilitler.
INGILIZCE_TSV = (
    HEADER
    + "".join(
        [
            satir("Argentina", "AR", "2026-09-13", "TV", 2, "The Tailor", "The Tailor: Season 3", 4),
            satir("Brazil", "BR", "2026-09-13", "TV", 1, "Another Self", "Another Self: Season 2", 2),
            satir("Brazil", "BR", "2026-09-13", "TV", 6, "The Protector", "The Protector: Season 4", 1),
            satir("Chile", "CL", "2026-09-13", "TV", 9, "Hot Skull", "Hot Skull: Season 1", 1),
            satir("Denmark", "DK", "2026-09-13", "TV", 3, "The Gentlemen", "The Gentlemen: Season 1", 6),
        ]
    )
).encode("utf-8")


def _aka_db(tmp_path, satirlar):
    """imdb_localized_titles × series_mapping içeren küçük bir pipeline.db (tmp içinde)."""
    import db as db_module

    p = tmp_path / "aliases.db"
    conn = sqlite3.connect(p)
    conn.executescript(db_module.SCHEMA)
    for tmdb_id, name, tconst, region, title in satirlar:
        conn.execute("INSERT OR IGNORE INTO series_mapping (tmdb_id, name, dizilah_slug, imdb_id) VALUES (?, ?, ?, ?)", (tmdb_id, name, None, tconst))
        conn.execute("INSERT OR IGNORE INTO imdb_localized_titles (tconst, region, title, is_original) VALUES (?, ?, ?, 0)", (tconst, region, title))
    conn.commit()
    conn.close()
    return p


class TestBaslikTakmaAdlari:
    def test_elle_liste_katalogdaki_diziye_baglanir(self, tmp_path):
        katalog = idx("Terzi", "Zeytin Ağacı", "Kurulus Osman")
        aliases = netflix_pipeline.load_title_aliases(katalog, db_path=tmp_path / "yok.db")
        by_name = {a.name: a.tmdb_id for a in aliases}
        assert by_name["The Tailor"] == 1
        assert by_name["Another Self"] == 2
        # Katalogda olmayan anahtar ("Şahmaran") için takma ad ÜRETİLMEZ.
        assert "Shahmaran" not in by_name

    def test_imdb_aka_otomatik_eklenir(self, tmp_path):
        katalog = idx("Hakan: Muhafız", "Sıcak Kafa")
        dbp = _aka_db(tmp_path, [
            (1, "Hakan: Muhafız", "tt7668518", "US", "The Protector"),
            (1, "Hakan: Muhafız", "tt7668518", "DE", "The Protector"),  # aynı ad, farklı bölge → tek girdi
            (2, "Sıcak Kafa", "tt11988676", "GB", "Hot Skull"),
            (2, "Sıcak Kafa", "tt11988676", "TR", "Sıcak Kafa"),  # katalogla aynı → tekrar eklenmez
        ])
        aliases = netflix_pipeline.load_title_aliases(katalog, db_path=dbp)
        adlar = sorted(a.name for a in aliases)
        assert adlar == ["Hot Skull", "The Protector"]

    def test_sadece_XWW_kaynakli_aka_atlanir(self, tmp_path):
        # Canlı yanlış-pozitifler: Yargı'nın XWW-only "The Prosecutor" AKA'sı 2026'da Meksika'da
        # Top 10'a giren BAŞKA bir diziyle eşleşti. XWW tek başına güvenilir değil.
        katalog = idx("Yargı", "Öyle Bir Geçer Zaman Ki")
        dbp = _aka_db(tmp_path, [
            (1, "Yargı", "tt1", "XWW", "The Prosecutor"),
            (1, "Yargı", "tt1", "XWW", "Family Secrets"),
            (1, "Yargı", "tt1", "US", "Family Secrets"),   # US'de de var → kabul
            (2, "Öyle Bir Geçer Zaman Ki", "tt2", "XWW", "Time Flies"),
            (2, "Öyle Bir Geçer Zaman Ki", "tt2", "DE", "Time Flies"),  # DE güvenilir pazar değil
        ])
        adlar = sorted(a.name for a in netflix_pipeline.load_title_aliases(katalog, db_path=dbp))
        assert adlar == ["Family Secrets"]

    def test_belirsiz_takma_ad_atlanir(self, tmp_path):
        katalog = idx("Dizi A", "Dizi B")
        dbp = _aka_db(tmp_path, [
            (1, "Dizi A", "tt1", "US", "Esaret"),
            (2, "Dizi B", "tt2", "US", "Esaret"),  # aynı AKA iki diziye → uydurma yok, atla
            (1, "Dizi A", "tt1", "GB", "Captivity"),
        ])
        aliases = netflix_pipeline.load_title_aliases(katalog, db_path=dbp)
        assert [a.name for a in aliases] == ["Captivity"]

    def test_katalog_disi_tmdb_id_atlanir(self, tmp_path):
        # series_mapping'de olan ama canlı katalogda (artık) olmayan dizi için takma ad üretilmez.
        dbp = _aka_db(tmp_path, [(999, "Bilinmeyen", "tt9", "US", "Unknown Show")])
        adlar = [a.name for a in netflix_pipeline.load_title_aliases(idx("Terzi"), db_path=dbp)]
        assert "Unknown Show" not in adlar
        assert adlar == ["The Tailor"]

    def test_cok_kisa_takma_ad_atlanir(self, tmp_path):
        dbp = _aka_db(tmp_path, [(1, "Terzi", "tt1", "US", "Ody")])
        adlar = [a.name for a in netflix_pipeline.load_title_aliases(idx("Terzi"), db_path=dbp)]
        assert "Ody" not in adlar and "The Tailor" in adlar

    def test_uctan_uca_ingilizce_basliklar_tabloya_turkce_dizinin_kimligiyle_yazilir(self, tmp_path):
        (tmp_path / nf.FILENAME).write_bytes(INGILIZCE_TSV)
        katalog = idx("Terzi", "Zeytin Ağacı", "Hakan: Muhafız", "Sıcak Kafa")
        dbp = _aka_db(tmp_path, [(3, "Hakan: Muhafız", "tt7668518", "US", "The Protector")])
        series_index = katalog + netflix_pipeline.load_title_aliases(katalog, db_path=dbp)

        sonuc = netflix_pipeline.sync_all(series_index, cache_dir=tmp_path, db_path=dbp)

        assert sonuc["status"] == "ok"
        assert sonuc["countries_with_matches"] == ["AR", "BR", "CL"]
        assert sonuc["records_written"] == 4
        assert sonuc["unresolved_titles"] == []
        conn = sqlite3.connect(dbp)
        rows = conn.execute("SELECT country_iso2, tmdb_id, show_title, matched_title, peak_rank FROM netflix_country_rankings ORDER BY country_iso2, tmdb_id").fetchall()
        conn.close()
        assert rows == [
            ("AR", 1, "The Tailor", "The Tailor", 2),
            ("BR", 2, "Another Self", "Another Self", 1),
            ("BR", 3, "The Protector", "The Protector", 6),
            ("CL", 4, "Hot Skull", "Hot Skull", 9),
        ]
        # "The Gentlemen" (Türk yapımı değil) hiçbir şeye eşleşmedi — DK yazılmadı.
        assert all(r[0] != "DK" for r in rows)
