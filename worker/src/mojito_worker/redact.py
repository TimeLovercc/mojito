"""Mask secret-looking strings before local text (terminal output, mail bodies) reaches Claude or the hub."""
import re

PATTERNS = [
    re.compile(r"sk-ant-[A-Za-z0-9_-]{8,}"),                     # Anthropic keys / OAuth tokens
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),                        # OpenAI-style keys
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),                              # AWS access key id
    re.compile(r"xox[abprs]-[A-Za-z0-9-]{10,}"),                  # Slack
    re.compile(r"ya29\.[A-Za-z0-9_-]{20,}|1//[A-Za-z0-9_-]{20,}"),  # Google access / refresh tokens
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{16,}"),
    re.compile(r"(?i)((?:token|secret|password|passwd|api[_-]?key)\s*[=:]\s*[\"']?)[^\s\"']{8,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
]


def _mask(m: re.Match) -> str:
    # Keep a leading label group (e.g. "Bearer ", "token=") so the text still reads naturally.
    return (m.group(1) if m.re.groups else "") + "[已隐去]"


def redact(text: str) -> str:
    for p in PATTERNS:
        text = p.sub(_mask, text)
    return text
