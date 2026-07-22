import db from './db.js'

function normalizeKey(seriesName) {
  return seriesName.trim().toLocaleLowerCase('tr')
}

const getStmt = db.prepare('SELECT * FROM social_listening_cache WHERE key = ?')
const insertStmt = db.prepare(`
  INSERT INTO social_listening_cache (key, series_name, queried_at, knowledge_graph, youtube)
  VALUES (?, ?, ?, ?, ?)
`)

async function serpapiGet(params) {
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) {
    throw new Error('SERPAPI_API_KEY tanımlı değil (.env dosyasını kontrol et)')
  }
  const url = new URL('https://serpapi.com/search.json')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('api_key', apiKey)

  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('SerpAPI aylık ücretsiz kota dolmuş görünüyor (429).')
    }
    throw new Error(`SerpAPI isteği başarısız (${res.status})`)
  }
  const data = await res.json()
  if (data.error) {
    throw new Error(`SerpAPI hatası: ${data.error}`)
  }
  return data
}

// Google Bilgi Grafiği — dizinin izleyici/eleştirmen beğeni oranları (varsa).
async function fetchKnowledgeGraph(seriesName) {
  const data = await serpapiGet({ engine: 'google', q: `${seriesName} dizi`, hl: 'tr', gl: 'tr' })
  const kg = data.knowledge_graph
  if (!kg || !kg.ratings || kg.ratings.length === 0) return null
  return {
    title: kg.title || seriesName,
    ratings: kg.ratings.map((r) => ({ source: r.source, rating: r.rating, link: r.link || null })),
  }
}

// YouTube — dizinin fragmanının izlenme/kanal bilgisi (platform popülerliğini
// görsel tüketim verisiyle doğrulamak için).
async function fetchYouTube(seriesName) {
  const data = await serpapiGet({ engine: 'youtube', search_query: `${seriesName} fragman` })
  const top = (data.video_results || [])[0]
  if (!top) return null
  return {
    title: top.title,
    channel: top.channel?.name || null,
    channelVerified: Boolean(top.channel?.verified),
    views: top.views ?? null,
    publishedDate: top.published_date || null,
    link: top.link,
    thumbnail: top.thumbnail?.static || null,
  }
}

// Knowledge Graph + YouTube'u tek seferde toplayıp sonucu kalıcı olarak
// cache'ler — Google Trends katmanıyla aynı felsefe: her dizi yalnızca ilk
// sorguda SerpAPI kotası harcar.
export async function querySocialListening(seriesName) {
  const key = normalizeKey(seriesName)
  const row = getStmt.get(key)
  if (row) {
    return {
      seriesName: row.series_name,
      queriedAt: row.queried_at,
      knowledgeGraph: JSON.parse(row.knowledge_graph),
      youtube: JSON.parse(row.youtube),
      fromCache: true,
    }
  }

  const [knowledgeGraph, youtube] = await Promise.all([
    fetchKnowledgeGraph(seriesName).catch((err) => ({ error: err.message })),
    fetchYouTube(seriesName).catch((err) => ({ error: err.message })),
  ])

  const queriedAt = new Date().toISOString()
  insertStmt.run(key, seriesName, queriedAt, JSON.stringify(knowledgeGraph), JSON.stringify(youtube))

  return { seriesName, queriedAt, knowledgeGraph, youtube, fromCache: false }
}
