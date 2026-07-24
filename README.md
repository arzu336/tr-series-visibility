# Kültürel Görünürlük Platformu

T.C. Cumhurbaşkanlığı İletişim Başkanlığı için: Türk dizilerinin küresel erişimini, tema dağılımını ve (ileride) turizm/ihracat etkisini tek bir panelde birleştiren karar destek platformu. `docs/Proje_Raporu_v5.docx`'te tanımlanan "Kültürel Görünürlük ve Etki Platformu" önerisinin çalışan bir uygulaması.

## Genel Bakış

Sistem üç katmanlı bir veri modeline dayanır (bkz. proje raporu §4.1):

1. **Popülerlik / Erişim** — TMDB üzerinden hangi dizi hangi ülkede yayında
2. **İçerik / Tema** — dizi özetlerinin LLM ile sınıflandırılması (aile, kadın hakları, göç, adalet, aşk, suç örgütü, tarih, diğer)
3. **Coğrafi / Zamansal** — ülke bazlı görünürlük skorunun zaman içindeki trendi

Bunların üzerine bir **etki katmanı** (turizm/ihracat korelasyonu, DiD kontrol ülke eşleştirmesi) ve bir **veri güveni katmanı** (her kaynağın son başarılı çekimi, hata durumu, kapsanan dizi sayısı) eklenmiştir.

## Mimari

```
gorunurluk-platformu/
├── server/           Express API + SQLite (node:sqlite, WAL modu)
│   ├── index.js          route tanımları, oturum/yetki middleware'leri
│   ├── data-pipeline.js  TMDB çekme + zenginleştirme (route'lar ve scheduler ortak kullanır)
│   ├── scheduler.js      kod-içi zamanlayıcı (n8n'in kod karşılığı, bkz. aşağı)
│   ├── db.js             şema + migrasyonlar
│   ├── tmdb.js / serpapi.js / social-listening.js / trakt.js   dış veri kaynakları
│   ├── llm.js / themes.js       LLM tema sınıflandırma + retry/backoff
│   ├── destinations.js          sinopsis tabanlı destinasyon (turizm bölgesi) tespiti
│   ├── aggregate.js              ülke bazlı görünürlük skoru hesaplama
│   ├── history.js               trend takibi (anlık görüntü tabanlı)
│   ├── impact.js                DiD / Pearson korelasyon istatistik motoru
│   ├── control-matching.js      World Bank verisiyle DiD kontrol ülke önerisi
│   ├── source-health.js         "Veri Güveni ve Kaynak Durumu" paneli için toplama
│   ├── cache.js                 SQLite tabanlı genel amaçlı cache (TTL'li)
│   └── auth.js / users.js       oturum + kullanıcı onay akışı
├── src/
│   ├── components/    React bileşenleri (bkz. Özellikler)
│   ├── lib/           api.js (fetch sarmalayıcıları), trend.js (paylaşılan trend etiketleme)
│   └── data/          ülke merkez koordinatları + Türkçe isimler
└── docs/              Proje_Raporu_v5.docx, Bütçe Değerlendirme Raporu
```

## Özellikler

### Harita (3D Glob)
- `globe.gl` + `three.js` ile ülke bazlı görünürlük skoru ısı haritası
- Bir ülkeye tıklayınca: en popüler dizi, baskın tema, trend yönü, dizi listesi + sparkline geçmişi

### Analist Paneli
- **Tema Sınıflandırma**: LLM'in ürettiği tema + güven skoru; %70 altındaki tahminler "İncelenmesi Gerekenler" olarak insan denetimine düşer (human-in-the-loop, proje raporu §5.2)
- **Destinasyon Etiketleme**: sinopsis metninde geçen yer adlarından otomatik turizm bölgesi tespiti + arama/etiket (chip) tabanlı manuel düzeltme arayüzü

### Arama İlgisi
- Google Trends (SerpAPI) — ülke bazlı arama ilgisi
- Sosyal Dinleme — Google Bilgi Grafiği beğeni oranı + YouTube fragman etkileşimi (SerpAPI)
- Trakt.tv — kullanıcı bazlı izleyici/puanlama verisi
- Üçü de talep-üzerine sorgulanır ve süresiz cache'lenir (SerpAPI'nin aylık kotasını korumak için — bkz. bütçe raporu)

### Etki Raporu
- Donut grafiklerle görünürlük skoruna göre en öndeki ülkeler ve en çok görünürlük kazanan destinasyonlar (validated kategorik palet, hover'da grafik↔liste bağlantılı vurgulama)
- **Yükselen Ülkeler**: trend geçmişine dayalı gerçek yükseliş tespiti (uydurma yön göstermez, yeterli geçmiş yoksa açıkça "veri birikiyor" der) + her ülke için otomatik önerilen DiD kontrol ülkesi
- **Veri Güveni ve Kaynak Durumu**: TMDB, LLM sınıflandırma, trend geçmişi, SerpAPI, Trakt.tv ve otomatik tazeleyicinin son başarılı çalışma zamanı/durumu
- **Turizm ve İhracat Korelasyonu**: yöntem (Pearson + %95 güven aralığı + DiD) hazır ve test edilmiş, gerçek TÜİK/Kültür ve Turizm Bakanlığı verisi gelene kadar sayı üretmez — "Gerçek Veri Bekleniyor" olarak işaretli
- PDF olarak yazdırma (tarayıcının native print'i; header/nav gizlenip tüm rapor tek sayfada basılır)

### Kullanıcılar (yalnızca admin)
- Kayıt olan hesaplar admin onayına kadar "pending" kalır
- Onay / red / admin yetkisi verme

## Veri Kaynakları

| Kaynak | Sağladığı veri | Durum | Maliyet |
|---|---|---|---|
| TMDB API | Dizi metadata, popülerlik, yayın ülkesi/platformu (JustWatch ortaklığından) | Kullanımda | Ücretsiz |
| SerpAPI (Google Trends) | Ülke bazlı arama ilgisi | Kullanımda | Ücretsiz (aylık kotalı) |
| SerpAPI (Google/YouTube) | Bilgi Grafiği beğeni oranı, YouTube fragman verisi | Kullanımda | Ücretsiz (aynı kota) |
| Trakt.tv API | Kullanıcı bazlı izleme/puanlama | Kullanımda | Ücretsiz (düşük hacim) |
| Dahili LLM sunucusu | Tema sınıflandırma, güven skoru | Kullanımda | Kurumsal, ücretsiz |
| World Bank Açık Veri API | GSYH (kişi başı), bölge, gelir grubu — DiD kontrol ülke eşleştirmesi için | Kullanımda | Ücretsiz, anahtarsız |
| Parrot Analytics | Talep (demand) skoru | Planlı | Ücretli |
| FlixPatrol | Platform bazlı günlük TOP 10 | Planlı | Ücretli (düşük) |
| TÜİK / Kültür ve Turizm Bakanlığı | Turist girişi, ihracat verisi | Planlı | Kurumsal talep gerekiyor, kamuya açık API yok |

## Otomasyon ve Güvenilirlik

- **Cache stratejisi**: Ham TMDB verisi 24 saat SQLite'ta cache'lenir (`cache.js`); talep-üzerine kaynaklar (SerpAPI, Trakt, World Bank) süresiz cache'lenir.
- **Zamanlanmış tazeleme** (`scheduler.js`): Proje raporunun §4.7'sinde önerilen n8n tabanlı otomasyon katmanının kod-içi karşılığı. Ayrı bir workflow aracı kurmadan, TMDB + LLM sınıflandırma + trend anlık görüntüsünü günde bir kez otomatik tetikler — hiç kullanıcı gelmese bile trend takibi kesintiye uğramaz. SerpAPI/Trakt bilerek bu döngüye dahil edilmemiştir (aylık kota riski).
- **LLM sınıflandırma dayanıklılığı** (`llm.js`, `themes.js`): İstek zaman aşımı + 429/5xx için üstel geri çekilmeli (exponential backoff) yeniden deneme; kalıcı başarısızlıklar `classification_failures` tablosunda sayılıp bir sonraki denemeye kadar geri çekilme süresiyle işaretlenir. Yeni diziler en fazla 5 eşzamanlı istekle sınıflandırılır (sıralı değil).
- **Veri Güveni paneli** (`source-health.js`): yukarıdaki her mekanizmanın durumunu (son başarı zamanı, bekleyen/başarısız kayıt sayısı) tek bir API'de (`/api/source-health`) toplar.

## Bilinen Sınırlamalar

- Turizm/ihracat korelasyonu gerçek kurumsal veri bekliyor (yöntem hazır, girdi yok).
- DiD kontrol ülke eşleştirmesi, trend geçmişi henüz olgunlaşmadığı için (çoğu ülke geçici olarak "yükseliyor" görünüyor) şu an zayıf adaylar önerebilir — geçmiş biriktikçe kendiliğinden iyileşir.
- Basın/haber duygu analizi (proje raporu §4.6, Google Search & News katmanı) henüz eklenmedi.
- Brand Finance Global Soft Power Index gibi dış endekslere statik referans eklenmedi.
- Globe3D bundle'ı büyük (~1.9MB) — code-splitting yapılmadı.

## Kurulum

```bash
npm install
```

`server/.env` dosyasını oluşturup (`server/.env.example`'ı temel alarak) doldurun:

```bash
TMDB_API_KEY=...           # themoviedb.org
SERPAPI_API_KEY=...        # serpapi.com
TRAKT_CLIENT_ID=...        # trakt.tv/oauth/applications
PORT=3001
APP_PASSWORD=...           # ilk admin hesabının şifresi
ADMIN_EMAIL=...            # ilk admin hesabının e-postası

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
npm start
```

`npm start` hem `/api/*` uçlarını hem de build edilmiş frontend'i tek sunucudan (`server/index.js`) servis eder.
