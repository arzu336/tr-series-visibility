"""SQLite yazım katmanı. Ana Node.js uygulamasının server/data/app.db'sinden BİLEREK
AYRI, bu pipeline'a özel bir dosya kullanır (varsayılan: data/pipeline.db) — üretim
uygulamasının şemasına (server/db.js) izinsiz/otomatik bir migration eklemek yerine,
çıktı burada gözden geçirilip istenirse ayrı bir adımda ana şemaya taşınabilir.

SINIR SÖZLEŞMESİ (iki taraf da bunu varsayar):
  - Node, pipeline.db'yi yalnızca SALT OKUNUR açar (server/services/pipelineDb.js).
  - Python, app.db'ye yalnızca OKUMA yapar (reytingtv_ranker.load_tmdb_series_index) — tek
    istisna backfill_reytingtv.py: app.db'deki `series_popularity_monthly` tablosuna
    source='reytingtv_rank' ile yazar. Bu tablo Node tarafında da aynı kaynak etiketiyle
    okunur (server/series-period-history.js); her iki taraf busy_timeout kullanır. Başka bir
    Python betiği app.db'ye yazmaya başlarsa bu not ve README güncellenmeli.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from models import DizilahSeriesInfo, ImdbSeriesInfo, NetflixCountryRanking, ReytingTvDailyRank

SCHEMA = """
CREATE TABLE IF NOT EXISTS dizilah_series (
    slug TEXT PRIMARY KEY,
    title TEXT,
    channel TEXT,
    status TEXT,
    first_air_date TEXT,
    total_episodes INTEGER,
    average_rating REAL,
    vote_count INTEGER,
    source_url TEXT,
    fetched_at TEXT,
    status_note TEXT
);

CREATE TABLE IF NOT EXISTS dizilah_episode_ratings (
    slug TEXT,
    episode_number INTEGER,
    air_date TEXT,
    total_rating REAL,
    total_share REAL,
    ab_rating REAL,
    ab_share REAL,
    abc1_rating REAL,
    abc1_share REAL,
    PRIMARY KEY (slug, episode_number)
);

CREATE TABLE IF NOT EXISTS imdb_series (
    tconst TEXT PRIMARY KEY,
    primary_title TEXT,
    original_title TEXT,
    start_year INTEGER,
    end_year INTEGER,
    average_rating REAL,
    num_votes INTEGER,
    fetched_at TEXT,
    note TEXT
);

CREATE TABLE IF NOT EXISTS imdb_localized_titles (
    tconst TEXT,
    region TEXT,
    title TEXT,
    is_original INTEGER,
    PRIMARY KEY (tconst, region, title)
);

-- Node uygulamasının (gorunurluk-platformu) TMDB kimliğini bu pipeline'ın ürettiği
-- dizilah_series.slug / imdb_series.tconst ile JOIN edebilmesi için. tmdb_id, ana
-- uygulamanın gerçek zamanlı ürettiği kimlik olduğu için burada sabit/statik veri.
CREATE TABLE IF NOT EXISTS series_mapping (
    tmdb_id INTEGER PRIMARY KEY,
    name TEXT,
    dizilah_slug TEXT,
    imdb_id TEXT
);

-- reytingtv_ranker.py'nin taradığı gerçek günlük TR Top 10 verisi — bkz. modül docstring'i
-- (sayısal reyting/pay YOK, sadece SIRA). PRIMARY KEY aynı gün/kategori/dizi için tekrar
-- taramada üzerine yazar (idempotent backfill).
-- netflix_pipeline.py'nin doldurduğu, TMDB kimliğiyle eşlenmiş resmi Netflix Top 10 verisi.
-- rank_score sıraya dayalı türetilmiş bir puandır, GERÇEK izlenme saati/sayısı DEĞİLDİR
-- (bkz. netflix_country_ranker.py modül docstring'i — ülke bazlı dosyada bu veri hiç yok).
CREATE TABLE IF NOT EXISTS netflix_country_rankings (
    country_iso2 TEXT,
    tmdb_id INTEGER,
    show_title TEXT,
    matched_title TEXT,
    weeks_in_top10 INTEGER,
    peak_rank INTEGER,
    rank_score REAL,
    last_week_date TEXT,
    first_week_date TEXT,
    updated_at TEXT,
    PRIMARY KEY (country_iso2, tmdb_id)
);

-- Eşleşen Türk dizilerinin HAFTALIK Top 10 satırları (ülke × hafta × dizi → sıra). Yukarıdaki
-- özet tablo tüm dönemi toplar; izlenme sinyali son 52 haftayı buradan keser.
CREATE TABLE IF NOT EXISTS netflix_weekly_ranks (
    country_iso2 TEXT,
    week TEXT,
    tmdb_id INTEGER,
    show_title TEXT,
    rank INTEGER,
    updated_at TEXT,
    PRIMARY KEY (country_iso2, week, tmdb_id)
);

-- ORTAK LİSTE TABLOSU (bkz. providers/base.py): hangi kaynaktan gelirse gelsin her "Top" satırı burada.
-- series_id boş olabilir (katalog dışı program); program_kind: series | other | unknown.
-- Netflix: provider netflix_tudum, period_type week, segment 'TV'. reytingtv: provider reytingtv, day, segment Total/AB/20+ABC1.
CREATE TABLE IF NOT EXISTS chart_entries (
    provider TEXT NOT NULL,
    platform TEXT,
    country_iso2 TEXT NOT NULL,
    period_type TEXT NOT NULL,
    period_date TEXT NOT NULL,
    segment TEXT NOT NULL DEFAULT '',
    rank INTEGER NOT NULL,
    series_id INTEGER,
    title_raw TEXT,
    program_kind TEXT DEFAULT 'unknown',
    metric_value REAL,
    metric_unit TEXT,
    source_url TEXT,
    fetched_at TEXT,
    PRIMARY KEY (provider, country_iso2, period_type, period_date, segment, rank)
);
CREATE INDEX IF NOT EXISTS idx_chart_entries_series ON chart_entries (series_id, period_date);
CREATE INDEX IF NOT EXISTS idx_chart_entries_period ON chart_entries (provider, period_date);

-- Katalog tamamlama (catalog_supplement.py): listelere girmiş ama Node kataloğunda (popülerliğe göre ilk
-- 400 Türk dizisi + Netflix Türk yapımları) olmayan Türk dizileri. Node bunları kataloğa SABİT ekler
-- (server/data-pipeline.js); popülerlikleri düşse de katalogdan çıkmazlar. Yalnızca TMDB'de origin TR ve
-- adı birebir tutan TEK aday yazılır; belirsizler unresolved_queue'ya gider. already_in_catalog=1: dizi
-- zaten katalogda, liste başlığı yalnızca farklı yazılmış (eşleştirmede takma ad olarak kullanılır).
-- FlixPatrol dizi sayfaları (providers/flixpatrol_titles.py). Eşleme: dizi → FlixPatrol sayfa slug'ı (status
-- 'ok' | 'yok'; 'yok' 30 gün sonra yeniden aranır). Puanlar: platform × dönem (today|month|year) puanı, dünya
-- sırası, Top 10'da kalınan gün ve günlük ortalama; as_of = sayfanın güncellenme günü.
CREATE TABLE IF NOT EXISTS flixpatrol_title_map (
    tmdb_id INTEGER PRIMARY KEY,
    slug TEXT,
    status TEXT NOT NULL,
    checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flixpatrol_title_stats (
    tmdb_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    platform_name TEXT,
    period TEXT NOT NULL,
    points INTEGER,
    world_rank INTEGER,
    days_in_top10 INTEGER,
    avg_points INTEGER,
    as_of TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (tmdb_id, platform, period, as_of)
);

CREATE TABLE IF NOT EXISTS catalog_supplement (
    tmdb_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    original_name TEXT,
    first_air_date TEXT,
    list_title TEXT NOT NULL,
    source TEXT NOT NULL,
    already_in_catalog INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL
);

-- IMDb puan/oy senkronu (imdb_sync.py, günlük): TMDB → IMDb kimliği eşlemesi yalnızca TMDB external_ids
-- alanından (isimden tahmin yok); tconst NULL = TMDB'de IMDb kimliği yok (30 günde bir yeniden sorulur).
CREATE TABLE IF NOT EXISTS imdb_title_map (
    tmdb_id INTEGER PRIMARY KEY,
    tconst TEXT,
    resolved_at TEXT NOT NULL
);

-- Günlük puan/oy anlık görüntüsü (title.ratings) — "son 7/30 günde kaç oy aldı" ölçüsünün kaynağı.
-- snapshot_date: IMDb dosyasının indirildiği gün.
CREATE TABLE IF NOT EXISTS imdb_rating_history (
    tconst TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    average_rating REAL,
    num_votes INTEGER,
    PRIMARY KEY (tconst, snapshot_date)
);

-- IMDb bölümleri (title.episode, haftalık) ve bölüm puanları (title.ratings, günlük güncellenir).
CREATE TABLE IF NOT EXISTS imdb_episodes (
    tconst TEXT PRIMARY KEY,
    parent_tconst TEXT NOT NULL,
    season INTEGER,
    episode INTEGER,
    average_rating REAL,
    num_votes INTEGER
);
CREATE INDEX IF NOT EXISTS idx_imdb_episodes_parent ON imdb_episodes (parent_tconst);

-- IMDb yönetmen/senarist (title.crew + name.basics, haftalık). episode_count: kişinin yönettiği/yazdığı
-- bölüm sayısı (dizinin kendi kaydında geçip bölüm bazında geçmeyenler 0).
CREATE TABLE IF NOT EXISTS imdb_crew (
    parent_tconst TEXT NOT NULL,
    role TEXT NOT NULL,
    nconst TEXT NOT NULL,
    name TEXT,
    episode_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (parent_tconst, role, nconst)
);

-- Hattın kendi üst verisi (Node salt okunur okur): kaynak dosyanın kapsadığı hafta aralığı,
-- dosyanın tam mı kısmi mi olduğu, son senkron zamanı. Rapor bunlarla "ülkenin son kaydı" ile
-- "dosyanın son haftası" farkını ayırt eder (yoksa 'veri yok' ile 'dizi girmedi' karışır).
CREATE TABLE IF NOT EXISTS pipeline_meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS reytingtv_daily_ranks (
    tmdb_id INTEGER,
    air_date TEXT,
    category TEXT,
    rank INTEGER,
    rank_score REAL,
    matched_title TEXT,
    program_raw TEXT,
    source_url TEXT,
    fetched_at TEXT,
    PRIMARY KEY (tmdb_id, air_date, category)
);

-- --- Kanonik Kimlik Katmanı (identity.py) --------------------------------------------
-- Tüm kaynakların (Dizilla, IMDb, Telegram, Wikipedia, TMDB) ortak omurgası.
-- canonical_id, öncelik sırasını KODLAYAN türetilmiş bir dizge: "wd:Q..." > "imdb:tt..." >
-- "tmdb:...". Ölçüldü: dizilerin %78'inde wikidata_id, %95'inde imdb_id var, %5'inde
-- hiçbiri yok — bu yüzden wikidata_id tek başına anahtar yapılamıyor (katalogun %22'si
-- düşerdi) ama önceliği anahtarın kendisinde korunuyor.
--
-- UNIQUE kısıtları kasıtlı: aynı IMDb kimliği iki kanonik kayda bağlanamaz. Çakışma
-- olursa yazma BAŞARISIZ olur ve kayıt unresolved_queue'ya düşer — sessizce birleşmez.
CREATE TABLE IF NOT EXISTS canonical_identity (
    canonical_id TEXT PRIMARY KEY,
    tier TEXT NOT NULL,
    wikidata_id TEXT UNIQUE,
    imdb_id TEXT UNIQUE,
    tmdb_id INTEGER UNIQUE,
    primary_title TEXT NOT NULL,
    resolved_at TEXT NOT NULL
);

-- Kademe yükseltmesi: bir kayıt önce yalnızca tmdb_id ile gelmiş olabilir ("tmdb:95603"),
-- sonra TMDB'ye wikidata_id eklenince kanonik anahtarı "wd:Q64878719" olur. O ana kadar
-- eski anahtarla yazılmış satırlar KIRILMAMALI — eski anahtar burada takma ad olarak yaşar.
CREATE TABLE IF NOT EXISTS canonical_alias (
    alias_id TEXT PRIMARY KEY,
    canonical_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Çözülemeyen kayıtlar. SİLİNMEZ: 'drop' geri alınamaz ve denetlenemez. Kaynak sonradan
-- sert kimlik kazanırsa aynı satır yeniden çözülebilir. candidates SADECE insan incelemesi
-- içindir — otomatik birleştirmede asla kullanılmaz.
CREATE TABLE IF NOT EXISTS unresolved_queue (
    source TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    raw_title TEXT NOT NULL,
    reason TEXT NOT NULL,
    candidates TEXT NOT NULL DEFAULT '[]',
    detail TEXT,
    seen_at TEXT NOT NULL,
    resolved_at TEXT,
    PRIMARY KEY (source, source_ref)
);
"""


def get_connection(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    # WAL modu: server/services/countryScoringEngine.js bu dosyaya SÜREKLİ AÇIK, salt-okunur
    # bir bağlantı tutuyor (bkz. o dosyadaki not) — varsayılan rollback-journal modunda bu,
    # Python buraya yazarken "database is locked" riski yaratırdı. WAL, okuyucularla yazıcının
    # birbirini bloklamadan aynı anda çalışmasına izin verir (server/db.js'teki aynı ayar).
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    """CREATE IF NOT EXISTS var olan tabloya sütun eklemez; sonradan eklenen sütunlar burada."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(netflix_country_rankings)")}
    if "first_week_date" not in cols:
        conn.execute("ALTER TABLE netflix_country_rankings ADD COLUMN first_week_date TEXT")
        conn.commit()


def set_pipeline_meta(conn: sqlite3.Connection, key: str, value) -> None:
    conn.execute(
        "INSERT INTO pipeline_meta (key, value, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, None if value is None else str(value), datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()


def get_pipeline_meta(conn: sqlite3.Connection, key: str):
    row = conn.execute("SELECT value FROM pipeline_meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def save_dizilah_series(conn: sqlite3.Connection, info: DizilahSeriesInfo) -> None:
    conn.execute(
        """
        INSERT INTO dizilah_series
            (slug, title, channel, status, first_air_date, total_episodes,
             average_rating, vote_count, source_url, fetched_at, status_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET
            title = excluded.title,
            channel = excluded.channel,
            status = excluded.status,
            first_air_date = excluded.first_air_date,
            total_episodes = excluded.total_episodes,
            average_rating = excluded.average_rating,
            vote_count = excluded.vote_count,
            source_url = excluded.source_url,
            fetched_at = excluded.fetched_at,
            status_note = excluded.status_note
        """,
        (
            info.slug,
            info.title,
            info.channel,
            info.status,
            info.first_air_date.isoformat() if info.first_air_date else None,
            info.total_episodes,
            info.average_rating,
            info.vote_count,
            info.source_url,
            info.fetched_at.isoformat(),
            info.status_note,
        ),
    )
    conn.execute("DELETE FROM dizilah_episode_ratings WHERE slug = ?", (info.slug,))
    conn.executemany(
        """
        INSERT INTO dizilah_episode_ratings
            (slug, episode_number, air_date, total_rating, total_share, ab_rating,
             ab_share, abc1_rating, abc1_share)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                info.slug,
                ep.episode_number,
                ep.air_date.isoformat() if ep.air_date else None,
                ep.total_rating,
                ep.total_share,
                ep.ab_rating,
                ep.ab_share,
                ep.abc1_rating,
                ep.abc1_share,
            )
            for ep in info.episodes
        ],
    )
    conn.commit()


def save_imdb_series(conn: sqlite3.Connection, info: ImdbSeriesInfo) -> None:
    conn.execute(
        """
        INSERT INTO imdb_series
            (tconst, primary_title, original_title, start_year, end_year,
             average_rating, num_votes, fetched_at, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tconst) DO UPDATE SET
            primary_title = excluded.primary_title,
            original_title = excluded.original_title,
            start_year = excluded.start_year,
            end_year = excluded.end_year,
            average_rating = excluded.average_rating,
            num_votes = excluded.num_votes,
            fetched_at = excluded.fetched_at,
            note = excluded.note
        """,
        (
            info.tconst,
            info.primary_title,
            info.original_title,
            info.start_year,
            info.end_year,
            info.average_rating,
            info.num_votes,
            info.fetched_at.isoformat(),
            info.note,
        ),
    )
    conn.execute("DELETE FROM imdb_localized_titles WHERE tconst = ?", (info.tconst,))
    conn.executemany(
        "INSERT INTO imdb_localized_titles (tconst, region, title, is_original) VALUES (?, ?, ?, ?)",
        [(info.tconst, lt.region, lt.title, int(lt.is_original)) for lt in info.localized_titles],
    )
    conn.commit()


def save_series_mapping(conn: sqlite3.Connection, tmdb_id: int, name: str, dizilah_slug: str, imdb_id: str | None) -> None:
    conn.execute(
        """
        INSERT INTO series_mapping (tmdb_id, name, dizilah_slug, imdb_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(tmdb_id) DO UPDATE SET
            name = excluded.name,
            dizilah_slug = excluded.dizilah_slug,
            imdb_id = excluded.imdb_id
        """,
        (tmdb_id, name, dizilah_slug, imdb_id),
    )
    conn.commit()


def save_netflix_country_rankings(conn: sqlite3.Connection, rankings: list[NetflixCountryRanking]) -> None:
    conn.executemany(
        """
        INSERT INTO netflix_country_rankings
            (country_iso2, tmdb_id, show_title, matched_title, weeks_in_top10, peak_rank,
             rank_score, last_week_date, first_week_date, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(country_iso2, tmdb_id) DO UPDATE SET
            show_title = excluded.show_title,
            matched_title = excluded.matched_title,
            weeks_in_top10 = excluded.weeks_in_top10,
            peak_rank = excluded.peak_rank,
            rank_score = excluded.rank_score,
            last_week_date = excluded.last_week_date,
            first_week_date = excluded.first_week_date,
            updated_at = excluded.updated_at
        """,
        [
            (
                r.country_iso2, r.tmdb_id, r.show_title, r.matched_title, r.weeks_in_top10,
                r.peak_rank, r.rank_score, r.last_week_date, r.first_week_date, r.updated_at.isoformat(),
            )
            for r in rankings
        ],
    )
    conn.commit()


def save_netflix_weekly_ranks(conn: sqlite3.Connection, rows: list[tuple], updated_at_iso: str) -> None:
    """rows: (country_iso2, week, tmdb_id, show_title, rank). Aynı anahtar yeniden koşuda üzerine yazılır."""
    conn.executemany(
        """
        INSERT INTO netflix_weekly_ranks (country_iso2, week, tmdb_id, show_title, rank, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(country_iso2, week, tmdb_id) DO UPDATE SET
            show_title = excluded.show_title, rank = excluded.rank, updated_at = excluded.updated_at
        """,
        [(r[0], r[1], r[2], r[3], r[4], updated_at_iso) for r in rows],
    )
    conn.commit()


def delete_stale_netflix_rows(conn: sqlite3.Connection, countries: list[str], before_iso: str) -> int:
    """Bu koşuda bloğu TAM okunan ülkelerde, bu koşuda yenilenmemiş (updated_at < before_iso) satırları
    siler — artık eşleşmeyen eski kayıtlar (ör. katalogdan düşen dizi) tabloda kalmasın. Kesilen ya da
    dosyada olmayan ülkelere dokunulmaz. Silinen satır sayısını (iki tablo toplamı) döner."""
    if not countries:
        return 0
    yer = ",".join("?" * len(countries))
    toplam = 0
    for tablo in ("netflix_country_rankings", "netflix_weekly_ranks"):
        cur = conn.execute(
            f"DELETE FROM {tablo} WHERE country_iso2 IN ({yer}) AND (updated_at IS NULL OR updated_at < ?)",
            [*countries, before_iso],
        )
        toplam += cur.rowcount
    cur = conn.execute(
        f"DELETE FROM chart_entries WHERE provider = 'netflix_tudum' AND country_iso2 IN ({yer}) "
        "AND (fetched_at IS NULL OR fetched_at < ?)",
        [*countries, before_iso],
    )
    toplam += cur.rowcount
    conn.commit()
    return toplam


def save_chart_entries(conn: sqlite3.Connection, entries) -> int:
    """providers.base.ChartEntry listesini upsert eder; yazılan satır sayısını döner."""
    rows = [e.as_row() for e in entries]
    if not rows:
        return 0
    conn.executemany(
        """
        INSERT INTO chart_entries (provider, platform, country_iso2, period_type, period_date, segment, rank,
            series_id, title_raw, program_kind, metric_value, metric_unit, source_url, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, country_iso2, period_type, period_date, segment, rank) DO UPDATE SET
            platform = excluded.platform, series_id = excluded.series_id, title_raw = excluded.title_raw,
            program_kind = excluded.program_kind, metric_value = excluded.metric_value,
            metric_unit = excluded.metric_unit, source_url = excluded.source_url, fetched_at = excluded.fetched_at
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def save_flixpatrol_title_map(conn: sqlite3.Connection, tmdb_id: int, slug: str | None, status: str, checked_at: str) -> None:
    conn.execute(
        "INSERT INTO flixpatrol_title_map (tmdb_id, slug, status, checked_at) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(tmdb_id) DO UPDATE SET slug = excluded.slug, status = excluded.status, checked_at = excluded.checked_at",
        (tmdb_id, slug, status, checked_at),
    )
    conn.commit()


def save_flixpatrol_title_stats(conn: sqlite3.Connection, tmdb_id: int, stats: list[dict], as_of: str, fetched_at: str) -> int:
    rows = [
        (tmdb_id, s["platform_slug"], s["platform_name"], s["period"], s["points"], s["world_rank"],
         s["days_in_top10"], s["avg_points"], as_of, fetched_at)
        for s in stats
    ]
    conn.executemany(
        "INSERT OR REPLACE INTO flixpatrol_title_stats (tmdb_id, platform, platform_name, period, points, world_rank, "
        "days_in_top10, avg_points, as_of, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    return len(rows)


def save_reytingtv_daily_ranks(conn: sqlite3.Connection, ranks: list[ReytingTvDailyRank], fetched_at: str) -> None:
    conn.executemany(
        """
        INSERT INTO reytingtv_daily_ranks
            (tmdb_id, air_date, category, rank, rank_score, matched_title, program_raw, source_url, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tmdb_id, air_date, category) DO UPDATE SET
            rank = excluded.rank,
            rank_score = excluded.rank_score,
            matched_title = excluded.matched_title,
            program_raw = excluded.program_raw,
            source_url = excluded.source_url,
            fetched_at = excluded.fetched_at
        """,
        [
            (
                r.tmdb_id, r.air_date.isoformat(), r.category, r.rank, r.rank_score,
                r.matched_title, r.program_raw, r.source_url, fetched_at,
            )
            for r in ranks
        ],
    )
    conn.commit()


