"""netflix_fetch_source.py (Actions'ta indir + doğrula) ve netflix_import_artifact.py (yerelde içe al)
testleri. Ağ yok: download_dataset monkeypatch'lenir; eşikler küçük örnek dosya için düşürülür."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import netflix_country_ranker as nf
import netflix_fetch_source as fs
import netflix_import_artifact as ia

HEADER = "country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title\tseason_title\tcumulative_weeks_in_top_10\n"


def satir(name, iso2, week, category, rank, title, season="N/A", cum=1) -> str:
    return f"{name}\t{iso2}\t{week}\t{category}\t{rank}\t{title}\t{season}\t{cum}\n"


TAM_TSV = HEADER + "".join(
    [
        satir("Argentina", "AR", "2026-09-06", "TV", 3, "Kurulus Osman"),
        satir("Argentina", "AR", "2026-09-13", "TV", 1, "Kurulus Osman"),
        satir("Brazil", "BR", "2026-09-13", "TV", 2, "Sefirin Kizi"),
        satir("Denmark", "DK", "2026-09-13", "Films", 4, "Kurulus Osman"),
    ]
)


@pytest.fixture(autouse=True)
def kucuk_esikler(monkeypatch):
    # Gerçek dosya eşikleri (100 bin satır, 60 ülke) örnek dosyaya uymaz; sözleşmeyi değil eşiği küçült.
    monkeypatch.setattr(fs, "MIN_ROWS_FOR_REAL_FILE", 3)
    monkeypatch.setattr(fs, "MIN_COUNTRIES_FOR_REAL_FILE", 3)


def yaz(path: Path, metin: str) -> Path:
    path.write_bytes(metin.encode("utf-8"))
    return path


class TestInspectVerify:
    def test_tam_dosya_ozeti(self, tmp_path):
        p = yaz(tmp_path / "a.tsv", TAM_TSV)
        s = fs.verify_source(p, downloader_says_complete=True)
        assert s["complete"] is True and s["reason"] is None
        assert s["rows"] == 4 and s["countries"] == 3
        assert (s["first_country"], s["last_country"]) == ("AR", "DK")
        assert (s["first_week"], s["last_week"]) == ("2026-09-06", "2026-09-13")
        assert s["header_ok"] and s["structural_ok"]

    def test_indirici_kismi_dedi_ise_yapisal_tam_gorunse_de_kismi(self, tmp_path):
        p = yaz(tmp_path / "a.tsv.partial", TAM_TSV)
        s = fs.verify_source(p, downloader_says_complete=False)
        assert s["complete"] is False
        assert "indirici" in s["reason"]

    def test_kesik_son_satir(self, tmp_path):
        p = yaz(tmp_path / "a.tsv", TAM_TSV + "Egypt\tEG\t2026-09-13\tTV\t1\tYar")
        s = fs.verify_source(p, downloader_says_complete=True)
        assert s["complete"] is False
        assert "kesik" in s["reason"]
        assert s["last_country"] == "DK"  # kesik satır sayıma girmez

    def test_yanlis_baslik_html_hata_sayfasi(self, tmp_path):
        p = yaz(tmp_path / "a.tsv", "<html><body>Access Denied</body></html>\n")
        s = fs.verify_source(p, downloader_says_complete=True)
        assert s["complete"] is False
        assert "başlık" in s["reason"] and "satır sayısı" in s["reason"]

    def test_gercek_dosya_esikleri_kucuk_dosyayi_reddeder(self, tmp_path, monkeypatch):
        monkeypatch.setattr(fs, "MIN_ROWS_FOR_REAL_FILE", 100_000)
        p = yaz(tmp_path / "a.tsv", TAM_TSV)
        s = fs.verify_source(p, downloader_says_complete=True)
        assert s["complete"] is False and "çok düşük" in s["reason"]


class TestSatirSonuOlmayanTamDosya:
    """GitHub Actions'tan inen gerçek dosya \\n ile bitmiyor; content-length biliniyorsa tam sayılmalı."""

    def test_content_length_bilinirken_tam(self, tmp_path):
        govde = TAM_TSV.rstrip("\n")
        p = yaz(tmp_path / "a.tsv", govde)
        s = fs.verify_source(p, downloader_says_complete=True, expected=len(govde.encode("utf-8")))
        assert s["complete"] is True and s["structural_ok"] is True
        assert s["content_length"] == len(govde.encode("utf-8"))
        assert s["last_country"] == "DK" and s["rows"] == 4

    def test_content_length_bilinmiyorsa_siki_kural(self, tmp_path):
        p = yaz(tmp_path / "a.tsv", TAM_TSV.rstrip("\n"))
        s = fs.verify_source(p, downloader_says_complete=True)  # expected=-1
        assert s["complete"] is False
        assert "content-length bilinmiyor" in s["reason"]

    def test_known_content_length_yandaki_meta_ve_ozetten(self, tmp_path):
        govde = TAM_TSV.rstrip("\n").encode("utf-8")
        p = tmp_path / nf.FILENAME
        p.write_bytes(govde)
        assert fs.known_content_length(p) == -1
        (tmp_path / (nf.FILENAME + ".json")).write_text(json.dumps({"content_length": len(govde) + 5}))
        assert fs.known_content_length(p) == -1  # boyutla eşleşmeyen değer bilinmiyor sayılır
        (tmp_path / (nf.FILENAME + ".json")).write_text(json.dumps({"content_length": len(govde)}))
        assert fs.known_content_length(p) == len(govde)
        (tmp_path / (nf.FILENAME + ".json")).unlink()
        (tmp_path / fs.SUMMARY_FILENAME).write_text(json.dumps({"content_length": len(govde)}))
        assert fs.known_content_length(p) == len(govde)

    def test_fetch_kismi_dosyada_meta_content_length_i_gecirir(self, tmp_path, monkeypatch):
        govde = TAM_TSV.rstrip("\n").encode("utf-8")
        p = tmp_path / (nf.FILENAME + ".partial")
        p.write_bytes(govde)
        (tmp_path / (nf.FILENAME + ".partial.json")).write_text(json.dumps({"content_length": len(govde)}))
        monkeypatch.setattr(nf, "download_dataset", lambda cache_dir, force=False: (p, False))
        s = fs.fetch(tmp_path)
        # yapısal kontrol geçer ama indirici "eksik" dediği için tam sayılmaz — karar indiricinin
        assert s["structural_ok"] is True and s["content_length"] == len(govde)
        assert s["complete"] is False and "indirici" in s["reason"]


class TestFetchMain:
    def test_tam_indirme_cikis_0_ve_ozet_json(self, tmp_path, monkeypatch):
        p = yaz(tmp_path / nf.FILENAME, TAM_TSV)
        monkeypatch.setattr(nf, "download_dataset", lambda cache_dir, force=False: (p, True))
        kod = fs.main(["--cache-dir", str(tmp_path)])
        assert kod == 0
        ozet = json.loads((tmp_path / fs.SUMMARY_FILENAME).read_text(encoding="utf-8"))
        assert ozet["complete"] is True
        assert ozet["source_url"] == nf.DATA_URL
        assert ozet["last_week"] == "2026-09-13"

    def test_kismi_indirme_cikis_1_ozet_yine_yazilir(self, tmp_path, monkeypatch):
        p = yaz(tmp_path / (nf.FILENAME + ".partial"), TAM_TSV[:-20])
        monkeypatch.setattr(nf, "download_dataset", lambda cache_dir, force=False: (p, False))
        ozet_yolu = tmp_path / "ozet.json"
        kod = fs.main(["--cache-dir", str(tmp_path), "--summary-json", str(ozet_yolu)])
        assert kod == 1
        ozet = json.loads(ozet_yolu.read_text(encoding="utf-8"))
        assert ozet["complete"] is False
        assert "indirici" in ozet["reason"]

    def test_ag_hic_yoksa_cikis_2(self, tmp_path, monkeypatch):
        def patlat(cache_dir, force=False):
            raise RuntimeError("hiç veri gelmedi")

        monkeypatch.setattr(nf, "download_dataset", patlat)
        kod = fs.main(["--cache-dir", str(tmp_path)])
        assert kod == 2
        ozet = json.loads((tmp_path / fs.SUMMARY_FILENAME).read_text(encoding="utf-8"))
        assert ozet["complete"] is False and "başlayamadı" in ozet["reason"]

    def test_varsayilan_force_true_no_force_ile_kapanir(self, tmp_path, monkeypatch):
        p = yaz(tmp_path / nf.FILENAME, TAM_TSV)
        gorulen = {}

        def sahte(cache_dir, force=False):
            gorulen["force"] = force
            return p, True

        monkeypatch.setattr(nf, "download_dataset", sahte)
        fs.main(["--cache-dir", str(tmp_path)])
        assert gorulen["force"] is True
        fs.main(["--cache-dir", str(tmp_path), "--no-force"])
        assert gorulen["force"] is False


class TestImportArtifact:
    def test_baska_yerden_kopyalar_ve_kismi_kalintilari_siler(self, tmp_path):
        indirilen = yaz(tmp_path / "indir" / "x.tsv", TAM_TSV) if (tmp_path / "indir").mkdir() is None else None
        cache = tmp_path / "data"
        cache.mkdir()
        (cache / (nf.FILENAME + ".partial")).write_bytes(b"eski")
        (cache / (nf.FILENAME + ".partial.json")).write_text("{}")
        (cache / (nf.FILENAME + ".part")).write_bytes(b"yarim")
        dest = ia.import_source(indirilen, cache)
        assert dest == cache / nf.FILENAME
        assert dest.read_bytes() == TAM_TSV.encode("utf-8")
        assert not (cache / (nf.FILENAME + ".partial")).exists()
        assert not (cache / (nf.FILENAME + ".partial.json")).exists()
        assert not (cache / (nf.FILENAME + ".part")).exists()

    def test_yerinde_dogrular_kopyalamaz(self, tmp_path):
        dest = yaz(tmp_path / nf.FILENAME, TAM_TSV)
        once = dest.stat().st_mtime_ns
        assert ia.import_source(dest, tmp_path) == dest
        assert dest.stat().st_mtime_ns == once

    def test_satir_sonsuz_tam_dosya_meta_ile_ice_alinir_metasiz_reddedilir(self, tmp_path):
        govde = TAM_TSV.rstrip("\n").encode("utf-8")
        src = tmp_path / "indir" / (nf.FILENAME + ".partial")
        src.parent.mkdir()
        src.write_bytes(govde)
        cache = tmp_path / "data"
        with pytest.raises(ValueError, match="content-length bilinmiyor"):
            ia.import_source(src, cache)
        (tmp_path / "indir" / (nf.FILENAME + ".partial.json")).write_text(json.dumps({"content_length": len(govde)}))
        dest = ia.import_source(src, cache)
        assert dest.read_bytes() == govde

    def test_kesik_dosya_ice_alinmaz(self, tmp_path):
        src = yaz(tmp_path / "x.tsv", TAM_TSV[:-5])
        cache = tmp_path / "data"
        with pytest.raises(ValueError, match="tam değil"):
            ia.import_source(src, cache)
        assert not (cache / nf.FILENAME).exists()

    def test_main_no_run_ve_pipeline_cagrisi(self, tmp_path, monkeypatch):
        yaz(tmp_path / nf.FILENAME, TAM_TSV)
        assert ia.main([str(tmp_path / nf.FILENAME), "--cache-dir", str(tmp_path), "--no-run"]) == 0
        cagrildi = {}
        monkeypatch.setattr(ia, "run_pipeline_offline", lambda: cagrildi.setdefault("ok", True) and 0)
        assert ia.main(["--cache-dir", str(tmp_path)]) == 0
        assert cagrildi == {"ok": True}

    def test_main_dosya_yoksa_1(self, tmp_path):
        assert ia.main([str(tmp_path / "yok.tsv"), "--cache-dir", str(tmp_path)]) == 1

    def test_run_pipeline_offline_dogru_komut(self, monkeypatch):
        gorulen = {}

        class Sonuc:
            returncode = 0

        def sahte_run(cmd, cwd=None):
            gorulen["cmd"] = cmd
            gorulen["cwd"] = cwd
            return Sonuc()

        monkeypatch.setattr(ia.subprocess, "run", sahte_run)
        assert ia.run_pipeline_offline(python="py") == 0
        assert gorulen["cmd"][0] == "py"
        assert gorulen["cmd"][1].endswith("netflix_pipeline.py")
        assert gorulen["cmd"][2:] == ["--all", "--offline"]
        assert gorulen["cwd"] == ia.BASE_DIR
