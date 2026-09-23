"""Modül 3 koşusu — kanonik omurga + gerçek Wikipedia serileriyle iddia üretimi.

Zinciri uçtan uca çalıştırır:
    pipeline.db/canonical_identity   (Modül 2)
        -> app.db/series_language_interest  (Wikipedia okunma katmanı)
        -> ClaimEngine                       (Modül 3)
"""
from __future__ import annotations

import sqlite3
import sys
from collections import Counter
from pathlib import Path

from claims import ClaimEngine, build_cohort_stats
from claims_models import GeoKind, MetricPoint, MetricSeries, SourceTrustLevel

BASE_DIR = Path(__file__).resolve().parent
PIPELINE_DB = BASE_DIR / "data" / "pipeline.db"
NODE_DB = BASE_DIR.parent / "server" / "data" / "app.db"


def seriler_of(node, tmdb_id) -> list[MetricSeries]:
    """Bir dizinin dil başına Wikipedia okunma serileri.

    geo_kind=LANGUAGE: Wikimedia makale bazında ÜLKE kırılımı vermiyor, bu bir dil sinyalidir.
    """
    seriler = []
    for lang in [
        r["lang"]
        for r in node.execute(
            "SELECT DISTINCT lang FROM series_language_interest WHERE tmdb_id = ?", (tmdb_id,)
        )
    ]:
        noktalar = [
            MetricPoint(year=r["year"], month=r["month"], value=r["views"])
            for r in node.execute(
                "SELECT year, month, views FROM series_language_interest "
                "WHERE tmdb_id = ? AND lang = ? ORDER BY year, month",
                (tmdb_id, lang),
            )
        ]
        seriler.append(
            MetricSeries(
                metric_type="views",
                source=f"wikipedia:{lang}",
                trust=SourceTrustLevel.OFFICIAL,
                geo_or_lang=lang,
                geo_kind=GeoKind.LANGUAGE,
                points=noktalar,
            )
        )
    return seriler


def main() -> int:
    pipe = sqlite3.connect(PIPELINE_DB)
    pipe.row_factory = sqlite3.Row
    node = sqlite3.connect(f"file:{NODE_DB}?mode=ro", uri=True)
    node.row_factory = sqlite3.Row

    # tmdb_id -> canonical_id. Wikipedia katmanı tmdb_id ile anahtarlı; kanonik omurga
    # onu wd:/imdb:/tmdb: kimliğine bağlıyor.
    kanonik = {
        r["tmdb_id"]: r["canonical_id"]
        for r in pipe.execute("SELECT tmdb_id, canonical_id FROM canonical_identity WHERE tmdb_id IS NOT NULL")
    }

    diziler = [r["tmdb_id"] for r in node.execute("SELECT DISTINCT tmdb_id FROM series_language_interest")]
    print(f"{len(diziler)} dizinin Wikipedia serisi var, {len(kanonik)} kanonik kimlik yüklendi.\n")

    # 1. GEÇİŞ — kohort istatistikleri. Tek geçişte yapılamaz: bir dizinin kohorttan
    # sapmasını ölçmek için önce TÜM korpusun medyan hareketi bilinmeli.
    korpus = []
    for tmdb_id in diziler:
        canonical_id = kanonik.get(tmdb_id)
        if canonical_id is None:
            continue
        korpus.append((canonical_id, seriler_of(node, tmdb_id)))
    cohorts = build_cohort_stats(korpus)
    print(f"{len(cohorts)} kohort hesaplandı (>= 5 dizi olanlar).")
    for k, v in sorted(cohorts.items(), key=lambda kv: -kv[1].series_count)[:6]:
        print(f"  {k:24s} medyan {v.median_ratio:5.2f}x  ({v.series_count} dizi)")
    print()

    # 2. GEÇİŞ — iddialar, kohort bağlamıyla.
    kesif = "--exploratory" in sys.argv
    motor = ClaimEngine(exploratory=kesif)
    print(("KEŞİF MODU" if kesif else "VARSAYILAN MOD") + " — kapı davranışı\n")
    tum_claims = []
    kimliksiz = 0

    for tmdb_id in diziler:
        canonical_id = kanonik.get(tmdb_id)
        if canonical_id is None:
            kimliksiz += 1
            continue

        tum_claims.extend(
            motor.generate_claims(canonical_id, seriler_of(node, tmdb_id), cohorts=cohorts)
        )

    dogrulanmis = [c for c in tum_claims if c.passed_gates]
    print(f"ÜRETİLEN İDDİA : {len(tum_claims)}")
    print(f"  doğrulanmış  : {len(dogrulanmis)}")
    print(f"  doğrulanmamış: {len(tum_claims) - len(dogrulanmis)}")
    sifirdan = [c for c in tum_claims if c.from_zero]
    if sifirdan:
        print(f"  sıfırdan çıkış: {len(sifirdan)} (yüzde üretilmedi)")
    print(f"REDDEDİLEN ADAY: {len(motor.rejected)}")
    if kimliksiz:
        print(f"(kanonik kimliği olmayan {kimliksiz} dizi atlandı)")

    print("\n--- red gerekçeleri ---")
    for reason, n in Counter(r.reason.value for r in motor.rejected).most_common():
        print(f"  {reason:22s} {n}")

    print("\n--- güven dağılımı ---")
    for skor, n in Counter(c.confidence_score.value for c in tum_claims).most_common():
        print(f"  {skor:8s} {n}")

    print("\n--- en büyük 8 hareket ---")
    for c in sorted(tum_claims, key=lambda c: abs(c.change_pct), reverse=True)[:8]:
        print(f"  [{c.confidence_score.value:6s}] {c.canonical_id:16s} {c.geo_or_lang:5s} "
              f"%{c.change_pct:>7.1f}  {c.baseline_value:>9.0f} -> {c.current_value:<9.0f}")

    print("\n--- örnek iddia metni ---")
    if tum_claims:
        ornek = max(tum_claims, key=lambda c: c.current_value)
        print(f"  {ornek.claim_text}")
        print(f"  kaynak: {ornek.sources} | pencere: {ornek.window} | id: {ornek.claim_id[:8]}...")

    pipe.close()
    node.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
