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


def run(limit: int | None) -> None:
    conn = db.get_connection(DB_PATH)
    try:
        print("[backfill] reytingtv.com arşivi taranıyor...")
        results = rtv.scrape_daily_ranks(NODE_DB_PATH, limit=limit, progress_every=50)
        print(f"[backfill] {len(results)} eşleşen satır bulundu, pipeline.db'ye yazılıyor...")
        db.save_reytingtv_daily_ranks(conn, results, datetime.datetime.now(datetime.timezone.utc).isoformat())

        monthly = rollup_monthly(conn)
        print(f"[backfill] {len(monthly)} (dizi, ay) satırı hesaplandı, Node app.db'ye yazılıyor...")
        write_to_node_db(monthly)
        print(f"[backfill] tamamlandı — {NODE_DB_PATH} güncellendi (source='reytingtv_rank').")

        distinct_series = len({k[0] for k in monthly})
        distinct_months = len({(k[1], k[2]) for k in monthly})
        print(f"[backfill] özet: {distinct_series} farklı dizi, {distinct_months} farklı (yıl,ay) kombinasyonu.")
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    run(args.limit)
