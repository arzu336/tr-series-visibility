"""Netflix Top 10 kaynak dosyasını (all-weeks-countries.tsv) yalnızca İNDİRİR ve tamlığını
doğrular; eşleştirme/veritabanı yazımı yapmaz. GitHub Actions'taki netflix-sync iş akışının
tek adımı budur: bu ağdan tam inmeyen ~32 MB'lık dosya (bkz. netflix_country_ranker.py
docstring'i, madde 2) GitHub'ın koşucusundan indirilir, artifact olarak yüklenir, yerelde
`netflix_import_artifact.py` ile data/ dizinine alınır.

Çıkış kodu sözleşmesi (iş akışı buna dayanır):
  0 → dosya tam (boyut/yapısal kontrol + başlık satırı + ülke blokları) ve özet JSON yazıldı
  1 → dosya kısmi ya da bozuk; en uzun kısmi dosya ve özet yine diske yazılır (teşhis için)
  2 → indirme hiç başlayamadı (ağ yok, ilk baytlar gelmedi)

Kurallar aynen geçerli: robots.txt'in izin verdiği kamuya açık dosya, tarayıcı benzeri tek bir
istek kimliği, bot atlatma yok, API anahtarı ya da gizli bilgi gerekmez.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import netflix_country_ranker as nf
from logsetup import get_logger

log = get_logger(__name__)

BASE_DIR = Path(__file__).parent
DEFAULT_CACHE_DIR = BASE_DIR / "data"
SUMMARY_FILENAME = "netflix-source-summary.json"
EXPECTED_HEADER = [
    "country_name",
    "country_iso2",
    "week",
    "category",
    "weekly_rank",
    "show_title",
    "season_title",
    "cumulative_weeks_in_top_10",
]
# Gerçek dosya ~90 ülke, 5 yıl × 52 hafta × 2 kategori × 10 sıra ≈ 480 bin satır. Bunun çok
# altındaki bir "tam" dosya, sunucunun kısa bir hata sayfası dönmüş olması demektir.
MIN_ROWS_FOR_REAL_FILE = 100_000
MIN_COUNTRIES_FOR_REAL_FILE = 60


def inspect_tsv(path: Path) -> dict:
    """Dosyayı tek geçişte okur: başlık doğru mu, kaç satır, kaç ülke, ilk/son ülke, hafta aralığı.
    Ağ yok; yalnızca disk. Kesik son satır csv tarafından okunursa da _looks_complete zaten
    onu yakalar — buradaki sayımlar teşhis içindir."""
    rows = 0
    countries: list[str] = []
    first_week: Optional[str] = None
    last_week: Optional[str] = None
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        header = next(reader, None)
        header_ok = header == EXPECTED_HEADER
        for row in reader:
            if len(row) != len(EXPECTED_HEADER):
                continue
            rows += 1
            iso2 = row[1].strip().upper()
            if not countries or countries[-1] != iso2:
                countries.append(iso2)
            week = row[2]
            if week:
                first_week = week if first_week is None or week < first_week else first_week
                last_week = week if last_week is None or week > last_week else last_week
    return {
        "header_ok": header_ok,
        "rows": rows,
        "countries": len(set(countries)),
        "first_country": countries[0] if countries else None,
        "last_country": countries[-1] if countries else None,
        "first_week": first_week,
        "last_week": last_week,
    }


def verify_source(path: Path, downloader_says_complete: bool) -> dict:
    """İndiricinin 'tam' kararını bağımsız kontrollerle çaprazlar; tek bir `complete` bayrağı ve
    insan-okunur `reason` üretir."""
    structural_ok = nf._looks_complete(path, -1)
    info = inspect_tsv(path) if path.exists() and path.stat().st_size > 0 else {
        "header_ok": False, "rows": 0, "countries": 0, "first_country": None, "last_country": None,
        "first_week": None, "last_week": None,
    }
    reasons = []
    if not downloader_says_complete:
        reasons.append("indirici tüm denemelerde eksik kaldı (content-length'e ulaşılamadı)")
    if not structural_ok:
        reasons.append("son satır kesik ya da alan sayısı 8 değil")
    if not info["header_ok"]:
        reasons.append("başlık satırı beklenen 8 sütunla eşleşmiyor")
    if info["rows"] < MIN_ROWS_FOR_REAL_FILE:
        reasons.append(f"satır sayısı gerçek dosya için çok düşük ({info['rows']} < {MIN_ROWS_FOR_REAL_FILE})")
    if info["countries"] < MIN_COUNTRIES_FOR_REAL_FILE:
        reasons.append(f"ülke sayısı çok düşük ({info['countries']} < {MIN_COUNTRIES_FOR_REAL_FILE})")
    return {
        "complete": not reasons,
        "reason": None if not reasons else "; ".join(reasons),
        "path": str(path),
        "size_bytes": path.stat().st_size if path.exists() else 0,
        "structural_ok": structural_ok,
        **info,
    }


def fetch(cache_dir: Path, force: bool = True) -> dict:
    """İndir + doğrula + özet. Ağ tamamen başarısızsa RuntimeError (indirici fırlatır)."""
    path, is_complete = nf.download_dataset(cache_dir, force=force)
    summary = verify_source(path, is_complete)
    summary["downloaded_at"] = datetime.now(timezone.utc).isoformat()
    summary["source_url"] = nf.DATA_URL
    return summary


def write_summary(summary: dict, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR, help="TSV'nin yazılacağı dizin (varsayılan: data/)")
    parser.add_argument("--summary-json", type=Path, default=None, help="Özet JSON yolu (varsayılan: <cache-dir>/netflix-source-summary.json)")
    parser.add_argument("--no-force", action="store_true", help="Taze tam dosya varsa yeniden indirme (varsayılan: her zaman indir)")
    args = parser.parse_args(argv)
    summary_path = args.summary_json or (args.cache_dir / SUMMARY_FILENAME)

    try:
        summary = fetch(args.cache_dir, force=not args.no_force)
    except RuntimeError as exc:
        summary = {
            "complete": False,
            "reason": f"indirme başlayamadı: {exc}",
            "path": None,
            "downloaded_at": datetime.now(timezone.utc).isoformat(),
            "source_url": nf.DATA_URL,
        }
        write_summary(summary, summary_path)
        log.error(summary["reason"])
        return 2

    write_summary(summary, summary_path)
    if summary["complete"]:
        log.info(
            f"TAM: {summary['size_bytes']} bayt, {summary['rows']} satır, {summary['countries']} ülke "
            f"({summary['first_country']}→{summary['last_country']}), haftalar {summary['first_week']}→{summary['last_week']}"
        )
        return 0
    log.error(
        f"KISMİ/BOZUK: {summary['reason']} — {summary['size_bytes']} bayt, son ülke {summary['last_country']}, "
        f"son hafta {summary['last_week']}"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
