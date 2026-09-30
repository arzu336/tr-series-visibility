"""Liste sağlayıcı katmanı: ChartEntry, program türü sınıflaması, reytingtv düz yazı ayrıştırıcısı,
Netflix chart_entries yazımı, 52 haftalık aktif pazar kuralı, FlixPatrol'un anahtarsız devre dışı kalması."""
from __future__ import annotations

import datetime
import sqlite3

import pytest

import db
import netflix_country_ranker as nf
import netflix_pipeline
import reytingtv_ranker as rtv
from providers.base import ChartEntry, classify_program_kind
from providers.flixpatrol import FlixPatrolProvider
from providers.netflix_tudum import weekly_rows_to_entries
from providers.reytingtv import parse_article_to_entries
from reytingtv_ranker import SeriesIndexEntry, normalize_title

HEADER = "country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title\tseason_title\tcumulative_weeks_in_top_10\n"


def satir(name, iso2, week, category, rank, title, season="N/A", cum=1) -> str:
    return f"{name}\t{iso2}\t{week}\t{category}\t{rank}\t{title}\t{season}\t{cum}\n"


def idx(*adlar):
    return [SeriesIndexEntry(tmdb_id=i, name=a, normalized=normalize_title(a)) for i, a in enumerate(adlar, 1)]


class TestProgramKind:
    def test_eslesen_dizi_series(self):
        assert classify_program_kind("KURULUŞ OSMAN", 5) == "series"
        # Eşleşse bile kalıp kazanır: MasterChef kataloğa (TMDB tv) düşer ama yarışmadır
        assert classify_program_kind("MASTERCHEF TÜRKİYE", 82117) == "other"
        assert classify_program_kind("MASTERCHEF TURKIYE OZET TV8", 82117) == "other"
        # Özet yayını dizidir
        assert classify_program_kind("DAHA 17 (ÖZET)", 317883) == "series"
        # Sinema kuşağı işaretleri ve ASCII yazımlar
        assert classify_program_kind("GERZEK ŞABAN (T.S)", None) == "other"
        assert classify_program_kind("MUGE ANLI ILE TATLI SERT ATV", None) == "other"
        # Ayrıştırıcının aldığı makale özeti başlık değildir
        assert classify_program_kind("Nisan 2025 reyting sonuçları açıklandı! " * 3, 7) == "unknown"

    def test_haber_yarisma_spor_other(self):
        for p in ["ATV ANA HABER", "MASTERCHEF TÜRKİYE", "SURVIVOR", "GALATASARAY-FENERBAHÇE MAÇI", "MÜGE ANLI İLE TATLI SERT"]:
            assert classify_program_kind(p, None) == "other", p

    def test_eslesmeyen_dizi_unknown(self):
        assert classify_program_kind("Altı Üstü İstanbul", None) == "unknown"


class TestProseParser:
    HTML = (
        "<p>Total kategorisinde zirvede “Portekiz-İspanya Maçı” yer alırken, ikinci sırayı “Altı Üstü İstanbul” aldı. "
        "Üçüncü sırada ise “MasterChef Türkiye” programı bulundu.</p>"
        "<p>AB kategorisinde birinciliği “Portekiz-İspanya Maçı” kazandı. İkinci sırada “Altı Üstü İstanbul” yer alırken, "
        "üçüncü basamakta “MasterChef Türkiye” bulundu.</p>"
        "<p>ABC kategorisinde de zirve yine “Portekiz-İspanya Maçı” oldu.</p>"
    )

    def test_uc_kategori_sira_ve_basliklar(self):
        by = rtv.parse_article(self.HTML)
        assert by["Total"] == [(1, "Portekiz-İspanya Maçı"), (2, "Altı Üstü İstanbul"), (3, "MasterChef Türkiye")]
        assert by["AB"] == [(1, "Portekiz-İspanya Maçı"), (2, "Altı Üstü İstanbul"), (3, "MasterChef Türkiye")]
        assert by["20+ABC1"] == [(1, "Portekiz-İspanya Maçı")]

    def test_satir_ici_numarali_bicim(self):
        html = ("<p>23 Ağustos Pazar Total Reyting İlk 10 1. DAHA 17 — KANAL D 2. DAHA 17 (ÖZET) — KANAL D "
                "3. MASTERCHEF TÜRKİYE — TV8 4. NOW ANA HABER HAFTA SONU — NOW</p>"
                "<p>23 Ağustos Pazar AB Reyting İlk 10 1. MASTERCHEF TÜRKİYE — TV8 2. DAHA 17 — KANAL D 3. DAHA 17 (ÖZET) — KANAL D</p>")
        by = rtv.parse_article(html)
        assert by["Total"][:3] == [(1, "DAHA 17"), (2, "DAHA 17 (ÖZET)"), (3, "MASTERCHEF TÜRKİYE")]
        assert by["Total"][3] == (4, "NOW ANA HABER HAFTA SONU")
        assert by["AB"][0] == (1, "MASTERCHEF TÜRKİYE")

    def test_bicim_taninmazsa_bos(self):
        assert rtv.parse_article("<p>Bugün hava güzel.</p>") == {}

    def test_entries_tam_liste_ve_tur(self):
        entries = parse_article_to_entries(self.HTML, datetime.date(2026, 7, 6), "https://x/6-temmuz", idx("MasterChef Türkiye"), "2026-09-30T00:00:00Z")
        total = [e for e in entries if e.segment == "Total"]
        assert [e.rank for e in total] == [1, 2, 3]
        assert total[2].series_id == 1 and total[2].program_kind == "other"  # eşleşir ama yarışma: kalıp kazanır
        assert total[0].series_id is None and total[0].program_kind == "other"  # Maçı → spor
        assert total[1].program_kind == "unknown"  # katalog dışı, dizi olabilir
        assert all(e.provider == "reytingtv" and e.country_iso2 == "TR" and e.period_type == "day" for e in entries)


class TestChartEntriesDb:
    def test_save_ve_upsert(self, tmp_path):
        conn = db.get_connection(tmp_path / "p.db")
        e = ChartEntry("reytingtv", "tv", "TR", "day", "2026-07-06", "Total", 1, "X", None, "unknown", None, None, "u", "t1")
        assert db.save_chart_entries(conn, [e]) == 1
        e2 = ChartEntry("reytingtv", "tv", "TR", "day", "2026-07-06", "Total", 1, "X", 7, "series", None, None, "u", "t2")
        db.save_chart_entries(conn, [e2])
        rows = conn.execute("SELECT series_id, program_kind, fetched_at FROM chart_entries").fetchall()
        assert rows == [(7, "series", "t2")]
        conn.close()

    def test_netflix_sync_all_chart_entries_yazar(self, tmp_path, monkeypatch):
        tsv = HEADER + "".join([
            satir("Argentina", "AR", "2026-09-06", "TV", 3, "Kurulus Osman"),
            satir("Argentina", "AR", "2026-09-13", "TV", 1, "Kurulus Osman"),
            satir("Brazil", "BR", "2026-09-13", "TV", 2, "Sefirin Kizi"),
            satir("Russia", "RU", "2022-02-27", "TV", 1, "Kurulus Osman"),  # çekilmiş pazar: son satırı 2022
            satir("Zambia", "ZM", "2026-09-13", "TV", 9, "Stranger Things"),
        ])
        (tmp_path / nf.FILENAME).write_bytes(tsv.encode("utf-8"))
        monkeypatch.setattr(nf, "_COZULMUS_DATASET", (tmp_path / nf.FILENAME, True))
        dbp = tmp_path / "pipeline.db"
        sonuc = netflix_pipeline.sync_all(idx("Kurulus Osman", "Sefirin Kizi"), cache_dir=tmp_path, db_path=dbp)
        assert sonuc["chart_entries_written"] == 4
        conn = sqlite3.connect(dbp)
        rows = conn.execute("SELECT provider, country_iso2, period_type, period_date, segment, rank, series_id, program_kind FROM chart_entries ORDER BY 2, 4").fetchall()
        assert rows[0] == ("netflix_tudum", "AR", "week", "2026-09-06", "TV", 3, 1, "series")
        assert len(rows) == 4
        import json
        meta = dict(conn.execute("SELECT key, value FROM pipeline_meta").fetchall())
        conn.close()
        # RU dosyada var (pazar listesi) ama son 52 haftada satırı yok → aktif pazar değil
        assert "RU" in json.loads(meta["netflix_market_countries"])
        assert json.loads(meta["netflix_active_countries_52w"]) == ["AR", "BR", "ZM"]


class TestActiveCountries:
    def test_pencere_disi_ulke_dusur(self):
        aktif = nf.active_countries({"AR": "2026-09-13", "RU": "2022-02-27", "BR": "2025-09-28"}, "2026-09-27")
        assert aktif == ["AR", "BR"]
        assert nf.active_countries({"AR": "2026-09-13"}, None) == []


class TestFlixPatrol:
    # FlixPatrol yöneticilerinin crawl izniyle etkin; StealthyFetcher ile kazınır.
    # Fetch ağ + Cloudflare gerektirdiğinden burada saf parse fonksiyonu test edilir.
    HTML = (
        "<h3>TOP 10 Movies</h3><table>"
        "<tr><td>1.</td><td><a href='/title/bir-film/'>Bir Film</a></td></tr></table>"
        "<h3>TOP 10 TV Shows</h3><table>"
        "<tr><td>1.</td><td><a href='/title/kurulus-osman/'>Kuruluş Osman</a></td></tr>"
        "<tr><td>2.</td><td><a href='/title/masterchef-x/'>MasterChef Celebrity</a></td></tr>"
        "<tr><td>3.</td><td><a href='/title/bilinmeyen-dizi/'>Bilinmeyen Dizi</a></td></tr>"
        "</table>"
    )

    def test_anahtarsiz_etkin_ve_kapatilabilir(self, monkeypatch):
        monkeypatch.delenv("FLIXPATROL_SCRAPE_ENABLED", raising=False)
        assert FlixPatrolProvider().enabled is True
        monkeypatch.setenv("FLIXPATROL_SCRAPE_ENABLED", "0")
        p = FlixPatrolProvider()
        assert p.enabled is False
        with pytest.raises(RuntimeError, match="devre dışı"):
            p.fetch()

    def test_parse_yalnizca_tv_tablosu_ve_eslestirme(self):
        from providers.flixpatrol import parse_top10_tv

        entries = parse_top10_tv(
            self.HTML,
            platform="disney",
            country_iso2="ES",
            period_date="2026-09-30",
            source_url="https://flixpatrol.com/top10/disney/spain/",
            series_index=idx("Kuruluş Osman"),
            fetched_at="t1",
        )
        # Sadece TV Shows tablosu (film hariç), 3 satır
        assert [e.rank for e in entries] == [1, 2, 3]
        assert all(e.provider == "flixpatrol" and e.period_type == "day" for e in entries)
        # PK'de platform yok → segment platformu taşır
        assert all(e.platform == "disney" and e.segment == "disney" for e in entries)
        assert entries[0].series_id == 1 and entries[0].program_kind == "series"  # kataloğa eşleşti
        assert entries[1].series_id is None and entries[1].program_kind == "other"  # MasterChef → yarışma
        assert entries[2].series_id is None and entries[2].program_kind == "unknown"  # katalog dışı

    def test_parse_tv_tablosu_yoksa_bos(self):
        from providers.flixpatrol import parse_top10_tv

        assert parse_top10_tv(
            "<h3>TOP 10 Movies</h3><table><tr><td>1.</td></tr></table>",
            platform="disney", country_iso2="ES", period_date="2026-09-30",
            source_url="u", series_index=[], fetched_at="t",
        ) == []

    def test_iter_pages_tek_oturum_404_yeniden_denenmez_ve_skip(self):
        import providers.flixpatrol as fp

        class Sayfa:
            def __init__(self, status, html=""):
                self.status, self.html_content = status, html

        class Oturum:
            def __init__(self, html):
                self.html, self.urls, self.kapandi = html, [], False

            def fetch(self, url):
                self.urls.append(url)
                return Sayfa(200, self.html) if "/disney/" in url else Sayfa(404)

            def close(self):
                self.kapandi = True

        oturum = Oturum(self.HTML)
        acilis = []

        def ac():
            acilis.append(1)
            return oturum

        p = FlixPatrolProvider(request_delay_s=0)
        ulkeler = {"spain": "ES", "italy": "IT"}
        platformlar = {"disney": "disney", "shahid": "shahid"}
        sayfalar = list(
            p.iter_pages(countries=ulkeler, platforms=platformlar, skip={("ES", "disney")}, open_session=ac, fetched_at="t")
        )
        assert [(i, pl, st, len(r)) for i, pl, st, r in sayfalar] == [
            ("ES", "shahid", 404, 0),
            ("IT", "disney", 200, 3),
            ("IT", "shahid", 404, 0),
        ]
        assert len(acilis) == 1 and oturum.kapandi  # tüm koşu tek oturum, sonunda kapanır
        assert len(oturum.urls) == 3  # 404 yeniden denenmedi, atlanan çifte istek gitmedi
        assert fp.build_url("disney", "spain") not in oturum.urls

    def test_ulke_listesi_platform_dizininden_ve_oncelik_sirasi(self):
        class Sayfa:
            def __init__(self, status, html=""):
                self.status, self.html_content = status, html

        dizin = {
            "https://flixpatrol.com/top10/disney/": "<a href='/top10/disney/albania/'>x</a><a href='/top10/disney/spain/'>x</a>"
            "<a href='/top10/disney/world/'>x</a><a href='/top10/disney/atlantis/'>x</a>",
            "https://flixpatrol.com/top10/shahid/": "<a href='/top10/shahid/iraq/'>x</a>",
        }

        class Oturum:
            urls = []

            def fetch(self, url):
                Oturum.urls.append(url)
                if url in dizin:
                    return Sayfa(200, dizin[url])
                return Sayfa(200, TestFlixPatrol.HTML)

            def close(self):
                pass

        p = FlixPatrolProvider(request_delay_s=0)
        sayfalar = list(
            p.iter_pages(platforms={"disney": "disney", "shahid": "shahid"}, open_session=Oturum, fetched_at="t")
        )
        # world ve ISO kodu bilinmeyen slug atlanır; öncelikli pazar (ES) önce, sonra alfabetik
        assert [(i, pl) for i, pl, _s, _r in sayfalar] == [("ES", "disney"), ("AL", "disney"), ("IQ", "shahid")]
        assert all(len(r) == 3 for _i, _p, _s, r in sayfalar)

    def test_eslestirme_havuzu_flixpatrol_adi_ve_turkce_katlama(self):
        from providers.flixpatrol import build_match_index, match_title

        katalog = [SeriesIndexEntry(283123, "Eşref Rüya", normalize_title("Eşref Rüya")),
                   SeriesIndexEntry(34899, "Muhteşem Yüzyıl", normalize_title("Muhteşem Yüzyıl"))]
        havuz = build_match_index(katalog, extra_aliases=[])
        assert match_title("Esref Ruya", havuz) == 283123
        assert match_title("Magnificent Century", havuz) == 34899
        assert match_title("Magnificent Century: Kösem", havuz) is None  # alt-dize değil, tam ad
        assert match_title("Loki", havuz) is None
        assert build_match_index([]) == []

    def test_iter_pages_is_kalmadiysa_oturum_acmaz(self):
        p = FlixPatrolProvider(request_delay_s=0)

        def ac():
            raise AssertionError("oturum açılmamalıydı")

        assert list(p.iter_pages(countries={"spain": "ES"}, platforms={"disney": "disney"}, skip={("ES", "disney")}, open_session=ac)) == []

    def test_runner_sayfa_sayfa_kaydeder_ve_kaldigi_yerden_devam_eder(self, tmp_path):
        import fetch_flixpatrol as ff
        from providers.flixpatrol import parse_top10_tv

        bugun = datetime.date.today().isoformat()

        def satirlar(iso2):
            return parse_top10_tv(
                self.HTML, platform="disney", country_iso2=iso2, period_date=bugun,
                source_url="u", series_index=[], fetched_at="t",
            )

        class YaridaKesilen:
            enabled = True

            def iter_pages(self, skip=None, **kw):
                yield "ES", "disney", 200, satirlar("ES")
                raise RuntimeError("bağlantı koptu")

        class Devam:
            enabled = True
            gelen_skip = None

            def iter_pages(self, skip=None, **kw):
                Devam.gelen_skip = skip
                yield "IT", "disney", 200, satirlar("IT")
                yield "IT", "shahid", 404, []

        dbp = tmp_path / "p.db"
        with pytest.raises(RuntimeError):
            ff.run(db_path=dbp, provider=YaridaKesilen())
        conn = sqlite3.connect(dbp)
        assert conn.execute("SELECT COUNT(*) FROM chart_entries WHERE provider='flixpatrol'").fetchone()[0] == 3
        conn.close()

        sonuc = ff.run(db_path=dbp, provider=Devam())
        assert Devam.gelen_skip == {("ES", "disney")}
        assert (sonuc["status"], sonuc["chart_entries_written"], sonuc["pages"], sonuc["empty_pages"]) == ("ok", 3, 2, 1)
        assert sonuc["skipped_pairs"] == 1


def test_weekly_rows_to_entries():
    e = weekly_rows_to_entries([("AR", "2026-09-13", 5, "Kurulus Osman", 1)], "t")[0]
    assert (e.provider, e.platform, e.period_type, e.segment, e.series_id, e.rank) == ("netflix_tudum", "netflix", "week", "TV", 5, 1)
    assert e.source_url == nf.DATA_URL
