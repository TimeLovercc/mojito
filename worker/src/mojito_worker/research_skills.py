"""Read the curated research skills (api.md 研究技能); never follow symlinks or external references.

MOJITO_SKILLS_DIR (worker/.env, an absolute path) is the skills folder your Claude Code / Codex sessions read,
or the repository's examples/skills. The app lists these four skills by id, so each needs its SKILL.md there.
"""
import os
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from mojito_worker.config import TIMEZONE

CURATED_SKILLS = (
    ("research-idea-funnel", "Research Ideas", "Explore new questions, or develop an existing idea through sources and evidence."),
    ("research-experiments", "Research Experiments", "Turn an authorized question into a controlled experiment, run it, interpret the result."),
    ("research-review", "Research Review", "Pick the independent check a judgment needs: idea review, claim-evidence audit or paper review."),
    ("paper-writing", "Paper Writing", "Build the paper around its central claim and the evidence for it; write, review, revise."),
)


def skills_root() -> Path:
    """Read when used, like MOJITO_RESEARCH_MAP: an absolute path (no ~ expansion)."""
    return Path(os.environ["MOJITO_SKILLS_DIR"])


def _raise_walk_error(error: OSError) -> None:
    raise error


def _paths(root: Path) -> list[Path]:
    """Include directories for watch events and regular Markdown files for snapshots.

    Symlinks are excluded, including the root, so a linked folder cannot widen the allowlist.
    A missing root stays in the watch list; snapshot() fails when its SKILL.md is absent.
    """
    if root.is_symlink():
        raise ValueError(f"research skill directory cannot be a symlink: {root}")
    paths = [root]
    if not root.exists():
        return paths
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=_raise_walk_error):
        base = Path(directory)
        dirs[:] = sorted(name for name in dirs if not (base / name).is_symlink())
        paths.extend(base / name for name in dirs)
        paths.extend(base / name for name in sorted(files)
                     if Path(name).suffix.lower() == ".md" and not (base / name).is_symlink()
                     and (base / name).is_file())
    return paths


def watch_paths() -> list[Path]:
    return [path for skill_id, _, _ in CURATED_SKILLS for path in _paths(skills_root() / skill_id)]


def _changes(root: Path) -> list[dict]:
    """The skill directory's last five commits; a folder outside any Git repository has no history."""
    inside = subprocess.run(["git", "-C", str(root), "rev-parse", "--is-inside-work-tree"],
                            capture_output=True, text=True)
    if inside.returncode != 0 and "not a git repository" in inside.stderr:
        return []
    if inside.returncode != 0:
        raise RuntimeError(f"git rev-parse in {root} exited {inside.returncode}: {inside.stderr.strip()}")
    result = subprocess.run(
        ["git", "-C", str(root), "log", "-5", "--format=%H%x1f%cI%x1f%s", "--", "."],
        check=True, capture_output=True, text=True,
    )
    changes = []
    for line in result.stdout.splitlines():
        revision, at, summary = line.split("\x1f", 2)
        changes.append({"revision": revision, "at": at, "summary": summary})
    return changes


def snapshot() -> dict:
    skills = []
    for skill_id, title, summary in CURATED_SKILLS:
        root = skills_root() / skill_id
        files = [path for path in _paths(root) if path.is_file()]
        main = root / "SKILL.md"
        if main not in files:
            raise FileNotFoundError(f"required regular research skill file is missing: {main}")
        files.sort(key=lambda path: (path != main, path.relative_to(root).as_posix()))
        skills.append({
            "id": skill_id, "title": title, "summary": summary,
            "source_path": str(main),
            "updated_at": datetime.fromtimestamp(max(path.stat().st_mtime for path in files), ZoneInfo(TIMEZONE)).isoformat(),
            "files": [{"path": path.relative_to(root).as_posix(), "content": path.read_text(encoding="utf-8")}
                      for path in files],
            "changes": _changes(root),
        })
    return {"updated_at": datetime.now(ZoneInfo(TIMEZONE)).isoformat(), "skills": skills}
