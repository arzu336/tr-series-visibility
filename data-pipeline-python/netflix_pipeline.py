"""Modül A — netflix_country_ranker.py'nin ürettiği sinyalleri TMDB kimliğiyle eşleyip
data/pipeline.db'deki netflix_country_rankings tablosuna kalıcı olarak yazan orkestrasyon
katmanı. İndirme/ayrıştırma mantığının KENDİSİ burada TEKRARLANMIYOR — netflix_country_ranker.py
zaten bu oturumda (2026-08-20, tekrar 2026-08-25'te doğrulandı) Netflix'in CDN'inin ~30 MB'lık
dosyayı GÜVENİLİR şekilde tam indiremediğini kanıtlayan, en-uzun-kısmi-indirme + "yarım ülke
bloğu asla kullanma" stratejisiyle donatılmış — bu modül sadece SONUÇLARI tmdb_id'ye bağlayıp
saklıyor.

ÖNEMLİ, DÜRÜST NOT: Bu ortamda 2026-08-25 ve 2026-09-23'te yeniden test edildi — dosya tam
inmedi; sunucu Range ve gzip'i yok sayıyor, bağlantı rastgele kopuyor (ayrıntı: netflix_country_
ranker.py docstring'i, madde 2). Bu bir kod hatası değil, kalıcı bir CDN/ağ kararsızlığı.
Pratik sonucu: dosya alfabetik ülke sıralı olduğu için (doğrulandı), alfabetik olarak ERKEN gelen
ülkeler (örn. Almanya, Arjantin) kısmi indirmelerde tam bloğa sahip olma ihtimali daha yüksek;
alfabetik GEÇ gelen ülkeler (örn. Türkiye, İspanya, Polonya) çoğu zaman hiç kapsanamaz.
`sync_country` bu durumda çökmez, `status: 'unavailable'` ile dürüstçe döner — çağıran taraf
(batch_run veya countryScoringEngine.js'in okuduğu tablo) bu ülke için Netflix faktörünü basitçe
DIŞLAR, sıfır sayılmaz (bkz. server/services/countryScoringEngine.js ağırlık yeniden dağıtımı).

İKİ ÇALIŞMA MODU:
  python netflix_pipeline.py TR ES PL     — seçili ülkeler (ülke başına dosya yeniden okunur)
  python netflix_pipeline.py --all        — dosyadaki TÜM ülkeler tek geçişte (sync_all): dosya
                                            tamsa hepsi, kısmiyse tam bloğu olan her ülke yazılır,
                                            kesilen son ülke açıkça raporlanır ve YAZILMAZ.
  python netflix_pipeline.py --all --offline — ağa çıkmadan diskteki tam/kısmi dosyayı işler
                                            (indirme az önce denenmişken eşleştirmeyi tekrar koşmak için).
`--all` tablonun eksiksiz dolmasının hedeflenen yolu; countryScoringEngine.js'in %30'luk Netflix
bileşeni ancak bu tablo dolduğunda aktif olur (satır yoksa faktör dışlanır, ağırlık dağıtılır).
"""
from __future__ import annotations

import argparse
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import db
import netflix_country_ranker as nf
from models import NetflixCountryRanking
from reytingtv_ranker import SeriesIndexEntry, load_tmdb_series_index, match_series, normalize_title

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


# BAŞLIK DİLİ UYUMSUZLUĞU — 2026-09-23'te ölçülen asıl sorun. Netflix TSV'si Türk yapımlarını
# uluslararası (İngilizce) yayın adıyla listeler; TMDB kataloğumuz Türkçe ad taşır. 22 MB'lık
# kısmi dosyada "The Tailor" 50 ülkede, "Another Self" 42 ülkede, "Shahmaran" 37 ülkede Top 10'a
# girmişken kataloğumuzdaki "Terzi"/"Zeytin Ağacı" ile eşleşme SIFIRDI. Yani Netflix faktörünün
# hiç aktif olmamasının indirme kırılganlığı dışındaki ikinci, daha büyük sebebi buydu.
#
# İki takma ad kaynağı (bkz. load_title_aliases):
#   1. pipeline.db imdb_localized_titles × series_mapping — otomatik, ama IMDb AKA'ları Netflix'in
#      kendi yayın adını her zaman içermiyor (ör. "Terzi" için "The Tailor" yok).
#   2. Aşağıdaki elle tutulan liste — Netflix'in resmi uluslararası yayın adları. Anahtar,
#      kataloğumuzdaki Türkçe adın BİREBİR hâli; katalogda olmayan anahtar sessizce atlanır
#      (uydurma kimlik üretilmez). Liste küçük ve doğrulanabilir: her satır Netflix'in Tudum/başlık
#      sayfasında görünen ad.
NETFLIX_RELEASE_TITLES: dict[str, str] = {
    "Terzi": "The Tailor",
    "Zeytin Ağacı": "Another Self",
    "Hakan: Muhafız": "The Protector",
    "Atiye": "The Gift",
    "Sıcak Kafa": "Hot Skull",
    "Avlu": "The Yard",
    "Şahsiyet": "Persona",
    "Kuş Uçuşu": "As the Crow Flies",
    "Kulüp": "The Club",
    "Bir Başkadır": "Ethos",
    "Pera Palas'ta Gece Yarısı": "Midnight at the Pera Palace",
    "Biz Kimden Kaçıyorduk Anne?": "Who Were We Running From?",
    "Şahmaran": "Shahmaran",
    "Aşk 101": "Love 101",
    "Kimler Geldi Kimler Geçti": "Thank You, Next",
    "Yükselen İmparatorluk: Osmanlı": "Rise of Empires: Ottoman",
    "Ölmeden Önce Yapılacaklar Listesi": "Wild Abandon",
    "Yakamoz S-245": "Yakamoz S-245",
    "Kübra": "Kübra",
    "Fatma": "Fatma",
    "50M2": "50M2",
}


# IMDb AKA'sı ancak bu somut İngilizce pazarlardan en az birinde geçiyorsa takma ad olur. XWW
# ("dünya geneli") TEK BAŞINA YETMEZ — CANLI ÖLÇÜM (2026-09-23, 22 MB kısmi dosya): XWW kovası
# alternatif çevirilerle dolu (Yargı için 8 farklı XWW adı: "The Judge", "The Verdict",
# "The Prosecutor"...) ve bunlar Netflix'teki BAŞKA dizilerle çakıştı — "The Prosecutor" (2026,
# MX) Yargı'ya, "Time Flies" (2026, AR) Öyle Bir Geçer Zaman Ki'ye, "Evermore" (2025, BR)
# İstanbullu Gelin'e bağlandı; hepsi yalnızca XWW kaynaklıydı. Gerçek Netflix yayın adlarının
# ("Old Money", "Graveyard", "Family Secrets"...) hepsi US/GB/AU/CA'da da kayıtlı.
TRUSTED_AKA_REGIONS = {"US", "GB", "CA", "AU", "IE", "NZ"}


def load_title_aliases(series_index: list[SeriesIndexEntry], db_path: Path = DB_PATH) -> list[SeriesIndexEntry]:
    """Katalogdaki her dizi için ek başlık varyantları (IMDb AKA + Netflix yayın adı) üretir.
    Döndürülen girdiler `series_index`'e EKLENİR; `name` alanı takma adın kendisidir (DB'de
    matched_title olarak görünür), tmdb_id kataloğun kimliğidir.

    Kurallar: aynı takma ad iki farklı diziye gidiyorsa ATLANIR (belirsizlik, uydurma değil);
    çok kısa adlar atlanır (MIN_TITLE_LEN — yanlış-pozitif riski); katalogda zaten aynı
    normalize hâliyle var olan adlar tekrar eklenmez; IMDb AKA'ları yalnızca TRUSTED_AKA_REGIONS
    içinden geliyorsa kabul edilir (XWW-only çeviri varyantları yanlış eşleşme üretti, bkz. not).
    """
    by_name = {e.name: e.tmdb_id for e in series_index}
    known_ids = set(by_name.values())
    alias_to_ids: dict[str, set[int]] = defaultdict(set)

    for tr_name, release_title in NETFLIX_RELEASE_TITLES.items():
        tmdb_id = by_name.get(tr_name)
        if tmdb_id is not None:
            alias_to_ids[release_title.strip()].add(tmdb_id)

    if db_path.exists():
        conn = sqlite3.connect(db_path)
        try:
            rows = conn.execute(
                "SELECT m.tmdb_id, l.title, l.region FROM imdb_localized_titles l "
                "JOIN series_mapping m ON m.imdb_id = l.tconst"
            ).fetchall()
        except sqlite3.Error:
            rows = []  # tablo henüz yok (imdb_dataset.py hiç koşmadı) — sadece elle liste kullanılır
        finally:
            conn.close()
        regions_by_alias: dict[tuple[int, str], set[str]] = defaultdict(set)
        for tmdb_id, title, region in rows:
            if tmdb_id in known_ids and title and title.strip():
                regions_by_alias[(tmdb_id, title.strip())].add((region or "").upper())
        for (tmdb_id, title), regions in regions_by_alias.items():
            if regions & TRUSTED_AKA_REGIONS:
                alias_to_ids[title].add(tmdb_id)

    existing_norm = {e.normalized for e in series_index}
    aliases: list[SeriesIndexEntry] = []
    ambiguous: list[str] = []
    for title, ids in alias_to_ids.items():
        if len(ids) != 1:
            ambiguous.append(title)
            continue
        norm = normalize_title(title)
        if len(norm) < MIN_TITLE_LEN or norm in existing_norm:
            continue
        existing_norm.add(norm)
        aliases.append(SeriesIndexEntry(tmdb_id=next(iter(ids)), name=title, normalized=norm))

    if ambiguous:
        print(f"[netflix_pipeline] {len(ambiguous)} takma ad birden fazla diziye gidiyor, atlandı: {sorted(ambiguous)[:10]}")
    return aliases


def resolve_netflix_title(show_title: str, series_index):
    """Netflix başlığını kataloğumuzdaki diziye bağlar — İKİNCİ SAVUNMA HATTI.

    `match_series` (reytingtv_ranker) bilerek gevşek: oradaki girdi "KURULUŞ OSMAN - ATV" gibi
    kanal adı içeren bir program metni, alt-dize araması DOĞRU davranış. Netflix başlığı ise
    bir program metni değil, dizinin kendi adı — burada alt-dize araması yanlış eşleşme üretir
    (canlı örnek: kataloğumuzdaki "Anne", Netflix'in "Anne Rice's Mayfair Witches" başlığına
    bağlandı ve 7 ülkede yanlış satır yazıldı).

    Ayrıca `match_series` indeksteki İLK eşleşmeyi döndürüyor; "Kuruluş Osman" başlığı için
    indekste "Osman" adlı kısa bir dizi önce gelirse ona bağlanırdı. Burada EN UZUN eşleşme
    seçiliyor — en spesifik aday doğru adaydır.
    """
    baslik = nf._normalize_for_match(show_title)
    if not baslik:
        return None

    en_iyi = None
    for entry in series_index:
        aday = nf._normalize_for_match(entry.name)
        if len(aday) < MIN_TITLE_LEN:
            continue
        if baslik == aday or baslik.startswith(aday + " "):
            # Sezon eki dışında bir kuyruk varsa bu eşleşme değildir.
            kalan = baslik[len(aday):].strip()
            if kalan and not nf._SEZON_EKI.match(kalan):
                continue
            if en_iyi is None or len(aday) > len(nf._normalize_for_match(en_iyi.name)):
                en_iyi = entry
    return en_iyi


def _to_records(
    country_iso2: str,
    signals,
    series_index: list[SeriesIndexEntry],
    now: datetime,
) -> tuple[list[NetflixCountryRanking], list[str]]:
    """Netflix sinyallerini TMDB kimliğine bağlayıp DB satırlarına çevirir. Eşlenemeyen
    başlıklar ayrı döner (uydurma kimlik verilmez). sync_country ve sync_all ortak kullanır."""
    records: list[NetflixCountryRanking] = []
    unresolved: list[str] = []
    for signal in signals:
        entry = resolve_netflix_title(signal.show_title, series_index)
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
    return records, unresolved


def sync_country(
    country_iso2: str,
    series_index: list[SeriesIndexEntry],
    cache_dir: Path = CACHE_DIR,
    db_path: Path = DB_PATH,
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
    records, unresolved = _to_records(country_iso2, signals, series_index, now)

    if unresolved:
        print(f"[netflix_pipeline] {country_iso2}: TMDB'ye eşlenemeyen {len(unresolved)} Netflix başlığı: {unresolved}")

    conn = db.get_connection(db_path)
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


def sync_all(
    series_index: list[SeriesIndexEntry],
    cache_dir: Path = CACHE_DIR,
    db_path: Path = DB_PATH,
    force_download: bool = False,
    offline: bool = False,
) -> dict:
    """Dosyadaki TÜM ülkeleri tek geçişte netflix_country_rankings'e yazar.

    Dosya tamsa her ülke; kısmiyse yalnızca bloğu TAM olan ülkeler yazılır — kesilen son ülke
    `truncated_country` alanında raporlanır ve yazılmaz (yarım blok = eksik hafta sayısı = yanlış
    rank_score). Tüm satırlar tek bağlantı/işlemde yazılır. Asla exception fırlatmaz: indirme
    tamamen başarısızsa `status: 'unavailable'` döner ve tablo olduğu gibi kalır.
    """
    titles = _candidate_titles(series_index)
    try:
        by_iso2, complete, truncated, file_complete = nf.get_all_country_rankings(
            titles, cache_dir, force_download=force_download, offline=offline
        )
    except RuntimeError as exc:
        return {"status": "unavailable", "reason": str(exc)}

    now = datetime.now(timezone.utc)
    all_records: list[NetflixCountryRanking] = []
    unresolved_all: set[str] = set()
    countries_with_matches: list[str] = []
    for iso2 in sorted(complete):
        signals = by_iso2.get(iso2, [])
        if not signals:
            continue
        records, unresolved = _to_records(iso2, signals, series_index, now)
        unresolved_all.update(unresolved)
        if records:
            countries_with_matches.append(iso2)
            all_records.extend(records)

    if all_records:
        conn = db.get_connection(db_path)
        try:
            db.save_netflix_country_rankings(conn, all_records)
        finally:
            conn.close()

    if unresolved_all:
        print(f"[netflix_pipeline] TMDB'ye eşlenemeyen {len(unresolved_all)} Netflix başlığı: {sorted(unresolved_all)}")
    if truncated:
        print(
            f"[netflix_pipeline] UYARI: dosya kısmi — '{truncated}' ülkesinin bloğu yarım kaldı, YAZILMADI. "
            f"Alfabetik olarak ondan sonraki ülkeler bu koşuda hiç kapsanamadı."
        )

    return {
        "status": "ok" if all_records else "no-turkish-shows-in-top10",
        "source": "tsv" if file_complete else "tsv-partial",
        "file_complete": file_complete,
        "countries_complete": len(complete),
        "countries_with_matches": countries_with_matches,
        "truncated_country": truncated,
        "records_written": len(all_records),
        "unresolved_titles": sorted(unresolved_all),
    }


def run(countries: list[str], sync_everything: bool = False, force_download: bool = False, offline: bool = False) -> None:
    series_index = load_tmdb_series_index(NODE_DB_PATH)
    aliases = load_title_aliases(series_index)
    print(
        f"[netflix_pipeline] {len(series_index)} TMDB dizisi + {len(aliases)} başlık takma adı "
        f"(IMDb AKA / Netflix yayın adı) yüklendi (eşleştirme havuzu)."
    )
    series_index = series_index + aliases
    if sync_everything:
        result = sync_all(series_index, force_download=force_download, offline=offline)
        print(f"[netflix_pipeline] {result}")
        return
    for country in countries:
        result = sync_country(country, series_index)
        print(f"[netflix_pipeline] {result}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("countries", nargs="*", help="İki harfli ISO2 kod, örn: TR ES PL")
    parser.add_argument("--all", action="store_true", help="Dosyadaki tüm ülkeleri tek geçişte yaz")
    parser.add_argument(
        "--force-download", action="store_true", help="Yerelde tam dosya olsa bile yeniden indir (haftalık güncelleme için)"
    )
    parser.add_argument(
        "--offline", action="store_true", help="Ağa çıkma; diskteki tam ya da kısmi dosyayı kullan (sadece --all ile)"
    )
    args = parser.parse_args()
    if not args.all and not args.countries:
        parser.error("En az bir ISO2 kod ya da --all verin.")
    if args.offline and args.force_download:
        parser.error("--offline ile --force-download birlikte kullanılamaz.")
    run(args.countries, sync_everything=args.all, force_download=args.force_download, offline=args.offline)
