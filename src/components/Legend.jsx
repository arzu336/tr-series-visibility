import {
  legendStops,
  proxyLegendStops,
  SOURCE_COUNTRY_COLOR,
  SMALL_SAMPLE_COLOR,
  MAP_METRICS,
} from '../lib/scale.js'
import {
  VISIBILITY_SCORE_NOTE,
  PER_CAPITA_SCORE_NOTE,
  TOTAL_SCORE_NOTE,
  MAP_SCALE_NOTE,
} from '../lib/methodologyNotes.js'

const NO_DATA_COLOR = '#131c31'

export default function Legend({ caption, metric = MAP_METRICS.PER_CAPITA }) {
  const showLayers = !caption
  const kisiBasina = metric === MAP_METRICS.PER_CAPITA
  const metrikBasligi = kisiBasina
    ? 'Kültürel Görünürlük — Kişi Başına'
    : 'Kültürel Görünürlük — Toplam'
  const metrikNotu = `${kisiBasina ? PER_CAPITA_SCORE_NOTE : TOTAL_SCORE_NOTE}

${MAP_SCALE_NOTE}

${VISIBILITY_SCORE_NOTE}`

  return (
    <div className="legend">
      <span className="legend__label">Düşük</span>
      <div className="legend__bar">
        {legendStops.map((color) => (
          <span key={color} style={{ background: color }} />
        ))}
      </div>
      <span className="legend__label">Yüksek</span>
      {/* Denetim C.5: varsayılan ipucu "Popülerlik × yayın erişimi — proxy gösterge." idi;
          ne ölçtüğünü değil, ne olmadığını da söylemiyordu. Artık tek kaynaktan (lib/
          methodologyNotes.js) gelen açık çerçeve. */}
      <p className="legend__caption" title={caption || metrikNotu}>
        {caption ? caption.split(' — ')[0] : metrikBasligi} ⓘ
      </p>

      {/* Haritada kullanılan AMA lejantta hiç açıklanmayan iki renk vardı: tahmin katmanının
          turuncusu ve "veri yok"un koyu laciverti. Kullanıcı turuncuyu görüp ne anlama geldiğini
          öğrenemiyordu; bu bölüm o boşluğu kapatıyor. */}
      {showLayers && (
        <div className="legend__layers">
          <div className="legend__layer">
            <div className="legend__bar legend__bar--mini">
              {proxyLegendStops.map((color) => (
                <span key={color} style={{ background: color }} />
              ))}
            </div>
            <span
              className="legend__layer-label"
              title="Bu ülkelerde TMDB/JustWatch hiç yayın sağlayıcısı verisi yayınlamıyor, dolayısıyla görünürlük skoru hesaplanamıyor. Renk, o ülkedeki Google Trends arama ilgisini (0-100) gösterir — gerçek izlenme değil, TAHMİNdir. Koyudan açığa doğru arama ilgisi artar."
            >
              ⚡ Tahmin — arama ilgisi ⓘ
            </span>
          </div>
          {/* Kaynak ülke: ölçeğe dahil DEĞİL. Türkiye ham veride en yüksek skora sahip (1690,
              ikinci sıradaki 1126) ve min-max ölçekte gradyanın %34'ünü tek başına yiyordu.
              Bir ihracat panelinde kaynak ülkenin "en görünür pazar" olarak okunması da
              yanıltıcıydı. Renk bilerek skalanın dışında bir hue. */}
          <div className="legend__layer">
            <span className="legend__swatch" style={{ background: SOURCE_COUNTRY_COLOR }} />
            <span
              className="legend__layer-label"
              title="Türkiye dizilerin kaynak ülkesi, bir ihracat pazarı değil. Renk ölçeğine dahil edilmez — edilseydi ölçeğin tavanını belirleyip diğer ülkeleri alt bölgeye sıkıştırırdı. Ülke verisi panelde tam olarak görünmeye devam eder."
            >
              Kaynak ülke — ölçek dışı ⓘ
            </span>
          </div>
          {/* Yalnızca kişi başına metrikte anlamlı: paydası 1 milyon internet kullanıcısının
              altındaki ülkelerde oran istikrarsız (San Marino gibi yerler eşiksiz hâlde
              sıralamanın tepesine çıkıyordu). Ölçeğe alınmazlar ama haritadan silinmezler. */}
          {kisiBasina && (
            <div className="legend__layer">
              <span className="legend__swatch" style={{ background: SMALL_SAMPLE_COLOR }} />
              <span
                className="legend__layer-label"
                title="Bu ülkelerde 1 milyondan az internet kullanıcısı var. Kişi başına oran böyle küçük paydalarda istikrarsızlaşır (çok küçük bir nüfusa bölünen skor yapay olarak yükseğe fırlar), bu yüzden renk ölçeğine dahil edilmezler. Veri eksik DEĞİL — ülke paneli tam değerleri gösterir; güvenilir olmayan şey oranın kendisidir."
              >
                Yetersiz örneklem — ölçek dışı ⓘ
              </span>
            </div>
          )}
          <div className="legend__layer">
            <span className="legend__swatch" style={{ background: NO_DATA_COLOR }} />
            <span
              className="legend__layer-label"
              title="Bu ülkeler için ne yayın sağlayıcısı verisi ne de ölçülebilir bir arama ilgisi var. Boş olmaları 'Türk dizisi izlenmiyor' anlamına gelmez; elimizde o ülke için hiçbir kaynaktan sinyal olmadığı anlamına gelir."
            >
              Veri yok ⓘ
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
