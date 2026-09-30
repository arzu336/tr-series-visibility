"""FlixPatrol güncel TV Top 10 çekimi → chart_entries.

Yalnızca GÜNCEL liste (period_type='day') alınır; geçmiş veri FlixPatrol paywall'ı (402)
arkasında olduğundan burada backfill yoktur (giriş cookie'si için bkz. providers/flixpatrol
SESSION_COOKIES). Zamanlanmış (haftalık) çalıştırma için uygundur.

Kullanım:
    python fetch_flixpatrol.py                 # tüm öncelikli ülke × platform
    python fetch_flixpatrol.py --limit 3       # ilk 3 (ülke,platform) — hızlı deneme
"""
from __future__ import annotations

import argparse
import datetime
from pathlib import Path

import db
from logsetup import get_logger

log = get_logger(__name__)

BASE_DIR = Path(__file__).parent
CACHE_DIR = BASE_DIR / "data"
DB_PATH = CACHE_DIR / "pipeline.db"
NODE_DB_PATH = BASE_DIR.parent / "server" / "data" / "app.db"


def run(limit: int | None = None, db_path: Path = DB_PATH, node_db_path: Path = NODE_DB_PATH) -> dict:
    from providers.flixpatrol import FlixPatrolProvider

    now = datetime.datetime.now(datetime.timezone.utc)
    conn = db.get_connection(db_path)
    try:
        provider = FlixPatrolProvider(node_db_path if node_db_path.exists() else None)
        if not provider.enabled:
            log.warning("FlixPatrol sağlayıcısı devre dışı (FLIXPATROL_SCRAPE_ENABLED=0).")
            return {"status": "disabled", "chart_entries_written": 0}
        log.info("FlixPatrol güncel TV Top 10 çekiliyor (Cloudflare geçilecek, sürebilir)...")
        entries = provider.fetch(limit=limit, fetched_at=now.isoformat())
        written = db.save_chart_entries(conn, entries)
        db.set_pipeline_meta(conn, "flixpatrol_synced_at", now.isoformat())
        if entries:
            db.set_pipeline_meta(conn, "flixpatrol_last_period_date", entries[-1].period_date)
        kinds: dict[str, int] = {}
        for e in entries:
            kinds[e.program_kind] = kinds.get(e.program_kind, 0) + 1
        log.info(f"tamamlandi - {written} satir yazildi. Tur dagilimi: {kinds}")
        return {"status": "ok", "chart_entries_written": written, "program_kinds": kinds}
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="FlixPatrol güncel TV Top 10 → chart_entries")
    ap.add_argument("--limit", type=int, default=None, help="ilk N (ülke,platform) çifti (deneme için)")
    args = ap.parse_args()
    print(run(limit=args.limit))


if __name__ == "__main__":
    main()
