"""FlixPatrol sağlayıcısı — çok platformlu güncel TV dizisi Top 10 (Disney+, Prime, HBO Max,
Apple TV+, Shahid, Netflix).

ERİŞİM VE İZİN
--------------
FlixPatrol sitesi Cloudflare korumalıdır. Bu adaptör korumayı Scrapling `StealthyFetcher`
(`solve_cloudflare=True`) ile geçer — yani diğer sağlayıcıların (netflix_tudum, reytingtv)
aksine bot koruması ATLATIR. Bu, katmanın genel "bot atlatma yok" kuralından bilinçli bir
istisnadır ve YALNIZCA FlixPatrol yöneticilerinden alınan açık crawl izniyle etkinleştirilmiştir
(site sahibinin izni; robots.txt'e değil bu izne dayanır). İzin geri çekilirse sağlayıcı
`FLIXPATROL_SCRAPE_ENABLED=0` ile kapatılmalıdır.

KAPSAM SINIRLARI (2026-09-30, canlı doğrulandı)
-----------------------------------------------
- Yalnızca GÜNCEL liste kazınır (period_type='day'). Tarihli/geçmiş URL'ler HTTP 402
  (Payment Required) döner — geçmiş veri FlixPatrol'un ücretli aboneliğine kilitli; giriş
  yapılmış oturum cookie'si olmadan backfill YAPILAMAZ (bkz. SESSION_COOKIES).
- IMDb/TMDB kimliği liste/detay sayfasında YOK. Bu yüzden eşleştirme, diğer sağlayıcılarla
  aynı yolu izler: başlık, ana uygulamanın canlı TMDB dizi index'ine ve başlık takma adlarına
  (netflix_pipeline.load_title_aliases) TAM AD ile eşlenir (resolve_netflix_title);
  eşleşmeyen satır 'unknown'/'other' olarak saklanır — isimden kanonik atama YAPILMAZ.
- Yalnızca "TOP 10 TV Shows" tablosu alınır (filmler hariç).

ŞEMA NOTU (segment = platform)
------------------------------
chart_entries PK'si (provider, country_iso2, period_type, period_date, segment, rank) platform
İÇERMEZ. Tek bir FlixPatrol koşusu birden çok platformu (aynı ülke/tarih/sıra) kapsadığından,
çakışmayı önlemek için platform hem `platform` sütununa hem de `segment` alanına yazılır
(migration'sız, PK-güvenli çözüm). Platforma göre sorgu için `platform` sütunu kullanılır.
"""
from __future__ import annotations

import os
import time
from datetime import date
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup

import netflix_pipeline as nfp  # resolve_netflix_title, load_title_aliases (tam-ad eşleştirme)
import reytingtv_ranker as rtv  # load_tmdb_series_index
from logsetup import get_logger
from providers.base import ChartEntry, ChartProvider, classify_program_kind

log = get_logger(__name__)

ENV_ENABLE = "FLIXPATROL_SCRAPE_ENABLED"  # "0" ile kapatılabilir (izin geri çekilirse)
BASE_URL = "https://flixpatrol.com/top10"
REQUEST_DELAY_S = 4.0
MAX_RETRIES = 3

# Doğrulanmış FlixPatrol platform slug'ları → chart_entries.platform değeri.
# (Dikkat: "hbo" eski HBO'dur; HBO Max = "hbo-max".)
PLATFORMS: dict[str, str] = {
    "disney": "disney",
    "amazon-prime": "amazon-prime",
    "hbo-max": "hbo-max",
    "apple-tv": "apple-tv",
    "shahid": "shahid",
    # netflix'i resmî Tudum feed'inden alıyoruz (netflix_tudum); varsayılan kapsamda yok.
}

# Öncelikli pazarlar: FlixPatrol ülke slug'ı → ISO2.
COUNTRIES: dict[str, str] = {
    "spain": "ES", "italy": "IT", "germany": "DE", "russia": "RU", "romania": "RO",
    "bulgaria": "BG", "serbia": "RS", "greece": "GR", "saudi-arabia": "SA",
    "united-arab-emirates": "AE", "egypt": "EG", "morocco": "MA", "argentina": "AR",
    "chile": "CL", "brazil": "BR", "mexico": "MX", "colombia": "CO", "turkey": "TR",
}

# Geçmiş backfill için giriş yapılmış ücretli hesabın oturum cookie'leri (boşsa tarihli
# sayfalar 402 döner). Örn: {"session": "...", "cf_clearance": "..."}
SESSION_COOKIES: dict[str, str] = {}


def build_url(platform_slug: str, country_slug: str, day: Optional[str] = None) -> str:
    url = f"{BASE_URL}/{platform_slug}/{country_slug}/"
    if day:
        url += f"{day}/"
    return url


def parse_top10_tv(
    html: str,
    *,
    platform: str,
    country_iso2: str,
    period_date: str,
    source_url: str,
    series_index,
    fetched_at: str,
) -> list[ChartEntry]:
    """"TOP 10 TV Shows" başlığına çapalı tabloyu ChartEntry listesine çevirir (bs4).

    Konuma (index) göre değil, başlık metnine göre bağlanır — sayfadaki tablo sırası
    değişse de doğru tabloyu bulur. Başlık yoksa boş liste döner (o platform/ülke için
    veri yok demektir, hata değil).
    """
    soup = BeautifulSoup(html, "lxml")
    heading = next(
        (h for h in soup.find_all("h3") if h.get_text(strip=True) == "TOP 10 TV Shows"),
        None,
    )
    if heading is None:
        return []
    table = heading.find_next("table")
    if table is None:
        return []

    out: list[ChartEntry] = []
    for tr in table.find_all("tr"):
        tds = tr.find_all("td")
        if not tds:
            continue
        rank_txt = tds[0].get_text(strip=True)
        digits = "".join(ch for ch in rank_txt if ch.isdigit())
        if not digits:
            continue
        rank = int(digits)
        anchor = tr.find("a", href=lambda x: x and "/title/" in x)
        if anchor is None:
            continue
        title = anchor.get_text(strip=True)
        if not title:
            # başlık metni boşsa slug'dan türet
            title = anchor["href"].strip("/").split("/")[-1].replace("-", " ").title()
        href = anchor["href"]
        detail_url = href if href.startswith("http") else f"https://flixpatrol.com{href}"

        # FlixPatrol satırı dizinin KENDİ adıdır (kanal adı içeren program metni değil): alt-dize
        # araması yanlış eşleşme üretir, bu yüzden Netflix hattındaki tam-ad çözümleyici kullanılır.
        match = nfp.resolve_netflix_title(title, series_index) if series_index else None
        sid = match.tmdb_id if match else None
        out.append(
            ChartEntry(
                provider="flixpatrol",
                platform=platform,       # gerçek platform (disney/amazon-prime/...)
                country_iso2=country_iso2,
                period_type="day",
                period_date=period_date,
                segment=platform,        # PK'de platform yok → çakışmayı segment önler
                rank=rank,
                title_raw=title,
                series_id=sid,
                program_kind=classify_program_kind(title, sid),
                source_url=detail_url or source_url,
                fetched_at=fetched_at,
            )
        )
    return out


# Bu durumlar kalıcıdır, yeniden denemek yalnızca zaman kaybettirir:
# 404 = o platform o ülkede listelenmiyor, 402 = geçmiş tarih paywall'ı.
NO_RETRY_STATUSES = {402, 404}


def _open_session():
    """Tüm koşu için TEK tarayıcı oturumu açar. Cloudflare çözümü oturumda kaldığından her
    sayfada baştan çözülmez (sayfa başına ~30 sn yerine birkaç sn). Scrapling yalnızca burada
    import edilir — modülün import'u ve testler scrapling gerektirmez."""
    from scrapling.fetchers import StealthySession  # lazy import

    kwargs = dict(headless=True, solve_cloudflare=True, network_idle=True)
    if SESSION_COOKIES:
        kwargs["cookies"] = [
            {"name": k, "value": v, "domain": ".flixpatrol.com", "path": "/"}
            for k, v in SESSION_COOKIES.items()
        ]
    session = StealthySession(**kwargs)
    session.start()
    return session


def _fetch_html(session, url: str) -> tuple[Optional[str], Optional[int]]:
    """(html, durum_kodu) döner; alınamazsa html None. Kalıcı durumlarda (404/402) yeniden denemez."""
    status = None
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            page = session.fetch(url)
            status = getattr(page, "status", None)
            if status == 200:
                return page.html_content, status
            if status in NO_RETRY_STATUSES:
                return None, status
            last_err = f"status={status}"
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
        time.sleep(REQUEST_DELAY_S * (attempt + 1))
    log.warning(f"flixpatrol: alinamadi {url} ({last_err})")
    return None, status


class FlixPatrolProvider(ChartProvider):
    name = "flixpatrol"
    platform = "multi"
    period_type = "day"
    terms = "FlixPatrol yöneticilerinden crawl izniyle; site Cloudflare korumalı (StealthyFetcher)."

    def __init__(
        self,
        node_app_db_path: Optional[Path] = None,
        request_delay_s: float = REQUEST_DELAY_S,
    ):
        # None ise eşleştirme yapılmaz (series_id boş kalır); testlerde db'siz kurulabilir.
        self.node_app_db_path = node_app_db_path
        self.request_delay_s = request_delay_s

    @property
    def enabled(self) -> bool:
        # İzne dayalı; yalnızca açıkça kapatılırsa devre dışı.
        return os.environ.get(ENV_ENABLE, "1") != "0"

    def coverage(self) -> dict:
        return {
            "countries": sorted(COUNTRIES.values()),
            "platforms": sorted(PLATFORMS.values()),
            "period_type": "day",
            "since": None,  # yalnızca güncel; geçmiş 402 (paywall)
            "enabled": self.enabled,
        }

    def iter_pages(
        self,
        countries: Optional[dict[str, str]] = None,
        platforms: Optional[dict[str, str]] = None,
        day: Optional[str] = None,
        limit: Optional[int] = None,
        fetched_at: str = "",
        skip: Optional[set[tuple[str, str]]] = None,
        open_session=_open_session,
    ):
        """Ülke × platform sayfalarını TEK TEK üretir: (iso2, platform, durum_kodu, satırlar).

        Çağıran her sayfayı alır almaz kaydedebilsin diye üreteçtir — koşu yarıda kesilse bile
        o ana kadarki veri kaybolmaz. `skip`: zaten çekilmiş (iso2, platform) çiftleri; bunlar
        için istek atılmaz (kaldığı yerden devam).
        """
        if not self.enabled:
            raise RuntimeError(f"{ENV_ENABLE}=0 — FlixPatrol sağlayıcısı devre dışı.")

        countries = countries or COUNTRIES
        platforms = platforms or PLATFORMS
        skip = skip or set()
        period_date = day or date.today().isoformat()
        todo = [
            (c_slug, c_iso2, p_slug, p_name)
            for c_slug, c_iso2 in countries.items()
            for p_slug, p_name in platforms.items()
            if (c_iso2, p_name) not in skip
        ]
        if limit:
            todo = todo[:limit]
        if not todo:
            return

        series_index = rtv.load_tmdb_series_index(self.node_app_db_path) if self.node_app_db_path else []
        if series_index:
            # FlixPatrol dizileri uluslararası (çoğunlukla İngilizce) adlarıyla listeler; katalog
            # Türkçe adları taşır. Netflix hattının takma adları (IMDb AKA + yayın adı) eklenir.
            series_index = series_index + nfp.load_title_aliases(series_index)
        session = open_session()
        try:
            for c_slug, c_iso2, p_slug, p_name in todo:
                url = build_url(p_slug, c_slug, day)
                html, status = _fetch_html(session, url)
                rows = (
                    parse_top10_tv(
                        html,
                        platform=p_name,
                        country_iso2=c_iso2,
                        period_date=period_date,
                        source_url=url,
                        series_index=series_index,
                        fetched_at=fetched_at,
                    )
                    if html
                    else []
                )
                log.info(f"flixpatrol: {c_iso2}/{p_name} -> {len(rows)} dizi (durum {status})")
                yield c_iso2, p_name, status, rows
                time.sleep(self.request_delay_s)
        finally:
            try:
                session.close()
            except Exception:  # noqa: BLE001
                pass

    def fetch(self, **kwargs) -> list[ChartEntry]:
        """Güncel TV Top 10'u ülke × platform için kazır ve tüm satırları tek listede döner.
        Uzun koşularda `iter_pages` tercih edilir (sayfa sayfa kayıt)."""
        out: list[ChartEntry] = []
        for _iso2, _platform, _status, rows in self.iter_pages(**kwargs):
            out.extend(rows)
        return out
