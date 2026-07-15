# Kültürel Görünürlük Platformu — 3D Globe MVP

Türk dizilerinin dünya genelindeki yayın erişimini TMDB verisiyle 3D bir glob üzerinde gösteren prototip.

## Nasıl hesaplanıyor?

- TMDB'den en popüler 20 Türk dizisi (`/discover/tv`) çekilir.
- Her dizi için `/tv/{id}/watch/providers` ile hangi ülkelerde abonelik/ücretsiz olarak yayında olduğu alınır (bu veri TMDB'nin JustWatch ortaklığından gelir).
- Her ülke için "Görünürlük Skoru" = o ülkede yayında olan dizilerin TMDB popülerlik puanları toplamı.
- Glob üzerinde her ülkeden skorla orantılı yükseklikte bir 3D sütun yükselir.

Bu bir MVP'dir — rapordaki Google Trends, Parrot Analytics, tema sınıflandırması (LLM) ve turizm/ihracat korelasyon katmanları sonraki fazlarda eklenecektir.

## Kurulum

```bash
npm install
```

`server/.env` dosyasında `TMDB_API_KEY` zaten tanımlı (kendi TMDB API anahtarınız varsa değiştirebilirsiniz).

## Çalıştırma (geliştirme)

```bash
npm run dev
```

Bu komut hem Vite dev sunucusunu (frontend, genelde http://localhost:5173) hem de Express API sunucusunu (http://localhost:3001) aynı anda başlatır. Tarayıcıda Vite'ın verdiği adresi açın.

## Prod build

```bash
npm run build
npm start
```

`npm start` hem `/api/*` uçlarını hem de build edilmiş frontend'i tek sunucudan (`server/index.js`) servis eder.
