// server/tmdb.js, server/themes.js ve server/destinations.js'te birebir aynı fonksiyon üç kez
// tanımlıydı — buraya taşındı. items'ı en fazla `limit` kadar eşzamanlı worker ile işler.
// Array.map(async..) + Promise.all yerine bu kullanılır çünkü sınırsız paralellik hem dış
// API'leri (TMDB) rate-limit'e sokuyor hem dahili LLM sunucusunu boğabiliyor (200 diziye kadar
// toplu iş yapan çağıranlar var) — sıralı for-await ise toplam süreyi dizi sayısıyla orantılı
// şekilde uzatırdı. Gerçek ölçümle doğrulandı (tmdb.js): 400 eşzamanlı istekte credits'in %94'ü
// 429/hata döndü, sınırlı eşzamanlılıkla bu sorun ortadan kalktı.
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function runNext() {
    while (nextIndex < items.length) {
      const i = nextIndex++
      results[i] = await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext))
  return results
}
