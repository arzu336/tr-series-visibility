// "Veri yok" / "hesaplanamaz" metinlerinin tek kaynağı. Sunucu (countrySummary, countryReport, impact)
// ve istemci (rapor bölümleri, paneller) aynı sabitleri kullanır; her metin NEDENİ söyler, yalnızca
// "veri yok" demez. Sayılar (eşik, kapsam) çağıran taraftan gelir, burada sabitlenmez.

/** Görünürlük–turist korelasyonu için gereken en az ortak ay sayısı. */
export const CORRELATION_MIN_MONTHS = 3

export const EMPTY = {
  // --- Turizm -------------------------------------------------------------------------
  tourismNotInBulletin: (iso2) =>
    `${iso2} YİGM Sınır İstatistikleri Bülteni'nde ayrı raporlanmıyor (bülten büyük milliyetleri ayrı verir, kalanını "Diğer" altında toplar)`,
  correlationAccumulating: (have, need) =>
    `Aylık seri birikiyor: ${have}/${need} ay (görünürlük aylık ortalaması ile turist serisinin kesiştiği ay sayısı; korelasyon için en az ${need} gerekir)`,
  correlationNoVisibility: 'bu ülke için yayın varlığı ölçümü yok',
  correlationNoTourism: 'turist girişi serisi yok — korelasyon hesaplanamaz',
  didNoTourism: 'turist girişi serisi yok — DiD hesaplanamaz',
  leadingSignalOutOfScope: (topN) => `Kapsam: görünürlükte ilk ${topN} ülke; bu ülke tarama kapsamında değil`,
  leadingSignalNotRunYet: 'Öncü turizm sinyali taraması henüz sonuç üretmedi (haftalık tarama)',
  leadingSignalTabEmpty: (topN) =>
    `Öncü seyahat sinyali haftalık taramada görünürlükte ilk ${topN} ülke için hesaplanır; tarama henüz sonuç üretmedi.`,

  // --- Basın tonu ---------------------------------------------------------------------
  pressNotScanned: (iso2, topCountries, topSeries) =>
    `${iso2} için basın taraması henüz yapılmadı (haftalık tarama görünürlükte ilk ${topCountries} ülke × ${topSeries} diziyle sınırlı; ülke panelinden elle tetiklenebilir)`,
  pressScannedNoNews: (iso2, n) => `${iso2} için ${n} dizi tarandı, yeterli haber bulunamadı`,
  pressCardNoNews: 'Bu ülke için tarama yapıldı; yeterli haber bulunamadı.',
  pressSeriesNotScanned:
    'Bu dizi için henüz hiçbir ülkede basın taraması yapılmadı (haftalık tarama en görünür dizilerle sınırlı).',
  pressSeriesScannedNoNews: (n) => `${n} ülke tarandı ama hiçbirinde haber bulunamadı.`,

  // --- Yayın listeleri ----------------------------------------------------------------
  netflixDbMissing: 'Liste veritabanı açılamadı — liste toplama henüz çalışmamış olabilir',
  netflixTableMissing: 'netflix_country_rankings tablosu yok (netflix_pipeline.py --all çalıştırılmalı)',
  netflixNotPublished: 'Bu ülke için yayın listesi yayımlanmıyor; yayın varlığı bölümüne bakın',
  netflixZeroRecords: (first, last) =>
    `0 kayıt: kapsanan dönemde (${first} – ${last}) katalogdaki hiçbir Türk dizisi bu ülkenin Top 10 listesine girmedi`,
  netflixPartialDownload: (iso2, truncated) =>
    `${iso2} için liste kaydı yok — kaynak dosya kısmen indirildiği için bu ülke kapsam dışında kalmış olabilir` +
    (truncated ? ` (dosya ${truncated} ülkesinde kesildi; alfabetik olarak sonraki ülkeler eksik)` : ''),
  netflixNoRecordUnknown: (iso2) => `${iso2} için liste kaydı yok`,

  // --- Boşluk analizi -----------------------------------------------------------------
  gapNone: 'Boşluk yok: benzer ülkelerde yayında olan diziler bu ülkede de yayında',
  gapNoSimilar: (note) => `benzer ülke bulunamadı (${note})`,

  // --- Arayüz: ülke paneli / harita / kenar çubuğu --------------------------------------
  regionalInterestMissing:
    'Bu dizi için bu ülkede bölge kırılımı yok (arama hacmi bölge eşiğinin altında ya da sorgu henüz yapılmadı).',
  periodsAccumulating:
    'Veri birikiyor — günlük anlık görüntüler dönem sonunda ortalanır; henüz bir periyot tamamlanmadı.',
  leaderboardEmpty: 'Bileşik skor için veri yok: bu ülkede sağlayıcı kaydı olan dizi bulunmadı.',
  continentNoTourism: 'YİGM bülteni bu kıtadaki ülkeleri ayrı raporlamıyor.',
  continentNoTopSeries: 'Bu kıtada yayın sağlayıcı kaydı olan dizi yok.',
  continentNoVisibility: 'Bu kıtadaki hiçbir ülkede yayın sağlayıcı verisi yok.',
  mapNoSignal: 'Veri yok: ne yayın sağlayıcı kaydı ne ölçülebilir arama ilgisi',
  mapNotAvailableHere: 'Bu ülkede yayında değil',
  mapNoInterest: 'Bu ülke için arama ilgisi ölçülmedi',

  // --- Listeler (chart_entries) -------------------------------------------------------
  chartEmpty: 'Bu dönem için liste kaydı yok.',
  chartEmptyWeek: 'Bu hafta hiçbir Türk dizisi listelere girmedi.',
  chartEmptyDay: 'Bu gün için Türkiye TV listesinde kayıt yok.',
  chartOnlyOthers: (n) =>
    `Bu gün listede kataloğumuzdaki dizi yok; ${n} satır dizi-dışı/katalog dışı (süzgeci kapatın).`,
  countryNoCharts: 'Bu ülke için hiçbir liste kaynağı yok; eldeki gerçekler aşağıda.',
  continentNoNetflix:
    'Bu kıtadaki hiçbir ülkede son 52 haftada liste kaydı yok ya da bu pazarlarda liste yayımlanmıyor.',

  // --- Arayüz: arama ilgisi sekmesi ----------------------------------------------------
  seriesNoCountryInterest: 'Bu dizi için ülke kırılımı boş döndü ya da henüz sorgulanmadı.',
  seriesTimeSeriesMissing: (scope) => `Bu dizi için ${scope} zaman serisi henüz sorgulanmamış ya da boş döndü.`,
  multiSeriesNoTimeSeries: 'Seçilen dizilerin hiçbiri için küresel zaman serisi sorgulanmamış.',
  comparisonNoData: 'Seçilen dizilerin hiçbirinde ülke bazlı arama ilgisi verisi yok (boş döndü ya da sorgulanmadı).',
  socialNoVideo: 'Bu dizi için YouTube verisi yok (sosyal dinleme sorgusu sonuç döndürmedi).',
}
