"""Katalog tamamlama: başlık temizleme, aday seçimi (yalnızca TR yapımı, kurgu, birebir ad), belirsizlerin
kuyruğa gitmesi ve eşleşmemiş liste satırlarının ağa çıkmadan yeniden eşlenmesi."""
from __future__ import annotations

import json
import sqlite3

import catalog_supplement as cs
import db


class TestCleanListTitle:
    def test_kanal_adi_ve_ozet_eki_atilir(self):
        assert cs.clean_list_title("KIRLI SEPETI FOX") == "KIRLI SEPETI"
        assert cs.clean_list_title("KIRLI SEPETI (OZET) FOX") == "KIRLI SEPETI"
        assert cs.clean_list_title("COP ADAM STAR TV") == "COP ADAM"
        assert cs.clean_list_title("KARA AGAC DESTANI TRT 1") == "KARA AGAC DESTANI"
        assert cs.clean_list_title("Maraşlı") == "Maraşlı"

    def test_makale_cumlesi_ve_saat_elenir(self):
        assert cs.clean_list_title("Ünlü oyuncu ilk kez buluştu.") is None
        assert cs.clean_list_title("12:43 itibarıyla son durum") is None
        assert cs.clean_list_title("bir iki üç dört beş altı yedi sekiz kelime") is None
        assert cs.clean_list_title("") is None


def aday(id_, name, country="TR", genres=(18,), original=None, year="2022", lang="tr"):
    return {
        "id": id_,
        "name": name,
        "original_name": original or name,
        "origin_country": [country],
        "original_language": lang,
        "genre_ids": list(genres),
        "first_air_date": f"{year}-01-01",
    }


class TestPickCandidate:
    def test_turkce_olmayan_ya_da_turu_bos_aday_incelemeye(self):
        # TMDB'de menşe TR ama Arapça realite, tür alanı boş
        quwet = aday(336742, "Quwet El Hob", genres=(), lang="ar")
        assert cs.pick_candidate("QUWET EL HOB", [quwet]) == ("review", [quwet])
        # Türkçe ama tür alanı boş (yarışma programı)
        yarisma = aday(20036, "Var mısın? Yok musun?", genres=())
        assert cs.pick_candidate("VAR MISIN YOK MUSUN", [yarisma])[0] == "review"
        # TMDB tipi yanlış olsa da türü Drama olan Türkçe dizi kabul edilir (Yalnız Kurt)
        assert cs.pick_candidate("YALNIZ KURT", [aday(156416, "Yalnız Kurt")])[0] == "accept"

    def test_tek_tr_birebir_aday_kabul(self):
        verdict, c = cs.pick_candidate("KIRLI SEPETI", [aday(1, "Kirli Sepeti"), aday(2, "Kirli Sepeti", "US")])
        assert verdict == "accept" and c[0]["id"] == 1

    def test_yabanci_birebir_ad_ve_alt_dize_kabul_edilmez(self):
        assert cs.pick_candidate("EGO", [aday(5, "Ego", "US")])[0] == "none"
        assert cs.pick_candidate("YALAN", [aday(6, "Yalanci")])[0] == "none"

    def test_yarisma_realite_haber_dizi_degildir(self):
        assert cs.pick_candidate("VAR MISIN YOK MUSUN", [aday(7, "Var mısın? Yok musun?", genres=(10764,))])[0] == "none"

    def test_iki_tr_birebir_aday_belirsiz(self):
        verdict, c = cs.pick_candidate("YALAN", [aday(8, "Yalan", year="2023"), aday(9, "Yalan", year="2012")])
        assert verdict == "ambiguous" and {x["id"] for x in c} == {8, 9}


def test_run_ekler_kuyruga_atar_ve_yeniden_esler(tmp_path):
    # Node kataloğu: yalnızca Uzak Şehir
    node_db = tmp_path / "app.db"
    nconn = sqlite3.connect(node_db)
    nconn.execute("CREATE TABLE cache_entries (key TEXT PRIMARY KEY, value TEXT, expires_at INTEGER, updated_at INTEGER)")
    nconn.execute(
        "INSERT INTO cache_entries VALUES ('raw-series-providers', ?, 0, 0)",
        (json.dumps({"series": [{"id": 274556, "name": "Uzak Şehir"}]}),),
    )
    nconn.commit()
    nconn.close()

    pdb = tmp_path / "pipeline.db"
    conn = db.get_connection(pdb)
    satir = (
        "INSERT INTO chart_entries (provider, platform, country_iso2, period_type, period_date, segment, rank, "
        "series_id, title_raw, program_kind) VALUES (?, ?, ?, 'day', ?, ?, ?, NULL, ?, 'unknown')"
    )
    conn.execute(satir, ("reytingtv", "tv", "TR", "2024-11-25", "Total", 3, "KIRLI SEPETI FOX"))
    conn.execute(satir, ("reytingtv", "tv", "TR", "2024-11-26", "Total", 2, "KIRLI SEPETI (OZET) FOX"))
    conn.execute(satir, ("reytingtv", "tv", "TR", "2024-11-26", "Total", 5, "YALAN KANAL D"))
    conn.execute(satir, ("reytingtv", "tv", "TR", "2024-11-26", "Total", 6, "VAR MISIN YOK MUSUN ATV"))
    conn.execute(satir, ("flixpatrol", "shahid", "MA", "2026-09-30", "shahid", 4, "Maraşlı"))
    conn.execute(satir, ("flixpatrol", "disney", "ES", "2026-09-30", "disney", 1, "Loki"))
    conn.commit()
    conn.close()

    arama = {
        "KIRLI SEPETI": [aday(233492, "Kirli Sepeti", year="2023")],
        "YALAN": [aday(8, "Yalan", year="2023"), aday(9, "Yalan", year="2012")],
        "VAR MISIN YOK MUSUN": [aday(7, "Var mısın? Yok musun?", genres=(10764,))],
        "Maraşlı": [aday(111980, "Maraşlı", year="2021")],
        "Loki": [aday(84958, "Loki", "US")],
    }
    sonuc = cs.run(db_path=pdb, node_db_path=node_db, search=lambda q: arama.get(q, []))

    assert sorted(sonuc["added"]) == ["Kirli Sepeti (2023)", "Maraşlı (2021)"]
    assert sonuc["ambiguous"] == ["YALAN"]
    assert sonuc["rows_rematched"] == 3  # Kirli Sepeti ×2 (Türkiye TV) + Maraşlı (FlixPatrol)

    conn = sqlite3.connect(pdb)
    eklenen = conn.execute("SELECT tmdb_id, list_title, source, already_in_catalog FROM catalog_supplement ORDER BY 1").fetchall()
    assert eklenen == [(111980, "Maraşlı", "flixpatrol", 0), (233492, "KIRLI SEPETI", "reytingtv", 0)]
    kuyruk = conn.execute("SELECT source, raw_title, reason, candidates FROM unresolved_queue").fetchall()
    assert kuyruk[0][:3] == ("catalog_supplement", "YALAN", "ambiguous")
    assert "tmdb:8" in kuyruk[0][3] and "tmdb:9" in kuyruk[0][3]
    eslesen = dict(conn.execute("SELECT title_raw, series_id FROM chart_entries").fetchall())
    assert eslesen["KIRLI SEPETI FOX"] == 233492 and eslesen["KIRLI SEPETI (OZET) FOX"] == 233492
    assert eslesen["Maraşlı"] == 111980
    assert eslesen["YALAN KANAL D"] is None and eslesen["Loki"] is None
    conn.close()

    # İkinci koşu: yeni ekleme yok (aynı diziler tekrar yazılmaz)
    ikinci = cs.run(db_path=pdb, node_db_path=node_db, search=lambda q: arama.get(q, []))
    assert ikinci["added"] == []


def test_dry_run_yazmaz(tmp_path):
    node_db = tmp_path / "app.db"
    nconn = sqlite3.connect(node_db)
    nconn.execute("CREATE TABLE cache_entries (key TEXT PRIMARY KEY, value TEXT, expires_at INTEGER, updated_at INTEGER)")
    nconn.execute("INSERT INTO cache_entries VALUES ('raw-series-providers', ?, 0, 0)", (json.dumps({"series": []}),))
    nconn.commit()
    nconn.close()
    pdb = tmp_path / "pipeline.db"
    conn = db.get_connection(pdb)
    conn.execute(
        "INSERT INTO chart_entries (provider, platform, country_iso2, period_type, period_date, segment, rank, "
        "series_id, title_raw, program_kind) VALUES ('reytingtv','tv','TR','day','2024-01-01','Total',1,NULL,'EGO FOX','unknown')"
    )
    conn.commit()
    conn.close()
    sonuc = cs.run(dry_run=True, db_path=pdb, node_db_path=node_db, search=lambda q: [aday(1, "Ego")])
    assert sonuc["added"] == ["Ego (2022)"]
    conn = sqlite3.connect(pdb)
    assert conn.execute("SELECT COUNT(*) FROM catalog_supplement").fetchone()[0] == 0
    assert conn.execute("SELECT series_id FROM chart_entries").fetchone()[0] is None
    conn.close()
