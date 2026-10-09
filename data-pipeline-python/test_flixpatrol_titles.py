"""FlixPatrol dizi sayfası ayrıştırıcısı (providers/flixpatrol_titles.py). Örnek HTML, 2026-10-09'da canlı sayfadan
gözlenen yapının küçültülmüş kopyasıdır (metin içeriği değil, işaretleme yapısı)."""
from datetime import date

from providers import flixpatrol_titles as ft
import fetch_flixpatrol_titles as fft

PAGE = """
<h1>Kuruluş Osman</h1>
<div>TV Show | Turkey | 11/20/2019 | Drama</div>
<div class="card" x-show="isCurrent(1)"><table><tbody>
 <tr><td><a href="/top10/starz/world/2026-10-09/"><span>Starz</span></a></td><td>1 p.</td><td>44.</td></tr>
</tbody></table></div>
<div class="card" x-show="isCurrent(2)"><table><tbody>
 <tr><td><a href="/top10/starz/world/2026-10/"><span>Starz</span></a></td><td>241 p.</td><td>10.</td></tr>
 <tr><td colspan="3">In TOP 10 for <span class="font-semibold">8</span> days with avg <span class="font-semibold">30</span> points per day.</td></tr>
</tbody></table></div>
<div class="card" x-show="isCurrent(3)"><table><tbody>
 <tr><td><a href="/top10/starz/world/2026/"><span>Starz</span></a></td><td>12,500 p.</td><td>2.</td></tr>
 <tr><td colspan="3">In TOP 10 for <span class="font-semibold">280</span> days with avg <span class="font-semibold">45</span> points per day.</td></tr>
</tbody></table></div>
<h2><span>Kuruluş Osman on Starz TOP 10 TV Shows this week</span></h2>
<table><thead><tr><th>country</th><th>Oct 3</th><th>Oct 4</th><th>Oct 5</th><th>Oct 6</th><th>Oct 7</th><th>Yesterday</th><th>Today</th></tr></thead>
<tbody>
 <tr><td><a href="/top10/starz/egypt/"><span class="fflag fflag-EG"></span>Egypt</a></td><td>8.</td><td>6.</td><td>–</td><td>8.</td><td>9.</td><td>–</td><td>–</td></tr>
 <tr><td><a href="/top10/starz/saudi-arabia/"><span class="fflag fflag-SA"></span>Saudi Arabia</a></td><td>6.</td><td>5.</td><td>5.</td><td>6.</td><td>6.</td><td>10.</td><td>10.</td></tr>
</tbody></table>
<div>Last updated on October 9, 2026.</div>
"""


def test_kunye_ve_tarih():
    assert ft.is_turkish_tv_show(PAGE)
    assert not ft.is_turkish_tv_show(PAGE.replace("Turkey", "Spain"))
    assert ft.parse_updated(PAGE) == date(2026, 10, 9)
    assert ft.title_of(PAGE) == "Kuruluş Osman"


def test_puan_kartlari():
    p = {(x["period"]): x for x in ft.parse_points(PAGE)}
    assert p["today"]["points"] == 1 and p["today"]["world_rank"] == 44
    assert p["year"] == {
        "platform_slug": "starz", "platform_name": "Starz", "period": "year", "points": 12500,
        "world_rank": 2, "days_in_top10": 280, "avg_points": 45,
    }


def test_haftalik_siralar_son_yedi_gun():
    w = ft.parse_weekly(PAGE, date(2026, 10, 9))
    eg = [(x["date"], x["rank"]) for x in w if x["iso2"] == "EG"]
    assert eg == [("2026-10-03", 8), ("2026-10-04", 6), ("2026-10-06", 8), ("2026-10-07", 9)]
    assert ("2026-10-09", 10) in [(x["date"], x["rank"]) for x in w if x["iso2"] == "SA"]
    rows = ft.to_chart_entries(w, tmdb_id=95603, title="Kuruluş Osman", source_url="u", fetched_at="t")
    assert {r.platform for r in rows} == {"starz"} and all(r.series_id == 95603 and r.program_kind == "series" for r in rows)


def test_arama_ve_slug():
    html = '<a href="/title/kurulus-osman/">x</a><a href="/title/kurulus-osman/">y</a><a href="/title/other/">z</a>'
    assert ft.parse_search(html) == ["kurulus-osman", "other"]
    assert fft.slugify("Kuruluş: Osman") == "kurulus-osman"
    assert fft.search_names("Kuruluş: Osman", ["Establishment: Osman"]) == ["Kurulus Osman", "Establishment: Osman"]
