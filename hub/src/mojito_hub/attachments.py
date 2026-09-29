"""Chat image files: JPEG only, stored as <MOJITO_ATTACHMENTS_DIR>/<id>.jpg (mode 600);
the database keeps only metadata. Dimensions come from the JPEG frame header, so no
imaging library is loaded."""

import os
from pathlib import Path

from . import config

MAX_BYTES = 5 * 1024 * 1024
DIR = Path(config.ATTACHMENTS_DIR)
if not DIR.is_dir():
    raise FileNotFoundError(f"MOJITO_ATTACHMENTS_DIR {DIR} is not a directory")

# SOF markers carry the frame size; C4 (DHT), C8 (JPG), CC (DAC) share the range but do not.
_SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
# Markers without a length field.
_STANDALONE = {0x01, *range(0xD0, 0xD8)}


def jpeg_size(data: bytes) -> tuple[int, int]:
    """(width, height) from the first SOF segment; ValueError if this is not a JPEG."""
    if data[:2] != b"\xff\xd8":
        raise ValueError("not a JPEG (missing SOI)")
    i = 2
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            raise ValueError(f"not a JPEG (bad marker at byte {i})")
        marker = data[i + 1]
        if marker == 0xFF:  # fill byte
            i += 1
            continue
        if marker in _STANDALONE:
            i += 2
            continue
        length = int.from_bytes(data[i + 2:i + 4], "big")
        if marker in _SOF:
            if i + 9 > len(data):
                break
            height = int.from_bytes(data[i + 5:i + 7], "big")
            width = int.from_bytes(data[i + 7:i + 9], "big")
            if width == 0 or height == 0:
                raise ValueError("JPEG frame has zero width or height")
            return width, height
        if marker == 0xDA:  # start of scan before any frame header
            break
        i += 2 + length
    raise ValueError("not a JPEG (no frame header)")


def path_of(attachment_id: str) -> Path:
    return DIR / f"{attachment_id}.jpg"


def copy(src_id: str, new_id: str) -> None:
    """A second file for an image that gets a second holder (same bytes, own id)."""
    save(new_id, path_of(src_id).read_bytes())


def save(attachment_id: str, data: bytes) -> None:
    """Write via a temp file and rename, so a crash never leaves a partial image."""
    final = path_of(attachment_id)
    tmp = DIR / f".{attachment_id}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.rename(tmp, final)
