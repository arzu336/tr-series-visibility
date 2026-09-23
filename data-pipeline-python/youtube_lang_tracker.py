"""YouTube Coğrafi Dil Analizcisi — yorum dili dağılımından talep sinyali.

NEDEN BU KAYNAK
---------------
Türk yapımcıları (ATV, Star TV, Kanal D, Madd) tam bölümleri altyazılı olarak RESMÎ YouTube
kanallarında yayınlıyor. Yorumların dil dağılımı, TMDB/JustWatch'ın hiç göremediği pazarlar
için gerçek bir talep göstergesi. Kaynak resmî (YouTube Data API v3, anahtarlı) — bu yüzden
güven sınıfı OFFICIAL'dır, telemetri değil.

ÖLÇÜLEN SINIR — ÖNEMLİ, TASARIMIN MERKEZİNDE
--------------------------------------------
Dil tespiti (fasttext lid.176.ftz) HEDEF DİLLERİN BİR KISMINDA ÇALIŞMIYOR. Gerçek cümlelerle
ölçüldü (2026-09-22):

    Latin alfabesi DIŞI — güvenilir:
        am (Amharca)   -> am  1.00        ur (Urduca)   -> ur  0.99
        fa (Farsça)    -> fa  0.96        ky (Kırgızca) -> ky  0.44
        tg (Tacikçe)   -> tg  0.40        tk (Türkmence)-> tk  0.27

    Latin alfabeli Afrika dilleri — GÜVENİLMEZ:
        so (Somalice)  -> en  0.25   (İngilizce sanıldı)
        ha (Hausa)     -> en  0.12   (İngilizce sanıldı)
        sw (Svahili)   -> eo  0.32   (Esperanto sanıldı)

Yani bu modül Orta Asya ve Güney Asya kör noktalarını AÇAR, Sahra altı Afrika'yı AÇMAZ.
Düşük güven skorları (0,12-0,32) bunu zaten ele veriyor: `MIN_CONFIDENCE` eşiği altındaki
tespitler `None` döner — Somalice bir yorumu "İngilizce" diye saymaktansa "bilinmiyor" saymak
doğrudur. Yanlış sayılan bir dil, sessizce yanlış bir ülkeye talep atfeder.
"""
from __future__ import annotations

import os
import warnings
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "data" / "lid.176.ftz"

YOUTUBE_API = "https://www.googleapis.com/youtube/v3"

# Eşiğin altındaki tespit KULLANILMAZ. Ölçümde yanlış tespitlerin tamamı 0,32'nin altındaydı;
# doğru tespitlerin en düşüğü 0,27 (Türkmence) idi — yani eşik tek başına Latin-Afrika sorununu
# çözmüyor, sadece en kötü vakaları eliyor. Bu yüzden ayrıca GUVENILMEZ_DILLER listesi var.
MIN_CONFIDENCE = 0.35

# Ölçümle güvenilmez bulunan diller. Bu dillerden biri tespit edilse BİLE rapora "kesin" diye
# girmez; `unreliable` bayrağıyla işaretlenir. Liste ölçüme dayanır, tahmine değil — yeni bir
# dil eklenmeden önce gerçek metinle test edilmelidir.
GUVENILMEZ_DILLER = frozenset({"so", "ha", "sw", "yo", "ig", "zu", "xh", "st", "rw", "ny"})

# Latin alfabeli bir metin bu dillerden birine atfedilirse şüphelidir: model bu grubu
# İngilizce/Esperanto ile karıştırıyor.
KARISTIRILAN_HEDEFLER = frozenset({"en", "eo", "ms", "id", "tl"})


@dataclass(frozen=True)
class DetectedLanguage:
    lang: Optional[str]  # None => tespit güvenilir değil, SAYILMAZ
    confidence: float
    unreliable: bool = False  # tespit edildi ama bu dil ölçümde güvenilmez çıkmıştı
    below_threshold: bool = False  # yalnızca keşif modunda True olabilir

    @property
    def trustworthy(self) -> bool:
        """Sayıma güvenle girebilir mi? Tüketen taraf bu tek alana bakar."""
        return self.lang is not None and not self.unreliable and not self.below_threshold


_model = None


def _load_model():
    """fasttext modelini tembel yükler. Model yoksa açık bir hata verir — sessizce
    'dil tespit edilemedi' demek, kapsama kaybını gizlerdi."""
    global _model
    if _model is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"{MODEL_PATH} yok. İndir: "
                "https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.ftz"
            )
        import fasttext

        warnings.filterwarnings("ignore", category=UserWarning)
        _model = fasttext.load_model(str(MODEL_PATH))
    return _model


def detect_language(
    text: str, *, min_confidence: float = MIN_CONFIDENCE, exploratory: bool = False
) -> DetectedLanguage:
    """Tek bir yorumun dili.

    `fasttext`in numpy sarmalayıcısı KULLANILMIYOR: fasttext-wheel `np.array(probs, copy=False)`
    çağırıyor ve NumPy 2.x bunu reddediyor ("Unable to avoid copy"). Alt seviye `model.f.predict`
    aynı sonucu numpy'a hiç dokunmadan veriyor — projedeki NumPy sürümünü düşürmek yerine
    doğru çözüm bu.
    """
    temiz = (text or "").replace("\n", " ").strip()
    if len(temiz) < 12:
        # Çok kısa metinde ("👏", "süper") dil tespiti gürültüdür.
        return DetectedLanguage(lang=None, confidence=0.0)

    model = _load_model()
    sonuclar = model.f.predict(temiz, 1, 0.0, "strict")
    if not sonuclar:
        return DetectedLanguage(lang=None, confidence=0.0)

    skor, etiket = sonuclar[0]
    kod = etiket.replace("__label__", "")
    # KEŞİF MODU: eşik altı tespit de DÖNER, ama `below_threshold` ile işaretlenir ve
    # `unreliable` bayrağını taşır. Karantina listesi SİLİNMEDİ — sayım yapan taraf hangi
    # satırın ölçümle güvenilmez bulunmuş bir dile ait olduğunu görebilsin diye.
    # Gerekçe modül docstring'inde: so->en (0,25), ha->en (0,12), sw->eo (0,32).
    esik_alti = skor < min_confidence
    if esik_alti and not exploratory:
        return DetectedLanguage(lang=None, confidence=skor)
    return DetectedLanguage(
        lang=kod,
        confidence=skor,
        unreliable=kod in GUVENILMEZ_DILLER,
        below_threshold=esik_alti,
    )


def language_distribution(comments: Iterable[str], *, exploratory: bool = False) -> dict:
    """Yorum kümesinin dil dağılımı.

    Tespit edilemeyenler AYRI sayılır ve toplamdan düşülmez: "%40'ı Farsça" demek ile
    "tespit edilebilenlerin %40'ı Farsça" demek farklı şeylerdir ve ikincisi doğrudur.
    """
    sayac: Counter = Counter()
    guvenilmez: Counter = Counter()
    tespit_edilemeyen = 0
    toplam = 0

    for yorum in comments:
        toplam += 1
        sonuc = detect_language(yorum, exploratory=exploratory)
        if sonuc.lang is None:
            tespit_edilemeyen += 1
            continue
        sayac[sonuc.lang] += 1
        if not sonuc.trustworthy:
            guvenilmez[sonuc.lang] += 1

    tespit_edilen = sum(sayac.values())
    return {
        "total_comments": toplam,
        "detected": tespit_edilen,
        "undetected": tespit_edilemeyen,
        # Oran TESPİT EDİLENLER üzerinden — toplam üzerinden verilseydi kapsama kaybı
        # "o dilde ilgi yok" gibi okunurdu.
        "by_language": {
            k: {
                "count": v,
                "share_of_detected": round(v / tespit_edilen * 100, 1) if tespit_edilen else 0.0,
                "unreliable": k in GUVENILMEZ_DILLER,
                # Sayımın kaçı güvenilmez bir tespite dayanıyor — keşif modunda bu sayı
                # sıfırdan büyük olabilir ve tüketen taraf o satırı ayrı ele almalıdır.
                "untrustworthy_count": guvenilmez.get(k, 0),
            }
            for k, v in sayac.most_common()
        },
        "unreliable_detections": dict(guvenilmez),
        "exploratory": exploratory,
    }


# --- YouTube Data API v3 ------------------------------------------------------------------
def fetch_comments(video_id: str, *, api_key: Optional[str] = None, max_pages: int = 5) -> list[str]:
    """Bir videonun üst düzey yorum metinleri.

    Resmî API kullanılıyor (anahtarlı, kotalı) — sayfa kazıma YOK. Yorumlar kapalıysa API 403
    döner; bu bir hata değil, o video için "veri yok"tur ve boş liste dönülür.
    """
    import requests

    key = api_key or os.getenv("YOUTUBE_API_KEY")
    if not key:
        raise RuntimeError("YOUTUBE_API_KEY tanımlı değil (server/.env)")

    yorumlar: list[str] = []
    sayfa_token = None
    for _ in range(max_pages):
        params = {
            "part": "snippet",
            "videoId": video_id,
            "maxResults": 100,
            "textFormat": "plainText",
            "key": key,
        }
        if sayfa_token:
            params["pageToken"] = sayfa_token
        res = requests.get(f"{YOUTUBE_API}/commentThreads", params=params, timeout=30)
        if res.status_code == 403:
            return yorumlar  # yorumlar kapalı ya da kota — uydurma veri üretilmez
        res.raise_for_status()
        data = res.json()
        for item in data.get("items", []):
            metin = item["snippet"]["topLevelComment"]["snippet"].get("textDisplay")
            if metin:
                yorumlar.append(metin)
        sayfa_token = data.get("nextPageToken")
        if not sayfa_token:
            break
    return yorumlar
