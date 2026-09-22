"""Kanonik Kimlik Katmanı — tüm kaynakların ortak omurgası.

SORUN
-----
Dizilla, IMDb, Telegram, Wikipedia ve TMDB aynı diziyi farklı adlandırıyor:

    Kuruluş Osman  /  Kuruluş: Osman  /  المؤسس عثمان (مسلسل)
    Основание: Осман  /  Themelimi Osman  /  قیام عثمان

İsimden eşleştirme Latin dışı alfabelerde ve alt başlıklarda kırılıyor. Yanlış eşleşen
iki kayıt sessizce birleşir, analiz katmanı bunu "trend" diye okur, AI Müşavir modülü
ondan "stratejik öneri" üretir ve hata bültenle yöneticinin gelen kutusuna ulaşır.
Hiçbir aşamada alarm çalmaz. Bu yüzden kanonik kimlik YALNIZCA sert dış kimliklerden
kurulur; isim benzerliği kanonik atama için ASLA kullanılmaz.

ÖLÇÜLEN GERÇEK (60 dizilik TMDB örneği, canlı /tv/{id}/external_ids)
-------------------------------------------------------------------
    wikidata_id var : 47  (%78)
    imdb_id var     : 57  (%95)
    hiçbiri yok     :  3  (%5)

Bu yüzden `wikidata_id` TEK BAŞINA birincil anahtar olamaz: katalogun %22'si elenirdi
(ayrıca null olabilen bir sütun zaten PRIMARY KEY olamaz). Öncelik sırası korunuyor ama
anahtar, sırayı KODLAYAN türetilmiş bir dizge:

    wd:Q64878719   >   imdb:tt11712058   >   tmdb:95603

Böylece hem öncelik açık, hem hiçbir gerçek kayıt kaybolmuyor, hem de bir kaydın hangi
sertlikte bir kimliğe dayandığı (`tier`) her zaman okunabiliyor — analiz katmanı buna
bakarak "bu kayıt diller arası birleştirilebilir mi" sorusunu cevaplayabilir.

DROP DEĞİL, KUYRUK
------------------
Çözülemeyen kayıt silinmez. 'drop' geri alınamaz ve denetlenemez: üç ay sonra "neyi
kaybettik" sorusu cevapsız kalır. Kayıt `unresolved_queue`ya düşer; kaynak sonradan sert
kimlik kazanırsa aynı satır yeniden çözülür.
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from typing import Iterable, Optional

from models import CanonicalIdentity, ResolutionTier, UnresolvedReason, UnresolvedRecord

WIKIDATA_RE = re.compile(r"^Q\d+$")
IMDB_RE = re.compile(r"^tt\d+$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def build_canonical_id(
    wikidata_id: Optional[str] = None,
    imdb_id: Optional[str] = None,
    tmdb_id: Optional[int] = None,
) -> Optional[tuple[str, ResolutionTier]]:
    """Öncelik sırasına göre kanonik anahtarı türetir. Hiçbir sert kimlik yoksa None —
    çağıran taraf bunu kuyruğa almak zorundadır, isimden anahtar üretemez."""
    if wikidata_id and WIKIDATA_RE.match(wikidata_id):
        return f"wd:{wikidata_id}", ResolutionTier.WIKIDATA
    if imdb_id and IMDB_RE.match(imdb_id):
        return f"imdb:{imdb_id}", ResolutionTier.IMDB
    if tmdb_id is not None:
        return f"tmdb:{tmdb_id}", ResolutionTier.TMDB
    return None


class IdentityConflict(Exception):
    """İki sert kimlik birbiriyle çelişiyor (örn. aynı imdb_id farklı bir kanonik kayda
    bağlı). Sessizce birleştirmek yerine yükseltilir; çağıran taraf kuyruğa alır."""


class IdentityResolver:
    """Kanonik kimlik çözümleyici.

    Tek giriş noktası `resolve()`: sert kimlikleri olan bir kaydı kanonik kimliğe bağlar,
    bağlayamazsa kuyruğa atar ve None döner. İsimden çözüm için ayrı ve BİLİNÇLİ OLARAK
    otomatik-birleştirmeyen `propose_by_title()` vardır.
    """

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        # Bu modül sütunlara ADIYLA erişiyor (row["tier"]) — okunabilirlik burada önemli,
        # çünkü kanonik kayıt 7 sütunlu ve pozisyonel okuma sessiz hata kaynağı olurdu.
        # sqlite3.Row pozisyonel açmayı da desteklediği için (`for a, b, c in rows`) mevcut
        # çağıranlar etkilenmez — pipeline'da bu şekilde okuyan iki yer var ve ikisi de
        # bu değişiklikle uyumlu (backfill_reytingtv.py, reytingtv_ranker.py).
        conn.row_factory = sqlite3.Row

    # --- Okuma ---------------------------------------------------------------------
    def lookup(self, canonical_id: str) -> Optional[CanonicalIdentity]:
        """Kanonik kimliği getirir. Anahtar bir takma ad ise (kademe yükseltmesi sonrası
        eski anahtar) güncel kayda yönlendirir — eski referanslar kırılmaz."""
        row = self.conn.execute(
            "SELECT * FROM canonical_identity WHERE canonical_id = ?", (canonical_id,)
        ).fetchone()
        if row is None:
            alias = self.conn.execute(
                "SELECT canonical_id FROM canonical_alias WHERE alias_id = ?", (canonical_id,)
            ).fetchone()
            if alias is None:
                return None
            row = self.conn.execute(
                "SELECT * FROM canonical_identity WHERE canonical_id = ?", (alias[0],)
            ).fetchone()
            if row is None:
                return None
        return self._row_to_identity(row)

    def find_by_external(
        self,
        wikidata_id: Optional[str] = None,
        imdb_id: Optional[str] = None,
        tmdb_id: Optional[int] = None,
    ) -> Optional[CanonicalIdentity]:
        """Verilen sert kimliklerden HERHANGİ biriyle eşleşen kaydı bulur.
        Birden fazla FARKLI kayıtla eşleşirse çelişkidir — sessiz birleştirme yapılmaz."""
        bulunanlar: dict[str, CanonicalIdentity] = {}
        for sutun, deger in (("wikidata_id", wikidata_id), ("imdb_id", imdb_id), ("tmdb_id", tmdb_id)):
            if deger is None:
                continue
            row = self.conn.execute(
                f"SELECT * FROM canonical_identity WHERE {sutun} = ?", (deger,)
            ).fetchone()
            if row is not None:
                kimlik = self._row_to_identity(row)
                bulunanlar[kimlik.canonical_id] = kimlik
        if len(bulunanlar) > 1:
            raise IdentityConflict(
                "aynı kayıt birden fazla kanonik kimliğe işaret ediyor: " + ", ".join(sorted(bulunanlar))
            )
        return next(iter(bulunanlar.values()), None)

    # --- Yazma ---------------------------------------------------------------------
    def resolve(
        self,
        *,
        source: str,
        source_ref: str,
        title: str,
        wikidata_id: Optional[str] = None,
        imdb_id: Optional[str] = None,
        tmdb_id: Optional[int] = None,
    ) -> Optional[CanonicalIdentity]:
        """Bir kaydı kanonik kimliğe bağlar.

        Dönen None, "bu kayıt çözülemedi" demektir ve kayıt kuyruğa alınmıştır — çağıran
        taraf None'ı sessizce atlamak yerine sayması gereken bir sonuç olarak ele almalıdır.
        """
        # Biçimi bozuk kimliği kabul etmek, onu anahtar yapıp yanlış birleştirmek demek.
        if wikidata_id and not WIKIDATA_RE.match(wikidata_id):
            self.queue(source, source_ref, title, UnresolvedReason.MALFORMED_ID, detail=f"wikidata_id={wikidata_id!r}")
            return None
        if imdb_id and not IMDB_RE.match(imdb_id):
            self.queue(source, source_ref, title, UnresolvedReason.MALFORMED_ID, detail=f"imdb_id={imdb_id!r}")
            return None

        turetilmis = build_canonical_id(wikidata_id, imdb_id, tmdb_id)
        if turetilmis is None:
            self.queue(source, source_ref, title, UnresolvedReason.NO_EXTERNAL_ID)
            return None
        canonical_id, tier = turetilmis

        try:
            mevcut = self.find_by_external(wikidata_id, imdb_id, tmdb_id)
        except IdentityConflict as err:
            self.queue(source, source_ref, title, UnresolvedReason.CONFLICT, detail=str(err))
            return None

        if mevcut is None:
            return self._insert(canonical_id, tier, wikidata_id, imdb_id, tmdb_id, title)

        # Kayıt zaten var. Yeni gelen kimlikler onu DAHA SERT bir kademeye taşıyor olabilir
        # (örn. önce yalnızca tmdb vardı, şimdi wikidata geldi).
        if canonical_id != mevcut.canonical_id:
            return self._upgrade(mevcut, canonical_id, tier, wikidata_id, imdb_id, tmdb_id, title)
        return self._enrich(mevcut, wikidata_id, imdb_id, tmdb_id, title)

    def propose_by_title(self, title: str, limit: int = 5) -> list[CanonicalIdentity]:
        """İsimden ADAY önerir — kanonik atama YAPMAZ.

        Dizilla slug'ı ya da Telegram kanal adı gibi yalnızca isim taşıyan kaynaklar için.
        Dönen liste `unresolved_queue.candidates` alanına yazılır ve insan incelemesine
        bırakılır. Buradan otomatik eşleştirme yapmak, bu modülün var olma sebebini
        ortadan kaldırırdı.
        """
        desen = f"%{title.strip()}%"
        rows = self.conn.execute(
            "SELECT * FROM canonical_identity WHERE primary_title LIKE ? LIMIT ?", (desen, limit)
        ).fetchall()
        return [self._row_to_identity(r) for r in rows]

    def queue(
        self,
        source: str,
        source_ref: str,
        raw_title: str,
        reason: UnresolvedReason,
        candidates: Optional[Iterable[str]] = None,
        detail: Optional[str] = None,
    ) -> UnresolvedRecord:
        kayit = UnresolvedRecord(
            source=source,
            source_ref=source_ref,
            raw_title=raw_title,
            reason=reason,
            candidates=list(candidates or []),
            detail=detail,
            seen_at=_now(),
        )
        self.conn.execute(
            """
            INSERT INTO unresolved_queue (source, source_ref, raw_title, reason, candidates, detail, seen_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source, source_ref) DO UPDATE SET
                raw_title = excluded.raw_title,
                reason = excluded.reason,
                candidates = excluded.candidates,
                detail = excluded.detail,
                seen_at = excluded.seen_at
            """,
            (
                kayit.source,
                kayit.source_ref,
                kayit.raw_title,
                kayit.reason.value,
                json.dumps(kayit.candidates, ensure_ascii=False),
                kayit.detail,
                _iso(kayit.seen_at),
            ),
        )
        self.conn.commit()
        return kayit

    def pending(self, source: Optional[str] = None) -> list[UnresolvedRecord]:
        sql = "SELECT * FROM unresolved_queue WHERE resolved_at IS NULL"
        params: tuple = ()
        if source:
            sql += " AND source = ?"
            params = (source,)
        rows = self.conn.execute(sql + " ORDER BY seen_at", params).fetchall()
        return [
            UnresolvedRecord(
                source=r["source"],
                source_ref=r["source_ref"],
                raw_title=r["raw_title"],
                reason=UnresolvedReason(r["reason"]),
                candidates=json.loads(r["candidates"]),
                detail=r["detail"],
                seen_at=datetime.fromisoformat(r["seen_at"]),
            )
            for r in rows
        ]

    def mark_queue_resolved(self, source: str, source_ref: str) -> None:
        self.conn.execute(
            "UPDATE unresolved_queue SET resolved_at = ? WHERE source = ? AND source_ref = ?",
            (_iso(_now()), source, source_ref),
        )
        self.conn.commit()

    # --- İç yardımcılar ------------------------------------------------------------
    def _insert(self, canonical_id, tier, wikidata_id, imdb_id, tmdb_id, title) -> CanonicalIdentity:
        kimlik = CanonicalIdentity(
            canonical_id=canonical_id,
            tier=tier,
            wikidata_id=wikidata_id,
            imdb_id=imdb_id,
            tmdb_id=tmdb_id,
            primary_title=title,
            resolved_at=_now(),
        )
        self.conn.execute(
            """
            INSERT INTO canonical_identity
                (canonical_id, tier, wikidata_id, imdb_id, tmdb_id, primary_title, resolved_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                kimlik.canonical_id,
                kimlik.tier.value,
                kimlik.wikidata_id,
                kimlik.imdb_id,
                kimlik.tmdb_id,
                kimlik.primary_title,
                _iso(kimlik.resolved_at),
            ),
        )
        self.conn.commit()
        return kimlik

    def _enrich(self, mevcut, wikidata_id, imdb_id, tmdb_id, title) -> CanonicalIdentity:
        """Aynı kanonik kayda eksik dış kimlikleri ekler. Var olan bir değeri FARKLI bir
        değerle EZMEZ — bu bir çelişkidir ve yukarı taşınır."""
        for ad, yeni, eski in (
            ("wikidata_id", wikidata_id, mevcut.wikidata_id),
            ("imdb_id", imdb_id, mevcut.imdb_id),
            ("tmdb_id", tmdb_id, mevcut.tmdb_id),
        ):
            if yeni is not None and eski is not None and yeni != eski:
                raise IdentityConflict(f"{mevcut.canonical_id}: {ad} çelişkisi ({eski!r} != {yeni!r})")

        self.conn.execute(
            """
            UPDATE canonical_identity SET
                wikidata_id = COALESCE(wikidata_id, ?),
                imdb_id = COALESCE(imdb_id, ?),
                tmdb_id = COALESCE(tmdb_id, ?),
                primary_title = COALESCE(NULLIF(primary_title, ''), ?)
            WHERE canonical_id = ?
            """,
            (wikidata_id, imdb_id, tmdb_id, title, mevcut.canonical_id),
        )
        self.conn.commit()
        return self.lookup(mevcut.canonical_id)  # type: ignore[return-value]

    def _upgrade(self, mevcut, yeni_id, yeni_tier, wikidata_id, imdb_id, tmdb_id, title) -> CanonicalIdentity:
        """Kaydı daha sert bir kademeye taşır (tmdb -> imdb -> wikidata) ve eski anahtarı
        takma ad olarak saklar. Kademe GERİ alınmaz: elde wikidata varken imdb'ye düşülmez."""
        siralama = {ResolutionTier.TMDB: 0, ResolutionTier.IMDB: 1, ResolutionTier.WIKIDATA: 2}
        if siralama[yeni_tier] <= siralama[mevcut.tier]:
            return self._enrich(mevcut, wikidata_id, imdb_id, tmdb_id, title)

        self.conn.execute(
            """
            UPDATE canonical_identity SET
                canonical_id = ?, tier = ?,
                wikidata_id = COALESCE(?, wikidata_id),
                imdb_id = COALESCE(?, imdb_id),
                tmdb_id = COALESCE(?, tmdb_id)
            WHERE canonical_id = ?
            """,
            (yeni_id, yeni_tier.value, wikidata_id, imdb_id, tmdb_id, mevcut.canonical_id),
        )
        self.conn.execute(
            "INSERT OR IGNORE INTO canonical_alias (alias_id, canonical_id, created_at) VALUES (?, ?, ?)",
            (mevcut.canonical_id, yeni_id, _iso(_now())),
        )
        # Eski anahtara zaten bağlı takma adlar da yeni anahtara taşınmalı, yoksa zincir kopar.
        self.conn.execute(
            "UPDATE canonical_alias SET canonical_id = ? WHERE canonical_id = ?",
            (yeni_id, mevcut.canonical_id),
        )
        self.conn.commit()
        return self.lookup(yeni_id)  # type: ignore[return-value]

    @staticmethod
    def _row_to_identity(row: sqlite3.Row) -> CanonicalIdentity:
        return CanonicalIdentity(
            canonical_id=row["canonical_id"],
            tier=ResolutionTier(row["tier"]),
            wikidata_id=row["wikidata_id"],
            imdb_id=row["imdb_id"],
            tmdb_id=row["tmdb_id"],
            primary_title=row["primary_title"],
            resolved_at=datetime.fromisoformat(row["resolved_at"]),
        )
