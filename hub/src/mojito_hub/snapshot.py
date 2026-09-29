"""Consistent online snapshot of the hub database (api.md 大批改进 §7b).

    MOJITO_DB=/var/lib/mojito/hub.db python -m mojito_hub.snapshot /var/lib/mojito/snapshots/hub-<date>.db

Reads only MOJITO_DB. Uses SQLite's backup API (safe while the hub runs), checks the copy's
integrity, then renames it into place (mode 600). Exit 0 on success, non-zero otherwise."""

import os
import sqlite3
import sys
from pathlib import Path


def snapshot(src: Path, out: Path) -> None:
    if not src.is_file():
        raise FileNotFoundError(f"MOJITO_DB {src} is not a file")
    tmp = out.with_name(f".{out.name}.tmp")
    tmp.unlink(missing_ok=True)  # leftover of an interrupted run
    source = sqlite3.connect(src)
    target = sqlite3.connect(tmp)
    try:
        source.backup(target)
        # The copy inherits WAL mode; make it a self-contained single file for rsync.
        target.execute("PRAGMA journal_mode=DELETE")
        result = target.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise RuntimeError(f"integrity_check of the snapshot: {result}")
    finally:
        target.close()
        source.close()
    os.chmod(tmp, 0o600)
    os.replace(tmp, out)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m mojito_hub.snapshot <output path>")
    snapshot(Path(os.environ["MOJITO_DB"]), Path(sys.argv[1]))
    print(f"snapshot written: {sys.argv[1]}")
