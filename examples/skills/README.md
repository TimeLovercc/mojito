# Example research skills

Four generic research skills in the Claude Code / Codex skill format (a folder with a `SKILL.md`, plus Markdown references and templates). They are what the app's **Research skills** panel shows (docs/api.md, 研究技能) and what Idea Lab research runs read.

| Folder | Shown as | For |
|---|---|---|
| `research-idea-funnel/` | Research Ideas | exploring new questions, developing ideas, syncing them to Idea Lab (`scripts/idea_lab.py`, `references/idea-lab.md`) |
| `research-experiments/` | Research Experiments | turning a question into a controlled experiment and interpreting it |
| `research-review/` | Research Review | idea review, claim-evidence audit, routing to paper review |
| `paper-writing/` | Paper Writing | drafting and revising a paper around its central claim |

Use them as they are by setting `MOJITO_SKILLS_DIR` in `worker/.env` to the absolute path of this folder, or copy the four folders into the skills folder your sessions already read (for Claude Code, `~/.claude/skills/`) and point `MOJITO_SKILLS_DIR` there. Edit them freely: the worker re-reads them within a minute of a change and the app shows the new text, with the folder's last Git commits under "Recent changes".

They are deliberately short and generic. None of them encodes anyone's private projects or ideas.
