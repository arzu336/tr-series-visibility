import { describe, it, expect } from 'vitest'
import {
  normalizeText,
  isTrustedSource,
  isAmbiguousTitle,
  leadCastNames,
  relevanceOf,
  parseNewsDate,
  flattenNewsResults,
  buildMagazineItems,
  fetchMagazineNewsRaw,
  excludedReason,
  extractArticlePreview,
  trimSummary,
  decodeEntities,
  fetchArticlePreview,
} from './magazineNews.js'

const haber = (title, link, date = '10/01/2026, 07:12 AM, +0000 UTC', extra = {}) => ({
  title,
  link,
  date,
  source: { name: 'Kaynak' },
  ...extra,
})

describe('normalizeText', () => {
  it('Türkçe küçük harf, aksan katlama ve noktalama', () => {
    expect(normalizeText('YALI ÇAPKINI: Final!')).toBe('yali capkini final')
    expect(normalizeText('İstanbul Hatırası')).toBe('istanbul hatirasi')
  })
})

describe('isTrustedSource', () => {
  it('yalnızca izinli alan adları ve alt alan adları', () => {
    expect(isTrustedSource('https://www.hurriyet.com.tr/kelebek/magazin/x-123')).toBe(true)
    expect(isTrustedSource('https://kelebek.hurriyet.com.tr/x')).toBe(true)
    expect(isTrustedSource('https://www.sozcu.com.tr/x')).toBe(true)
    expect(isTrustedSource('https://hurriyet.com.tr.sahte-site.com/x')).toBe(false)
    expect(isTrustedSource('https://magazinhaber.xyz/x')).toBe(false)
    expect(isTrustedSource('bozuk-bağlantı')).toBe(false)
  })
})

describe('relevanceOf', () => {
  const kadro = ['Afra Saraçoğlu', 'Mert Ramazan Demir']

  it('dizi adı tam geçiyorsa dizi; alt dize yetmez', () => {
    expect(relevanceOf('Yalı Çapkını oyuncuları tatilde buluştu', 'Yalı Çapkını', kadro)).toEqual({ about: 'dizi' })
    expect(relevanceOf('Yalıçapkınıgiller tatilde', 'Yalı Çapkını', kadro)).toBeNull()
  })

  it('belirsiz kısa adda "dizi" kelimesi ya da oyuncu adı gerekir', () => {
    expect(isAmbiguousTitle('Kulüp')).toBe(true)
    expect(isAmbiguousTitle('Yalı Çapkını')).toBe(false)
    expect(relevanceOf('Kulüp üyeliği zamlandı', 'Kulüp', kadro)).toBeNull()
    expect(relevanceOf('Kulüp dizisinin yeni sezonu', 'Kulüp', kadro)).toEqual({ about: 'dizi' })
  })

  it('dizi adı yoksa başrol oyuncusunun tam adı', () => {
    expect(relevanceOf('Afra Saraçoğlu tatilden döndü', 'Yalı Çapkını', kadro)).toEqual({ about: 'Afra Saraçoğlu' })
    expect(relevanceOf('Afra yeni projesini açıkladı', 'Yalı Çapkını', kadro)).toBeNull()
  })

  it('tek kelimelik oyuncu adları eşleştirmede kullanılmaz', () => {
    expect(leadCastNames([{ name: 'Tarkan' }, { name: 'Afra Saraçoğlu' }, { name: 'A B' }, { name: 'C D' }])).toEqual([
      'Afra Saraçoğlu',
      'A B',
      'C D',
    ])
  })
})

describe('parseNewsDate', () => {
  it('SerpApi tarih biçimi ve iso_date', () => {
    expect(parseNewsDate({ date: '10/01/2026, 07:12 PM, +0000 UTC' })).toBe('2026-10-01T19:12:00.000Z')
    expect(parseNewsDate({ date: '09/30/2026, 12:05 AM, +0000 UTC' })).toBe('2026-09-30T00:05:00.000Z')
    expect(parseNewsDate({ iso_date: '2026-09-29T10:00:00Z' })).toBe('2026-09-29T10:00:00.000Z')
    expect(parseNewsDate({ date: 'dün' })).toBeNull()
  })
})

describe('flattenNewsResults + buildMagazineItems', () => {
  const sonuclar = [
    haber('Yalı Çapkını final yaptı', 'https://www.sabah.com.tr/a', '09/28/2026, 10:00 AM, +0000 UTC'),
    {
      title: 'Küme',
      highlight: haber('Afra Saraçoğlu yeni dizisini duyurdu', 'https://www.milliyet.com.tr/b'),
      stories: [
        haber('Yalı Çapkını final yaptı', 'https://www.hurriyet.com.tr/c'), // aynı başlık → tekilleşir
        haber('Yalı Çapkını oyuncusu konuştu', 'https://tiklatuzagi.net/d'), // izinsiz kaynak
      ],
    },
    haber('Borsa güne yükselişle başladı', 'https://www.haberturk.com/e'), // ilgisiz
  ]

  it('düzleştirir, süzer, tekilleştirir ve en yeniden eskiye sıralar', () => {
    const items = buildMagazineItems(flattenNewsResults(sonuclar), 'Yalı Çapkını', ['Afra Saraçoğlu'])
    expect(items.map((i) => [i.title, i.link, i.about])).toEqual([
      ['Afra Saraçoğlu yeni dizisini duyurdu', 'https://www.milliyet.com.tr/b', 'Afra Saraçoğlu'],
      ['Yalı Çapkını final yaptı', 'https://www.sabah.com.tr/a', 'dizi'],
    ])
  })
})

describe('fetchMagazineNewsRaw', () => {
  const dizi = { id: 7, name: 'Yalı Çapkını', cast: [{ name: 'Afra Saraçoğlu' }, { name: 'Mert Ramazan Demir' }] }

  it('dizi adı ve başrol oyuncuları için iki arama yapar', async () => {
    const sorgular = []
    const sonuc = await fetchMagazineNewsRaw(dizi, async (params) => {
      sorgular.push(params)
      return { news_results: [haber('Yalı Çapkını final yaptı', 'https://www.ntv.com.tr/a')] }
    })
    expect(sorgular.map((p) => [p.engine, p.q, p.gl])).toEqual([
      ['google_news', '"Yalı Çapkını"', 'tr'],
      ['google_news', '"Afra Saraçoğlu" OR "Mert Ramazan Demir"', 'tr'],
    ])
    expect(sonuc.raw.map((r) => r.link)).toEqual(['https://www.ntv.com.tr/a', 'https://www.ntv.com.tr/a'])
    expect(buildMagazineItems(sonuc.raw, dizi.name, leadCastNames(dizi.cast))).toHaveLength(1)
  })

  it('bir arama başarısız olursa diğeriyle devam eder; ikisi de olmazsa hata fırlatır', async () => {
    let n = 0
    const yarim = await fetchMagazineNewsRaw(dizi, async () => {
      if (n++ === 0) throw new Error('kota')
      return { news_results: [haber('Afra Saraçoğlu tatilde', 'https://www.cnnturk.com/a')] }
    })
    expect(buildMagazineItems(yarim.raw, dizi.name, leadCastNames(dizi.cast)).map((i) => i.about)).toEqual([
      'Afra Saraçoğlu',
    ])
    await expect(
      fetchMagazineNewsRaw(dizi, async () => {
        throw new Error('kota')
      })
    ).rejects.toThrow('kota')
  })
})

describe('excludedReason — yayın rehberi ve hukuki süreç haberleri gösterilmez', () => {
  it('yayın rehberi / SEO başlıkları', () => {
    expect(excludedReason('Uzak Şehir 66. son bölüm full HD izle')).toBe('rehber')
    expect(excludedReason('Uzak Şehir 29 Eylül - Saat Kaçta Başlıyor? - TV Rehberi')).toBe('rehber')
    expect(excludedReason('Burak Deniz kimdir, nereli, kaç yaşında?')).toBe('rehber')
    expect(excludedReason('Yalı Çapkını yeni sezon fragmanı yayınlandı')).toBe('rehber')
    expect(excludedReason("Uzak Şehir ne zaman başlıyor? Kanal D'de yeni sezon")).toBe('rehber')
  })

  it('hukuki süreç haberleri', () => {
    expect(excludedReason('Ünlülere uyuşturucu operasyonu! Sinem Ünsal gözaltında')).toBe('hukuki')
    expect(excludedReason('Sinem Ünsal ve Ahsen Eroğlu yurt dışı çıkış yasağıyla salıverildi')).toBe('hukuki')
    expect(excludedReason('Ünlü oyuncu hakkında soruşturma başlatıldı')).toBe('hukuki')
  })

  it('magazin haberi geçer', () => {
    expect(excludedReason("Burak Deniz'in Bodrum tatili")).toBeNull()
    expect(excludedReason("Sinem Ünsal'ın pozlarına beğeni yağdı")).toBeNull()
    expect(excludedReason('Uzak Şehir oyuncuları setten paylaştı')).toBeNull()
  })

  it('süzgeç buildMagazineItems içinde uygulanır', () => {
    const items = buildMagazineItems(
      [
        haber('Ünlülere operasyon: Afra Saraçoğlu ifade verdi', 'https://www.sabah.com.tr/a'),
        haber('Afra Saraçoğlu Paris moda haftasında', 'https://www.sabah.com.tr/b'),
      ],
      'Yalı Çapkını',
      ['Afra Saraçoğlu']
    )
    expect(items.map((i) => i.link)).toEqual(['https://www.sabah.com.tr/b'])
  })
})

describe('buildMagazineItems — kaynak adı ve dizi/oyuncu dengesi', () => {
  const g = (i) => `09/${String(10 + i).padStart(2, '0')}/2026, 10:00 AM, +0000 UTC`

  it('kaynak adı alan adından düzgün yazılır', () => {
    const [it] = buildMagazineItems(
      [{ title: 'Yalı Çapkını sette kutlama', link: 'https://www.sozcu.com.tr/a', date: g(1) }],
      'Yalı Çapkını',
      []
    )
    expect(it.source).toBe('Sözcü')
  })

  it('dizi haberleri listenin en çok yarısını alır; oyuncu haberi yetmezse dizi haberi tamamlar', () => {
    const dizi = Array.from({ length: 6 }, (_, i) => ({
      title: `Yalı Çapkını sette ${i}. gün`,
      link: `https://www.sabah.com.tr/d${i}`,
      date: g(10 + i),
    }))
    const oyuncu = Array.from({ length: 2 }, (_, i) => ({
      title: `Afra Saraçoğlu tatilde ${i}`,
      link: `https://www.sabah.com.tr/o${i}`,
      date: g(i),
    }))
    const items = buildMagazineItems([...dizi, ...oyuncu], 'Yalı Çapkını', ['Afra Saraçoğlu'], { limit: 6 })
    expect(items.filter((i) => i.about === 'dizi')).toHaveLength(4)
    expect(items.filter((i) => i.about !== 'dizi')).toHaveLength(2)
    const dengeli = buildMagazineItems(
      [
        ...dizi,
        ...oyuncu,
        ...oyuncu.map((o, i) => ({
          ...o,
          title: `Afra Saraçoğlu yeni proje ${i}`,
          link: `https://www.sabah.com.tr/p${i}`,
        })),
      ],
      'Yalı Çapkını',
      ['Afra Saraçoğlu'],
      { limit: 6 }
    )
    expect(dengeli.filter((i) => i.about === 'dizi')).toHaveLength(3)
    expect(excludedReason('28 Eylül reyting sonuçları açıklandı')).toBe('rehber')
  })
})

describe('extractArticlePreview — haber sayfasının paylaşım özeti', () => {
  const sayfa = (head, body = '') => `<html><head>${head}</head><body>${body}</body></html>`

  it('og:description, og:image ve yayın tarihi', () => {
    const p = extractArticlePreview(
      sayfa(
        '<meta property="og:description" content="Uzak Şehir&#x27;in yıldızı Budapeşte&#39;den paylaştı, pozlarına beğeni yağdı.">' +
          '<meta property="og:image" content="https://i.sozcu.com.tr/a.jpg">' +
          '<meta property="article:published_time" content="2026-09-17T10:00:00+03:00">'
      ),
      'https://www.sozcu.com.tr/x'
    )
    expect(p.summary).toBe("Uzak Şehir'in yıldızı Budapeşte'den paylaştı, pozlarına beğeni yağdı.")
    expect(p.image).toBe('https://i.sozcu.com.tr/a.jpg')
    expect(p.publishedAt).toBe('2026-09-17T07:00:00.000Z')
  })

  it('JSON-LD NewsArticle açıklaması önce; etiket gibi kısa meta açıklamalar atlanır (Milliyet)', () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage' },
        {
          '@type': 'NewsArticle',
          description:
            "Kanal D'nin reyting rekortmeni dizisi Uzak Şehir'de Alya karakterini oynayan Sinem Ünsal yeni paylaşım yaptı.",
          image: { url: '/img/b.jpg' },
          datePublished: '2026-09-17T08:00:00Z',
        },
      ],
    })
    const p = extractArticlePreview(
      sayfa(`<meta name="description" content="Kanal D"><script type="application/ld+json">${ld}</script>`),
      'https://www.milliyet.com.tr/magazin/x'
    )
    expect(p.summary).toMatch(/^Kanal D'nin reyting rekortmeni/)
    expect(p.image).toBe('https://www.milliyet.com.tr/img/b.jpg')
    expect(p.publishedAt).toBe('2026-09-17T08:00:00.000Z')
  })

  it('özet yoksa ya da hepsi çok kısaysa null; bozuk JSON-LD çökertmez', () => {
    const p = extractArticlePreview(
      sayfa('<meta name="description" content="Uzak Şehir"><script type="application/ld+json">{bozuk</script>'),
      'https://www.ntv.com.tr/x'
    )
    expect(p).toEqual({ summary: null, image: null, publishedAt: null })
  })

  it('uzun özet cümle sonunda kesilir; özel karakterler çözülür', () => {
    const uzun = 'Birinci cümle burada bitiyor ve oldukça uzun bir açıklama içeriyor. ' + 'kelime '.repeat(80)
    expect(trimSummary(uzun, 100)).toBe('Birinci cümle burada bitiyor ve oldukça uzun bir açıklama içeriyor.')
    expect(trimSummary('kısa', 100)).toBe('kısa')
    expect(decodeEntities('&quot;Aşk&quot; &amp; &#8217;ya&#x27;')).toBe(`"Aşk" & ’ya'`)
  })
})

describe('fetchArticlePreview — yalnızca izinli kaynaklar', () => {
  it('izinsiz kaynağa istek atılmaz (400)', async () => {
    let cagrildi = false
    await expect(
      fetchArticlePreview('https://magazinhaber.xyz/a', async () => {
        cagrildi = true
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(cagrildi).toBe(false)
  })

  it('izinsiz adrese yönlendiren sayfa reddedilir', async () => {
    const sahte = async () => ({
      url: 'https://kotu-site.example/a',
      ok: true,
      status: 200,
      text: async () => '<html></html>',
    })
    await expect(fetchArticlePreview('https://www.sabah.com.tr/a', sahte)).rejects.toThrow('izinli olmayan')
  })

  it('izinli sayfadan özet döner', async () => {
    const sahte = async (url) => ({
      url,
      ok: true,
      status: 200,
      text: async () =>
        '<meta property="og:description" content="Afra Saraçoğlu Paris moda haftasında şık tarzıyla dikkat çekti.">',
    })
    const p = await fetchArticlePreview('https://www.sabah.com.tr/a', sahte)
    expect(p.url).toBe('https://www.sabah.com.tr/a')
    expect(p.summary).toMatch(/Paris moda haftasında/)
  })
})
