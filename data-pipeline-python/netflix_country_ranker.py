"""Netflix Top 10 (Tudum) ülke bazlı işleyici — web scraping DEĞİL, Netflix'in resmi,
kamuya açık veri dosyasını (`https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv`)
indirip ayrıştırır. robots.txt `/tudum`'a açıkça izin veriyor (`Allow: /tudum`), stealth/bot
atlatma yok.

DOĞRULANMIŞ İKİ ÖNEMLİ SINIR (2026-08-20, gerçek dosyayla test edildi):

1. **Ülke kırılımında izlenme SAATİ yok.** Dosyanın gerçek sütunları:
   `country_name, country_iso2, week, category, weekly_rank, show_title, season_title,
   cumulative_weeks_in_top_10`. "Haftalık izlenme saati" SADECE global dosyada
   (all-weeks-global.tsv) var — ülke bazlı dosyada sadece SIRA (1-10) ve o ülkede Top
   10'da kaldığı toplam hafta sayısı var. Bu yüzden `country_score_engine.py`'deki
   "Netflix Top 10 Haftalık Puanı" gerçek saat/izlenme sayısı DEĞİL, sıraya dayalı bir
   türetilmiş puandır (bkz. compute_rank_score) — bunu uydurma bir saat rakamıyla
   karıştırmıyoruz.

2. **Dosya (~30 MB) 18 ayrı denemede (iki farklı zaman aşımı stratejisiyle) BİR KEZ BİLE
   tam inmedi.** Her denemede content-length doğru raporlanıyor (31.727.293 bayt, sabit)
   ama akış rastgele bir noktada (227 KB ile 22 MB arası, tutarsız) `IncompleteRead` ile
   kopuyor. HEAD isteği ayrıca 403 dönüyor, sunucu Range/Accept-Ranges desteklemiyor (200
   dönüyor, Range header'ını yok sayıyor). Bu "aşılması gereken bir bot koruması" değil —
   GET her zaman gerçek veri döndürüyor, robots.txt izin veriyor (`Allow: /tudum`) — ama bu
   ortamdan bu dosyaya kalıcı bir CDN/ağ kararsızlığı var. Çözüm: `download_dataset` her
   denemede ulaşılan EN UZUN kısmi indirmeyi saklar (`.tsv.partial`); dosya alfabetik ülke
   sıralı olduğu için (doğrulandı), istenen ülkenin satır bloğu o kısmi dosyada TAMAMEN
   varsa (bloktan hemen sonra başka bir ülke görülüyorsa) kullanılır — YARIM KALMIŞ bir
   ülke bloğu ASLA kullanılmaz, `get_netflix_country_rankings` böyle bir durumda hangi
   ülkenin verisi eksik olduğunu açıkça belirten bir hata fırlatır.
"""
from __future__ import annotations

import csv
import re
import shutil
import time
from pathlib import Path
from typing import Optional

import requests

from models import NetflixCountrySignal

DATA_URL = "https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv"
# Kaynak URL'nin son parçasıyla BİREBİR aynı ad — tarayıcıdan elle indirilirse (bkz. modül
# docstring'i) varsayılan kaydedilen dosya adı zaten bu, kullanıcı yeniden adlandırmasın diye.
FILENAME = "all-weeks-countries.tsv"
MAX_ATTEMPTS = 8
# Bant genişliği gözlemsel olarak değişken (aynı dosya bir denemede ~20 MB/60 sn, başka bir
# denemede ~3 MB/25 sn) — sabit bir süre sınırı ilerlemekte olan bir indirmeyi erken kesip
# gereksiz başarısızlık yaratıyordu (doğrulandı). Bunun yerine sadece bağlantının GERÇEKTEN
# koptuğu an (ChunkedEncodingError/ConnectionError/ReadTimeout) yeni bir denemeye geçilir.
READ_TIMEOUT_S = 120.0

# Bu proje sadece Türk DİZİLERİYLE ilgileniyor (server/tmdb.js de sadece /discover/tv
# çekiyor, film değil) — Netflix'in "Films" kategorisi baştan eleniyor.
RELEVANT_CATEGORY = "TV"


def download_dataset(cache_dir: Path, force: bool = False) -> tuple[Path, bool]:
    """(dosya_yolu, tam_mi) döner. Tam indirme başarılı olursa tam_mi=True. Sekiz deneme de
    eksik kalırsa, ulaşılan EN UZUN kısmi indirme `.tsv.partial` olarak saklanır ve
    tam_mi=False ile döner — hangi ülkelerin bu kısmi veride olduğu/olmadığı çağıran
    tarafın (get_netflix_country_rankings) sorumluluğundadır."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / FILENAME
    if dest.exists() and not force:
        return dest, True

    tmp = dest.with_suffix(".tsv.part")
    best_partial = dest.with_suffix(".tsv.partial")
    best_bytes = best_partial.stat().st_size if best_partial.exists() else 0
    last_error: Optional[Exception] = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        start = time.monotonic()
        try:
            with requests.get(DATA_URL, stream=True, timeout=(10, READ_TIMEOUT_S)) as res:
                res.raise_for_status()
                expected = int(res.headers.get("content-length", -1))
                total = 0
                with open(tmp, "wb") as f:
                    for chunk in res.iter_content(chunk_size=1 << 16):
                        if not chunk:
                            continue
                        f.write(chunk)
                        total += len(chunk)
                if expected != -1 and total != expected:
                    raise IOError(f"Eksik indirme: {total}/{expected} bayt")
            tmp.replace(dest)
            elapsed = time.monotonic() - start
            print(f"[netflix] indirme tamamlandı: {total} bayt, {elapsed:.1f}s")
            if best_partial.exists():
                best_partial.unlink()
            return dest, True
        except Exception as exc:  # noqa: BLE001 — her tür ağ hatasında aynı retry mantığı
            last_error = exc
            elapsed = time.monotonic() - start
            partial_size = tmp.stat().st_size if tmp.exists() else 0
            print(f"[netflix] deneme {attempt}/{MAX_ATTEMPTS} başarısız ({elapsed:.1f}s, {partial_size} bayt): {exc}")
            if partial_size > best_bytes:
                best_bytes = partial_size
                shutil.copy(tmp, best_partial)
            time.sleep(min(2**attempt, 20))

    if best_partial.exists():
        print(
            f"[netflix] UYARI: {MAX_ATTEMPTS} denemede de tam indirilemedi (son hata: {last_error}). "
            f"En uzun kısmi indirme ({best_bytes} bayt) kullanılacak — sadece bu kısımda TAM olarak "
            f"bulunan ülkeler işlenebilir."
        )
        return best_partial, False

    raise RuntimeError(
        f"{FILENAME}, {MAX_ATTEMPTS} denemede de hiç veri indirilemedi. Son hata: {last_error}"
    )


def _matches(show_title: str, season_title: str, candidates: list[str]) -> bool:
    haystack = f"{show_title} {season_title}".casefold()
    return any(c.strip().casefold() in haystack for c in candidates if c and c.strip())


def _is_country_block_complete(path: Path, field: str, target: str) -> bool:
    """Dosya ülkeye göre alfabetik sıralı (doğrulandı) — hedef ülkenin satır bloğundan
    HEMEN SONRA başka bir ülkenin satırı görülüyorsa blok tamdır. Hedef ülke hiç
    görünmüyorsa ya da dosya tam o ülkenin ortasında/hemen bitiminde kesiliyorsa False
    döner (yarım bir bloğu asla 'tam' saymayız)."""
    seen_target = False
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            row_value = row.get(field, "")
            if field == "country_name":
                row_value = row_value.casefold()
            if row_value == target:
                seen_target = True
            elif seen_target:
                return True
    return False


def _resolve_country_filter(country_name: str):
    """'Poland' gibi bir İngilizce ülke adı ya da 'PL' gibi bir ISO2 kod kabul eder —
    dosyanın kendi country_name sütunu İngilizce resmi adlar kullanıyor (doğrulandı:
    'Argentina', 'Bangladesh' vb.)."""
    value = country_name.strip()
    if len(value) == 2 and value.isalpha():
        return "country_iso2", value.upper()
    return "country_name", value.casefold()


def get_netflix_country_rankings(
    country_name: str, turkish_titles: list[str], cache_dir: Path
) -> list[NetflixCountrySignal]:
    """Verilen ülkede, verilen dizi adlarından (bkz. _matches — büyük/küçük harf
    duyarsız, alt küme eşleşmesi) hangilerinin Netflix Top 10'a girdiğini, kaç hafta
    kaldığını ve en iyi (peak) sırasını döner. Eşleşme yoksa boş liste — uydurma bir
    sıralama üretilmez.

    Not: Netflix show_title alanı bazen dizinin uluslararası/İngilizce adını kullanabilir
    (Türkçe adla birebir eşleşmeyebilir) — turkish_titles'a bilinen İngilizce/uluslararası
    varyantları da eklemek (ör. IMDb pipeline'ının localized_titles'ından) eşleşme oranını
    artırır.
    """
    path, is_complete = download_dataset(cache_dir)
    field, target = _resolve_country_filter(country_name)

    if not is_complete and not _is_country_block_complete(path, field, target):
        raise RuntimeError(
            f"'{country_name}' için Netflix verisi eksik indirilen dosyada TAM olarak "
            f"bulunamadı (bilinen CDN kesinti sorunu — bkz. modül docstring'i). Yarım bir "
            f"blok kullanılmadı; tekrar deneyin ya da dosyayı elle indirip "
            f"{path.parent / FILENAME} konumuna koyun."
        )

    accumulator: dict[str, dict] = {}
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            if row.get("category") != RELEVANT_CATEGORY:
                continue
            row_value = row.get(field, "")
            if field == "country_name":
                row_value = row_value.casefold()
            if row_value != target:
                continue
            show_title = row.get("show_title", "")
            season_title = row.get("season_title", "") or ""
            if not _matches(show_title, season_title, turkish_titles):
                continue

            key = show_title
            rank = int(row["weekly_rank"])
            week = row.get("week", "")
            if key not in accumulator:
                accumulator[key] = {
                    "show_title": show_title,
                    "category": row.get("category"),
                    "weeks_in_top10": 0,
                    "peak_position": rank,
                    "latest_week": week,
                    "latest_rank": rank,
                }
            entry = accumulator[key]
            entry["weeks_in_top10"] += 1
            entry["peak_position"] = min(entry["peak_position"], rank)
            if week >= entry["latest_week"]:
                entry["latest_week"] = week
                entry["latest_rank"] = rank

    return [NetflixCountrySignal(**v) for v in accumulator.values()]


def _country_slug(country_name: str) -> str:
    """'Poland' -> 'poland', 'South Korea' -> 'south-korea'. Netflix'in gerçek URL slug
    kuralı doğrulanmadı (her ülke tek tek test edilmedi) — bu, aksi ispatlanana kadar en
    olası dönüşüm. Yanlış çıkarsa fetch_country_page_fallback 404 ile başarısız olur, dürüstçe
    hata fırlatır."""
    return re.sub(r"[^a-z0-9]+", "-", country_name.strip().lower()).strip("-")


def _extract_balanced_object(text: str, open_brace_idx: int) -> Optional[str]:
    """Bir `{` konumundan başlayıp eşleşen `}` konumuna kadar olan alt metni döner —
    sayfa yarıda kesildiyse (bkz. modül docstring'i madde 2, aynı CDN kararsızlığı bu
    sayfayı da etkiliyor) None döner, o nesne dürüstçe atlanır."""
    depth = 0
    in_string = False
    escape = False
    i = open_brace_idx
    while i < len(text):
        c = text[i]
        if in_string:
            if escape:
                escape = False
            elif c == "\\":
                escape = True
            elif c == '"':
                in_string = False
        else:
            if c == '"':
                in_string = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return text[open_brace_idx : i + 1]
        i += 1
    return None


def _unescape_js_single_quote(value: str) -> str:
    # netflix.reactContext.models.graphql = JSON.parse('...') TEK TIRNAKLA sarılı bir JS
    # string'i — içindeki gerçek tek tırnaklar (ör. "Don't") \' olarak kaçırılmış, aksi halde
    # JSON içeriği ZATEN normal çift-tırnaklı JSON escape'i kullanıyor (bkz. modül docstring'i
    # madde 3 — sadece bu tek istisna var).
    return value.replace("\\'", "'")


_TITLE_RE = re.compile(r'"top10Video":\{"__typename":"Top10PulseVideo","title":"((?:[^"\\]|\\.)*)"')
_PARENT_SHOW_RE = re.compile(r'"parentShow":(null|\{(?:[^{}]|\{[^{}]*\})*\})')
_PARENT_SHOW_TITLE_RE = re.compile(r'"title":"((?:[^"\\]|\\.)*)"')
_CATEGORY_RE = re.compile(r'"category":"(\w+)"')
_WEEK_END_RE = re.compile(r'"weekEndDate":"([\d-]+)"')
_CUM_WEEKS_RE = re.compile(r'"cumulativeWeeksInTop10":(\d+)')
_COUNTRY_RANKS_BLOCK_RE = re.compile(r'"countryRanks":\[(.*?)\]\}$')
_COUNTRY_RANK_ITEM_RE = re.compile(r'"countryId":"([A-Z]{2})","rank":(\d+)')


def _parse_top10_entity(obj_str: str) -> Optional[dict]:
    """Tek bir PulseTop10ItemEntity nesnesinin metnini hedefe yönelik regex'lerle ayrıştırır
    — TAM bir JSON.loads DENENMİYOR: nesnenin artwork/urlsSized alanları GraphQL alan-argüman
    kodlaması yüzünden ÇİFT kaçırılmış anahtarlar içeriyor (ör. `urlsSized({\\\\"sizes\\\\":...`)
    ve bu, bizim hiç ihtiyacımız olmayan bir alan (poster resmi boyut varyantları) — onu
    doğru ayrıştırmaya çalışmak yerine SADECE gerçekten kullandığımız 5 alanı çekiyoruz.
    2026-08-25'te gerçek yakalanmış bir sayfa parçasıyla doğrulandı (7 nesneden 6'sı tam,
    biri dürüstçe 'kesildi' — bkz. fetch_country_page_fallback)."""
    category_m = _CATEGORY_RE.search(obj_str)
    if not category_m:
        return None
    title_m = _TITLE_RE.search(obj_str)
    parent_m = _PARENT_SHOW_RE.search(obj_str)
    parent_title = None
    if parent_m and parent_m.group(1) != "null":
        pt = _PARENT_SHOW_TITLE_RE.search(parent_m.group(1))
        parent_title = _unescape_js_single_quote(pt.group(1)) if pt else None
    week_m = _WEEK_END_RE.search(obj_str)
    cum_m = _CUM_WEEKS_RE.search(obj_str)
    ranks_m = _COUNTRY_RANKS_BLOCK_RE.search(obj_str)
    ranks: dict[str, int] = {}
    if ranks_m:
        for cm in _COUNTRY_RANK_ITEM_RE.finditer(ranks_m.group(1)):
            ranks[cm.group(1)] = int(cm.group(2))
    return {
        "category": category_m.group(1),
        "week_end_date": week_m.group(1) if week_m else None,
        "cumulative_weeks_in_top10": int(cum_m.group(1)) if cum_m else None,
        # TV kategorisinde parentShow genelde dizinin kendisi (sezon/bölüm değil) — varsa o
        # tercih edilir, yoksa top10Video.title'a (bazen bölüm/sezon adı olabilir) düşülür.
        "title": parent_title or (_unescape_js_single_quote(title_m.group(1)) if title_m else None),
        "country_ranks": ranks,
    }


def fetch_country_page_fallback(
    country_name: str, country_iso2: str, turkish_titles: list[str], timeout: float = 60.0
) -> list[NetflixCountrySignal]:
    """all-weeks-countries.tsv indirmesi başarısız olduğunda devreye giren, tek bir ülkenin
    Tudum sayfasını (https://www.netflix.com/tudum/top10/{slug}) çeken best-effort fallback.

    DÜRÜST UYARI (2026-08-25, gerçek testle doğrulandı): Bu sayfa TSV'DEN DAHA HAFİF DEĞİL —
    tek bir polyfill script'i ~2,5 MB, sayfanın tamamı muhtemelen TSV'den (30 MB) daha küçük
    ama küçük de değil; AYNI CDN bağlantı kararsızlığından muzdarip (8/8 gerçek denemede tam
    yüklenemedi). Bu fonksiyon TSV'nin ikinci bir ŞANSI, mucizevi bir çözüm DEĞİL — aynı ağ
    sorunu bu ortamda sürüyorsa o da başarısız olabilir. `_extract_balanced_object` sayesinde
    yarıda kesilen sayfalarda bile TAM gelen nesneler kullanılabilir (TSV'nin "yarım ülke
    bloğu asla kullanma" prensibiyle aynı ruhta — burada nesne bazında).

    Sadece TEK bir haftalık anlık görüntü verir (TSV'nin çoklu-hafta geçmişinden farklı) —
    bu yüzden `weeks_in_top10` = o haftaya kadarki `cumulativeWeeksInTop10` (gerçek, kümülatif
    bir sayı), `peak_position`/`latest_rank` = o haftaki GÜNCEL sıra (geçmiş haftalardaki
    gerçek en iyi sıra değil — tek anlık görüntüden bilinemez, bu dürüstçe böyle etiketlenir).
    """
    slug = _country_slug(country_name)
    url = f"https://www.netflix.com/tudum/top10/{slug}"

    body = bytearray()
    try:
        with requests.get(url, stream=True, timeout=(10, timeout), headers={"User-Agent": "Mozilla/5.0"}) as res:
            res.raise_for_status()
            for chunk in res.iter_content(chunk_size=1 << 16):
                if chunk:
                    body.extend(chunk)
    except requests.exceptions.HTTPError as exc:
        raise RuntimeError(f"'{country_name}' için Tudum sayfası bulunamadı ({url}): {exc}") from exc
    except Exception:  # noqa: BLE001 — bağlantı koptuysa bile o ana kadar gelen veriyi kullan
        pass

    if len(body) < 10_000:
        raise RuntimeError(
            f"'{country_name}' için Tudum sayfası çok az veriyle koptu ({len(body)} bayt) — "
            "kullanılabilir tam bir dizi bloğu yok."
        )

    text = body.decode("utf-8", errors="replace")
    matches = list(re.finditer(r'"PulseTop10ItemEntity:[^"]+":(\{)', text))

    accumulator: dict[str, dict] = {}
    for m in matches:
        obj_str = _extract_balanced_object(text, m.start(1))
        if obj_str is None:
            continue  # sayfa tam bu nesnenin ortasında kesilmiş — atla, uydurma tamamlama yok
        entity = _parse_top10_entity(obj_str)
        if entity is None or entity["category"] != RELEVANT_CATEGORY:
            continue
        title = entity["title"]
        if not title or not _matches(title, "", turkish_titles):
            continue
        rank = entity["country_ranks"].get(country_iso2.upper())
        if rank is None:
            continue  # bu dizi Top10'a girmiş ama bizim hedef ülkemizde değil
        accumulator[title] = {
            "show_title": title,
            "category": entity["category"],
            "weeks_in_top10": entity["cumulative_weeks_in_top10"] or 1,
            "peak_position": rank,
            "latest_week": entity["week_end_date"],
            "latest_rank": rank,
        }

    return [NetflixCountrySignal(**v) for v in accumulator.values()]


def compute_rank_score(signal: NetflixCountrySignal) -> float:
    """Gerçek saat/izlenme verisi olmadığı için (bkz. modül docstring'i madde 1) sıraya
    dayalı, şeffaf bir türetilmiş puan: en iyi sıra (1) → 100, en kötü (10) → 10, Top
    10'da kaldığı hafta sayısıyla hafifçe ağırlıklandırılır (uzun süre kalmak, tek
    haftalık bir çıkıştan daha güçlü bir sinyaldir)."""
    base = max(0.0, (11 - signal.peak_position) * 10)
    weeks_bonus = min(20.0, signal.weeks_in_top10 * 2)
    return round(min(100.0, base * 0.8 + weeks_bonus), 1)
