"""IMDb puan/oy senkronu: kimlik eşlemesi (yalnızca TMDB external_ids), kataloğa süzme ve günlük geçmiş."""
from __future__ import annotations

import gzip
import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone

import db
import imdb_sync


def node_db(tmp_path, ids):
    path = tmp_path / "app.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE cache_entries (key TEXT PRIMARY KEY, value TEXT, expires_at INTEGER)")
    series = [{"id": i, "name": f"Dizi {i}"} for i in ids]
    conn.execute("INSERT INTO cache_entries VALUES ('raw-series-providers', ?, 0)", (json.dumps({"series": series}),))
    conn.commit()
    conn.close()
    return path


def ratings_gz(tmp_path, rows, day):
    path = tmp_path / "title.ratings.tsv.gz"
    with gzip.open(path, "wt", encoding="utf-8") as f:
        f.write("tconst\taverageRating\tnumVotes\n")
        for tconst, rating, votes in rows:
            f.write(f"{tconst}\t{rating}\t{votes}\n")
    ts = datetime.fromisoformat(f"{day}T12:00:00+00:00").timestamp()
    os.utime(path, (ts, ts))
    return path


NOW = datetime(2026, 10, 2, 13, 0, tzinfo=timezone.utc)


def test_katalog_icin_puan_ve_gunluk_gecmis(tmp_path):
    pdb = tmp_path / "pipeline.db"
    ndb = node_db(tmp_path, [1, 2, 3])
    sorulan = []

    def external_ids(tid):
        sorulan.append(tid)
        return {1: {"imdb_id": "tt0000001"}, 2: {"imdb_id": None}, 3: {"imdb_id": "gecersiz"}}[tid]

    # Katalog dışı tt9999999 dosyada olsa da yazılmaz.
    r1 = ratings_gz(tmp_path, [("tt0000001", 8.1, 1000), ("tt9999999", 5.0, 10)], "2026-10-01")
    out = imdb_sync.run(pdb, ndb, tmp_path, fetch_external_ids=external_ids, ratings_path=r1, now=NOW, details=False)
    assert out["rated"] == 1 and out["mapped"] == 1
    assert out["resolved"] == {"found": 1, "no_imdb_id": 2, "failed": 0}  # None ve geçersiz biçim → eşleme yok

    # Ertesi gün: kimlikler yeniden sorulmaz, geçmişe ikinci gün eklenir.
    r2 = ratings_gz(tmp_path, [("tt0000001", 8.2, 1300)], "2026-10-02")
    imdb_sync.run(pdb, ndb, tmp_path, fetch_external_ids=external_ids, ratings_path=r2, now=NOW + timedelta(days=1), details=False)
    assert sorulan == [1, 2, 3]

    conn = db.get_connection(pdb)
    assert conn.execute("SELECT average_rating, num_votes FROM imdb_series WHERE tconst='tt0000001'").fetchone() == (
        8.2,
        1300,
    )
    gecmis = conn.execute("SELECT snapshot_date, num_votes FROM imdb_rating_history ORDER BY snapshot_date").fetchall()
    assert gecmis == [("2026-10-01", 1000), ("2026-10-02", 1300)]
    conn.close()


def test_eslemesi_olmayan_30_gun_sonra_yeniden_sorulur(tmp_path):
    pdb = tmp_path / "pipeline.db"
    conn = db.get_connection(pdb)
    eski = (NOW - timedelta(days=31)).isoformat()
    yeni = (NOW - timedelta(days=2)).isoformat()
    conn.executemany(
        "INSERT INTO imdb_title_map VALUES (?, ?, ?)", [(1, None, eski), (2, None, yeni), (3, "tt0000003", eski)]
    )
    assert imdb_sync.ids_to_resolve(conn, {1, 2, 3, 4}, NOW) == [1, 4]
    conn.close()


def test_series_mapping_kimlikleri_tmdbye_sorulmadan_kullanilir(tmp_path):
    pdb = tmp_path / "pipeline.db"
    conn = db.get_connection(pdb)
    conn.execute("INSERT INTO series_mapping VALUES (1, 'Dizi 1', 'dizi-1', 'tt0000001')")
    conn.commit()
    conn.close()
    ndb = node_db(tmp_path, [1])
    r = ratings_gz(tmp_path, [("tt0000001", 7.0, 50)], "2026-10-01")

    def external_ids(tid):
        raise AssertionError("sorulmamalı")

    out = imdb_sync.run(pdb, ndb, tmp_path, fetch_external_ids=external_ids, ratings_path=r, now=NOW, details=False)
    assert out["seeded_from_mapping"] == 1 and out["rated"] == 1


def tsv_gz(tmp_path, name, header, rows):
    path = tmp_path / name
    with gzip.open(path, "wt", encoding="utf-8") as f:
        f.write("\t".join(header) + "\n")
        for r in rows:
            f.write("\t".join(r) + "\n")
    return path


NA = "\\N"  # IMDb TSV'lerinde boş değer


def test_haftalik_ayrinti_bolumler_ekip_yerel_adlar(tmp_path):
    pdb = tmp_path / "pipeline.db"
    ndb = node_db(tmp_path, [1])
    paths = {
        "episode": tsv_gz(
            tmp_path,
            "e.tsv.gz",
            ["tconst", "parentTconst", "seasonNumber", "episodeNumber"],
            [["tt1001", "tt0000001", "1", "1"], ["tt1002", "tt0000001", "1", "2"], ["tt9001", "tt9999999", "1", "1"]],
        ),
        "crew": tsv_gz(
            tmp_path,
            "c.tsv.gz",
            ["tconst", "directors", "writers"],
            [
                ["tt0000001", NA, "nm3"],  # dizinin kendi kaydı: bölümde geçmeyen senarist → 0 bölüm
                ["tt1001", "nm1", "nm2"],
                ["tt1002", "nm1", NA],
                ["tt9001", "nm9", "nm9"],  # katalog dışı
            ],
        ),
        "names": tsv_gz(
            tmp_path,
            "n.tsv.gz",
            ["nconst", "primaryName"],
            [["nm1", "Yönetmen Bir"], ["nm2", "Senarist İki"], ["nm3", "Senarist Üç"], ["nm9", "Başka"]],
        ),
        "akas": tsv_gz(
            tmp_path,
            "a.tsv.gz",
            ["titleId", "ordering", "title", "region", "language", "types", "attributes", "isOriginalTitle"],
            [
                ["tt0000001", "1", "Dizi Bir", "TR", "tr", NA, NA, "0"],
                ["tt0000001", "2", "Series One", "US", "en", NA, NA, "0"],
                ["tt0000001", "3", "Series One", "US", "en", "imdbDisplay", NA, "0"],  # tekrar
                ["tt0000001", "4", "Series One", "XWW", "en", NA, NA, "0"],  # ülke değil
            ],
        ),
    }
    r = ratings_gz(tmp_path, [("tt0000001", 8.0, 900), ("tt1001", 8.5, 40)], "2026-10-02")
    out = imdb_sync.run(
        pdb, ndb, tmp_path, fetch_external_ids=lambda tid: {"imdb_id": "tt0000001"}, ratings_path=r,
        now=NOW, details=True, detail_paths=paths, fetch_crew=lambda tid: [],
    )
    assert out["details"]["episodes"] == 2 and out["details"]["crew"] == 3
    assert out["details"]["localized_titles"] == 2
    assert out["rated_episodes"] == 1

    conn = db.get_connection(pdb)
    assert conn.execute("SELECT tconst, season, episode, average_rating FROM imdb_episodes ORDER BY tconst").fetchall() == [
        ("tt1001", 1, 1, 8.5),
        ("tt1002", 1, 2, None),
    ]
    assert conn.execute("SELECT role, name, episode_count FROM imdb_crew ORDER BY role, name").fetchall() == [
        ("director", "Yönetmen Bir", 2),
        ("writer", "Senarist Üç", 0),
        ("writer", "Senarist İki", 1),
    ]
    assert conn.execute("SELECT region, title FROM imdb_localized_titles ORDER BY region").fetchall() == [
        ("TR", "Dizi Bir"),
        ("US", "Series One"),
    ]
    # Haftalık kapı: ayrıntı aşaması az önce çalıştı
    assert imdb_sync.details_due(conn, NOW + timedelta(days=1)) is False
    assert imdb_sync.details_due(conn, NOW + timedelta(days=7)) is True
    conn.close()


def test_ekip_adlari_tmdb_yazimiyla_duzeltilir(tmp_path):
    conn = db.get_connection(tmp_path / "pipeline.db")
    conn.execute("INSERT INTO imdb_title_map VALUES (1, 'tt1', 'x')")
    conn.executemany(
        "INSERT INTO imdb_crew (parent_tconst, role, nconst, name, episode_count) VALUES ('tt1', ?, ?, ?, 1)",
        [("writer", "nm1", "Asli Zeynep Peker Bozdag"), ("director", "nm2", "Ahmet Yilmaz"), ("director", "nm3", "John Smith")],
    )
    conn.commit()
    tmdb = [
        {"name": "Aslı Zeynep Peker Bozdağ", "original_name": "Aslı Zeynep Peker Bozdağ"},
        {"name": "Ahmet Yılmaz", "original_name": "Ahmet Yilmaz"},
        {"name": "Mehmet Bozdağ"},  # IMDb'de yok, kimseye atanmaz
    ]
    out = imdb_sync.localize_crew_names(conn, lambda tid: tmdb)
    assert out == {"series": 1, "renamed_rows": 2, "searched": 0, "failed": 0}
    assert conn.execute("SELECT nconst, name FROM imdb_crew ORDER BY nconst").fetchall() == [
        ("nm1", "Aslı Zeynep Peker Bozdağ"),
        ("nm2", "Ahmet Yılmaz"),
        ("nm3", "John Smith"),  # TMDB'de karşılığı yok → dokunulmaz
    ]
    assert imdb_sync.fold_name("Aslı Zeynep Peker Bozdağ") == imdb_sync.fold_name("Asli Zeynep Peker Bozdag")
    conn.close()


def test_ekip_listesinde_olmayan_ad_kisi_aramasiyla_duzeltilir(tmp_path):
    conn = db.get_connection(tmp_path / "pipeline.db")
    conn.execute("INSERT INTO imdb_title_map VALUES (1, 'tt1', 'x')")
    conn.executemany(
        "INSERT INTO imdb_crew (parent_tconst, role, nconst, name, episode_count) VALUES ('tt1', 'writer', ?, ?, 1)",
        [("nm1", "Fatmanur Guldali"), ("nm2", "Can Yilmaz")],
    )
    conn.commit()
    arama = {
        "Fatmanur Guldali": [{"name": "Fatmanur Güldalı"}],
        "Can Yilmaz": [{"name": "Cansu Yılmaz"}],  # sadeleştirilmiş hâli farklı → başka kişi, atanmaz
    }
    out = imdb_sync.localize_crew_names(conn, lambda tid: [], lambda name: arama.get(name, []))
    assert out["renamed_rows"] == 1 and out["searched"] == 2
    assert [r[0] for r in conn.execute("SELECT name FROM imdb_crew ORDER BY nconst")] == ["Fatmanur Güldalı", "Can Yilmaz"]
    conn.close()
