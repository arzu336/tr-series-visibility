import { describe, it, expect, vi, beforeEach } from 'vitest'

const metaDeposu = new Map()

vi.mock('../db.js', () => ({
  default: {
    prepare: () => ({
      get: (key) => (metaDeposu.has(key) ? { value: metaDeposu.get(key) } : undefined),
      run: (key, value) => metaDeposu.set(key, value),
      all: () => [],
    }),
  },
}))

const {
  isNetflixSyncDue,
  runNetflixPipeline,
  runNetflixSyncIfNeeded,
  META_LAST_SUCCESS,
  META_LAST_ATTEMPT,
  META_LAST_ERROR,
  CATCH_UP_MS,
  RETRY_BACKOFF_MS,
  PIPELINE_SCRIPT,
} = await import('./netflixPipelineRunner.js')

const SAAT = 60 * 60 * 1000
const GUN = 24 * SAAT
const PAZAR_0030 = new Date(2026, 8, 27, 0, 30).getTime()
const PAZAR_1500 = new Date(2026, 8, 27, 15, 0).getTime()
const CUMARTESI_2300 = new Date(2026, 8, 26, 23, 0).getTime()
const PAZARTESI_0100 = new Date(2026, 8, 28, 1, 0).getTime()
const CARSAMBA = new Date(2026, 8, 30, 12, 0).getTime()

const OZET = "[netflix_pipeline] {'status': 'ok', 'records_written': 241}"

function sahteExec(senaryo = {}) {
  const fn = vi.fn((bin, args, opts, cb) => {
    fn.cagrilar.push({ bin, args, opts })
    const bitir = () => {
      if (senaryo.firlat) throw new Error(senaryo.firlat)
      if (senaryo.hata) {
        const err = Object.assign(new Error(senaryo.hata.message || 'komut başarısız'), senaryo.hata)
        cb(err, senaryo.stdout || '', senaryo.stderr || '')
        return
      }
      cb(null, senaryo.stdout ?? `${'[netflix_pipeline] 400 TMDB dizisi yüklendi'}\n${OZET}\n`, senaryo.stderr || '')
    }
    if (senaryo.firlat) throw new Error(senaryo.firlat)
    if (senaryo.gecikmeMs) setTimeout(bitir, senaryo.gecikmeMs)
    else bitir()
  })
  fn.cagrilar = []
  return fn
}

beforeEach(() => {
  metaDeposu.clear()
})

describe('isNetflixSyncDue — haftalık kapı', () => {
  it('hiç çalışmamışsa hemen sıradadır (ilk dolum)', () => {
    expect(isNetflixSyncDue({ now: CARSAMBA })).toBe(true)
  })

  it('Pazar gece yarısından sonraki ilk tetiklemede, geçen haftaki başarıya rağmen çalışır', () => {
    expect(isNetflixSyncDue({ now: PAZAR_0030, lastSuccessAt: PAZAR_0030 - 7 * GUN })).toBe(true)
  })

  it('aynı Pazar günü ikinci kez ÇALIŞMAZ (o hafta zaten yapıldı)', () => {
    expect(isNetflixSyncDue({ now: PAZAR_1500, lastSuccessAt: PAZAR_0030, lastAttemptAt: PAZAR_0030 })).toBe(false)
  })

  it('Pazar dışı bir günde, son başarı tazeyse çalışmaz', () => {
    expect(isNetflixSyncDue({ now: PAZARTESI_0100, lastSuccessAt: PAZAR_0030, lastAttemptAt: PAZAR_0030 })).toBe(false)
    expect(isNetflixSyncDue({ now: CUMARTESI_2300, lastSuccessAt: CUMARTESI_2300 - 6 * GUN })).toBe(false)
  })

  it('kaçırılan hafta telafisi: son başarı 8+ gün eskiyse gün fark etmez', () => {
    expect(isNetflixSyncDue({ now: CARSAMBA, lastSuccessAt: CARSAMBA - CATCH_UP_MS })).toBe(true)
    expect(isNetflixSyncDue({ now: CARSAMBA, lastSuccessAt: CARSAMBA - CATCH_UP_MS + SAAT })).toBe(false)
  })

  it('başarısız denemeden sonra 6 saat geri çekilir — 30 dakikada bir 15 dakikalık indirme yok', () => {
    expect(isNetflixSyncDue({ now: PAZAR_0030, lastAttemptAt: PAZAR_0030 - SAAT })).toBe(false)
    expect(isNetflixSyncDue({ now: PAZAR_0030, lastAttemptAt: PAZAR_0030 - RETRY_BACKOFF_MS })).toBe(true)
  })

  it('geri çekilme telafiyi de erteler (CDN sorunu saatler sürer, dakikalar değil)', () => {
    expect(
      isNetflixSyncDue({ now: CARSAMBA, lastSuccessAt: CARSAMBA - 10 * GUN, lastAttemptAt: CARSAMBA - 2 * SAAT })
    ).toBe(false)
  })
})

describe('runNetflixPipeline — alt süreç sarmalayıcısı', () => {
  it('betiği doğru argüman, dizin ve UTF-8 ortamıyla çağırır', async () => {
    const exec = sahteExec()
    const sonuc = await runNetflixPipeline({ exec, pythonBin: 'python-test' })

    expect(sonuc.status).toBe('ok')
    expect(sonuc.summary).toBe(OZET)
    const [cagri] = exec.cagrilar
    expect(cagri.bin).toBe('python-test')
    expect(cagri.args).toEqual([PIPELINE_SCRIPT, '--all'])
    expect(cagri.opts.cwd.replace(/\\/g, '/')).toMatch(/\/data-pipeline-python$/)
    expect(cagri.opts.env.PYTHONUTF8).toBe('1')
    expect(cagri.opts.timeout).toBeGreaterThan(0)
  })

  it('alt sürece sırlar GEÇMEZ, yalnızca beyaz listedeki değişkenler geçer', async () => {
    const onceki = { ...process.env }
    process.env.SERPAPI_API_KEY = 'gizli-serp'
    process.env.TMDB_API_KEY = 'gizli-tmdb'
    process.env.APP_PASSWORD = 'gizli-sifre'
    process.env.LLM_API_KEY = 'gizli-llm'
    process.env.NETFLIX_DOWNLOAD_DEADLINE_S = '540'
    try {
      const exec = sahteExec()
      await runNetflixPipeline({ exec })
      const env = exec.cagrilar[0].opts.env
      for (const gizli of ['SERPAPI_API_KEY', 'TMDB_API_KEY', 'APP_PASSWORD', 'LLM_API_KEY', 'ADMIN_EMAIL', 'OMDB_API_KEY']) {
        expect(env).not.toHaveProperty(gizli)
      }
      expect(env.NETFLIX_DOWNLOAD_DEADLINE_S).toBe('540')
      expect(env.PYTHONUTF8).toBe('1')
      expect(env.PATH ?? env.Path).toBeDefined()
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in onceki)) delete process.env[k]
      Object.assign(process.env, onceki)
    }
  })

  it('çıkış kodu ≠ 0 → failed, reddetmez, stderr taşınır', async () => {
    const exec = sahteExec({ hata: { code: 1, message: 'Command failed' }, stderr: 'Traceback: RuntimeError: hiç veri indirilemedi' })
    const sonuc = await runNetflixPipeline({ exec })
    expect(sonuc.status).toBe('failed')
    expect(sonuc.reason).toMatch(/çıkış kodu 1/)
    expect(sonuc.stderr).toMatch(/hiç veri indirilemedi/)
  })

  it('zaman aşımında (killed) anlaşılır bir gerekçe üretir', async () => {
    const exec = sahteExec({ hata: { killed: true, signal: 'SIGTERM', message: 'timeout' } })
    const sonuc = await runNetflixPipeline({ exec, timeoutMs: 30 * 60 * 1000 })
    expect(sonuc.status).toBe('failed')
    expect(sonuc.reason).toMatch(/zaman aşımı \(30 dk\)/)
  })

  it('Python bulunamazsa (ENOENT) PYTHON_BIN ipucu verir', async () => {
    const exec = sahteExec({ hata: { code: 'ENOENT', message: 'spawn python ENOENT' } })
    const sonuc = await runNetflixPipeline({ exec, pythonBin: 'python' })
    expect(sonuc.status).toBe('failed')
    expect(sonuc.reason).toMatch(/PYTHON_BIN/)
  })

  it('execFile kendisi fırlatsa bile promise reddedilmez', async () => {
    const exec = sahteExec({ firlat: 'geçersiz argüman' })
    await expect(runNetflixPipeline({ exec })).resolves.toMatchObject({ status: 'failed' })
  })
})

describe('runNetflixSyncIfNeeded — scheduler sözleşmesi', () => {
  it('sırası gelmediyse null döner ve alt süreç başlatılmaz', async () => {
    metaDeposu.set(META_LAST_SUCCESS, String(PAZAR_0030))
    metaDeposu.set(META_LAST_ATTEMPT, String(PAZAR_0030))
    const exec = sahteExec()

    const sonuc = await runNetflixSyncIfNeeded({ exec, now: PAZARTESI_0100 })

    expect(sonuc).toBeNull()
    expect(exec).not.toHaveBeenCalled()
  })

  it('başarıda son başarı + deneme zamanını yazar, hata kaydını temizler', async () => {
    metaDeposu.set(META_LAST_ERROR, 'eski hata')
    const exec = sahteExec()

    const sonuc = await runNetflixSyncIfNeeded({ exec, now: PAZAR_0030 })

    expect(sonuc.status).toBe('ok')
    expect(Number(metaDeposu.get(META_LAST_SUCCESS))).toBe(PAZAR_0030)
    expect(Number(metaDeposu.get(META_LAST_ATTEMPT))).toBe(PAZAR_0030)
    expect(metaDeposu.get(META_LAST_ERROR)).toBe('')
  })

  it('başarısızlıkta FIRLATMAZ, başarı kapısını kapatmaz, hatayı meta ve günlüğe yazar', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exec = sahteExec({ hata: { code: 1, message: 'Command failed' }, stderr: 'RuntimeError: CDN' })

    const sonuc = await runNetflixSyncIfNeeded({ exec, now: PAZAR_0030 })

    expect(sonuc.status).toBe('failed')
    expect(metaDeposu.has(META_LAST_SUCCESS)).toBe(false)
    expect(Number(metaDeposu.get(META_LAST_ATTEMPT))).toBe(PAZAR_0030)
    expect(metaDeposu.get(META_LAST_ERROR)).toMatch(/çıkış kodu 1/)
    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/\[netflix-sync\] başarısız/))
    consoleError.mockRestore()
  })

  it('başarısızlıktan hemen sonraki tetikleme geri çekilme yüzünden atlanır (graceful degradation)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const exec = sahteExec({ hata: { code: 1 } })
    await runNetflixSyncIfNeeded({ exec, now: PAZAR_0030 })

    const ikinci = await runNetflixSyncIfNeeded({ exec, now: PAZAR_0030 + 30 * 60 * 1000 })

    expect(ikinci).toBeNull()
    expect(exec).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('bir koşu sürerken ikinci tetikleme paralel süreç başlatmaz', async () => {
    const exec = sahteExec({ gecikmeMs: 30 })
    const birinci = runNetflixSyncIfNeeded({ exec, now: PAZAR_0030 })
    const ikinci = await runNetflixSyncIfNeeded({ exec, now: PAZAR_0030 })

    expect(ikinci).toEqual({ status: 'skipped', reason: 'running' })
    await birinci
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('meta yazımı fırlatsa bile çağıranı düşürmez ve bayrağı bırakır', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exec = sahteExec()
    const orijinalSet = metaDeposu.set.bind(metaDeposu)
    let patlat = true
    metaDeposu.set = (k, v) => {
      if (patlat) {
        patlat = false
        throw new Error('database is locked')
      }
      return orijinalSet(k, v)
    }

    const sonuc = await runNetflixSyncIfNeeded({ exec, now: PAZAR_0030 })
    metaDeposu.set = orijinalSet

    expect(sonuc.status).toBe('failed')
    const tekrar = await runNetflixSyncIfNeeded({ exec, now: PAZAR_0030 })
    expect(tekrar.status).toBe('ok')
    consoleError.mockRestore()
  })
})
