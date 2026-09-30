# Kültürel Görünürlük Platformu

Türk dizilerinin ülke bazlı erişilebilirliğini, tema dağılımını, arama ilgisini ve basın algısını tek panelde birleştiren; bunları turizm göstergeleriyle ilişkilendiren bir karar destek uygulaması.

## Ne yapar

- **Harita (3D küre / 2D):** her ülke için milyon internet kullanıcısı başına görünürlük skoru (ham toplam ülke panelindeki kartta görünür). Renkler yüzdelik dilime göre atanır; kaynak ülke (TR), küçük paydalı ülkeler ve tahmin katmanı ölçek dışında ayrı renklerle gösterilir.
- **Ülke paneli:** toplam ve kişi başına skor, dönemsel trend, ülkede en çok ilgi gören diziler (arama payı + Netflix Top 10 + basın algısı + yayın varlığı bileşik skoru), yayındaki dizilerin listesi.
- **Arama ilgisi:** Google Trends tabanlı ülke dağılımı, zaman serisi, çok dizili kıyaslama, sosyal dinleme, basın taraması, IMDb bilgileri.
- **Analist paneli:** LLM'in ürettiği tema/destinasyon etiketlerinin ve basın tonunun insan tarafından denetlenip düzeltilmesi.
- **Etki analizi:** turizm korelasyonu (Pearson + DiD), erken seyahat talebi sinyali, yükselen ülkeler, PDF rapor çıktısı.
- **Kullanıcı yönetimi:** kayıt → yönetici onayı akışı, erişim düzeyleri.

Tüm metrikler ne ölçtüklerini ve ne ölçmediklerini arayüzde belirtir; metinlerin tek kaynağı `src/lib/methodologyNotes.js`.

## Mimari

```
server/                 Express API + SQLite (node:sqlite, WAL)
  app.js                Express uygulaması (helmet, CORS, statik dosyalar, router'lar) — testler dinlemeden kullanır
  index.js              app + zamanlayıcı + listen
  env.js                .env yükleme — ilk import, diğer modüller process.env'i okumadan önce
  routes/
    auth.js             çerez, hız sınırları, giriş/çıkış, /api oturum duvarı, requireAdmin
    admin.js            kullanıcı onay/yetki/şifre işlemleri (yalnızca yönetici)
    data.js             harita verisi, tarih/dönem serileri, benchmark, Türkçe öğrenme göstergeleri
    analyst.js          tema, destinasyon ve basın tonu listeleri + insan düzeltmeleri
    trends.js           arama ilgisi, sosyal dinleme, IMDb, kişi, bileşik ülke sıralaması, iş takibi
    impact.js           etki & ihracat analizi, ülke özeti (yalnızca yönetici)
    report.js           ülke raporu (üç profil, profil bazlı yetki; veri: services/countryReport.js)
    shared.js           ortak hata sarmalayıcıları (upstream, badRequest)
  data-pipeline.js      TMDB çekme + arka plan LLM sınıflandırma
  aggregate.js          ülke skoru ve kişi başına normalizasyon
  scheduler.js          zamanlanmış işler (günlük tazeleme + haftalık zincir)
  trend-store.js        anlık görüntü/trend deposu fabrikası (history, benchmark, duolingo)
  impact.js             DiD / korelasyon motoru
  llm.js, themes.js     LLM sınıflandırma, retry/backoff
  auth.js, users.js     oturum (SHA-256 token), kullanıcı hesapları
  services/             dış kaynak istemcileri (serpApiCache, gdeltNews, tourismData, …),
                        kota/önbellek (liveCallQuota), bileşik skor (countryScoringEngine),
                        ülke özeti (countrySummary), iş kaydı (jobs), haftalık Netflix senkronu
                        (netflixPipelineRunner), Python köprüsü (pipelineDb, pipelineData)
src/                    React + Vite arayüzü
  components/           harita (Map2D, Globe3D), paneller, analist/etki/yönetici sekmeleri, ErrorBoundary
  lib/                  api.js (fetch sarmalayıcıları), scale.js (renk ölçeği), methodologyNotes.js;
                        hook'lar: useAsync (iptal edilebilir veri çekme), useAuth (oturum),
                        useDialog (modal erişilebilirliği), useOverrideEditor (analist düzeltme
                        akışı), usePersistedState (localStorage tercihleri)
  data/                 ülke merkezleri, kıta eşlemesi, Türkçe adlar
data-pipeline-python/   ayrı zenginleştirme hattı; kendi SQLite'ına yazar, Node salt okunur okur
public/map/             küre dokuları ve ülke sınırları (dış istek yok)
.github/workflows/      CI: Node (vitest + build) ve Python (pytest)
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

Python hattı için (sürümler `pyproject.toml` ile pin'li):

```bash
cd data-pipeline-python
pip install -r requirements.txt     # ya da: pip install -e .[dev]
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
- Süreç, yakalanmamış bir istisnada günlüğe yazıp çıkar; üretimde bir denetleyici (systemd, pm2, Windows servisi) altında çalıştırın ki otomatik yeniden başlasın.
- LLM sunucusu özel bir CA ile imzalıysa zinciri depoya değil `LLM_CA_PATH` ile gösterilen dosyaya koyun.

## Zamanlanmış işler

`server/scheduler.js` 30 dakikada bir tetiklenir:

- **Günlük:** TMDB tazeleme, LLM sınıflandırma, trend anlık görüntüsü, aylık özetler, süresi geçmiş oturum/önbellek temizliği.
- **Haftalık:** turizm bülteni, basın taraması (GDELT), öncü turizm sinyali, Netflix Top 10 senkronizasyonu (`netflix_pipeline.py --all` alt süreç olarak; `PYTHON_BIN` ile yorumlayıcı seçilebilir).
- **Varsayılan kapalı:** sosyal zenginleştirme ve oyuncu trendleri (`ENABLE_SOCIAL_ENRICHMENT`, `ENABLE_ACTOR_TRENDS`).

Tüm SerpAPI çağrıları tek bir aylık bütçe sayacından geçer (`SERPAPI_MONTHLY_BUDGET`); bütçe dolunca haftalık işler durur, önbellek bayat olarak sunulur. Hiçbir işin başarısızlığı diğerlerini veya sunucuyu durdurmaz.

## Python hattı

`data-pipeline-python/` Node'dan bağımsızdır; `data/pipeline.db` dosyasına yazar. Node bu dosyayı salt okunur açar; Python ise `app.db`'yi yalnızca okur — tek istisna `backfill_reytingtv.py`'nin `series_popularity_monthly` tablosuna `source='reytingtv_rank'` ile yazmasıdır (bkz. `db.py` docstring). Operasyonel betikler `logging` kullanır; seviye `PIPELINE_LOG_LEVEL` (varsayılan `INFO`).

```bash
python netflix_pipeline.py --all          # tüm ülkeler, tek geçiş
python netflix_pipeline.py --all --offline # ağa çıkmadan diskteki dosyayla
python netflix_pipeline.py TR ES PL       # seçili ülkeler
python backfill_reytingtv.py              # Türkiye günlük reyting sırası
python batch_run.py                       # dizilah / IMDb zenginleştirme
```

Netflix'in kaynak dosyası (~32 MB) sunucu tarafında kesintiye uğrayabilir; indirici yeniden dener, kaldığı yerden devam etmeyi destekler ve tam inmezse yalnızca bloğu tam olan ülkeleri yazar. Netflix başlıkları İngilizce yayın adıyla gelir; eşleştirme IMDb takma adları ve `NETFLIX_RELEASE_TITLES` listesiyle genişletilir. Ayrıntılar modül docstring'lerinde.

Dosya yerel ağdan tam inmiyorsa `.github/workflows/netflix-sync.yml` (elle tetiklenebilir, haftalık) dosyayı GitHub koşucusundan indirir, tamlığını doğrular ve artifact olarak yükler; kısmi dosyada iş kırmızı olur. Yerelde almak için:

```bash
gh run download <run-id> -n netflix-all-weeks-countries -D data-pipeline-python/data
python netflix_import_artifact.py        # doğrular, kısmi kalıntıları siler, --all --offline koşar
```

## Bilinen sınırlar

- Görünürlük skoru erişilebilirliği ölçer, fiili izlenmeyi değil; dil için normalize edilmemiştir.
- Google Trends değerleri sorgu başına görelidir; farklı sorgular veya ülkeler arasında mutlak karşılaştırma yapılamaz.
- Turizm korelasyonu tek bir önce/sonra çiftine dayanır; nedensellik iddiası taşımaz.
- Parasal ihracat/lisans verisi yoktur; "pazar payı" TMDB popülerlik payıdır.
- Okuyucu ve Analist erişim düzeyleri şu an operasyonel olarak özdeştir; yetki ayrımı yalnızca yönetici/yönetici-değil şeklindedir.
- Netflix dışındaki Python işleri elle çalıştırılır.

## Lisans / veri kullanımı

Dış kaynakların kullanım koşulları kendi sağlayıcılarına tabidir; Netflix Tudum verisi `robots.txt` ile izin verilen kamuya açık dosyadan alınır, bot atlatma yapılmaz.
