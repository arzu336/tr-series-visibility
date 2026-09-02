import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, 'data', 'app.db')

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

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

  CREATE TABLE IF NOT EXISTS series_popularity_monthly (
    tmdb_id INTEGER,
    year INTEGER,
    month INTEGER,
    avg_popularity REAL,
    sample_count INTEGER,
    PRIMARY KEY (tmdb_id, year, month)
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
  -- gerekçe: /api/impact/tourism'in SQL ile doğrudan özetleyebileceği gerçek sütunlar.
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
`)

// Rastgele Denetim özelliği kaldırıldı — sadece test verisi biriktirmişti,
// gerçek kullanım yoktu.
db.exec('DROP TABLE IF EXISTS spot_checks')

// Trakt.tv entegrasyonu kaldırıldı, yerine OMDb API tabanlı imdb_cache geldi
// (bkz. server/imdb.js) — eski kurulumlarda kalan tabloyu temizliyoruz.
db.exec('DROP TABLE IF EXISTS trakt_cache')

const cacheColumns = db.prepare("PRAGMA table_info(cache_entries)").all()
if (!cacheColumns.some((c) => c.name === 'updated_at')) {
  db.exec('ALTER TABLE cache_entries ADD COLUMN updated_at INTEGER')
}

// Erişim düzeyi (viewer/analyst/admin) eklendi. Var olan onaylı hesaplar önceki
// davranışla eşleşsin diye (rol kısıtı hiç yoktu, herkes düzenleyebiliyordu):
// is_admin=1 olanlar 'admin', geri kalanlar 'analyst' olarak taşınır. Yeni
// kayıtlar artık en az yetkiyle ('viewer') başlar (bkz. users.js registerUser).
const usersColumns = db.prepare("PRAGMA table_info(users)").all()
if (!usersColumns.some((c) => c.name === 'access_level')) {
  db.exec("ALTER TABLE users ADD COLUMN access_level TEXT")
  db.exec("UPDATE users SET access_level = CASE WHEN is_admin = 1 THEN 'admin' ELSE 'analyst' END WHERE access_level IS NULL")
}

// Sentiment analizi kaldırıldı (Analist Paneli'nde gösterilmiyordu, hiçbir
// hesaplamada kullanılmıyordu) — eski kurulumlarda kalan sütunu temizliyoruz.
const themeColumns = db.prepare("PRAGMA table_info(theme_classifications)").all()
if (themeColumns.some((c) => c.name === 'sentiment')) {
  db.exec('ALTER TABLE theme_classifications DROP COLUMN sentiment')
}

// Destinasyon tespiti artık birincil olarak LLM kullanıyor (bkz. server/destinations.js,
// server/llm.js classifyDestinationsWithLLM), eski anahtar kelime taraması sadece LLM
// başarısız olursa devreye giriyor — hangi yöntemin kullanıldığını (Analist Paneli'nde
// şeffaflık için) ayırt edebilmek üzere kolon ekleniyor. Var olan kayıtlar (bu değişiklikten
// önce hep anahtar kelimeyle üretilmişti) 'keyword' olarak işaretlenir ki LLM'e yeniden
// denenmeleri için "pending" sayılsınlar (bkz. ensureDetected'teki pending filtresi).
const destColumns = db.prepare("PRAGMA table_info(destination_classifications)").all()
if (!destColumns.some((c) => c.name === 'detection_method')) {
  db.exec("ALTER TABLE destination_classifications ADD COLUMN detection_method TEXT")
  db.exec("UPDATE destination_classifications SET detection_method = 'keyword' WHERE detection_method IS NULL")
}

// Analist Paneli'nin "Basın & Medya Algısı" denetim sekmesi — bir analist LLM'in belirlediği
// dominant_sentiment'i yanlış bulursa (ör. ironik bir eleştiriyi nötr işaretlemiş) düzeltebilsin
// diye. theme_classifications'taki override_theme / destination_classifications'taki
// human_tags_* İLE AYNI DESEN: ham LLM sonucu (dominant_sentiment) asla silinmez/ezilmez,
// insan düzeltmesi AYRI sütunlarda tutulur ki 14 günlük TTL sonunda otomatik yeniden tarama
// (bkz. server/services/newsSentiment.js upsertStmt) insan kararını sessizce ezmesin —
// "effective" değer her zaman override varsa onu, yoksa AI'nınkini kullanır.
const mediaSentimentColumns = db.prepare("PRAGMA table_info(media_sentiment)").all()
if (!mediaSentimentColumns.some((c) => c.name === 'override_sentiment')) {
  db.exec('ALTER TABLE media_sentiment ADD COLUMN override_sentiment TEXT')
  db.exec('ALTER TABLE media_sentiment ADD COLUMN override_reviewer TEXT')
  db.exec('ALTER TABLE media_sentiment ADD COLUMN override_at TEXT')
}

// Aylık/Yıllık dönem satırları iki farklı kaynaktan gelebilir: canlı TMDB popülerlik
// anlık görüntülerinin ortalaması (rutin, ileriye dönük) veya data-pipeline-python'daki
// ReytingTV geriye dönük dizi sıralaması taramasının doldurduğu gerçek geçmiş veri
// (bkz. data-pipeline-python/reytingtv_ranker.py). İkisinin sayı ölçeği farklı (TMDB
// popülerliği sınırsız/büyük, ReytingTV sıra skoru 10-100 arası) — karıştırmamak için
// hangi kaynaktan geldiği ayrı tutulur, önyüz bunu dürüstçe etiketleyebilir.
const seriesMonthlyColumns = db.prepare("PRAGMA table_info(series_popularity_monthly)").all()
if (!seriesMonthlyColumns.some((c) => c.name === 'source')) {
  db.exec("ALTER TABLE series_popularity_monthly ADD COLUMN source TEXT")
  db.exec("UPDATE series_popularity_monthly SET source = 'tmdb_snapshot' WHERE source IS NULL")
}

export default db
