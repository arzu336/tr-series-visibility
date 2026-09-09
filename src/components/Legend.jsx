import { legendStops, proxyLegendStops } from '../lib/scale.js'
import { VISIBILITY_SCORE_NOTE } from '../lib/methodologyNotes.js'

// Haritanın koyu lacivert "veri yok" dolgusu (Map2D/Globe3D'deki NO_DATA_COLOR ile aynı değer).
// Lejantta gösterilmesi gerekiyor: kullanıcı bir ülkenin boş mu, düşük skorlu mu olduğunu
// ayırt edemiyordu — koyu lacivert, camgöbeği skalasının en soğuk durağına yakın okunuyor.
const NO_DATA_COLOR = '#131c31'

// caption verilmezse (madde 1 — dizi bazlı harita filtresi aktif değilken) varsayılan TMDB
// açıklaması gösterilir; seriesFilter aktifken App.jsx buraya gerçek anlamı (Google Trends
// arama ilgisi) yansıtan bir açıklama geçer — aynı renk skalası farklı bir metriğe
// uygulandığında kullanıcı bunun ne olduğunu yanlış anlamasın diye.
//
// `showLayers`: haritada gerçekten üç katman birden görünürken (varsayılan görünüm) tahmin ve
// "veri yok" satırları da gösterilir. Dizi/oyuncu filtresi aktifken (caption verilmişken) harita
// tek bir metriği boyar, o katmanlar o an ekranda yoktur ve lejantta gösterilmeleri yanıltıcı olur.
export default function Legend({ caption }) {
  const showLayers = !caption

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
      <p className="legend__caption" title={caption || VISIBILITY_SCORE_NOTE}>
        {caption ? caption.split(' — ')[0] : 'Kültürel Görünürlük Skoru'} ⓘ
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
