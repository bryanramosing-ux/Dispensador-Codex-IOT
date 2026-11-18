"""Export the Python dashboard's SQLite/settings/JPEG records to local stdout."""
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
import sys


def emit(record):
    print(json.dumps(record, ensure_ascii=False, allow_nan=False), flush=True)


def main(storage):
    directory = Path(storage).resolve(strict=True)
    database = directory / "dispensador.db"
    settings = directory / "settings.json"
    gallery = directory / "gallery"
    if not (database.is_file() or settings.is_file() or gallery.is_dir()):
        raise ValueError("La ruta debe apuntar a backend/storage del dashboard Python")
    if database.is_file():
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
            for identifier, ts, kind, message, data in connection.execute(
                "SELECT id, ts, tipo, mensaje, dato FROM eventos ORDER BY id"
            ):
                emit(dict(kind="event", id=identifier, ts=ts, tipo=kind, mensaje=message,
                          dato=json.loads(data) if data else None))
    if settings.is_file():
        value = json.loads(settings.read_text(encoding="utf-8")).get("auto_capture_s", 0)
        emit(dict(kind="settings", auto_capture_s=value))
    if gallery.is_dir():
        for photo in sorted(gallery.iterdir()):
            if not photo.is_file() or photo.is_symlink() or not re.fullmatch(r"foto_\d{8}_\d{6}_[0-9a-f]{6}\.jpg", photo.name):
                continue
            stat = photo.stat()
            if stat.st_size > 5 * 1024 * 1024:
                raise ValueError("Fotografía fuera del límite permitido: " + photo.name)
            ts = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()
            emit(dict(kind="photo", name=photo.name, ts=ts,
                      jpeg=base64.b64encode(photo.read_bytes()).decode("ascii")))


if __name__ == "__main__":
    main(sys.argv[1])
