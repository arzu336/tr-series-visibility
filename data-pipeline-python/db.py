"""SQLite yazım katmanı. Ana Node.js uygulamasının server/data/app.db'sinden BİLEREK
AYRI, bu pipeline'a özel bir dosya kullanır (varsayılan: data/pipeline.db) — üretim
uygulamasının şemasına (server/db.js) izinsiz/otomatik bir migration eklemek yerine,
çıktı burada gözden geçirilip istenirse ayrı bir adımda ana şemaya taşınabilir.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from models import DizilahSeriesInfo, ImdbSeriesInfo

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
"""


def get_connection(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
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
