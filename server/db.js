import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')

const DB_PATH = process.env.APP_DB_PATH || path.join(DATA_DIR, 'app.db')

fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')

export function inTransaction(fn) {
  db.exec('BEGIN')
  try {
    const sonuc = fn()
    db.exec('COMMIT')
    return sonuc
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // İşlem zaten sonlanmış olabilir (ör. bağlantı kapandı); asıl hata aşağıda fırlatılıyor.
    }
    throw err
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS cache_entries (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS theme_classifications (
    id INTEGER PRIMARY KEY,
    name TEXT,
    overview TEXT,
    theme TEXT,
    confidence INTEGER,
    classified_at TEXT,
    override_theme TEXT,
    override_reviewer TEXT,
    override_at TEXT
  );

  CREATE TABLE IF NOT EXISTS destination_classifications (
    id INTEGER PRIMARY KEY,
    name TEXT,
    overview TEXT,
    auto_detected TEXT,
    detected_at TEXT,
    human_tags_destinations TEXT,
    human_tags_reviewer TEXT,
    human_tags_at TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT UNIQUE,
    role TEXT,
    password_hash TEXT,
    status TEXT,
    is_admin INTEGER,
    access_level TEXT,
    created_at TEXT,
    decided_at TEXT,
    decided_by TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT,
    expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS visibility_history (
    iso2 TEXT,
    score REAL,
    captured_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_visibility_history_iso2 ON visibility_history(iso2);

  -- SÜRESİZ (TTL'siz) eski SerpAPI önbellek tabloları — server/services/serpApiCache.js artık
  -- bunların yerine genel amaçlı, TTL'li cache_entries'i kullanıyor (bkz. serpApiCache.js'in
  -- başındaki not ve migrateLegacySerpApiCaches). Bu üçü SADECE bir kerelik geçiş (zaten
  -- harcanmış SerpAPI kotasıyla çekilmiş veriyi kaybetmemek için) kaynağı olarak DROP
  -- EDİLMİYOR — yeni kod bunlara hiç yazmıyor/okumuyor.
  CREATE TABLE IF NOT EXISTS trends_cache (
    key TEXT PRIMARY KEY,
    series_name TEXT,
    queried_at TEXT,
    by_country TEXT
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- Yerel başlıkla (IMDb/Wikipedia yerel adı) yapılan Google Trends ülke kırılımı sorguları.
  -- trends_cache Türkçe adla sorgular ve Latin Amerika/Orta Doğu'da ~0 döner; izlenme sinyalinin
  -- arama bileşeni iki tabloyu birlikte okur. by_country: [{country, value}] JSON.
  CREATE TABLE IF NOT EXISTS search_signal_cache (
    query TEXT PRIMARY KEY,
    lang TEXT,
    tmdb_id INTEGER,
    series_name TEXT,
    queried_at TEXT,
    by_country TEXT
  );

  CREATE TABLE IF NOT EXISTS social_listening_cache (
    key TEXT PRIMARY KEY,
    series_name TEXT,
    queried_at TEXT,
    knowledge_graph TEXT,
    youtube TEXT,
    news_sentiment TEXT
  );

  CREATE TABLE IF NOT EXISTS imdb_cache (
    imdb_id TEXT PRIMARY KEY,
    rating REAL,
    votes INTEGER,
    top_cast TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS classification_failures (
    id INTEGER PRIMARY KEY,
    name TEXT,
    overview TEXT,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_failed_at INTEGER,
    next_retry_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS destination_classification_failures (
    id INTEGER PRIMARY KEY,
    name TEXT,
    overview TEXT,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_failed_at INTEGER,
    next_retry_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS turkish_learning_cache (
    key TEXT PRIMARY KEY,
    queried_at TEXT,
    by_country TEXT
  );

  CREATE TABLE IF NOT EXISTS benchmark_history (
    country_code TEXT,
    total_score REAL,
    captured_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_benchmark_history_code ON benchmark_history(country_code);

  CREATE TABLE IF NOT EXISTS regional_interest_cache (
    key TEXT PRIMARY KEY,
    series_name TEXT,
    iso2 TEXT,
    queried_at TEXT,
    by_region TEXT
  );

  CREATE TABLE IF NOT EXISTS duolingo_history (
    total_learners INTEGER,
    captured_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS visibility_history_monthly (
    iso2 TEXT,
    year INTEGER,
    month INTEGER,
    avg_score REAL,
    sample_count INTEGER,
    PRIMARY KEY (iso2, year, month)
  );

  -- Türkiye'de okuyan uluslararası öğrenciler, geldikleri ülkeye göre, yıllık (UNESCO İstatistik Enstitüsü;
  -- Türkiye verisini YÖK bildirir). server/services/foreignStudents.js aylık eşitler.
  CREATE TABLE IF NOT EXISTS foreign_students (
    iso2 TEXT NOT NULL,
    year INTEGER NOT NULL,
    students INTEGER NOT NULL,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (iso2, year)
  );

  CREATE TABLE IF NOT EXISTS tourist_arrivals (
    iso2 TEXT,
    year INTEGER,
    month INTEGER,
    visitor_count INTEGER,
    source_bulletin TEXT,
    imported_at TEXT,
    PRIMARY KEY (iso2, year, month)
  );

  -- "Yayındaki diziler" listesinin Aylık/Yıllık/5 Yıllık dönemlere göre yeniden
  -- sıralanabilmesi için — TMDB popülerliği ülkeye özel değil (tek global değer, bkz.
  -- server/series-period-history.js), bu yüzden ülke bazında değil sadece dizi (tmdb_id)
  -- bazında tutuluyor; bir ülkedeki sıralama, o ülkenin GÜNCEL yayın listesini bu tabloyla
  -- eşleştirerek client-side/handler'da yapılır.
  CREATE TABLE IF NOT EXISTS series_popularity_history (
    tmdb_id INTEGER,
    popularity REAL,
    captured_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_series_popularity_history_id ON series_popularity_history(tmdb_id);

  -- Denetim bulgusu B-08: birincil anahtar source sutununu ICERMEK ZORUNDA. Ayni (dizi, yil, ay)
  -- icin iki farkli olcum kaynagi vardir: Node'un TMDB anlik goruntu ortalamasi ve Python'un
  -- ReytingTV geriye donuk sira skoru. Okuyucu taraf (series-period-history.js) zaten ikisini
  -- AYRI tutup dizi basina birini sececek sekilde yazilmis; source anahtara dahil olmadigi icin
  -- Python'un upsert'i TMDB satirini eziyor ve o ayin TMDB olcumu kalici olarak kayboluyordu.
  CREATE TABLE IF NOT EXISTS series_popularity_monthly (
    tmdb_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    avg_popularity REAL,
    sample_count INTEGER,
    source TEXT NOT NULL DEFAULT 'tmdb_snapshot',
    PRIMARY KEY (tmdb_id, year, month, source)
  );

  -- Proje raporu §4.6 "Basın/Haber Duygu Analizi" — bkz. server/services/newsSentiment.js.
  -- trends_cache/social_listening_cache gibi ham SerpAPI yanıtı değil, LLM'in ÜRETTİĞİ bir
  -- analiz sonucu tutulduğu için (kendi TTL'i, kendi "son 5 haber" sorgu şekli var) ayrı bir
  -- tablo — genel amaçlı cache_entries'e sıkıştırmak yerine gerçek sütunlarla tutuluyor ki
  -- Analist Paneli ileride bunu doğrudan SELECT ile listeleyebilsin.
  CREATE TABLE IF NOT EXISTS media_sentiment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id INTEGER NOT NULL,
    country_iso2 TEXT NOT NULL,
    query_used TEXT,
    total_news_count INTEGER,
    positive_score REAL,
    neutral_score REAL,
    negative_score REAL,
    dominant_sentiment TEXT,
    llm_summary TEXT,
    raw_articles TEXT,
    created_at TEXT,
    expires_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_media_sentiment_series_country
    ON media_sentiment(series_id, country_iso2);

  -- bkz. server/services/tourismTrendsCollector.js — "3-6 Aylık Öncü Turizm Sinyali". Ham
  -- SerpAPI TIMESERIES yanıtı zaten cache_entries'te (fetchTrendsTimeSeriesRaw, TTL'li); burada
  -- tutulan onun TÜRETİLMİŞ sonucu (gecikmeli korelasyon + örneklem) — media_sentiment ile aynı
  -- gerekçe: turizm özetlerinin SQL ile doğrudan okuyabileceği gerçek sütunlar.
  CREATE TABLE IF NOT EXISTS tourism_leading_signal (
    country_iso2 TEXT NOT NULL,
    travel_query TEXT NOT NULL,
    top_series_name TEXT,
    lag_weeks INTEGER,
    correlation REAL,
    sample_size INTEGER,
    computed_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (country_iso2, travel_query)
  );

  -- bkz. server/services/actorTrendsCollector.js — en popüler 30 oyuncunun hedef ülkelerdeki
  -- Google Trends ilgisi. Ham SerpAPI GEO_MAP_0 yanıtı zaten cache_entries'te (aynı
  -- fetchTrendsByCountryRaw, actorTrendsCacheKey ile); burada tutulan hedef ülke havuzuna göre
  -- FİLTRELENMİŞ, sorgulanabilir hâli — media_sentiment/tourism_leading_signal ile aynı gerekçe.
  CREATE TABLE IF NOT EXISTS actor_country_interest (
    actor_id INTEGER NOT NULL,
    actor_name TEXT NOT NULL,
    country_iso2 TEXT NOT NULL,
    interest_value REAL,
    computed_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (actor_id, country_iso2)
  );

  -- Wikipedia okunma sayısı katmanı (bkz. server/services/wikipediaPageviews.js).
  -- NEDEN EKLENDİ: platformun uluslararası zaman derinliği yalnızca 63 gündü
  -- (visibility_history 2026-07-20 -> 2026-09-21), yani "şu ülkede ilgi arttı" gibi HİÇBİR trend
  -- iddiası dürüstçe kurulamıyordu. Wikimedia'nın Pageviews API'si ücretsiz, anahtarsız ve
  -- 2015'e kadar geriye gidiyor — yani geçmiş BEKLENMEDEN geri doldurulabiliyor.
  --
  -- Bir dizinin hangi dilde hangi başlıkla yer aldığı: TMDB external_ids -> wikidata_id ->
  -- Wikidata sitelinks zinciriyle çözülüyor. Ad eşleştirmesi YAPILMIYOR (kırılgan olurdu).
  CREATE TABLE IF NOT EXISTS series_wiki_articles (
    tmdb_id INTEGER NOT NULL,
    lang TEXT NOT NULL,
    wikidata_id TEXT,
    title TEXT NOT NULL,
    resolved_at TEXT NOT NULL,
    PRIMARY KEY (tmdb_id, lang)
  );

  -- ÖNEMLİ DÜRÜSTLÜK SINIRI: burada saklanan birim DİL'dir, ÜLKE değil. Wikimedia makale bazında
  -- ülke kırılımı yayınlamıyor (gizlilik gerekçesiyle). Arapça okunma "hangi Arap ülkesi"
  -- sorusunu cevaplamaz. Ülke ataması yapılacaksa bu tablodan TÜRETİLİR ve arayüzde ayrıca
  -- "dil bazlı tahmin" olarak etiketlenir — ham katman asla ülke gibi gösterilmez.
  CREATE TABLE IF NOT EXISTS series_language_interest (
    tmdb_id INTEGER NOT NULL,
    lang TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    views INTEGER NOT NULL,
    PRIMARY KEY (tmdb_id, lang, year, month)
  );

  -- YouTube Analytics (2026-10-06): yayıncı kanalların sahiplerinin verdiği salt okunur izinle, kanalın kendi
  -- izlenme raporları. Yenileme anahtarı şifreli saklanır (YOUTUBE_TOKEN_KEY, AES-256-GCM); düz metin yazılmaz.
  CREATE TABLE IF NOT EXISTS youtube_channels (
    channel_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    thumbnail TEXT,
    uploads_playlist TEXT,
    refresh_token_enc TEXT NOT NULL,
    connected_by TEXT,
    connected_at TEXT NOT NULL,
    last_sync_at TEXT,
    last_error TEXT,
    backfill_page_token TEXT,
    backfill_done INTEGER NOT NULL DEFAULT 0,
    last_full_month TEXT
  );

  -- Kanalın yüklediği videolar ve eşlendiği dizi (başlıktan; eşleşmeyen video series_id NULL kalır).
  CREATE TABLE IF NOT EXISTS youtube_videos (
    video_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT,
    series_id INTEGER
  );

  -- Ülke × ay izlenme. series_id 0 = kanalın bütün videoları (dizi eşlemesinden bağımsız kanal toplamı).
  -- period: 'YYYY-MM', yalnızca tamamlanmış aylar.
  CREATE TABLE IF NOT EXISTS youtube_country_views (
    channel_id TEXT NOT NULL,
    series_id INTEGER NOT NULL,
    iso2 TEXT NOT NULL,
    period TEXT NOT NULL,
    views INTEGER NOT NULL,
    minutes INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (channel_id, series_id, iso2, period)
  );

  -- YouTube herkese açık veri (API anahtarı, izin gerektirmez): resmî yayıncı kanallarının videoları, son
  -- sayıları ve dizi başına günlük toplam. Ülke kırılımı YOKTUR (o yalnızca izinli Analytics'te).
  CREATE TABLE IF NOT EXISTS yt_public_channels (
    handle TEXT PRIMARY KEY,
    channel_id TEXT,
    title TEXT,
    uploads_playlist TEXT,
    page_token TEXT,
    backfill_done INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT,
    last_error TEXT
  );

  CREATE TABLE IF NOT EXISTS yt_public_videos (
    video_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT,
    series_id INTEGER,
    views INTEGER,
    likes INTEGER,
    comments INTEGER,
    stats_at TEXT
  );

  CREATE TABLE IF NOT EXISTS yt_series_daily (
    series_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    videos INTEGER NOT NULL,
    views INTEGER NOT NULL,
    likes INTEGER NOT NULL,
    comments INTEGER NOT NULL,
    PRIMARY KEY (series_id, date)
  );

  -- Televizyon yayın akışları (2026-10-06; DStv ve StarTimes'ın yazılı izniyle): ülke × kanal × gün başına
  -- Türk dizisi yayın sayısı. Yalnızca rehberdeki program adı ve saati kullanılır.
  CREATE TABLE IF NOT EXISTS tv_airings (
    provider TEXT NOT NULL,
    iso2 TEXT NOT NULL,
    channel TEXT NOT NULL,
    series_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    slots INTEGER NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (provider, iso2, channel, series_id, date)
  );

  -- Rehberde görülen başlıklar (dizi kanallarında): eşleşmeyenler yönetim ekranında elle diziye bağlanabilir.
  CREATE TABLE IF NOT EXISTS tv_titles (
    provider TEXT NOT NULL,
    channel TEXT NOT NULL,
    title TEXT NOT NULL,
    series_id INTEGER,
    manual INTEGER NOT NULL DEFAULT 0,
    countries INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (provider, channel, title)
  );

  -- Dağıtımcı satış kayıtları (Türk dağıtımcıların izinle paylaştığı tablo): hangi dizi hangi ülkede hangi
  -- kanala/platforma satıldı.
  CREATE TABLE IF NOT EXISTS distribution_sales (
    series_id INTEGER NOT NULL,
    iso2 TEXT NOT NULL,
    buyer TEXT NOT NULL,
    distributor TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (series_id, iso2, buyer, distributor)
  );

  -- Yorum dili örneklemi (dizinin son bölümlerinden): dil ülke değildir.
  CREATE TABLE IF NOT EXISTS yt_comment_langs (
    series_id INTEGER NOT NULL,
    lang TEXT NOT NULL,
    comments INTEGER NOT NULL,
    sampled INTEGER NOT NULL,
    sampled_at TEXT NOT NULL,
    PRIMARY KEY (series_id, lang)
  );
`)

db.exec('DROP TABLE IF EXISTS spot_checks')

db.exec('DROP TABLE IF EXISTS trakt_cache')

const cacheColumns = db.prepare('PRAGMA table_info(cache_entries)').all()
if (!cacheColumns.some((c) => c.name === 'updated_at')) {
  db.exec('ALTER TABLE cache_entries ADD COLUMN updated_at INTEGER')
}

const usersColumns = db.prepare('PRAGMA table_info(users)').all()
if (!usersColumns.some((c) => c.name === 'access_level')) {
  db.exec('ALTER TABLE users ADD COLUMN access_level TEXT')
  db.exec(
    "UPDATE users SET access_level = CASE WHEN is_admin = 1 THEN 'admin' ELSE 'analyst' END WHERE access_level IS NULL"
  )
}

const themeColumns = db.prepare('PRAGMA table_info(theme_classifications)').all()
if (themeColumns.some((c) => c.name === 'sentiment')) {
  db.exec('ALTER TABLE theme_classifications DROP COLUMN sentiment')
}

const destColumns = db.prepare('PRAGMA table_info(destination_classifications)').all()
if (!destColumns.some((c) => c.name === 'detection_method')) {
  db.exec('ALTER TABLE destination_classifications ADD COLUMN detection_method TEXT')
  db.exec("UPDATE destination_classifications SET detection_method = 'keyword' WHERE detection_method IS NULL")
}

const mediaSentimentColumns = db.prepare('PRAGMA table_info(media_sentiment)').all()
if (!mediaSentimentColumns.some((c) => c.name === 'override_sentiment')) {
  db.exec('ALTER TABLE media_sentiment ADD COLUMN override_sentiment TEXT')
  db.exec('ALTER TABLE media_sentiment ADD COLUMN override_reviewer TEXT')
  db.exec('ALTER TABLE media_sentiment ADD COLUMN override_at TEXT')
}

if (!mediaSentimentColumns.some((c) => c.name === 'source')) {
  db.exec('ALTER TABLE media_sentiment ADD COLUMN source TEXT')
  db.exec("UPDATE media_sentiment SET source = 'serpapi' WHERE source IS NULL")
}

const seriesMonthlyColumns = db.prepare('PRAGMA table_info(series_popularity_monthly)').all()
if (!seriesMonthlyColumns.some((c) => c.name === 'source')) {
  db.exec('ALTER TABLE series_popularity_monthly ADD COLUMN source TEXT')
}
db.exec("UPDATE series_popularity_monthly SET source = 'tmdb_snapshot' WHERE source IS NULL")

const seriesMonthlyPk = db
  .prepare('PRAGMA table_info(series_popularity_monthly)')
  .all()
  .filter((c) => c.pk > 0)
  .map((c) => c.name)
if (!seriesMonthlyPk.includes('source')) {
  inTransaction(() => {
    db.exec(`
    CREATE TABLE series_popularity_monthly_yeni (
      tmdb_id INTEGER NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      avg_popularity REAL,
      sample_count INTEGER,
      source TEXT NOT NULL DEFAULT 'tmdb_snapshot',
      PRIMARY KEY (tmdb_id, year, month, source)
    );
    INSERT INTO series_popularity_monthly_yeni (tmdb_id, year, month, avg_popularity, sample_count, source)
      SELECT tmdb_id, year, month, avg_popularity, sample_count, COALESCE(source, 'tmdb_snapshot')
      FROM series_popularity_monthly;
    DROP TABLE series_popularity_monthly;
    ALTER TABLE series_popularity_monthly_yeni RENAME TO series_popularity_monthly;
    `)
  })
  console.log('[db] series_popularity_monthly birincil anahtarı source ile genişletildi (B-08)')
}

export default db
