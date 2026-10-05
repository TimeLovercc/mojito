"""Project overview content (api.md 项目概况) and the overview.json check shared by sync_projects and the
`mojito-overview-check` command (api.md 补充 2026-10-04).

Missing keys and wrong values are problems. Keys nobody knows (at the top level, in kill, in paper) are ignored
and named, never an error. No network, no .env, no hub: the command runs this module on its own.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

from mojito_worker.i18n import say
from mojito_worker.validate import ValidationError

REVIEW_FIELDS = ("score", "abstract", "novelty", "significance", "objections", "decision")
OVERVIEW_FIELDS = ("one_liner", "status", "kill", "paper", *REVIEW_FIELDS)  # the content; the rest is bookkeeping
TEXT_FIELDS = ("one_liner", "status", "abstract", "novelty", "significance", "decision")
SCORE_RANGE = (0, 5)
KILL_FIELDS = ("state", "setting", "progress")
# api.md 补充 2026-10-04 21:30: paused / stopped added.
KILL_STATES = ("running", "queued", "not_started", "passed", "failed", "done", "paused", "stopped")
PAPER_FIELDS = ("title", "format", "pending", "review", "advice", "note", "pdf_path", "review_path", "dir_path")
PAPER_PATHS = ("pdf_path", "review_path", "dir_path")
PAPER_TEXT_FIELDS = ("title", "format", "review", "advice", "note")
OVERVIEW_FILE = "overview.json"
FILE_FIELDS = ("updated_at", *OVERVIEW_FIELDS)
VALUE_CHARS = 80

KILL_SCHEMA = {
    "type": ["object", "null"],
    "properties": {
        "state": {"type": "string", "enum": list(KILL_STATES)},
        "setting": {"type": "string"},
        "progress": {"type": "string"},
    },
    "required": list(KILL_FIELDS),
    "additionalProperties": False,
}
PAPER_SCHEMA = {
    "type": ["object", "null"],
    "properties": {f: {"type": ["integer", "null"] if f == "pending" else ["string", "null"]} for f in PAPER_FIELDS},
    "required": list(PAPER_FIELDS),
    "additionalProperties": False,
}
REVIEW_SCHEMA_PROPERTIES = {
    "score": {"type": ["number", "null"]},
    "abstract": {"type": ["string", "null"]},
    "novelty": {"type": ["string", "null"]},
    "significance": {"type": ["string", "null"]},
    "objections": {"type": ["array", "null"], "items": {"type": "string"}},
    "decision": {"type": ["string", "null"]},
}


def _shown(value) -> str:
    text = json.dumps(value, ensure_ascii=False)
    return text if len(text) <= VALUE_CHARS else text[:VALUE_CHARS - 1] + "…"


def _is_number(value) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _keys(obj: dict, known: tuple[str, ...], prefix: str, lang: str) -> tuple[list[str], list[str]]:
    """(a problem per missing key, the unknown keys that are ignored) of one object; `prefix` names it."""
    return ([say(lang, "缺少键 {key}", key=prefix + k) for k in known if k not in obj],
            [prefix + k for k in obj if k not in known])


def _object_problems(name: str, value, fields: tuple[str, ...], lang: str) -> tuple[list[str], list[str]]:
    if not isinstance(value, dict):
        return [say(lang, "{key} 必须是对象或 null，现在是 {value}", key=name, value=_shown(value))], []
    return _keys(value, fields, f"{name}.", lang)


def _kill_problems(kill, lang: str) -> tuple[list[str], list[str]]:
    problems, ignored = _object_problems("kill", kill, KILL_FIELDS, lang)
    if not isinstance(kill, dict):
        return problems, ignored
    if "state" in kill and kill["state"] not in KILL_STATES:
        problems.append(say(lang, "kill.state 只能是 {allowed}，现在是 {value}",
                            allowed=" / ".join(KILL_STATES), value=_shown(kill["state"])))
    problems += [say(lang, "{key} 必须是字符串，现在是 {value}", key=f"kill.{f}", value=_shown(kill[f]))
                 for f in ("setting", "progress") if f in kill and not isinstance(kill[f], str)]
    return problems, ignored


def _paper_problems(paper, lang: str) -> tuple[list[str], list[str]]:
    problems, ignored = _object_problems("paper", paper, PAPER_FIELDS, lang)
    if not isinstance(paper, dict):
        return problems, ignored
    if "pending" in paper and paper["pending"] is not None and (isinstance(paper["pending"], bool) or not isinstance(paper["pending"], int)):
        problems.append(say(lang, "paper.pending 必须是整数或 null，现在是 {value}", value=_shown(paper["pending"])))
    problems += [say(lang, "{key} 必须是字符串或 null，现在是 {value}", key=f"paper.{f}", value=_shown(paper[f]))
                 for f in PAPER_TEXT_FIELDS if f in paper and paper[f] is not None and not isinstance(paper[f], str)]
    problems += [say(lang, "{key} 必须是绝对路径或 null（不许空串），现在是 {value}", key=f"paper.{f}", value=_shown(paper[f]))
                 for f in PAPER_PATHS if f in paper and paper[f] is not None
                 and not (isinstance(paper[f], str) and Path(paper[f]).is_absolute())]
    return problems, ignored


def content_problems(o: dict, lang: str) -> tuple[list[str], list[str]]:
    """(problems, ignored unknown keys) in the overview content keys present in `o`: all of them in a file or a
    Claude overview, only the changed ones in a chat edit."""
    problems = [say(lang, "{key} 必须是字符串或 null，现在是 {value}", key=f, value=_shown(o[f]))
                for f in TEXT_FIELDS if f in o and o[f] is not None and not isinstance(o[f], str)]
    ignored: list[str] = []
    for f, check in (("kill", _kill_problems), ("paper", _paper_problems)):
        if f in o and o[f] is not None:
            p, i = check(o[f], lang)
            problems += p
            ignored += i
    if "score" in o and o["score"] is not None and not (_is_number(o["score"]) and SCORE_RANGE[0] <= o["score"] <= SCORE_RANGE[1]):
        problems.append(say(lang, "score 必须是 0–5 的数字或 null，现在是 {value}", value=_shown(o["score"])))
    if "objections" in o and o["objections"] is not None and not (
            isinstance(o["objections"], list) and all(isinstance(x, str) for x in o["objections"])):
        problems.append(say(lang, "objections 必须是字符串列表或 null，现在是 {value}", value=_shown(o["objections"])))
    return problems, ignored


def check_overview_content(o: dict, where: str) -> None:
    """content_problems as an error, for overviews Claude writes and chat edits."""
    problems, _ = content_problems(o, "zh")
    if problems:
        raise ValidationError(f"{where}: " + "；".join(problems))


def _updated_at_problems(value, lang: str) -> list[str]:
    try:
        parsed = datetime.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        parsed = None
    if parsed is None or parsed.tzinfo is None:
        return [say(lang, "updated_at 必须是带时区的 ISO-8601 时间，现在是 {value}", value=_shown(value))]
    return []


def _known(data: dict) -> dict:
    """The file's content with the ignored keys dropped."""
    known = {f: data[f] for f in FILE_FIELDS}
    if known["kill"] is not None:
        known["kill"] = {f: known["kill"][f] for f in KILL_FIELDS}
    if known["paper"] is not None:
        known["paper"] = {f: known["paper"][f] for f in PAPER_FIELDS}
    return known


def check_file(path: Path, lang: str) -> tuple[dict | None, list[str], list[str]]:
    """One overview.json: (its content without the ignored keys, or None when it has problems; problems;
    ignored unknown keys)."""
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        return None, [say(lang, "不是合法的 JSON：{error}", error=str(e))], []
    if not isinstance(data, dict):
        return None, [say(lang, "顶层必须是 JSON 对象，现在是 {value}", value=_shown(data))], []
    problems, ignored = _keys(data, FILE_FIELDS, "", lang)
    if "updated_at" in data:
        problems += _updated_at_problems(data["updated_at"], lang)
    p, i = content_problems(data, lang)
    problems += p
    ignored += i
    return (None if problems else _known(data)), problems, ignored


def main() -> None:
    """mojito-overview-check <overview.json>: the check sync_projects runs on the file."""
    if len(sys.argv) != 2:
        sys.exit("用法：mojito-overview-check <overview.json 路径>")
    _, problems, ignored = check_file(Path(sys.argv[1]), "zh")
    for key in ignored:
        print(f"提醒：不认识的键 {key}，mojito 会忽略它")
    if problems:
        print(f"不合格（{len(problems)} 处）：")
        for n, problem in enumerate(problems, start=1):
            print(f"{n}. {problem}")
        sys.exit(1)
    print("合格")
