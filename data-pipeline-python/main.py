"""Uçtan uca test betiği — 'Yargı' dizisiyle hem Dizilah hem IMDb dataset hattını
çalıştırır, sonucu exports/dizi_ozet.json'a ve data/pipeline.db'ye yazar.

Kullanım:
    python main.py
    python main.py --slug kara-sevda --imdb "Kara Sevda"
"""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime
from pathlib import Path

import db
import dizilah_scraper
import imdb_dataset

BASE_DIR = Path(__file__).parent
CACHE_DIR = BASE_DIR / "data"
EXPORTS_DIR = BASE_DIR / "exports"
DB_PATH = CACHE_DIR / "pipeline.db"


def _json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"JSON'a çevrilemeyen tip: {type(value)}")


def run(dizilah_slug: str, imdb_name_or_id: str) -> dict:
    print(f"[dizilah] '{dizilah_slug}' çekiliyor...")
    dizilah_info = dizilah_scraper.fetch_series(dizilah_slug)
    if dizilah_info.title is None:
        print(f"[dizilah]  -> veri alınamadı: {dizilah_info.status_note}")
    else:
        print(
            f"[dizilah]  -> {dizilah_info.title} ({dizilah_info.channel}, {dizilah_info.status}): "
            f"{dizilah_info.average_rating} puan / {dizilah_info.vote_count} oy, "
            f"{dizilah_info.total_episodes} bölüm"
        )
        if dizilah_info.status_note:
            print(f"[dizilah]  -> not: {dizilah_info.status_note}")

    print(f"[imdb] '{imdb_name_or_id}' için title.basics.tsv.gz taranıyor "
          f"(ilk çalıştırmada ~226 MB indirilecek, sürebilir)...")
    imdb_info = imdb_dataset.fetch_series(imdb_name_or_id, CACHE_DIR)
    if imdb_info is None:
        print(f"[imdb]  -> '{imdb_name_or_id}' bulunamadı")
    else:
        print(
            f"[imdb]  -> {imdb_info.primary_title} ({imdb_info.tconst}): "
            f"{imdb_info.average_rating} puan / {imdb_info.num_votes} oy, "
            f"{len(imdb_info.localized_titles)} ülkede yerelleştirilmiş isim"
        )

    conn = db.get_connection(DB_PATH)
    try:
        db.save_dizilah_series(conn, dizilah_info)
        if imdb_info is not None:
            db.save_imdb_series(conn, imdb_info)
    finally:
        conn.close()

    result = {
        "dizilah": dizilah_info.model_dump(),
        "imdb": imdb_info.model_dump() if imdb_info else None,
    }
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = EXPORTS_DIR / "dizi_ozet.json"
    out_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )
    print(f"\nYazıldı: {out_path}")
    print(f"Yazıldı: {DB_PATH}")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Dizilah + IMDb veri toplama testi")
    parser.add_argument("--slug", default="yargi", help="Dizilah slug'ı")
    parser.add_argument("--imdb", default="tt12979628", help="IMDb ID veya dizi adı (Yargı = tt12979628)")
    args = parser.parse_args()
    run(args.slug, args.imdb)
