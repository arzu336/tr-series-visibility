"""FlixPatrol dizi sayfaları (2026-10-09; FlixPatrol yöneticilerinin crawl izniyle, bkz. providers/flixpatrol).

NEDEN
-----
Liste taraması yalnızca seçtiğimiz platformların (Disney+, Prime, HBO Max, Apple TV+, Shahid) güncel Top 10'unu
alıyordu. Bir dizinin kendi sayfası (/title/<slug>/) ise dizinin girdiği BÜTÜN platformları gösterir — ör. Kuruluş
Osman STARZPLAY'de bu yıl 280 gün Top 10'da (biz STARZPLAY'i hiç taramıyorduk), Seni Tanıyorum Endonezya'da Vidio'da.
Sayfadan iki şey alınır:
  1) Platform başına puan kartı: bugün / bu ay / bu yıl puanı, dünya sırası, Top 10'da kalınan gün ve günlük ortalama.
  2) "this week" tabloları: platform × ülke, son 7 günün sırası → chart_entries (provider 'flixpatrol', günlük).
     Haftalık tarama 7 günü kapsadığı için günlük geçmiş kesintisiz birikir.

EŞLEME
------
Sayfa kimliği yok; dizi FlixPatrol aramasıyla bulunur (Türkçe harfsiz ad, sonra İngilizce ad) ve sayfa başlığında
"TV Show | Turkey" görülmeden kabul edilmez (aynı adlı yabancı yapımla karışmasın). Eşleme flixpatrol_title_map'te
tutulur; bulunamayan dizi 30 gün sonra yeniden aranır.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Optional

from bs4 import BeautifulSoup

PERIODS = {1: "today", 2: "month", 3: "year"}
_MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], 1
)}


def _int(text: str) -> Optional[int]:
    d = re.sub(r"[^\d]", "", text or "")
    return int(d) if d else None


def parse_updated(html: str) -> Optional[date]:
    """"Last updated on October 9, 2026." → date."""
    m = re.search(r"Last updated on ([A-Z][a-z]+) (\d{1,2}), (\d{4})", html)
    if not m or m.group(1) not in _MONTHS:
        return None
    return date(int(m.group(3)), _MONTHS[m.group(1)], int(m.group(2)))


def is_turkish_tv_show(html: str) -> bool:
    """Sayfa başlığındaki künye: "TV Show | Turkey | …"."""
    text = BeautifulSoup(html, "lxml").get_text(" ", strip=True)
    return bool(re.search(r"TV Show\s*\|\s*Turkey", text))


def parse_search(html: str) -> list[str]:
    """Arama sonucundaki dizi sayfası slug'ları (sırayla, tekrarsız)."""
    out: list[str] = []
    for a in BeautifulSoup(html, "lxml").find_all("a", href=True):
        m = re.match(r"^/title/([a-z0-9-]+)/$", a["href"])
        if m and m.group(1) not in out:
            out.append(m.group(1))
    return out


def parse_points(html: str) -> list[dict]:
    """Puan kartları: [{platform_slug, platform_name, period, points, world_rank, days_in_top10, avg_points}]."""
    soup = BeautifulSoup(html, "lxml")
    out: list[dict] = []
    for card in soup.find_all("div", attrs={"x-show": re.compile(r"^isCurrent\(\d\)$")}):
        n = int(re.search(r"\d", card["x-show"]).group())
        period = PERIODS.get(n)
        if not period:
            continue
        rows = card.find_all("tr")
        for i, tr in enumerate(rows):
            a = tr.find("a", href=re.compile(r"^/top10/[a-z0-9-]+/world/"))
            if not a:
                continue
            slug = a["href"].split("/")[2]
            tds = tr.find_all("td")
            item = {
                "platform_slug": slug,
                "platform_name": a.get_text(" ", strip=True),
                "period": period,
                "points": _int(tds[1].get_text()) if len(tds) > 1 else None,
                "world_rank": _int(tds[2].get_text()) if len(tds) > 2 else None,
                "days_in_top10": None,
                "avg_points": None,
            }
            nxt = rows[i + 1] if i + 1 < len(rows) else None
            if nxt is not None and "In TOP 10 for" in nxt.get_text():
                spans = [s.get_text(strip=True) for s in nxt.find_all("span")]
                if spans:
                    item["days_in_top10"] = _int(spans[0])
                if len(spans) > 1:
                    item["avg_points"] = _int(spans[1])
            out.append(item)
    return out


def parse_weekly(html: str, updated: date) -> list[dict]:
    """"<ad> on <Platform> TOP 10 … this week" tabloları → [{platform_slug, iso2, date, rank}].

    Sütunlar son 7 gün (en sağdaki "Today" = sayfanın güncellenme günü). Ülke kodu bayrak sınıfından (fflag-XX).
    """
    soup = BeautifulSoup(html, "lxml")
    out: list[dict] = []
    for h2 in soup.find_all("h2"):
        if "this week" not in h2.get_text():
            continue
        table = h2.find_next("table")
        if table is None:
            continue
        heads = table.find("thead")
        ncols = len(heads.find_all("th")) - 1 if heads else 7
        days = [updated - timedelta(days=ncols - 1 - k) for k in range(ncols)]
        for tr in table.find_all("tr"):
            a = tr.find("a", href=re.compile(r"^/top10/[a-z0-9-]+/[a-z0-9-]+/$"))
            flag = tr.find("span", class_=re.compile(r"fflag-[A-Z]{2}"))
            if not a or not flag:
                continue
            platform = a["href"].split("/")[2]
            iso2 = re.search(r"fflag-([A-Z]{2})", " ".join(flag["class"])).group(1)
            cells = tr.find_all("td")[1:]
            for k, td in enumerate(cells[:ncols]):
                rank = _int(td.get_text())
                if rank:
                    out.append({"platform_slug": platform, "iso2": iso2, "date": days[k].isoformat(), "rank": rank})
    return out


def title_of(html: str) -> str:
    h1 = BeautifulSoup(html, "lxml").find("h1")
    return h1.get_text(" ", strip=True) if h1 else ""


def to_chart_entries(weekly: list[dict], *, tmdb_id: int, title: str, source_url: str, fetched_at: str):
    """Haftalık sıraları ChartEntry'ye çevirir (provider 'flixpatrol', platform = FlixPatrol slug'ı)."""
    from providers.base import ChartEntry  # döngüsel içe aktarmayı önlemek için geç

    return [
        ChartEntry(
            provider="flixpatrol",
            platform=w["platform_slug"],
            country_iso2=w["iso2"],
            period_type="day",
            period_date=w["date"],
            segment=w["platform_slug"],
            rank=w["rank"],
            title_raw=title,
            series_id=tmdb_id,
            program_kind="series",
            source_url=source_url,
            fetched_at=fetched_at,
        )
        for w in weekly
    ]


def utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
