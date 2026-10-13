import { describe, it, expect } from 'vitest'
import { parseChannelSlugs, parseChannelSchedule, toGuideChannel, channelsForToday } from './miTvGuide.js'

const SCHEDULE = `
<div class="channel-info"><img src="x.png" alt="Programación Mega" title="Mega" /></div>
<ul class="broadcasts">
 <li><a href="/cl/programas/meganoticias" class="program-link"><div class="content"><span class="time">10:00</span>
  <h2>
    Meganoticias ahora   </h2>
  <span class="sub-title">Noticiero</span></div></a></li>
 <li><a href="/cl/programas/hercai-s01e12" class="program-link"><div class="content"><span class="time">22:45</span>
  <h2>Hercai: amor y venganza</h2>
  <span class="sub-title">Episodio 12</span></div></a></li>
 <li><a href="/cl/programas/x" class="program-link"><div class="content"><span class="time">23:30</span>
  <h2>Tierra amarga</h2>
  <span class="sub-title">Telenovela</span></div></a></li>
</ul>`

describe('mi.tv', () => {
  it('site haritasından kanal slug’ları (ülkenin yol biçimiyle)', () => {
    const html =
      '<a href="/cl/canales/mega">x</a><a href="/cl/canales/mega">y</a><a href="/cl/canales/tvn">z</a><a href="/cl/programacion">p</a>'
    expect(parseChannelSlugs(html, { cc: 'cl', path: 'canales' })).toEqual(['mega', 'tvn'])
    expect(parseChannelSlugs('<a href="/br/canais/band">b</a>', { cc: 'br', path: 'canais' })).toEqual(['band'])
  })

  it('akış: kanal adı ve programlar; yalnızca dizi/telenovela kayıtları rehber biçimine geçer', () => {
    const s = parseChannelSchedule(SCHEDULE)
    expect(s.name).toBe('Mega')
    expect(s.programmes.map((p) => [p.time, p.title, p.subtitle])).toEqual([
      ['10:00', 'Meganoticias ahora', 'Noticiero'],
      ['22:45', 'Hercai: amor y venganza', 'Episodio 12'],
      ['23:30', 'Tierra amarga', 'Telenovela'],
    ])
    expect(toGuideChannel(s)).toEqual({
      Name: 'Mega',
      Programmes: [{ Title: 'Hercai: amor y venganza' }, { Title: 'Tierra amarga' }],
    })
  })

  it('dönüşüm: bilinen kanallar her gün, kalanlar 7 günde bir', () => {
    const slugs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    expect(channelsForToday(slugs, new Set(['c']), 0)).toEqual(['a', 'c', 'h'])
    const hafta = new Set()
    for (let d = 0; d < 7; d++) for (const s of channelsForToday(slugs, new Set(), d)) hafta.add(s)
    expect(hafta.size).toBe(slugs.length)
  })
})
