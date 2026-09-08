// Denetim bulgusu G-13: SerpAPI'den (Google News, YouTube) gelen linkler doğrudan `href`'e
// veriliyordu. React 18 `javascript:` şemasını ENGELLEMEZ — yalnızca geliştirme modunda uyarır —
// yani üst servisten dönen ya da önbelleğe zehirlenmiş bir kayıt tıklandığında betik
// çalıştırabilirdi. Dış kaynaktan gelen her URL bu süzgeçten geçer.
//
// Yalnızca http/https kabul edilir; javascript:, data:, vbscript:, file: ve şemasız/bozuk
// değerler null döner — çağıran taraf o zaman linki hiç render etmez (metni düz gösterir).
export function safeExternalUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  let parsed
  try {
    parsed = new URL(value.trim())
  } catch {
    // Göreli ya da bozuk URL: dış bağlantı olarak güvenilmez.
    return null
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
}
