"""IMDb Non-Commercial Datasets modülü — web scraping YAPMAZ.

IMDb'nin resmi, ücretsiz "Non-Commercial Datasets" arşivini (https://datasets.imdbws.com,
lisans: https://developer.imdb.com/non-commercial-datasets/) indirip yerel diskte
ayrıştırır. Bu, IMDb'nin ToS'unu ihlal etmeden IMDb verisine erişmenin resmi yoludur —
`/reviews` veya `/releaseinfo` sayfalarını scrape etmez, bot korumasıyla hiç
karşılaşmaz.

Gerçek dosya boyutları (ilk çalıştırmada bir kereliğine indirilir, sonra yerelden
okunur — 2026-08-19 itibarıyla doğrulandı):
  - title.ratings.tsv.gz  ~9 MB    (tconst, averageRating, numVotes)
  - title.basics.tsv.gz   ~226 MB  (tconst, titleType, primaryTitle, originalTitle, ...)
  - title.akas.tsv.gz     ~511 MB  (titleId, ordering, title, region, language, ...)
İlk çalıştırma bu yüzden birkaç dakika sürebilir ve ~750 MB disk alanı ister.

DÜRÜST SINIR: Bu veri setinde ÜLKE BAZLI İLK YAYIN TARİHİ YOKTUR. title.akas sadece
"bu başlık şu ülkede bu isimle biliniyor" bilgisini verir, bir tarih taşımaz. Ülke
bazlı yayın tarihi IMDb'nin scrape edilmesi gereken /releaseinfo sayfasında veya
ücretli resmi API'sinde olabilir — burada UYDURULMAZ, ImdbSeriesInfo.note alanında
bu sınır açıkça belirtilir.
"""
from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

from models import ImdbSeriesInfo, LocalizedTitle

DATASET_BASE_URL = "https://datasets.imdbws.com"
DATASET_FILES = {
    "basics": "title.basics.tsv.gz",
    "akas": "title.akas.tsv.gz",
    "ratings": "title.ratings.tsv.gz",
}
RELEVANT_TITLE_TYPES = {"tvSeries", "tvMiniSeries"}


def _cache_path(cache_dir: Path, key: str) -> Path:
    return cache_dir / DATASET_FILES[key]


def download_dataset(key: str, cache_dir: Path, force: bool = False, chunk_size: int = 1 << 20) -> Path:
    """Zaten indirilmişse tekrar indirmez (force=True hariç) — dosyalar günlük
    güncelleniyor ama her çağrıda yeniden indirmek gereksiz bant genişliği harcar.
    .part uzantısıyla indirip sonda yeniden adlandırır — yarım kalan bir indirme
    asla geçerli bir dosya gibi görünmez."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = _cache_path(cache_dir, key)
    if dest.exists() and not force:
        return dest

    url = f"{DATASET_BASE_URL}/{DATASET_FILES[key]}"
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=120) as res:
        res.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in res.iter_content(chunk_size=chunk_size):
                if chunk:
                    f.write(chunk)
    tmp.replace(dest)
    return dest


def _iter_tsv_rows(gz_path: Path):
    import gzip

    with gzip.open(gz_path, "rt", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        yield from reader


def _none_if_na(value: Optional[str]) -> Optional[str]:
    return None if value in (None, "", "\\N") else value


def find_series_rows(name_or_id: str, cache_dir: Path) -> list[dict]:
    """'tt' + rakam ile başlıyorsa doğrudan IMDb ID olarak eşleştirir. Aksi halde
    title.basics.tsv.gz içinde (tvSeries/tvMiniSeries) primaryTitle/originalTitle'da
    TAM eşleşme (Türkçe karakter duyarsız, casefold) arar. Bulunamazsa boş liste
    döner — kısmi/bulanık bir eşleşme asla uydurulmaz. Tek bir geçişte tarar (basics
    dosyası ~226 MB, iki kez taramamak için hem arama hem satır verisi burada döner)."""
    is_id = bool(name_or_id) and name_or_id.lower().startswith("tt") and name_or_id[2:].isdigit()
    target = None if is_id else name_or_id.strip().casefold()

    path = download_dataset("basics", cache_dir)
    matches: list[dict] = []
    for row in _iter_tsv_rows(path):
        if is_id:
            if row["tconst"] == name_or_id:
                matches.append(row)
                break
            continue
        if row["titleType"] not in RELEVANT_TITLE_TYPES:
            continue
        primary = _none_if_na(row["primaryTitle"])
        original = _none_if_na(row["originalTitle"])
        if (primary and primary.casefold() == target) or (original and original.casefold() == target):
            matches.append(row)
    return matches


def get_localized_titles(tconst: str, cache_dir: Path) -> list[LocalizedTitle]:
    """title.akas.tsv.gz ~511 MB — pandas chunksize ile bellek dostu taranır (tüm
    dosya asla RAM'e alınmaz), sadece verilen tconst'a ait satırlar biriktirilir."""
    import pandas as pd

    path = download_dataset("akas", cache_dir)
    seen: set[tuple[str, str]] = set()
    results: list[LocalizedTitle] = []
    for chunk in pd.read_csv(
        path,
        sep="\t",
        compression="gzip",
        chunksize=200_000,
        dtype=str,
        na_values="\\N",
        keep_default_na=False,
        quoting=csv.QUOTE_NONE,
    ):
        matched = chunk[chunk["titleId"] == tconst]
        if matched.empty:
            continue
        for _, row in matched.iterrows():
            region = row.get("region")
            if not region or (isinstance(region, float)):  # NaN (pandas float) == region yok
                continue
            title = row["title"]
            # Aynı ülke için aynı başlık metni birden çok akas satırında (farklı
            # "ordering"/"types" ile) tekrarlanabiliyor — (region, title) çiftine
            # göre tekilleştiriyoruz, tekrar aynı bilgiyi iki kez taşımanın anlamı yok.
            key = (region, title)
            if key in seen:
                continue
            seen.add(key)
            results.append(
                LocalizedTitle(
                    region=region,
                    title=title,
                    is_original=str(row.get("isOriginalTitle")) == "1",
                )
            )
    return results


def get_rating(tconst: str, cache_dir: Path) -> Optional[tuple[float, int]]:
    """title.ratings.tsv.gz küçük (~9 MB), satır satır taransa da hızlıdır."""
    path = download_dataset("ratings", cache_dir)
    for row in _iter_tsv_rows(path):
        if row["tconst"] == tconst:
            return float(row["averageRating"]), int(row["numVotes"])
    return None


def fetch_series(name_or_id: str, cache_dir: Path) -> Optional[ImdbSeriesInfo]:
    """Ana giriş noktası. Eşleşme yoksa None döner (uydurma bir sonuç üretmez).
    Birden fazla eşleşme varsa (aynı isimde birden çok dizi) ilkini kullanır —
    tconst (IMDb ID) vererek belirsizliği baştan ortadan kaldırmak daha güvenilirdir."""
    candidates = find_series_rows(name_or_id, cache_dir)
    if not candidates:
        return None
    basics = candidates[0]
    tconst = basics["tconst"]

    rating = get_rating(tconst, cache_dir)
    localized = get_localized_titles(tconst, cache_dir)

    return ImdbSeriesInfo(
        tconst=tconst,
        primary_title=basics["primaryTitle"],
        original_title=basics["originalTitle"],
        start_year=int(basics["startYear"]) if _none_if_na(basics["startYear"]) else None,
        end_year=int(basics["endYear"]) if _none_if_na(basics["endYear"]) else None,
        average_rating=rating[0] if rating else None,
        num_votes=rating[1] if rating else None,
        localized_titles=localized,
        fetched_at=datetime.now(timezone.utc),
    )
