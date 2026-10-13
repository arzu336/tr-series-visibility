import { describe, it, expect } from 'vitest'
import { summarizeVideos } from './onlineViews.js'

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
})
