"""GitHub Actions'tan indirilen Netflix kaynak dosyasını (netflix-sync iş akışının artifact'ı)
yerel data/ dizinine alır ve `netflix_pipeline.py --all --offline` çalıştırır.

Kullanım:
    gh run download <run-id> -n netflix-all-weeks-countries -D data-pipeline-python/data
    python netflix_import_artifact.py                 # data/all-weeks-countries.tsv yerinde doğrulanır
    python netflix_import_artifact.py ~/Downloads/all-weeks-countries.tsv   # başka yerden kopyalar

Yapılanlar: dosya tamlık kontrolünden geçer (kesik dosya kabul edilmez), hedefe kopyalanır
(kaynak zaten hedefse yalnızca doğrulanır), eski `.tsv.partial` ve meta dosyası silinir (artık
tam dosya var), sonra hat çevrimdışı koşulur. `--no-run` yalnızca kopyalar.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

import netflix_country_ranker as nf
from netflix_fetch_source import verify_source
from logsetup import get_logger

log = get_logger(__name__)

BASE_DIR = Path(__file__).parent
DEFAULT_CACHE_DIR = BASE_DIR / "data"


def import_source(src: Path, cache_dir: Path) -> Path:
    """Doğrula + kopyala + kısmi kalıntıları temizle. Kesik/bozuk dosyada ValueError."""
    if not src.exists():
        raise FileNotFoundError(f"Kaynak dosya yok: {src}")
    summary = verify_source(src, downloader_says_complete=True)
    if not summary["complete"]:
        raise ValueError(f"Dosya tam değil, içe alınmadı: {summary['reason']}")

    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / nf.FILENAME
    if src.resolve() != dest.resolve():
        shutil.copyfile(src, dest)
        log.info(f"kopyalandı: {src} → {dest} ({summary['size_bytes']} bayt)")
    else:
        log.info(f"yerinde doğrulandı: {dest} ({summary['size_bytes']} bayt)")

    for kalinti in (dest.with_suffix(".tsv.partial"), dest.with_suffix(".tsv.partial.json")):
        if kalinti.exists():
            kalinti.unlink()
            log.info(f"kısmi indirme kalıntısı silindi: {kalinti.name}")
    nf.cleanup_temp_files(cache_dir)
    log.info(
        f"{summary['rows']} satır, {summary['countries']} ülke ({summary['first_country']}→{summary['last_country']}), "
        f"haftalar {summary['first_week']}→{summary['last_week']}"
    )
    return dest


def run_pipeline_offline(python: str = sys.executable) -> int:
    """netflix_pipeline.py --all --offline alt süreç olarak (README'deki komutla birebir aynı)."""
    cmd = [python, str(BASE_DIR / "netflix_pipeline.py"), "--all", "--offline"]
    log.info("çalıştırılıyor: " + " ".join(cmd))
    return subprocess.run(cmd, cwd=BASE_DIR).returncode


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("source", nargs="?", type=Path, default=None, help="İndirilen TSV (varsayılan: data/all-weeks-countries.tsv)")
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--no-run", action="store_true", help="Yalnızca doğrula/kopyala; hattı çalıştırma")
    args = parser.parse_args(argv)
    src = args.source or (args.cache_dir / nf.FILENAME)
    try:
        import_source(src, args.cache_dir)
    except (FileNotFoundError, ValueError) as exc:
        log.error(str(exc))
        return 1
    if args.no_run:
        return 0
    return run_pipeline_offline()


if __name__ == "__main__":
    sys.exit(main())
