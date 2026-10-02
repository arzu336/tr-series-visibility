"""Katalog tamamlama: listelere girmiş ama katalogda olmayan Türk dizileri.

SORUN
-----
Dizi kataloğu (Node, server/tmdb.js) TMDB'de o anki popülerliğe göre ilk 400 Türk dizisi + Netflix Türk
yapımlarından oluşur. Yayından kalkan ya da yeni başlayan diziler bu kümenin dışına düşer; Türkiye TV ve
FlixPatrol listelerinde görünseler de dizi sayfası/analizi oluşmaz. 2026-10-02 ölçümü: Türkiye TV'de 148
eşleşmeyen başlık (Kirli Sepeti, Çöp Adam, Veda Mektubu, Ego, Kara Ağaç Destanı …), FlixPatrol'da 4 Türk
dizisi (Maraşlı, Anne Yarısı, Quwet El Hob, Kirli Sepeti).

KURAL (kimlik katmanının ilkesiyle uyumlu — isimden tahminle birleştirme yok)
-----------------------------------------------------------------------
Eşleşmeyen liste başlığı temizlenir (kanal adı, "(ÖZET)" gibi ekler) ve TMDB'de aranır. YALNIZCA
origin_country TR olan ve adı (name ya da original_name) normalize edilmiş hâliyle BİREBİR tutan TEK
aday kabul edilir → catalog_supplement (Node kataloğa sabit ekler). Birden fazla tam aday → unresolved_queue
(AMBIGUOUS, adaylarla) — insan incelemesi. Tam aday yok → yabancı yapım ya da dizi değil, kayıt tutulmaz.
Ardından kayıtlı liste satırları ağa çıkmadan yeniden eşlenir (YALNIZCA eşleşmemiş satırlar değişir).

Kullanım:
    python catalog_supplement.py             # ara, yaz, yeniden eşle
    python catalog_supplement.py --dry-run   # yalnızca ne ekleneceğini göster
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

import db
import reytingtv_ranker as rtv
from identity import IdentityResolver
from logsetup import get_logger
from models import UnresolvedReason
from providers.base import classify_program_kind

log = get_logger(__name__)

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "data" / "pipeline.db"
NODE_DB_PATH = BASE_DIR.parent / "server" / "data" / "app.db"
load_dotenv(BASE_DIR.parent / "server" / ".env")

TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/tv"
REQUEST_DELAY_S = 0.05
SOURCE = "catalog_supplement"

# Türkiye TV başlıklarının sonundaki kanal adları (normalize_title biçiminde; uzun olan önce denenir).
CHANNELS = sorted(
    ["STAR TV", "KANAL D", "SHOW TV", "TRT 1", "KANAL 7", "BEYAZ TV", "TEVE2", "TV8", "TV 8", "FOX", "NOW", "ATV"],
    key=len,
    reverse=True,
)
MAX_TITLE_WORDS = 7
# TMDB tür kimlikleri: Haber, Realite/yarışma, Talk show — dizi değil (ör. "Var mısın? Yok musun?").
NON_SCRIPTED_GENRES = {10763, 10764, 10767}


def clean_list_title(title: str) -> str | None:
    """Liste başlığından aranacak dizi adını çıkarır; dizi adına benzemeyen (makale cümlesi, saat) → None."""
    t = re.sub(r"\([^)]*\)", " ", title or "").strip()
    if not t or re.search(r"\d{1,2}:\d{2}", t) or t.endswith((".", "?", "!")):
        return None
    upper = rtv.normalize_title(t)
    for ch in CHANNELS:
        if upper.endswith(" " + ch):
            words = t.split()
            t = " ".join(words[: len(words) - len(ch.split())])
            break
    t = re.sub(r"\s+", " ", t).strip()
    if not t or len(t.split()) > MAX_TITLE_WORDS:
        return None
    return t


def needs_review(r: dict) -> bool:
    """Ad birebir tutsa da otomatik kabul edilmez: dili Türkçe değil ya da TMDB türü boş. Türü boş kayıtlar
    kurgu olduğunu kanıtlamıyor — "Quwet El Hob" (Arapça realite, Kısmetse Olur'un Arapça sürümü) ve
    "Var mısın? Yok musun?" (yarışma) TMDB'de tür alanı boş olduğu için realite süzgecinden geçip kataloğa
    girmişti. Bunlar silinmez, inceleme kuyruğuna gider."""
    return (r.get("original_language") or "tr") != "tr" or not (r.get("genre_ids") or [])


def pick_candidate(clean: str, results: list[dict]) -> tuple[str, list[dict]]:
    """('accept', [aday]) | ('ambiguous', adaylar) | ('review', [aday]) | ('none', []). Yalnızca TR yapımı,
    kurgu (haber/realite/talk show değil) ve birebir ad; Türkçe ve türü belli olmayan tek aday → 'review'."""
    key = rtv.normalize_title(clean)
    exact: dict[int, dict] = {}
    for r in results or []:
        if "TR" not in (r.get("origin_country") or []):
            continue
        if NON_SCRIPTED_GENRES & set(r.get("genre_ids") or []):
            continue
        names = {rtv.normalize_title(r.get("name") or ""), rtv.normalize_title(r.get("original_name") or "")}
        if key and key in names:
            exact[r["id"]] = r
    if len(exact) == 1:
        only = next(iter(exact.values()))
        return ("review" if needs_review(only) else "accept"), [only]
    if len(exact) > 1:
        return "ambiguous", list(exact.values())
    return "none", []


def tmdb_search(session: requests.Session, query: str) -> list[dict]:
    resp = session.get(
        TMDB_SEARCH_URL,
        params={"api_key": os.getenv("TMDB_API_KEY"), "query": query, "language": "tr-TR"},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json().get("results", [])


def unmatched_titles(conn: sqlite3.Connection) -> list[tuple[str, str, int]]:
    """(başlık, sağlayıcı, satır sayısı) — dizi olabilecek ('unknown') eşleşmemiş liste satırları."""
    return conn.execute(
        "SELECT title_raw, provider, COUNT(*) FROM chart_entries "
        "WHERE series_id IS NULL AND program_kind = 'unknown' AND provider IN ('reytingtv', 'flixpatrol') "
        "GROUP BY title_raw, provider ORDER BY COUNT(*) DESC"
    ).fetchall()


def supplement_entries(conn: sqlite3.Connection) -> list[rtv.SeriesIndexEntry]:
    """Eşleştirme havuzuna eklenecek girdiler: TMDB adı ve listede görülen başlık."""
    out = []
    for tmdb_id, name, list_title in conn.execute("SELECT tmdb_id, name, list_title FROM catalog_supplement"):
        for n in {name, list_title}:
            if n:
                out.append(rtv.SeriesIndexEntry(tmdb_id=tmdb_id, name=n, normalized=rtv.normalize_title(n)))
    return out


def rematch_unmatched(conn: sqlite3.Connection, index: list[rtv.SeriesIndexEntry], db_path: Path = DB_PATH) -> int:
    """Eşleşmemiş Türkiye TV ve FlixPatrol satırlarını genişletilmiş havuzla yeniden eşler (ağ yok).
    Netflix takma adları da `db_path`'ten (üzerinde çalışılan veritabanı) okunur."""
    import fetch_flixpatrol
    import netflix_pipeline as nfp
    from providers.flixpatrol import build_match_index

    index = sorted(index, key=lambda e: -len(e.normalized))  # match_series: uzun ad önce
    changed = 0
    rows = conn.execute(
        "SELECT rowid, title_raw FROM chart_entries WHERE provider = 'reytingtv' AND series_id IS NULL"
    ).fetchall()
    for rowid, title in rows:
        m = rtv.match_series(title, index)
        if m:
            conn.execute(
                "UPDATE chart_entries SET series_id = ?, program_kind = ? WHERE rowid = ?",
                (m.tmdb_id, classify_program_kind(title, m.tmdb_id), rowid),
            )
            changed += 1
    conn.commit()
    before = conn.execute(
        "SELECT COUNT(*) FROM chart_entries WHERE provider = 'flixpatrol' AND series_id IS NOT NULL"
    ).fetchone()[0]
    fetch_flixpatrol.rematch(conn, build_match_index(index, extra_aliases=nfp.load_title_aliases(index, db_path=db_path)))
    after = conn.execute(
        "SELECT COUNT(*) FROM chart_entries WHERE provider = 'flixpatrol' AND series_id IS NOT NULL"
    ).fetchone()[0]
    return changed + max(0, after - before)


def run(dry_run: bool = False, db_path: Path = DB_PATH, node_db_path: Path = NODE_DB_PATH, search=None) -> dict:
    conn = db.get_connection(db_path)
    try:
        catalog = rtv.load_tmdb_series_index(node_db_path)
        catalog_ids = {e.tmdb_id for e in catalog}
        known = {r[0] for r in conn.execute("SELECT tmdb_id FROM catalog_supplement")}

        # Aynı dizinin farklı yazımlarını ("KIRLI SEPETI FOX", "Kirli Sepeti") tek aramaya indir.
        groups: dict[str, dict] = {}
        for title, provider, n in unmatched_titles(conn):
            clean = clean_list_title(title)
            if not clean:
                continue
            g = groups.setdefault(rtv.normalize_title(clean), {"clean": clean, "providers": set(), "rows": 0})
            g["providers"].add(provider)
            g["rows"] += n

        if search is None:
            if not os.getenv("TMDB_API_KEY"):
                raise RuntimeError("TMDB_API_KEY yok (server/.env kontrol et)")
            session = requests.Session()

            def search(q):
                time.sleep(REQUEST_DELAY_S)
                return tmdb_search(session, q)

        resolver = IdentityResolver(conn)
        now = datetime.now(timezone.utc).isoformat()
        added, aliases, ambiguous, review, none = [], [], [], [], 0
        for norm, g in groups.items():
            try:
                verdict, cands = pick_candidate(g["clean"], search(g["clean"]))
            except requests.RequestException as exc:
                log.warning(f"TMDB araması başarısız ({g['clean']}): {exc}")
                continue
            source = ",".join(sorted(g["providers"]))
            if verdict == "none":
                none += 1
                continue
            if verdict in ("ambiguous", "review"):
                (ambiguous if verdict == "ambiguous" else review).append(g["clean"])
                if not dry_run:
                    resolver.queue(
                        SOURCE,
                        norm,
                        g["clean"],
                        UnresolvedReason.AMBIGUOUS if verdict == "ambiguous" else UnresolvedReason.NAME_ONLY,
                        candidates=[
                            f"tmdb:{c['id']} {c.get('name')} ({(c.get('first_air_date') or '')[:4]})"
                            f" dil={c.get('original_language')}"
                            for c in cands
                        ],
                        detail=f"liste: {source}, {g['rows']} satır"
                        + ("" if verdict == "ambiguous" else " — dil Türkçe değil ya da TMDB türü boş"),
                    )
                continue
            c = cands[0]
            if c["id"] in known:
                continue
            in_catalog = c["id"] in catalog_ids
            (aliases if in_catalog else added).append(f"{c.get('name')} ({(c.get('first_air_date') or '')[:4]})")
            known.add(c["id"])
            if not dry_run:
                conn.execute(
                    "INSERT OR IGNORE INTO catalog_supplement "
                    "(tmdb_id, name, original_name, first_air_date, list_title, source, already_in_catalog, added_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        c["id"],
                        c.get("name") or g["clean"],
                        c.get("original_name"),
                        c.get("first_air_date"),
                        g["clean"],
                        source,
                        int(in_catalog),
                        now,
                    ),
                )
        conn.commit()

        rematched = 0 if dry_run else rematch_unmatched(conn, catalog + supplement_entries(conn), db_path)
        if not dry_run:
            db.set_pipeline_meta(conn, "catalog_supplement_synced_at", now)
        return {
            "status": "ok",
            "dry_run": dry_run,
            "searched": len(groups),
            "added": added,
            "aliases": aliases,
            "ambiguous": ambiguous,
            "review": review,
            "not_turkish_or_not_found": none,
            "rows_rematched": rematched,
        }
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="yazmadan ne ekleneceğini göster")
    args = ap.parse_args()
    print(json.dumps(run(dry_run=args.dry_run), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
