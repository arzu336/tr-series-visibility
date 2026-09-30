"""chart_entries.program_kind'ı yeniden sınıflandırır — ağa çıkmaz.

Sınıflandırma kuralı (providers.base.classify_program_kind) değiştiğinde tüm arşivi yeniden çekmek
yerine mevcut satırlara uygulanır. Ayrıştırıcının başlık sandığı uzun makale özetlerinde (90+ karakter)
yanlış katalog eşleşmesi de kaldırılır (series_id → NULL).

Kullanım: python reclassify_chart_entries.py [--provider reytingtv] [--db data/pipeline.db]
"""
from __future__ import annotations

import argparse
import json
import logging
import sqlite3
from pathlib import Path

from providers.base import _MAX_TITLE_LEN, classify_program_kind

log = logging.getLogger("reclassify_chart_entries")


def run(db_path: Path, provider: str = "reytingtv") -> dict:
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT rowid, title_raw, series_id, program_kind FROM chart_entries WHERE provider=?", (provider,)
        ).fetchall()
        changed_kind = 0
        cleared_match = 0
        for rowid, title_raw, series_id, kind in rows:
            new_series_id = None if (series_id is not None and len(title_raw or "") > _MAX_TITLE_LEN) else series_id
            new_kind = classify_program_kind(title_raw, new_series_id)
            if new_kind != kind or new_series_id != series_id:
                conn.execute(
                    "UPDATE chart_entries SET program_kind=?, series_id=? WHERE rowid=?", (new_kind, new_series_id, rowid)
                )
                changed_kind += int(new_kind != kind)
                cleared_match += int(new_series_id != series_id)
        conn.commit()
        counts = dict(
            conn.execute(
                "SELECT program_kind, COUNT(*) FROM chart_entries WHERE provider=? GROUP BY program_kind", (provider,)
            ).fetchall()
        )
        return {"rows": len(rows), "kind_changed": changed_kind, "match_cleared": cleared_match, "program_kinds": counts}
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--provider", default="reytingtv")
    ap.add_argument("--db", default=str(Path(__file__).parent / "data" / "pipeline.db"))
    args = ap.parse_args()
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)-7s [%(name)s] %(message)s")
    result = run(Path(args.db), args.provider)
    log.info("sonuç: %s", result)
    print("RESULT_JSON", json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
