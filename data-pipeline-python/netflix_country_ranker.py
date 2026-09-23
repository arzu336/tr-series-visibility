"""Netflix Top 10 (Tudum) ülke bazlı işleyici — web scraping DEĞİL, Netflix'in resmi,
kamuya açık veri dosyasını (`https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv`)
indirip ayrıştırır. robots.txt `/tudum`'a açıkça izin veriyor (`Allow: /tudum`), stealth/bot
atlatma yok.

DOĞRULANMIŞ İKİ ÖNEMLİ SINIR (2026-08-20, gerçek dosyayla test edildi):

1. **Ülke kırılımında izlenme SAATİ yok.** Dosyanın gerçek sütunları:
   `country_name, country_iso2, week, category, weekly_rank, show_title, season_title,
   cumulative_weeks_in_top_10`. "Haftalık izlenme saati" SADECE global dosyada
   (all-weeks-global.tsv) var — ülke bazlı dosyada sadece SIRA (1-10) ve o ülkede Top
   10'da kaldığı toplam hafta sayısı var. Bu yüzden `compute_rank_score` gerçek saat/izlenme
   sayısı DEĞİL, sıraya dayalı türetilmiş bir puan üretir — bunu uydurma bir saat rakamıyla
   karıştırmıyoruz.

2. **Dosya (~32 MB) uzun süre BİR KEZ BİLE tam inmedi.** Her denemede content-length doğru
   raporlanıyor ama akış rastgele bir noktada `IncompleteRead` ile kopuyor. 2026-09-23'te
   curl ile yeniden ölçüldü ve sunucu davranışı netleşti:
     - HEAD → 403. GET her zaman 200 + gerçek veri (bot engeli değil, robots.txt `Allow: /tudum`).
     - `Range: bytes=N-` YOK SAYILIYOR: 200 + tam gövde dönüyor, `Accept-Ranges` başlığı yok.
     - `Accept-Encoding: gzip` YOK SAYILIYOR: content-length hâlâ 32 MB, `Content-Encoding` yok.
     - top10.netflix.com eski adresi 301 ile aynı URL'ye yönlendiriyor (alternatif CDN yok).
     - Hız ~240-280 KB/s (tam dosya için ~2 dk gerekiyor); bağlantı ~60 sn civarında
       "connection reset / failure when receiving data from the peer" ile kopuyor (bir kez
       62 sn'de 17 MB'da). Yani kesinti süreye bağlı görünüyor, hıza değil.
   Bu koşullarda "resume" imkânsız değil, sadece sunucu izin verirse mümkün: `download_dataset`
   her yeniden denemede `Range` + `If-Range` gönderir; 206 gelirse mevcut `.tsv.part`'a EKLER,
   200 gelirse (bugünkü durum) sunucunun yok saydığını anlar ve baştan yazar. Böylece CDN bir
   gün Range açarsa kod değişikliği gerekmez; açmazsa dürüstçe aynı "en uzun kısmi indirme"
   stratejisine düşer. Tamlık yalnızca content-length ile değil, dosyanın `\\n` ile bitmesi ve
   son satırın 8 alanlı olmasıyla da doğrulanır (kesik son satır 'tam' sayılmaz).
   Dosya alfabetik ülke sıralı olduğu için (doğrulandı), istenen ülkenin satır bloğu kısmi
   dosyada TAMAMEN varsa (bloktan hemen sonra başka bir ülke görülüyorsa) kullanılır — YARIM
   KALMIŞ bir ülke bloğu ASLA kullanılmaz; `scan_all_countries` kesilen son ülkeyi açıkça
   `truncated` olarak raporlar, `get_netflix_country_rankings` ise hata fırlatır.
"""
from __future__ import annotations

import csv
import functools
import json
import os
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
# Kesinti süreye bağlı ve rastgele (bkz. docstring madde 2): 8 deneme ~%0 başarı verdi, ama
# gözlenen kopma noktaları 227 KB ile 22 MB arasında dağılıyor — daha çok deneme, tam inme
# şansını gerçekten artırır. Toplam süre TOTAL_DEADLINE_S ile sınırlı, sonsuza kadar denemez.
MAX_ATTEMPTS = 12
CONNECT_TIMEOUT_S = 15.0
# Chunk'lar arası hareketsizlik sınırı (toplam süre DEĞİL) — ilerleyen bir indirme kesilmez,
# sadece gerçekten donmuş bağlantı bırakılır. Ölçülen kopmalar zaten 60 sn civarında geliyor.
READ_TIMEOUT_S = 60.0
# Zamanlanmış bir koşunun (batch_run/scheduler) bu adımda takılıp kalmaması için üst sınır.
# 12 deneme x ~60 sn + backoff ≈ 15 dk; ortam değişkeniyle ayarlanabilir.
TOTAL_DEADLINE_S = float(os.environ.get("NETFLIX_DOWNLOAD_DEADLINE_S", "900"))
# Tam inmiş dosya bu yaştan eskiyse yeniden indirme DENENİR (Netflix haftalık, salı günleri
# günceller). Deneme başarısız olursa eski tam dosya yine kullanılır — tam ama bir hafta eski
# bir dosya, güncel ama yarım bir dosyadan daha değerlidir (tüm ülkeleri kapsar).
MAX_AGE_S = float(os.environ.get("NETFLIX_DATASET_MAX_AGE_S", str(7 * 24 * 3600)))
# Tarayıcı benzeri başlıklar: CDN'in HEAD'e 403 vermesi UA bazlı bir politika olduğunu düşündürüyor;
# GET zaten çalışıyor ama aynı politikanın bağlantı süresini etkileme ihtimaline karşı zararsız.
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Accept": "text/tab-separated-values,text/plain;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.netflix.com/tudum/top10",
}
# Dosyanın gerçek sütun sayısı (bkz. docstring madde 1) — son satır bütünlük kontrolü için.
EXPECTED_FIELD_COUNT = 8

# Bu proje sadece Türk DİZİLERİYLE ilgileniyor (server/tmdb.js de sadece /discover/tv
# çekiyor, film değil) — Netflix'in "Films" kategorisi baştan eleniyor.
RELEVANT_CATEGORY = "TV"


# SÜREÇ İÇİ KARAR HAFIZASI — ölçülen gerçek sorun: `download_dataset` her ÜLKE için yeniden
# çağrılıyor ve dosya tam inmediği için her çağrıda 8 denemeyi baştan yapıyordu. 12 ülkelik bir
# koşu 12 x 8 x ~45 sn ≈ 70 dakika sürüyordu; pratikte bu, pipeline'ın hiç çalıştırılamaması
# demekti (netflix_country_rankings tablosunun boş kalmasının asıl sebebi).
# Karar bir kez verilir: tam indirme başarısızsa aynı süreçte tekrar denenmez, elde olan en
# uzun kısmi dosya kullanılır. Yeni bir süreç yine baştan dener — kalıcı bir vazgeçiş değil.
_COZULMUS_DATASET: Optional[tuple[Path, bool]] = None


def _looks_complete(path: Path, expected: int) -> bool:
    """Dosya gerçekten tam mı? content-length eşleşmesi tek başına yetmez: content-length
    başlığı yoksa (-1) ya da sunucu yanlış raporlarsa kesik bir dosya 'tam' sayılabilir.
    TSV'nin yapısal bir garantisi var — her satır `\\n` ile biter ve 8 alanlıdır — o da kontrol
    edilir. Kesik son satır = yarım ülke bloğu riski, bkz. modül docstring'i."""
    if not path.exists():
        return False
    size = path.stat().st_size
    if size == 0:
        return False
    if expected != -1 and size != expected:
        return False
    with open(path, "rb") as f:
        f.seek(max(0, size - 4096))
        tail = f.read()
    if not tail.endswith(b"\n"):
        return False
    last_line = tail.rstrip(b"\r\n").split(b"\n")[-1]
    return last_line.count(b"\t") == EXPECTED_FIELD_COUNT - 1


def _parse_content_range_total(header: Optional[str]) -> int:
    """'bytes 1000-31727292/31727293' -> 31727293. Bilinmiyorsa ('*') -1."""
    if not header or "/" not in header:
        return -1
    total = header.rsplit("/", 1)[1].strip()
    return int(total) if total.isdigit() else -1


def _write_partial_meta(meta_path: Path, *, size: int, expected: int, last_modified: Optional[str]) -> None:
    """Kısmi dosyanın hangi sunucu sürümüne ait olduğunu yanına yazar — bir sonraki haftanın
    denemesi daha kısa kalırsa eski (daha uzun) kısmi dosya kazanır ve kullanıcı bunun eski
    haftaya ait olduğunu bilmeli (bkz. download_dataset uyarısı)."""
    meta_path.write_text(
        json.dumps(
            {"bytes": size, "content_length": expected, "last_modified": last_modified, "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def _read_partial_meta(meta_path: Path) -> dict:
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def cleanup_temp_files(cache_dir: Path) -> int:
    """İndirme sırasında kullanılan `.tsv.part` geçici dosyasını siler; silinen dosya sayısını
    döner. `.tsv.partial` (en uzun kısmi indirme) ve meta dosyası BİLEREK korunur — onlar geçici
    değil, bir sonraki koşunun kullanacağı veri. `.part` ise yalnızca tek bir indirme denemesinin
    ara çıktısı: başarıda `dest`'e taşınır, başarısızlıkta uzunsa `.partial`'a kopyalanır; her iki
    durumda da işi bitmiştir. Süreç yarıda öldürülürse (zaman aşımı, SIGTERM) geride kalır — bu
    yüzden hem koşu sonunda hem yeni koşu başında çağrılır."""
    dest = cache_dir / FILENAME
    silinen = 0
    for tmp in (dest.with_suffix(".tsv.part"),):
        if tmp.exists():
            try:
                tmp.unlink()
                silinen += 1
            except OSError as exc:
                print(f"[netflix] geçici dosya silinemedi ({tmp.name}): {exc}")
    return silinen


def resolve_local_dataset(cache_dir: Path) -> tuple[Path, bool]:
    """Ağa hiç çıkmadan diskteki veriyi döner: tam dosya varsa (yaşına bakılmaz) o, yoksa en
    uzun kısmi dosya. Hiçbiri yoksa RuntimeError. Kullanım: indirme az önce denenmiş ve başarısız
    olmuşken eşleştirme mantığını/aday listesini değiştirip yeniden koşmak — 10-15 dakikalık
    yeni bir indirme turu beklemeden."""
    cleanup_temp_files(cache_dir)  # önceki süreçten kalan .part burada da işe yaramaz
    dest = cache_dir / FILENAME
    if dest.exists():
        return dest, True
    best_partial = dest.with_suffix(".tsv.partial")
    if best_partial.exists():
        print(f"[netflix] çevrimdışı: kısmi dosya kullanılıyor ({best_partial.stat().st_size} bayt).")
        return best_partial, False
    raise RuntimeError(f"Çevrimdışı mod: {cache_dir} içinde ne {FILENAME} ne de kısmi dosya var.")


def download_dataset(cache_dir: Path, force: bool = False) -> tuple[Path, bool]:
    """(dosya_yolu, tam_mi) döner. Tam indirme başarılı olursa tam_mi=True. Tüm denemeler eksik
    kalırsa, ulaşılan EN UZUN kısmi indirme `.tsv.partial` olarak saklanır ve tam_mi=False ile
    döner — hangi ülkelerin bu kısmi veride olduğu/olmadığı çağıran tarafın
    (get_netflix_country_rankings / scan_all_countries) sorumluluğundadır.

    Yeniden deneme stratejisi (bkz. modül docstring'i madde 2):
      - Her yeniden denemede `Range: bytes=<mevcut>-` + `If-Range: <Last-Modified>` gönderilir.
        206 → mevcut `.tsv.part`'a eklenir (gerçek resume). 200 → sunucu Range'i yok saydı ya da
        dosya değişti; baştan yazılır. Bugün itibarıyla Netflix CDN'i 200 döndürüyor.
      - Tam inmiş ama MAX_AGE_S'den eski bir dosya varsa yenilenmeye çalışılır; başarısız olursa
        eski TAM dosya kısmi dosyaya tercih edilir (bütün ülkeleri kapsar).
      - Toplam süre TOTAL_DEADLINE_S ile sınırlıdır.
    """
    global _COZULMUS_DATASET
    if _COZULMUS_DATASET is not None and not force:
        return _COZULMUS_DATASET

    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / FILENAME
    stale_full: Optional[Path] = None
    if dest.exists() and not force:
        age = time.time() - dest.stat().st_mtime
        if age <= MAX_AGE_S:
            _COZULMUS_DATASET = (dest, True)
            return _COZULMUS_DATASET
        stale_full = dest
        print(f"[netflix] mevcut tam dosya {age / 86400:.1f} gün eski — yenileme deneniyor (başarısızsa eskisi kullanılır).")

    tmp = dest.with_suffix(".tsv.part")
    best_partial = dest.with_suffix(".tsv.partial")
    meta_path = dest.with_suffix(".tsv.partial.json")
    best_bytes = best_partial.stat().st_size if best_partial.exists() else 0
    # Önceki süreçten kalan .part'a güvenilmez (hangi sürüme ait olduğu bilinmiyor) — temiz başla.
    cleanup_temp_files(cache_dir)

    try:
        return _download_with_retries(dest, tmp, best_partial, meta_path, best_bytes, stale_full)
    finally:
        # Başarı (dest'e taşındı), başarısızlık (.partial'a kopyalandı) ya da istisna — .part'ın
        # işi her durumda bitti; diskte 15 MB'lık yarım dosyalar birikmesin.
        cleanup_temp_files(cache_dir)


def _download_with_retries(
    dest: Path,
    tmp: Path,
    best_partial: Path,
    meta_path: Path,
    best_bytes: int,
    stale_full: Optional[Path],
) -> tuple[Path, bool]:
    global _COZULMUS_DATASET
    last_error: Optional[Exception] = None
    expected = -1
    last_modified: Optional[str] = None
    range_supported: Optional[bool] = None  # None = henüz denenmedi
    deadline = time.monotonic() + TOTAL_DEADLINE_S
    session = requests.Session()

    for attempt in range(1, MAX_ATTEMPTS + 1):
        if time.monotonic() >= deadline:
            print(f"[netflix] toplam süre sınırı ({TOTAL_DEADLINE_S:.0f} sn) aşıldı, {attempt - 1} denemede durduruldu.")
            break

        offset = tmp.stat().st_size if (tmp.exists() and range_supported is not False) else 0
        headers = dict(BROWSER_HEADERS)
        if offset > 0:
            headers["Range"] = f"bytes={offset}-"
            if last_modified:
                # Dosya bu arada değiştiyse sunucu 206 yerine 200 + yeni tam gövde döner —
                # farklı sürümlerin baytlarını birleştirme riski böylece kalkar.
                headers["If-Range"] = last_modified

        start = time.monotonic()
        try:
            with session.get(DATA_URL, stream=True, timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S), headers=headers) as res:
                res.raise_for_status()
                if offset > 0 and res.status_code == 206:
                    if range_supported is None:
                        print(f"[netflix] sunucu Range destekliyor — {offset} bayttan devam ediliyor.")
                    range_supported = True
                    mode = "ab"
                    total = offset
                    expected = _parse_content_range_total(res.headers.get("content-range"))
                else:
                    if offset > 0:
                        print("[netflix] sunucu Range başlığını yok saydı (200) — baştan indiriliyor.")
                        range_supported = False
                    mode = "wb"
                    total = 0
                    expected = int(res.headers.get("content-length", -1))
                    last_modified = res.headers.get("last-modified")

                with open(tmp, mode) as f:
                    for chunk in res.iter_content(chunk_size=1 << 16):
                        if not chunk:
                            continue
                        f.write(chunk)
                        total += len(chunk)

            if not _looks_complete(tmp, expected):
                raise IOError(f"Eksik indirme: {total}/{expected} bayt (ya da kesik son satır)")

            tmp.replace(dest)
            elapsed = time.monotonic() - start
            print(f"[netflix] indirme tamamlandı: {total} bayt, {elapsed:.1f}s (deneme {attempt})")
            for artefact in (best_partial, meta_path):
                if artefact.exists():
                    artefact.unlink()
            _COZULMUS_DATASET = (dest, True)
            return _COZULMUS_DATASET
        except Exception as exc:  # noqa: BLE001 — her tür ağ hatasında aynı retry mantığı
            last_error = exc
            elapsed = time.monotonic() - start
            partial_size = tmp.stat().st_size if tmp.exists() else 0
            print(f"[netflix] deneme {attempt}/{MAX_ATTEMPTS} başarısız ({elapsed:.1f}s, {partial_size} bayt): {exc}")
            if partial_size > best_bytes:
                best_bytes = partial_size
                shutil.copy(tmp, best_partial)
                _write_partial_meta(meta_path, size=partial_size, expected=expected, last_modified=last_modified)
            time.sleep(min(2**attempt, 30))

    if stale_full is not None:
        print(f"[netflix] UYARI: yenileme başarısız (son hata: {last_error}); eski TAM dosya kullanılıyor: {stale_full}")
        _COZULMUS_DATASET = (stale_full, True)
        return _COZULMUS_DATASET

    if best_partial.exists():
        meta = _read_partial_meta(meta_path)
        surum_notu = ""
        if meta.get("last_modified") and last_modified and meta["last_modified"] != last_modified:
            surum_notu = (
                f" DİKKAT: bu kısmi dosya eski bir sunucu sürümüne ait ({meta['last_modified']}), "
                f"sunucudaki güncel sürüm {last_modified} — kapsadığı ülkelerin son haftaları eksik olabilir."
            )
        print(
            f"[netflix] UYARI: tam indirilemedi (son hata: {last_error}). En uzun kısmi indirme "
            f"({best_bytes} bayt) kullanılacak — sadece bu kısımda TAM olarak bulunan ülkeler işlenebilir.{surum_notu}"
        )
        _COZULMUS_DATASET = (best_partial, False)
        return _COZULMUS_DATASET

    raise RuntimeError(
        f"{FILENAME}, {MAX_ATTEMPTS} denemede de hiç veri indirilemedi. Son hata: {last_error}"
    )


# Netflix başlığındaki sezon/bölüm ekleri — dizi adının ARDINDAN gelebilecek meşru kuyruklar.
_SEZON_EKI = re.compile(
    r"^(?:[:\-–—]?\s*)?(?:season|sezon|series|part|b[oö]l[uü]m|limited\s+series|"
    r"the\s+final\s+season|final\s+season)?\s*\d*\s*$",
    re.IGNORECASE,
)


def _normalize_for_match(text: str) -> str:
    """Eşleştirme için sadeleştirme: noktalama atılır, boşluk tekilleşir, küçük harfe iner.
    Türkçe'ye özgü büyük/küçük harf tuzağı (I/ı) burada devreye girmiyor çünkü karşılaştırma
    iki tarafta da aynı şekilde sadeleştirilmiş metinler arasında yapılıyor."""
    sade = re.sub(r"[^\w\s]", " ", (text or ""), flags=re.UNICODE)
    return re.sub(r"\s+", " ", sade).strip().casefold()


@functools.lru_cache(maxsize=8)
def _normalized_candidates(candidates: tuple[str, ...]) -> tuple[str, ...]:
    """Aday dizi adlarının normalize hâli — ÖLÇÜLEN darboğaz: scan_all_countries 22 MB'lık kısmi
    dosyada ~150 bin TV satırı okuyor ve _matches her satırda 400 adayı yeniden normalize
    ediyordu (~60 milyon regex çağrısı, dakikalar). Aday listesi bir koşu boyunca sabit; bir kez
    normalize edilip tekrar kullanılır. tuple(candidates) satır başına 400 string hash'i — regex'e
    kıyasla ihmal edilebilir."""
    hedefler = [_normalize_for_match(t) for t in candidates if t and t.strip()]
    return tuple(h for h in hedefler if h)


def _matches(show_title: str, season_title: str, candidates: list[str]) -> bool:
    """Netflix başlığı bir aday dizinin KENDİSİ mi?

    CANLI YAKALANAN HATA — bu fonksiyon önce `c in haystack` (alt-dize) kontrolü yapıyordu ve
    kataloğumuzdaki "Anne" adlı gerçek Türk dizisi, Netflix'in "Anne Rice's Mayfair Witches"
    başlığıyla eşleşti. 7 ülkede (AR, BR, CL, CO, IT, MX, NL) tamamen yanlış satır yazıldı:
    bir AMC dizisi, Türk dizisi ihracat verisi olarak kaydedildi.

    Alt-dize araması bu iş için yanlış: dizi adının başlığın İÇİNDE geçmesi yetmez, başlığın
    KENDİSİ olması gerekir. Meşru istisna sezon ekleri ("Kuruluş Osman: Season 4") — onlar da
    adın ARDINDAN gelmeli, ortasında ya da öncesinde değil.
    """
    hedefler = _normalized_candidates(tuple(candidates))
    if not hedefler:
        return False

    for ham in (show_title, f"{show_title} {season_title}"):
        baslik = _normalize_for_match(ham)
        if not baslik:
            continue
        for hedef in hedefler:
            if baslik == hedef:
                return True
            # Ad + sezon eki: "kurulus osman season 4" -> kalan "season 4" meşru kuyruk mu?
            if baslik.startswith(hedef + " "):
                kalan = baslik[len(hedef) :].strip()
                if _SEZON_EKI.match(kalan):
                    return True
    return False


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
            row_value = row.get(field, "")
            if field == "country_name":
                row_value = row_value.casefold()
            if row_value != target:
                continue
            _accumulate_row(accumulator, row, turkish_titles)

    return [NetflixCountrySignal(**v) for v in accumulator.values()]


def _accumulate_row(accumulator: dict[str, dict], row: dict, turkish_titles: list[str]) -> None:
    """Tek bir TSV satırını (zaten ülkeye göre süzülmüş) dizi bazlı toplayıcıya işler: Films
    elenir, başlık kataloğumuzla eşleşmiyorsa atlanır, eşleşiyorsa hafta sayısı / en iyi sıra /
    son hafta güncellenir. get_netflix_country_rankings ve scan_all_countries ortak kullanır."""
    if row.get("category") != RELEVANT_CATEGORY:
        return
    show_title = row.get("show_title", "")
    season_title = row.get("season_title", "") or ""
    if not _matches(show_title, season_title, turkish_titles):
        return

    rank = int(row["weekly_rank"])
    week = row.get("week", "")
    entry = accumulator.get(show_title)
    if entry is None:
        entry = accumulator[show_title] = {
            "show_title": show_title,
            "category": row.get("category"),
            "weeks_in_top10": 0,
            "peak_position": rank,
            "latest_week": week,
            "latest_rank": rank,
        }
    entry["weeks_in_top10"] += 1
    entry["peak_position"] = min(entry["peak_position"], rank)
    if week >= entry["latest_week"]:
        entry["latest_week"] = week
        entry["latest_rank"] = rank


def scan_all_countries(
    path: Path, is_complete: bool, turkish_titles: list[str]
) -> tuple[dict[str, list[NetflixCountrySignal]], set[str], Optional[str]]:
    """TSV'yi TEK geçişte okuyup her ülke için sinyalleri toplar.

    Neden tek geçiş: get_netflix_country_rankings ülke başına dosyanın tamamını (32 MB) yeniden
    okur; ~90 ülke için bu ~3 GB okuma demek. Tüm ülkeleri doldurmak isteyen çağıran
    (netflix_pipeline.sync_all) için bu fonksiyon var.

    Döner: (iso2 -> sinyal listesi, TAM olduğu doğrulanan ülke kümesi, kesilen ülke ya da None).
    Kısmi dosyada dosyanın SON ülkesi 'yarım' sayılır ve sonuçtan çıkarılır — dosya tamsa hiçbir
    ülke çıkarılmaz. Türk dizisi eşleşmesi olmayan ama bloğu tam olan ülkeler `complete`
    kümesinde yer alır, sözlükte yer almaz (çağıran 'no-turkish-shows' diye ayırt edebilir).
    """
    accumulators: dict[str, dict[str, dict]] = {}
    seen_order: list[str] = []
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            iso2 = (row.get("country_iso2") or "").strip().upper()
            if len(iso2) != 2:
                continue  # kesik/bozuk satır (kısmi dosyanın son satırı olabilir)
            if not seen_order or seen_order[-1] != iso2:
                seen_order.append(iso2)
            _accumulate_row(accumulators.setdefault(iso2, {}), row, turkish_titles)

    truncated = None if (is_complete or not seen_order) else seen_order[-1]
    complete = set(seen_order)
    if truncated is not None:
        complete.discard(truncated)

    by_iso2 = {
        iso2: [NetflixCountrySignal(**v) for v in acc.values()]
        for iso2, acc in accumulators.items()
        if iso2 in complete and acc
    }
    return by_iso2, complete, truncated


def get_all_country_rankings(
    turkish_titles: list[str], cache_dir: Path, force_download: bool = False, offline: bool = False
) -> tuple[dict[str, list[NetflixCountrySignal]], set[str], Optional[str], bool]:
    """download_dataset (ya da offline=True ile resolve_local_dataset) + scan_all_countries.
    Son eleman: dosya tam mıydı."""
    if offline:
        path, is_complete = resolve_local_dataset(cache_dir)
    else:
        path, is_complete = download_dataset(cache_dir, force=force_download)
    by_iso2, complete, truncated = scan_all_countries(path, is_complete, turkish_titles)
    return by_iso2, complete, truncated, is_complete


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
