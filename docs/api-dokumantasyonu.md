# Türk Dizileri Küresel Görünürlük Platformu — API Dokümantasyonu

Platformun ürettiği raporlar ve veriler, arayüz dışından bir API anahtarıyla okunabilir. Bu belge anahtarı alan
sistem ya da kişi içindir.

## 1. Temel bilgiler

| Bilgi | Değer |
|---|---|
| Temel adres | `http://<sunucu-adresi>:3001` (kurum içi ağda ör. `http://172.18.212.145:3001`) |
| Kimlik doğrulama | Her isteğe `X-API-Key: gp_…` başlığı; alternatif `Authorization: Bearer gp_…` |
| Yetki | Yalnızca okuma (GET). Yazma istekleri ve yönetim uçları reddedilir |
| Biçim | JSON, UTF-8; tarihler ISO 8601 (`2026-10-19`, `2026-10-19T08:45:49Z`) |
| Hız sınırı | Anahtar başına 15 dakikada 1500 istek (`RateLimit-*` başlıkları yanıtta gelir) |
| Ülke kodu | ISO 3166-1 alpha-2, büyük harf (`DE`, `SA`, `KZ`) |
| Dizi kimliği | Platformun dizi kimliği (`tmdbId`); listesi `/api/trends/series` |
| Kıta kimliği | `europe`, `middle_east`, `latin_america`, `asia_pacific`, `africa`, `north_america` |

## 2. Hata yanıtları

| Kod | Anlamı | Yanıt |
|---|---|---|
| 401 | Anahtar yok, yanlış ya da iptal edilmiş | `{"error":"API anahtarı geçersiz ya da iptal edilmiş"}` |
| 403 | Yazma isteği ya da yönetim ucu | `{"error":"API anahtarı yalnızca okuma isteklerine izin verir"}` |
| 400 | Geçersiz parametre (ör. bilinmeyen ülke kodu) | `{"error":"…"}` |
| 404 | Kayıt yok (ör. katalogda olmayan dizi) | `{"error":"…"}` |
| 429 | Hız sınırı aşıldı | `{"error":"Çok fazla istek yapıldı…"}` |
| 503 | Dış veri kaynağı geçici olarak ulaşılamaz | `{"error":"…"}` |

## 3. Uçlar

### Raporlar

| Uç | Açıklama | Parametreler |
|---|---|---|
| `GET /api/report/global` | Küresel görünüm raporu | `fresh=1` önbelleği atlar |
| `GET /api/report/country/{iso2}` | Ülke brifingi | `fresh=1` |
| `GET /api/report/series/{tmdbId}` | Dizi raporu | `fresh=1` |
| `GET /api/report/continent/{id}` | Kıta raporu (son 12 ay) | `fresh=1` |
| `GET /api/compare?ids=66017,271014` | Dizi kıyaslaması (2–5 dizi) | `ids` virgülle ayrılmış kimlikler |

Rapor yanıtı ortak yapıdadır:

```json
{
  "title": "Ülke brifingi",
  "generatedAt": "2026-10-19T08:45:49Z",
  "summary": { "kpis": [ { "key": "level", "label": "İzlenme düzeyi", "value": "Yüksek", "detail": "55. / 147 ülke", "trend": null } ],
               "sentences": [ { "text": "…", "basis": "ranking" } ],
               "caveat": "…" },
  "chapters": [
    { "key": "izleniyor", "title": "Ne izleniyor",
      "sections": [ { "key": "platformLists", "title": "Türk dizileri sıralaması", "data": { … }, "caveat": null } ] }
  ],
  "contract": "ulke-brifingi-v1"
}
```

- `summary.kpis`: başlık göstergeleri. `summary.sentences`: özet cümleler ve dayandığı veri (`basis`).
- `chapters[].sections[]`: her bölümün `key`, `title`, `data` alanı vardır; hesaplanamayan bölümler listede yer almaz.
- `contract`: yanıt şeması sürümü. Şema değişirse bu değer değişir; entegrasyonlar bu alanı kontrol etmelidir.

Ülke brifingi bölüm anahtarları: `platformLists`, `topSeries`, `wikiInterest`, `searchTrend`, `pressTone`, `sales`,
`trend`, `themes`, `tourismSignal`, `exportSignal`, `foreignStudents`.
Dizi raporu bölüm anahtarları: `seriesContent`, `seriesContinents`, `seriesMarkets`, `seriesPlatformPoints`,
`seriesOpportunity`, `seriesAvailability`, `seriesSales`, `wikiInterest`, `seriesImdb`, `seriesPress`, `seriesExports`.

### Katalog ve dizi verileri

| Uç | Açıklama |
|---|---|
| `GET /api/trends/series` | Katalogdaki diziler: `{ items: [ { id, name } ] }` |
| `GET /api/series/{tmdbId}` | Dizi özeti (ad, afiş, yayın tarihi, tema, destinasyonlar) |
| `GET /api/series/{tmdbId}/cast` | Kadro: `{ cast: [ { id, name, character, profilePath, episodes } ] }` |
| `GET /api/series/{tmdbId}/tv` | TV yayınları, satış kayıtları, çevrimiçi izlenme: `{ airings, sales, online }` |
| `GET /api/imdb/{tmdbId}` | İzleyici puanı ve oy sayısı |
| `GET /api/series-enrichment/{tmdbId}` | Sezonlar, ekip, uluslararası adlar |
| `GET /api/charts/series/{tmdbId}` | Dizinin platform listelerindeki geçmişi |

### Ülke ve küresel veriler

| Uç | Açıklama |
|---|---|
| `GET /api/visibility` | Bütün ülkeler için izlenme düzeyi ve yayın varlığı: `{ countries: [ … ], updatedAt }` |
| `GET /api/watch/countries` | Ülke başına izlenme sinyali |
| `GET /api/watch/country/{iso2}/series` | Ülkede izlenen diziler |
| `GET /api/country/{iso2}/tv` | Ülkedeki TV yayınları, satışlar, çevrimiçi izlenme |
| `GET /api/country/{iso2}/context` | Ülke bağlamı (nüfus, dil, gelir grubu) |
| `GET /api/charts/country/{iso2}` | Ülkenin platform listeleri |
| `GET /api/charts/global`, `/api/charts/continents`, `/api/charts/turkey-tv` | Küresel, kıta ve Türkiye TV listeleri |
| `GET /api/history/{iso2}/periods?range=monthly\|yearly` | Ülkenin aylık/yıllık görünürlük geçmişi |
| `GET /api/history/global-periods` | Küresel geçmiş |
| `GET /api/tourism-summary` | Turizm özeti (ülke başına ziyaretçi değişimi) |
| `GET /api/turkish-learning-index` | Türkçe öğrenme ilgisi |
| `GET /api/themes`, `/api/destinations` | Tema dağılımı, dizi destinasyonları |
| `GET /api/img/{boyut}/{dosya}` | Afiş/oyuncu görseli (`w92`, `w185`, `w342`); anahtar gerekmez |

Görsel adresi: yanıtlardaki `posterPath` ya da `profilePath` değeri (ör. `/abc.jpg`) `/api/img/w342/abc.jpg` olarak
kullanılır.

## 4. Örnekler

PowerShell (Windows):

```powershell
curl.exe -H "X-API-Key: gp_SIZIN_ANAHTARINIZ" http://172.18.212.145:3001/api/report/country/DE
```

```powershell
Invoke-RestMethod -Headers @{ 'X-API-Key' = 'gp_SIZIN_ANAHTARINIZ' } `
  -Uri 'http://172.18.212.145:3001/api/report/country/DE' | ConvertTo-Json -Depth 8
```

Python:

```python
import requests

BASE = "http://172.18.212.145:3001"
HEADERS = {"X-API-Key": "gp_SIZIN_ANAHTARINIZ"}

r = requests.get(f"{BASE}/api/report/country/DE", headers=HEADERS, timeout=60)
r.raise_for_status()
rapor = r.json()
for kpi in rapor["summary"]["kpis"]:
    print(kpi["label"], "→", kpi["value"])
```

JavaScript (Node 18+ / tarayıcı):

```js
const res = await fetch('http://172.18.212.145:3001/api/compare?ids=66017,271014', {
  headers: { 'X-API-Key': 'gp_SIZIN_ANAHTARINIZ' },
})
const data = await res.json()
console.log(data.items.map((s) => `${s.name}: ${s.lists.countries} ülke`))
```

## 5. Kullanım kuralları

- Anahtarı kod deposuna, e-postaya ya da sohbete yazmayın; ortam değişkeni veya gizli ayar olarak saklayın.
- Rapor uçları önbellekten döner (yaklaşık 1 saat); `fresh=1` yalnızca gerektiğinde kullanılmalıdır.
- Toplu çekimlerde istekler arasında kısa bekleme bırakın (saniyede 1–2 istek yeterlidir).
- Anahtar iptal edilince anında geçersiz olur; 401 alınırsa platform yöneticisine başvurun.
- Rapor metinlerindeki "korelasyon nedensellik değildir" uyarıları veriyle birlikte taşınmalıdır.
