import { describe, it, expect } from 'vitest'
import { summarizeVideos, parseMover, SOURCES } from './onlineViews.js'

describe('çevrimiçi izlenme', () => {
  it('yalnızca adın ve dizi işaretinin geçtiği videolar, tekil', () => {
    const videos = [
      { id: 1, title: 'سریال قیام عثمان قسمت ۱، دوبله فارسی', visit_cnt: 673320, create_date: '2021-03-07 11:27:00' },
      { id: 1, title: 'سریال قیام عثمان قسمت ۱، دوبله فارسی', visit_cnt: 673320, create_date: '2021-03-07 11:27:00' },
      { id: 2, title: 'تریلر سریال قیام عثمان', visit_cnt: 1405236, create_date: '2022-06-19 12:00:35' },
      { id: 3, title: 'قیام عثمان', visit_cnt: 999, create_date: '2024-01-01' },
      { id: 4, title: 'سریال دیگر قسمت ۲', visit_cnt: 5000, create_date: '2024-01-01' },
    ]
    expect(summarizeVideos(videos, 'قیام عثمان')).toEqual({
      videos: 2,
      views: 2078556,
      topViews: 1405236,
      latestUpload: '2022-06-19',
    })
  })

  it('tek kelimelik genel adda Türk işareti ya da Türkçe ad gerekir', () => {
    const videos = [
      { id: 1, title: 'سریال حلقه قسمت ۲', visit_cnt: 100000 },
      { id: 2, title: 'سریال ترکی حلقه قسمت ۳ دوبله فارسی', visit_cnt: 5000 },
      { id: 3, title: 'سریال حلقه Halka قسمت ۴', visit_cnt: 700 },
    ]
    expect(summarizeVideos(videos, 'حلقه', { original: 'Halka' }).views).toBe(5700)
  })

  it('mover.uz arama sayfası: kimlik, başlık, izlenme ve sonraki sayfa', () => {
    const html =
      '<div class="video-item"><h5 class="title"><a href="https://mover.uz/watch/U5CdVCSS" title="UZOQ SHAHAR 199 qism uzbek tilida">x</a></h5>' +
      '<div class="meta"><div class="user"><a href="https://mover.uz/channel/x">x</a></div><div class="views">1 028</div></div></div>' +
      '<a href="https://mover.uz/search?val=Uzoq+shahar&amp;page=2">2</a>'
    const p = parseMover(html, { query: 'Uzoq shahar', page: 1 })
    expect(p.videos).toEqual([{ id: 'U5CdVCSS', title: 'UZOQ SHAHAR 199 qism uzbek tilida', views: 1028, date: null }])
    expect(p.next).toBe('https://mover.uz/search?val=Uzoq%20shahar&page=2')
    const mover = SOURCES.find((s) => s.key === 'mover')
    expect(summarizeVideos(p.videos, 'Uzoq shahar', { original: 'Uzak Şehir', markers: mover }).views).toBe(1028)
    expect(
      summarizeVideos([{ id: 1, title: 'Uzoq shahar konsert', views: 9 }], 'Uzoq shahar', { markers: mover }).videos
    ).toBe(0)
  })
})
