import sys
import logging
from datetime import datetime
from bs4 import BeautifulSoup
from curl_cffi import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# FlixPatrol URL Yapısı
BASE_URL = "https://flixpatrol.com/top10"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

def fetch_country_top10(platform: str, country_slug: str, date_str: str = None) -> list[dict]:
    """
    FlixPatrol üzerinden belirli bir ülke ve platform için Top 10 verisini kazır.
    Örn: platform='netflix', country_slug='brazil', date_str='2026-09-22'
    """
    url = f"{BASE_URL}/{platform}/{country_slug}/"
    if date_str:
        url += f"{date_str}/"

    logging.info(f"Scraping URL: {url}")

    try:
        # TLS Impersonation ile Cloudflare bypass
        response = requests.get(
            url, 
            headers=HEADERS, 
            impersonate="chrome124", 
            timeout=15
        )

        if response.status_code != 200:
            logging.error(f"HTTP Hata: {response.status_code} - {url}")
            return []

        soup = BeautifulSoup(response.content, "html.parser")
        results = []

        # Top 10 Tablo Ayrıştırma (TV Shows)
        # FlixPatrol ID ve tablolama yapısını okur
        tables = soup.find_all("table")
        for table in tables:
            rows = table.find_all("tr")
            for row in rows:
                cols = row.find_all("td")
                if len(cols) >= 2:
                    rank_text = cols[0].text.strip().replace(".", "")
                    title_elem = cols[1].find("a")
                    
                    if rank_text.isdigit() and title_elem:
                        rank = int(rank_text)
                        title = title_elem.text.strip()
                        href = title_elem.get("href", "")

                        results.append({
                            "rank": rank,
                            "title": title,
                            "platform": platform,
                            "country": country_slug,
                            "scraped_at": datetime.utcnow().isoformat(),
                            "source_trust_level": "unofficial_telemetry",
                            "confidence_score": "LOW"
                        })

        logging.info(f"{country_slug.upper()} ({platform}) için {len(results)} kayıt başarıyla kazındı.")
        return results

    except Exception as e:
        logging.error(f"Scraping sırasında hata oluştu ({url}): {str(e)}")
        return []

def save_to_telemetry_db(records: list[dict]):
    """
    Çekilen verileri veritabanına 'unofficial_telemetry' etiketiyle yazar.
    """
    if not records:
        return
    
    # Burada mevcut pipeline.db veya app.db bağlantısı üzerinden 
    # unofficial_telemetry tablosuna bulk insert işlemi yapılır.
    logging.info(f"Veritabanına {len(records)} kayıt aktarılıyor...")
    # SQL Insert logic buraya bağlanır

if __name__ == "__main__":
    # Örnek Test Koşusu
    test_countries = ["brazil", "mexico", "south-africa", "turkey"]
    for c in test_countries:
        data = fetch_country_top10("netflix", c)
        save_to_telemetry_db(data)