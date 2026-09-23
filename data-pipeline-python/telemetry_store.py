"""Gayriresmî telemetri yazma kapısı — kaynak-bağımsız.

FlixPatrol, Telegram, korsan izleme siteleri ve benzeri RESMÎ OLMAYAN kaynaklardan gelen her
sinyal bu kapıdan geçer. Kaynağa özel bir mantık YOK: yarın lisanslı bir API ya da başka bir
telemetri eklendiğinde yeni bir yazma yolu açılmaz, `source` alanı ayırır.

ÜÇ SERT KURAL
-------------
1) GÜVEN ETİKETİ ÇAĞIRANA BIRAKILMAZ. Kayıt her zaman `unofficial_telemetry` / `LOW` olarak
   yazılır — çağıranın sözlüğünde ne yazarsa yazsın. Etiketi çağırana bırakmak, tek bir
   dikkatsiz çağrının korsan kaynaklı veriyi resmî ölçümle aynı sınıfa sokması demekti.
2) KİMLİK UYDURULMAZ. Dizi adı kanonik omurgaya güvenle bağlanamıyorsa `canonical_id` NULL
   kalır ve kayıt `unresolved_queue`ya düşer. Bu, identity.py'deki ilkenin aynısı.
3) EŞLEŞTİRME ALT-DİZE ARAMASI DEĞİL. Netflix katmanında tam bu hata yaşandı: kataloğumuzdaki
   "Anne" dizisi, "Anne Rice's Mayfair Witches" başlığıyla eşleşip 7 ülkede uydurma satır
   yazdı. Burada yalnızca TAM ad eşleşmesi kabul ediliyor.
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from typing import Iterable, Optional

# Bu iki değer sabittir ve parametre DEĞİLDİR — kapının varlık sebebi bunları zorlamak.
TRUST_LEVEL = "unofficial_telemetry"
CONFIDENCE = "LOW"

# Kanonik ada güvenle bağlanamayan kaydın kuyruk gerekçesi (identity.UnresolvedReason ile aynı
# sözlük; buraya import edilmiyor çünkü telemetri kaydı bir KİMLİK kaydı değil, gerekçe metni
# aynı kalsın yeter).
REASON_NAME_ONLY = "name_only"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_for_match(text: str) -> str:
    """Eşleştirme için sadeleştirme: noktalama atılır, boşluk tekilleşir, küçük harfe iner."""
    sade = re.sub(r"[^\w\s]", " ", (text or ""), flags=re.UNICODE)
    return re.sub(r"\s+", " ", sade).strip().casefold()


def build_title_index(conn: sqlite3.Connection) -> dict[str, str]:
    """normalize edilmiş primary_title -> canonical_id.

    AYNI normalize adı iki kanonik kayda düşerse İKİSİ DE indeksten çıkarılır: belirsiz bir
    eşleşmeyi rastgele birine bağlamak, hiç bağlamamaktan kötüdür (yanlış diziye talep atfeder
    ve bu sessizce olur).
    """
    sayac: dict[str, list[str]] = {}
    for canonical_id, primary_title in conn.execute(
        "SELECT canonical_id, primary_title FROM canonical_identity"
    ):
        anahtar = normalize_for_match(primary_title)
        if not anahtar:
            continue
        sayac.setdefault(anahtar, []).append(canonical_id)
    return {k: v[0] for k, v in sayac.items() if len(v) == 1}


def resolve_canonical(raw_title: str, title_index: dict[str, str]) -> Optional[str]:
    """Ham başlığı kanonik kimliğe bağlar — yalnızca TAM ad eşleşmesiyle.

    Alt-dize ya da bulanık eşleştirme bilerek YOK. Telemetri kaynakları zaten en düşük güven
    sınıfında; üstüne bir de belirsiz bir kimlik eşleşmesi koymak, iki katmanlı bir tahmini
    kesin veri gibi göstermek olurdu.
    """
    return title_index.get(normalize_for_match(raw_title))


def save_telemetry(
    conn: sqlite3.Connection,
    records: Iterable[dict],
    *,
    source: str,
) -> dict:
    """Telemetri kayıtlarını yazar. Dönen özet: kaç satır yazıldı, kaçı kimliğe bağlanamadı.

    `records` içindeki `source_trust_level` / `confidence_score` alanları YOK SAYILIR —
    değerler burada sabitlenir (kuralın gerekçesi modül docstring'inde).
    """
    kayitlar = list(records)
    if not kayitlar:
        return {"written": 0, "resolved": 0, "unresolved": 0, "source": source}

    title_index = build_title_index(conn)
    yazilan = 0
    cozulen = 0
    cozulemeyen = 0

    for r in kayitlar:
        raw_title = (r.get("title") or r.get("raw_title") or "").strip()
        if not raw_title:
            continue

        canonical_id = resolve_canonical(raw_title, title_index)
        # source_ref: aynı kaydın tekrar taranmasında üzerine yazılabilmesi için kararlı bir
        # anahtar (UNIQUE kısıtı bunun üzerinde).
        source_ref = r.get("source_ref") or "/".join(
            str(r.get(k) or "") for k in ("platform", "country", "country_slug", "scraped_at")
        )

        conn.execute(
            """
            INSERT INTO unofficial_telemetry
                (source, source_ref, raw_title, canonical_id, platform, country_slug,
                 country_iso2, rank, metric_value, source_trust_level, confidence_score, observed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source, source_ref, raw_title) DO UPDATE SET
                canonical_id = excluded.canonical_id,
                rank = excluded.rank,
                metric_value = excluded.metric_value,
                observed_at = excluded.observed_at
            """,
            (
                source,
                source_ref,
                raw_title,
                canonical_id,
                r.get("platform"),
                r.get("country_slug") or r.get("country"),
                r.get("country_iso2"),
                r.get("rank"),
                r.get("metric_value"),
                TRUST_LEVEL,  # çağıranın değeri KULLANILMAZ
                CONFIDENCE,  # çağıranın değeri KULLANILMAZ
                r.get("scraped_at") or r.get("observed_at") or _now_iso(),
            ),
        )
        yazilan += 1

        if canonical_id:
            cozulen += 1
        else:
            cozulemeyen += 1
            # Kimlik uydurmak yerine kuyruğa: kaynak sonradan tanınırsa yeniden çözülebilir.
            conn.execute(
                """
                INSERT INTO unresolved_queue (source, source_ref, raw_title, reason, candidates, detail, seen_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source, source_ref) DO UPDATE SET
                    raw_title = excluded.raw_title, seen_at = excluded.seen_at
                """,
                (
                    source,
                    f"{source_ref}::{raw_title}",
                    raw_title,
                    REASON_NAME_ONLY,
                    json.dumps([], ensure_ascii=False),
                    "telemetri kaydı kanonik ada TAM eşleşmedi — kimlik uydurulmadı",
                    _now_iso(),
                ),
            )

    conn.commit()
    return {"written": yazilan, "resolved": cozulen, "unresolved": cozulemeyen, "source": source}


def load_telemetry(conn: sqlite3.Connection, *, source: Optional[str] = None) -> list[dict]:
    """Telemetri kayıtlarını okur. Okunan her satır zaten gayriresmî/LOW etiketli —
    bu fonksiyonun çıktısı doğrudan bültene ya da arayüze VERİLEMEZ (bkz. claims.py
    TELEMETRY_ONLY kapısı ve server/services/claimsGate.js)."""
    sql = "SELECT * FROM unofficial_telemetry"
    params: tuple = ()
    if source:
        sql += " WHERE source = ?"
        params = (source,)
    eski_factory = conn.row_factory
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql + " ORDER BY observed_at DESC", params)]
    finally:
        conn.row_factory = eski_factory
