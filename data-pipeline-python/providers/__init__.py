"""Liste sağlayıcı katmanı: her "Top" kaynağı aynı arayüzü uygular ve chart_entries'e yazar.

Sağlayıcılar:
  netflix_tudum  — Netflix Top 10 (94 pazar, haftalık, 2021→)    hazır
  reytingtv      — Türkiye TV günlük Top 10 (Total/AB/20+ABC1)     hazır
  flixpatrol     — çok platformlu güncel TV Top 10 (Disney+/Prime/HBO Max/Apple TV+/Shahid)
                   FlixPatrol yöneticilerinin crawl İZNİYLE; site Cloudflare korumalı olduğu
                   için StealthyFetcher ile koruma aşılır (katmanın genel kuralına bilinçli
                   istisna, bkz. providers/flixpatrol.py docstring). FLIXPATROL_SCRAPE_ENABLED=0
                   ile kapatılabilir.
Arayüz: providers.base.ChartProvider. Genel kural: robots.txt izinli açık sayfalar, bot koruması
atlatılmaz, uydurma/sentetik sayı yok — flixpatrol, site sahibinin açık iznine dayanan tek istisna.
"""
from providers.base import ChartEntry, ChartProvider, PROGRAM_KINDS, classify_program_kind  # noqa: F401
