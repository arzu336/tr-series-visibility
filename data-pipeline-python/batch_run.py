"""gorunurluk-platformu'nun (ana Node uygulaması) takip ettiği TÜM dizileri (şu an
~200) Dizilah + IMDb Dataset hatlarından geçirir. main.py'nin (tek dizi test betiği)
tersine, bu gerçek ölçekte, tekrar tekrar çalıştırılabilir toplu iş betiğidir.

Girdi: data/series_list.json — ana Node uygulamasından bir kerelik dışa aktarıldı
(TMDB adı + server/tmdb.js getExternalIds() ile çekilmiş GERÇEK IMDb ID'si; isimden
tahmin YOK). 200 dizinin 189'unda IMDb ID bulunabildi — 11 tanesi (muhtemelen çok
yeni/küçük yapımlar) IMDb'de hiç yok, bu satırlar dürüstçe atlanır.

Kullanım:
    python batch_run.py
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

import db
import dizilah_scraper
import imdb_dataset

BASE_DIR = Path(__file__).parent
CACHE_DIR = BASE_DIR / "data"
DB_PATH = CACHE_DIR / "pipeline.db"
SERIES_LIST_PATH = CACHE_DIR / "series_list.json"

# Dizilah'ın robots.txt'i bunu zorunlu kılmıyor ama 200 isteği art arda patlatmak
# yerine kibarca aralık bırakmak — "meşru, kamuya açık" ilkesinin bir parçası.
DIZILAH_REQUEST_DELAY_S = 0.6

TRANSLATE_TABLE = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")


def slugify(name: str) -> str:
    """Doğrulandı (2026-08-20): Dizilah, Türkçe dizi adının basit harf çevirisini
    (ı/ş/ğ/ö/ü/ç -> ASCII, boşluk -> tire) slug olarak kullanıyor — 'Kuruluş: Osman',
    'Kızılcık Şerbeti', 'Muhteşem Yüzyıl', 'Çukur', 'Yalı Çapkını' dahil 7/7 test
    edilen isimde birebir tuttu."""
    cleaned = name.translate(TRANSLATE_TABLE).lower()
    cleaned = re.sub(r"[^a-z0-9\s-]", "", cleaned)
    return re.sub(r"\s+", "-", cleaned.strip())


def run() -> None:
    series_list = json.loads(SERIES_LIST_PATH.read_text(encoding="utf-8"))
    print(f"{len(series_list)} dizi işlenecek\n")

    print("--- Dizilah ---")
    dizilah_by_tmdb_id: dict[int, dizilah_scraper.DizilahSeriesInfo] = {}
    for i, s in enumerate(series_list, 1):
        slug = slugify(s["name"])
        info = dizilah_scraper.fetch_series(slug)
        dizilah_by_tmdb_id[s["tmdbId"]] = info
        mark = "OK" if info.title else "bulunamadı"
        print(f"  [{i}/{len(series_list)}] {s['name']} ({slug}) -> {mark}")
        time.sleep(DIZILAH_REQUEST_DELAY_S)
    found_dizilah = sum(1 for v in dizilah_by_tmdb_id.values() if v.title)
    print(f"\nDizilah: {found_dizilah}/{len(series_list)} bulundu")

    print("\n--- IMDb (tek geçişte, ~226 MB + ~511 MB + ~9 MB taranıyor) ---")
    tconsts = [s["imdbId"] for s in series_list if s.get("imdbId")]
    imdb_by_tconst = imdb_dataset.fetch_series_batch(tconsts, CACHE_DIR)
    print(f"IMDb: {len(imdb_by_tconst)}/{len(tconsts)} bulundu "
          f"({len(series_list) - len(tconsts)} dizide zaten IMDb ID yoktu)")

    print("\n--- SQLite'a yazılıyor ---")
    conn = db.get_connection(DB_PATH)
    try:
        for s in series_list:
            dizilah_info = dizilah_by_tmdb_id.get(s["tmdbId"])
            if dizilah_info is not None:
                db.save_dizilah_series(conn, dizilah_info)

            imdb_info = imdb_by_tconst.get(s.get("imdbId"))
            if imdb_info is not None:
                db.save_imdb_series(conn, imdb_info)

            db.save_series_mapping(conn, s["tmdbId"], s["name"], slugify(s["name"]), s.get("imdbId"))
    finally:
        conn.close()

    print(f"Yazıldı: {DB_PATH}")


if __name__ == "__main__":
    run()
