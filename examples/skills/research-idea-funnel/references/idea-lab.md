# Idea Lab synchronization

Use this adapter when an ordinary Claude Code or Codex research session should save an idea into mojito Idea Lab (docs/api.md, Idea Lab → 普通研究会话同步). It only reads the lab and creates/updates ideas through the dedicated synchronization endpoint. It does not start research runs, create automations, authorize experiments, write Notion, or change project status. Research judgment stays with the session; the adapter never invents missing content.

## Credentials and invocation

Both agents run the same standard-library CLI from any working directory:

```sh
uv run --script "$MOJITO_SKILLS_DIR/research-idea-funnel/scripts/idea_lab.py" list
```

`$MOJITO_SKILLS_DIR` stands for the folder holding this skill (the worker's `MOJITO_SKILLS_DIR`); use its absolute path. The credential file is `$MOJITO_SECRETS_DIR/idea-lab.env` (the same secrets folder as `cards.env`; `hub/deploy/mac-env.sh source:ideas MOJITO_IDEA_LAB_TOKEN "$MOJITO_SECRETS_DIR/idea-lab.env"` writes it). It must be a regular file owned by the current user, mode `600`, containing exactly these two assignments:

- `MOJITO_HUB_URL`: hub HTTPS origin without path, query, fragment or embedded credentials.
- `MOJITO_IDEA_LAB_TOKEN`: the dedicated Idea Lab token, not a worker/app token.

Do not print or copy credentials into a bundle, research output, transcript, or repository. The CLI reads no other token source. A missing credential file is a provisioning issue, not permission to borrow a broader token. HTTP redirects are refused; HTTP is allowed only on loopback for isolated local validation. `--config /absolute/path/idea-lab.env` before the subcommand explicitly selects another dedicated configuration for such validation, with the same permission checks.

## Content and a stable local bundle

Use one stable bundle per idea in the existing project's idea/output location, and reuse it across session restarts. The bundle records endpoint origin, last verified server ID/revision/content, local content, pending request, receipt, remote conflict copy, and past operations. It contains no authentication token. A sibling `.lock` prevents concurrent processes from changing that bundle; an atomic write and filesystem flush persist the request before it is sent. Keep both the bundle and any source input under the project's normal persistence policy. Do not manually edit bundle internals or duplicate a pending bundle to submit another creation.

The input JSON must contain every `IdeaInput` field; unknown and missing fields fail:

| Field | Required content |
|---|---|
| `title`, `question`, `importance`, `next_step` | Strings grounded in this research; title 1–200 characters and question nonempty |
| `status` | `developing`, `ready`, `experimenting`, `supported`, `contradicted`, or `archived` |
| `seed_ids`, `hypotheses` | Lists of strings; seed IDs must come from `list`, never invented |
| `evidence` | List of `{id, claim, source, kind, at}`; kind is `observation`, `literature`, `experiment`, or `review`; unique IDs and timezone-bearing ISO timestamps |
| `changes` | List of `{at, before, after, reason}`; use an actual prior judgment, never manufacture one; timestamps carry timezone |
| `artifacts` | List of `{kind, title, url}`; kind is `source`, `experiment`, `paper`, `review`, or `notion` |
| `notion_url` | Actual URL or explicit `null` |
| `notion_sync` | `pending` or `synced`; `synced` requires a separately verified Notion HTTPS URL |

Take each `at` from a clock read in the same command that writes the input, never from an estimate; a wrong time cannot be edited later because evidence is append-only. Empty lists mean the session established there are no entries to record, not placeholders to fill the schema. Unknown research conclusions remain labeled unknown in the relevant prose. An Idea Lab sync receipt proves only Idea Lab storage; it does not prove Notion synchronization. Existing evidence is append-only by ID: preserve earlier entries exactly. Existing judgment changes retain their contents and relative order. Add corrections or subsequent evidence instead of deleting inconvenient history.

## Create and verify

Use absolute input and bundle paths. These commands illustrate an already authorized project's chosen paths; substitute its actual directory rather than creating another generic store:

```sh
uv run --script "$MOJITO_SKILLS_DIR/research-idea-funnel/scripts/idea_lab.py" new /absolute/project/ideas/question.bundle.json --input /absolute/project/ideas/question.input.json
uv run --script "$MOJITO_SKILLS_DIR/research-idea-funnel/scripts/idea_lab.py" push /absolute/project/ideas/question.bundle.json
uv run --script "$MOJITO_SKILLS_DIR/research-idea-funnel/scripts/idea_lab.py" status /absolute/project/ideas/question.bundle.json
```

`new` only validates and saves local content. `push` saves a UUID operation and complete request before any network access, looks for its receipt, then sends `POST /idea-lab/sync` only if the receipt is absent. A receipt is saved before the verification GET. Only when the current server idea matches every content field and the acknowledged revision does the CLI report `synced` (exit 0). Timezone representations of the same instant compare equal; text, lists, and all other fields must match. Do not report successful synchronization from a POST acknowledgement alone.

## Develop an existing idea

```sh
uv run --script "$MOJITO_SKILLS_DIR/research-idea-funnel/scripts/idea_lab.py" get IDEA_ID
uv run --script "$MOJITO_SKILLS_DIR/research-idea-funnel/scripts/idea_lab.py" pull /absolute/project/ideas/question.bundle.json --id IDEA_ID
uv run --script "$MOJITO_SKILLS_DIR/research-idea-funnel/scripts/idea_lab.py" push /absolute/project/ideas/question.bundle.json --input /absolute/project/ideas/question.updated.json
```

`pull` creates a new local bundle from the current idea, including its revision, and refuses to replace an existing bundle. If the project already has a bundle, use it. Supply a complete revised `IdeaInput`, preserving prior evidence and judgment history. A changed payload after a verified sync creates a new operation with the last verified revision; concurrent server changes therefore produce a conflict rather than an overwrite. A repeated unchanged push reuses the same operation.

## Interrupted or uncertain requests

```sh
uv run --script "$MOJITO_SKILLS_DIR/research-idea-funnel/scripts/idea_lab.py" retry /absolute/project/ideas/question.bundle.json
```

Retry uses the persisted operation ID and immutable request, first retrieving `GET /idea-lab/sync/{operation_id}`. If the prior POST succeeded but its response was lost, its original receipt recovers the same idea; it never creates a second card. A failed current-idea GET does not discard the receipt. Keep retrying the same bundle after a network interruption. Do not generate a fresh ID, change the pending payload, or create a replacement bundle to work around uncertainty. The stored endpoint must equal the selected credential endpoint; cross-endpoint replay is refused.

## Conflicts and explicit merge

HTTP 409 records `conflict`, preserving the local request and retrieving the current remote idea. If a receipt exists but someone has since updated the idea, verification records `current_newer` (exit 3), preserving the receipt and newer remote copy. Neither state overwrites remote data or pretends the local content is current. Inspect `payload`, `base.content`, `remote`, and the saved receipt in the bundle, then prepare a deliberate merged input.

```sh
uv run --script "$MOJITO_SKILLS_DIR/research-idea-funnel/scripts/idea_lab.py" rebase /absolute/project/ideas/question.bundle.json --input /absolute/project/ideas/question.merged.json --revision 7
uv run --script "$MOJITO_SKILLS_DIR/research-idea-funnel/scripts/idea_lab.py" push /absolute/project/ideas/question.bundle.json
```

Replace `7` with the actual remote revision just reviewed. `rebase` checks it against a fresh GET, keeps the earlier request/receipt in `history`, and saves merged content as a draft based on that revision. If the remote changed again, it saves the newest remote copy and stops for another merge. Rebase itself never sends a write. An initial creation's operation-key conflict without a known remote identity requires receipt inspection; the CLI will not silently create another card.

HTTP 404/422 from POST records `rejected`: the request definitively failed validation/reference lookup. Correct the complete input and use `push --input` to create a new operation while retaining the rejected request in history. Authentication, transport, and other failures retain the existing request. Exit 2 reports an error; `status` is an offline inspection of the last recorded state, not a fresh server check. To verify current server state, use `retry` for an existing operation or `get`.
