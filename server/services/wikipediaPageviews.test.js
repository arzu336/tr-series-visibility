import { describe, it, expect } from 'vitest'
import { siteKeyToLang, encodeArticleTitle } from './wikipediaPageviews.js'

// Wikipedia okunma katmanının iki sessiz kırılma noktası var; ikisi de canlı veriyle görüldü:
//   1) Wikidata sitelinks içinde dil sürümü OLMAYAN projeler de `...wiki` ile bitiyor
//      (commonswiki gibi) — elenmezlerse "dil sinyali" diye sahte satır üretirler.
//   2) Makale başlıkları alfabe dışı ve noktalama içeriyor ("Kuruluş: Osman", Arapça parantezli
//      adlar). Yanlış kodlanırsa API 404 döner ve sonuç sessizce "veri yok" sanılır.

describe('siteKeyToLang', () => {
  it('gerçek dil sürümlerini tanır (canlı Wikidata yanıtından)', () => {
    expect(siteKeyToLang('arwiki')).toBe('ar')
    expect(siteKeyToLang('trwiki')).toBe('tr')
    expect(siteKeyToLang('fawiki')).toBe('fa')
  })

  it('TMDB kapsamı dışındaki kritik dilleri de tanır', () => {
    // Bu diller tam da haritada boş kalan bölgeleri temsil ediyor — elenmeleri kayıp olur.
    expect(siteKeyToLang('tgwiki')).toBe('tg') // Tacikçe
    expect(siteKeyToLang('tkwiki')).toBe('tk') // Türkmence
    expect(siteKeyToLang('crhwiki')).toBe('crh') // Kırım Tatarcası
    expect(siteKeyToLang('ckbwiki')).toBe('ckb') // Sorani
    expect(siteKeyToLang('arzwiki')).toBe('arz') // Mısır Arapçası
  })

  it('dil OLMAYAN projeleri eler (Kuruluş Osman yanıtında commonswiki gerçekten vardı)', () => {
    expect(siteKeyToLang('commonswiki')).toBe(null)
    expect(siteKeyToLang('metawiki')).toBe(null)
    expect(siteKeyToLang('specieswiki')).toBe(null)
    expect(siteKeyToLang('wikidatawiki')).toBe(null)
  })

  it('Wikipedia dışı kardeş projeleri eler', () => {
    expect(siteKeyToLang('enwikisource')).toBe(null)
    expect(siteKeyToLang('enwiktionary')).toBe(null)
    expect(siteKeyToLang('trwikiquote')).toBe(null)
  })

  it('bozuk girdide çökmez', () => {
    expect(siteKeyToLang(null)).toBe(null)
    expect(siteKeyToLang(undefined)).toBe(null)
    expect(siteKeyToLang('')).toBe(null)
  })
})

describe('encodeArticleTitle', () => {
  it('boşluğu alt çizgiye çevirir', () => {
    expect(encodeArticleTitle('Kuruluş Osman')).toBe('Kurulu%C5%9F_Osman')
  })

  it('iki nokta üst üsteyi kodlar (kodlanmazsa API 404 döner)', () => {
    // "Kuruluş: Osman" İspanyolca/Fransızca sürümlerin gerçek başlığı.
    expect(encodeArticleTitle('Kuruluş: Osman')).toBe('Kurulu%C5%9F%3A_Osman')
  })

  it('eğik çizgiyi kodlar — yol ayracı sanılmamalı', () => {
    expect(encodeArticleTitle('Dizi/Bölümler')).not.toContain('/')
  })

  it('Latin dışı alfabeleri kodlar (canlı başlıklar)', () => {
    const ar = encodeArticleTitle('المؤسس عثمان (مسلسل)')
    expect(ar).not.toContain(' ')
    expect(decodeURIComponent(ar)).toBe('المؤسس_عثمان_(مسلسل)')

    const hy = encodeArticleTitle('Հեռավոր քաղաք (հեռուստասերիալ)')
    expect(decodeURIComponent(hy)).toBe('Հեռավոր_քաղաք_(հեռուստասերիալ)')
  })
})
