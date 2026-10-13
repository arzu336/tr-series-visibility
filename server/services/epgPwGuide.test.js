import { describe, it, expect } from 'vitest'
import {
  cleanEpgTitle,
  epgChannelCountry,
  createXmltvCollector,
  toCountryResponses,
  strictMatcher,
} from './epgPwGuide.js'

describe('epg.pw Rusya ve Orta Asya rehberi', () => {
  it('başlık temizleme', () => {
    expect(cleanEpgTitle('т/с Однажды в Чукурова')).toBe('Однажды в Чукурова')
    expect(cleanEpgTitle('Основание Осман. 401 с.')).toBe('Основание Осман')
    expect(cleanEpgTitle('Алп-Арслан: Великий Сельджук | S01E32')).toBe('Алп-Арслан: Великий Сельджук')
    expect(cleanEpgTitle('Иффет (16+)')).toBe('Иффет')
  })

  it('kanal ülkesi', () => {
    expect(epgChannelCountry('Любимый [KG]')).toBe('KG')
    expect(epgChannelCountry('7 канал KZ')).toBe('KZ')
    expect(epgChannelCountry('Ontustik')).toBe('KZ')
    expect(epgChannelCountry('ETV+ Эстония')).toBe('EE')
    expect(epgChannelCountry('Сапфир')).toBe('RU')
    expect(epgChannelCountry('Star TV HD TR')).toBe('TR')
    expect(epgChannelCountry('TV Puls')).toBe('PL')
    expect(epgChannelCountry('Fashion One 4K')).toBeNull()
    expect(epgChannelCountry('Zee-TV')).toBeNull()
  })

  it('XMLTV parça parça okunur; yalnızca bugünün programları, Türkiye ve bilinmeyen kanallar atlanır', () => {
    const xml =
      '<tv><channel id="1"><display-name lang="RU">Любимый [KG]</display-name></channel>' +
      '<channel id="2"><display-name lang="RU">Star TV HD TR</display-name></channel>' +
      '<programme channel="1" start="20261013150000 +0000"><title lang="zh">Основание Осман. 401 с.</title></programme>' +
      '<programme channel="1" start="20261013170000 +0000"><title lang="zh">Основание Осман. 402 с.</title></programme>' +
      '<programme channel="1" start="20261014150000 +0000"><title lang="zh">Основание Осман. 403 с.</title></programme>' +
      '<programme channel="2" start="20261013150000 +0000"><title>Tuzlu Kahve</title></programme></tv>'
    const c = createXmltvCollector('20261013')
    for (let i = 0; i < xml.length; i += 37) c.push(xml.slice(i, i + 37))
    const responses = toCountryResponses(c.end())
    expect(responses).toEqual([
      {
        iso2: 'KG',
        body: {
          Channels: [
            { Name: 'Любимый [KG]', Programmes: [{ Title: 'Основание Осман' }, { Title: 'Основание Осман' }] },
          ],
        },
      },
    ])
  })

  it('tek kelimelik ad yalnızca güvenilir kanalda eşleşir', () => {
    const m = strictMatcher((t) => (t === 'Месть' ? 1 : t === 'Основание Осман' ? 2 : null))
    expect(m('Месть')).toBeNull()
    expect(m('Месть', { allowAmbiguous: true })).toBe(1)
    expect(m('Основание Осман')).toBe(2)
  })
})
