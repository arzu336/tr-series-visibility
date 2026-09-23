"""Ortak günlükleme kurulumu. Betikler `print` yerine `get_logger(__name__)` kullanır:
seviye (`PIPELINE_LOG_LEVEL`, varsayılan INFO) ve biçim tek yerden ayarlanır, zamanlanmış
koşularda (server/services/netflixPipelineRunner.js stdout'u yakalar) satırlar zaman damgalı
ve seviyeli gelir, uyarılar `grep WARNING` ile ayrılabilir.

Kök logger yalnızca bir kez, ilk çağrıda kurulur; pytest kendi yakalayıcısını takarsa ona
karışılmaz (handler zaten varsa dokunulmaz).
"""
from __future__ import annotations

import logging
import os
import sys

_FORMAT = "%(asctime)s %(levelname)-7s [%(name)s] %(message)s"
_DATEFMT = "%Y-%m-%d %H:%M:%S"
_kuruldu = False


def _kur() -> None:
    global _kuruldu
    if _kuruldu:
        return
    _kuruldu = True
    root = logging.getLogger()
    if root.handlers:
        return
    seviye = os.environ.get("PIPELINE_LOG_LEVEL", "INFO").upper()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_FORMAT, _DATEFMT))
    root.addHandler(handler)
    root.setLevel(getattr(logging, seviye, logging.INFO))


def get_logger(name: str) -> logging.Logger:
    _kur()
    # __main__ olarak çalışan betik dosya adıyla görünsün.
    if name == "__main__":
        name = os.path.splitext(os.path.basename(sys.argv[0] or "main"))[0]
    return logging.getLogger(name)
