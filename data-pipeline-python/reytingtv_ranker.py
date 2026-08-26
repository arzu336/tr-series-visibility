"""reytingtv.com günlük Top 10 TV reyting sıralaması işleyici — web scraping değil, sitenin
kendi WordPress sitemap'i (`/post-sitemap.xml`, `/post-sitemap2.xml`) üzerinden herkese açık
makale URL'lerini toplar, robots.txt tamamen izin veriyor (`Disallow:` boş). Stealth/bot atlaşma
yok, sadece basit `User-Agent` + istekler arası kibarlık gecikmesi.

DOĞRULANMIŞ SINIRLAR (2026-08-20, ~30 gerçek makaleyle test edildi):

1. **SAYISAL reyting/pay (%) değeri hiç yok.** Site kendi metninde açıkça diyor ki:
   "TİAK'ın aldığı karar nedeniyle reyting sıralamalarının detaylarını ve ilk 100 program
   sıralamasını yayınlamıyoruz." Yani elde edilebilen TEK sinyal her gün Total/AB/20+ABC1
   kategorilerinde İLK 10'a giren programların SIRASI (1-10) — kaç izleyici/hangi yüzde
   YOK. `compute_rank_score` bu yüzden sıraya dayalı türetilmiş bir puan üretir, gerçek bir
   reyting/pay yüzdesi DEĞİLDİR (bkz. netflix_country_ranker.py'deki aynı prensip).

2. **Makale biçimi 5 yıllık arşiv boyunca en az 3 farklı şablon kullanmış** (editör/tema
   değişiklikleri nedeniyle tutarsız): (a) gerçek `<table>` etiketiyle Sıra/Program/Kanal
   sütunları + "Total/AB/20+ABC1 Reyting İlk 10" başlıkları (en yeni makaleler), (b) `<p>`
   içinde "1 PROGRAM ADI KANAL" formatında numaralı düz metin satırları, art arda 3 liste
   (gözlemlenen sıra: Total, AB, 20+ABC1 — siteboyunca tutarlı görüldü ama başlıkla teyit
   EDİLEMİYOR, bu yüzden bu varsayım kabul edilebilir bir risk olarak burada açıkça not
   düşülüyor), (c) sadece ilk 3'ü anlatan serbest metin (bu üçüncü biçim BİLEREK
   PARSE EDİLMİYOR — güvenilir çıkarım için yeterli yapı yok, o günler dürüstçe atlanır).
   25 makalelik rastgele örneklemde: %72'si (a) veya (b) ile başarıyla ayrıştırıldı, kalan
   %28 (çoğunlukla format c) atlandı — kalan güncel yayındaki dizilerin çoğu zaten günlük
   Top 10'da spor/realite/haber programlarıyla yarışıyor, bu yüzden başarılı günlerde bile
   her gün her dizi için veri OLMAYABİLİR.

3. **Dizi eşleştirmesi tam/prefix normalize karşılaştırmasıyla yapılır** (bkz.
   `match_series`) — TMDB'nin canlı `raw-series-providers` önbelleğindeki 400 dizi adına
   göre. Eşleşmeyen (spor, haber, realite, film) programlar SESSİZCE atlanır, asla uydurma
   bir eşleşme zorlanmaz.
"""
from __future__ import annotations

import html as html_module
import json
import re
import sqlite3
import time
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

import requests

from models import ReytingTvDailyRank

BASE_URL = "https://reytingtv.com"
SITEMAP_PATHS = ["post-sitemap.xml", "post-sitemap2.xml"]
REQUEST_DELAY_S = 0.4  # sitemap/robots.txt kısıtlamıyor ama art arda ~900 istek için kibarlık
USER_AGENT = "Mozilla/5.0 (compatible; gorunurluk-platformu-research/1.0)"

TURKISH_MONTHS = {
    "ocak": 1, "subat": 2, "şubat": 2, "mart": 3, "nisan": 4, "mayis": 5, "mayıs": 5,
    "haziran": 6, "temmuz": 7, "agustos": 8, "ağustos": 8, "eylul": 9, "eylül": 9,
    "ekim": 10, "kasim": 11, "kasım": 11, "aralik": 12, "aralık": 12,
}

CATEGORY_HEADING_MAP = [
    (re.compile(r"\btotal\b", re.I), "Total"),
    (re.compile(r"\bab\b", re.I), "AB"),
    (re.compile(r"20\+?abc1", re.I), "20+ABC1"),
]
# (b) biçimindeki numaralı listeler başlıkla teyit edilemiyor — gözlemlenen tutarlı sıra.
POSITIONAL_CATEGORY_ORDER = ["Total", "AB", "20+ABC1"]

TURKISH_UPPER_MAP = str.maketrans({"İ": "I", "I": "I", "ı": "I", "ş": "S", "Ş": "S", "ğ": "G", "Ğ": "G",
                                    "ü": "U", "Ü": "U", "ö": "O", "Ö": "O", "ç": "C", "Ç": "C"})


def normalize_title(text: str) -> str:
    text = text.translate(TURKISH_UPPER_MAP).upper()
    text = re.sub(r"\(.*?\)", " ", text)  # (T.S)/(Y.S)/(TKR)/(ÖZET) gibi ek notları at
    text = re.sub(r"[^A-Z0-9 ]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


@dataclass
class SeriesIndexEntry:
    tmdb_id: int
    name: str
    normalized: str


def load_tmdb_series_index(node_app_db_path: Path) -> list[SeriesIndexEntry]:
    """Node uygulamasının server/data/app.db'sindeki CANLI TMDB dizi listesini okur
    (cache_entries['raw-series-providers']) — bu pipeline kendi dizi listesini TUTMAZ,
    eşleştirme için ana uygulamanın gerçek zamanlı verisine güvenir."""
    conn = sqlite3.connect(node_app_db_path)
    try:
        row = conn.execute(
            "SELECT value FROM cache_entries WHERE key = 'raw-series-providers'"
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        raise RuntimeError(
            f"{node_app_db_path}: 'raw-series-providers' önbellek anahtarı bulunamadı — "
            "Node uygulaması en az bir kez /api/visibility çağırmış olmalı."
        )
    data = json.loads(row[0])
    entries = [
        SeriesIndexEntry(tmdb_id=s["id"], name=s["name"], normalized=normalize_title(s["name"]))
        for s in data["series"]
    ]
    # Eşleştirmede en uzun isim önce denenmeli — "Kral" gibi kısa bir ad, "Kral Kaybederse"
    # gibi daha uzun başka bir dizinin içine yanlışlıkla erken eşleşmesin diye.
    entries.sort(key=lambda e: -len(e.normalized))
    return entries


def match_series(text: str, index: list[SeriesIndexEntry]) -> Optional[SeriesIndexEntry]:
    """Program metninin (kanal adı dahil olabilir) İÇİNDE, kelime sınırlarına saygılı şekilde
    bilinen bir dizi adı arar. Kısa (4 karakterden az normalize edilmiş) adlar yanlış-pozitif
    riskinden dolayı BİLEREK atlanır."""
    padded = f" {normalize_title(text)} "
    for entry in index:
        if len(entry.normalized) < 4:
            continue
        if f" {entry.normalized} " in padded:
            return entry
    return None


def compute_rank_score(rank: int) -> float:
    """Netflix modülündeki (netflix_country_ranker.compute_rank_score) aynı mantık: SIRAYA
    dayalı türetilmiş puan, gerçek reyting/pay yüzdesi DEĞİL. Top 10 listeleri için 1. sıra
    100, 10. sıra 10 puan alır."""
    return float(max(0, min(10, 11 - rank)) * 10)


def fetch_sitemap_article_urls(session: requests.Session) -> list[tuple[str, Optional[date]]]:
    """(url, yayın_tarihi) çiftleri döner — sadece '-reyting-sonuclari' geçen makale
    URL'leri (sitedeki diğer içerik: dizi haberleri, oyuncu röportajları vb. hariç)."""
    results: list[tuple[str, Optional[date]]] = []
    for path in SITEMAP_PATHS:
        resp = session.get(f"{BASE_URL}/{path}", timeout=30)
        resp.raise_for_status()
        for m in re.finditer(r"<url>\s*<loc>(.*?)</loc>\s*(?:<lastmod>(.*?)</lastmod>)?", resp.text):
            url, lastmod = m.group(1), m.group(2)
            if "reyting-sonuclari" not in url:
                continue
            lastmod_date = None
            if lastmod:
                try:
                    lastmod_date = date.fromisoformat(lastmod[:10])
                except ValueError:
                    pass
            results.append((url, lastmod_date))
    return results


def _extract_date_from_slug(url: str, published_at: Optional[date]) -> Optional[date]:
    """Makale slug'ından 'GÜN AY[ YIL]' örüntüsünü çıkarır; yıl slug'da yoksa yayın
    tarihinin yılını kullanır (yıl sınırında -1 düzeltmesiyle — bkz. aşağı). Slug'da hiç
    ay adı bulunamazsa None döner, çağıran taraf o makaleyi atlar."""
    slug = url.rstrip("/").rsplit("/", 1)[-1].lower()
    slug = slug.replace("-", " ")
    m = re.search(
        r"\b(\d{1,2})\s+(ocak|subat|şubat|mart|nisan|mayis|mayıs|haziran|temmuz|agustos|ağustos"
        r"|eylul|eylül|ekim|kasim|kasım|aralik|aralık)\s*(\d{4})?",
        slug,
    )
    if not m:
        return None
    day = int(m.group(1))
    month = TURKISH_MONTHS[m.group(2)]
    year_str = m.group(3)
    if year_str:
        year = int(year_str)
    elif published_at:
        year = published_at.year
        # Slug'da yıl yoksa makale genelde ertesi gün/günler içinde yayınlanır (bkz. gerçek
        # örnek: "7 Mart Pazar" -> yayın 8 Mart 2021). Yıl sonu/başı sınırında (Aralık günü,
        # Ocak'ta yayınlanmış gibi) yıl bir geri alınır.
        if month == 12 and published_at.month == 1:
            year -= 1
    else:
        return None
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _parse_table_format(html: str) -> dict[str, list[tuple[int, str]]]:
    result: dict[str, list[tuple[int, str]]] = {}
    for m in re.finditer(r"<table.*?</table>", html, re.S):
        table_html = m.group(0)
        preceding = html[max(0, m.start() - 400) : m.start()]
        headings = re.findall(r"<h[1-6][^>]*>(.*?)</h[1-6]>", preceding, re.S)
        heading_text = headings[-1] if headings else ""
        category = None
        for pattern, label in CATEGORY_HEADING_MAP:
            if pattern.search(heading_text):
                category = label
                break
        if category is None:
            continue
        rows = re.findall(
            r"<td><span[^>]*>(?:<b[^>]*>)?(\d+)(?:</b>)?</span></td>\s*"
            r"<td><span[^>]*>(.*?)</span></td>\s*<td><span[^>]*>(.*?)</span></td>",
            table_html,
        )
        parsed = [(int(rank), html_module.unescape(program)) for rank, program, _channel in rows]
        if parsed:
            result[category] = parsed
    return result


def _parse_numbered_paragraph_format(html: str) -> dict[str, list[tuple[int, str]]]:
    paras = re.findall(r"<p[^>]*>(.*?)</p>", html, re.S)
    lists: list[list[tuple[int, str]]] = []
    for p in paras:
        text = html_module.unescape(re.sub(r"<[^>]+>", "\n", p))
        rows = []
        for line in (l.strip() for l in text.split("\n")):
            if not line:
                continue
            m = re.match(r"^(\d{1,2})\s+(.+)$", line)
            if m and 1 <= int(m.group(1)) <= 15:
                rows.append((int(m.group(1)), m.group(2)))
        if len(rows) >= 5:
            lists.append(rows)
    if len(lists) < len(POSITIONAL_CATEGORY_ORDER):
        return {}
    return {label: lists[i] for i, label in enumerate(POSITIONAL_CATEGORY_ORDER)}


def parse_article(html: str) -> dict[str, list[tuple[int, str]]]:
    """category -> [(rank, program_raw), ...]. Hiçbir biçim tanınmazsa boş dict döner —
    çağıran taraf bu günü dürüstçe atlar, uydurma veri üretilmez."""
    by_table = _parse_table_format(html)
    if by_table:
        return by_table
    return _parse_numbered_paragraph_format(html)


def scrape_daily_ranks(
    node_app_db_path: Path,
    session: Optional[requests.Session] = None,
    limit: Optional[int] = None,
    request_delay_s: float = REQUEST_DELAY_S,
    progress_every: int = 50,
) -> list[ReytingTvDailyRank]:
    """Tüm arşivi (veya `limit` kadarını) tarar, eşleşen dizi satırlarını döner. Ağ hataları
    (tek makale erişilemezse) o makaleyi atlar, tüm taramayı düşürmez."""
    session = session or requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    series_index = load_tmdb_series_index(node_app_db_path)
    articles = fetch_sitemap_article_urls(session)
    if limit:
        articles = articles[:limit]

    results: list[ReytingTvDailyRank] = []
    for i, (url, published_at) in enumerate(articles):
        if progress_every and i % progress_every == 0:
            print(f"[reytingtv] {i}/{len(articles)} işlendi, {len(results)} eşleşme bulundu")
        air_date = _extract_date_from_slug(url, published_at)
        if air_date is None:
            continue
        try:
            resp = session.get(url, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as exc:
            print(f"[reytingtv] {url} alınamadı, atlanıyor: {exc}")
            continue
        finally:
            time.sleep(request_delay_s)

        by_category = parse_article(resp.text)
        for category, rows in by_category.items():
            for rank, program_raw in rows:
                entry = match_series(program_raw, series_index)
                if entry is None:
                    continue
                results.append(
                    ReytingTvDailyRank(
                        tmdb_id=entry.tmdb_id,
                        matched_title=entry.name,
                        program_raw=program_raw,
                        category=category,
                        rank=rank,
                        rank_score=compute_rank_score(rank),
                        air_date=air_date,
                        source_url=url,
                    )
                )
    return results
