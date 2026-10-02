"""IMDb puan/oy senkronu — OMDb'nin yerine IMDb'nin resmî Non-Commercial Datasets dosyaları.

NEDEN
-----
Puanlar önceden OMDb'den (üçüncü taraf, IMDb verisini yeniden sunan bir servis; anahtar ve günlük istek
sınırı) sayfa açıldıkça tek tek çekiliyordu: 471 dizinin yalnızca ~100'ünde puan vardı. IMDb'nin kendi
günlük güncellenen title.ratings dosyası (~9 MB, datasets.imdbws.com) katalogdaki TÜM dizilerin puanını
tek seferde verir; dış istek, anahtar ve kota yok.

NE YAPAR (günlük, server/services/imdbRunner.js tetikler)
--------------------------------------------------------
1. Katalog (Node'un canlı TMDB listesi + catalog_supplement) için TMDB → IMDb kimliği (tconst) eşlemesi:
   yalnızca TMDB'nin external_ids alanından — isimden tahminle eşleme YOK (kimlik katmanı ilkesi).
   Eşlemesi olmayanlar 30 günde bir yeniden sorulur.
2. title.ratings dosyası 20 saatten eskiyse yeniden indirilir.
3. Katalogdaki diziler için güncel puan/oy imdb_series'e, o günün değeri imdb_rating_history'ye yazılır.
   Geçmiş, "son 7/30 günde kaç oy aldı" ölçüsünün kaynağıdır (oy artışı = dizinin dünyadaki ilgisi;
   Netflix listesinden düşmüş eski diziler için de çalışır). Bölüm puanları da her gün güncellenir.
4. Haftada bir (ayrıntı aşaması, ~950 MB indirme): bölüm listesi (title.episode), yönetmen/senarist
   (title.crew + name.basics; bölüm sayısıyla) ve ülkelere göre yerel adlar (title.akas).

LİSANS: IMDb Non-Commercial Datasets — kişisel ve ticari olmayan kullanım. Lisans, verinin gösterildiği
yerde IMDb kaynak ibaresi istiyor; arayüzden kullanıcı kararıyla kaldırıldı (2026-10-02) — kurum içi
kullanım dışına açılırsa yeniden değerlendirilmeli.

Kullanım:
    python imdb_sync.py              # günlük; ayrıntı aşaması haftalık kapıya göre
    python imdb_sync.py --details    # ayrıntı aşamasını şimdi zorla
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

import db
import imdb_dataset
import reytingtv_ranker as rtv
from logsetup import get_logger

log = get_logger(__name__)

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "data" / "pipeline.db"
NODE_DB_PATH = BASE_DIR.parent / "server" / "data" / "app.db"
CACHE_DIR = BASE_DIR / "data"
load_dotenv(BASE_DIR.parent / "server" / ".env")

TMDB_EXTERNAL_IDS_URL = "https://api.themoviedb.org/3/tv/{id}/external_ids"
REQUEST_DELAY_S = 0.05
RATINGS_MAX_AGE = timedelta(hours=20)
# Bölüm listesi, ekip ve yerel adlar yavaş değişir; büyük dosyalar (toplam ~950 MB) haftada bir indirilir.
DETAILS_INTERVAL = timedelta(days=7)
DETAILS_MAX_AGE = timedelta(days=6)
DETAIL_KEYS = ("episode", "crew", "names", "akas")
UNMAPPED_RECHECK = timedelta(days=30)
TCONST_RE = re.compile(r"^tt\d{5,}$")
RESULT_MARKER = "RESULT_JSON "


def catalog_tmdb_ids(conn: sqlite3.Connection, node_db_path: Path) -> set[int]:
    ids = {e.tmdb_id for e in rtv.load_tmdb_series_index(node_db_path)}
    ids |= {r[0] for r in conn.execute("SELECT tmdb_id FROM catalog_supplement")}
    return ids


def ids_to_resolve(conn: sqlite3.Connection, tmdb_ids: set[int], now: datetime) -> list[int]:
    """Eşlemesi hiç sorulmamış ya da 30 günden önce sorulup bulunamamış diziler."""
    rows = {r[0]: (r[1], r[2]) for r in conn.execute("SELECT tmdb_id, tconst, resolved_at FROM imdb_title_map")}
    out = []
    for tid in sorted(tmdb_ids):
        if tid not in rows:
            out.append(tid)
            continue
        tconst, resolved_at = rows[tid]
        if tconst is None and (now - datetime.fromisoformat(resolved_at)) >= UNMAPPED_RECHECK:
            out.append(tid)
    return out


def valid_tconst(value) -> str | None:
    return value if isinstance(value, str) and TCONST_RE.match(value) else None


def seed_from_series_mapping(conn: sqlite3.Connection, now_iso: str) -> int:
    """Eski dizilah/IMDb eşlemesinde (series_mapping) zaten bilinen kimlikler — TMDB'ye sormadan."""
    n = 0
    for tmdb_id, imdb_id in conn.execute("SELECT tmdb_id, imdb_id FROM series_mapping WHERE imdb_id IS NOT NULL"):
        tconst = valid_tconst(imdb_id)
        if tconst:
            n += conn.execute(
                "INSERT OR IGNORE INTO imdb_title_map (tmdb_id, tconst, resolved_at) VALUES (?, ?, ?)",
                (tmdb_id, tconst, now_iso),
            ).rowcount
    conn.commit()
    return n


def resolve_tconsts(conn: sqlite3.Connection, tmdb_ids: list[int], fetch_external_ids, now_iso: str) -> dict:
    found = missing = failed = 0
    for tid in tmdb_ids:
        try:
            tconst = valid_tconst((fetch_external_ids(tid) or {}).get("imdb_id"))
        except requests.RequestException as exc:
            log.warning(f"TMDB external_ids başarısız ({tid}): {exc}")
            failed += 1
            continue
        conn.execute(
            "INSERT INTO imdb_title_map (tmdb_id, tconst, resolved_at) VALUES (?, ?, ?) "
            "ON CONFLICT(tmdb_id) DO UPDATE SET tconst = excluded.tconst, resolved_at = excluded.resolved_at",
            (tid, tconst, now_iso),
        )
        found += tconst is not None
        missing += tconst is None
    conn.commit()
    return {"found": found, "no_imdb_id": missing, "failed": failed}


def dataset_file(key: str, cache_dir: Path, now: datetime, max_age: timedelta) -> Path:
    path = cache_dir / imdb_dataset.DATASET_FILES[key]
    stale = not path.exists() or now - datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) > max_age
    return imdb_dataset.download_dataset(key, cache_dir, force=stale)


def ratings_file(cache_dir: Path, now: datetime) -> Path:
    return dataset_file("ratings", cache_dir, now, RATINGS_MAX_AGE)


def _int_or_none(value):
    return int(value) if value not in (None, "", "\\N") and str(value).isdigit() else None


def _nconsts(value) -> list[str]:
    return [] if value in (None, "", "\\N") else [v for v in value.split(",") if v]


def read_episodes(path: Path, parents: set[str]) -> list[tuple[str, str, int | None, int | None]]:
    """(bölüm tconst, dizi tconst, sezon, bölüm no) — yalnızca katalogdaki diziler."""
    return [
        (row["tconst"], row["parentTconst"], _int_or_none(row["seasonNumber"]), _int_or_none(row["episodeNumber"]))
        for row in imdb_dataset._iter_tsv_rows(path)
        if row["parentTconst"] in parents
    ]


def aggregate_crew(path: Path, episode_parent: dict[str, str], series: set[str]) -> dict[tuple[str, str, str], int]:
    """(dizi, rol, kişi) → bölüm sayısı. Diziler bölüm bazında yönetilip yazıldığı için ekip, bölüm
    kayıtlarından toplanır; dizinin kendi kaydında geçip bölümlerde geçmeyen kişi 0 bölümle eklenir."""
    counts: dict[tuple[str, str, str], int] = {}
    for row in imdb_dataset._iter_tsv_rows(path):
        tc = row["tconst"]
        parent = episode_parent.get(tc)
        if parent is None and tc not in series:
            continue
        for role, field in (("director", "directors"), ("writer", "writers")):
            for nc in _nconsts(row[field]):
                if parent is not None:
                    counts[(parent, role, nc)] = counts.get((parent, role, nc), 0) + 1
                else:
                    counts.setdefault((tc, role, nc), 0)
    return counts


def read_names(path: Path, nconsts: set[str]) -> dict[str, str]:
    return {
        row["nconst"]: row["primaryName"]
        for row in imdb_dataset._iter_tsv_rows(path)
        if row["nconst"] in nconsts and row["primaryName"] not in ("", "\\N")
    }


def read_akas(path: Path, wanted: set[str]) -> list[tuple[str, str, str, int]]:
    """(tconst, ülke, ad, özgün mü) — ülkesi iki harfli olanlar, tekilleştirilmiş. Dosya ~511 MB; satır
    satır akıtılır (belleğe alınmaz)."""
    seen: set[tuple[str, str, str]] = set()
    out = []
    for row in imdb_dataset._iter_tsv_rows(path):
        tid = row["titleId"]
        if tid not in wanted:
            continue
        region, title = row.get("region"), row.get("title")
        if not region or len(region) != 2 or not title or title == "\\N":
            continue
        key = (tid, region, title)
        if key in seen:
            continue
        seen.add(key)
        out.append((tid, region, title, int(row.get("isOriginalTitle") == "1")))
    return out


def details_due(conn: sqlite3.Connection, now: datetime) -> bool:
    last = db.get_pipeline_meta(conn, "imdb_details_synced_at")
    return not last or now - datetime.fromisoformat(last) >= DETAILS_INTERVAL


def sync_details(conn: sqlite3.Connection, series: set[str], paths: dict[str, Path], now_iso: str) -> dict:
    """Haftalık: bölümler, yönetmen/senarist ve ülkelere göre yerel adlar. Yalnızca katalogdaki dizilerin
    kayıtları değiştirilir (DELETE + INSERT, tek işlemde)."""
    episodes = read_episodes(paths["episode"], series)
    episode_parent = {tc: parent for tc, parent, _, _ in episodes}
    crew = aggregate_crew(paths["crew"], episode_parent, series)
    names = read_names(paths["names"], {nc for _, _, nc in crew})
    akas = read_akas(paths["akas"], series)

    marks = ",".join("?" * len(series)) or "NULL"
    params = tuple(series)
    with conn:
        old = {
            r[0]: (r[1], r[2])
            for r in conn.execute(
                f"SELECT tconst, average_rating, num_votes FROM imdb_episodes WHERE parent_tconst IN ({marks})", params
            )
        }
        conn.execute(f"DELETE FROM imdb_episodes WHERE parent_tconst IN ({marks})", params)
        conn.executemany(
            "INSERT INTO imdb_episodes (tconst, parent_tconst, season, episode, average_rating, num_votes) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [(tc, p, s, e, *old.get(tc, (None, None))) for tc, p, s, e in episodes],
        )
        conn.execute(f"DELETE FROM imdb_crew WHERE parent_tconst IN ({marks})", params)
        conn.executemany(
            "INSERT INTO imdb_crew (parent_tconst, role, nconst, name, episode_count) VALUES (?, ?, ?, ?, ?)",
            [(p, role, nc, names.get(nc), n) for (p, role, nc), n in crew.items()],
        )
        conn.execute(f"DELETE FROM imdb_localized_titles WHERE tconst IN ({marks})", params)
        conn.executemany(
            "INSERT OR IGNORE INTO imdb_localized_titles (tconst, region, title, is_original) VALUES (?, ?, ?, ?)", akas
        )
    db.set_pipeline_meta(conn, "imdb_details_synced_at", now_iso)
    return {"episodes": len(episodes), "crew": len(crew), "localized_titles": len(akas)}


TMDB_AGGREGATE_CREDITS_URL = "https://api.themoviedb.org/3/tv/{id}/aggregate_credits"


def fold_name(name: str) -> str:
    """Türkçe harfler ve aksanlar sadeleştirilmiş, küçük harf, yalnızca harf/rakam: "Aslı Bozdağ" → "aslibozdag"."""
    text = (name or "").replace("ı", "i").replace("İ", "I")
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", text)


def _non_ascii(name: str) -> int:
    return sum(1 for ch in name if ord(ch) > 127)


def localize_crew_names(conn: sqlite3.Connection, fetch_crew, search_person=None) -> dict:
    """IMDb adları Türkçe karaktersiz ("Ahmet Yilmaz", "Mehmet Bozdag"). TMDB ekip listelerindeki yazımla
    yalnızca SADELEŞTİRİLMİŞ HÂLLERİ BİREBİR AYNIYSA değiştirilir (aynı kişinin farklı yazımı); tutmayan ada
    dokunulmaz. Aynı sadeleştirilmiş ada birden çok yazım varsa en çok Türkçe harf taşıyan seçilir."""
    best: dict[str, str] = {}
    failed = 0
    tmdb_ids = [
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT m.tmdb_id FROM imdb_crew c JOIN imdb_title_map m ON m.tconst = c.parent_tconst"
        )
    ]
    for tid in tmdb_ids:
        try:
            people = fetch_crew(tid) or []
        except requests.RequestException as exc:
            log.warning(f"TMDB ekip listesi alınamadı ({tid}): {exc}")
            failed += 1
            continue
        for p in people:
            for n in {p.get("name"), p.get("original_name")}:
                if not n:
                    continue
                k = fold_name(n)
                if k and (k not in best or _non_ascii(n) > _non_ascii(best[k])):
                    best[k] = n
    changed = searched = 0
    with conn:
        for nconst, name in conn.execute("SELECT DISTINCT nconst, name FROM imdb_crew WHERE name IS NOT NULL").fetchall():
            key = fold_name(name)
            better = best.get(key)
            # Dizinin TMDB ekip listesinde yoksa (TMDB'de ekip kaydı eksik) kişi aramasına bakılır; yine
            # yalnızca sadeleştirilmiş hâli birebir aynı adlar.
            if (not better or _non_ascii(better) <= _non_ascii(name)) and search_person is not None:
                searched += 1
                try:
                    for p in search_person(name) or []:
                        n = p.get("name")
                        if n and fold_name(n) == key and _non_ascii(n) > _non_ascii(better or name):
                            better = n
                except requests.RequestException as exc:
                    log.warning(f"TMDB kişi araması başarısız ({name}): {exc}")
            if better and better != name and _non_ascii(better) > _non_ascii(name):
                changed += conn.execute("UPDATE imdb_crew SET name = ? WHERE nconst = ?", (better, nconst)).rowcount
    return {"series": len(tmdb_ids), "renamed_rows": changed, "searched": searched, "failed": failed}


def tmdb_crew_fetcher():
    if not os.getenv("TMDB_API_KEY"):
        raise RuntimeError("TMDB_API_KEY yok (server/.env kontrol et)")
    session = requests.Session()

    def fetch(tid):
        time.sleep(REQUEST_DELAY_S)
        resp = session.get(
            TMDB_AGGREGATE_CREDITS_URL.format(id=tid), params={"api_key": os.getenv("TMDB_API_KEY")}, timeout=20
        )
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        return resp.json().get("crew", [])

    return fetch


TMDB_SEARCH_PERSON_URL = "https://api.themoviedb.org/3/search/person"


def tmdb_person_searcher():
    session = requests.Session()

    def search(name):
        time.sleep(REQUEST_DELAY_S)
        resp = session.get(
            TMDB_SEARCH_PERSON_URL, params={"api_key": os.getenv("TMDB_API_KEY"), "query": name}, timeout=20
        )
        resp.raise_for_status()
        return resp.json().get("results", [])

    return search


def save_episode_ratings(conn: sqlite3.Connection, ratings: dict[str, tuple[float, int]], series: set[str]) -> int:
    """Bölüm puanları günlük güncellenir (puanı kalkan bölüm NULL'a döner)."""
    marks = ",".join("?" * len(series)) or "NULL"
    rows = conn.execute(f"SELECT tconst FROM imdb_episodes WHERE parent_tconst IN ({marks})", tuple(series)).fetchall()
    with conn:
        conn.executemany(
            "UPDATE imdb_episodes SET average_rating = ?, num_votes = ? WHERE tconst = ?",
            [(*ratings.get(tc, (None, None)), tc) for (tc,) in rows],
        )
    return sum(1 for (tc,) in rows if tc in ratings)


def read_ratings(path: Path, wanted: set[str]) -> dict[str, tuple[float, int]]:
    out = {}
    for row in imdb_dataset._iter_tsv_rows(path):
        if row["tconst"] in wanted:
            out[row["tconst"]] = (float(row["averageRating"]), int(row["numVotes"]))
    return out


def save_ratings(conn: sqlite3.Connection, ratings: dict[str, tuple[float, int]], snapshot_date: str, now_iso: str) -> None:
    for tconst, (rating, votes) in ratings.items():
        conn.execute(
            "INSERT INTO imdb_series (tconst, average_rating, num_votes, fetched_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(tconst) DO UPDATE SET average_rating = excluded.average_rating, "
            "num_votes = excluded.num_votes, fetched_at = excluded.fetched_at",
            (tconst, rating, votes, now_iso),
        )
        conn.execute(
            "INSERT INTO imdb_rating_history (tconst, snapshot_date, average_rating, num_votes) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(tconst, snapshot_date) DO UPDATE SET average_rating = excluded.average_rating, "
            "num_votes = excluded.num_votes",
            (tconst, snapshot_date, rating, votes),
        )
    conn.commit()


def run(
    db_path: Path = DB_PATH,
    node_db_path: Path = NODE_DB_PATH,
    cache_dir: Path = CACHE_DIR,
    fetch_external_ids=None,
    ratings_path: Path | None = None,
    now: datetime | None = None,
    details: bool | None = None,
    detail_paths: dict[str, Path] | None = None,
    fetch_crew=None,
) -> dict:
    """details: None → haftalık kapıya göre; True/False → zorla."""
    now = now or datetime.now(timezone.utc)
    now_iso = now.isoformat()
    conn = db.get_connection(db_path)
    try:
        tmdb_ids = catalog_tmdb_ids(conn, node_db_path)
        seeded = seed_from_series_mapping(conn, now_iso)

        if fetch_external_ids is None:
            if not os.getenv("TMDB_API_KEY"):
                raise RuntimeError("TMDB_API_KEY yok (server/.env kontrol et)")
            session = requests.Session()

            def fetch_external_ids(tid):
                time.sleep(REQUEST_DELAY_S)
                resp = session.get(
                    TMDB_EXTERNAL_IDS_URL.format(id=tid), params={"api_key": os.getenv("TMDB_API_KEY")}, timeout=20
                )
                if resp.status_code == 404:
                    return {}
                resp.raise_for_status()
                return resp.json()

        resolved = resolve_tconsts(conn, ids_to_resolve(conn, tmdb_ids, now), fetch_external_ids, now_iso)

        placeholders = ",".join("?" * len(tmdb_ids)) or "NULL"
        wanted = {
            r[0]
            for r in conn.execute(
                f"SELECT tconst FROM imdb_title_map WHERE tconst IS NOT NULL AND tmdb_id IN ({placeholders})",
                tuple(tmdb_ids),
            )
        }
        detail_result = None
        if details if details is not None else details_due(conn, now):
            paths = detail_paths or {k: dataset_file(k, cache_dir, now, DETAILS_MAX_AGE) for k in DETAIL_KEYS}
            detail_result = sync_details(conn, wanted, paths, now_iso)
            # IMDb adlarındaki Türkçe karakterleri TMDB yazımıyla düzelt (ayrıntı aşamasıyla birlikte, haftalık)
            detail_result["crew_names"] = localize_crew_names(
                conn, fetch_crew or tmdb_crew_fetcher(), None if fetch_crew else tmdb_person_searcher()
            )

        episode_ids = {r[0] for r in conn.execute("SELECT tconst FROM imdb_episodes")}
        path = ratings_path or ratings_file(cache_dir, now)
        # Anlık görüntünün tarihi: IMDb dosyasının indirildiği gün (verinin yaşı), betiğin çalıştığı gün değil.
        snapshot_date = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).date().isoformat()
        all_ratings = read_ratings(path, wanted | episode_ids)
        ratings = {tc: v for tc, v in all_ratings.items() if tc in wanted}
        save_ratings(conn, ratings, snapshot_date, now_iso)
        rated_episodes = save_episode_ratings(conn, all_ratings, wanted)
        db.set_pipeline_meta(conn, "imdb_ratings_synced_at", now_iso)
        db.set_pipeline_meta(conn, "imdb_ratings_snapshot_date", snapshot_date)
        return {
            "status": "ok",
            "catalog": len(tmdb_ids),
            "mapped": len(wanted),
            "seeded_from_mapping": seeded,
            "resolved": resolved,
            "rated": len(ratings),
            "rated_episodes": rated_episodes,
            "snapshot_date": snapshot_date,
            "details": detail_result,
        }
    finally:
        conn.close()


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    import argparse

    parser = argparse.ArgumentParser(description="IMDb puan/oy, bölüm ve ekip senkronu")
    parser.add_argument("--details", action="store_true", help="haftalık ayrıntı aşamasını şimdi çalıştır")
    parser.add_argument(
        "--crew-names", action="store_true", help="yalnızca ekip adlarını TMDB yazımıyla düzelt (indirme yok)"
    )
    args = parser.parse_args()
    if args.crew_names:
        conn = db.get_connection(DB_PATH)
        try:
            result = localize_crew_names(conn, tmdb_crew_fetcher(), tmdb_person_searcher())
        finally:
            conn.close()
    else:
        result = run(details=True if args.details else None)
    print(RESULT_MARKER + json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
