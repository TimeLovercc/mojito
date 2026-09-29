import base64
import json
import subprocess
import tempfile

from mojito_agent.config import CLAUDE_TIMEOUT_S


class ClaudeError(Exception):
    pass


class ClaudeAuthError(ClaudeError):
    """claude -p could not authenticate (CLAUDE_CODE_OAUTH_TOKEN invalid or expired)."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


AUTH_ERROR_STATUSES = (401, 403)
# Outcome of the last claude -p call as far as auth goes: True ok, False auth error, None not known yet.
last_auth_ok: bool | None = None


# The one claude -p child currently running (the agent runs one job at a time), so SIGTERM can take it down too.
_running: subprocess.Popen | None = None
TERMINATE_GRACE_S = 5


def is_running() -> bool:
    return _running is not None


def terminate_running() -> None:
    if _running is None:
        return
    _running.terminate()
    try:
        _running.wait(timeout=TERMINATE_GRACE_S)
    except subprocess.TimeoutExpired:
        _running.kill()


def _user_message(prompt: str, images: list[bytes]) -> str:
    """One stream-json user message: JPEG image blocks (base64) first, then the prompt text."""
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(img).decode()}}
        for img in images
    ]
    content.append({"type": "text", "text": prompt})
    return json.dumps({"type": "user", "message": {"role": "user", "content": content}}) + "\n"


def _result_line(stdout: str) -> dict | None:
    """The final `type=result` event of a stream-json run (same fields as the old --output-format json envelope)."""
    for line in reversed(stdout.splitlines()):
        if line.strip():
            event = json.loads(line)
            if event["type"] == "result":
                return event
    return None


def ask_json(claude_bin: str, prompt: str, schema: dict, images: list[bytes]) -> dict:
    """Run `claude -p` once with no tools and return its structured JSON output.

    Input goes through --input-format stream-json so JPEG images can ride along as image blocks (nothing is written
    to disk). Runs in an empty temp dir so no project CLAUDE.md is picked up; the process exits when done.
    """
    cmd = [
        claude_bin, "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",  # required by stream-json output in -p mode
        "--no-session-persistence",
        "--strict-mcp-config",
        "--tools", "",
        "--json-schema", json.dumps(schema),
    ]
    global _running, last_auth_ok
    with tempfile.TemporaryDirectory(prefix="mojito-agent-") as cwd:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=cwd)
        _running = proc
        try:
            stdout, stderr = proc.communicate(input=_user_message(prompt, images), timeout=CLAUDE_TIMEOUT_S)
        except subprocess.TimeoutExpired as e:
            proc.kill()
            proc.communicate()
            raise ClaudeError(f"claude -p timed out after {CLAUDE_TIMEOUT_S}s") from e
        finally:
            _running = None
    # API failures (auth included) still end with a result event, with a non-zero exit; no result event is a crash.
    envelope = _result_line(stdout)
    if envelope is None:
        raise ClaudeError(f"claude -p exit {proc.returncode}, no result event: {stderr.strip()[:500]} {stdout.strip()[-500:]}")
    if envelope["is_error"] and envelope["api_error_status"] in AUTH_ERROR_STATUSES:
        last_auth_ok = False
        raise ClaudeAuthError(envelope["api_error_status"], f"claude -p auth error: {envelope['result'][:200]}")
    last_auth_ok = True
    if proc.returncode != 0 or envelope["is_error"]:
        raise ClaudeError(f"claude -p error ({envelope['subtype']}): {envelope['result'][:500]}")
    if "structured_output" not in envelope:
        raise ClaudeError(f"claude -p returned no structured_output: {envelope['result'][:500]}")
    return envelope["structured_output"]
