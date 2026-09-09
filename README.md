# Kültürel Görünürlük Platformu

T.C. Cumhurbaşkanlığı İletişim Başkanlığı için: Türk dizilerinin küresel erişimini, tema dağılımını ve turizm/ihracat etkisini tek bir panelde birleştiren karar destek platformu. `docs/Proje_Raporu_v5.docx`'te tanımlanan "Kültürel Görünürlük ve Etki Platformu" önerisinin çalışan bir uygulaması.

## Genel Bakış

Sistem üç katmanlı bir veri modeline dayanır (bkz. proje raporu §4.1):

1. **Popülerlik / Erişim** — TMDB üzerinden hangi dizi hangi ülkede yayında (ilk 400 Türk dizisi)
2. **İçerik / Tema** — dizi özetlerinin LLM ile sınıflandırılması (aile, kadın hakları, göç, adalet, aşk, suç örgütü, tarih, diğer)
3. **Coğrafi / Zamansal** — ülke bazlı görünürlük skorunun zaman içindeki trendi

Bunların üzerine bir **etki katmanı** (turizm/ihracat analizi, DiD kontrol ülke eşleştirmesi, basın duygu analizi) eklenmiştir.

> **Skorun ne olduğu (ve ne olmadığı):** haritadaki görünürlük skoru, bir dizinin o ülkede
> abonelik/ücretsiz olarak **erişilebilir olması** ile TMDB'nin **küresel** popülerlik sayısının
> birleşiminden toplanır. Yani erişilebilirliği ölçer, gerçek izlenmeyi değil; nüfus/internet
> penetrasyonu normalizasyonu içermez. Arayüzdeki türev metrikler (arama ilgisi, hibrit skor,
> bileşik ülke sıralaması) kendi sınırlarını yerinde etiketler.

## Mimari

```
gorunurluk-platformu/
├── server/           Express API + SQLite (node:sqlite, WAL modu)
│   ├── index.js          route tanımları, oturum/yetki + güvenlik middleware'leri
│   ├── data-pipeline.js  TMDB çekme + zenginleştirme (route'lar ve scheduler ortak kullanır)
│   ├── scheduler.js      kod-içi zamanlayıcı (n8n'in kod karşılığı, bkz. aşağı)
│   ├── db.js             şema + migrasyonlar (veri klasörünü kendisi oluşturur)
│   ├── tmdb.js / serpapi.js / social-listening.js / imdb.js   dış veri kaynakları
│   ├── llm.js / themes.js       LLM tema sınıflandırma + retry/backoff
│   ├── destinations.js          sinopsis tabanlı destinasyon (turizm bölgesi) tespiti
│   ├── aggregate.js             ülke bazlı görünürlük skoru hesaplama
│   ├── history.js               trend takibi (anlık görüntü tabanlı)
│   ├── impact.js                DiD / Pearson korelasyon istatistik motoru
│   ├── control-matching.js      World Bank verisiyle DiD kontrol ülke önerisi
│   ├── duolingo.js / turkish-learning-interest.js   Türkçe öğrenme ilgisi göstergeleri
│   ├── cache.js                 SQLite tabanlı genel amaçlı cache (TTL'li)
│   ├── auth.js / users.js       oturum + kullanıcı onay akışı
│   └── services/
│       ├── serpApiCache.js         tüm SerpAPI çağrılarının tek geçiş noktası + aylık bütçe sayacı
│       ├── gdeltNews.js           GDELT DOC 2.0 haber istemcisi (ücretsiz, hız kuyruklu)
│       ├── newsSentiment.js        GDELT + LLM basın duygu analizi (media_sentiment tablosu)
│       ├── tourismData.js          YİGM sınır istatistikleri bülteninin (.xls) otomatik alınması
│       ├── tourismCorrelation.js   turizm korelasyonu (Pearson + DiD) ve öncü sinyal
│       ├── trendsShareOfSearch.js  çok terimli Google Trends karşılaştırmaları
│       ├── countryScoringEngine.js bileşik ülke skoru (arama payı + Netflix + duygu + erişim)
│       └── pipelineDb.js / pipelineData.js   Python pipeline veritabanına salt-okunur köprü
├── src/
│   ├── components/    React bileşenleri (bkz. Özellikler)
│   ├── lib/           api.js (fetch sarmalayıcıları), trend.js, highlightKeywords.js
│   └── data/          ülke merkez koordinatları + Türkçe isimler
├── data-pipeline-python/   ayrı, ELLE çalıştırılan zenginleştirme hattı (bkz. aşağı)
└── docs/              Proje_Raporu_v5.docx, Bütçe Değerlendirme Raporu
```

## Özellikler

### Harita (3D Glob / 2D Harita)
- `globe.gl` + `three.js` ile ülke bazlı görünürlük skoru ısı haritası; `d3-geo` ile 2D koroplet alternatifi (görünüm seçimi kalıcı). Globe3D `React.lazy` ile ayrı bir chunk'ta, yalnızca 3D seçilince yüklenir.
- Bir ülkeye tıklayınca **tüm detaylar sağ çekmecede** açılır: dönemsel görünürlük grafiği, bölgesel arama ilgisi dağılımı, "Ülkede En Çok İlgi Gören İlk 5 Dizi" ve yayındaki dizilerin sıralı listesi. Harita üzerinde ayrıca bir bilgi kartı gösterilmez (mobilde haritayı kapatıyordu).
- Sol kenar çubuğunda kıtasal filtre ve özet kartları; her iki çekmece de açılıp kapanabilir (dar ekranda varsayılan kapalı).

### Analist Paneli (yalnızca yönetici düzenleyebilir)
- **Tema Sınıflandırma**: LLM'in ürettiği tema + güven skoru; %70 altındaki tahminler "İncelenmesi Gerekenler" olarak insan denetimine düşer (human-in-the-loop, §5.2). Toplu onay ve **toplu tema değiştirme + onaylama** desteklenir.
- **Yer Etiketleme**: sinopsiste geçen yer adlarından otomatik turizm bölgesi tespiti + chip tabanlı manuel düzeltme.
- **Basın & Medya Algısı**: taranmış dizi/ülke haber gruplarının LLM tonunu (Olumlu/Nötr/Olumsuz) listeler; analist tonu tek tıkla düzeltebilir. Düzeltme ayrı sütunlarda tutulur, otomatik yeniden tarama insan kararını ezmez.
- Özet metinlerinde atanan tema/destinasyonla ilişkili anahtar kelimeler vurgulanır; "İnsan" kaynaklı satırlarda kimin ne zaman düzelttiği bilgi ikonunda görünür.

### Arama İlgisi
- Google Trends (SerpAPI) — dizi bazlı ülke dağılımı, 12 aylık zaman serisi, çok dizili karşılaştırma
- Kıyaslama Modu — arama payı, IMDb puanı ve **ülke içi ilgi payı** (Google Trends karşılaştırmalı verisi; her ülkenin satırı %100'e tamamlanır, ülkeler arası mutlak hacim karşılaştırması yapılmaz)
- Sosyal Dinleme — Google Bilgi Grafiği puanları + YouTube tanıtım videosu (SerpAPI)
- Basın taraması — GDELT DOC 2.0 (ücretsiz, anahtarsız); makale başlığı + yayının alan adı
- IMDb (OMDb API üzerinden) — puan, oy sayısı, ana karakterler
- Hepsi talep üzerine sorgulanır ve önbelleklenir (SerpAPI aylık kotasını korumak için)

### Etki & İhracat Analizi
- Donut grafiklerle görünürlük skoruna göre en öndeki ülkeler ve en çok görünürlük kazanan destinasyonlar
- **PDF Olarak Yazdır**: üç etki sekmesini de (Kültürel / Turizm / İhracat) alt alta, baskıya özel açık temayla ve rapor başlığı + tarihle basar. Veriler yüklenene kadar bekler, sonra yazdırır.
- **Erken Seyahat Talep Sinyali**: bir dizinin ülke bazlı arama ilgisi ile aynı ülkeden gelen seyahat aramalarının 16 hafta gecikmeli korelasyonu. Her sinyal örneklem büyüklüğüne göre bir anlamlılık eşiğiyle (|r| ≥ ~0,33, n=36) karşılaştırılır; eşiği geçmeyenler "zayıf" olarak işaretlenir ve hiç anlamlı sinyal yoksa öne çıkarılan bir değer gösterilmez. Korelasyon nedensellik değildir.
- **Yükselen Ülkeler**: trend geçmişine dayalı gerçek yükseliş tespiti (uydurma yön göstermez) + otomatik önerilen DiD kontrol ülkesi
- **Turizm Korelasyonu**: YİGM sınır istatistikleri bülteni otomatik indirilip `tourist_arrivals` tablosuna yazılır; Pearson + %95 güven aralığı + DiD hesaplanır. **Sınır:** elde yalnızca en son bültenin aynı ayı × 3 yıl verisi olduğu için tek bir önce/sonra çifti kullanılır, paralel-trend kontrolü yoktur — sonuçlar nedensellik değil, işaret niteliğindedir.
- **İhracat**: TMDB popülerlik payına dayalı kıyaslama; parasal ihracat/lisans verisi henüz yoktur.
- PDF olarak yazdırma — üç etki sekmesi de alt alta basılır (bkz. yukarıdaki "PDF Olarak Yazdır")

### Kullanıcılar (yalnızca yönetici)
- Kayıt olan hesaplar yönetici onayına kadar "pending" kalır; onay / red
- Erişim düzeyi (Okuyucu / Analist / Yönetici), şifre sıfırlama (geçici şifre üretimi), hesap silme
- Kendi yetkini kaldırma ve son yöneticiyi düşürme/silme sunucu tarafında engellenir

> **Erişim düzeyleri hakkında (bilinen sınır).** Bu sürümde **Okuyucu (`viewer`) ve Analist
> (`analyst`) düzeyleri operasyonel olarak ÖZDEŞTİR**: sunucu yetkilendirmesi tek bir ayrımı
> uygular — yönetici mi, değil mi. Veri kürasyonunu değiştiren tüm uçlar (tema/destinasyon/medya
> duygu geçersiz kılma, kullanıcı yönetimi) doğrudan **Yönetici** yetkisi ister; Okuyucu ve Analist
> aynı okuma yetkisine sahiptir. İki düzey arasındaki fark şu an yalnızca etikettir ve ileride
> gerçek bir ayrım tanımlanana kadar öyle kalacaktır. Ücretli dış çağrılar bu düzeylerle değil,
> kullanıcı başına günlük kotayla sınırlanır (`SERPAPI_USER_DAILY_LIMIT`).

## Veri Kaynakları

| Kaynak | Sağladığı veri | Durum | Maliyet |
|---|---|---|---|
| TMDB API | Dizi metadata, popülerlik, yayın ülkesi/platformu (JustWatch ortaklığından) | Kullanımda | Ücretsiz |
| SerpAPI (Google Trends) | Ülke bazlı arama ilgisi, zaman serisi, çok terimli karşılaştırma | Kullanımda | Ücretli (aylık kotalı) |
| SerpAPI (Google / YouTube) | Bilgi Grafiği, tanıtım videosu | Kullanımda | Ücretli (aynı kota) |
| GDELT DOC 2.0 | Basın taraması (başlık, alan adı, kaynak ülke) | Kullanımda | **Ücretsiz, anahtarsız** |
| OMDb API (IMDb verisi) | Puan, oy sayısı, ana karakterler | Kullanımda | Ücretsiz (düşük hacim) |
| Dahili LLM sunucusu | Tema/destinasyon sınıflandırma, basın duygu analizi, kısa yorumlar | Kullanımda | Kurumsal, ücretsiz |
| World Bank Açık Veri API | GSYH (kişi başı), bölge, gelir grubu — DiD kontrol ülke eşleştirmesi | Kullanımda | Ücretsiz, anahtarsız |
| YİGM Sınır İstatistikleri Bülteni | Milliyet bazlı turist girişi (.xls, aylık) | Kullanımda | Ücretsiz |
| Duolingo kurs listesi | Türkçe öğrenen toplam kullanıcı (yalnızca küresel toplam) | Kullanımda | Ücretsiz, anahtarsız |
| Netflix Tudum / reytingtv / dizilah / IMDb veri setleri | Python hattı üzerinden (aşağı bkz.) | Kısmen | Ücretsiz |
| Parrot Analytics | Talep (demand) skoru | Planlı | Ücretli |
| FlixPatrol | Platform bazlı günlük TOP 10 | Planlı | Ücretli (düşük) |
| TÜİK / TCMB EVDS | Çeyreklik turizm, hizmet ihracatı serileri | Planlı | Ücretsiz, entegre edilmedi |

## Python Zenginleştirme Hattı (`data-pipeline-python/`)

Node uygulamasından **ayrı**, elle çalıştırılan bir hat. Kendi SQLite veritabanına (`data/pipeline.db`) yazar; Node bu dosyayı **salt okunur** açar (`services/pipelineDb.js`).

- `netflix_pipeline.py` / `netflix_country_ranker.py` — Netflix Tudum haftalık ülke Top-10'ları
- `reytingtv_ranker.py` / `backfill_reytingtv.py` — Türkiye günlük reyting **sırası** (reyting yüzdesi değil)
- `dizilah_scraper.py`, `imdb_dataset.py`, `batch_run.py` — kanal/durum/bölüm sayısı, IMDb puanı ve yerelleştirilmiş başlıklar

Node'un okuduğu tablolar: `series_mapping`, `dizilah_series`, `imdb_series`, `imdb_localized_titles`, `netflix_country_rankings`. `backfill_reytingtv.py` istisnai olarak Node'un `app.db`'sindeki `series_popularity_monthly` tablosuna da yazar (her iki taraf da `busy_timeout` kullanır).

**Bilinen sınırlar:** hiçbir Python işi zamanlanmış değildir (elle çalıştırılır, veri sessizce eskir); Netflix TSV indirmesi kırılgandır; `country_score_engine.py`'nin ürettiği tabloyu Node okumaz. Betikleri `PYTHONUTF8=1` ile çalıştırın.

## Otomasyon ve Güvenilirlik

- **Cache stratejisi**: Ham TMDB verisi 24 saat (`cache.js`); SerpAPI Trends 7 gün, zaman serisi/sosyal 30 gün, Türkçe öğrenim ilgisi 30 gün, basın duygu 14 gün; OMDb 30 gün. Başarısız çağrılar "başarı" olarak önbelleklenmez. GDELT haber yanıtları ayrı bir ad alanında (`gdelt:news:*`) tutulur ve `media_sentiment.source` sütunu satırın hangi sağlayıcıdan geldiğini kaydeder — sağlayıcı değişince eski satırlar tazelenir, karışmaz.
- **SerpAPI bütçe koruması**: tüm çağrılar `services/serpApiCache.js` üzerinden geçer; `meta` tablosunda atomik aylık sayaç tutulur (`SERPAPI_MONTHLY_BUDGET`, varsayılan 5000). Bütçe dolduğunda haftalık işler durur ve süresi geçmiş önbellek "stale" olarak sunulur.
- **Zamanlanmış tazeleme** (`scheduler.js`): proje raporu §4.7'deki n8n otomasyonunun kod-içi karşılığı.
  - *Günlük*: TMDB + LLM sınıflandırma + trend anlık görüntüsü, aylık özet toplama, YİGM turizm senkronizasyonu (kendi haftalık kapısıyla).
  - *Haftalık, SerpAPI bütçesine tabi*: öncü turizm sinyali, yerelleştirilmiş sosyal zenginleştirme, oyuncu trendleri — her biri kendi 7 günlük kapısını kontrol eder ve saatlere yayılır.
  - *Kapalı (varsayılan)*: sosyal zenginleştirme ve oyuncu trend taraması. Denetim C.3 — bu iki haftalık tarama ücretli çağrı yapıyor ama sonucu arayüzde hiçbir yerde gösterilmiyordu; `ENABLE_SOCIAL_ENRICHMENT` / `ENABLE_ACTOR_TRENDS` ile açılabilir. Sosyal taramanın **anlık** tetikleyicisi (Arama İlgisi sekmesindeki buton) bu bayraktan bağımsız, her zaman çalışır.
  - *Haftalık, ücretsiz*: basın taraması (GDELT). SerpAPI kotasından bağımsızdır. **Sınır:** GDELT'in genel ucu agresif hız sınırlıdır (belgesi 5 sn/istek der, pratikte daha katı) ve TLS el sıkışması ~10 sn sürebilir; istemci 20 sn'lik global bir kuyruk ve geri çekilmeli yeniden deneme uygular, bu yüzden soğuk bir tam tarama saatler sürebilir. Ayrıca GDELT makale ÖZETİ döndürmez — duygu analizi başlık + alan adı üzerinden çalışır, bu bilinçli bir kalite takasıdır.
- **LLM dayanıklılığı** (`llm.js`, `themes.js`): zaman aşımı + 429/5xx için üstel geri çekilmeli yeniden deneme; kalıcı başarısızlıklar `classification_failures` tablosunda geri çekilme süresiyle işaretlenir. En fazla 5 eşzamanlı istek.
- **Metodoloji şeffaflığı**: harita lejandı, kıta/ülke skorları ve etki paneli metriklerinin tamamı, ne ölçtüklerini ve ne ÖLÇMEDİKLERİNİ söyleyen bilgi ipuçları taşır (tek kaynak: `src/lib/methodologyNotes.js`). Görünürlük skoru fiili izlenmeyi değil, yayında olan yapımların küresel katalog popülerliğini yansıtır; nüfus/dil için normalize edilmemiştir.
- **Veri bütünlüğü**: toplu yazımlar (ülke/dizi anlık görüntüleri, aylık rollup, turizm bülteni) tek transaction içinde atomiktir; süresi geçmiş `cache_entries` ve `sessions` satırları zamanlanmış işte temizlenir.
- **Güvenlik**: scrypt + rastgele tuz ile şifreleme, `HttpOnly; SameSite=Lax` oturum çerezi (HTTPS'te `Secure`), tüm SQL parametreli, `/api` altında oturum zorunlu, yönetici uçlarında ikinci sunucu-taraflı kontrol, giriş/kayıt/genel için ayrı hız sınırları, `TRUST_PROXY` ile açıkça beyan edilen ters proxy desteği (varsayılan kapalı), CORS allowlist ve `helmet` güvenlik başlıkları. CSP `'self'` temellidir; çalışma zamanında izinli TEK dış kaynak `image.tmdb.org` (dizi afişleri) — küre dokuları ve ülke sınırı GeoJSON'u depoya alındığı için (`public/map/`) dışarıya çıkmaz.

## Bilinen Sınırlamalar

- Görünürlük skoru erişilebilirlik tabanlıdır; nüfus/internet/dil normalizasyonu yoktur (bkz. yukarıdaki not).
- Google Trends değerleri sorgu başına 0-100 **göreli**dir; farklı sorguların değerleri birebir karşılaştırılamaz.
- Turizm korelasyonu tek bir önce/sonra çiftine dayanır; paralel-trend kontrolü ve gecikme analizi yoktur.
- Parasal ihracat/lisans verisi hiç yoktur; "pazar payı" TMDB popülerlik payıdır.
- Oyuncu trend taraması ve yerelleştirilmiş sosyal zenginleştirme varsayılan olarak **kapalıdır** (`ENABLE_ACTOR_TRENDS` / `ENABLE_SOCIAL_ENRICHMENT`): topladıkları veri arayüzde hiçbir yerde gösterilmiyordu, boşa kota harcamamak için durduruldu. Öncü turizm sinyali ise artık Turizm sekmesinde gösteriliyor.
- Ülke koordinat/isim listesi 157 ülkeyi kapsar; listede olmayan ülkeler haritada adlandırılamaz.
- Globe3D bundle'ı büyük (~1.9 MB) ama `React.lazy` ile ayrı chunk'ta, yalnızca talep üzerine yüklenir.

## Kurulum

**Gereksinim:** Node.js ≥ 22.13 (`node:sqlite` bayraksız bu sürümden itibaren gelir; depoda `.nvmrc` mevcuttur).

```bash
nvm use          # .nvmrc → 22.13
npm install
```

`server/.env` dosyasını oluşturup (`server/.env.example`'ı temel alarak) doldurun:

```bash
TMDB_API_KEY=...              # themoviedb.org
SERPAPI_API_KEY=...           # serpapi.com
OMDB_API_KEY=...              # omdbapi.com/apikey.aspx (ücretsiz)
PORT=3001
APP_PASSWORD=...              # ilk yönetici hesabının şifresi
ADMIN_EMAIL=...               # ilk yönetici hesabının e-postası
SERPAPI_MONTHLY_BUDGET=5000   # aylık SerpAPI çağrı bütçesi
APP_ORIGIN=https://...        # üretimde izin verilen tek tarayıcı origin'i (CORS)
NODE_ENV=production           # üretimde: Secure çerez + Express üretim modu

# Dahili LLM sunucusu (kurumsal, OpenAI API uyumlu)
LLM_BASE_URL=...
LLM_API_KEY=...
LLM_MODEL=...
```

## Çalıştırma (geliştirme)

```bash
npm run dev
```

Vite dev sunucusu (frontend, http://localhost:5173) ve Express API sunucusu (http://localhost:3001) aynı anda başlar.

## Prod build

```bash
npm run build
NODE_ENV=production npm start
```

`npm start` hem `/api/*` uçlarını hem de build edilmiş frontend'i tek sunucudan (`server/index.js`) servis eder.

### Dağıtım topolojisi (önemli)

İki ayar dağıtım şekline göre verilmelidir; ikisi de **varsayılan olarak güvenli tarafta** durur:

| Ayar | Ne zaman | Neden |
|:--|:--|:--|
| `TRUST_PROXY` | Yalnızca ters proxy (nginx / IIS / Traefik) **arkasındaysanız** `true` (ya da hop sayısı, ör. `2`) | Kapalıyken hız sınırları isteğin gerçek IP'siyle çalışır. Proxy yokken açılırsa istemci sahte `X-Forwarded-For` gönderip giriş/kayıt/genel sınırların üçünü de sürekli sıfırlayabilir. |
| — | Çerezin `Secure` bayrağı **ayar gerektirmez** | İsteğin kendi protokolünden türetilir (`req.secure` veya `X-Forwarded-Proto`). Böylece HTTPS'te `Secure` eklenir, **düz HTTP üzerinden yayınlanan kurum içi kurulumda eklenmez ve giriş çalışır**. Daha önce `NODE_ENV`'e bağlıydı ve bu, HTTP dağıtımında girişi tamamen kilitliyordu. |

TLS'i proxy sonlandırıyorsa `TRUST_PROXY=true` verin: hem hız sınırı doğru IP'yi görür hem de `Secure` bayrağı `X-Forwarded-Proto`'dan doğru türetilir.

## Testler

```bash
npx vitest run
```
