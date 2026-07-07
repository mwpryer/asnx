---
name: asx
description: Interact with Asana (tasks, projects, users, workspaces, and more) via the asx CLI. Use whenever reading or modifying anything in Asana.
---

# `asx`: Asana CLI

```sh
asx <entity> <action> [<gid>] [--flags...]
```

The CLI is always flat: `asx <entity> <action>`. Sub-resource and verb actions stay explicit, for example `asx tasks subtasks`, `asx tasks create-subtasks`, and `asx tasks add-followers`.

Use `asx describe [<entity> [<action>]]` for schema introspection.

## Auth

Resolution: `--account <name>` > `ASANA_TOKEN` env var > single stored account.

`asx auth status` verifies the resolved token against the API; use it to diagnose 401s.

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

Errors go to stderr as `{"error":{"status":...,"message":...,"help":...}}`. `status` is `null` for local errors (usage, transport). The exit code is always 1 on error.

## Rules

- Use `--dry-run` to preview writes before sending them.
- `--opt-fields` on GET requests to keep responses small.
- Pagination is manual: check `meta.nextPage`, pass as `--offset`.
- Don't guess GIDs, query first. Start from `asx workspaces list`, then e.g. `asx tasks search <workspace-gid> --text "bugfix"`.
- If entity commands come back as unknown, the schema cache is missing: run `asx schema update`.
- Dotted Asana filters stay dotted on the CLI, for example `--projects.any` or `--due-on.before`.

## Gotchas

- `start_on` requires `due_on`: always send both together.
- `me` is a positional GID alias, not an action. Use `users get me`, not `users me`.
- `tasks for-project` returns all tasks, including completed ones, by default. To get only incomplete tasks pass `--completed-since <recent-timestamp>` (e.g. now); Asana then returns tasks that are incomplete or were completed since that time.
- `tasks duplicate` and `projects duplicate` do not carry over every association. A duplicated task comes back with no project membership (`projects: []`) unless you pass `--include` naming the elements to copy, e.g. `--include projects,subtasks,assignee`.
- `stories for-task` and `stories for-goal` return comments and system events together. Comments are the entries with `"type": "comment"`; filter client-side.
- `tasks search` is eventually-consistent. Verify recent writes with `tasks get` or `tasks for-project`, not `search`.
- `attachments create` is multipart on Asana's side and this CLI is JSON-only; the action surfaces but always fails. Use the raw API for file uploads.
- `project-briefs create-for-project` may reject plain `--text` with `Rich text should be wrapped in <body> tag.` If that happens, retry with `--html-text '<body>...</body>'`.
- `<entity> remove-members --members me` (portfolios, projects, goals, teams) revokes your own access.
