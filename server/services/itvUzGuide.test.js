import { describe, it, expect } from 'vitest'
import { parseItvChannels, toGuideChannel } from './itvUzGuide.js'

describe('itv.uz Özbekistan rehberi', () => {
  it('kanal listesi gruplardan tekilleştirilir, Kazakistan kanalları atlanır', () => {
    const body = {
      data: {
        regulars: [
          { channelId: 11, channelTitle: 'Kinoteatr HD' },
          { channelId: 194, channelTitle: 'Хабар 24 KZ' },
        ],
        premium: [{ channelId: 11, channelTitle: 'Kinoteatr HD' }],
      },
    }
    expect(parseItvChannels(body)).toEqual([{ id: 11, name: 'Kinoteatr HD' }])
  })

  it('yer tutucu programlar atlanır', () => {
    const ch = toGuideChannel('Milliy TV HD', {
      data: [{ programTitle: 'iTV' }, { programTitle: 'Uzoq shahar' }, { programTitle: 'Milliy TV HD' }],
    })
    expect(ch).toEqual({ Name: 'Milliy TV HD', Programmes: [{ Title: 'Uzoq shahar' }] })
  })
})
