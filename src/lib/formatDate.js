// SeriesTrendChart.jsx ve MultiSeriesTrendChart.jsx'in her ikisinin de kendi (yıl içermeyen,
// elle yazılmış "Ay Gün") tarih biçimlendiricisi vardı — burada tek yerde birleştirildi. Yıl
// BİLEREK yok: her iki grafik de zaten "son 12 ay" penceresini gösterdiğini belirtiyor
// (bkz. aria-label'lar), bu yüzden her tarihte yılı tekrar etmek gereksiz gürültü — kullanıcı
// talebiyle "Gün Ay" (ör. "18 Eki") biçimine geri döndürüldü.
const trDateFormatter = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' })

// SerpAPI'nin google_trends timeseries'i timestamp'i UNIX SANİYE olarak döner (milisaniye
// DEĞİL) — bkz. server/services/serpApiCache.js. Bu fonksiyonu çağıran her yer bu birimi
// bekler; ms cinsinden bir değer geçirmek tarihleri 1970'e yakın bir yere düşürür (bu projede
// daha önce gerçekten yaşanmış bir hata — bkz. git geçmişi).
export function formatTrendsDate(tsSeconds) {
  return trDateFormatter.format(new Date(tsSeconds * 1000))
}
