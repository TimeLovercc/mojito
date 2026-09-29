"""Read-only local queries the Mac agent's planner may ask for. Claude never runs them; this script does."""
from mojito_worker import gmail, local_facts, orca
from mojito_worker.local_facts import LocalFactError
from mojito_worker.validate import ValidationError, require_enum, require_fields

ARG_FIELDS = ("repo", "pattern", "path", "query", "id", "n")

# type -> (required args, description for the planner prompt)
ACTIONS = {
    "find_files": (("pattern",), "repo（仓库名或 null=全部）、pattern（路径 glob 或子串）→ 匹配的已跟踪文件"),
    "read_file": (("path",), 'path（"<仓库名>/<仓库内路径>"，已跟踪文件）→ 内容（最多 20KB）'),
    "git_log": (("repo", "n"), "repo、n → 该仓库最近 n 条提交"),
    "gmail_search": (("query", "n"), "query（Gmail 搜索语法，如 from:alice newer_than:14d）、n → 邮件列表（发件人、主题、日期、摘要、id）"),
    "gmail_read": (("id",), "id（gmail_search 结果里的邮件 id）→ 邮件正文"),
    "orca_overview": ((), "无参数 → Orca 的 worktree 和终端列表（名称、状态、最近输出预览、终端 handle）"),
    "orca_terminal_read": (("id", "n"), "id（终端 handle，如 term_…）、n（行数）→ 该终端最近输出（只读）"),
}

ACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": list(ACTIONS)},
        **{f: {"type": ["string", "null"]} for f in ARG_FIELDS if f != "n"},
        "n": {"type": ["integer", "null"]},
    },
    "required": ["type", *ARG_FIELDS],
    "additionalProperties": False,
}


def actions_help() -> str:
    return "\n".join(f"- {name}：{desc}" for name, (_, desc) in ACTIONS.items())


def validate_action(a: dict, where: str) -> None:
    require_fields(a, ("type", *ARG_FIELDS), where)
    require_enum(a, "type", tuple(ACTIONS), where)
    for f in ACTIONS[a["type"]][0]:
        if a[f] is None:
            raise ValidationError(f"{where}: {a['type']} needs {f}, got {a}")


def evidence_ref(a: dict) -> str:
    return {
        "find_files": lambda: f"find:{a['repo']}:{a['pattern']}",
        "read_file": lambda: f"file:{a['path']}",
        "git_log": lambda: f"git:{a['repo']}",
        "gmail_search": lambda: f"gmail:search:{a['query']}",
        "gmail_read": lambda: f"gmail:{a['id']}",
        "orca_overview": lambda: "orca:overview",
        "orca_terminal_read": lambda: f"orca:{a['id']}",
    }[a["type"]]()


class LocalTools:
    """One per job: holds the repo list and the Gmail client."""

    def __init__(self, repos: dict):
        self.repos = repos
        self.gmail = gmail.Gmail()

    def run(self, a: dict) -> dict:
        """Execute one planned query; a query that cannot be answered is reported back as its result."""
        handlers = {
            "find_files": lambda: local_facts.find_files(self.repos, a["repo"], a["pattern"]),
            "read_file": lambda: local_facts.read_file(self.repos, a["path"]),
            "git_log": lambda: local_facts.git_log(self.repos, a["repo"], a["n"]),
            "gmail_search": lambda: self.gmail.search(a["query"], a["n"]),
            "gmail_read": lambda: self.gmail.read(a["id"]),
            "orca_overview": orca.overview,
            "orca_terminal_read": lambda: orca.terminal_read(a["id"], a["n"]),
        }
        try:
            return {"action": a, "result": handlers[a["type"]]()}
        except LocalFactError as e:
            return {"action": a, "error": str(e)}


def evidence(results: list[dict]) -> str:
    refs = []
    for r in results:
        if "error" not in r and evidence_ref(r["action"]) not in refs:
            refs.append(evidence_ref(r["action"]))
    return "inferred; " + ", ".join(refs) if refs else "inferred"
