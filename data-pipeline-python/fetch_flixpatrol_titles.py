"""FlixPatrol dizi sayfaları taraması (bkz. providers/flixpatrol_titles.py) — liste taramasından sonra, haftalık.

Katalogdaki her dizi için FlixPatrol sayfası bulunur (eşleme kayıtlı), sayfadaki platform puanları
flixpatrol_title_stats'a, son 7 günün platform × ülke sıraları chart_entries'e yazılır. Süre sınırlı ve kaldığı
yerden devam eder: önce eşlemesi olan diziler (her hafta tazelenir), sonra listelere girmiş ama henüz aranmamış
diziler, sonra kalanlar; bulunamayan dizi 30 gün içinde yeniden aranmaz.

Kullanım:
    python fetch_flixpatrol_titles.py                  # varsayılan süre sınırıyla
    python fetch_flixpatrol_titles.py --max-minutes 20
    python fetch_flixpatrol_titles.py --limit 5        # hızlı deneme
"""
from __future__ import annotations

import argparse
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import db
import reytingtv_ranker as rtv
from logsetup import get_logger
from providers import flixpatrol as fp
from providers import flixpatrol_titles as ft

log = get_logger(__name__)

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "data" / "pipeline.db"
NODE_DB_PATH = BASE_DIR.parent / "server" / "data" / "app.db"
DEFAULT_MAX_MINUTES = 45
REFRESH_DAYS = 6  # eşlemesi olan dizinin sayfası haftada bir tazelenir (sayfa son 7 günü içerir)
RETRY_NOT_FOUND_DAYS = 30
MAX_CANDIDATES = 3
_TR_FOLD = str.maketrans("şŞıİğĞüÜöÖçÇâÂîÎûÛ", "sSiIgGuUoOcCaAiIuU")


def english_titles(conn: sqlite3.Connection, tmdb_id: int) -> list[str]:
    """IMDb'deki ABD/İngiltere adları (FlixPatrol uluslararası adı çoğu zaman bunlardan biri)."""
    try:
        rows = conn.execute(
            "SELECT DISTINCT t.title FROM imdb_localized_titles t JOIN imdb_title_map m ON m.tconst = t.tconst "
            "WHERE m.tmdb_id = ? AND t.region IN ('US', 'GB', 'XWW')",
            (tmdb_id,),
        ).fetchall()
    except sqlite3.Error:
        return []
    return [r[0] for r in rows if r[0]]


def slugify(text: str) -> str:
    import re

    return re.sub(r"[^a-z0-9]+", "-", text.translate(_TR_FOLD).lower()).strip("-")


def search_names(name: str, english: list[str]) -> list[str]:
    folded = name.translate(_TR_FOLD).replace(":", "")
    out = []
    for n in [folded, *english]:
        if n and n not in out:
            out.append(n)
    return out


def work_order(conn: sqlite3.Connection, index) -> list:
    """Önce eşlemesi olanlar, sonra listelere girmiş aranmamışlar, sonra kalanlar; yakın zamanda bulunamayan atlanır."""
    maps = {r[0]: (r[1], r[2], r[3]) for r in conn.execute("SELECT tmdb_id, slug, status, checked_at FROM flixpatrol_title_map")}
    listed = {r[0] for r in conn.execute("SELECT DISTINCT series_id FROM chart_entries WHERE series_id IS NOT NULL")}
    last = {r[0]: r[1] for r in conn.execute("SELECT tmdb_id, MAX(as_of) FROM flixpatrol_title_stats GROUP BY tmdb_id")}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETRY_NOT_FOUND_DAYS)).isoformat()
    fresh_after = (datetime.now(timezone.utc) - timedelta(days=REFRESH_DAYS)).date().isoformat()
    ok, listed_new, rest = [], [], []
    for e in index:
        m = maps.get(e.tmdb_id)
        if m and m[1] == "ok":
            if (last.get(e.tmdb_id) or "") < fresh_after:
                ok.append(e)
        elif m and m[1] == "yok" and m[2] > cutoff:
            continue
        elif e.tmdb_id in listed:
            listed_new.append(e)
        else:
            rest.append(e)
    return ok + listed_new + rest


def find_slug(session, names: list[str]) -> tuple[str | None, str | None]:
    """Aramayla dizi sayfasını bulur; Türk dizisi olduğu doğrulanan ilk aday. Dönüş: (slug, html)."""
    for name in names:
        html, _ = fp._fetch_html(session, f"https://flixpatrol.com/search/?q={quote(name)}")
        time.sleep(fp.REQUEST_DELAY_S)
        # Önce adı birebir tutan slug; tutmayan adaylardan yalnızca ilki açılır (gereksiz sayfa isteği olmasın).
        want = slugify(name)
        found = ft.parse_search(html or "")
        exact = [s for s in found if s == want or s.startswith(want + "-")]
        for slug in (exact + [s for s in found if s not in exact][:1])[:MAX_CANDIDATES]:
            page, _ = fp._fetch_html(session, f"https://flixpatrol.com/title/{slug}/")
            time.sleep(fp.REQUEST_DELAY_S)
            if page and ft.is_turkish_tv_show(page):
                return slug, page
    return None, None


def process_page(conn: sqlite3.Connection, tmdb_id: int, slug: str, html: str) -> tuple[int, int]:
    updated = ft.parse_updated(html)
    if not updated:
        return 0, 0
    fetched_at = ft.utc_now()
    n_stats = db.save_flixpatrol_title_stats(conn, tmdb_id, ft.parse_points(html), updated.isoformat(), fetched_at)
    entries = ft.to_chart_entries(
        ft.parse_weekly(html, updated),
        tmdb_id=tmdb_id,
        title=ft.title_of(html),
        source_url=f"https://flixpatrol.com/title/{slug}/",
        fetched_at=fetched_at,
    )
    return n_stats, db.save_chart_entries(conn, entries)


def run(max_minutes: float = DEFAULT_MAX_MINUTES, limit: int | None = None, db_path: Path = DB_PATH, node_db_path: Path = NODE_DB_PATH) -> dict:
    if not fp.FlixPatrolProvider().enabled:
        log.info("flixpatrol başlık taraması kapalı (FLIXPATROL_SCRAPE_ENABLED=0)")
        return {"skipped": True}
    conn = db.get_connection(db_path)
    order = work_order(conn, rtv.load_tmdb_series_index(node_db_path))
    if limit:
        order = order[:limit]
    deadline = time.monotonic() + max_minutes * 60
    session = fp._open_session()
    stats = {"pages": 0, "found": 0, "not_found": 0, "points": 0, "chart_rows": 0}
    try:
        for e in order:
            if time.monotonic() >= deadline:
                log.info("flixpatrol başlık: süre sınırı — kalanlar sonraki koşuda")
                break
            row = conn.execute("SELECT slug, status FROM flixpatrol_title_map WHERE tmdb_id = ?", (e.tmdb_id,)).fetchone()
            now = datetime.now(timezone.utc).isoformat()
            if row and row[1] == "ok":
                slug = row[0]
                html, status = fp._fetch_html(session, f"https://flixpatrol.com/title/{slug}/")
                time.sleep(fp.REQUEST_DELAY_S)
                if status == 404:
                    db.save_flixpatrol_title_map(conn, e.tmdb_id, None, "yok", now)
                    continue
            else:
                slug, html = find_slug(session, search_names(e.name, english_titles(conn, e.tmdb_id)))
                db.save_flixpatrol_title_map(conn, e.tmdb_id, slug, "ok" if slug else "yok", now)
                if not slug:
                    stats["not_found"] += 1
                    continue
                stats["found"] += 1
            if not html:
                continue
            n_stats, n_rows = process_page(conn, e.tmdb_id, slug, html)
            stats["pages"] += 1
            stats["points"] += n_stats
            stats["chart_rows"] += n_rows
    finally:
        try:
            session.close()
        except Exception:  # noqa: BLE001
            pass
    log.info(f"flixpatrol başlık: {stats}")
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-minutes", type=float, default=DEFAULT_MAX_MINUTES)
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()
    run(max_minutes=a.max_minutes, limit=a.limit)


if __name__ == "__main__":
    main()
