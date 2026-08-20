"""Dizilah.com scraper — SADECE requests + BeautifulSoup, bot atlatma/stealth YOK.

DOĞRULANMIŞ BULGULAR (2026-08-19, gerçek dizi sayfaları incelenerek):

1. URL kalıbı: dizi sayfası `/{slug}` DEĞİL, `/show/{slug}` (ör. `/show/yargi`) —
   arama motoru sonuçlarından doğrulandı.

2. Cloudflare engeli GENEL DEĞİL, YOLA ÖZGÜ: `/ratings` ve tahmin edilen `/series/{slug}`
   yolları normal tarayıcı User-Agent'ıyla bile 4/4 denemede 403 (Server: cloudflare)
   döndü. Ama `/`, `/explore` ve gerçek `/show/{slug}` sayfaları AYNI istemciyle
   sorunsuz 200 döndü. Yani asıl dizi verisi (bu modülün ihtiyacı) engelli DEĞİL —
   sadece ayrı "/ratings" toplu listeleme sayfası daha sıkı korunuyor. Yine de
   `fetch_html` her ihtimale karşı engeli açıkça tespit edip raporluyor.

3. Dizi sayfası `<script type="application/ld+json">` içinde schema.org `TVSeries`
   yapılandırılmış verisi taşıyor — CSS seçicileri tahmin etmek yerine BUNU
   ayrıştırıyoruz, çünkü SEO için var, stilden çok daha kararlı bir kaynak.
   İçeriği: name, alternateName, publisher.name (=kanal), productionCompany.name,
   numberOfSeasons, startDate, genre, containsSeason[].numberOfEpisodes,
   aggregateRating (ratingValue/ratingCount/bestRating — Dizilah'ın kendi ifadesiyle
   "topluluğumuzun beğeni/ilgisine dayalı" AGREGAT skor, bireysel yorum DEĞİL).
   "Status" (Ended/…) alanı JSON-LD'de yok, ayrı bir `<li>` key-value bloğunda —
   bunun için de gerçek HTML'den doğrulanmış tek bir seçici kullanılıyor.

4. BULUNAMAYAN VERİ — dürüstçe not: Dizilah'ta bölüm bazlı resmi Türk TV reytingi
   (Total/AB/ABC1 — TIAK/AGB Nielsen tipi izleyici ölçümü) YOK. İncelenen sayfalarda
   (`/show/yargi`, `/show/yargi/episodes`, `/show/yargi/season-1`) böyle bir tablo
   bulunamadı; site kendi topluluk puanını (yukarıdaki aggregateRating) sunuyor,
   resmi reyting verisi sunmuyor görünüyor. Bu yüzden `episodes` alanı BOŞ dönüyor ve
   `status_note` bunu açıkça belirtiyor — var olmayan bir tabloyu simüle eden uydurma
   seçiciler YAZILMADI. Resmi Total/AB/ABC1 reytingi gerekiyorsa bu, muhtemelen ayrı
   bir Türkçe reyting-haber sitesinden (Dizilah'tan değil) gelmeli — kaynak ayrıca
   araştırılmalı.
"""
from __future__ import annotations

import json
from datetime import date as date_type, datetime, timezone
from typing import Optional

import requests
from bs4 import BeautifulSoup

from models import DizilahSeriesInfo

BASE_URL = "https://dizilah.com"
REQUEST_TIMEOUT = 15
HEADERS = {
    # Standart tarayıcı User-Agent — parmak izi sahteciliği/stealth değil, sadece
    # "python-requests/x.x" varsayılanının bazı sitelerde otomatik reddedilmesini önler.
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
}

CLOUDFLARE_BLOCK_NOTE = (
    "dizilah.com bu yol için Cloudflare arkasında ve düz requests/urllib isteklerine "
    "403 dönüyor (doğrulandı: 2026-08-19). Bu modül bilerek stealth/bot-atlatma "
    "eklemiyor, bu yüzden veri çekilemedi. Not: /show/{slug} dizi sayfaları bu "
    "engelden ETKİLENMİYOR (doğrulandı) — sadece /ratings gibi bazı ayrı yollar."
)

NO_OFFICIAL_RATINGS_NOTE = (
    "Dizilah'ta bölüm bazlı resmi Total/AB/ABC1 reyting tablosu bulunamadı (doğrulandı: "
    "/show/{slug}, /show/{slug}/episodes, /show/{slug}/season-1 sayfaları incelendi) — "
    "site sadece kendi topluluk puanını sunuyor. episodes alanı bu yüzden boş."
)


def fetch_html(path: str) -> tuple[Optional[str], Optional[str]]:
    """(html, hata_notu) döner. Başarısız olursa html None, hata_notu insan-okur bir
    açıklama taşır — exception fırlatıp tüm pipeline'ı düşürmek yerine."""
    url = f"{BASE_URL}{path}"
    try:
        res = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as exc:
        return None, f"İstek başarısız: {exc}"

    if res.status_code == 403 and "cloudflare" in res.headers.get("Server", "").lower():
        return None, CLOUDFLARE_BLOCK_NOTE
    if not res.ok:
        return None, f"HTTP {res.status_code}"
    return res.text, None


def _extract_ld_json(soup: BeautifulSoup, type_name: str) -> Optional[dict]:
    for tag in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        if data.get("@type") == type_name:
            return data
    return None


def _extract_status_field(soup: BeautifulSoup) -> Optional[str]:
    """Doğrulanmış desen: <li><span class="font-bold uppercase">Status</span>
    <span class="col-span-2 text-right">Ended</span></li>"""
    for label_span in soup.select("span.font-bold.uppercase"):
        if label_span.get_text(strip=True).lower() == "status":
            value_span = label_span.find_next_sibling("span")
            if value_span:
                return value_span.get_text(strip=True)
    return None


def _parse_iso_date(value: Optional[str]) -> Optional[date_type]:
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def parse_series_page(html: str, slug: str) -> DizilahSeriesInfo:
    soup = BeautifulSoup(html, "lxml")
    ld = _extract_ld_json(soup, "TVSeries") or {}

    channel = (ld.get("publisher") or {}).get("name")
    aggregate = ld.get("aggregateRating") or {}
    seasons = ld.get("containsSeason") or []
    total_episodes = sum(s.get("numberOfEpisodes") or 0 for s in seasons) or None

    return DizilahSeriesInfo(
        slug=slug,
        title=ld.get("name"),
        channel=channel,
        status=_extract_status_field(soup),
        first_air_date=_parse_iso_date(ld.get("startDate")),
        total_episodes=total_episodes,
        average_rating=_safe_float(aggregate.get("ratingValue")),
        vote_count=_safe_int(aggregate.get("ratingCount")),
        episodes=[],  # bkz. modül docstring'i madde 4 — Dizilah'ta bu veri yok
        source_url=f"{BASE_URL}/show/{slug}",
        fetched_at=datetime.now(timezone.utc),
        status_note=NO_OFFICIAL_RATINGS_NOTE,
    )


def fetch_series(slug: str) -> DizilahSeriesInfo:
    """Ana giriş noktası. HTTP katmanı engellenirse (bkz. fetch_html), boş/uydurma bir
    kayıt DEĞİL — status_note'unda NEDEN veri olmadığını açıkça taşıyan bir
    DizilahSeriesInfo döner. Çağıran taraf (main.py, db.py) bunu her zaman kontrol
    etmelidir."""
    html, error_note = fetch_html(f"/show/{slug}")
    if html is None:
        return DizilahSeriesInfo(
            slug=slug,
            source_url=f"{BASE_URL}/show/{slug}",
            fetched_at=datetime.now(timezone.utc),
            status_note=error_note,
        )
    return parse_series_page(html, slug)


def _safe_float(value) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _safe_int(value) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
