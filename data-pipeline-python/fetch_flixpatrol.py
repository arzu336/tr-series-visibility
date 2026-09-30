"""FlixPatrol güncel TV Top 10 çekimi → chart_entries.

Yalnızca GÜNCEL liste (period_type='day') alınır; geçmiş veri FlixPatrol paywall'ı (402)
arkasında olduğundan burada backfill yoktur (giriş cookie'si için bkz. providers/flixpatrol
SESSION_COOKIES). Zamanlanmış (haftalık) çalıştırma için uygundur.

Her (ülke, platform) sayfası alınır alınmaz KAYDEDİLİR: koşu yarıda kesilirse (zaman aşımı,
bilgisayarın uykuya geçmesi) o ana kadarki veri kalır. Aynı gün yeniden çalıştırılırsa zaten
kaydedilmiş çiftler atlanır, kaldığı yerden devam eder.

Kullanım:
    python fetch_flixpatrol.py                 # tüm platformlar × FlixPatrol'daki tüm ülkeleri
    python fetch_flixpatrol.py --limit 3       # ilk 3 (ülke,platform) — hızlı deneme
    python fetch_flixpatrol.py --force         # bugün çekilmiş olanları da yeniden çek
    python fetch_flixpatrol.py --rematch       # ağa çıkmadan kayıtlı satırları yeniden eşleştir
"""
from __future__ import annotations

import argparse
import datetime
import json
import sqlite3
from pathlib import Path

import db
from logsetup import get_logger

log = get_logger(__name__)

BASE_DIR = Path(__file__).parent
CACHE_DIR = BASE_DIR / "data"
DB_PATH = CACHE_DIR / "pipeline.db"
NODE_DB_PATH = BASE_DIR.parent / "server" / "data" / "app.db"


def fetched_pairs(conn: sqlite3.Connection, period_date: str) -> set[tuple[str, str]]:
    """O gün için zaten kaydedilmiş (ülke, platform) çiftleri."""
    rows = conn.execute(
        "SELECT DISTINCT country_iso2, platform FROM chart_entries "
        "WHERE provider = 'flixpatrol' AND period_date = ?",
        (period_date,),
    ).fetchall()
    return {(r[0], r[1]) for r in rows}


def rematch(conn: sqlite3.Connection, match_index) -> dict:
    """Kayıtlı FlixPatrol satırlarını güncel eşleştirme havuzuyla yeniden eşler (ağ yok). Takma ad
    listesi genişlediğinde tüm arşive uygulanır; yalnızca değişen satırlar yazılır."""
    from providers.base import classify_program_kind
    from providers.flixpatrol import match_title

    rows = conn.execute(
        "SELECT rowid, title_raw, series_id, program_kind FROM chart_entries WHERE provider = 'flixpatrol'"
    ).fetchall()
    cache: dict[str, object] = {}
    changed = 0
    for rowid, title, sid, kind in rows:
        if title not in cache:
            cache[title] = match_title(title, match_index)
        new_sid = cache[title]
        new_kind = classify_program_kind(title, new_sid)
        if new_sid != sid or new_kind != kind:
            conn.execute(
                "UPDATE chart_entries SET series_id = ?, program_kind = ? WHERE rowid = ?", (new_sid, new_kind, rowid)
            )
            changed += 1
    conn.commit()
    matched = conn.execute(
        "SELECT COUNT(*) FROM chart_entries WHERE provider = 'flixpatrol' AND series_id IS NOT NULL"
    ).fetchone()[0]
    return {"status": "ok", "rows": len(rows), "changed": changed, "matched_rows": matched}


def run(
    limit: int | None = None,
    force: bool = False,
    db_path: Path = DB_PATH,
    node_db_path: Path = NODE_DB_PATH,
    provider=None,
) -> dict:
    from providers.flixpatrol import FlixPatrolProvider

    now = datetime.datetime.now(datetime.timezone.utc)
    period_date = datetime.date.today().isoformat()
    conn = db.get_connection(db_path)
    try:
        provider = provider or FlixPatrolProvider(node_db_path if node_db_path.exists() else None)
        if not provider.enabled:
            log.warning("FlixPatrol saglayicisi devre disi (FLIXPATROL_SCRAPE_ENABLED=0).")
            return {"status": "disabled", "chart_entries_written": 0}

        skip = set() if force else fetched_pairs(conn, period_date)
        if skip:
            log.info(f"bugun zaten cekilmis {len(skip)} (ulke, platform) cifti atlaniyor")
        log.info("FlixPatrol guncel TV Top 10 cekiliyor...")

        written = 0
        pages = 0
        empty = 0
        kinds: dict[str, int] = {}
        for _iso2, _platform, _status, rows in provider.iter_pages(
            limit=limit, fetched_at=now.isoformat(), skip=skip
        ):
            pages += 1
            if not rows:
                empty += 1
                continue
            written += db.save_chart_entries(conn, rows)  # sayfa sayfa kayıt
            db.set_pipeline_meta(conn, "flixpatrol_last_period_date", period_date)
            for e in rows:
                kinds[e.program_kind] = kinds.get(e.program_kind, 0) + 1

        db.set_pipeline_meta(conn, "flixpatrol_synced_at", now.isoformat())
        return {
            "status": "ok",
            "chart_entries_written": written,
            "pages": pages,
            "empty_pages": empty,
            "skipped_pairs": len(skip),
            "program_kinds": kinds,
        }
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="FlixPatrol güncel TV Top 10 → chart_entries")
    ap.add_argument("--limit", type=int, default=None, help="ilk N (ülke,platform) çifti (deneme için)")
    ap.add_argument("--force", action="store_true", help="bugün çekilmiş çiftleri de yeniden çek")
    ap.add_argument("--rematch", action="store_true", help="ağa çıkmadan kayıtlı satırları yeniden eşleştir")
    args = ap.parse_args()
    if args.rematch:
        import reytingtv_ranker as rtv
        from providers.flixpatrol import build_match_index

        conn = db.get_connection(DB_PATH)
        try:
            result = rematch(conn, build_match_index(rtv.load_tmdb_series_index(NODE_DB_PATH)))
        finally:
            conn.close()
    else:
        result = run(limit=args.limit, force=args.force)
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
