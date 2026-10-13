import { describe, it, expect } from 'vitest'
import { parseMagticomChannels, cleanGeorgianTitle, toGuideChannel } from './magticomGuide.js'
import { parseEntities } from './wikidataLabels.js'
import { stripWikiQualifier } from './tvGuide.js'

describe('Gürcistan rehberi ve yerel adlar', () => {
  it('yalnızca Gürcüce adlı kanallar', () => {
    const html =
      '<div class="tv-guide-channel bottom-line hidden" data-id="4" data-x="1"><img alt="იმედი" /></div>' +
      '<div class="tv-guide-channel bottom-line hidden" data-id="21" data-x="1"><img alt="Viju TV1000" /></div>'
    expect(parseMagticomChannels(html)).toEqual([{ id: '4', name: 'იმედი' }])
  })

  it('Gürcüce başlıktan bölüm ve ek ayıklanır', () => {
    expect(cleanGeorgianTitle('ლეილა (43)')).toBe('ლეილა')
    expect(cleanGeorgianTitle('შუა ქალაქში (გ/ჩ)')).toBe('შუა ქალაქში')
    expect(toGuideChannel('იმედი', [{ title: 'პატარძალი (363)' }, { title: '' }])).toEqual({
      Name: 'იმედი',
      Programmes: [{ Title: 'პატარძალი' }],
    })
  })

  it('Wikidata adları ve ansiklopedi ayırt edici eki', () => {
    const rows = parseEntities({
      entities: { Q1: { labels: { ka: { value: 'ორმო' } }, aliases: { ru: [{ value: 'Яма' }] } } },
    })
    expect(rows).toEqual([
      { wikidataId: 'Q1', lang: 'ka', label: 'ორმო', kind: 'label' },
      { wikidataId: 'Q1', lang: 'ru', label: 'Яма', kind: 'alias' },
    ])
    expect(stripWikiQualifier('ორმო (სერიალი)')).toBe('ორმო')
    expect(stripWikiQualifier('Шетелдік күйеубала (телесериал)')).toBe('Шетелдік күйеубала')
  })
})
