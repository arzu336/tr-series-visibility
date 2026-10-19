import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { isValidFile, isValidSize, warmList, getImage, localPathFor } from './imageCache.js'

describe('imageCache — ad ve boyut doğrulama', () => {
  it('yalnızca izinli boyut ve güvenli dosya adı', () => {
    expect(isValidSize('w342')).toBe(true)
    expect(isValidSize('w1000')).toBe(false)
    expect(isValidFile('a6GZGeyWwwtfxeUqPKIYkRMOAUP.jpg')).toBe(true)
    expect(isValidFile('../etc/passwd')).toBe(false)
    expect(isValidFile('x.jpg')).toBe(false)
    expect(isValidFile('abcdefgh.svg')).toBe(false)
  })

  it('ön indirme listesi: afiş üç boyutta, kadro fotoğrafı w185, yinelemesiz', () => {
    const list = warmList({
      series: [{ posterPath: '/abcdefgh.jpg' }, { posterPath: '/abcdefgh.jpg' }, { posterPath: null }],
      castEntries: [[{ profilePath: '/ijklmnop.jpg' }, { profilePath: null }]],
    })
    expect(list).toEqual([
      { size: 'w92', file: 'abcdefgh.jpg' },
      { size: 'w185', file: 'abcdefgh.jpg' },
      { size: 'w342', file: 'abcdefgh.jpg' },
      { size: 'w185', file: 'ijklmnop.jpg' },
    ])
  })

  it('getImage: geçersiz ad null; indirme başarısızsa null, başarılıysa dosya yazılır', async () => {
    expect(await getImage('w92', '../x.jpg')).toBeNull()
    const file = `test-${Date.now()}abc.jpg`
    const bad = await getImage('w92', file, { fetchFn: async () => ({ ok: false, status: 404 }) })
    expect(bad).toBeNull()
    const ok = await getImage('w92', file, {
      fetchFn: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }),
    })
    expect(ok).toBe(localPathFor('w92', file))
    expect(fs.existsSync(ok)).toBe(true)
    // İkinci çağrı diske gider, indirmez
    let called = 0
    const again = await getImage('w92', file, {
      fetchFn: async () => {
        called++
        return { ok: false }
      },
    })
    expect(again).toBe(ok)
    expect(called).toBe(0)
    fs.unlinkSync(ok)
  })
})
