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
import re
import time
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup

import netflix_pipeline as nfp  # resolve_netflix_title, load_title_aliases (tam-ad eşleştirme)
import reytingtv_ranker as rtv  # load_tmdb_series_index
from logsetup import get_logger
from providers.base import ChartEntry, ChartProvider, classify_program_kind
from providers.flixpatrol_countries import SLUG_TO_ISO2

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

# Öncelikli pazarlar: FlixPatrol ülke slug'ı → ISO2. Kapsam bunlarla SINIRLI DEĞİL — her koşuda
# platformun FlixPatrol dizininde listelenen tüm ülkeler çekilir (discover_countries); bunlar yalnızca
# önce çekilir ki koşu yarıda kesilirse en önemli pazarlar kaydedilmiş olsun.
COUNTRIES: dict[str, str] = {
    "spain": "ES", "italy": "IT", "germany": "DE", "russia": "RU", "romania": "RO",
    "bulgaria": "BG", "serbia": "RS", "greece": "GR", "saudi-arabia": "SA",
    "united-arab-emirates": "AE", "egypt": "EG", "morocco": "MA", "argentina": "AR",
    "chile": "CL", "brazil": "BR", "mexico": "MX", "colombia": "CO", "turkey": "TR",
}

# Geçmiş backfill için giriş yapılmış ücretli hesabın oturum cookie'leri (boşsa tarihli
# sayfalar 402 döner). Örn: {"session": "...", "cf_clearance": "..."}
SESSION_COOKIES: dict[str, str] = {}


# FlixPatrol'un kullandığı uluslararası adlar → katalog TMDB kimliği. Her satır TMDB'de
# origin_country=TR ve kimliği katalogda olan diziyle doğrulandı (2026-09-30, eşleşmemiş 164 başlık
# tarandı). Netflix hattının takma ad listesinde olmayanlar burada; katalogda olmayan kimlik sessizce
# atlanır (uydurma eşleşme yok).
FLIXPATROL_TITLE_ALIASES: dict[int, tuple[str, ...]] = {
    322499: ("Possible Love",),  # Muhtemel Aşk (Shahid)
    317883: ("Torn Apart",),  # Daha 17 (Shahid)
    322280: ("Master Omur",),  # Ömür Usta (Disney+)
    308185: ("Power of Love",),  # Aşkın Gücü (Prime Video)
    34899: ("Magnificent Century",),  # Muhteşem Yüzyıl (Prime Video)
}

# FlixPatrol Türkçe adları çoğu zaman aksansız yazar ("Esref Ruya" = "Eşref Rüya"); Netflix hattının
# normalleştirmesi yalnızca büyük/küçük harfi eşitlediği için katlanmış varyantlar ayrıca eklenir.
_TR_FOLD = str.maketrans("şŞıİğĞüÜöÖçÇâÂîÎûÛ", "sSiIgGuUoOcCaAiIuU")


def build_match_index(series_index, extra_aliases=None):
    """Eşleştirme havuzu: katalog + Netflix takma adları (IMDb AKA / yayın adı) + FlixPatrol adları
    + Türkçe karakterleri katlanmış varyantlar. Katlanmış ad iki farklı diziye gidiyorsa atlanır."""
    if not series_index:
        return []
    havuz = list(series_index)
    havuz += nfp.load_title_aliases(series_index) if extra_aliases is None else list(extra_aliases)
    katalog = {e.tmdb_id for e in series_index}
    for tmdb_id, adlar in FLIXPATROL_TITLE_ALIASES.items():
        if tmdb_id in katalog:
            havuz += [rtv.SeriesIndexEntry(tmdb_id=tmdb_id, name=a, normalized=rtv.normalize_title(a)) for a in adlar]
    katlanmis: dict[str, set[int]] = defaultdict(set)
    for e in havuz:
        f = e.name.translate(_TR_FOLD)
        if f != e.name:
            katlanmis[f].add(e.tmdb_id)
    mevcut = {e.name for e in havuz}
    for f, ids in katlanmis.items():
        if len(ids) == 1 and f not in mevcut:
            havuz.append(rtv.SeriesIndexEntry(tmdb_id=next(iter(ids)), name=f, normalized=rtv.normalize_title(f)))
    return havuz


def match_title(title: str, match_index) -> Optional[int]:
    """FlixPatrol başlığını katalog kimliğine bağlar (tam ad; alt-dize değil). Bulamazsa None."""
    if not match_index:
        return None
    m = nfp.resolve_netflix_title(title, match_index)
    return m.tmdb_id if m else None


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
        # araması yanlış eşleşme üretir, bu yüzden tam-ad çözümleyici kullanılır.
        sid = match_title(title, series_index)
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


def discover_countries(session, platform_slug: str) -> list[tuple[str, str]]:
    """Platformun FlixPatrol dizin sayfasındaki (/top10/<platform>/) ülkeler: [(slug, iso2)].
    Böylece yalnızca gerçekten var olan sayfalar istenir (404 israfı yok) ve FlixPatrol yeni ülke
    eklediğinde kod değişmeden kapsama girer. SLUG_TO_ISO2'de olmayan slug atlanır ve loglanır."""
    html, _status = _fetch_html(session, f"{BASE_URL}/{platform_slug}/")
    if not html:
        return []
    slugs = sorted(set(re.findall(rf"/top10/{re.escape(platform_slug)}/([a-z-]+)/", html)) - {"world"})
    bilinmeyen = [s for s in slugs if s not in SLUG_TO_ISO2]
    if bilinmeyen:
        log.warning(f"flixpatrol: {platform_slug} icin ISO kodu bilinmeyen ulkeler atlandi: {bilinmeyen}")
    return [(s, SLUG_TO_ISO2[s]) for s in slugs if s in SLUG_TO_ISO2]


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
            "countries": sorted(set(SLUG_TO_ISO2.values())),  # platform dizinlerinden dinamik
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
        o ana kadarki veri kaybolmaz. `countries` verilmezse her platformun ülkeleri FlixPatrol
        dizininden okunur (discover_countries); öncelikli pazarlar (COUNTRIES) önce gelir.
        `skip`: zaten çekilmiş (iso2, platform) çiftleri; bunlar için istek atılmaz.
        """
        if not self.enabled:
            raise RuntimeError(f"{ENV_ENABLE}=0 — FlixPatrol sağlayıcısı devre dışı.")

        platforms = platforms or PLATFORMS
        skip = skip or set()
        period_date = day or date.today().isoformat()
        session = None
        try:
            if countries is not None:
                plan = [(c, iso, p, name) for c, iso in countries.items() for p, name in platforms.items()]
            else:
                session = open_session()
                plan = []
                for p_slug, p_name in platforms.items():
                    bulunan = discover_countries(session, p_slug) or list(COUNTRIES.items())
                    plan += [(c, iso, p_slug, p_name) for c, iso in bulunan]
                oncelik = {iso: i for i, iso in enumerate(COUNTRIES.values())}
                plat_sira = {p: i for i, p in enumerate(platforms)}
                plan.sort(key=lambda x: (oncelik.get(x[1], len(oncelik)), x[1], plat_sira[x[2]]))
            plan = [x for x in plan if (x[1], x[3]) not in skip]
            if limit:
                plan = plan[:limit]
            if not plan:
                return

            # FlixPatrol dizileri uluslararası (çoğunlukla İngilizce) adlarıyla listeler; katalog Türkçe
            # adları taşır — havuz takma adlarla genişletilir (bkz. build_match_index).
            series_index = build_match_index(
                rtv.load_tmdb_series_index(self.node_app_db_path) if self.node_app_db_path else []
            )
            if session is None:
                session = open_session()
            log.info(f"flixpatrol: {len(plan)} sayfa cekilecek ({len(skip)} cift atlandi)")
            for c_slug, c_iso2, p_slug, p_name in plan:
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
            if session is not None:
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
