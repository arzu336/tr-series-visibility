"""reytingtv.com arşivini tamamen tarar (bkz. reytingtv_ranker.py), pipeline.db'ye ham
satırları yazar, aylık ortalama sıra-skoru hesaplar ve Node uygulamasının
server/data/app.db'sindeki series_popularity_monthly tablosuna source='reytingtv_rank'
olarak yazar (bkz. server/db.js migration, server/series-period-history.js kaynak seçimi).

Sadece TAMAMLANMIŞ takvim ayları yazılır (mevcut ay hariç) — server/series-period-history.js
rollupSeriesMonthlyIfNeeded()'daki aynı kural, canlı TMDB rollup'la çakışmasın diye.
'Total' kategorisi tek başlık sinyali olarak kullanılır (AB/20+ABC1 ham veride tutulur ama
aylık özete karışmaz — TMDB'nin tek küresel popülerlik sayısına en yakın karşılık).

Kullanım:
    python backfill_reytingtv.py [--limit N]
"""
from __future__ import annotations

import argparse
import datetime
import sqlite3
from collections import defaultdict
from pathlib import Path

import db
import reytingtv_ranker as rtv
from logsetup import get_logger

log = get_logger(__name__)

BASE_DIR = Path(__file__).parent
CACHE_DIR = BASE_DIR / "data"
DB_PATH = CACHE_DIR / "pipeline.db"
NODE_DB_PATH = BASE_DIR.parent / "server" / "data" / "app.db"


def rollup_monthly(conn: sqlite3.Connection) -> dict[tuple[int, int, int], tuple[float, int]]:
    """(tmdb_id, year, month) -> (avg_rank_score, sample_count), sadece 'Total' kategorisi,
    mevcut takvim ayı hariç."""
    now = datetime.date.today()
    rows = conn.execute(
        "SELECT tmdb_id, air_date, rank_score FROM reytingtv_daily_ranks WHERE category = 'Total'"
    ).fetchall()
    buckets: dict[tuple[int, int, int], list[float]] = defaultdict(list)
    for tmdb_id, air_date_str, rank_score in rows:
        d = datetime.date.fromisoformat(air_date_str)
        if d.year == now.year and d.month == now.month:
            continue
        buckets[(tmdb_id, d.year, d.month)].append(rank_score)
    return {k: (sum(v) / len(v), len(v)) for k, v in buckets.items()}


def write_to_node_db(monthly: dict[tuple[int, int, int], tuple[float, int]]) -> None:
    # Node sunucusu aynı dosyayı açık tutuyor (server/db.js) — zaman aşımı olmadan
    # eşzamanlı yazma her iki tarafta da anında 'database is locked' veriyordu.
    # Node tarafında da PRAGMA busy_timeout = 5000 var; ikisi simetrik.
    conn = sqlite3.connect(NODE_DB_PATH, timeout=5.0)
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        conn.executemany(
            """
            -- Denetim bulgusu B-08: cakisma hedefi eskiden (tmdb_id, year, month) idi ve
            -- DO UPDATE, o aya ait TMDB satirini source'unu da degistirerek EZIYORDU; Node'un o
            -- ay icin olctugu popularite kalici olarak kayboluyordu. Artik anahtar source'u da
            -- iceriyor (bkz. server/db.js migrasyonu): ReytingTV satiri kendi satirini gunceller,
            -- TMDB satirina hic dokunmaz. Ikisi yan yana yasar, okuyucu taraf
            -- (server/series-period-history.js) dizi basina birini secer.
            INSERT INTO series_popularity_monthly (tmdb_id, year, month, avg_popularity, sample_count, source)
            VALUES (?, ?, ?, ?, ?, 'reytingtv_rank')
            ON CONFLICT(tmdb_id, year, month, source) DO UPDATE SET
                avg_popularity = excluded.avg_popularity,
                sample_count = excluded.sample_count
            """,
            [
                (tmdb_id, year, month, avg_score, count)
                for (tmdb_id, year, month), (avg_score, count) in monthly.items()
            ],
        )
        conn.commit()
    finally:
        conn.close()


RESULT_MARKER = "RESULT_JSON "


def entries_to_daily_ranks(entries) -> list:
    """chart_entries satırlarından eski reytingtv_daily_ranks satırları (yalnızca eşleşen diziler) —
    Node'un aylık popülerlik yedeği (series_popularity_monthly) hâlâ bu tabloyu okur."""
    from models import ReytingTvDailyRank

    out = []
    for e in entries:
        # Eşleşse bile dizi değilse (MasterChef gibi katalogdaki yarışmalar) popülerlik yedeğine girmez.
        if e.series_id is None or e.program_kind != "series":
            continue
        out.append(
            ReytingTvDailyRank(
                tmdb_id=e.series_id,
                matched_title=e.title_raw,
                program_raw=e.title_raw,
                category=e.segment,
                rank=e.rank,
                rank_score=rtv.compute_rank_score(e.rank),
                air_date=datetime.date.fromisoformat(e.period_date),
                source_url=e.source_url,
            )
        )
    return out


def run(limit: int | None, days: int | None = None, db_path: Path = DB_PATH, node_db_path: Path = NODE_DB_PATH) -> dict:
    from providers.reytingtv import ReytingTvProvider

    now = datetime.datetime.now(datetime.timezone.utc)
    since = (now.date() - datetime.timedelta(days=days)) if days else None
    conn = db.get_connection(db_path)
    try:
        log.info(f"reytingtv.com arşivi taranıyor... (son {days} gün)" if days else "reytingtv.com arşivi taranıyor...")
        provider = ReytingTvProvider(node_db_path)
        entries = provider.fetch(limit=limit, since=since, fetched_at=now.isoformat(), progress_every=50)
        written = db.save_chart_entries(conn, entries)
        results = entries_to_daily_ranks(entries)
        log.info(f"{written} liste satırı (tam Top 10) ve {len(results)} eşleşen dizi satırı yazılıyor...")
        db.save_reytingtv_daily_ranks(conn, results, now.isoformat())
        gunler = sorted({e.period_date for e in entries})
        db.set_pipeline_meta(conn, "reytingtv_synced_at", now.isoformat())
        if gunler:
            db.set_pipeline_meta(conn, "reytingtv_last_air_date", gunler[-1])

        monthly = rollup_monthly(conn)
        log.info(f"{len(monthly)} (dizi, ay) satırı hesaplandı, Node app.db'ye yazılıyor...")
        write_to_node_db(monthly)
        log.info(f"tamamlandı — {NODE_DB_PATH} güncellendi (source='reytingtv_rank').")

        distinct_series = len({k[0] for k in monthly})
        distinct_months = len({(k[1], k[2]) for k in monthly})
        log.info(f"özet: {distinct_series} farklı dizi, {distinct_months} farklı (yıl,ay) kombinasyonu.")
        kinds = {}
        for e in entries:
            kinds[e.program_kind] = kinds.get(e.program_kind, 0) + 1
        return {
            "status": "ok",
            "chart_entries_written": written,
            "days": len(gunler),
            "first_air_date": gunler[0] if gunler else None,
            "last_air_date": gunler[-1] if gunler else None,
            "program_kinds": kinds,
            "matched_series_rows": len(results),
        }
    finally:
        conn.close()


if __name__ == "__main__":
    import json

    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="En fazla N makale (test/deneme)")
    parser.add_argument("--days", type=int, default=None, help="Yalnızca son N günün makaleleri (zamanlayıcı için)")
    args = parser.parse_args()
    sonuc = run(args.limit, days=args.days)
    log.info(f"sonuç: {sonuc}")
    print(RESULT_MARKER + json.dumps(sonuc, ensure_ascii=False, default=str), flush=True)
