import fs from 'node:fs'
import path from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'
import { Agent, setGlobalDispatcher } from 'undici'

const LLM_TIMEOUT_MS = 25_000
const MAX_RETRIES = 2
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CA_PATH = path.join(__dirname, 'internal-ca-chain.pem')

// Bu iç LLM sunucusunun TLS el sıkışmasında sadece leaf sertifikayı gönderiyor,
// ara sertifikayı göndermiyor — Node'un varsayılan güven deposu zinciri
// tamamlayamıyor (tarayıcılar/Windows bunu otomatik tamamlıyor, Node etmiyor).
// Zinciri (leaf+ara+kök) elle çıkarıp global fetch dispatcher'ına tanıtıyoruz.
// ÖNEMLİ: `ca` verilince Node'un varsayılan güvenilen kök sertifika listesi
// TAMAMEN değişiyor (eklenmiyor) — bu yüzden tls.rootCertificates'i de dahil
// ediyoruz, yoksa SerpAPI/TMDB gibi normal genel internet siteleri "fetch
// failed" ile başarısız olur (bu proje daha önce tam olarak bu hataya düştü).
if (fs.existsSync(CA_PATH)) {
  const extraCa = fs.readFileSync(CA_PATH, 'utf8')
  setGlobalDispatcher(new Agent({ connect: { ca: [...tls.rootCertificates, extraCa] } }))
}

function extractJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`LLM cevabında JSON bulunamadı: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text.slice(start, end + 1))
}

// Dahili OpenAI-uyumlu LLM sunucusuna tek seferlik bir prompt gönderip JSON
// cevap döndürür. Model "reasoning" tipi olduğu için enable_thinking kapatılıyor,
// yoksa cevaptan önce uzun bir düşünme metni geliyor ve JSON'a ulaşamadan
// max_tokens'a takılıyor.
async function callLLMForJson(prompt, maxTokens = 300) {
  const baseUrl = process.env.LLM_BASE_URL
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL
  if (!baseUrl || !model) {
    throw new Error('LLM_BASE_URL / LLM_MODEL tanımlı değil (.env dosyasını kontrol et)')
  }

  let lastError
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey || 'not-needed'}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.2,
          chat_template_kwargs: { enable_thinking: false },
        }),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        lastError = new Error(`LLM isteği başarısız (${res.status}): ${text.slice(0, 300)}`)
        if (!RETRYABLE_STATUSES.has(res.status) || attempt === MAX_RETRIES) throw lastError
      } else {
        const data = await res.json()
        const content = data.choices?.[0]?.message?.content
        if (!content) throw new Error('LLM boş cevap döndü')
        return extractJson(content)
      }
    } catch (err) {
      lastError = err.name === 'AbortError' ? new Error(`LLM isteği ${LLM_TIMEOUT_MS / 1000} saniyede zaman aşımına uğradı`) : err
      if (attempt === MAX_RETRIES) throw lastError
    } finally {
      clearTimeout(timer)
    }
    await wait(750 * 2 ** attempt)
  }
  throw lastError
}

// Dizi özetinden tema/güven skoru çıkarır.
export async function classifyWithLLM(overview, themes) {
  const prompt = `Aşağıda bir Türk dizisinin özeti var. Şunları belirle:
1. theme: Bu listeden TAM OLARAK bir tanesini seç: ${themes.join(', ')}
2. confidence: 0-100 arası tam sayı — temanın özetten ne kadar net/güvenilir çıkarıldığına dair güven skoru (özet belirsiz veya çok kısaysa düşük ver)

Özet: """${overview || '(özet yok)'}"""

Sadece şu formatta JSON döndür, başka hiçbir açıklama veya düşünce metni yazma:
{"theme": "...", "confidence": 0}`

  const parsed = await callLLMForJson(prompt, 300)
  if (!themes.includes(parsed.theme)) {
    throw new Error(`LLM geçersiz tema döndürdü: ${parsed.theme}`)
  }
  return {
    theme: parsed.theme,
    confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence)))),
  }
}
