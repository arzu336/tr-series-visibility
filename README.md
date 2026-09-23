# Kültürel Görünürlük Platformu

Türk dizilerinin ülke bazlı erişilebilirliğini, tema dağılımını, arama ilgisini ve basın algısını tek panelde birleştiren; bunları turizm göstergeleriyle ilişkilendiren bir karar destek uygulaması.

## Ne yapar

- **Harita (3D küre / 2D):** her ülke için görünürlük skoru — varsayılan metrik milyon internet kullanıcısı başına, alternatif olarak ham toplam. Renkler yüzdelik dilime göre atanır; kaynak ülke (TR), küçük paydalı ülkeler ve tahmin katmanı ölçek dışında ayrı renklerle gösterilir.
- **Ülke paneli:** toplam ve kişi başına skor, dönemsel trend, ülkede en çok ilgi gören diziler (arama payı + Netflix Top 10 + basın algısı + yayın varlığı bileşik skoru), yayındaki dizilerin listesi.
- **Arama ilgisi:** Google Trends tabanlı ülke dağılımı, zaman serisi, çok dizili kıyaslama, sosyal dinleme, basın taraması, IMDb bilgileri.
- **Analist paneli:** LLM'in ürettiği tema/destinasyon etiketlerinin ve basın tonunun insan tarafından denetlenip düzeltilmesi.
- **Etki analizi:** turizm korelasyonu (Pearson + DiD), erken seyahat talebi sinyali, yükselen ülkeler, PDF rapor çıktısı.
- **Kullanıcı yönetimi:** kayıt → yönetici onayı akışı, erişim düzeyleri.

Tüm metrikler ne ölçtüklerini ve ne ölçmediklerini arayüzde belirtir; metinlerin tek kaynağı `src/lib/methodologyNotes.js`.

## Mimari

```
server/                 Express API + SQLite (node:sqlite, WAL)
  index.js              route'lar, oturum/yetki, güvenlik middleware'leri
  data-pipeline.js      TMDB çekme + zenginleştirme
  aggregate.js          ülke skoru ve kişi başına normalizasyon
  scheduler.js          zamanlanmış işler (günlük tazeleme + haftalık zincir)
  impact.js             DiD / korelasyon motoru
  llm.js, themes.js     LLM sınıflandırma, retry/backoff
  services/             dış kaynak istemcileri, önbellek/bütçe, bileşik skor, Python köprüsü
src/                    React + Vite arayüzü (components/, lib/, data/)
data-pipeline-python/   ayrı zenginleştirme hattı; kendi SQLite'ına yazar, Node salt okunur okur
public/map/             küre dokuları ve ülke sınırları (dış istek yok)
```

## Veri kaynakları

| Kaynak | Veri | Maliyet |
|---|---|---|
| TMDB | dizi metadata, popülerlik, yayın ülkesi/platformu | ücretsiz |
| SerpAPI (Google Trends / Google / YouTube) | arama ilgisi, bilgi grafiği, tanıtım videosu | ücretli, aylık kotalı |
| GDELT DOC 2.0 | basın taraması | ücretsiz, anahtarsız |
| OMDb | IMDb puanı, oy sayısı | ücretsiz |
| World Bank | nüfus, internet penetrasyonu, GSYH, bölge | ücretsiz |
| YİGM sınır istatistikleri | milliyet bazlı turist girişi | ücretsiz |
| Netflix Tudum, reytingtv, dizilah, IMDb veri setleri | Python hattı üzerinden | ücretsiz |
| Dahili LLM sunucusu (OpenAI API uyumlu) | tema/destinasyon sınıflandırma, duygu analizi | kurumsal |

## Kurulum

Gereksinimler: Node.js ≥ 22.13 (`.nvmrc` mevcut), Python ≥ 3.12 (yalnızca Python hattı için).

```bash
nvm use
npm install
cp server/.env.example server/.env   # değerleri doldurun
```

Zorunlu anahtarlar: `TMDB_API_KEY`, `SERPAPI_API_KEY`, `OMDB_API_KEY`, `APP_PASSWORD`, `ADMIN_EMAIL`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. Diğer ayarlar ve açıklamaları `server/.env.example` içinde.

Python hattı için:

```bash
cd data-pipeline-python
pip install -r requirements.txt
```

## Çalıştırma

```bash
npm run dev        # Vite (5173) + Express (3001) birlikte
npm run build      # üretim derlemesi
npm start          # /api ve derlenmiş arayüz tek sunucudan
npm test           # vitest
```

Python hattı testleri: `cd data-pipeline-python && python -m pytest`.

### Dağıtım

- Ters proxy arkasındaysanız `TRUST_PROXY=true` verin; aksi halde kapalı bırakın (hız sınırları gerçek IP ile çalışır).
- Oturum çerezinin `Secure` bayrağı isteğin protokolünden türetilir; düz HTTP üzerinden kurum içi kurulum çalışır.
- `APP_ORIGIN` üretimde izin verilen tek tarayıcı origin'idir (CORS).

## Zamanlanmış işler

`server/scheduler.js` 30 dakikada bir tetiklenir:

- **Günlük:** TMDB tazeleme, LLM sınıflandırma, trend anlık görüntüsü, aylık özetler, süresi geçmiş oturum/önbellek temizliği.
- **Haftalık:** turizm bülteni, basın taraması (GDELT), öncü turizm sinyali, Netflix Top 10 senkronizasyonu (`netflix_pipeline.py --all` alt süreç olarak; `PYTHON_BIN` ile yorumlayıcı seçilebilir).
- **Varsayılan kapalı:** sosyal zenginleştirme ve oyuncu trendleri (`ENABLE_SOCIAL_ENRICHMENT`, `ENABLE_ACTOR_TRENDS`).

Tüm SerpAPI çağrıları tek bir aylık bütçe sayacından geçer (`SERPAPI_MONTHLY_BUDGET`); bütçe dolunca haftalık işler durur, önbellek bayat olarak sunulur. Hiçbir işin başarısızlığı diğerlerini veya sunucuyu durdurmaz.

## Python hattı

`data-pipeline-python/` Node'dan bağımsızdır; `data/pipeline.db` dosyasına yazar.

```bash
python netflix_pipeline.py --all          # tüm ülkeler, tek geçiş
python netflix_pipeline.py --all --offline # ağa çıkmadan diskteki dosyayla
python netflix_pipeline.py TR ES PL       # seçili ülkeler
python backfill_reytingtv.py              # Türkiye günlük reyting sırası
python batch_run.py                       # dizilah / IMDb zenginleştirme
```

Netflix'in kaynak dosyası (~32 MB) sunucu tarafında kesintiye uğrayabilir; indirici yeniden dener, kaldığı yerden devam etmeyi destekler ve tam inmezse yalnızca bloğu tam olan ülkeleri yazar. Netflix başlıkları İngilizce yayın adıyla gelir; eşleştirme IMDb takma adları ve `NETFLIX_RELEASE_TITLES` listesiyle genişletilir. Ayrıntılar modül docstring'lerinde.

## Bilinen sınırlar

- Görünürlük skoru erişilebilirliği ölçer, fiili izlenmeyi değil; dil için normalize edilmemiştir.
- Google Trends değerleri sorgu başına görelidir; farklı sorgular veya ülkeler arasında mutlak karşılaştırma yapılamaz.
- Turizm korelasyonu tek bir önce/sonra çiftine dayanır; nedensellik iddiası taşımaz.
- Parasal ihracat/lisans verisi yoktur; "pazar payı" TMDB popülerlik payıdır.
- Okuyucu ve Analist erişim düzeyleri şu an operasyonel olarak özdeştir; yetki ayrımı yalnızca yönetici/yönetici-değil şeklindedir.
- Netflix dışındaki Python işleri elle çalıştırılır.

## Lisans / veri kullanımı

Dış kaynakların kullanım koşulları kendi sağlayıcılarına tabidir; Netflix Tudum verisi `robots.txt` ile izin verilen kamuya açık dosyadan alınır, bot atlatma yapılmaz.
