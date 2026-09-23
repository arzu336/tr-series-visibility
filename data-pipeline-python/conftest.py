"""pytest ortak fixture'ları ve CANLI VERİTABANI KORUMASI.

Bu pipeline iki gerçek SQLite dosyasına dokunuyor:
    data/pipeline.db                 — bu paketin kendi çıktısı
    ../server/data/app.db            — Node uygulamasının üretim veritabanı

Testlerin ikisine de dokunmaması gerekir. Mevcut testler zaten `:memory:` kullanıyor, ama bu
bir GELENEKTİ, kural değildi: ileride eklenecek bir test `db.get_connection(DB_PATH)` yazıp
sessizce canlı veriye migration uygulayabilirdi (SCHEMA'da CREATE/DROP var). Aşağıdaki autouse
koruma bunu bir test hatasına dönüştürür — sessiz veri kaybı yerine kırmızı test.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

# Testlerin ASLA açmaması gereken dosyalar.
KORUMALI_DOSYALAR = {
    (BASE_DIR / "data" / "pipeline.db").resolve(),
    (BASE_DIR.parent / "server" / "data" / "app.db").resolve(),
}


def _korumali_mi(target: object) -> bool:
    """sqlite3.connect hedefi korumalı bir üretim dosyası mı?

    ':memory:' ve 'file:...:memory:' gibi bellek hedefleri serbesttir; geçici dizinlerdeki
    dosyalar da (tmp_path fixture'ı) serbesttir — yalnızca iki gerçek dosya yasaklı.
    """
    if not isinstance(target, (str, Path)):
        return False
    metin = str(target)
    if ":memory:" in metin:
        return False
    try:
        return Path(metin).resolve() in KORUMALI_DOSYALAR
    except (OSError, ValueError):
        return False


@pytest.fixture(autouse=True)
def canli_veritabani_korumasi(monkeypatch):
    """Her testte etkin: üretim veritabanlarına bağlanma denemesi testi düşürür."""
    gercek_connect = sqlite3.connect

    def korumali_connect(target, *args, **kwargs):
        if _korumali_mi(target):
            raise AssertionError(
                f"Test canlı veritabanını açmaya çalıştı: {target}\n"
                "Testler üretim verisine dokunamaz — ':memory:' ya da tmp_path kullanın "
                "(bkz. conftest.py)."
            )
        return gercek_connect(target, *args, **kwargs)

    monkeypatch.setattr(sqlite3, "connect", korumali_connect)


@pytest.fixture()
def bellek_db() -> sqlite3.Connection:
    """Tam şemayla kurulmuş, bellek-içi, tek testlik veritabanı.

    db.SCHEMA doğrudan uygulanıyor — şema değişikliği testlere otomatik yansısın diye
    (şemanın ikinci bir kopyası tutulmuyor, iki yerin ayrışma riski olmasın).
    """
    import db as db_module

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(db_module.SCHEMA)
    yield conn
    conn.close()
