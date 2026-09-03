// Gecici dogrulama betigi: internet cikisi OLMAYAN bir intranet ortamini taklit eder.
import { chromium } from 'playwright'
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('server/.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)

const BASE = 'http://localhost:3001'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })

const external = []
await ctx.route('**/*', (route) => {
  const url = route.request().url()
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue()
  external.push(url)
  return route.abort()
})

const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })

const emailInput = page.locator('input[type="email"]')
if (await emailInput.count()) {
  await emailInput.fill(env.ADMIN_EMAIL)
  await page.locator('input[type="password"]').fill(env.APP_PASSWORD)
  await page.locator('button[type="submit"]').click()
  await page.waitForTimeout(5000)
}
await page.waitForTimeout(9000)

const info = await page.evaluate(async () => {
  const res = await fetch('/map/countries-110m.geojson')
  const gj = await res.json()
  const noIso = gj.features.filter((f) => !f.properties.ISO_A2 || f.properties.ISO_A2 === '-99')
    .map((f) => f.properties.ADM0_A3 + ':' + f.properties.NAME)
  return {
    featureCount: gj.features.length,
    minusNinetyNine: noIso,
    canvases: document.querySelectorAll('canvas').length,
  }
})
await page.screenshot({ path: 'scripts/_intranet-globe.png' })

for (const label of ['2D', 'Harita', 'Duz']) {
  const btn = page.getByRole('button', { name: new RegExp(label, 'i') })
  if (await btn.count()) { await btn.first().click().catch(() => {}); break }
}
await page.waitForTimeout(3500)
const map2d = await page.evaluate(() => {
  const paths = Array.from(document.querySelectorAll('.map2d__svg path'))
  const fills = {}
  for (const p of paths) fills[p.getAttribute('fill')] = (fills[p.getAttribute('fill')] || 0) + 1
  return { pathCount: paths.length, distinctFills: Object.keys(fills).length }
})
await page.screenshot({ path: 'scripts/_intranet-map2d.png' })

console.log(JSON.stringify({
  disaCikanIstekSayisi: external.length,
  disaCikanIstekler: [...new Set(external)].slice(0, 10),
  geojson: info,
  map2d,
  konsolHatalari: errors.slice(0, 8),
}, null, 2))

await browser.close()
