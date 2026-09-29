import base64
import json
import subprocess

from mojito_worker.config import CLAUDE_BIN, CLAUDE_TIMEOUT_S

AUTH_ERROR_STATUSES = (401, 403)

# Result of the latest claude -p call as far as authentication goes: True = authenticated,
# False = auth error, None = no call yet. main reports changes as auth-status `claude-mac`.
auth_ok: bool | None = None
auth_detail: str | None = None


class ClaudeError(Exception):
    pass


class ClaudeAuthError(ClaudeError):
    pass


def ask_json(prompt: str, schema: dict) -> dict:
    """Run `claude -p` non-interactively with no tools and return its structured JSON output."""
    return _run([{"type": "text", "text": prompt}], schema)


def ask_json_with_images(prompt: str, images: list[bytes], schema: dict) -> dict:
    """Same as ask_json, with JPEG images passed as base64 image blocks (never written to disk)."""
    blocks = [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                            "data": base64.b64encode(img).decode()}} for img in images]
    return _run([*blocks, {"type": "text", "text": prompt}], schema)


def _run(content: list[dict], schema: dict) -> dict:
    cmd = [
        CLAUDE_BIN, "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",  # required by claude for stream-json output
        "--no-session-persistence",
        "--tools", "",
        "--strict-mcp-config",
        "--json-schema", json.dumps(schema),
    ]
    message = json.dumps({"type": "user", "message": {"role": "user", "content": content}})
    try:
        proc = subprocess.run(cmd, input=message + "\n", capture_output=True, text=True, timeout=CLAUDE_TIMEOUT_S)
    except subprocess.TimeoutExpired as e:
        raise ClaudeError(f"claude -p timed out after {CLAUDE_TIMEOUT_S}s") from e
    # The result event is emitted even when claude exits non-zero (e.g. auth errors exit 1), so read it first.
    results = [e for e in map(json.loads, proc.stdout.splitlines()) if e["type"] == "result"]
    if len(results) != 1:
        raise ClaudeError(f"claude -p exit {proc.returncode}, {len(results)} result events: "
                          f"{proc.stderr.strip()[:300]} {proc.stdout.strip()[-500:]}")
    envelope = results[0]
    global auth_ok, auth_detail
    # api_error_status is null (or absent) unless the API call itself failed.
    if "api_error_status" in envelope and envelope["api_error_status"] in AUTH_ERROR_STATUSES:
        auth_ok, auth_detail = False, f"api_error_status={envelope['api_error_status']}"
        raise ClaudeAuthError(f"claude -p auth error: {envelope['result'][:300]}")
    auth_ok, auth_detail = True, None
    if envelope["is_error"] or proc.returncode != 0:
        raise ClaudeError(f"claude -p error (exit {proc.returncode}, {envelope['subtype']}): {envelope['result'][:500]}")
    if "structured_output" not in envelope:
        raise ClaudeError(f"claude -p returned no structured_output: {envelope['result'][:500]}")
    return envelope["structured_output"]
