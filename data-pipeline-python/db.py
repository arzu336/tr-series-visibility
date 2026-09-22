"""SQLite yazım katmanı. Ana Node.js uygulamasının server/data/app.db'sinden BİLEREK
AYRI, bu pipeline'a özel bir dosya kullanır (varsayılan: data/pipeline.db) — üretim
uygulamasının şemasına (server/db.js) izinsiz/otomatik bir migration eklemek yerine,
çıktı burada gözden geçirilip istenirse ayrı bir adımda ana şemaya taşınabilir.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from models import CountryLeaderboard, DizilahSeriesInfo, ImdbSeriesInfo, NetflixCountryRanking, ReytingTvDailyRank

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

-- country_score_engine.py'nin ürettiği kompozit sıralama — her (ülke, dizi) çifti için
-- tek satır, evidence JSON dizi olarak saklanır (bkz. save_country_leaderboard).
CREATE TABLE IF NOT EXISTS country_show_rankings (
    country_code TEXT,
    show_title TEXT,
    local_score REAL,
    netflix_peak_position INTEGER,
    netflix_weeks_in_top10 INTEGER,
    trends_avg_interest REAL,
    trends_direction TEXT,
    locally_available INTEGER,
    evidence TEXT,
    generated_at TEXT,
    PRIMARY KEY (country_code, show_title)
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
    updated_at TEXT,
    PRIMARY KEY (country_iso2, tmdb_id)
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
    return conn


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
             rank_score, last_week_date, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(country_iso2, tmdb_id) DO UPDATE SET
            show_title = excluded.show_title,
            matched_title = excluded.matched_title,
            weeks_in_top10 = excluded.weeks_in_top10,
            peak_rank = excluded.peak_rank,
            rank_score = excluded.rank_score,
            last_week_date = excluded.last_week_date,
            updated_at = excluded.updated_at
        """,
        [
            (
                r.country_iso2, r.tmdb_id, r.show_title, r.matched_title, r.weeks_in_top10,
                r.peak_rank, r.rank_score, r.last_week_date, r.updated_at.isoformat(),
            )
            for r in rankings
        ],
    )
    conn.commit()


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


def save_country_leaderboard(conn: sqlite3.Connection, leaderboard: CountryLeaderboard) -> None:
    conn.execute("DELETE FROM country_show_rankings WHERE country_code = ?", (leaderboard.country_code,))
    conn.executemany(
        """
        INSERT INTO country_show_rankings
            (country_code, show_title, local_score, netflix_peak_position, netflix_weeks_in_top10,
             trends_avg_interest, trends_direction, locally_available, evidence, generated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                leaderboard.country_code,
                e.show_title,
                e.local_score,
                e.netflix_signal.peak_position if e.netflix_signal else None,
                e.netflix_signal.weeks_in_top10 if e.netflix_signal else None,
                e.trends_signal.avg_interest if e.trends_signal else None,
                e.trends_signal.trend_direction if e.trends_signal else None,
                int(e.locally_available),
                json.dumps(e.evidence, ensure_ascii=False),
                leaderboard.generated_at.isoformat(),
            )
            for e in leaderboard.entries
        ],
    )
    conn.commit()
