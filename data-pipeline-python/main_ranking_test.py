"""Ülke bazlı yerel popülerlik sıralama motorunu Polonya (PL) ve İspanya (ES) için uçtan
uca test eder — Netflix Top 10 + Google Trends sinyallerini gerçek API'lerden çeker,
country_score_engine.py ile birleştirir, SQLite'a yazar ve exports/*.json'a kaydeder.

Kullanım:
    python main_ranking_test.py
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime
from pathlib import Path

import dotenv

import db
import netflix_country_ranker as netflix
import trends_country_ranker as trends
from country_score_engine import generate_country_leaderboard

BASE_DIR = Path(__file__).parent
CACHE_DIR = BASE_DIR / "data"
EXPORTS_DIR = BASE_DIR / "exports"
DB_PATH = CACHE_DIR / "pipeline.db"

# server/.env ile aynı SERPAPI_API_KEY paylaşılıyor — bu proje için ayrı bir anahtar yok.
dotenv.load_dotenv(BASE_DIR.parent / "server" / ".env")

# Test için: uluslararası popülerliği zaten doğrulanmış (bu oturumda Yargı için IMDb/
# Dizilah ile gerçek veriyle test edildi) bir Türk dizisi seti. Gerçek entegrasyonda bu
# liste, ana Node uygulamasının data/series_list.json'ından (bkz. batch_run.py) gelir.
TEST_SHOWS = [
    "Kuruluş: Osman",  # anchor — trends_country_ranker'da her grupta tekrarlanan çapa
    "Yargı",
    "Kara Sevda",
    "Teşkilat",
    "Emanet",
    "Kızılcık Şerbeti",
    "Aşk-ı Memnu",
    "Diriliş: Ertuğrul",
]

TEST_COUNTRIES = [("PL", "Poland"), ("ES", "Spain")]


def _json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"JSON'a çevrilemeyen tip: {type(value)}")


def run() -> None:
    api_key = os.environ.get("SERPAPI_API_KEY")
    if not api_key:
        raise RuntimeError("SERPAPI_API_KEY tanımlı değil (server/.env kontrol edin)")

    conn = db.get_connection(DB_PATH)
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

    try:
        for country_code, country_name in TEST_COUNTRIES:
            print(f"\n=== {country_name} ({country_code}) ===")

            print("[netflix] Top 10 verisi taranıyor...")
            netflix_signals = netflix.get_netflix_country_rankings(country_name, TEST_SHOWS, CACHE_DIR)
            netflix_by_title = {s.show_title: s for s in netflix_signals}
            print(f"[netflix]  -> {len(netflix_signals)} eşleşme")

            print("[trends] Google Trends karşılaştırması sorgulanıyor...")
            trends_signals = trends.compare_shows_interest(TEST_SHOWS, country_code, api_key)
            trends_by_title = {s.show_title: s for s in trends_signals}
            print(f"[trends]  -> {len(trends_signals)} dizi için sonuç")

            show_list = [
                {
                    "title": title,
                    # Netflix show_title tam eşleşmeyebilir (bkz. netflix_country_ranker
                    # modül notu) — bu test betiğinde basit isim eşleşmesi kullanılıyor.
                    "netflix_signal": netflix_by_title.get(title),
                    "trends_signal": trends_by_title.get(title),
                    # Gerçek entegrasyonda bu, ana Node uygulamasının /api/visibility
                    # verisinden (o ülkede TMDB/JustWatch yayın sağlayıcısı var mı) gelir —
                    # bu test betiğinde tüm test dizileri "yayında" varsayılıyor.
                    "locally_available": True,
                }
                for title in TEST_SHOWS
            ]

            leaderboard = generate_country_leaderboard(country_code, country_name, show_list)
            db.save_country_leaderboard(conn, leaderboard)

            print(f"\n{country_name} sıralaması:")
            for i, entry in enumerate(leaderboard.entries, 1):
                print(f"  {i}. {entry.show_title} — {entry.local_score} ({'; '.join(entry.evidence)})")

            out_path = EXPORTS_DIR / f"country_rankings_{country_code}.json"
            out_path.write_text(
                json.dumps(leaderboard.model_dump(), ensure_ascii=False, indent=2, default=_json_default),
                encoding="utf-8",
            )
            print(f"Yazıldı: {out_path}")
    finally:
        conn.close()

    print(f"\nYazıldı: {DB_PATH}")


if __name__ == "__main__":
    run()
