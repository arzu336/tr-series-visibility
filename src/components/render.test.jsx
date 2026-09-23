import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import ErrorBoundary from './ErrorBoundary.jsx'
import CountryLeaderboard from './CountryLeaderboard.jsx'
import { HybridScoreTag } from './MediaSentimentCard.jsx'
import SeriesPanel from './SeriesPanel.jsx'
import CountryPanel from './CountryPanel.jsx'

// jsdom/testing-library kurulu değil; sunucu tarafı render, useAsync'e geçirilen bileşenlerin
// ilk render'da (status: loading/idle) patlamadığını ve doğru iskeleti bastığını doğrular.
// useEffect SSR'da çalışmaz, yani ağ çağrısı yapılmaz.

// Tüm api fonksiyonları hiç çözülmeyen söz döner (SSR'da effect zaten çalışmaz; bu, yanlışlıkla
// çalışsa bile ağa çıkılmamasını garanti eder). Proxy KULLANILMAZ: vitest fabrika sonucunu
// await eder ve `then` anahtarına fonksiyon dönen bir Proxy "thenable" sanılıp sonsuza kadar bekletir.
vi.mock('../lib/api.js', async (orig) => {
  const gercek = await orig()
  return Object.fromEntries(Object.keys(gercek).map((k) => [k, () => new Promise(() => {})]))
})

describe('useAsync tabanlı bileşenler ilk render', () => {
  it('CountryLeaderboard yükleniyor iskeleti basar', () => {
    const html = renderToString(<CountryLeaderboard iso2="DE" />)
    expect(html).toContain('leaderboard--skeleton')
  })

  it('CountryLeaderboard iso2 yokken de yükleniyor gösterir, çökmez', () => {
    expect(() => renderToString(<CountryLeaderboard iso2={null} />)).not.toThrow()
  })

  it('HybridScoreTag hesaplanıyor etiketi basar', () => {
    expect(renderToString(<HybridScoreTag seriesName="Terzi" iso2="DE" />)).toContain('Yerel skor hesaplanıyor')
  })

  it('SeriesPanel dizi bulunamazsa mesaj basar', () => {
    expect(renderToString(<SeriesPanel seriesId={99} allCountries={[]} />)).toContain('veri bulunamadı')
  })

  it('SeriesPanel dizi varsa adını basar', () => {
    const allCountries = [{ iso2: 'DE', score: 10, seriesList: [{ id: 1, name: 'Terzi', cast: [] }] }]
    expect(renderToString(<SeriesPanel seriesId={1} allCountries={allCountries} />)).toContain('Terzi')
  })

  it('CountryPanel ülke seçilmemişken yönlendirme metni basar', () => {
    expect(renderToString(<CountryPanel country={null} allCountries={[]} />)).toContain('bir ülkeye tıklayın')
  })

  it('CountryPanel skor kartını ve kişi başına paydayı basar', () => {
    const country = {
      iso2: 'DE', name: 'Almanya', score: 500, seriesCount: 30, seriesList: [], dataSource: 'tmdb',
      scorePerCapita: 6.4, perCapitaBasis: 'internet-kullanicisi', perCapitaYear: 2024, perCapitaReliable: true,
    }
    const html = renderToString(<CountryPanel country={country} allCountries={[country]} />)
    expect(html).toContain('Kişi başına erişilebilirlik skoru')
    expect(html).toContain('6,40')
    expect(html).toContain('milyon internet kullanıcısı')
  })
})

describe('ErrorBoundary', () => {
  it('hata yokken çocuğu basar', () => {
    expect(renderToString(<ErrorBoundary><p>içerik</p></ErrorBoundary>)).toContain('içerik')
  })

  it('getDerivedStateFromError hata durumunu üretir', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error('x'))).toEqual({ error: expect.any(Error) })
  })
})
