"""Kanonik kimlik çözümleme koşusu — identity.py'yi gerçek katalog üzerinde çalıştırır.

Dizi listesini Node uygulamasının app.db'sindeki 'raw-series-providers' önbelleğinden okur
(reytingtv_ranker.py ile aynı desen: bu pipeline kendi dizi listesini TUTMAZ), her dizi için
TMDB /tv/{id}/external_ids ucundan sert kimlikleri çeker ve IdentityResolver'a verir.

Çözülemeyen hiçbir kayıt SİLİNMEZ — unresolved_queue'ya düşer ve sonunda raporlanır.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from dotenv import load_dotenv

import db as db_module
from identity import IdentityResolver
from models import UnresolvedReason

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data" / "pipeline.db"
NODE_DB_PATH = BASE_DIR.parent / "server" / "data" / "app.db"

load_dotenv(BASE_DIR.parent / "server" / ".env")
TMDB_API_KEY = os.getenv("TMDB_API_KEY")

# TMDB'nin belgelenen sınırı yüksek; 8 eşzamanlı istek bu pipeline'ın başka yerlerinde de
# kullanılan (server/tmdb.js FETCH_CONCURRENCY) güvenli değer.
ESZAMANLI = 8


def load_series() -> list[dict]:
    conn = sqlite3.connect(NODE_DB_PATH)
    try:
        row = conn.execute(
            "SELECT value FROM cache_entries WHERE key = 'raw-series-providers'"
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        raise RuntimeError(
            f"{NODE_DB_PATH}: 'raw-series-providers' bulunamadı — Node uygulaması en az bir kez "
            "/api/visibility çağırmış olmalı."
        )
    return json.loads(row[0])["series"]


def fetch_external_ids(tmdb_id: int) -> dict:
    """Ağ hatası 'kimlik yok' DEĞİLDİR: ikisi karışırsa geçici bir kesinti kalıcı olarak
    kaydı tmdb kademesine hapseder. Hata ayrı işaretlenir."""
    try:
        r = requests.get(
            f"https://api.themoviedb.org/3/tv/{tmdb_id}/external_ids",
            params={"api_key": TMDB_API_KEY},
            timeout=20,
        )
        r.raise_for_status()
        return r.json()
    except Exception as err:  # noqa: BLE001
        return {"_error": str(err)}


def main() -> int:
    if not TMDB_API_KEY:
        print("TMDB_API_KEY yok (server/.env kontrol et)", file=sys.stderr)
        return 1

    seri = load_series()
    print(f"{len(seri)} dizi okundu, TMDB external_ids çekiliyor...")

    with ThreadPoolExecutor(max_workers=ESZAMANLI) as havuz:
        dis_kimlikler = list(havuz.map(lambda s: fetch_external_ids(s["id"]), seri))

    conn = db_module.get_connection(DB_PATH)
    resolver = IdentityResolver(conn)

    kademeler: Counter = Counter()
    kuyruk: Counter = Counter()
    agHatasi = 0

    for s, dis in zip(seri, dis_kimlikler):
        if "_error" in dis:
            agHatasi += 1
            resolver.queue(
                "tmdb", str(s["id"]), s["name"], UnresolvedReason.NO_EXTERNAL_ID,
                detail=f"TMDB erişilemedi: {dis['_error'][:120]}",
            )
            continue
        kimlik = resolver.resolve(
            source="tmdb",
            source_ref=str(s["id"]),
            title=s["name"],
            wikidata_id=dis.get("wikidata_id") or None,
            imdb_id=dis.get("imdb_id") or None,
            tmdb_id=s["id"],
        )
        if kimlik is None:
            kuyruk["cozulemedi"] += 1
        else:
            kademeler[kimlik.tier.value] += 1

    toplam = sum(kademeler.values())
    print(f"\nÇÖZÜLEN: {toplam}/{len(seri)}")
    for kademe in ("wikidata", "imdb", "tmdb"):
        n = kademeler[kademe]
        if toplam:
            print(f"  {kademe:9s} {n:4d}  (%{round(n / len(seri) * 100)})")

    bekleyen = resolver.pending()
    print(f"\nKUYRUKTA: {len(bekleyen)} (silinmedi)")
    for reason, n in Counter(b.reason.value for b in bekleyen).most_common():
        print(f"  {reason:18s} {n}")
    if agHatasi:
        print(f"  (bunların {agHatasi} tanesi TMDB ağ hatası — kalıcı kimlik eksikliği değil)")

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
