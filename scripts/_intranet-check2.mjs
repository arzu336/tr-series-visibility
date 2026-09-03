import { chromium } from 'playwright'
import fs from 'node:fs'
const env = Object.fromEntries(
  fs.readFileSync('server/.env','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#'))
    .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const BASE='http://localhost:3001'
const browser=await chromium.launch()
const ctx=await browser.newContext({viewport:{width:1440,height:900}})
const external=[]
await ctx.route('**/*',(r)=>{const u=r.request().url()
  if(u.startsWith(BASE)||u.startsWith('data:')||u.startsWith('blob:')) return r.continue()
  external.push(u); return r.abort()})
const page=await ctx.newPage()
const errors=[]
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
page.on('pageerror',e=>errors.push('pageerror: '+e.message))
await page.goto(BASE,{waitUntil:'domcontentloaded'})
if(await page.locator('input[type="email"]').count()){
  await page.locator('input[type="email"]').fill(env.ADMIN_EMAIL)
  await page.locator('input[type="password"]').fill(env.APP_PASSWORD)
  await page.locator('button[type="submit"]').click()
  await page.waitForTimeout(5000)}
await page.waitForTimeout(10000)

// Fransa / Norvec dolgusu (aria-label veya <title> uzerinden bulunur)
const fills = await page.evaluate(() => {
  const paths=[...document.querySelectorAll('.map2d__svg path')]
  const pick=(name)=>{
    const p=paths.find(el=>(el.getAttribute('aria-label')||el.querySelector('title')?.textContent||'')
      .toLowerCase().includes(name))
    return p ? {fill:p.getAttribute('fill'), label:(p.getAttribute('aria-label')||p.querySelector('title')?.textContent||'').trim()} : null
  }
  // Anahtar tekrari kontrolu: React ayni key'i iki kez gorurse uyarir; burada dolgu cesitliligini olcuyoruz
  return {fransa:pick('fransa')||pick('france'), norvec:pick('norveç')||pick('norvec')||pick('norway'),
          almanya:pick('almanya')||pick('germany')}
})

// 3D kureye gec
let globeInfo=null
for (const rx of [/3D/i, /küre/i, /kure/i, /globe/i]) {
  const b=page.getByRole('button',{name:rx})
  if(await b.count()){ await b.first().click().catch(()=>{}); break }
}
await page.waitForTimeout(9000)
globeInfo=await page.evaluate(()=>{
  const c=document.querySelector('canvas')
  if(!c) return {canvas:false}
  const g=c.getContext('webgl2')||c.getContext('webgl')
  return {canvas:true, w:c.width, h:c.height, webgl:!!g}
})
await page.screenshot({path:'scripts/_intranet-globe.png'})
console.log(JSON.stringify({disaCikanIstekSayisi:external.length, disaCikanIstekler:[...new Set(external)].slice(0,10),
  fills, globeInfo, konsolHatalari:errors.slice(0,8)},null,2))
await browser.close()
