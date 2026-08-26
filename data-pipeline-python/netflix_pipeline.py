"""Modül A — netflix_country_ranker.py'nin ürettiği sinyalleri TMDB kimliğiyle eşleyip
data/pipeline.db'deki netflix_country_rankings tablosuna kalıcı olarak yazan orkestrasyon
katmanı. İndirme/ayrıştırma mantığının KENDİSİ burada TEKRARLANMIYOR — netflix_country_ranker.py
zaten bu oturumda (2026-08-20, tekrar 2026-08-25'te doğrulandı) Netflix'in CDN'inin ~30 MB'lık
dosyayı GÜVENİLİR şekilde tam indiremediğini kanıtlayan, en-uzun-kısmi-indirme + "yarım ülke
bloğu asla kullanma" stratejisiyle donatılmış — bu modül sadece SONUÇLARI tmdb_id'ye bağlayıp
saklıyor.

ÖNEMLİ, DÜRÜST NOT: Bu ortamda 2026-08-25'te yeniden test edildi — dosya YİNE tam inmedi (45
saniyede sadece ~280 KB / 31,7 MB okunabildi). Bu bir kod hatası değil, kalıcı bir CDN/ağ
kararsızlığı (bkz. netflix_country_ranker.py docstring'i, madde 2). Pratik sonucu: dosya
alfabetik ülke sıralı olduğu için (doğrulandı), alfabetik olarak ERKEN gelen ülkeler (örn.
Almanya, Arjantin) kısmi indirmelerde tam bloğa sahip olma ihtimali daha yüksek; alfabetik GEÇ
gelen ülkeler (örn. Türkiye, İspanya, Polonya) çoğu zaman hiç kapsanamaz. `sync_country` bu
durumda çökmez, `status: 'unavailable'` ile dürüstçe döner — çağıran taraf (batch_run veya
countryScoringEngine.js'in okuduğu tablo) bu ülke için Netflix faktörünü basitçe DIŞLAR, sıfır
sayılmaz (bkz. server/services/countryScoringEngine.js ağırlık yeniden dağıtımı).
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

import db
import netflix_country_ranker as nf
from models import NetflixCountryRanking
from reytingtv_ranker import SeriesIndexEntry, load_tmdb_series_index, match_series

BASE_DIR = Path(__file__).parent
CACHE_DIR = BASE_DIR / "data"
DB_PATH = CACHE_DIR / "pipeline.db"
NODE_DB_PATH = BASE_DIR.parent / "server" / "data" / "app.db"

MIN_TITLE_LEN = 4  # reytingtv_ranker.match_series'teki aynı güvenlik: çok kısa adlar yanlış-pozitif riski taşır

# netflix_country_ranker.fetch_country_page_fallback bir ülke SLUG'ı gerektiriyor (bkz. o
# dosyadaki _country_slug), TSV yolu gibi doğrudan ISO2 kabul etmiyor — Tudum URL'i İngilizce
# ülke adına dayanıyor. Tam ISO 3166 listesi DEĞİL: bu platformun asıl ilgilendiği pazarlara
# (Avrupa, Orta Doğu, Latin Amerika, Güney Asya — bkz. önceki oturumlardaki "146 ülke" raporu)
# odaklı, elle tutulan bir alt küme. Kapsamadığı bir ISO2 gelirse fallback dürüstçe atlanır,
# uydurma bir ad üretilmez.
ISO2_TO_ENGLISH_NAME = {
    "TR": "Turkey", "ES": "Spain", "PL": "Poland", "DE": "Germany", "FR": "France",
    "IT": "Italy", "GB": "United Kingdom", "PT": "Portugal", "GR": "Greece", "RO": "Romania",
    "BG": "Bulgaria", "HR": "Croatia", "RS": "Serbia", "HU": "Hungary", "CZ": "Czech Republic",
    "SK": "Slovakia", "SI": "Slovenia", "NL": "Netherlands", "BE": "Belgium", "SE": "Sweden",
    "NO": "Norway", "DK": "Denmark", "FI": "Finland", "AT": "Austria", "CH": "Switzerland",
    "UA": "Ukraine", "RU": "Russia", "AL": "Albania", "MK": "North Macedonia", "BA": "Bosnia and Herzegovina",
    "EG": "Egypt", "SA": "Saudi Arabia", "AE": "United Arab Emirates", "QA": "Qatar", "KW": "Kuwait",
    "IQ": "Iraq", "JO": "Jordan", "LB": "Lebanon", "IL": "Israel", "MA": "Morocco",
    "TN": "Tunisia", "DZ": "Algeria", "LY": "Libya", "SD": "Sudan", "PK": "Pakistan",
    "BD": "Bangladesh", "IN": "India", "ID": "Indonesia", "MY": "Malaysia",
    "MX": "Mexico", "BR": "Brazil", "AR": "Argentina", "CL": "Chile", "CO": "Colombia",
    "PE": "Peru", "EC": "Ecuador", "VE": "Venezuela", "UY": "Uruguay", "PY": "Paraguay",
    "BO": "Bolivia", "CR": "Costa Rica", "PA": "Panama", "DO": "Dominican Republic", "GT": "Guatemala",
    "US": "United States", "CA": "Canada", "AU": "Australia", "NZ": "New Zealand",
    "ZA": "South Africa", "KE": "Kenya", "NG": "Nigeria", "KR": "South Korea", "JP": "Japan",
}


def _candidate_titles(series_index: list[SeriesIndexEntry]) -> list[str]:
    return [e.name for e in series_index if len(e.normalized) >= MIN_TITLE_LEN]


def sync_country(
    country_iso2: str,
    series_index: list[SeriesIndexEntry],
    cache_dir: Path = CACHE_DIR,
) -> dict:
    """`country_iso2`: iki harfli ISO2 kod ('ES', 'TR', 'PL') — netflix_country_ranker.py
    hem ISO2 hem İngilizce ad kabul ediyor ama burada BİLEREK sadece ISO2 zorunlu tutuluyor:
    projenin geri kalanı (server/, src/data/country-centroids.json) zaten ISO2 üzerinden
    çalışıyor, ayrıca bir İngilizce-ad↔ISO2 eşleme katmanı eklemek gereksiz bir belirsizlik
    kaynağı olurdu. Dönen dict her zaman özet istatistikleri içerir — hata durumunda da
    (status='unavailable') asla exception fırlatmaz, çağıran tarafın batch halinde birçok
    ülkeyi güvenle deneyebilmesi için."""
    country_iso2 = country_iso2.strip().upper()
    if len(country_iso2) != 2:
        return {"country": country_iso2, "status": "invalid-iso2", "reason": "İki harfli ISO2 kod bekleniyor"}

    titles = _candidate_titles(series_index)
    fallback_used = False
    try:
        signals = nf.get_netflix_country_rankings(country_iso2, titles, cache_dir)
    except RuntimeError as tsv_exc:
        # TSV başarısız — tek haftalık, daha küçük Tudum sayfası fallback'ini dene (bkz.
        # netflix_country_ranker.fetch_country_page_fallback docstring'i: AYNI ağ sorunundan
        # muzdarip, mucizevi bir çözüm değil, sadece ikinci bir şans).
        english_name = ISO2_TO_ENGLISH_NAME.get(country_iso2)
        if not english_name:
            return {
                "country": country_iso2,
                "status": "unavailable",
                "reason": f"TSV başarısız ({tsv_exc}); fallback için İngilizce ülke adı eşlemesi yok",
            }
        try:
            signals = nf.fetch_country_page_fallback(english_name, country_iso2, titles)
            fallback_used = True
        except RuntimeError as fallback_exc:
            return {
                "country": country_iso2,
                "status": "unavailable",
                "reason": f"TSV başarısız ({tsv_exc}); fallback da başarısız ({fallback_exc})",
            }

    now = datetime.now(timezone.utc)
    records: list[NetflixCountryRanking] = []
    unresolved: list[str] = []

    for signal in signals:
        entry = match_series(signal.show_title, series_index)
        if entry is None:
            unresolved.append(signal.show_title)
            continue
        records.append(
            NetflixCountryRanking(
                country_iso2=country_iso2,
                tmdb_id=entry.tmdb_id,
                show_title=signal.show_title,
                matched_title=entry.name,
                weeks_in_top10=signal.weeks_in_top10,
                peak_rank=signal.peak_position,
                rank_score=nf.compute_rank_score(signal),
                last_week_date=signal.latest_week,
                updated_at=now,
            )
        )

    if unresolved:
        print(f"[netflix_pipeline] {country_iso2}: TMDB'ye eşlenemeyen {len(unresolved)} Netflix başlığı: {unresolved}")

    conn = db.get_connection(DB_PATH)
    try:
        db.save_netflix_country_rankings(conn, records)
    finally:
        conn.close()

    return {
        "country": country_iso2,
        "status": "ok" if records else "no-turkish-shows-in-top10",
        "source": "page_fallback" if fallback_used else "tsv",
        "netflix_matches": len(signals),
        "resolved_to_tmdb": len(records),
        "unresolved_titles": unresolved,
    }


def run(countries: list[str]) -> None:
    series_index = load_tmdb_series_index(NODE_DB_PATH)
    print(f"[netflix_pipeline] {len(series_index)} TMDB dizisi yüklendi (eşleştirme havuzu).")
    for country in countries:
        result = sync_country(country, series_index)
        print(f"[netflix_pipeline] {result}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("countries", nargs="+", help="İki harfli ISO2 kod, örn: TR ES PL")
    args = parser.parse_args()
    run(args.countries)
