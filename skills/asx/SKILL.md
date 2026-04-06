---
name: asx
description: Asana CLI wrapping the REST API
---

# asx: Asana CLI

```sh
asx <entity> <action> [<gid>] [--flags...]
```

The CLI is always flat: `asx <entity> <action>`. Sub-resource and verb actions stay explicit, for example `asx tasks subtasks`, `asx tasks create-subtasks`, and `asx tasks add-followers`.

Use `asx describe [<entity> [<action>]]` for schema introspection.

## Auth

Resolution: `--account <name>` > `ASANA_TOKEN` env var > single stored account.

## Input

Writes accept either individual flags or a raw JSON body. `--json` wins on conflict.

```sh
asx tasks create --json '{"name":"bugfix","projects":["def"]}'
```

`--json` expects raw request fields only, not a full Asana `{ "data": ... }` envelope.

## Output

Successful commands emit a JSON envelope with `meta` and `data`:

```json
{
  "meta": {
    "command": "tasks.list",
    "status": 200,
    "nextPage": null
  },
  "data": [ ... ]
}
```

- `meta.command` is always `entity.action` (one dot), e.g. `tasks.list`, `tasks.subtasks`, or `project-briefs.create-for-project`.
- `data` is the unwrapped Asana payload: object for single resources, array for lists.
- `meta.nextPage` is a pagination offset (string) or `null`. Pass it as `--offset`.

## Rules

- Use `--dry-run` to preview writes before sending them.
- `--opt-fields` on GET requests to keep responses small.
- Pagination is manual: check `meta.nextPage`, pass as `--offset`.
- Don't guess GIDs, query first.
- Dotted Asana filters stay dotted on the CLI, for example `--projects.any` or `--due-on.before`.

## Gotchas

- `start_on` requires `due_on`: always send both together.
- `me` is a positional GID alias, not an action. Use `users get me`, not `users me`.
- `tasks for-project` excludes completed tasks by default. Pass `--completed-since 2000-01-01T00:00:00.000Z` (any far-past timestamp) to include them.
- `tasks search` is eventually-consistent. Verify recent writes with `tasks get` or `tasks for-project`, not `search`.
- `attachments create` is multipart on Asana's side and this CLI is JSON-only; the action surfaces but always fails. Use the raw API for file uploads.
- `project-briefs create-for-project` may reject plain `--text` with `Rich text should be wrapped in <body> tag.` If that happens, retry with `--html-text '<body>...</body>'`.
- `portfolios delete` returns 403 even for the owner. Use `portfolios update --archived true` to hide one instead.
- `<entity> remove-members --members me` (portfolios, projects, goals, teams) revokes your own access.
- After `custom-fields delete`, a follow-up `get` returns 403, not 404. Treat as deleted.
